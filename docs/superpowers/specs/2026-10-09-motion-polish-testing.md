# Motion & Visual Polish — Testing & Acceptance

Date: 2026-10-09 · Companion to docs/superpowers/specs/2026-10-09-motion-polish-design.md

## Requirements (each maps to a test)

- REQ-M01 Island open uses spring response 0.5 s / damping 0.72; close uses 340 ms cubic-bezier(.45,0,.2,1). (anim.test.mjs)
- REQ-M02 Content leaves in 160 ms, enters in 300 ms starting 120 ms after the container grows; items stagger 35 ms. (anim.test.mjs + E2E-04)
- REQ-M03 No view switch shows a blank frame longer than one frame (60 fps). (E2E-03)
- REQ-M04 No view rebuilds its DOM on a state notify while active — dashboard, stopwatch, weather, banners, compact status patch in place. (E2E-05 + manual devtools DOM-breakpoint check)
- REQ-M05 Progress fills (media, stats, sliders) animate transform only — no width writes. (E2E-06 + code review)
- REQ-M06 With prefers-reduced-motion, every transition completes ≤ 20 ms, infinite animations are disabled, springs snap. (anim.test.mjs + E2E-07)
- REQ-M07 Island hidden → 0 % CPU (no rAF frames over 5 s, no poll threads). (E2E-08, Task 20 method)
- REQ-M08 Open/close frame time p95 < 8 ms (devtools Performance, 10 iterations). (E2E-08)
- REQ-M09 Every custom property used in settings.css exists in tokens.css. (token parity check)
- REQ-M10 Accent colour has exactly one source: the --accent custom property; all fills/banners use it. (E2E-09)

## E2E manual checklist (release gate — tauri dev)

1. Open/close ×50 — no stutter, no flicker, radius follows the spring.
2. Every tab-group tab switch (Home/Agents/Media/System/Tools) + sub-pills — content handoff is continuous.
3. View switch matrix spot-check: dashboard ↔ media ↔ stats ↔ controlCenter ↔ bluetooth ↔ pomodoro ↔ stopwatch ↔ weather ↔ overview — no blank frame.
4. Slider drags (volume, brightness) — no layout reads mid-drag, handle feedback.
5. Toggle flips (DND, night light, switches in settings) — thumb spring + colour crossfade.
6. Pill hovers + presses — unified press scale.
7. Banner show/dismiss (copy a URL) — no rebuild churn while visible.
8. Compact strip (timer + media + battery) — patches in place at 1 Hz.
9. Settings window: open/close, section toggles, control hover/press, effect + accent pickers apply live to the island.
10. Greeting choreography + upload drop sequence — unchanged timing, smoother handoff.
11. Ticker queue under load (rapid session events) — no stalled steps.
12. Reduced motion (Windows Settings → Accessibility → Animation effects → off): everything ≤ 20 ms, no infinite animation.

## Perf gates

- Frame time during open/close: p95 < 8 ms over 10 iterations (devtools Performance panel).
- Hidden island: 0 rAF frames over 5 s; process CPU 0.00 % over 12 s (Task 20 method).
- No forced reflow warnings in devtools console during any interaction.
