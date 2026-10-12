// SwipeToast — React Bits' Micro/SwipeToast, ported onto the in-island banner.
//
// Kept from the reference: a burning fuse that *is* the time-to-live, a downward
// swipe that flings the card away, pausing on hover so a notice cannot vanish
// while it is being read, and an exit chord before removal. Dropped: the `motion`
// springs (the release settle is a CSS transition) and the `fuse: "top"` variant.
//
// This module owns no clock. Every deadline it mirrors is re-read from
// `remaining()`, which the caller backs with `State.bannerRemaining()` — so the
// fuse, the exit chord and the dismissal all count the same milliseconds, and a
// pause banks the remainder in one place.

import { h } from "../views/dom";
import { rubber, velocityOf } from "./pointer";

export type ToastReason = "timeout" | "swipe" | "action" | "close" | "escape";

export interface ToastOptions {
  /** The first line: the URL slice or the notice text. */
  title: string;
  /** Shown only when there is something to open. */
  actionLabel?: string;
  onAction?: () => void;
  /** Called once, after the exit chord, for every dismissal this module starts. */
  onClose: (reason: ToastReason) => void;
  /** Milliseconds left before the banner dismisses itself. */
  remaining: () => number;
  pause: () => void;
  resume: () => void;
}

/** The exit chord, in ms — must match `.banner[data-leaving]` in style.css. */
const EXIT_MS = 220;
/** A release only becomes a swipe past this many pixels. */
const DEAD_ZONE = 4;
/** How far a slow drag must travel before release dismisses. */
const SWIPE_PX = 40;
/** Release speed (px/s) that dismisses without waiting for the distance. */
const FLICK = 110;
/** How much of an upward over-drag the card keeps. */
const RESIST_PX = 24;

export interface SwipeToast {
  el: HTMLElement;
  destroy(): void;
}

export function createSwipeToast(o: ToastOptions): SwipeToast {
  const text = h("span", { class: "banner-text", text: o.title });
  const card = h(
    "div",
    { class: "banner", tabindex: "0" },
    text,
    o.actionLabel
      ? h("button", {
          class: "banner-open",
          text: o.actionLabel,
          onclick: () => {
            o.onAction?.();
            dismiss("action");
          },
        })
      : null,
    h("button", {
      class: "banner-close",
      text: "×",
      "aria-label": "Dismiss",
      onclick: () => dismiss("close"),
    }),
    h("i", { class: "banner-fuse", "aria-hidden": "true" }),
  );

  /** The fuse drains over exactly the remaining TTL. */
  const fuse = card.lastElementChild as HTMLElement;
  const total = Math.max(0, o.remaining());
  fuse.style.setProperty("--fuse-duration", `${total}ms`);

  let done = false;
  let frozen = false;
  let leaveAt: number | null = null;
  let exitAt: number | null = null;

  const clearTimers = () => {
    if (leaveAt !== null) window.clearTimeout(leaveAt);
    if (exitAt !== null) window.clearTimeout(exitAt);
    leaveAt = null;
    exitAt = null;
  };

  /**
   * Mirrors the caller's deadline, `EXIT_MS` early, so the card is already
   * lifting when `State` nulls the banner and the host goes `display: none`.
   * This timer never dismisses anything — `State` stays the one authority.
   */
  const arm = () => {
    clearTimers();
    if (done || frozen) return;
    const left = o.remaining();
    if (left <= 0) return;
    if (left > EXIT_MS) {
      leaveAt = window.setTimeout(() => card.setAttribute("data-leaving", "up"), left - EXIT_MS);
    } else {
      card.setAttribute("data-leaving", "up");
    }
  };

  const freeze = () => {
    if (frozen || done) return;
    frozen = true;
    card.setAttribute("data-frozen", "");
    clearTimers();
    o.pause();
  };

  const thaw = () => {
    if (!frozen || done) return;
    frozen = false;
    card.removeAttribute("data-frozen");
    o.resume();
    arm();
  };

  /** Plays the chord, then reports. Swipe direction is the card's own travel. */
  const dismiss = (reason: ToastReason, down = false) => {
    if (done) return;
    done = true;
    clearTimers();
    o.resume(); // a dismissal unfreezes whatever the hover banked
    card.setAttribute("data-leaving", down ? "down" : "up");
    exitAt = window.setTimeout(() => o.onClose(reason), down ? 180 : EXIT_MS);
  };

  // ── Swipe down ────────────────────────────────────────────────────────────
  let drag: { id: number; y0: number; moved: boolean; hist: [number, number][] } | null = null;

  const offsetOf = () => parseFloat(card.style.getPropertyValue("--toast-y")) || 0;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || drag || done) return;
    // A press on the action or the × belongs to that button, and a card that is
    // already leaving is committed: `dismiss` owns it from there.
    if ((e.target as HTMLElement | null)?.closest("button")) return;
    card.removeAttribute("data-returning"); // the next drag tracks 1:1 again
    drag = { id: e.pointerId, y0: e.clientY, moved: false, hist: [[performance.now(), 0]] };
    try {
      card.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic event has no live pointer to capture */
    }
  };

  const onMove = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    const raw = e.clientY - drag.y0;
    if (!drag.moved) {
      if (Math.abs(raw) < DEAD_ZONE) return;
      drag.moved = true;
      card.setAttribute("data-swiping", "");
    }
    // Upward is resistance only: this notice leaves downwards.
    const y = raw >= 0 ? raw : rubber(raw, RESIST_PX);
    card.style.setProperty("--toast-y", `${y}px`);
    drag.hist.push([performance.now(), y]);
    if (drag.hist.length > 4) drag.hist.shift();
  };

  const onUp = (e: PointerEvent, cancelled: boolean) => {
    const g = drag;
    if (!g || g.id !== e.pointerId) return;
    drag = null;
    card.removeAttribute("data-swiping");
    try {
      card.releasePointerCapture(e.pointerId);
    } catch {
      /* see above */
    }
    const y = offsetOf();
    const v = velocityOf(g.hist);
    if (!cancelled && (v > FLICK || (y >= SWIPE_PX && v >= 0))) {
      dismiss("swipe", true);
      return;
    }
    if (g.moved) {
      card.removeAttribute("data-returning");
      void card.offsetWidth; // restart the settle on the next drag
      card.setAttribute("data-returning", "");
      card.style.removeProperty("--toast-y");
    }
  };

  card.addEventListener("pointerdown", onDown);
  card.addEventListener("pointermove", onMove);
  card.addEventListener("pointerup", (e) => onUp(e, false));
  card.addEventListener("pointercancel", (e) => onUp(e, true));

  // ── Hover / focus pause ───────────────────────────────────────────────────
  const enter = (e: Event) => {
    if ((e as PointerEvent).pointerType && (e as PointerEvent).pointerType !== "mouse") return;
    freeze();
  };
  const leave = () => thaw();
  card.addEventListener("pointerenter", enter);
  card.addEventListener("pointerleave", leave);
  card.addEventListener("focusin", freeze);
  card.addEventListener("focusout", leave);

  card.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      dismiss("escape");
    }
  });

  arm();

  return {
    el: card,
    destroy() {
      done = true;
      clearTimers();
      drag = null;
      card.replaceChildren();
    },
  };
}
