// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { h, svg, clear, dot, safeText } from "./dom";
import { ICONS } from "./icons";
import { createThoughtLine } from "../ui/thoughtline";
import { createSpringCheck, type SpringCheck } from "../ui/springcheck";
import { squishSwitch } from "../ui/squishswitch";
import { createSwipeToast, type SwipeToast } from "../ui/swipetoast";
import { createSwipeRow } from "../ui/swiperow";
import { Bridge } from "../core/bridge";
import { canStartBluetoothAction, isCurrentBluetoothRequest } from "../core/bluetooth";
import { prefersReduced } from "../core/anim";
import { agentMeta } from "../core/agents";
import { carouselAgents } from "../core/agent-carousel";
import { diffForStep, diffStat, stepKind, baseName, type AgentStep, type StepKind } from "../core/steps";
import { State, type AgentTask } from "../core/state";
import { washRGBA, PIP_SAFE_INSET, type IslandViewName, type Wash } from "../core/layout";
import { createMiniBot, pruneMiniBots } from "../mochi/minibots";
import { react, setCondition } from "../mochi/reactions";
import { createBatteryIcon, batteryWithLabel } from "../ui/batteryicon";
import { buildPrompt } from "./chat";
import { buildChoose, buildUpload, buildUploading } from "./upload";
import { renderIntegrationCard, type IntegrationCardHooks } from "./integrations";
export { buildHeader } from "./header";
import "./agent-workspace.css";

export interface ViewActions {
  setView(v: IslandViewName): void;
  collapse(): void;
  setAgentExpanded(expanded: boolean): void;
  setFocus(id: string): void;
  openTerminal(): void;
  /** The ↗ button: opens whatever the focused pill points at. */
  openTarget(): void;
  openUrl(url: string): void;
  decide(d: "allow" | "deny"): void;
  toggleSound(): void;
  setVolume(v: number): void;
  setAutoClose(seconds: number): void;
  openSettingsWindow(): void;
  blip(): void;
}

export interface ViewHost {
  el: HTMLElement;
  sync(): void;
  /** Called when the view becomes active, for views with a text field. */
  focus?(): void;
  /** Called every frame while the view is on screen. */
  tick?(nowMs: number): void;
}

// ── Shared pieces ─────────────────────────────────────────────────────────────

function card(wash: Wash, ...children: (Node | string)[]): HTMLElement {
  const el = h("div", { class: wash ? "card wash" : "card" }, ...children);
  el.style.setProperty("--pip-safe-inset", `${PIP_SAFE_INSET}px`);
  if (wash) el.style.setProperty("--wash", washRGBA(wash));
  return el;
}

function btn(
  label: string,
  kind: "primary" | "secondary",
  onClick: () => void,
  kbd?: string,
): HTMLElement {
  return h(
    "button",
    { class: `btn ${kind}`, onclick: onClick },
    h("span", { text: label }),
    kbd ? h("span", { class: "kbd", text: kbd }) : null,
  );
}

/** AgentWho — coloured dot + task name + grey label. */
function agentWho(task: AgentTask | null, label: string): HTMLElement {
  const row = h("div", { class: "who-row" });
  if (task) {
    row.append(dot(task.color, 8), h("span", { class: "n", text: task.name }));
  }
  row.append(h("span", { text: label }));
  return row;
}

function stack(padLeft: number, padRight: number, ...children: Node[]): HTMLElement {
  const el = h("div", { class: "stack" }, ...children);
  el.style.padding = `4px ${padRight}px 4px ${padLeft}px`;
  return el;
}

// ── Overview ──────────────────────────────────────────────────────────────────

/** A pill whose card is the agent session view (VS Code + every agent_* pill). */
function isAgentTask(task: AgentTask): boolean {
  return task.id === "integration_claude" || task.id.startsWith("agent_");
}

/** Whether an Allow/Deny from the island actually reaches this agent. Claude
 *  Code's hooks and Hermes' pre_tool_call block on a decision; OpenCode's
 *  plugin API is fire-and-forget, so it stays display-only (never faked). */
function taskAllowsApproval(task: AgentTask): boolean {
  if (task.id === "integration_claude") return true;
  if (task.id.startsWith("agent_")) return agentMeta(task.id.slice("agent_".length)).allowsApproval;
  return false;
}

/** Icon per step kind for the click-through rail. */
function stepKindIcon(kind: StepKind): Node {
  switch (kind) {
    case "bash":
      return h("span", { class: "step-glyph", text: "❯" });
    case "edit":
    case "read":
      return svg(ICONS.doc, 9);
    case "prompt":
      return svg(ICONS.arrowUp, 9);
    default:
      return h("span", { class: "step-glyph", text: "•" });
  }
}

function str(input: Record<string, unknown> | undefined, k: string): string | null {
  const v = input?.[k];
  return typeof v === "string" && v.trim() ? v : null;
}

/** Cap on rendered diff rows — a whole-file write can be thousands of lines. */
const MAX_DIFF_ROWS = 80;

interface SessionView {
  el: HTMLElement;
  update(task: AgentTask): void;
  tick(nowMs: number): void;
}

/**
 * The main agent view: header (agent, live state, model/thinking when the
 * agent reports them), a click-through step rail, and a viewer for the
 * selected step — the diff for an edit, the command for a Bash step, the
 * target for a read — plus the pending permission with real Allow/Deny when
 * the agent can receive a decision.
 */
function createSessionView(actions: ViewActions): SessionView {
  const whoDot = dot("var(--accent)", 7);
  const whoName = h("span", { class: "name" });
  const provider = h("span", { class: "session-provider" });
  const thought = createThoughtLine();
  const stepPreview = h("span", { class: "session-step-preview" });
  const modelChip = h("span", { class: "chip" });
  const thinkChip = h("span", { class: "chip" });
  const whoCount = h("span", { class: "count" });
  const expand = h("button", {
    class: "session-expand",
    type: "button",
    "aria-label": "Expand agent session",
    title: "Expand agent session",
    onclick: () => actions.setAgentExpanded(true),
  }, svg(ICONS.chevronRight, 11, { stroke: 2 }));
  const head = h("div", {
    class: "session-head agent-main-trigger",
  }, whoDot, whoName, provider, thought.el, stepPreview, modelChip, thinkChip, whoCount, expand);

  const approvalCmd = h("div", { class: "cmd-line" });
  const approvalNote = h("div", { class: "session-note" });
  const approvalRow = h("div", { class: "actions" });
  const approval = h("div", { class: "approval-inline" }, approvalCmd, approvalNote, approvalRow);

  const rail = h("div", { class: "step-rail" });
  const viewer = h("div", { class: "step-view" });

  const work = h("div", { class: "session-work" }, approval, viewer);
  const el = h("div", { class: "session" }, head, rail, work);

  let taskId: string | null = null;
  let currentTask: AgentTask | null = null;
  let selected = 0;
  let picked = false;
  let selectedStep: AgentStep | null = null;
  let selectedStepKey = "";
  const selectionByTask = new Map<string, { selected: number; picked: boolean; step: AgentStep | null; key: string }>();
  const scrollByStep = new Map<string, number>();
  let railKey = "";
  let viewKey = "";
  let approvalKey = "";

  const stepAt = (task: AgentTask, i: number): AgentStep =>
    task.stepDetails[i] ?? { label: task.steps[i] ?? "", tool: "" };

  const stepKey = (step: AgentStep): string => `${step.label}|${step.tool}|${JSON.stringify(step.input ?? null)}`;

  function syncRail() {
    const chips = rail.children;
    for (let i = 0; i < chips.length; i++) chips[i].classList.toggle("on", i === selected);
  }
  function renderViewer(task: AgentTask, i: number) {
    const detail = stepAt(task, i);
    const kind = stepKind(detail);
    const key = `${task.id}|${stepKey(detail)}`;
    if (key === viewKey) return;
    const oldBody = viewer.querySelector<HTMLElement>(".diff-body");
    if (oldBody && viewKey) scrollByStep.set(viewKey, oldBody.scrollTop);
    viewKey = key;
    clear(viewer);

    const diff = diffForStep(detail);
    if (diff && diff.rows.length > 0) {
      const stat = diffStat(diff.rows);
      const rows = diff.rows.slice(0, MAX_DIFF_ROWS);
      viewer.append(
        h("div", { class: "diff-head" },
          h("span", { class: "diff-path", text: diff.path ? baseName(diff.path) : "changes", title: diff.path }),
          h("span", { class: "diff-stat" },
            h("b", { class: "add", text: `+${stat.added}` }),
            h("b", { class: "del", text: `−${stat.removed}` }),
          ),
        ),
        h("div", { class: "diff-body" },
          ...rows.map((r) =>
            h("div", { class: "diff-row", "data-k": r.kind },
              h("span", { class: "diff-sign", text: r.kind === "add" ? "+" : r.kind === "del" ? "−" : " " }),
              h("span", { class: "diff-text", text: r.text }),
            ),
          ),
        ),
      );
      const body = viewer.querySelector<HTMLElement>(".diff-body");
      if (body) body.scrollTop = scrollByStep.get(key) ?? 0;
      return;
    }

    if (kind === "bash") {
      const command = str(detail.input, "command") ?? detail.label;
      const output = str(detail.input, "output") ?? str(detail.input, "stdout") ?? str(detail.input, "stderr");
      viewer.append(h("div", { class: "cmd-block" },
        h("span", { class: "cmd-prompt", text: "❯" }),
        h("span", { class: "cmd-text", text: command }),
      ));
      if (output) viewer.append(h("pre", { class: "cmd-output", text: output }));
      return;
    }

    // Read / other / prompt: the label, plus the concrete target when there is one.
    const target =
      str(detail.input, "path") ?? str(detail.input, "file_path") ??
      str(detail.input, "url") ?? str(detail.input, "query") ?? str(detail.input, "pattern");
    const output = str(detail.input, "output") ?? str(detail.input, "content") ?? str(detail.input, "result");
    viewer.append(h("div", { class: "step-plain" },
      h("span", { class: "step-plain-label", text: detail.label }),
      target ? h("span", { class: "step-plain-target", text: target, title: target }) : null,
    ));
    if (output && !diff) viewer.append(h("pre", { class: "step-output", text: output }));
  }
  return {
    el,
    tick(nowMs: number) {
      thought.tick(nowMs);
    },
    update(task: AgentTask) {
      const focusChanged = task.id !== taskId;
      if (focusChanged) {
        if (taskId && currentTask) {
          const previous = selectedStep ?? stepAt(currentTask, selected);
          selectionByTask.set(taskId, { selected, picked, step: previous, key: selectedStepKey || stepKey(previous) });
        }
        taskId = task.id;
        currentTask = task;
        const saved = selectionByTask.get(task.id);
        selected = saved?.selected ?? 0;
        selectedStep = saved?.step ?? null;
        selectedStepKey = saved?.key ?? "";
        if (saved?.step) {
          const byObject = task.stepDetails.indexOf(saved.step);
          const byKey = task.stepDetails.findIndex((step) => stepKey(step) === saved.key);
          if (byObject >= 0) selected = byObject;
          else if (byKey >= 0) selected = byKey;
        }
        picked = saved?.picked ?? false;
        railKey = "";
        const oldBody = viewer.querySelector<HTMLElement>(".diff-body");
        if (oldBody && viewKey) scrollByStep.set(viewKey, oldBody.scrollTop);
        viewKey = "";
        approvalKey = "";
      }
      whoDot.style.background = task.color;
      whoName.textContent = task.id === "integration_claude" ? "VS Code" : task.name;
      provider.textContent = task.id === "integration_claude" ? "Claude Code" : agentMeta(task.id.slice("agent_".length)).name;
      modelChip.textContent = task.model ?? "";
      modelChip.style.display = task.model ? "" : "none";
      thinkChip.textContent = task.thinking ?? "";
      thinkChip.style.display = task.thinking ? "" : "none";
      const progress =
        task.steps.length > 1 ? `${Math.min(task.stepIndex + 1, task.steps.length)}/${task.steps.length}` : "";
      whoCount.textContent = progress;
      whoCount.style.display = progress ? "" : "none";
      thought.sync(task.state, undefined, focusChanged);

      // Rail — rebuilt only when the step set changes; the selected chip is
      // the newest step until the user clicks one.
      const key = `${task.state}|${task.steps.map((label, i) => stepKey(task.stepDetails[i] ?? { label, tool: "" })).join("|")}`;
      if (key !== railKey) {
        railKey = key;
        clear(rail);
        task.steps.forEach((_, i) => {
          const detail = stepAt(task, i);
          rail.append(h("button", {
            class: `step-chip step-chip--${stepKind(detail)}`,
            title: detail.label,
            onclick: () => {
              picked = true;
              selected = i;
              selectedStep = detail;
              selectedStepKey = stepKey(detail);
              selectionByTask.set(task.id, { selected, picked, step: detail, key: stepKey(detail) });
              syncRail();
              renderViewer(task, i);
            },
          },
            stepKindIcon(stepKind(detail)),
            h("span", { class: "step-chip-label", text: detail.label }),
          ));
        });
        if (task.state === "finished") {
          rail.append(h("span", { class: "step-status done", "aria-label": "Done" }, svg(ICONS.check, 9), h("span", { text: "Done" })));
        }
      }
      if (picked && selectedStep) {
        const byObject = task.stepDetails.indexOf(selectedStep);
        const byKey = task.stepDetails.findIndex((step) => stepKey(step) === selectedStepKey);
        if (byObject >= 0) selected = byObject;
        else if (byKey >= 0) selected = byKey;
      } else if (!picked) {
        selected = Math.min(task.stepIndex, Math.max(0, task.steps.length - 1));
      }
      selected = Math.max(0, Math.min(selected, Math.max(0, task.steps.length - 1)));
      const currentStep = task.steps.length > 0 ? stepAt(task, selected) : null;
      selectedStep = currentStep;
      selectedStepKey = currentStep ? stepKey(currentStep) : "";
      stepPreview.textContent = currentStep?.label ?? "Waiting for the first step…";
      stepPreview.title = stepPreview.textContent;
      syncRail();
      if (task.steps.length > 0) renderViewer(task, selected);
      else {
        viewKey = "";
        clear(viewer);
        viewer.append(h("div", { class: "step-plain" }, h("span", { class: "step-plain-label", text: "Waiting for the first step…" })));
      }

      // Inline approval — real Allow/Deny when the agent can receive one.
      const pending = State.pendingApproval;
      const mine = pending != null && pending.taskId === task.id;
      const allows = taskAllowsApproval(task);
      const aKey = `${pending?.requestId ?? ""}|${allows}`;
      approval.style.display = mine ? "block" : "none";
      el.classList.toggle("has-approval", mine);
      if (mine && aKey !== approvalKey) {
        approvalKey = aKey;
        approvalCmd.textContent = pending.command || pending.tool;
        clear(approvalNote);
        clear(approvalRow);
        if (allows) {
          approvalNote.style.display = "none";
          approvalRow.append(
            btn("Deny", "secondary", () => actions.decide("deny"), "N"),
            btn("Allow", "primary", () => actions.decide("allow"), "Y"),
          );
        } else {
          // OpenCode's plugin API cannot return a decision — say so instead of
          // offering buttons that would do nothing.
          approvalNote.style.display = "";
          approvalNote.textContent = "Handled in OpenCode's terminal.";
        }
      }
    },
  };
}

function buildOverview(actions: ViewActions): ViewHost {
  const session = createSessionView(actions);
  const leftBody = h("div", { class: "left-body" });
  const jump = h(
    "button",
    { class: "icon-btn jump", "aria-label": "Open", title: "Open", onclick: () => actions.openTarget() },
    svg(ICONS.arrowUpRight, 8),
  );
  const collapse = h("button", {
    class: "agent-collapse",
    type: "button",
    text: "Back to agents",
    onclick: () => actions.setAgentExpanded(false),
  });
  const left = card(null, leftBody, jump, collapse);
  const pills = h("div", { class: "pills agent-pills" });
  const right = card(null, pills);

  const el = h("div", { class: "view overview" },
    h("div", { class: "left" }, left),
    h("div", { class: "right" }, right),
  );

  left.addEventListener("click", (event) => {
    if (State.agentExpanded || !State.focusTask || !isAgentTask(State.focusTask)) return;
    if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select")) return;
    actions.setAgentExpanded(true);
  });

  let pillIds = "";
  let detailOpen = false;
  let lastFocus: string | null = null;
  let mode: "session" | "card" | null = null;
  let cardKey = "";
  let wasExpanded = false;

  const hooks: IntegrationCardHooks = {
    get detailOpen() {
      return detailOpen;
    },
    openDetail() {
      detailOpen = true;
      cardKey = "";
      State.notify();
    },
    closeDetail() {
      detailOpen = false;
      cardKey = "";
      State.notify();
    },
    openSettings: () => actions.openSettingsWindow(),
  };

  return {
    el,
    tick(nowMs: number) {
      if (mode !== "session") return;
      session.tick(nowMs);
    },
    sync() {
      const task = State.focusTask;
      const focusChanged = task?.id !== lastFocus;
      if (focusChanged) {
        lastFocus = task?.id ?? null;
        detailOpen = false;
        cardKey = "";
        mode = null;
      }

      // Every agent session (VS Code, Hermes, OpenCode, …) gets the session
      // view — steps, diffs, model, inline approval. Everything else keeps
      // its own card, exactly like IntegrationCardView.
      const sessionActive =
        task != null &&
        isAgentTask(task);

      if (task && sessionActive) {
        if (mode !== "session") {
          clear(leftBody);
          leftBody.append(session.el);
          mode = "session";
          cardKey = "";
        }
        session.update(task);
      } else if (task) {
        const info = State.integrations[task.id];
        const key = [
          task.id, detailOpen, task.state, task.steps.join("|"),
          info?.loaded, info?.error, info?.configured,
          JSON.stringify(info?.data ?? {}),
        ].join("~");
        if (key !== cardKey) {
          cardKey = key;
          mode = "card";
          clear(leftBody);
          leftBody.append(renderIntegrationCard(task, hooks));
        }
      }

      jump.style.display = detailOpen ? "none" : "";

      el.classList.toggle("agent-detail", State.agentExpanded);
      el.classList.toggle("agent-carousel", !State.agentExpanded);
      collapse.style.display = State.agentExpanded ? "" : "none";
      if (State.agentExpanded !== wasExpanded) {
        if (sessionActive) {
          if (State.agentExpanded) collapse.focus({ preventScroll: true });
          else if (el.contains(document.activeElement)) session.el.querySelector<HTMLElement>(".session-expand")?.focus({ preventScroll: true });
        }
        wasExpanded = State.agentExpanded;
      }

      // The carousel is intentionally an agent switcher, not an integrations
      // catalog: VS Code, OpenCode and Hermes are the only standing pills.
      const others = carouselAgents(State.tasks, State.focusId);
      const pillKey = `${State.focusId}|${others.map((t) => `${t.id}:${t.pillBadge ?? ""}`).join("|")}`;
      if (pillKey !== pillIds) {
        pillIds = pillKey;
        clear(pills);
        for (const t of others) pills.append(buildPill(t, actions));
        pruneMiniBots();
      }
    },
  };
}

function buildPill(task: AgentTask, actions: ViewActions): HTMLElement {
  const label = task.id === "integration_claude" ? "VS Code" : task.name;
  const canvas = createMiniBot(task, 24);
  const pill = h(
    "button",
    {
      class: "pill agent-pill",
      type: "button",
      "aria-label": `Expand ${label} agent session`,
      "aria-current": State.focusId === task.id ? "true" : "false",
      onclick: () => {
        actions.setFocus(task.id);
        actions.setAgentExpanded(true);
      },
    },
    canvas,
    h("span", { class: "lbl", text: label }),
  );
  pill.style.borderColor = `${task.color}24`;
  pill.addEventListener("mouseenter", () => {
    pill.style.background = `${task.color}2e`;
    pill.style.borderColor = `${task.color}8c`;
    pill.style.boxShadow = `0 2px 10px ${task.color}59`;
    (pill.querySelector(".lbl") as HTMLElement).style.color = lighten(task.color, 0.3);
  });
  pill.addEventListener("mouseleave", () => {
    pill.style.background = "";
    pill.style.borderColor = `${task.color}24`;
    pill.style.boxShadow = "";
    (pill.querySelector(".lbl") as HTMLElement).style.color = "";
  });

  if (task.pillBadge) {
    const colors = { approval: "#F5A524", finished: "#22C55E", error: "#F4505E" } as const;
    const icons = { approval: ICONS.bang, finished: ICONS.check, error: ICONS.xmark } as const;
    const inner = h("i", { style: `background:${colors[task.pillBadge]}` }, svg(icons[task.pillBadge], 6, { stroke: task.pillBadge === "finished" ? 3 : 0 }));
    const badge = h("div", { class: "pill-badge" }, inner);
    badge.style.boxShadow = `0 0 4px ${colors[task.pillBadge]}99`;
    pill.append(badge);
  }
  return pill;
}

function lighten(hex: string, amount: number): string {
  const v = parseInt(hex.replace("#", ""), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) =>
    Math.min(255, Math.round(x + amount * 255)),
  );
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ── Empty ─────────────────────────────────────────────────────────────────────

function buildEmpty(actions: ViewActions): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: `padding:0 18px 0 ${PIP_SAFE_INSET}px;flex-direction:row;align-items:center;gap:16px` },
    h(
      "div",
      { style: "display:flex;flex-direction:column;gap:5px" },
      h("div", { class: "title", text: "Nothing running right now." }),
      h("div", { class: "sub", text: "Drop a file or window, or ask me anything." }),
    ),
    h("div", { class: "grow" }),
    btn("Ask Claude", "primary", () => actions.setView("prompt")),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── Approval ──────────────────────────────────────────────────────────────────

function buildApproval(actions: ViewActions): ViewHost {
  const who = h("div");
  const code = h("div", { class: "code" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("amber", stack(PIP_SAFE_INSET, 16, who, code, row)));
  let rowKey = "";
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "needs permission"));
      // The whole point of approving here rather than in the terminal: this line
      // is the command, the file path or the URL being authorised, not just the
      // name of the tool asking.
      code.textContent = State.pendingApproval?.command || State.pendingApproval?.tool || "…";
      // Two buttons, built once. Rebuilding them between a mouse-down and a
      // mouse-up would swallow the click, and there is nothing left to vary:
      // "Always" is gone until the remembered-rules list exists to back it.
      if (rowKey === "built") return;
      rowKey = "built";
      clear(row);
      row.append(
        btn("Deny", "secondary", () => actions.decide("deny"), "N"),
        btn("Allow", "primary", () => actions.decide("allow"), "Y"),
      );
    },
  };
}

// ── Question ──────────────────────────────────────────────────────────────────

function buildQuestion(): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("cyan", stack(PIP_SAFE_INSET, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "Claude Code is asking a question"));
      const task = State.focusTask;
      title.textContent = task?.steps.at(-1) ?? "Claude needs an answer.";
      clear(row);
      row.append(h("div", { class: "sub", text: "Answer in your terminal — Coucou can't reply for you yet." }));
    },
  };
}

// ── Error ─────────────────────────────────────────────────────────────────────

function buildError(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title", text: "Workflow stopped." });
  const detail = h("div", { class: "detail" });
  const row = h("div", { class: "actions" },
    btn("Retry", "primary", () => actions.setView(State.defaultView())),
  );
  const el = h("div", { class: "view" }, card("red", stack(PIP_SAFE_INSET, 16, who, title, detail, row)));
  return {
    el,
    sync() {
      const task = State.focusTask;
      clear(who);
      who.append(agentWho(task, task?.source === "n8n" ? "n8n" : "Claude Code"));
      title.textContent = task?.source === "n8n" ? "Workflow stopped." : "Session stopped on an error.";
      detail.textContent = task?.steps.at(-1) ?? "No detail available.";
    },
  };
}

// ── Finished ──────────────────────────────────────────────────────────────────

function buildFinished(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const row = h("div", { class: "actions" },
    btn("Open terminal", "primary", () => actions.openTerminal()),
    btn("OK", "secondary", () => actions.collapse()),
  );
  const el = h("div", { class: "view" }, card("green", stack(PIP_SAFE_INSET, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "Claude Code finished"));
      title.textContent = State.focusTask?.steps.at(-1) ?? "Session finished";
    },
  };
}

// ── Confused ──────────────────────────────────────────────────────────────────

function buildConfused(): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 128px" },
    h("div", { class: "title", text: "Too many hits at once." }),
    h("div", { class: "sub", text: "Give me a sec — back to work in three seconds." }),
  );
  return { el: h("div", { class: "view" }, card("pink", body)), sync() {} };
}

// ── Note ──────────────────────────────────────────────────────────────────────

function buildNote(): ViewHost {
  const title = h("div", { class: "title" });
  const el = h("div", { class: "view" }, card(null, h("div", { class: "stack", style: "padding:0 18px 0 98px" }, title)));
  return {
    el,
    sync() {
      title.textContent = State.noteMessage ?? "";
    },
  };
}

// ── In-island settings ────────────────────────────────────────────────────────

function buildSettings(actions: ViewActions): ViewHost {
  const soundSwitch = h("button", { class: "switch", role: "switch", "aria-label": "Sound", "aria-checked": String(State.settings.soundEnabled), onclick: () => actions.toggleSound() });
  squishSwitch(soundSwitch as HTMLButtonElement);
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005", "aria-label": "Sound volume",
    oninput: (e: Event) => actions.setVolume(Number((e.target as HTMLInputElement).value)),
  }) as HTMLInputElement;
  const autoLabel = h("span", {});
  const segButtons = [10, 15, 30].map((s) =>
    h("button", { onclick: () => actions.setAutoClose(s) }, `${s}s`),
  );
  const claudeBadge = h("span", { class: "status-badge" });
  const apiBadge = h("span", { class: "status-badge" });

  const rows = h(
    "div",
    { class: "settings-rows" },
    h("div", { class: "settings-row" }, soundSwitch, h("span", { text: "Sound" }), volume),
    h(
      "div",
      { class: "settings-row" },
      svg(ICONS.timer, 12),
      autoLabel,
      h("div", { class: "seg" }, ...segButtons),
    ),
    h(
      "div",
      { class: "settings-row", style: "gap:14px" },
      claudeBadge,
      apiBadge,
      h("div", { class: "grow" }),
      h("button", {
        class: "link-btn",
        style: "color:#8e939c;font-size:11.5px",
        text: "Settings…",
        onclick: () => actions.openSettingsWindow(),
      }),
    ),
  );

  const el = h("div", { class: "view" },
    card(null, h("div", { class: "stack", style: "padding:14px 16px 14px 84px" }, rows)));

  return {
    el,
    sync() {
      const s = State.settings;
      soundSwitch.classList.toggle("on", s.soundEnabled);
      soundSwitch.setAttribute("aria-checked", String(s.soundEnabled));
      volume.value = String(s.soundVolume);
      volume.style.opacity = s.soundEnabled ? "1" : "0.4";
      autoLabel.textContent = `Auto-close · ${Math.round(s.autoCloseInterval)}s`;
      segButtons.forEach((b, i) => b.classList.toggle("on", s.autoCloseInterval === [10, 15, 30][i]));
      clear(claudeBadge);
      claudeBadge.append(
        dot(s.hooksInstalled ? "#22C55E" : "#F4505E", 6),
        h("span", { text: "Claude Code" }),
      );
      clear(apiBadge);
      apiBadge.append(dot("#8E939C", 6), h("span", { text: "API unavailable" }));
    },
  };
}

// ── Placeholders filled in later stages ───────────────────────────────────────

function buildPlaceholder(title: string, sub: string): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: `padding:0 18px 0 ${PIP_SAFE_INSET}px` },
    h("div", { class: "title", text: title }),
    h("div", { class: "sub", text: sub }),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── New view stubs (filled in by later tasks) ────────────────────────────────

function buildDashboardView(): ViewHost {
  const mediaWidget = h("button", { class: "widget stagger", type: "button", style: "--i:0", onclick: () => State.setView("media") },
    h("div", { class: "widget-title" }, "Media"));
  const mediaBody = h("div", { class: "widget-media" });
  const mediaEmpty = h("div", { class: "widget-empty" }, "No media playing");
  mediaWidget.append(mediaBody, mediaEmpty);
  const art = h("img", { class: "widget-album-art" });
  const mediaText = h("div");
  mediaBody.append(art, mediaText);

  const statsWidget = h("button", { class: "widget stagger", type: "button", style: "--i:1", onclick: () => State.setView("stats") },
    h("div", { class: "widget-title" }, "Stats"));
  const statsValue = h("div", { class: "widget-value" });
  statsWidget.append(statsValue);

  const timerWidget = h("button", { class: "widget stagger", type: "button", style: "--i:2", onclick: () => State.setView(State.timer.mode === "stopwatch" ? "stopwatch" : "pomodoro") },
    h("div", { class: "widget-title" }, "Timer"));
  const timerValue = h("div", { class: "widget-value" });
  timerWidget.append(timerValue);

  const weatherWidget = h("button", { class: "widget stagger", type: "button", style: "--i:3", onclick: () => State.setView("weather") },
    h("div", { class: "widget-title" }, "Weather"));
  const weatherValue = h("div", { class: "widget-value" });
  const weatherEmpty = h("div", { class: "widget-empty" });
  weatherWidget.append(weatherValue, weatherEmpty);

  const batteryWidget = h("button", { class: "widget stagger", type: "button", style: "--i:4", onclick: () => State.setView("controlCenter") },
    h("div", { class: "widget-title" }, "Battery"));
  // The widget sits on the number in place of the old "NN%" text: the glyph
  // reads at a glance, the tier colour carries the warning.
  const batteryIcon = createBatteryIcon({ width: 30 });
  const batteryValue = h("div", { class: "widget-value widget-battery" }, batteryIcon.el);
  batteryWidget.append(batteryValue);

  const btWidget = h("button", { class: "widget stagger", type: "button", style: "--i:5", onclick: () => State.setView("bluetooth") },
    h("div", { class: "widget-title" }, "Bluetooth"));
  const btValue = h("div", { class: "widget-value" });
  const btEmpty = h("div", { class: "widget-empty" }, "No devices");
  btWidget.append(btValue, btEmpty);

  const el = h("div", { class: "view" },
    h("div", { class: "dashboard-grid" },
      mediaWidget, statsWidget, timerWidget, weatherWidget, batteryWidget, btWidget));

  let mediaKey = "";
  return {
    el,
    sync() {
      const m = State.media;
      mediaBody.style.display = m ? "" : "none";
      mediaEmpty.style.display = m ? "none" : "";
      if (m) {
        const key = `${safeText(m.track)}|${safeText(m.artist)}|${m.albumArt}`;
        if (key !== mediaKey) {
          mediaKey = key;
          art.src = m.albumArt;
          art.style.display = m.albumArt ? "" : "none";
          mediaText.replaceChildren(safeText(m.track), h("br"), safeText(m.artist));
        }
      }
      const s = State.stats;
      statsValue.textContent = `CPU ${Math.round(s.cpu)}% · RAM ${Math.round(s.ram)}%`;
      const t = State.timer;
      const label = t.mode.charAt(0).toUpperCase() + t.mode.slice(1);
      timerValue.textContent = `${label} · ${pad2(t.remaining / 60)}:${pad2(t.remaining % 60)}`;
      const w = State.weather;
      const hasW = w.condition && w.condition !== "Unavailable";
      weatherValue.style.display = hasW ? "" : "none";
      weatherEmpty.style.display = hasW ? "none" : "";
      if (hasW) weatherValue.textContent = `${safeText(w.temp)}° ${safeText(w.condition)}`;
      else weatherEmpty.textContent = w.condition ? "Weather unavailable" : "No weather data";
      const b = State.battery;
      batteryIcon.set(b.level, b.charging);
      const devices = State.bluetooth.devices;
      const any = devices.length > 0;
      btValue.style.display = any ? "" : "none";
      btEmpty.style.display = any ? "none" : "";
      if (any) btValue.textContent = `${devices.filter((d) => d.connected).length}/${devices.length} connected`;
    },
  };
}

function buildMediaView(): ViewHost {
  const empty = h("div", { class: "view-media-empty" }, "No media playing");
  const art = h("img", { class: "media-album-art", alt: "" });
  const artWrap = h("div", { class: "media-art-wrap" }, art);
  const track = h("div", { class: "media-track" });
  const artist = h("div", { class: "media-artist" });
  const fill = h("div", { class: "media-progress-fill" });
  const knob = h("div", { class: "media-progress-knob" });
  const bar = h("div", { class: "media-progress", role: "slider", tabindex: "0", "aria-label": "Media position", "aria-valuemin": "0", "aria-valuemax": "0", "aria-valuenow": "0" }, fill, knob);

  // ── Apple now-playing transport: flat solid glyphs on the card ────────────
  // The reference layout: track + artist with a speaker button top-right, and
  // a wide row of transport glyphs where the play/pause is the large anchor.
  // Each button is a real <button> so hover, :active and keyboard focus are
  // free; the icon is swapped in place (never rebuilt) so the press spring is
  // not interrupted mid-gesture.
  const prevBtn = h("button", { class: "mc-btn", "aria-label": "Previous", title: "Previous", onclick: () => void Bridge.mediaPrev() },
    svg(ICONS.mediaPrev, 20));
  const playBtn = h("button", { class: "mc-btn mc-play", "aria-label": "Play", title: "Play", onclick: () => void Bridge.mediaPlayPause() },
    svg(ICONS.mediaPlay, 27));
  const nextBtn = h("button", { class: "mc-btn", "aria-label": "Next", title: "Next", onclick: () => void Bridge.mediaNext() },
    svg(ICONS.mediaNext, 20));

  let lastMuted: boolean | null = null;
  const volBtn = h("button", {
    class: "mc-vol",
    "aria-label": State.volume.muted ? "Unmute" : "Mute",
    "aria-pressed": String(State.volume.muted),
    title: State.volume.muted ? "Unmute" : "Mute",
    onclick: () => {
      react("mute-flash");
      void Bridge.toggleMute();
    },
  }, svg(ICONS.mediaVolume, 15));

  const time = h("span", { class: "media-time" });
  const controls = h("div", { class: "media-controls" }, prevBtn, playBtn, nextBtn);
  const player = h("div", { class: "view-media" },
    artWrap,
    h("div", { class: "media-info" },
      h("div", { class: "media-head" },
        h("div", { class: "media-titles" }, track, artist),
        volBtn,
      ),
      h("div", { class: "media-progress-row" }, bar, time),
      controls,
    ),
  );
  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  let pendingPosition: number | null = null;
  let dragging = false;
  const paintPosition = (position: number, duration: number) => {
    const bounded = Math.max(0, Math.min(duration, position));
    const frac = clamp01(duration > 0 ? bounded / duration : 0);
    fill.style.transform = `scaleX(${frac})`;
    knob.style.left = `${frac * 100}%`;
    bar.style.setProperty("--seek", `${frac * 100}%`);
    bar.setAttribute("aria-valuenow", String(bounded));
    bar.setAttribute("aria-valuetext", `${fmt(bounded)} of ${fmt(duration)}`);
  };
  const seek = (position: number) => {
    const m = State.media;
    if (!m || m.duration <= 0) return;
    pendingPosition = Math.max(0, Math.min(m.duration, position));
    paintPosition(pendingPosition, m.duration);
    void Bridge.mediaSeek(pendingPosition);
  };
  const seekFromPointer = (clientX: number) => {
    const m = State.media;
    if (!m || m.duration <= 0) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    seek((clientX - rect.left) / rect.width * m.duration);
  };
  bar.addEventListener("pointerdown", (e) => {
    if (!State.media || State.media.duration <= 0) return;
    dragging = true;
    bar.setPointerCapture?.(e.pointerId);
    seekFromPointer(e.clientX);
    e.preventDefault();
  });
  bar.addEventListener("pointermove", (e) => {
    if (dragging) seekFromPointer(e.clientX);
  });
  const endDrag = () => { dragging = false; };
  bar.addEventListener("pointerup", endDrag);
  bar.addEventListener("pointercancel", endDrag);
  // Pointer and keyboard use the same bounded media_seek path.
  bar.addEventListener("click", (ev) => {
    const m = State.media;
    if (!m || !m.duration) return;
    const rect = bar.getBoundingClientRect();
    if (rect.width <= 0) return;
    seek((ev.clientX - rect.left) / rect.width * m.duration);
  });
  bar.addEventListener("keydown", (e) => {
    const m = State.media;
    if (!m || m.duration <= 0) return;
    let next = pendingPosition ?? m.position;
    switch (e.key) {
      case "ArrowRight": case "ArrowUp": next += 5; break;
      case "ArrowLeft": case "ArrowDown": next -= 5; break;
      case "PageUp": next += m.duration * 0.1; break;
      case "PageDown": next -= m.duration * 0.1; break;
      case "Home": next = 0; break;
      case "End": next = m.duration; break;
      default: return;
    }
    e.preventDefault();
    e.stopPropagation();
    seek(next);
  });
  const el = h("div", { class: "view" }, player, empty);
  player.style.display = "none";

  let lastArt = "";
  let lastPlaying = false;
  let lastTrackKey = "";
  return {
    el,
    sync() {
      const m = State.media;
      empty.style.display = m ? "none" : "block";
      player.style.display = m ? "flex" : "none";
      bar.setAttribute("aria-disabled", String(!m || m.duration <= 0));
      bar.setAttribute("tabindex", m && m.duration > 0 ? "0" : "-1");
      if (!m) {
        pendingPosition = null;
        return;
      }
      if (m.duration <= 0) pendingPosition = null;
      else if (pendingPosition !== null && Math.abs(m.position - pendingPosition) < 0.5) pendingPosition = null;
      const position = m.duration > 0 ? pendingPosition ?? m.position : 0;
      // Art only rides track changes — never blank it on a 1 Hz tick. The swap
      // cross-fades so a new cover glides in instead of popping.
      if (m.albumArt && m.albumArt !== lastArt) {
        lastArt = m.albumArt;
        art.classList.remove("art-in");
        art.src = m.albumArt;
        void art.offsetWidth;
        art.classList.add("art-in");
      }
      artWrap.style.display = m.albumArt ? "" : "none";
      const trackKey = `${safeText(m.track)}|${safeText(m.artist)}`;
      if (trackKey !== lastTrackKey) {
        lastTrackKey = trackKey;
        track.textContent = safeText(m.track);
        artist.textContent = safeText(m.artist);
        track.classList.remove("tick");
        void track.offsetWidth;
        track.classList.add("tick");
      }
      paintPosition(position, m.duration);
      bar.setAttribute("aria-valuemax", String(Math.max(0, m.duration)));
      time.textContent = m.duration
        ? `${fmt(position)} / ${fmt(m.duration)}`
        : "";
      if (m.playing !== lastPlaying) {
        lastPlaying = m.playing;
        playBtn.replaceChildren(svg(m.playing ? ICONS.mediaPause : ICONS.mediaPlay, 27));
        playBtn.title = m.playing ? "Pause" : "Play";
        playBtn.setAttribute("aria-label", m.playing ? "Pause" : "Play");
        playBtn.classList.toggle("playing", m.playing);
      }
      if (State.volume.muted !== lastMuted) {
        lastMuted = State.volume.muted;
        volBtn.replaceChildren(svg(lastMuted ? ICONS.speakerOff : ICONS.mediaVolume, 15));
        volBtn.title = lastMuted ? "Unmute" : "Mute";
        volBtn.setAttribute("aria-label", lastMuted ? "Unmute" : "Mute");
        volBtn.setAttribute("aria-pressed", String(lastMuted));
      }
    },
  };
}
// ── Control center ───────────────────────────────────────────────────────────

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function buildControlCenter(): ViewHost {
  /** Drag (pointerdown/move) + scroll wheel. Writes State locally right away,
   *  invokes the command debounced — the PS worker costs 1-3 s to spawn. */
  const makeSlider = (label: string, write: (v: number) => void, commit: (v: number) => void, flash: (v: number) => void) => {
    const fill = h("div", { class: "cc-slider-fill" });
    const knob = h("div", { class: "cc-slider-knob", "aria-hidden": "true" });
    const track = h("div", { class: "cc-slider", role: "slider", tabindex: "0", "aria-label": label, "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0" }, fill, knob);
    const valueEl = h("span", { class: "cc-value", "aria-hidden": "true" });
    let dragging = false;
    let trackRect: DOMRect | null = null;
    let timer = 0;
    let value = 0;
    let readoutTimer = 0;

    const at = (clientX: number) => {
      const r = trackRect ?? track.getBoundingClientRect();
      return r.width > 0 ? clamp01((clientX - r.left) / r.width) : value;
    };
    const place = (v: number) => {
      fill.style.transform = `scaleX(${v})`;
      const w = track.clientWidth - 14;
      knob.style.left = `${7 + v * Math.max(0, w)}px`;
      track.setAttribute("aria-valuenow", String(Math.round(v * 100)));
      track.setAttribute("aria-valuetext", `${Math.round(v * 100)}%`);
    };
    // Emil: no decoration without feedback purpose — the readout only flashes
    // on interaction (apply/wheel), never on external sync() or seed-on-open.
    const showReadout = () => {
      valueEl.textContent = Math.round(value * 100) + "%";
      valueEl.dataset.on = "";
      window.clearTimeout(readoutTimer);
      readoutTimer = window.setTimeout(() => valueEl.removeAttribute("data-on"), 600);
    };
    const apply = (v: number, flush = false) => {
      value = clamp01(v);
      write(value);
      place(value);
      showReadout();
      // Task 4: the slider flash rides the same interaction-only seam as the
      // readout — never on external sync() (a FN-key change stays silent).
      flash(value);
      window.clearTimeout(timer);
      if (flush) commit(value);
      else timer = window.setTimeout(() => commit(value), 150);
    };

    track.addEventListener("pointerdown", (e) => {
      track.focus();
      dragging = true;
      trackRect = track.getBoundingClientRect();
      track.classList.add("dragging");
      track.setPointerCapture(e.pointerId);
      apply(at(e.clientX));
    });
    track.addEventListener("pointermove", (e) => {
      if (dragging) apply(at(e.clientX));
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      trackRect = null;
      track.classList.remove("dragging");
      apply(value, true);
    };
    track.addEventListener("pointerup", end);
    track.addEventListener("pointercancel", end);
    track.addEventListener("keydown", (e) => {
      let next = value;
      switch (e.key) {
        case "ArrowRight": case "ArrowUp": next += 0.01; break;
        case "ArrowLeft": case "ArrowDown": next -= 0.01; break;
        case "PageUp": next += 0.1; break;
        case "PageDown": next -= 0.1; break;
        case "Home": next = 0; break;
        case "End": next = 1; break;
        default: return;
      }
      e.preventDefault();
      e.stopPropagation();
      apply(next);
    });
    track.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        apply(value + (e.deltaY < 0 ? 0.05 : -0.05));
      },
      { passive: false },
    );

    return {
      el: track,
      valueEl,
      sync(v: number) {
        if (dragging) return; // the drag owns the fill until pointerup
        value = clamp01(v);
        place(value);
        // keep a mid-fade readout truthful, but never flash one from sync()
        if (valueEl.hasAttribute("data-on")) valueEl.textContent = Math.round(value * 100) + "%";
      },
    };
  };

  const volume = makeSlider(
    "Volume",
    (v) => void (State.volume.level = v),
    (v) => void Bridge.setVolume(v),
    (v) => {
      react("volume", { intensity: v });
      // Volume moved while a track is playing: the bus resolves media-loud over
      // the plain volume flash (media-playing condition still owns the pose).
      if (State.media?.playing) react("media-loud");
    },
  );
  const brightness = makeSlider(
    "Brightness",
    (v) => void (State.brightness.level = v),
    (v) => void Bridge.setBrightness(v),
    (v) => react("brightness", { intensity: v }),
  );

  let lastMuted: boolean | null = null;
  const muteBtn = h(
    "button",
    {
      class: "cc-icon-btn",
      "aria-label": State.volume.muted ? "Unmute" : "Mute",
      "aria-pressed": String(State.volume.muted),
      title: State.volume.muted ? "Unmute" : "Mute",
      onclick: () => {
        react("mute-flash");
        void Bridge.toggleMute();
      },
    },
    svg(ICONS.mediaVolume, 15),
  );

  /** Icon + label toggle. `onFlip` runs once the worker has answered, so the
   *  button's animation and Pip's reaction land on the same frame. */
  const toggle = (
    label: string,
    run: () => Promise<boolean | null>,
    initialOn: boolean,
    opts: { cls: string; icon: string; onFlip: (on: boolean) => void },
  ) => {
    const btn = h("button", {
      class: `cc-toggle ${opts.cls}${initialOn ? " on" : ""}`,
      "aria-pressed": String(initialOn),
      onclick: async () => {
        const on = await run();
        if (on === null) return;
        btn.classList.toggle("on", on);
        btn.setAttribute("aria-pressed", String(on));
        opts.onFlip(on);
      },
    },
      h("span", { class: "cc-glyph" }, svg(opts.icon, 13)),
      h("span", { text: label }),
    );
    return btn;
  };
  const nightBtn = toggle("Night light", () => Bridge.toggleNightLight(), State.systemControls.nightLight, {
    cls: "night",
    icon: ICONS.sunMax,
    onFlip: (on) => {
      State.systemControls.nightLight = on;
      react(on ? "night-light-on" : "night-light-off");
    },
  });
  const dndBtn = toggle("Do not disturb", () => Bridge.toggleDnd(), State.systemControls.dnd, {
    cls: "dnd",
    icon: ICONS.moon,
    // Pip dozes while it's on — the engine floats z's from the sleep pose —
    // and blinks awake on the flip off.
    onFlip: (on) => {
      State.systemControls.dnd = on;
      setCondition("dnd-sleep", on);
      if (!on) react("dnd-wake");
    },
  });

  const note = h("span", { class: "cc-note" });
  let noteTimer = 0;
  const boostBtn = h("button", {
    class: "cc-toggle boost",
    onclick: async () => {
      if (boostBtn.disabled) return;
      boostBtn.disabled = true;
      boostBtn.classList.add("boosting");
      window.clearTimeout(noteTimer);
      note.textContent = "…";
      react("memory-freeing");
      const freed = await Bridge.memoryBoost();
      boostBtn.disabled = false;
      boostBtn.classList.remove("boosting");
      if (freed === null) {
        note.textContent = "Failed";
        react("session-error");
      } else {
        note.textContent = `${freed} MB freed`;
        react("memory-freed");
      }
      noteTimer = window.setTimeout(() => void (note.textContent = ""), 3000);
    },
  },
    h("span", { class: "cc-glyph" }, svg(ICONS.sparkle, 13)),
    h("span", { text: "Memory boost" }),
  );

  /** FN-key changes emit no events: fetching on open is the only chance to see
   *  them. No polling by design. */
  const seed = () => {
    void Bridge.getVolume().then((v) => {
      if (!v) return;
      State.volume.level = v.level;
      State.volume.muted = v.muted;
      State.notify();
    });
    void Bridge.getBrightness().then((b) => {
      if (!b) return;
      State.brightness.level = b.level;
      State.notify();
    });
  };
  let shown = false;
  State.subscribe(() => {
    const on = State.view === "controlCenter" && State.mode === "expanded";
    if (on && !shown) seed();
    shown = on;
  });

  const el = h("div", { class: "view" },
    h("div", { class: "view-control-center" },
      h("div", { class: "cc-row" },
        h("span", { class: "cc-label", text: "Volume" }),
        volume.el,
        volume.valueEl,
        muteBtn,
      ),
      h("div", { class: "cc-row" },
        h("span", { class: "cc-label", text: "Brightness" }),
        brightness.el,
        brightness.valueEl,
      ),
      h("div", { class: "cc-row" }, nightBtn, dndBtn, boostBtn, note),
    ),
  );

  return {
    el,
    sync() {
      volume.sync(State.volume.level);
      brightness.sync(State.brightness.level);
      nightBtn.classList.toggle("on", State.systemControls.nightLight);
      nightBtn.setAttribute("aria-pressed", String(State.systemControls.nightLight));
      dndBtn.classList.toggle("on", State.systemControls.dnd);
      dndBtn.setAttribute("aria-pressed", String(State.systemControls.dnd));
      if (State.volume.muted !== lastMuted) {
        lastMuted = State.volume.muted;
        muteBtn.replaceChildren(svg(lastMuted ? ICONS.speakerOff : ICONS.mediaVolume, 15));
        muteBtn.title = lastMuted ? "Unmute" : "Mute";
        muteBtn.setAttribute("aria-label", lastMuted ? "Unmute" : "Mute");
        muteBtn.setAttribute("aria-pressed", String(lastMuted));
      }
    },
  };
}
// ── Bluetooth ────────────────────────────────────────────────────────────────

/** Glyph per get_bt_devices `type`; "" falls back to a neutral dot. */
const BT_ICONS: Record<string, string> = {
  headphones: "🎧",
  speaker: "🔊",
  keyboard: "⌨️",
  mouse: "🖱️",
  gamepad: "🎮",
  phone: "📱",
};

/** The device a connect/disconnect is in flight for — the worker can take ~14 s. */
let btPending = "";
let btError = "";
let btRefreshRequest = 0;

async function toggleBt(id: string, connected: boolean) {
  if (!canStartBluetoothAction(btPending, id)) return;
  btPending = id;
  btError = "";
  State.notify();
  const res = connected ? await Bridge.btDisconnect(id) : await Bridge.btConnect(id);
  btPending = "";
  if (res && !res.ok) btError = res.error ?? "That didn't work.";
  // Success lands through the bt-devices / bt-device-event listeners.
  State.notify();
}

async function seedBluetooth() {
  const request = ++btRefreshRequest;
  const res = await Bridge.getBtDevices();
  if (isCurrentBluetoothRequest(request, btRefreshRequest) && res?.devices) {
    State.bluetooth.devices = res.devices;
    State.notify();
  }
}

/** Seeds on open like the control center: external changes emit no events.
 *  Rows are built once and patched, keyed by stable device id: a rebuild on every
 *  notify would replay the row-in animation every 2 s (system-stats) while the
 *  user is reading the list. */
function buildBluetoothView(): ViewHost {
  let shown = false;
  State.subscribe(() => {
    const on = State.view === "bluetooth" && State.mode === "expanded";
    if (on && !shown) void seedBluetooth();
    shown = on;
  });

  const count = h("span", { class: "bt-count" });
  const error = h("div", { class: "bt-error" });
  const empty = h("div", { class: "bt-empty", text: "No paired devices." });
  const list = h("div");
  const el = h(
    "div",
    { class: "view" },
    h(
      "div",
      { class: "view-bluetooth" },
      h(
        "div",
        { class: "bt-head" },
        count,
        h("button", { class: "bt-refresh", type: "button", text: "Refresh", onclick: () => void seedBluetooth() }),
      ),
      error,
      empty,
      list,
    ),
  );

  /** What the row's button acts on — the current connected flag for that stable id. */
  const connected = new Map<string, boolean>();
  const rows = new Map<
    string,
    {
      el: HTMLElement;
      icon: HTMLElement;
      name: HTMLElement;
      battery: HTMLElement;
      icon3: ReturnType<typeof createBatteryIcon> | null;
      btn: HTMLButtonElement;
    }
  >();
  let key = "";

  const buildRow = (id: string, index: number) => {
    const icon = h("span", { class: "bt-icon" });
    const label = h("span", { class: "bt-name" });
    const battery = h("span", { class: "bt-battery" });
    const btn = h("button", {
      class: "bt-btn",
      onclick: () => void toggleBt(id, connected.get(id) ?? false),
    });
    const row = h(
      "div",
      { class: "bt-device stagger", style: `--i:${index}` },
      icon,
      label,
      battery,
      btn,
    );
    return { el: row, icon, name: label, battery, icon3: null, btn };
  };

  return {
    el,
    sync() {
      const devices = State.bluetooth.devices;
      const next = devices.map((d) => d.id).join("\u0000");
      const changed = next !== key;
      key = next;

      error.style.display = btError ? "" : "none";
      error.textContent = btError;
      empty.style.display = devices.length ? "none" : "";
      count.textContent = devices.length
        ? `${devices.filter((d) => d.connected).length} of ${devices.length} connected`
        : "Paired devices";

      const order: HTMLElement[] = [];
      const alive = new Set<string>();
      devices.forEach((d, i) => {
         alive.add(d.id);
         let row = rows.get(d.id);
         if (row == null) {
           row = buildRow(d.id, i);
           rows.set(d.id, row);
         }
         const pending = btPending === d.id;
        row.icon.textContent = BT_ICONS[d.type] ?? "•";
        row.name.textContent = d.name;
        // A paired device reports its own charge (or −1 when it doesn't): same
        // glyph as the system battery so the whole list reads consistently.
        // Icon-only — the number lives in the glyph's tooltip.
        if (d.battery >= 0) {
          if (row.icon3 == null) {
            row.icon3 = batteryWithLabel(d.battery, false, { width: 22, showPercent: false });
            row.icon3.el.classList.add("bat-sm");
            row.battery.append(row.icon3.el);
          } else {
            row.icon3.set(d.battery, false);
          }
          row.battery.style.display = "";
        } else {
          row.battery.style.display = "none";
          if (row.icon3) row.battery.replaceChildren();
          row.icon3 = null;
        }
        row.el.classList.toggle("on", d.connected);
         row.btn.disabled = !d.can_connect || (btPending !== "" && !pending);
         row.btn.classList.toggle("pending", pending);
         row.btn.title = d.can_connect ? "" : "Windows manages this device's connection";
         row.btn.textContent = !d.can_connect
           ? "Windows manages"
           : pending
           ? d.connected
            ? "Disconnecting…"
            : "Connecting…"
          : d.connected
            ? "Disconnect"
            : "Connect";
         connected.set(d.id, d.connected);
        order.push(row.el);
      });

      if (!changed) return;
       for (const [id, row] of rows) {
         if (!alive.has(id)) {
           row.el.remove();
           rows.delete(id);
           connected.delete(id);
        }
      }
      // Reposition only what actually moved: a row already in place keeps its
      // node, so a newly paired device does not re-animate the whole list.
      order.forEach((node, i) => {
        if (list.children[i] !== node) list.insertBefore(node, list.children[i] ?? null);
      });
    },
  };
}

function buildStatsView(): ViewHost {
  const NET_FULL_SCALE = 10 * 1024 * 1024; // 10 MB/s fills the bar.
  const fmtRate = (bps: number) => {
    if (bps < 1024) return `${Math.round(bps)} B/s`;
    if (bps < 1024 * 1024) return `${Math.round(bps / 1024)} KB/s`;
    if (bps < 1024 * 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
    return `${(bps / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
  };
  const row = (label: string, i: number) => {
    const fill = h("div", { class: "stat-fill" });
    const value = h("span", { class: "stat-value" });
    return {
      fill,
      value,
      el: h("div", { class: "stat-row stagger", style: `--i:${i}` },
        h("span", { class: "stat-label" }, label),
        h("div", { class: "stat-bar" }, fill),
        value),
    };
  };
  const cpu = row("CPU", 0);
  const ram = row("RAM", 1);
  const rx = row("Net ↓", 2);
  const tx = row("Net ↑", 3);
  return {
    el: h("div", { class: "view" },
      h("div", { class: "view-stats" }, cpu.el, ram.el, rx.el, tx.el)),
    sync() {
      const s = State.stats;
      cpu.fill.style.transform = `scaleX(${clamp01(s.cpu / 100)})`;
      cpu.value.textContent = `${s.cpu.toFixed(0)}%`;
      ram.fill.style.transform = `scaleX(${clamp01(s.ram / 100)})`;
      ram.value.textContent = `${s.ram.toFixed(0)}%`;
      rx.fill.style.transform = `scaleX(${clamp01(s.netRx / NET_FULL_SCALE)})`;
      rx.value.textContent = fmtRate(s.netRx);
      tx.fill.style.transform = `scaleX(${clamp01(s.netTx / NET_FULL_SCALE)})`;
      tx.value.textContent = fmtRate(s.netTx);
    },
  };
}
// ── Pomodoro ─────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(Math.floor(n)).padStart(2, "0");

/** Per-character odometer for the pomodoro countdown (Task 6). Slots are keyed
 *  from the right, so the seconds' ones-digit is always the rightmost; only the
 *  characters that actually changed animate (roll-out / roll-in, 400 ms). */
function rollDigits(host: HTMLElement, text: string) {
  const chars = [...text];
  const n = chars.length;
  const slots = Array.from(host.children) as HTMLElement[];
  // A width change (first paint, or minutes going 99 → 100): rebuild plainly.
  if (slots.length !== n) {
    clear(host);
    for (const ch of chars) host.append(h("span", { class: "pom-digit", text: ch }));
    return;
  }
  const reduce = prefersReduced();
  for (let i = n - 1; i >= 0; i--) {
    const slot = slots[i];
    const ch = chars[i];
    const cur = slot.dataset.ch ?? slot.textContent ?? "";
    if (cur === ch) continue;
    slot.dataset.ch = ch;
    if (reduce) {
      slot.textContent = ch; // reduced motion: swap instantly, no spans
      continue;
    }
    slot.replaceChildren(
      h("span", { class: "pom-out", text: cur }),
      h("span", { class: "pom-in", text: ch }),
    );
  }
}

/** Stable hosts (not liveView): the task input must survive the 1 Hz tick. */
function buildPomodoroView(): ViewHost {
  const segFocus = h("button", { text: "Focus", onclick: () => State.timerSetMode("focus") });
  const segBreak = h("button", { text: "Break", onclick: () => State.timerSetMode("break") });
  const roll = h("span", { class: "pom-roll" });
  const display = h("div", { class: "timer-display" }, roll);
  const startPause = btn("Start", "primary", () => State.timerToggle());
  const startLabel = startPause.querySelector("span") as HTMLElement;
  const resetBtn = btn("Reset", "secondary", () => State.timerReset());
  const list = h("div", { class: "task-list" });

  const input = h("input", {
    class: "task-input",
    placeholder: "Add a task…",
    onkeydown: (e: Event) => {
      if ((e as KeyboardEvent).key === "Enter") addTask();
    },
  }) as HTMLInputElement;

  function addTask() {
    const text = input.value.trim();
    if (!text) return;
    State.timer.tasks.push({ text, done: false });
    State.savePomoTasks();
    input.value = "";
    State.notify();
  }

  const el = h(
    "div",
    { class: "view" },
    h(
      "div",
      { class: "view-pomodoro" },
      h("div", { class: "seg" }, segFocus, segBreak),
      display,
      h("div", { class: "timer-controls" }, startPause, resetBtn),
      h(
        "div",
        { class: "task-row" },
        input,
        h("button", { class: "bt-refresh", text: "Add", onclick: addTask }),
      ),
      list,
    ),
  );

  // Rows are built once and patched in place. A full rebuild on every sync
  // (the old `clear(list)` + re-append) restarted the `stagger` row-in *and* the
  // SpringCheck swell on any change at all — toggling one task re-animated the
  // whole list, and the swell was cut off before it could be seen. Only an
  // added, removed or renamed task rebuilds; a mere toggle patches `data-on`.
  const rows: { text: string; el: HTMLElement; check: SpringCheck }[] = [];

  function buildRow(text: string, done: boolean, i: number): HTMLElement {
    const check = createSpringCheck({
      label: text,
      checked: done,
      onChange: (next) => {
        const task = State.timer.tasks.find((x) => x.text === text);
        if (!task) return;
        task.done = next;
        State.savePomoTasks();
        State.notify();
      },
    });
    const swipe = createSwipeRow({
      label: text,
      onCommit: () => {
        const at = State.timer.tasks.findIndex((x) => x.text === text);
        if (at < 0) return;
        State.timer.tasks.splice(at, 1);
        State.savePomoTasks();
        State.notify(); // shape change → list rebuild drops the collapsed row
      },
    });
    swipe.surface.append(
      check.el,
      h("button", {
        class: "task-del",
        "aria-label": `Delete task: ${safeText(text)}`,
        text: "×",
        onclick: () => {
          const at = State.timer.tasks.findIndex((x) => x.text === text);
          if (at < 0) return;
          State.timer.tasks.splice(at, 1);
          State.savePomoTasks();
          State.notify();
        },
      }),
    );
    const el = h(
      "div",
      { class: done ? "task done stagger" : "task stagger", style: `--i:${i}` },
      swipe.el,
    );
    rows.push({ text, el, check });
    return el;
  }

  let tasksKey = "";
  return {
    el,
    sync() {
      const t = State.timer;
      rollDigits(roll, `${pad2(t.remaining / 60)}:${pad2(t.remaining % 60)}`);
      segFocus.classList.toggle("on", t.mode === "focus");
      segBreak.classList.toggle("on", t.mode === "break");
      startLabel.textContent = t.running ? "Pause" : "Start";

      // Text and order are the identity; `done` is state the rows patch themselves.
      const shape = t.tasks.map((x) => x.text).join("\u0000");
      if (shape !== tasksKey) {
        tasksKey = shape;
        clear(list);
        rows.length = 0;
        t.tasks.forEach((task, i) => list.append(buildRow(task.text, task.done, i)));
        return;
      }
      t.tasks.forEach((task, i) => {
        const row = rows[i];
        if (!row) return;
        row.check.set(task.done);
        row.el.classList.toggle("done", task.done);
      });
    },
  };
}

// ── Stopwatch ────────────────────────────────────────────────────────────────

function buildStopwatchView(): ViewHost {
  const display = h("div", { class: "timer-display" });
  const startBtn = btn("Start", "primary", () => State.timerToggle());
  const startLabel = startBtn.querySelector("span") as HTMLElement;
  const el = h("div", { class: "view" },
    h("div", { class: "view-stopwatch" },
      display,
      h("div", { class: "timer-controls" },
        startBtn,
        btn("Reset", "secondary", () => State.timerReset()))));
  return {
    el,
    sync() {
      const t = State.timer;
      display.textContent = `${pad2(t.remaining / 3600)}:${pad2((t.remaining % 3600) / 60)}:${pad2(t.remaining % 60)}`;
      startLabel.textContent = t.running ? "Pause" : "Start";
    },
  };
}
function buildWeatherView(): ViewHost {
  const temp = h("div", { class: "weather-temp" });
  const cond = h("div", { class: "weather-condition" });
  const details = h("div", { class: "weather-details" });
  const full = h("div", { class: "view-weather" }, temp, cond, details);
  const empty = h("div", { class: "view-weather weather-empty" }, "Loading…");
  const el = h("div", { class: "view" }, full, empty);
  full.style.display = "none";
  return {
    el,
    sync() {
      const w = State.weather;
      const has = w.condition && w.condition !== "Unavailable";
      full.style.display = has ? "" : "none";
      empty.style.display = has ? "none" : "";
      if (has) {
        temp.textContent = `${safeText(w.temp)}°`;
        cond.textContent = safeText(w.condition);
        details.replaceChildren(`Humidity: ${safeText(w.humidity)}%`, h("br"), `Wind: ${safeText(w.wind)} km/h`);
      } else {
        empty.textContent = w.condition ? "Weather unavailable" : "Loading…";
      }
    },
  };
}

/** In-island banner strip — clipboard URLs, battery notices. One banner at a
 *  time; State owns the TTL, this view owns Open / dismiss. */
export function buildBanners(): ViewHost {
  const el = h("div", { class: "banners" });
  let key = "";
  let toast: SwipeToast | null = null;
  return {
    el,
    sync() {
      const b = State.banner;
      if (!b) {
        // The banner is gone (dismissed by its own TTL, or replaced) — drop the
        // card and the timers mirroring that deadline with it.
        toast?.destroy();
        toast = null;
        el.replaceChildren();
        el.style.display = "none";
        key = "";
        return;
      }
      const next = `${b.url ?? ""}|${b.text}`;
      if (next === key) return; // already built — no churn on every notify
      key = next;
      el.style.display = "";
      const text = b.url && b.url.length > 48 ? `${b.url.slice(0, 47)}…` : b.text;
      toast?.destroy();
      toast = createSwipeToast({
        title: text,
        actionLabel: b.url ? "Open" : undefined,
        onAction: () => void Bridge.openUrl(b.url!),
        onClose: () => State.dismissBanner(),
        remaining: () => State.bannerRemaining(),
        pause: () => State.pauseBanner(),
        resume: () => State.resumeBanner(),
      });
      el.replaceChildren(toast.el);
    },
  };
}

/** Compact peek bar status: timer > media > battery, right of Mochi, left of
 *  the mini grid. sync() runs on every State.notify(), so the 1 Hz timer tick
 *  and the media/battery events land without any extra plumbing. */
export function buildCompactStatus(): ViewHost {
  const el = h("div", { id: "compact-status" });
  const timer = h("span", { class: "cs-timer" });
  const media = h("span", { class: "cs-media" });
  const battery = h("span", { class: "cs-battery" });
  const batteryIcon = batteryWithLabel(100, false, { width: 22, showPercent: false });
  battery.append(batteryIcon.el);
  el.append(timer, media, battery);
  return {
    el,
    sync() {
      const on = State.mode === "compact";
      el.style.opacity = on ? "1" : "0";
      if (!on) return;
      const t = State.timer;
      timer.style.display = t.running ? "" : "none";
      timer.textContent = `${pad2(t.remaining / 60)}:${pad2(t.remaining % 60)}`;
      const m = State.media;
      media.style.display = m?.playing ? "" : "none";
      media.textContent = m?.playing ? `♪ ${safeText(m.track)}` : "";
      // The compact strip is the narrowest slot: the glyph alone carries the
      // state — tier colour + fill, the number stays in the tooltip.
      const b = State.battery;
      batteryIcon.set(b.level, b.charging);
    },
  };
}

// ── Registry ──────────────────────────────────────────────────────────────────

export function buildViews(
  actions: ViewActions,
  onChatHeightChange: () => void,
): Map<IslandViewName, ViewHost> {
  const map = new Map<IslandViewName, ViewHost>();
  map.set("overview", buildOverview(actions));
  map.set("empty", buildEmpty(actions));
  map.set("approval", buildApproval(actions));
  map.set("question", buildQuestion());
  map.set("error", buildError(actions));
  map.set("finished", buildFinished(actions));
  map.set("confused", buildConfused());
  map.set("note", buildNote());
  map.set("settings", buildSettings(actions));
  map.set("prompt", buildPrompt(onChatHeightChange));
  map.set("upload", buildUpload(actions));
  map.set("uploading", buildUploading());
  map.set("choose", buildChoose(actions));
  // Not in the Windows v1: sending a file by email, window attach + web result.
  map.set("mail", buildPlaceholder("Sending by email isn't in this version.", ""));
  map.set("searching", buildPlaceholder("Claude is searching…", ""));
  map.set("result", buildPlaceholder("Result", ""));
  map.set("dashboard", buildDashboardView());
  map.set("media", buildMediaView());
  map.set("controlCenter", buildControlCenter());
  map.set("bluetooth", buildBluetoothView());
  map.set("stats", buildStatsView());
  map.set("pomodoro", buildPomodoroView());
  map.set("stopwatch", buildStopwatchView());
  map.set("weather", buildWeatherView());
  return map;
}
