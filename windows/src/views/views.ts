// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Ticker } from "./ticker";
import { createThoughtLine } from "../ui/thoughtline";
import { createSpringCheck, type SpringCheck } from "../ui/springcheck";
import { squishSwitch } from "../ui/squishswitch";
import { createSwipeToast, type SwipeToast } from "../ui/swipetoast";
import { attachTabSegment } from "../ui/tabsegment";
import { createSwipeRow } from "../ui/swiperow";
import { Bridge } from "../core/bridge";
import { prefersReduced } from "../core/anim";
import { State, type AgentTask } from "../core/state";
import { washRGBA, type IslandViewName, type ViewGroup, type Wash } from "../core/layout";
import { createMiniBot, pruneMiniBots } from "../mochi/minibots";
import { react } from "../mochi/reactions";
import { buildPrompt } from "./chat";
import { buildChoose, buildUpload, buildUploading } from "./upload";
import { renderIntegrationCard, type IntegrationCardHooks } from "./integrations";

export interface ViewActions {
  setView(v: IslandViewName): void;
  collapse(): void;
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

// ── Tab groups ────────────────────────────────────────────────────────────────

const GROUPS: { id: ViewGroup; label: string; views: IslandViewName[] }[] = [
  { id: "home", label: "Home", views: ["dashboard"] },
  { id: "agents", label: "Agents", views: [
    "overview", "empty", "approval", "question", "error", "finished", "confused",
    "upload", "uploading", "choose", "mail", "prompt", "searching", "result",
    "note", "settings", "greeting",
  ] },
  { id: "media", label: "Media", views: ["media"] },
  { id: "system", label: "System", views: ["controlCenter", "bluetooth", "stats"] },
  { id: "tools", label: "Tools", views: ["pomodoro", "stopwatch", "weather"] },
];

function getViewsForGroup(group: ViewGroup): IslandViewName[] {
  return GROUPS.find((g) => g.id === group)?.views ?? [];
}

function groupOfView(view: IslandViewName): ViewGroup {
  return GROUPS.find((g) => g.views.includes(view))?.id ?? "agents";
}

function viewLabel(view: IslandViewName): string {
  return view
    .replace(/([A-Z])/g, " $1")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Header ────────────────────────────────────────────────────────────────────

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", title: "Overview", onclick: () => go("overview") }, svg(ICONS.house, 13));
  const tabChat = h("button", { class: "tab", title: "Ask", onclick: () => go("prompt") }, svg(ICONS.bubble, 13));
  const tabDrop = h("button", { class: "tab", title: "Drop", onclick: () => go("upload") }, svg(ICONS.plus, 13));

  const gearBtn = h("button", { title: "Settings", onclick: () => go("settings") }, svg(ICONS.gear, 14));
  const soundBtn = h("button", { title: "Mute", onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 14));

  function go(v: IslandViewName) {
    actions.blip();
    actions.setView(v);
  }

  const groupTabs = new Map<ViewGroup, HTMLElement>();
  const groupsEl = h("div", { class: "tab-groups" });
  for (const g of GROUPS) {
    const tab = h("button", {
      class: "tab-group",
      text: g.label,
      onclick: () => {
        actions.blip();
        State.setViewGroup(g.id);
        if (!g.views.includes(State.view)) go(getViewsForGroup(g.id)[0]);
      },
    });
    groupTabs.set(g.id, tab);
    groupsEl.append(tab);
  }
  const setThumb = attachTabSegment(groupsEl);

  const subPills = new Map<IslandViewName, HTMLElement>();
  const pillsEl = h("div", { class: "sub-view-pills" });
  for (const g of GROUPS) {
    if (g.id === "agents") continue;
    for (const v of g.views) {
      const pill = h("button", { class: "sub-view-pill", text: viewLabel(v), onclick: () => go(v) });
      subPills.set(v, pill);
      pillsEl.append(pill);
    }
  }

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs" }, tabHome, tabChat, tabDrop),
    groupsEl,
    pillsEl,
    h("div", { class: "header-actions" }, gearBtn, soundBtn),
  );

  return {
    el,
    sync() {
      const v = State.view;
      tabHome.classList.toggle("on", v === "overview" || v === "empty");
      tabChat.classList.toggle("on", v === "prompt");
      tabDrop.classList.toggle("on", v === "upload");
      gearBtn.classList.toggle("on", v === "settings");
      clear(gearBtn);
      gearBtn.append(svg(v === "settings" ? ICONS.gearFill : ICONS.gear, 14));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 14));
      const group = groupOfView(v);
      for (const [id, tab] of groupTabs) tab.classList.toggle("active", id === group);
      setThumb(groupTabs.get(group)!);
      pillsEl.style.display = group === "agents" ? "none" : "flex";
      // Only the active group's pills: rendering all eight pushed the last
      // four pills and the gear/sound buttons past the island's right edge.
      for (const [pv, pill] of subPills) {
        pill.style.display = groupOfView(pv) === group ? "" : "none";
        pill.classList.toggle("active", pv === v);
      }
      el.style.opacity = v === "confused" ? "0" : "1";
    },
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

function buildOverview(actions: ViewActions): ViewHost {
  const ticker = new Ticker();
  // React Bits' ThoughtLine replaces the static "who · tool" label: the session's
  // state and elapsed time share one line with the agent name. Stable nodes — the
  // line patches itself, so its breath and settle never replay on a notify.
  const thought = createThoughtLine();
  const whoDot = dot("var(--accent)", 7);
  const whoName = h("span", { class: "name" });
  const whoCount = h("span", { class: "count" });
  const who = h("div", { class: "who" }, whoDot, whoName, thought.el, whoCount);
  const tickerBody = h("div", { class: "card-body" }, who, ticker.el);
  const leftBody = h("div", { class: "left-body" });
  const jump = h(
    "button",
    { class: "icon-btn jump", title: "Open", onclick: () => actions.openTarget() },
    svg(ICONS.arrowUpRight, 8),
  );
  const left = card(null, leftBody, jump);
  const pills = h("div", { class: "pills" });
  const right = card(null, pills);

  const el = h("div", { class: "view overview" },
    h("div", { class: "left" }, left),
    h("div", { class: "right" }, right),
  );

  let pillIds = "";
  let detailOpen = false;
  let lastFocus: string | null = null;
  let mode: "ticker" | "card" | null = null;
  let cardKey = "";

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
      if (mode !== "ticker") return;
      ticker.tick(nowMs);
      thought.tick(nowMs);
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

      // VS Code with a live Claude Code session keeps the ticker; every other
      // pill shows its own card, exactly like IntegrationCardView.
      const sessionActive =
        task?.id === "integration_claude" && (task.state !== "idle" || task.steps.length > 0);

      if (task && sessionActive) {
        if (mode !== "ticker") {
          clear(leftBody);
          leftBody.append(tickerBody);
          mode = "ticker";
          cardKey = "";
        }
        whoDot.style.background = task.color;
        whoName.textContent = task.name;
        const progress =
          task.steps.length > 1
            ? `${Math.min(task.stepIndex + 1, task.steps.length)}/${task.steps.length}`
            : "";
        whoCount.textContent = progress;
        whoCount.style.display = progress ? "" : "none";
        thought.sync(task.state, undefined, focusChanged);
        ticker.sync(task);
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

      const others = State.otherTasks.slice(0, 4);
      const pillKey = others.map((t) => `${t.id}:${t.pillBadge ?? ""}`).join("|");
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
    "div",
    { class: "pill", onclick: () => actions.setFocus(task.id) },
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
    { class: "stack", style: "padding:0 18px 0 118px;flex-direction:row;align-items:center;gap:16px" },
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
  const el = h("div", { class: "view" }, card("amber", stack(116, 16, who, code, row)));
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
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, title, row)));
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
    btn("Open in n8n", "secondary", () => actions.openUrl("")),
  );
  const el = h("div", { class: "view" }, card("red", stack(116, 16, who, title, detail, row)));
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
  const el = h("div", { class: "view" }, card("green", stack(116, 16, who, title, row)));
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
  const soundSwitch = h("button", { class: "switch", onclick: () => actions.toggleSound() });
  squishSwitch(soundSwitch as HTMLButtonElement);
  const volume = h("input", {
    type: "range", min: "0", max: "0.2", step: "0.005",
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
      apiBadge.append(dot("#F4505E", 6), h("span", { text: "API" }));
    },
  };
}

// ── Placeholders filled in later stages ───────────────────────────────────────

function buildPlaceholder(title: string, sub: string): ViewHost {
  const body = h(
    "div",
    { class: "stack", style: "padding:0 18px 0 118px" },
    h("div", { class: "title", text: title }),
    h("div", { class: "sub", text: sub }),
  );
  return { el: h("div", { class: "view" }, card(null, body)), sync() {} };
}

// ── New view stubs (filled in by later tasks) ────────────────────────────────

function buildDashboardView(): ViewHost {
  const mediaWidget = h("div", { class: "widget stagger", style: "--i:0", onclick: () => State.setView("media") },
    h("div", { class: "widget-title" }, "Media"));
  const mediaBody = h("div", { class: "widget-media" });
  const mediaEmpty = h("div", { class: "widget-empty" }, "No media playing");
  mediaWidget.append(mediaBody, mediaEmpty);
  const art = h("img", { class: "widget-album-art" });
  const mediaText = h("div");
  mediaBody.append(art, mediaText);

  const statsWidget = h("div", { class: "widget stagger", style: "--i:1", onclick: () => State.setView("stats") },
    h("div", { class: "widget-title" }, "Stats"));
  const statsValue = h("div", { class: "widget-value" });
  statsWidget.append(statsValue);

  const timerWidget = h("div", { class: "widget stagger", style: "--i:2", onclick: () => State.setView(State.timer.mode === "stopwatch" ? "stopwatch" : "pomodoro") },
    h("div", { class: "widget-title" }, "Timer"));
  const timerValue = h("div", { class: "widget-value" });
  timerWidget.append(timerValue);

  const weatherWidget = h("div", { class: "widget stagger", style: "--i:3", onclick: () => State.setView("weather") },
    h("div", { class: "widget-title" }, "Weather"));
  const weatherValue = h("div", { class: "widget-value" });
  const weatherEmpty = h("div", { class: "widget-empty" });
  weatherWidget.append(weatherValue, weatherEmpty);

  const batteryWidget = h("div", { class: "widget stagger", style: "--i:4", onclick: () => State.setView("controlCenter") },
    h("div", { class: "widget-title" }, "Battery"));
  const batteryValue = h("div", { class: "widget-value" });
  batteryWidget.append(batteryValue);

  const btWidget = h("div", { class: "widget stagger", style: "--i:5", onclick: () => State.setView("bluetooth") },
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
        const key = `${m.track}|${m.artist}|${m.albumArt}`;
        if (key !== mediaKey) {
          mediaKey = key;
          art.src = m.albumArt;
          art.style.display = m.albumArt ? "" : "none";
          mediaText.replaceChildren(m.track, h("br"), m.artist);
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
      if (hasW) weatherValue.textContent = `${w.temp}° ${w.condition}`;
      else weatherEmpty.textContent = w.condition ? "Weather unavailable" : "No weather data";
      const b = State.battery;
      batteryValue.textContent = `${b.level}%${b.charging ? " · Charging" : ""}`;
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
  const track = h("div", { class: "media-track" });
  const artist = h("div", { class: "media-artist" });
  const fill = h("div", { class: "media-progress-fill" });
  const bar = h("div", { class: "media-progress" }, fill);
  const playBtn = h("button", { text: "▶", onclick: () => void Bridge.mediaPlayPause() });
  const player = h("div", { class: "view-media" },
    art,
    h("div", { class: "media-info" },
      track,
      artist,
      bar,
      h("div", { class: "media-controls" },
        h("button", { text: "⏮", onclick: () => void Bridge.mediaPrev() }),
        playBtn,
        h("button", { text: "⏭", onclick: () => void Bridge.mediaNext() }),
      ),
    ),
  );
  // Click anywhere on the bar → fraction of the width → media_seek.
  bar.addEventListener("click", (ev) => {
    const m = State.media;
    if (!m || !m.duration) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    void Bridge.mediaSeek(frac * m.duration);
  });
  const el = h("div", { class: "view" }, player, empty);
  player.style.display = "none";
  return {
    el,
    sync() {
      const m = State.media;
      empty.style.display = m ? "none" : "block";
      player.style.display = m ? "flex" : "none";
      if (!m) return;
      // Art only rides track changes — never blank it on a 1 Hz tick.
      if (m.albumArt && art.getAttribute("src") !== m.albumArt) art.src = m.albumArt;
      art.style.display = m.albumArt ? "" : "none";
      track.textContent = m.track;
      artist.textContent = m.artist;
      fill.style.transform = `scaleX(${clamp01(m.duration > 0 ? m.position / m.duration : 0)})`;
      playBtn.textContent = m.playing ? "⏸" : "▶";
    },
  };
}
// ── Control center ───────────────────────────────────────────────────────────

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function buildControlCenter(): ViewHost {
  /** Drag (pointerdown/move) + scroll wheel. Writes State locally right away,
   *  invokes the command debounced — the PS worker costs 1-3 s to spawn. */
  const makeSlider = (write: (v: number) => void, commit: (v: number) => void, flash: (v: number) => void) => {
    const fill = h("div", { class: "cc-slider-fill" });
    const knob = h("div", { class: "cc-slider-knob", "aria-hidden": "true" });
    const track = h("div", { class: "cc-slider" }, fill, knob);
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
    (v) => void (State.brightness.level = v),
    (v) => void Bridge.setBrightness(v),
    (v) => react("brightness", { intensity: v }),
  );

  const muteBtn = h(
    "button",
    {
      class: "cc-icon-btn",
      title: "Mute",
      onclick: () => {
        react("mute-flash");
        void Bridge.toggleMute();
      },
    },
    "🔊",
  );

  const toggle = (label: string, run: () => Promise<boolean | null>) => {
    const btn = h("button", {
      class: "cc-toggle",
      text: label,
      onclick: async () => {
        const on = await run();
        if (on !== null) btn.classList.toggle("on", on);
      },
    });
    return btn;
  };
  const nightBtn = toggle("Night light", () => Bridge.toggleNightLight());
  const dndBtn = toggle("Do not disturb", () => Bridge.toggleDnd());

  const note = h("span", { class: "cc-note" });
  let noteTimer = 0;
  const boostBtn = h("button", {
    class: "cc-toggle",
    text: "Memory boost",
    onclick: async () => {
      window.clearTimeout(noteTimer);
      note.textContent = "…";
      const freed = await Bridge.memoryBoost();
      note.textContent = freed === null ? "Failed" : `${freed} MB freed`;
      noteTimer = window.setTimeout(() => void (note.textContent = ""), 3000);
    },
  });

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
      muteBtn.textContent = State.volume.muted ? "🔇" : "🔊";
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

async function toggleBt(name: string, connected: boolean) {
  if (btPending) return;
  btPending = name;
  btError = "";
  State.notify();
  const res = connected ? await Bridge.btDisconnect(name) : await Bridge.btConnect(name);
  btPending = "";
  if (res && !res.ok) btError = res.error ?? "That didn't work.";
  // Success lands through the bt-devices / bt-device-event listeners.
  State.notify();
}

async function seedBluetooth() {
  const res = await Bridge.getBtDevices();
  if (res?.devices) {
    State.bluetooth.devices = res.devices;
    State.notify();
  }
}

/** Seeds on open like the control center: external changes emit no events.
 *  Rows are built once and patched, keyed by device name: a rebuild on every
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
        h("button", { class: "bt-refresh", text: "Refresh", onclick: () => void seedBluetooth() }),
      ),
      error,
      empty,
      list,
    ),
  );

  /** What the row's button acts on — the current connected flag for that name. */
  const connected = new Map<string, boolean>();
  const rows = new Map<
    string,
    { el: HTMLElement; icon: HTMLElement; name: HTMLElement; battery: HTMLElement; btn: HTMLButtonElement }
  >();
  let key = "";

  const buildRow = (name: string, index: number) => {
    const icon = h("span", { class: "bt-icon" });
    const label = h("span", { class: "bt-name" });
    const battery = h("span", { class: "bt-battery" });
    const btn = h("button", {
      class: "bt-btn",
      onclick: () => void toggleBt(name, connected.get(name) ?? false),
    });
    const row = h(
      "div",
      { class: "bt-device stagger", style: `--i:${index}` },
      icon,
      label,
      battery,
      btn,
    );
    return { el: row, icon, name: label, battery, btn };
  };

  return {
    el,
    sync() {
      const devices = State.bluetooth.devices;
      const next = devices.map((d) => d.name).join("\u0000");
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
        alive.add(d.name);
        let row = rows.get(d.name);
        if (row == null) {
          row = buildRow(d.name, i);
          rows.set(d.name, row);
        }
        const pending = btPending === d.name;
        row.icon.textContent = BT_ICONS[d.type] ?? "•";
        row.name.textContent = d.name;
        row.battery.style.display = d.battery >= 0 ? "" : "none";
        row.battery.textContent = d.battery >= 0 ? `${d.battery}%` : "";
        row.el.classList.toggle("on", d.connected);
        row.btn.disabled = btPending !== "" && !pending;
        row.btn.classList.toggle("pending", pending);
        row.btn.textContent = pending
          ? d.connected
            ? "Disconnecting…"
            : "Connecting…"
          : d.connected
            ? "Disconnect"
            : "Connect";
        connected.set(d.name, d.connected);
        order.push(row.el);
      });

      if (!changed) return;
      for (const [name, row] of rows) {
        if (!alive.has(name)) {
          row.el.remove();
          rows.delete(name);
          connected.delete(name);
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
      // The stopwatch owns the machine while that view is up.
      if (t.mode === "stopwatch") State.timerSetMode("focus");
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
      if (t.mode !== "stopwatch") State.timerSetMode("stopwatch");
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
        temp.textContent = `${w.temp}°`;
        cond.textContent = w.condition;
        details.replaceChildren(`Humidity: ${w.humidity}%`, h("br"), `Wind: ${w.wind} km/h`);
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
      media.textContent = m?.playing ? `♪ ${m.track}` : "";
      const b = State.battery;
      battery.textContent = `${b.charging ? "⚡" : ""}${b.level}%`;
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
  map.set("upload", buildUpload());
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
