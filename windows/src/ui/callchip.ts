// CallChip — React Bits' Micro/CallChip, ported to the island's hand-rolled DOM
// and its one-clock architecture.
//
// Kept from the reference: the glyph roll (tool → tick), the fill wipe over the
// nominal 2.5 s step, the live ms readout and the error freeze + shake. Dropped:
// the per-tool icon table (the ticker has no tool identity — the glyph is the
// same chevron the rows already use), the retry button (the ticker surface has
// no retry action; the spec says drop rather than fake) and the press squish
// (rows aren't pressable).
//
// The wipe, the roll and the washes are CSS (`.call-chip` in style.css). The
// clock is the host view's frame tick, so the chip adds no timer and no rAF of
// its own: hiding the island stops it with the rest of the frame loop.

import { h, svg } from "../views/dom";
import { ICONS } from "../views/icons";

export type ChipStatus = "running" | "done" | "error" | "idle";

export interface CallChip {
  el: HTMLElement;
  /** Patch text/status. `restart` re-arms the fill wipe and the clock (a new step). */
  sync(text: string, status: ChipStatus, restart?: boolean): void;
  /** Frame tick from Ticker.tick; writes the ms readout at most every 100 ms. No-op unless running. */
  tick(nowMs: number): void;
  readonly running: boolean;
}

/** The reference's hold target: the wipe stops just short, then snaps full on done. */
const HOLD_AT = 0.9;
const SHAKE = [0, -1, 1, -0.66, 0.66, -0.33, 0];
/** The reference shakes 6 px on a 34 px chip; the ticker's chip is 22 px. */
const SHAKE_PX = 1.5;
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const fmt = (ms: number) => (ms < 10000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
const WORDS: Record<ChipStatus, string> = {
  running: "running",
  done: "done",
  error: "failed",
  idle: "queued",
};
const glyphOf = (s: ChipStatus): "tool" | "tick" => (s === "done" || s === "error" ? "tick" : "tool");

/**
 * The island calls `initMotionPreferences()`, but asking the media query
 * directly (the squishswitch.ts precedent) is correct in every host and
 * immune to boot order.
 */
const reduced = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function stateOf(g: HTMLElement, state: "in" | "out" | null) {
  if (state) g.setAttribute("data-state", state);
  else g.removeAttribute("data-state");
}

export function createCallChip(): CallChip {
  const fill = h("span", { class: "call-chip__fill", "aria-hidden": "true" });
  const tool = h(
    "span",
    { class: "call-chip__glyph", "data-state": "in" },
    svg(ICONS.chevronRight, 11, { stroke: 2.4 }),
  );
  const tick = h("span", { class: "call-chip__glyph" }, svg(ICONS.check, 10, { stroke: 2.2 }));
  const slot = h("span", { class: "call-chip__slot", "aria-hidden": "true" }, tool, tick);
  const textEl = h("span", { class: "call-chip__text" });
  const timer = h("span", { class: "call-chip__timer", "aria-hidden": "true", text: "0 ms" });
  const sr = h("span", { class: "call-chip__sr", role: "status" });
  const el = h("div", { class: "call-chip", "data-status": "idle" }, fill, slot, textEl, timer, sr);

  let status: ChipStatus = "idle";
  let since: number | null = null;
  let shown = -1;
  let cur: "tool" | "tick" = "tool";
  let prev: "tool" | "tick" | null = null;
  let shakeAnim: Animation | null = null;

  const paint = (ms: number) => {
    const tenths = Math.floor(ms / 100);
    if (tenths === shown) return;
    shown = tenths;
    timer.textContent = fmt(ms);
  };

  /** Move the fill to `f` with no transition (the reference's instant setFraction). */
  const snap = (f: number) => {
    fill.style.transition = "none";
    fill.style.transform = `scaleX(${f})`;
    void fill.getBoundingClientRect();
    fill.style.transition = "";
  };

  const roll = (next: "tool" | "tick") => {
    if (next === cur) return;
    prev = cur;
    cur = next;
    stateOf(tool, cur === "tool" ? "in" : prev === "tool" ? "out" : null);
    stateOf(tick, cur === "tick" ? "in" : prev === "tick" ? "out" : null);
  };

  const apply = (s: ChipStatus, animate: boolean, live = 0) => {
    if (s === "running") {
      shakeAnim?.cancel();
      snap(0);
      if (animate) fill.style.transform = `scaleX(${HOLD_AT})`;
    } else if (s === "done") {
      fill.style.transform = "scaleX(1)";
    } else if (s === "error") {
      // Freeze the wipe where it died — `live` is the matrix captured while
      // the running transition was still applied (see sync).
      snap(live);
      if (animate && !reduced()) {
        shakeAnim = el.animate(
          SHAKE.map((k) => ({ transform: `translateX(${k * SHAKE_PX}px)`, easing: EASE_OUT })),
          { duration: 450 },
        );
      }
    } else {
      snap(0);
    }
  };

  return {
    el,
    sync(text: string, s: ChipStatus, restart = false) {
      const changed = s !== status;
      const textChanged = textEl.textContent !== text;
      if (textChanged) textEl.textContent = text;
      // Capture the wipe's live position BEFORE the attribute flip: the new
      // status replaces the running transition and would cancel the in-flight
      // interpolation, making the computed transform read the inline target.
      const frozen =
        s === "error" && changed
          ? Math.min(1, Math.max(0, new DOMMatrix(getComputedStyle(fill).transform).a))
          : 0;
      el.setAttribute("data-status", s);
      roll(glyphOf(s));
      // A new step — or the first running beat — re-arms the wipe and the clock.
      if (restart || (s === "running" && status !== "running")) {
        since = null;
        shown = -1;
        timer.textContent = "0 ms";
        apply(s, true);
      } else if (changed) {
        apply(s, true, frozen);
      }
      if (changed || restart || textChanged) sr.textContent = `${text}, ${WORDS[s]}`;
      status = s;
    },
    tick(nowMs: number) {
      if (status !== "running") return;
      if (since == null) since = nowMs;
      paint(nowMs - since);
    },
    get running() {
      return status === "running";
    },
  };
}
