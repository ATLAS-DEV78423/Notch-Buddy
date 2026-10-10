// ThoughtLine — React Bits' Micro/ThoughtLine, ported to the island's
// hand-rolled DOM and its one-clock architecture.
//
// Kept from the reference: the glyph that breathes and dims, the shimmering
// working label, the live clock, and the settle chord that freezes the time into
// "Thought for 3.2s". Dropped: the collapsible step trace — the ticker directly
// below this line *is* this app's trace — and `renderLabel`.
//
// The breath, shimmer and settle are CSS (`.thought-line` in style.css). The
// clock is the host view's frame tick, so the line adds no timer and no rAF of
// its own: hiding the island stops it with the rest of the frame loop.

import { h, svg } from "../views/dom";
import { ICONS } from "../views/icons";

/** Tenths of a second → "3.2s" / "1m 4.0s" — the reference's own wording. */
const fmt = (ds: number) =>
  ds < 600 ? `${(ds / 10).toFixed(1)}s` : `${Math.floor(ds / 600)}m ${((ds % 600) / 10).toFixed(1)}s`;

/** The same duration as a sentence, for the status announcement. */
const spoken = (ds: number) =>
  ds < 600
    ? `${(ds / 10).toFixed(1)} seconds`
    : `${Math.floor(ds / 600)} minutes ${((ds % 600) / 10).toFixed(1)} seconds`;

/** The states in which an agent is still producing steps. */
const WORKING: ReadonlySet<string> = new Set(["working", "thinking", "searching"]);

export interface ThoughtLine {
  el: HTMLElement;
  /**
   * `state` is the focused task's BotStateName. `restart` starts a new clock for
   * the same state — the host sets it when the focused session changes.
   */
  sync(state: string, label?: string, restart?: boolean): void;
  /** Driven by the host view's frame tick; writes the timer at most every 100 ms. */
  tick(nowMs: number): void;
}

export function createThoughtLine(opts: { label?: string; doneLabel?: string } = {}): ThoughtLine {
  const workLabel = opts.label ?? "Thinking…";
  const doneLabel = opts.doneLabel ?? "Thought for";

  const glyph = h("span", { class: "thought-line__glyph", "aria-hidden": "true" }, svg(ICONS.sparkle, 12));
  const workText = h("span", { class: "thought-line__work shimmer", text: workLabel });
  const work = h("span", { class: "thought-line__text" }, workText);
  const done = h("span", { class: "thought-line__text thought-line__text--done" });
  const stack = h("span", { class: "thought-line__label", "aria-hidden": "true" }, work, done);
  const timer = h("span", { class: "thought-line__timer", "aria-hidden": "true", text: "0.0s" });
  const sr = h("span", { class: "thought-line__sr", role: "status" });
  const el = h("div", { class: "thought-line" }, glyph, stack, timer, sr);

  // null until the first sync, so a session that is already settled still paints.
  let working: boolean | null = null;
  let since: number | null = null;
  let ds = 0;
  let shown = -1;

  const paint = (value: number) => {
    if (value === shown) return;
    shown = value;
    timer.textContent = fmt(value);
  };

  const settle = (next: boolean) => {
    if (next === working) return;
    working = next;
    if (next) {
      ds = 0;
      since = null;
      shown = -1;
      paint(0);
      el.setAttribute("data-working", "");
      work.setAttribute("data-active", "");
      done.removeAttribute("data-active");
      sr.textContent = workLabel;
    } else {
      // Freeze the clock into the sentence, exactly once.
      el.removeAttribute("data-working");
      work.removeAttribute("data-active");
      done.textContent = `${doneLabel} ${fmt(ds)}`;
      done.setAttribute("data-active", "");
      sr.textContent = `${doneLabel} ${spoken(ds)}`;
    }
  };

  return {
    el,
    sync(state: string, label?: string, restart = false) {
      if (label && label !== workText.textContent) workText.textContent = label;
      if (restart) working = null;
      settle(WORKING.has(state));
    },
    tick(nowMs: number) {
      if (working !== true) return;
      if (since == null) since = nowMs;
      ds = Math.floor((nowMs - since) / 100);
      paint(ds);
    },
  };
}
