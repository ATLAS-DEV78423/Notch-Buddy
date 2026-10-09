// Island views — DOM ports of IslandViewContent.swift. Paddings, font sizes,
// colours and wording are copied from the Swift views so both platforms read
// identically.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { Ticker } from "./ticker";
import { Bridge } from "../core/bridge";
import { State, type AgentTask } from "../core/state";
import { washRGBA, type IslandViewName, type ViewGroup, type Wash } from "../core/layout";
import { createMiniBot, pruneMiniBots } from "../mochi/minibots";
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
      pillsEl.style.display = group === "agents" ? "none" : "flex";
      for (const [pv, pill] of subPills) pill.classList.toggle("active", pv === v);
      el.style.opacity = v === "confused" ? "0" : "1";
    },
  };
}

// ── Overview ──────────────────────────────────────────────────────────────────

function buildOverview(actions: ViewActions): ViewHost {
  const ticker = new Ticker();
  const who = h("div", { class: "who" });
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
      if (mode === "ticker") ticker.tick(nowMs);
    },
    sync() {
      const task = State.focusTask;
      if (task?.id !== lastFocus) {
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
        clear(who);
        who.append(
          dot(task.color, 7),
          h("span", { class: "name", text: task.name }),
          h("span", { class: "tool", text: task.source === "claudeCode" ? "Claude Code" : "n8n" }),
        );
        if (task.steps.length > 1) {
          who.append(h("span", {
            class: "count",
            text: `${Math.min(task.stepIndex + 1, task.steps.length)}/${task.steps.length}`,
          }));
        }
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

function renderDashboardView(): HTMLElement {
  const media = State.media;
  const mediaWidget = h("div", { class: "widget", onclick: () => State.setView("media") },
    h("div", { class: "widget-title" }, "Media"),
    media
      ? h("div", { class: "widget-media" },
          h("img", { src: media.albumArt, class: "widget-album-art" }),
          h("div", {}, media.track, h("br"), media.artist),
        )
      : h("div", { class: "widget-empty" }, "No media playing"),
  );

  const stats = State.stats;
  const statsWidget = h("div", { class: "widget", onclick: () => State.setView("stats") },
    h("div", { class: "widget-title" }, "Stats"),
    h("div", { class: "widget-value" },
      `CPU ${Math.round(stats.cpu)}% · RAM ${Math.round(stats.ram)}%`),
  );

  const timer = State.timer;
  const mins = Math.floor(timer.remaining / 60);
  const secs = String(timer.remaining % 60).padStart(2, "0");
  const timerLabel = timer.mode.charAt(0).toUpperCase() + timer.mode.slice(1);
  const timerWidget = h("div", { class: "widget", onclick: () => State.setView("pomodoro") },
    h("div", { class: "widget-title" }, "Timer"),
    h("div", { class: "widget-value" }, `${timerLabel} · ${mins}:${secs}`),
  );

  const weather = State.weather;
  const weatherWidget = h("div", { class: "widget", onclick: () => State.setView("weather") },
    h("div", { class: "widget-title" }, "Weather"),
    weather.condition
      ? h("div", { class: "widget-value" }, `${weather.temp}° ${weather.condition}`)
      : h("div", { class: "widget-empty" }, "No weather data"),
  );

  const battery = State.battery;
  const batteryWidget = h("div", { class: "widget", onclick: () => State.setView("controlCenter") },
    h("div", { class: "widget-title" }, "Battery"),
    h("div", { class: "widget-value" },
      `${battery.level}%${battery.charging ? " · Charging" : ""}`),
  );

  const devices = State.bluetooth.devices;
  const bluetoothWidget = h("div", { class: "widget", onclick: () => State.setView("bluetooth") },
    h("div", { class: "widget-title" }, "Bluetooth"),
    devices.length
      ? h("div", { class: "widget-value" },
          `${devices.filter((d) => d.connected).length}/${devices.length} connected`)
      : h("div", { class: "widget-empty" }, "No devices"),
  );

  return h("div", { class: "dashboard-grid" },
    mediaWidget, statsWidget, timerWidget, weatherWidget, batteryWidget, bluetoothWidget);
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
      art.style.display = art.getAttribute("src") ? "" : "none";
      track.textContent = m.track;
      artist.textContent = m.artist;
      fill.style.width = `${m.duration > 0 ? Math.min(100, (m.position / m.duration) * 100) : 0}%`;
      playBtn.textContent = m.playing ? "⏸" : "▶";
    },
  };
}
function renderControlCenterView(): HTMLElement { return h("div", { class: "view-control-center" }, "Control Center"); }
function renderBluetoothView(): HTMLElement { return h("div", { class: "view-bluetooth" }, "Bluetooth"); }
function buildStatsView(): ViewHost {
  const NET_FULL_SCALE = 10 * 1024 * 1024; // 10 MB/s fills the bar.
  const fmtRate = (bps: number) => {
    if (bps < 1024) return `${Math.round(bps)} B/s`;
    if (bps < 1024 * 1024) return `${Math.round(bps / 1024)} KB/s`;
    if (bps < 1024 * 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
    return `${(bps / (1024 * 1024 * 1024)).toFixed(1)} GB/s`;
  };
  const row = (label: string) => {
    const fill = h("div", { class: "stat-fill" });
    const value = h("span", { class: "stat-value" });
    return {
      fill,
      value,
      el: h("div", { class: "stat-row" },
        h("span", { class: "stat-label" }, label),
        h("div", { class: "stat-bar" }, fill),
        value),
    };
  };
  const cpu = row("CPU");
  const ram = row("RAM");
  const rx = row("Net ↓");
  const tx = row("Net ↑");
  const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`;
  return {
    el: h("div", { class: "view" },
      h("div", { class: "view-stats" }, cpu.el, ram.el, rx.el, tx.el)),
    sync() {
      const s = State.stats;
      cpu.fill.style.width = pct(s.cpu);
      cpu.value.textContent = `${s.cpu.toFixed(0)}%`;
      ram.fill.style.width = pct(s.ram);
      ram.value.textContent = `${s.ram.toFixed(0)}%`;
      rx.fill.style.width = pct((s.netRx / NET_FULL_SCALE) * 100);
      rx.value.textContent = fmtRate(s.netRx);
      tx.fill.style.width = pct((s.netTx / NET_FULL_SCALE) * 100);
      tx.value.textContent = fmtRate(s.netTx);
    },
  };
}
function renderPomodoroView(): HTMLElement { return h("div", { class: "view-pomodoro" }, "Pomodoro"); }
function renderStopwatchView(): HTMLElement { return h("div", { class: "view-stopwatch" }, "Stopwatch"); }
function renderWeatherView(): HTMLElement { return h("div", { class: "view-weather" }, "Weather"); }

/** The dispatcher toggles `.on` on the host's root, so the stub's own div sits
 *  inside a standard `.view` wrapper like every other view. */
function stubView(render: () => HTMLElement): ViewHost {
  return { el: h("div", { class: "view" }, render()), sync() {} };
}

/** Same wrapper, but rebuilds on every sync — that runs once per State.notify()
 *  while the view is active, so State-driven widgets actually redraw. */
function liveView(render: () => HTMLElement): ViewHost {
  const el = h("div", { class: "view" });
  return { el, sync: () => void el.replaceChildren(render()) };
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
  map.set("dashboard", liveView(renderDashboardView));
  map.set("media", buildMediaView());
  map.set("controlCenter", stubView(renderControlCenterView));
  map.set("bluetooth", stubView(renderBluetoothView));
  map.set("stats", buildStatsView());
  map.set("pomodoro", stubView(renderPomodoroView));
  map.set("stopwatch", stubView(renderStopwatchView));
  map.set("weather", stubView(renderWeatherView));
  return map;
}
