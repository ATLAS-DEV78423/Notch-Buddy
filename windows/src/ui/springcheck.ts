// SpringCheck — React Bits' Micro/SpringCheck, ported to the island's DOM.
//
// Kept from the reference: the fill that swells out of the box centre, the tick
// drawn over it, the words dimming, and the rule that wipes through them. One
// control replaces both halves of the old row — the checkbox *and* the
// text-decoration line — so the strike is drawn rather than inherited.
//
// Dropped: the `motion` spring. The island's frame loop has no per-view
// "animating" flag (see Island.frame in island.ts), so a spring driven from
// view.tick() would freeze the moment the loop settles. The reference's single
// `t ∈ 0…1` reading is expressed as CSS transitions on one `data-on` attribute
// instead: same order, same ease, no clock and no timer.

import { h } from "../views/dom";

const SVG_NS = "http://www.w3.org/2000/svg";
/** The reference's Tick02Icon path, on the same 24×24 grid as icons.ts. */
const TICK = "M5.2 12.6 9.6 17 18.8 7.4";

export interface SpringCheck {
  el: HTMLElement;
  /** Writes the state without replaying the swell — used when a row is reused. */
  set(checked: boolean): void;
}

export function createSpringCheck(opts: {
  label: string;
  checked: boolean;
  onChange(next: boolean): void;
}): SpringCheck {
  const tick = document.createElementNS(SVG_NS, "svg");
  tick.setAttribute("class", "spring-check__tick");
  tick.setAttribute("viewBox", "0 0 24 24");
  tick.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", TICK);
  path.setAttribute("pathLength", "1");
  tick.append(path);

  const box = h(
    "span",
    { class: "spring-check__box" },
    h("span", { class: "spring-check__ring" }),
    h("span", { class: "spring-check__fill" }),
    tick,
  );
  const word = h("span", { class: "spring-check__word", text: opts.label });

  const el = h(
    "button",
    { type: "button", role: "checkbox", class: "spring-check" },
    h("span", { class: "spring-check__press" }, box),
    h("span", { class: "spring-check__label" }, word, h("span", { class: "spring-check__rule" })),
  );

  let on = opts.checked;

  /** Writes state and ARIA only. `set()` uses this, so reusing a row is silent. */
  const paint = () => {
    el.setAttribute("aria-checked", String(on));
    if (on) el.setAttribute("data-on", "");
    else el.removeAttribute("data-on");
  };

  paint();
  // The first paint must not animate: a row built already-checked has nothing to
  // replay. Transitions are gated on this, armed one frame after insertion.
  requestAnimationFrame(() => el.setAttribute("data-ready", ""));

  el.addEventListener("click", () => {
    const next = !on;
    on = next;
    paint();
    // Restart the swell even if the previous one is still running.
    el.removeAttribute("data-swell");
    void el.offsetWidth;
    el.setAttribute("data-swell", "");
    opts.onChange(next);
  });

  el.addEventListener("pointerdown", (e) => {
    if (e.button === 0) el.setAttribute("data-pressed", "");
  });
  for (const ev of ["pointerup", "pointercancel", "pointerleave"] as const) {
    el.addEventListener(ev, () => el.removeAttribute("data-pressed"));
  }

  return {
    el,
    set(checked: boolean) {
      if (checked === on) return;
      on = checked;
      paint();
    },
  };
}
