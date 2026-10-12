// SwipeRow — React Bits' Micro/SwipeRow, ported onto the pomodoro task rows.
//
// Kept: the leftward drag that reveals a Delete drawer, rubber-band on both
// ends of the travel, a 60 % / hard-flick commit that folds the row *before*
// the list rebuild drops it, and the `inv` that lets a second grab resume a
// mid-open grip without a jump. Dropped: the `motion` springs (the settle is a
// CSS transition on the house curve), multi-action rails, the hidden toggle
// button, haptics and the keyboard path — the row's existing × stays the
// keyboard and pointer fail-safe, and the drawer's Delete is a label, not a
// second control.

import { prefersReduced } from "../core/anim";
import { h } from "../views/dom";
import { project, rubber, velocityOf } from "./pointer";

/** A press only becomes a drag past this many pixels. */
const HYST = 10;
/** Release speed (px/s) that decides by velocity alone. */
const FLICK = 110;
/** Fraction of the row width past which a release commits. */
const COMMIT_AT = 0.6;
/** Drawer width — one Delete action. */
const ACTION_W = 56;
/** Fold length; must match `.swipe-row[data-phase="collapsing"]` in style.css. */
const COLLAPSE_MS = 200;
/** Over-drag resistance — the reference's default `resistance`. */
const C = 0.55;

/** The shared `rubber`'s inverse (reference lines 20 + 124-132). */
const unrubber = (y: number, dim: number, c: number) =>
  (y * dim) / (c * Math.max(1, dim - Math.abs(y)));

export interface SwipeRow {
  /** Clip container; holds the drawer and the surface. */
  el: HTMLElement;
  /** Append the row content here — it is what the drag translates. */
  surface: HTMLElement;
}

export function createSwipeRow(opts: {
  onCommit: () => void; // called AFTER the fold completes
  label?: string; // aria-label, default "Task"
}): SwipeRow {
  const surface = h("div", { class: "swipe-row__surface" });
  const root = h(
    "div",
    {
      class: "swipe-row",
      role: "group",
      "aria-label": opts.label ?? "Task",
      "data-phase": "idle",
    },
    h(
      "div",
      { class: "swipe-row__drawer" },
      h("button", { type: "button", text: "Delete", tabindex: "-1" }),
    ),
    surface,
  );

  /** Row width, re-read on each grab — the island never resizes mid-drag. */
  let w = 360;
  /** The surface's translateX — negative when the drawer is revealed. */
  let x = 0;
  const exposed = () => -x;
  const commitPoint = () => Math.max(COMMIT_AT * w, ACTION_W + ACTION_W / 2);
  const canCommit = () => commitPoint() <= w;

  // map/inv — the reference's rubber pair (lines 115-132), single action so
  // D = ACTION_W and the knee only exists when a commit is possible.
  const map = (raw: number): number => {
    if (raw < 0) return rubber(raw, w, C);
    if (raw <= ACTION_W) return raw;
    if (!canCommit()) return ACTION_W + rubber(raw - ACTION_W, w, C);
    const cp = commitPoint();
    const knee = ACTION_W + (cp - ACTION_W) / C;
    return raw <= knee ? ACTION_W + C * (raw - ACTION_W) : cp + rubber(raw - knee, w, C);
  };
  const inv = (ex: number): number => {
    if (ex < 0) return unrubber(ex, w, C);
    if (ex <= ACTION_W) return ex;
    if (!canCommit()) return ACTION_W + unrubber(ex - ACTION_W, w, C);
    const cp = commitPoint();
    const knee = ACTION_W + (cp - ACTION_W) / C;
    return ex <= cp ? ACTION_W + (ex - ACTION_W) / C : knee + unrubber(ex - cp, w, C);
  };

  const moveTo = (ex: number) => {
    x = -ex;
    surface.style.transform = `translateX(${x}px)`;
  };

  let grip: {
    id: number;
    x0: number;
    y0: number;
    /** Pointer grab offset once axis-locked; null until then. */
    grab: number | null;
    /** [time, exposure] — exposure-space, so a positive v opens. */
    hist: [number, number][];
  } | null = null;
  /** A moved drag's release leaves a synthesized click behind; swallow it. */
  let swallow = false;

  // The reference's watchWindow (lines 37-52): events over child elements can
  // die before reaching the surface, so the live gesture also listens on the window.
  const winMove = (e: PointerEvent) => {
    if (grip?.id === e.pointerId) move(e);
  };
  const winUp = (e: PointerEvent) => {
    if (grip?.id === e.pointerId) up(e);
  };
  const unwatch = () => {
    window.removeEventListener("pointermove", winMove);
    window.removeEventListener("pointerup", winUp);
    window.removeEventListener("pointercancel", winUp);
  };

  const down = (e: PointerEvent) => {
    swallow = false; // a stale swallow must never eat the next real tap
    if (e.button !== 0 || grip || root.getAttribute("data-phase") !== "idle") return;
    w = root.offsetWidth || w;
    grip = { id: e.pointerId, x0: e.clientX, y0: e.clientY, grab: null, hist: [] };
    try {
      surface.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic event has no live pointer to capture */
    }
    window.addEventListener("pointermove", winMove);
    window.addEventListener("pointerup", winUp);
    window.addEventListener("pointercancel", winUp);
  };

  const move = (e: PointerEvent) => {
    const g = grip;
    if (!g) return;
    if (g.grab === null) {
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      // Axis lock: a vertical scroll over the list must not start a drawer.
      if (Math.abs(dx) < HYST || Math.abs(dx) < Math.abs(dy)) return;
      // inv() eats the hysteresis so the grip resumes without a jump.
      g.grab = -(g.x0 + Math.sign(dx) * HYST) - inv(exposed());
      root.setAttribute("data-dragging", "");
      root.setAttribute("data-phase", "dragging");
    }
    const ex = map(-e.clientX - g.grab);
    moveTo(ex);
    g.hist.push([performance.now(), ex]);
    if (g.hist.length > 4) g.hist.shift();
    if (canCommit() && ex >= commitPoint()) root.setAttribute("data-armed", "");
    else root.removeAttribute("data-armed");
  };

  const fold = () => {
    root.setAttribute("data-phase", "collapsing");
    if (prefersReduced()) {
      opts.onCommit();
      return;
    }
    // A real measured height — the rows are content-sized.
    root.style.transition = `height ${COLLAPSE_MS}ms ease, opacity ${COLLAPSE_MS}ms ease`;
    root.style.height = `${root.offsetHeight}px`;
    void root.offsetHeight; // reflow: commit the start height before zeroing it
    root.style.height = "0";
    root.style.opacity = "0";
  };

  const up = (e: PointerEvent) => {
    const g = grip;
    if (!g || g.id !== e.pointerId) return;
    grip = null;
    unwatch();
    root.removeAttribute("data-dragging");
    try {
      surface.releasePointerCapture(e.pointerId);
    } catch {
      /* see down */
    }
    root.removeAttribute("data-armed");
    if (g.grab === null) return; // never axis-locked: a tap or a vertical drag
    // The browser will synthesize a click after this release; it must not
    // toggle the SpringCheck or hit the × as a side effect of the swipe.
    swallow = true;
    const ex = exposed();
    const v = velocityOf(g.hist);
    if (canCommit() && ex >= commitPoint()) {
      fold();
      return;
    }
    const open = Math.abs(v) >= FLICK ? v > 0 : ex + project(v) > ACTION_W / 2;
    const target = open ? ACTION_W : 0;
    if (Math.abs(ex - target) < 0.5) {
      // Nothing to travel — a transition would never end, leaving the row
      // stuck in `settling`. Land idle in place.
      moveTo(target);
      root.setAttribute("data-phase", "idle");
      return;
    }
    root.setAttribute("data-phase", "settling");
    moveTo(target);
  };

  surface.addEventListener("pointerdown", down);
  // Mirrors squishswitch's swallow: capture runs before the SpringCheck / ×
  // handlers, so a moved drag's leftover click dies here — a tap that never
  // moved isn't armed and reaches them unchanged.
  surface.addEventListener(
    "click",
    (e) => {
      if (!swallow) return;
      swallow = false;
      e.stopImmediatePropagation();
      e.preventDefault();
    },
    true,
  );
  surface.addEventListener("transitionend", (e) => {
    if (e.propertyName !== "transform") return;
    if (root.getAttribute("data-phase") === "settling") root.setAttribute("data-phase", "idle");
  });
  root.addEventListener("transitionend", (e) => {
    if (e.propertyName !== "height" || root.getAttribute("data-phase") !== "collapsing") return;
    root.style.removeProperty("height");
    root.style.removeProperty("opacity");
    opts.onCommit();
  });

  return { el: root, surface };
}
