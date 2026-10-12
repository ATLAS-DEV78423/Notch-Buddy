// TabSegment — the header's five group buttons read as one track: a single
// thumb slides between slots instead of each button painting its own fill.
//
// The motion is a CSS transition, not a `Tracked` spring: the header has no
// frame source of its own (same call squishswitch made), and a CSS transition
// is already interruptible — a retarget mid-flight just re-aims it.

import { h } from "../views/dom";

type Slot = { x: number; w: number };

/** Inserts a thumb behind `host`'s labels; returns the updater for `sync()`. */
export function attachTabSegment(host: HTMLElement): (active: HTMLElement) => void {
  const thumb = h("span", { class: "tab-seg-thumb", "aria-hidden": "true" });
  host.prepend(thumb);

  const buttons = Array.from(host.querySelectorAll<HTMLElement>(".tab-group"));
  const slots = new Map<HTMLElement, Slot>();
  const measure = () => {
    slots.clear();
    for (const b of buttons) slots.set(b, { x: b.offsetLeft, w: b.offsetWidth });
  };

  let active: HTMLElement | null = null;
  let placed = false;

  const place = (btn: HTMLElement, glide: boolean) => {
    let s = slots.get(btn);
    if (!s?.w) {
      measure(); // first run, or laid out after a font/zoom change
      s = slots.get(btn)!;
    }
    if (!glide) thumb.style.transition = "none";
    thumb.style.width = `${s.w}px`;
    thumb.style.transform = `translateX(${s.x}px)`;
    if (!glide) {
      void thumb.offsetWidth; // commit the jump before the transition returns
      thumb.style.transition = "";
    }
  };

  // One listener for the whole module: the island window is resized with the
  // island, so the slots have to be re-measured and the thumb re-aimed.
  window.addEventListener("resize", () => {
    measure();
    if (active) place(active, false);
  });

  return (btn) => {
    if (btn === active) return;
    active = btn;
    place(btn, placed); // first placement lands, it does not glide
    placed = true;
  };
}
