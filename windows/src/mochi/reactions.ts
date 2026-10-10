// Mochi reaction bus (Task 3) — one transient slot, a condition map, a priority
// resolver and a pose/aura catalog. The island's frame loop calls
// tickReactions() right after the engine tick; react()/setCondition() poke
// State.notify(), which is the existing wake path back into that loop.

import { State } from "../core/state";
import type { BotEngine } from "./engine";

export type ReactionKind =
  | "brightness" | "volume" | "mute-flash" | "theme-sparkle"
  | "battery-drained" | "battery-charging" | "battery-full" | "dnd-sleep"
  | "approval-wave" | "session-done" | "session-error" | "session-ratelimit"
  | "media-playing" | "media-paused" | "media-loud" | "track-change"
  | "tickle" | "nuzzle";

type ConditionKind =
  | "battery-drained" | "battery-charging" | "battery-full" | "dnd-sleep"
  | "media-playing" | "media-paused";

/** Transient lifetimes. Condition kinds aren't TTL'd by the bus (setCondition
 *  owns them); the value only applies if react() is called on them directly. */
export const REACTION_TTL: Record<ReactionKind, number> = {
  brightness: 3000, volume: 3000, "mute-flash": 2000, "theme-sparkle": 1500,
  "battery-drained": 5000, "battery-charging": 5000, "battery-full": 5000,
  "dnd-sleep": 5000, "approval-wave": 2000, "session-done": 2500,
  "session-error": 2000, "session-ratelimit": 2000, "media-playing": 5000,
  "media-paused": 5000, "media-loud": 3000, "track-change": 1500,
  tickle: 1200, nuzzle: 2000,
};

/** kind → pose-override name + aura [color, intensity]; one entry per kind. */
const CATALOG: Record<ReactionKind, { pose?: string; aura?: readonly [string, number] }> = {
  brightness: { aura: ["#FFFFFF", 0.7] },
  volume: { aura: ["#7CC7FF", 0.7] },
  "mute-flash": { aura: ["#F4505E", 0.9] },
  "theme-sparkle": { pose: "squint-happy", aura: ["#F7B32B", 0.6] },
  "battery-drained": { pose: "drained", aura: ["#9AA0A8", 0.3] },
  "battery-charging": { pose: "perky", aura: ["#6BD9FF", 0.6] },
  "battery-full": { pose: "perky", aura: ["#55D499", 0.5] },
  "dnd-sleep": { pose: "sleep", aura: ["#6E80B8", 0.25] },
  "approval-wave": { pose: "wave", aura: ["#F5A524", 0.7] },
  "session-done": { pose: "flex", aura: ["#34D49A", 0.7] },
  "session-error": { pose: "dizzy-red", aura: ["#F4505E", 0.8] },
  "session-ratelimit": { pose: "drained", aura: ["#FBA63C", 0.5] },
  "media-playing": { pose: "headphones-idle", aura: ["#7C5CFF", 0.5] },
  "media-paused": { pose: "headphones-paused", aura: ["#7C5CFF", 0.3] },
  "media-loud": { pose: "pant", aura: ["#FF7AA2", 0.7] },
  "track-change": { pose: "perky", aura: ["#7C5CFF", 0.6] },
  tickle: { pose: "squirm" },
  nuzzle: { pose: "nuzzle", aura: ["#FF9FB0", 0.5] },
};

const CONDITION_KINDS = new Set<string>([
  "battery-drained", "battery-charging", "battery-full", "dnd-sleep",
  "media-playing", "media-paused",
]);
/** Layer 1 order: battery > dnd > media, mirroring State.updateReaction. */
const CONDITION_ORDER: ConditionKind[] = [
  "battery-drained", "battery-charging", "battery-full", "dnd-sleep", "media-playing",
];
const SESSION_KINDS = new Set<string>([
  "approval-wave", "session-done", "session-error", "session-ratelimit",
]);

let engine: BotEngine | null = null;
const conds: Record<ConditionKind, boolean> = {
  "battery-drained": false, "battery-charging": false, "battery-full": false,
  "dnd-sleep": false, "media-playing": false, "media-paused": false,
};
let transient: { kind: ReactionKind; until: number; intensity?: number; color?: string } | null = null;

export function setPrimaryEngine(e: BotEngine | null): void {
  engine = e;
}

export function setCondition(
  kind: "battery-drained" | "battery-charging" | "battery-full" | "dnd-sleep" | "media-playing" | "media-paused",
  on: boolean,
): void {
  conds[kind] = on;
  State.notify(); // wake the island frame loop if it is sleeping
}

export function react(kind: ReactionKind, opts?: { intensity?: number; color?: string }): void {
  transient = {
    kind,
    until: performance.now() + REACTION_TTL[kind],
    intensity: opts?.intensity,
    color: opts?.color,
  };
  switch (kind) {
    case "theme-sparkle": engine?.emit("star", 5); break;
    case "session-done": engine?.emit("spark", 5); break;
    case "session-ratelimit": engine?.emit("sweat", 1); break;
    case "nuzzle": engine?.emit("heart", 2); break;
  }
  State.notify(); // wake the island frame loop if it is sleeping
}

interface Resolved { pose?: string; aura?: readonly [string, number] }

/** conditions > session transient > media-paused > any other transient. */
function resolve(nowMs: number): Resolved | null {
  for (const c of CONDITION_ORDER) if (conds[c]) return CATALOG[c];
  const t = transient;
  if (t && nowMs < t.until && SESSION_KINDS.has(t.kind)) return withOpts(t);
  if (conds["media-paused"]) return CATALOG["media-paused"];
  if (t && nowMs < t.until) return withOpts(t);
  return null;
}

/** Catalog entry with react() opts folded in (intensity + track-change colour). */
function withOpts(t: NonNullable<typeof transient>): Resolved {
  const base = CATALOG[t.kind];
  if (!base.aura) return base;
  const color = t.color ?? base.aura[0];
  const intensity = t.intensity ?? base.aura[1];
  return { pose: base.pose, aura: [color, intensity] };
}

/** Called from the island frame loop AFTER the engine tick. */
export function tickReactions(nowMs: number): void {
  if (!engine) return;
  if (transient && nowMs >= transient.until) transient = null;
  const r = resolve(nowMs);
  engine.setPoseOverride(r?.pose ?? null);
  engine.setAura(r?.aura?.[0] ?? null, r?.aura?.[1] ?? 0);
  engine.setProp(conds["media-playing"] || conds["media-paused"] ? "headphones" : null);
}

// dev harness: ?reactions=1 — chip row firing every kind/condition on the primary engine.
function installHarness() {
  const on = new Set<string>();
  const row = document.createElement("div");
  row.style.cssText =
    "position:fixed;bottom:0;left:0;right:0;z-index:99999;display:flex;flex-wrap:wrap;" +
    "gap:2px;padding:3px;background:rgba(0,0,0,.65)";
  for (const kind of Object.keys(CATALOG) as ReactionKind[]) {
    const chip = document.createElement("button");
    chip.textContent = kind;
    chip.style.cssText =
      "font:10px/1 system-ui;padding:3px 4px;background:#1A1412;color:#fff;" +
      "border:1px solid #555;border-radius:4px;cursor:pointer";
    chip.onclick = () => {
      if (CONDITION_KINDS.has(kind)) {
        const next = !on.has(kind);
        if (next) on.add(kind); else on.delete(kind);
        chip.style.background = next ? "#7C5CFF" : "#1A1412";
        setCondition(kind as ConditionKind, next);
      } else {
        react(kind, { intensity: 0.8 });
      }
    };
    row.appendChild(chip);
  }
  document.body.appendChild(row);
}
if (typeof location !== "undefined" && new URLSearchParams(location.search).has("reactions") && document.body) {
  installHarness();
}
