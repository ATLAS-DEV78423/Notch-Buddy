// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { State, type MediaState, type Settings, type SystemStats } from "./state";

/** `weather-update` payload — field names match `State.weather`. */
export interface WeatherData {
  temp: number;
  condition: string;
  humidity: number;
  wind: number;
}

/** `battery-status` payload — field names match `State.battery`. */
export interface BatteryStatus {
  level: number;
  charging: boolean;
  /** Seconds; 0 when Windows has no estimate. */
  timeRemaining: number;
}

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[coucou] ${cmd} failed`, err);
    return null;
  }
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
  /** False where the OS has no global cursor (Wayland): see Island.followPageCursor. */
  cursorPoll: boolean;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (chat field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),

  openUrl: (url: string) => call<void>("open_url", { url }),

  /** "Open terminal" → opens the folder in VS Code when `code` is on PATH. */
  openInVSCode: (path: string | null) => call<boolean>("open_in_vscode", { path }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: () => call<void>("open_settings_window"),

  /** Writes to %LOCALAPPDATA%\Coucou\coucou.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Claude Code hooks ─────────────────────────────────────────────────────
  hooksStatus: () => call<HookStatus>("hooks_status"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  hooksPreview: (install: boolean) => callOrThrow<HookPreview>("hooks_preview", { install }),
  /**
   * Writes ~/.claude/settings.json — only ever after an explicit click, and only
   * when the file still matches the preview the user looked at.
   */
  hooksApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint }),

  // ── Agent installers ──────────────────────────────────────────────────────
  // Same shape as the hooks methods above: status is infallible, preview/write
  // can refuse (a foreign file, a changed fingerprint).
  opencodeStatus: () => call<AgentStatus>("opencode_status"),
  opencodePreview: (install: boolean) =>
    callOrThrow<AgentPreview>("opencode_preview", { install }),
  opencodeWrite: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("opencode_write", { install, fingerprint }),

  hermesStatus: () => call<AgentStatus>("hermes_status"),
  hermesPreview: (install: boolean) =>
    callOrThrow<AgentPreview>("hermes_preview", { install }),
  hermesWrite: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hermes_write", { install, fingerprint }),

  approvalDecision: (requestId: string, decision: "allow" | "deny") =>
    call<void>("approval_decision", { requestId, decision }),
  /** "The card is up" — until this lands the relay only waits a moment. */
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),
  /** "Nobody can act on this" — Claude Code asks in the terminal right away. */
  approvalDecline: (requestId: string) => call<void>("approval_decline", { requestId }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  /** One chat turn. The API key and any file bytes never leave Rust. */
  chatSend: (query: string, context: ChatContext | null) =>
    callOrThrow<{ text: string }>("chat_send", { query, context }),
  chatReset: () => call<void>("chat_reset"),
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  /** Opens the configured n8n instance in the browser. */
  openN8n: () => call<void>("open_n8n"),

  /** Tray → Pause. Stops the integration pollers, not just the island. */
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),

  // ── Media player ──────────────────────────────────────────────────────────
  mediaPlayPause: () => call<void>("media_play_pause"),
  mediaNext: () => call<void>("media_next"),
  mediaPrev: () => call<void>("media_prev"),
  /** `position` is seconds (f64 in Rust). */
  mediaSeek: (position: number) => call<void>("media_seek", { position }),

  // ── Control center ─────────────────────────────────────────────────────────
  /** `level` is 0..1 — the worker speaks percents, Rust scales it. */
  getVolume: () => call<{ level: number; muted: boolean }>("get_volume"),
  setVolume: (level: number) => call<void>("set_volume", { level }),
  toggleMute: () => call<boolean>("toggle_mute"),
  getBrightness: () => call<{ level: number }>("get_brightness"),
  setBrightness: (level: number) => call<void>("set_brightness", { level }),
  toggleNightLight: () => call<boolean>("toggle_night_light"),
  toggleDnd: () => call<boolean>("toggle_dnd"),
  /** MB of RAM freed. Blocks the PowerShell worker ~1 s while it runs. */
  memoryBoost: () => call<number>("memory_boost"),

  // ── Bluetooth ─────────────────────────────────────────────────────────────
  getBtDevices: () => call<BtDevices>("get_bt_devices"),
  /** `name` is a single string argument: invoke takes `{ name }`, not positional. */
  btConnect: (name: string) => call<BtAction>("bt_connect", { name }),
  btDisconnect: (name: string) => call<BtAction>("bt_disconnect", { name }),
};

export interface BtDevice {
  name: string;
  /** Icon hint: headphones / speaker / keyboard / mouse / gamepad / phone / "". */
  type: string;
  /** -1 = unknown or disconnected. */
  battery: number;
  connected: boolean;
}

export interface BtDevices {
  devices: BtDevice[];
}

export interface BtAction {
  ok: boolean;
  error?: string;
}

export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "window"; appName: string; title: string; url?: string };

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export interface HookStatus {
  installed: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  /** Hand back to hooksApply so only the reviewed diff is ever written. */
  fingerprint: string;
}

export interface AgentStatus {
  installed: boolean;
  path: string;
}

export interface AgentPreview {
  diff: string;
  backup: string;
  path: string;
  /** Hand back to `*Write` so only the reviewed diff is ever written. */
  fingerprint: string;
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside Coucou");
  return invoke<T>(cmd, args);
}

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: string }
  | { name: "hook"; payload: Record<string, unknown> }
  | { name: "screen-changed"; payload: null };

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

/** Files dragged onto the island. Only reaches us when the window takes the mouse. */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    handler(event.payload as DragDropPayload);
  });
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}

/**
 * media-state / system-stats land in State, so every subscriber — the
 * dashboard included — redraws through the usual State.notify() path.
 * `media-changed` needs no handler: the next media-state carries the state.
 */
export function registerMediaStatsListeners() {
  void onEvent<MediaState | null>("media-state", (payload) => {
    if (payload == null) {
      State.media = null;
    } else if (payload.albumArt) {
      State.media = payload;
    } else {
      // Art only rides track changes: keep it for the same track, store ""
      // when the new track simply has no thumbnail.
      const prev = State.media;
      const keepArt =
        prev != null && prev.track === payload.track && prev.artist === payload.artist
          ? prev.albumArt
          : "";
      State.media = { ...payload, albumArt: keepArt };
    }
    State.notify();
  });
  void onEvent<SystemStats>("system-stats", (stats) => {
    State.stats = stats;
    State.notify();
  });
}

/**
 * volume-changed / brightness-changed follow the island's own set commands —
 * external FN-key changes emit nothing, so the control center seeds itself
 * with get_volume / get_brightness when it opens. The payloads mutate the
 * existing State objects in place: the sliders hold a reference to them.
 */
export function registerControlCenterListeners() {
  void onEvent<{ level: number; muted: boolean }>("volume-changed", (payload) => {
    State.volume.level = payload.level;
    State.volume.muted = payload.muted;
    State.notify();
  });
  void onEvent<{ level: number }>("brightness-changed", (payload) => {
    State.brightness.level = payload.level;
    State.notify();
  });
}

/**
 * `bt-devices` is the full list after every connect/disconnect this app asked
 * for; `bt-device-event` is the confirmation for the one device. External
 * changes emit nothing — the view re-queries with get_bt_devices when it opens.
 */
export function registerBluetoothListeners() {
  void onEvent<BtDevices>("bt-devices", (payload) => {
    State.bluetooth.devices = payload.devices;
    State.notify();
  });
  void onEvent<{ type: string; name: string; battery: number }>("bt-device-event", (payload) => {
    const d = State.bluetooth.devices.find((x) => x.name === payload.name);
    if (!d) return;
    d.connected = payload.type === "connected";
    if (payload.battery >= 0) d.battery = payload.battery;
    State.notify();
  });
}

/**
 * weather-update / battery-status / clipboard-url land in State and the banner.
 * Battery alerts fire once per threshold crossing (low below 20 %, not
 * charging; plug/unplug edges), never on every 30 s poll. The clipboard banner
 * carries a ~6 s TTL — the backend also emits on launch when a URL is already
 * in the clipboard, and the TTL covers that case too.
 */
export function registerWeatherBatteryClipboardListeners() {
  void onEvent<WeatherData>("weather-update", (payload) => {
    State.weather = payload;
    State.notify();
  });

  let batterySeen = false;
  void onEvent<BatteryStatus>("battery-status", (payload) => {
    const prev = State.battery;
    State.battery = payload;
    if (batterySeen) {
      const lowNow = payload.level < 20 && !payload.charging;
      const lowBefore = prev.level < 20 && !prev.charging;
      if (lowNow && !lowBefore) {
        State.showBanner(`Battery low: ${payload.level}%`);
      } else if (payload.charging !== prev.charging) {
        State.showBanner(payload.charging ? "Charger connected" : "Charger disconnected");
      }
    }
    batterySeen = true;
    State.notify();
  });

  void onEvent<{ url: string }>("clipboard-url", ({ url }) => {
    State.clipboard.lastUrl = url;
    State.showBanner(url);
  });
}
