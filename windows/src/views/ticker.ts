// Overview task ticker — port of TickerView (V2) from IslandViewContent.swift.
//
// Three rows: completed (A), current → completed (B), incoming (C). Every row
// position is recomputed from a single clock in `tick()`, driven by the island's
// frame loop — no CSS transitions and no timers. Chaining CSS transitions with a
// reset timer let two rows land on the same line when steps arrived in bursts,
// and any step that arrived mid-animation was dropped outright. Steps are now
// queued instead, so a burst scrolls past rather than vanishing.
//
// Row B's body is the CallChip (ui/callchip.ts): glyph, step text, a live ms
// readout and a fill wipe — its own CSS transitions, its clock from `tick()`.

import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { createCallChip, type ChipStatus } from "../ui/callchip";
import { cubicBezier, clamp, lerp } from "../core/anim";
import type { AgentTask } from "../core/state";

const ROW_H = 22;
/** One step transition, milliseconds. */
const DURATION = 380;
/** Beyond this many queued steps we stop trying to show them all. */
const MAX_QUEUE = 4;
const COMPLETED_SCALE = 11.5 / 13; // 0.885 — the completed font size
const EASE = cubicBezier(0.4, 0, 0.2, 1);

interface Row {
  el: HTMLElement;
  chevron: SVGElement;
  check: SVGElement;
  shimmer: HTMLElement;
  dim: HTMLElement;
  text: string;
}

function makeRow(): Row {
  const chevron = svg(ICONS.chevronRight, 9, { stroke: 2.4 });
  const check = svg(ICONS.check, 8, { stroke: 2.2 });
  check.style.color = "#454850"; // the completed tick is dimmer than the chevron
  check.style.position = "absolute";
  chevron.style.position = "absolute";
  const shimmer = h("span", { class: "tick-text shimmer" });
  const dim = h("span", {
    class: "tick-text",
    style: "position:absolute;left:0;right:0;color:#6b7079",
  });
  const el = h(
    "div",
    { class: "ticker-row" },
    h("span", { class: "tick-icon", style: "position:relative" }, chevron, check),
    h("span", { style: "position:relative;flex:1 1 auto;min-width:0" }, shimmer, dim),
  );
  return { el, chevron, check, shimmer, dim, text: "" };
}

function setText(row: Row, text: string) {
  if (row.text === text) return;
  row.text = text;
  row.shimmer.textContent = text;
  row.dim.textContent = text;
}

/**
 * Positions a row's element. `phase` 0 = current (full size), 1 = completed
 * (shifted up-left and scaled down) — same geometry as the Swift view.
 */
function placeEl(el: HTMLElement, y: number, phase: number, opacity: number) {
  const scale = 1 - phase * (1 - COMPLETED_SCALE);
  el.style.transform = `translate(${-phase * 10}px, ${y}px) scale(${scale})`;
  el.style.opacity = String(opacity);
}

/**
 * Places a row and crossfades its icon/text children — the treatment for the
 * completed (a) and incoming (c) rows. Row b is the CallChip and has none.
 */
function place(row: Row, y: number, phase: number, opacity: number) {
  placeEl(row.el, y, phase, opacity);
  row.chevron.style.opacity = String(clamp(1 - phase * 2, 0, 1));
  row.check.style.opacity = String(clamp(phase * 2 - 1, 0, 1));
  row.shimmer.style.opacity = String(clamp(1 - phase * 1.6, 0, 1));
  row.dim.style.opacity = String(clamp(phase * 2 - 0.4, 0, 1));
}

/** AgentTask.state → the chip's status vocabulary. */
function chipStatusOf(state: string): ChipStatus {
  switch (state) {
    case "working":
    case "thinking":
    case "searching":
    case "ratelimit":
      return "running";
    case "finished":
      return "done";
    case "error":
    case "dizzy":
      return "error";
    default:
      return "idle";
  }
}

export class Ticker {
  /** The island's one ticker — the frame loop's busy gate reads it statically. */
  static current: Ticker | null = null;

  readonly el: HTMLElement;
  private a = makeRow(); // completed
  private chip = createCallChip(); // row b's body — the current step as a chip
  /** Row b is the chip: position + text mirror only (the commit path reads `text`). */
  private b = { el: h("div", { class: "ticker-row" }, this.chip.el), text: "" };
  private c = makeRow(); // incoming
  private chipStatus: ChipStatus = "idle";
  private queue: string[] = [];
  private startMs: number | null = null;
  private displayIndex = -1;

  constructor() {
    this.el = h("div", { class: "ticker" }, this.a.el, this.b.el, this.c.el);
    Ticker.current = this;
    this.rest();
  }

  static get animating(): boolean {
    return Ticker.current?.animating ?? false;
  }

  /** The state between transitions: completed on top, current below. */
  private rest() {
    place(this.a, 0, 1, 1);
    placeEl(this.b.el, ROW_H, 0, 1);
    place(this.c, ROW_H * 2, 0, 0);
  }

  get animating(): boolean {
    return this.startMs != null || this.queue.length > 0 || this.chip.running;
  }

  /** Row b's text lives on the chip; `b.text` is the mirror the commit path reads. */
  private setChip(text: string, restart = false) {
    this.b.text = text;
    this.chip.sync(text, this.chipStatus, restart);
  }

  sync(task: AgentTask | null) {
    const steps = task && task.steps.length > 0 ? task.steps : ["…"];
    const idx = task ? Math.min(task.stepIndex, steps.length - 1) : -1;
    this.chipStatus = task ? chipStatusOf(task.state) : "idle";

    // First render: drop straight into place, no animation.
    if (this.displayIndex < 0) {
      this.displayIndex = idx;
      setText(this.a, idx > 0 ? steps[idx - 1] : "…");
      this.setChip(steps[Math.max(idx, 0)]);
      this.rest();
      return;
    }

    // The session restarted (steps were cleared): re-seed rather than scroll.
    if (idx < this.displayIndex) {
      this.queue = [];
      this.startMs = null;
      this.displayIndex = idx;
      setText(this.a, idx > 0 ? steps[idx - 1] : "…");
      this.setChip(steps[Math.max(idx, 0)], this.chipStatus === "running");
      this.rest();
      return;
    }

    for (let i = this.displayIndex + 1; i <= idx; i++) this.queue.push(steps[i]);
    this.displayIndex = idx;
    if (this.queue.length > MAX_QUEUE) {
      this.queue = this.queue.slice(-MAX_QUEUE);
    }
    // Status-only change (finished/error mid-run): patch the chip, keep the text.
    this.setChip(this.b.text);
  }

  /** Called every frame by the island while the overview is on screen. */
  tick(nowMs: number) {
    this.chip.tick(nowMs); // the clock runs even while no scroll is queued
    if (this.startMs == null) {
      if (this.queue.length === 0) return;
      setText(this.c, this.queue[0]);
      place(this.c, ROW_H * 2, 0, 0);
      this.startMs = nowMs;
    }

    const p = clamp((nowMs - this.startMs) / DURATION, 0, 1);
    const e = EASE(p);

    // A leaves upwards and fades a little faster than it moves, as on macOS.
    place(this.a, lerp(0, -ROW_H, e), 1, clamp(1 - p * 1.35, 0, 1));
    placeEl(this.b.el, lerp(ROW_H, 0, e), e, 1);
    place(this.c, lerp(ROW_H * 2, ROW_H, e), 0, e);

    if (p < 1) return;

    // Commit: the current row becomes the completed one, the incoming row the
    // current one. Texts move, elements stay put — no reordering, no overlap.
    setText(this.a, this.b.text);
    this.setChip(this.c.text, this.chipStatus === "running"); // a new step re-arms the wipe
    this.queue.shift();
    this.startMs = null;
    this.rest();
  }
}
