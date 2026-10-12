// SquishSwitch — React Bits' Micro/SquishSwitch, ported onto the switch this app
// already ships.
//
// It is an *upgrade*, not a replacement: the element stays the same
// `button.switch` with the same `.on` class and the same click handler, so every
// existing call site keeps working untouched. What the port adds is the reference's
// signature — a thumb that stretches with the speed of its own travel, and a
// drag past the middle that commits.
//
// Dropped: the `motion` springs. `useVelocity`/`useSpring` need a frame loop, and
// the island's loop has no per-view flag, so a spring stepped from `tick()` would
// stall the moment the island settles. The drag's real pointer velocity drives the
// stretch directly, and the settle is a CSS transition on a bouncy curve.
//
// Geometry is read from `--sw-w/--sw-h/--sw-inset/--sw-thumb/--sw-travel`, which
// each window's stylesheet declares — the island's track is 32×18 and the settings
// window's is 36×20, and this module must not care which it is looking at.

import { clamp } from "../core/anim";
import { velocityOf } from "./pointer";

/** A press only becomes a drag past this many pixels. */
const DEAD_ZONE = 4;
/** The reference's MAX_STRETCH / STRETCH_SPEED. */
const MAX_STRETCH = 0.4;
const STRETCH_SPEED = 600;
/** Release speed (px/s) that commits without waiting for the midpoint. */
const FLICK = 320;

/**
 * The settings window never calls `initMotionPreferences()`, so `prefersReduced()`
 * would read its default `false` there. Ask the media query directly — correct in
 * both windows and independent of boot order.
 */
const reduced = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function travelOf(el: HTMLElement): number {
  const raw = getComputedStyle(el).getPropertyValue("--sw-travel").trim();
  const px = parseFloat(raw);
  return Number.isFinite(px) ? px : 0;
}

/** Upgrades a `button.switch` in place. Idempotent. */
export function squishSwitch(el: HTMLButtonElement): void {
  if (el.dataset.squish) return;
  el.dataset.squish = "squish";

  const inner = document.createElement("span");
  inner.className = "switch__thumb-in";
  const thumb = document.createElement("span");
  thumb.className = "switch__thumb";
  thumb.append(inner);
  el.append(thumb);

  let grab: {
    id: number;
    x0: number;
    wasOn: boolean;
    moved: boolean;
    hist: [number, number][];
  } | null = null;
  /** A committed drag already called click(); swallow the browser's own. */
  let swallow = false;

  const stretch = (el_: HTMLElement, v: number) => {
    const gain = reduced() ? 0 : 1;
    const s = 1 + Math.min(MAX_STRETCH, Math.abs(v) / STRETCH_SPEED) * gain;
    el_.style.setProperty("--sw-sx", String(s));
    el_.style.setProperty("--sw-sy", String(1 / s));
  };

  const down = (e: PointerEvent) => {
    if (e.button !== 0 || grab) return;
    grab = {
      id: e.pointerId,
      x0: e.clientX,
      wasOn: el.classList.contains("on"),
      moved: false,
      hist: [[performance.now(), 0]],
    };
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic event has no live pointer to capture */
    }
  };

  const move = (e: PointerEvent) => {
    if (!grab || grab.id !== e.pointerId) return;
    const dx = e.clientX - grab.x0;
    if (!grab.moved) {
      if (Math.abs(dx) < DEAD_ZONE) return;
      grab.moved = true;
      el.setAttribute("data-held", "");
      thumb.style.setProperty("--sw-x", `${grab.wasOn ? travelOf(el) : 0}px`);
    }
    const x = clamp((grab.wasOn ? travelOf(el) : 0) + dx, 0, travelOf(el));
    thumb.style.setProperty("--sw-x", `${x}px`);
    grab.hist.push([performance.now(), x]);
    if (grab.hist.length > 4) grab.hist.shift();
    stretch(inner, velocityOf(grab.hist));
  };

  const up = (e: PointerEvent, cancelled: boolean) => {
    const g = grab;
    if (!g || g.id !== e.pointerId) return;
    grab = null;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* see above */
    }
    const v = velocityOf(g.hist);
    if (!g.moved) return; // a tap: the click handler below owns it
    const travel = travelOf(el);
    const x = parseFloat(thumb.style.getPropertyValue("--sw-x")) || 0;
    const next = cancelled ? g.wasOn : Math.abs(v) > FLICK ? v > 0 : x > travel / 2;
    el.removeAttribute("data-held");
    thumb.style.removeProperty("--sw-x");
    stretch(inner, 0);
    if (next !== g.wasOn) {
      // Reuse the call site's own handler — including any guard it enforces
      // (the integrations list refuses a fifth pill). If it declines, the class
      // is unchanged and the thumb simply settles back where it started.
      swallow = g.wasOn;
      el.click();
    }
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", (e) => up(e, false));
  el.addEventListener("pointercancel", (e) => up(e, true));

  // Ours runs before the call site's click handler; stopping the event here keeps
  // a committed drag from toggling a second time.
  el.addEventListener(
    "click",
    (e) => {
      if (swallow) {
        swallow = false;
        e.stopImmediatePropagation();
        e.preventDefault();
        return;
      }
      el.removeAttribute("data-squish");
      void el.offsetWidth; // restart the squish on a tap
      el.setAttribute("data-squish", "");
    },
    true,
  );
}
