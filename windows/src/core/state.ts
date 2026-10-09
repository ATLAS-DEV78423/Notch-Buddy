// App state — mirror of AppState.swift (the parts the island needs).

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName, ViewGroup } from "./layout";
import type { EyeShape } from "../mochi/engine";
import { Sound } from "./sound";

/** Durations the briefs fix: focus counts down from 25 min, break from 5 min. */
export const FOCUS_SECONDS = 25 * 60;
export const BREAK_SECONDS = 5 * 60;

const TASKS_KEY = "coucou.pomo.tasks";

export type AgentSource = "claudeCode" | "n8n" | "agent";
export type PillBadge = "approval" | "finished" | "error";

export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  steps: string[];
  source: AgentSource;
  isIntegration: boolean;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
  sessionCwd?: string | null;
}

export interface ApprovalInfo {
  requestId: string;
  sessionId: string;
  tool: string;
  command: string;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export type PromptContext =
  | { kind: "window"; appName: string; title: string; url?: string }
  | { kind: "file"; name: string; path?: string };

export interface ResultItem {
  label: string;
  detail: string;
  url?: string;
}

export interface SearchResult {
  title: string;
  items: ResultItem[];
  note?: string;
}

const task = (
  id: string, name: string, color: string, source: AgentSource,
): AgentTask => ({
  id, name, color, state: "idle", stepIndex: 0, steps: [], source, isIntegration: true,
});

/** AgentTask.integrationAgents — same ids, names and colours as macOS. */
export const INTEGRATION_AGENTS: AgentTask[] = [
  task("integration_claude", "VS Code", "#F5F6F8", "claudeCode"),
  task("integration_resend", "Resend", "#22C55E", "n8n"),
  task("integration_n8n", "n8n", "#F29B38", "n8n"),
  task("integration_vercel", "Vercel", "#7C5CFF", "n8n"),
  task("integration_github", "GitHub", "#F4505E", "n8n"),
  task("integration_notion", "Notion", "#8C8C8C", "n8n"),
  task("integration_calcom", "Cal.com", "#C9956A", "n8n"),
  task("integration_stripe", "Stripe", "#0570DE", "n8n"),
];

export const TOGGLEABLE_INTEGRATION_IDS = [
  "integration_resend", "integration_n8n", "integration_vercel", "integration_github",
  "integration_notion", "integration_calcom", "integration_stripe",
];

/** What an integration poller last reported. */
export interface IntegrationInfo {
  data: Record<string, unknown>;
  error: string | null;
  loaded: boolean;
  configured: boolean;
}

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  absenceInterval: number;
  activeIntegrations: string[];
  screen: "primary" | "cursor";
  autostart: boolean;
  hooksInstalled: boolean;
  /** Claude model used by the chat. */
  model: string;
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  absenceInterval: 180,
  activeIntegrations: [
    "integration_resend", "integration_n8n", "integration_vercel", "integration_github",
  ],
  screen: "primary",
  autostart: false,
  hooksInstalled: false,
  model: "claude-opus-5",
};

type Listener = () => void;

/** `media-state` payload — Rust sends `null` when the session ends. */
export interface MediaState {
  track: string;
  artist: string;
  albumArt: string;
  playing: boolean;
  position: number;
  duration: number;
  sourceApp: string;
}

/** `system-stats` payload — cpu/ram are 0-100 %, net* are bytes/sec. */
export interface SystemStats {
  cpu: number;
  ram: number;
  netRx: number;
  netTx: number;
}

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  tasks: AgentTask[] = [];
  focusId: string | null = null;

  stateOverride: BotStateName | null = null;

  /** Bot reactions (media/timer/battery): lose to stateOverride and to a non-idle
   *  focused agent in effectiveState; recomputed on every notify, never polled. */
  reactionState: BotStateName | null = null;
  /** One-shot emote request (break started, bluetooth connected) — the island
   *  applies it to the engine and clears it on its next sync. */
  reactionEmote: BotEmoteName | null = null;
  private prevTimerRunning = false;

  /** Cursor in logical screen pixels, origin top-left (like AppState.mousePosition). */
  mouse = { x: 0, y: 0 };
  /** Cursor relative to the island's top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  isPinned = false;
  paused = false;

  uploadProgress = 0;
  uploadDuration = 2.4;
  fileDragOver = false;

  promptContext: PromptContext | null = null;
  droppedFile: { name: string; path: string } | null = null;
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];
  pendingApproval: ApprovalInfo | null = null;

  integrations: Record<string, IntegrationInfo> = {};

  lastActivity = performance.now();

  settings: Settings = { ...DEFAULT_SETTINGS };

  media: MediaState | null = null;
  stats: SystemStats = { cpu: 0, ram: 0, netRx: 0, netTx: 0 };
  volume: { level: number; muted: boolean } = { level: 0, muted: false };
  brightness: { level: number } = { level: 0 };
  bluetooth: { devices: Array<{ name: string; type: string; battery: number; connected: boolean }> } = { devices: [] };
  battery: { level: number; charging: boolean; timeRemaining: number } = { level: 100, charging: false, timeRemaining: 0 };
  clipboard: { lastUrl: string } = { lastUrl: "" };
  timer: { mode: "focus" | "break" | "stopwatch"; running: boolean; remaining: number; tasks: Array<{ text: string; done: boolean }> } = { mode: "focus", running: false, remaining: FOCUS_SECONDS, tasks: [] };
  weather: { temp: number; condition: string; humidity: number; wind: number } = { temp: 0, condition: "", humidity: 0, wind: 0 };
  /** In-island banner (clipboard URL, battery notice). One at a time, fixed TTL. */
  banner: { text: string; url: string | null } | null = null;
  viewGroup: ViewGroup = "agents";

  private bannerTimer: number | null = null;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  get effectiveState(): BotStateName {
    if (this.stateOverride) return this.stateOverride;
    const agent = this.focusTask?.state ?? "idle";
    if (agent !== "idle") return agent; // agent-task states beat reactions
    return this.reactionState ?? "idle";
  }

  /** Task 19 reactions: priority battery > focus timer > media (agent states and
   *  stateOverride win above). Break runs idle (the engine has no happy state). */
  updateReaction() {
    const t = this.timer;
    let r: BotStateName | null = null;
    if (this.battery.level <= 20 && !this.battery.charging) r = "sleeping";
    else if (t.running && t.mode === "focus") r = "thinking";
    else if (t.running && t.mode === "break") r = "idle";
    else if (this.media?.playing) r = "working";
    this.reactionState = r;
    if (t.running && !this.prevTimerRunning && t.mode === "break") {
      this.reactionEmote = "happy";
    }
    this.prevTimerRunning = t.running;
  }

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId);
  }

  setFocus(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.focusId = id;
    t.pillBadge = null;
    this.notify();
  }

  updateTask(id: string, state: BotStateName) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.state = state;
    this.notify();
  }

  appendStep(id: string, step: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.steps.push(step);
    if (t.steps.length > 20) t.steps.shift();
    t.stepIndex = t.steps.length - 1;
    this.notify();
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  /** loadIntegrationTasks() — VS Code always on, the rest opt-in (max 4). */
  loadIntegrationTasks() {
    for (const proto of INTEGRATION_AGENTS) {
      const shouldLoad =
        proto.id === "integration_claude" || this.settings.activeIntegrations.includes(proto.id);
      const idx = this.tasks.findIndex((t) => t.id === proto.id);
      if (shouldLoad && idx < 0) this.tasks.push({ ...proto, steps: [] });
      if (!shouldLoad && idx >= 0) this.tasks.splice(idx, 1);
    }
    // Order: integration_claude first, then agent_* pills (visible in slice(0,4)),
    // then other integrations in declaration order.
    const order = INTEGRATION_AGENTS.map((t) => t.id);
    this.tasks.sort((a, b) => {
      const isAgentA = a.id.startsWith("agent_");
      const isAgentB = b.id.startsWith("agent_");
      // integration_claude always first
      if (a.id === "integration_claude") return -1;
      if (b.id === "integration_claude") return 1;
      // agent_* before other integrations; preserve insertion order among themselves
      if (isAgentA && !isAgentB) return -1;
      if (isAgentB && !isAgentA) return 1;
      if (isAgentA && isAgentB) return 0;
      // both known integrations → declaration order
      return order.indexOf(a.id) - order.indexOf(b.id);
    });
    if (!this.focusId) this.focusId = "integration_claude";
    this.notify();
  }

  removeTask(id: string) {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this.tasks.splice(idx, 1);
    if (this.focusId === id) this.focusId = this.tasks[0]?.id ?? "integration_claude";
    this.notify();
  }

  /** Creates a dynamic agent_ pill on first event; no-ops if it already exists.
   *  Inserted right after integration_claude so it appears in the visible slice(0,4). */
  upsertExternalAgent(id: string, name: string, color: string) {
    if (this.tasks.some((t) => t.id === id)) return;
    const at = this.tasks.findIndex((t) => t.id === "integration_claude") + 1;
    this.tasks.splice(at, 0, {
      id, name, color,
      state: "idle", stepIndex: 0, steps: [],
      source: "agent", isIntegration: false,
    });
    if (!this.focusId) this.focusId = id;
    this.notify();
  }

  toggleIntegration(id: string) {
    if (id === "integration_claude") return;
    const active = this.settings.activeIntegrations;
    if (active.includes(id)) {
      this.settings.activeIntegrations = active.filter((x) => x !== id);
      if (this.focusId === id) this.focusId = "integration_claude";
    } else {
      if (active.length >= 4) return;
      this.settings.activeIntegrations = [...active, id];
    }
    this.loadIntegrationTasks();
  }

  setViewGroup(group: ViewGroup) {
    this.viewGroup = group;
    this.notify();
  }

  /** Shows an in-island banner for a fixed TTL; a new banner replaces the running one. */
  showBanner(text: string, url: string | null = null) {
    this.banner = { text, url };
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.banner = null;
      this.bannerTimer = null;
      this.notify();
    }, 6000);
    this.notify();
  }

  dismissBanner() {
    if (this.bannerTimer !== null) window.clearTimeout(this.bannerTimer);
    this.bannerTimer = null;
    this.banner = null;
    this.notify();
  }

  /** Sets the active view and marks the UI dirty (island geometry follows in syncDom). */
  setView(v: IslandViewName) {
    this.view = v;
    this.notify();
  }

  // ── Timer: focus / break count down, stopwatch counts up — one machine ─────

  /** What the current mode's Reset rewinds to (stopwatch starts at 0). */
  private timerResetValue(): number {
    if (this.timer.mode === "stopwatch") return 0;
    return this.timer.mode === "break" ? BREAK_SECONDS : FOCUS_SECONDS;
  }

  timerToggle() {
    this.timer.running = !this.timer.running;
    this.notify();
  }

  timerReset() {
    this.timer.running = false;
    this.timer.remaining = this.timerResetValue();
    this.notify();
  }

  /** Only one of the three can run at a time: switching stops and rewinds. */
  timerSetMode(mode: "focus" | "break" | "stopwatch") {
    this.timer.mode = mode;
    this.timer.running = false;
    this.timer.remaining = this.timerResetValue();
    this.notify();
  }

  savePomoTasks() {
    try {
      localStorage.setItem(TASKS_KEY, JSON.stringify(this.timer.tasks));
    } catch {
      /* a browser without storage must not break the view */
    }
  }

  /** The single 1 s tick. The interval itself is registered once from main. */
  tickTimer() {
    const t = this.timer;
    if (!t.running) return;
    if (t.mode === "stopwatch") {
      t.remaining++;
    } else {
      t.remaining--;
      if (t.remaining <= 0) {
        t.remaining = 0;
        t.running = false;
        this.timerEnded();
      }
    }
    this.notify();
  }

  /** Countdown hit zero: chime, then the NoteView-style in-island note.
   *  No Windows toast helper exists in this app yet (see report concerns). */
  private timerEnded() {
    const wasFocus = this.timer.mode === "focus";
    Sound.play("finish");
    window.setTimeout(() => Sound.play("approve"), 400);
    this.noteMessage = wasFocus
      ? "Focus finished — take a break."
      : "Break's over — back to focus.";
    if (this.mode !== "expanded" || this.view === "note") return;
    const prev = this.view;
    this.setView("note");
    window.setTimeout(() => {
      if (this.view === "note") this.setView(prev);
    }, 2400);
  }

  defaultView(): IslandViewName {
    return this.tasks.length === 0 ? "empty" : "overview";
  }
}

export const State = new AppState();

// Bot reactions ride the existing notify path (bridge handlers, timer tick,
// hooks all notify) — one subscriber, no polling interval.
State.subscribe(() => State.updateReaction());
State.updateReaction();

// The pomodoro task list persists across restarts (brief: localStorage).
try {
  const raw = localStorage.getItem(TASKS_KEY);
  if (raw) State.timer.tasks = JSON.parse(raw) as Array<{ text: string; done: boolean }>;
} catch {
  /* no storage, no saved tasks */
}

/** The one interval behind focus, break and stopwatch — registered once from main. */
export function startTimerTick() {
  window.setInterval(() => State.tickTimer(), 1000);
}
