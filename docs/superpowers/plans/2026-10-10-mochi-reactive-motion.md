# Mochi Reactive Motion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Ponytail discipline (ultra) is ACTIVE for every implementer.

**Goal:** Per-property springs for the island shell + a Mochi reaction bus that makes the blob the living indicator of system, media, agent and touch events, plus the DOM choreography features (digits, marquee, exits, hover-grace, event-peek).

**Architecture:** A ~40-line semi-implicit Euler spring integrator rides the island's existing frame loop (no second clock); shell geometry (width/height/y/radius) retargets through four springs. A reaction bus composes persistent conditions > session state > media > transient flashes onto Mochi's canvas engine via additive aura/prop/pose hooks. DOM features are CSS-led where possible.

**Tech Stack:** TypeScript strict, Tauri v2, vanilla DOM, hand-rolled canvas engine (`mochi/`). Shell: PowerShell 5.1 (no `&&`, no `| cat`).

**Spec:** `docs/superpowers/specs/2026-10-10-mochi-reactive-motion-design.md` (plan argues from the spec; executors read both).

**Documented deviations from the spec (controller-approved, ponytail):**
1. Spec §4.2 "one new Rust power command" → **JS Battery Status API** (`navigator.getBattery()`, supported by WebView2/Chromium). Zero Rust, zero new crates; if unavailable at runtime, battery reactions simply never fire. Implementer verifies availability and reports.
2. Spec §6 harness placement (settings window) → **island window query flag** `?reactions=1` (in-process with the bus and engine — no cross-window IPC; hidden overlay chip row, dev-only).

## Global Constraints

- No new npm dependencies. No `color-mix()` (chrome110). TypeScript strict; build target chrome110.
- One frame loop: the island's existing loop (the one ticking Mochi canvases). Springs/reactions are passengers; sleeping springs must be skipped by the loop (0 %-CPU-when-hidden preserved).
- Easing: springs for shell geometry; CSS curve `cubic-bezier(0.23, 1, 0.32, 1)` for micro-states; ONE declared second curve for roll-digits only: `cubic-bezier(0.22, 1, 0.36, 1)`. No other curves.
- Reduced motion (`prefersReduced()` + the global CSS block at style.css ~2154): springs jump instantly; digits snap; aura/particles still allowed (they are state indication, not motion chrome) but jitter/beat animations freeze.
- Existing Mochi poses/views are never restyled — additive only.
- Busy-gate tombstone: the hidden arm of the island visibility ternary ignores everything but `settling`; shell springs snap-and-sleep when hiding. Never add an expression true-while-hidden to the gate.
- Tokens/curves live in `core/motion-tokens.ts` and CSS custom properties; no magic numbers scattered.
- Git: explicit paths only, NEVER `git add .` (the tree carries ~200 unrelated dirty files). One commit per task (plus fix commits from reviews).
- Verification every task: `npm run build *> $env:TEMP\build.log; "exit=$LASTEXITCODE"; (Select-String -Path $env:TEMP\build.log -Pattern "error TS" -SimpleMatch | Measure-Object).Count` from `windows/` → expect `exit=0`, `0`. Run `node --experimental-strip-types src/core/spring.test.mjs` whenever `spring.ts` changes (and `anim.test.mjs` stays green — `anim.ts` is never edited).
- No UI unit-test framework beyond the node assert runners (`*.test.mjs`); do not invent one.

## Parallel schedule (controller wiring — implementers ignore)

- **Wave A (parallel):** Task 1 (springs) ‖ Task 3 (engine+bus+harness) — zero shared files.
- **Wave B:** Task 2 (island.ts shell+peek+grace) — needs T1.
- **Wave C:** Task 6 (DOM features: views/ticker/style) — after T2 frees island.ts (T6 touches island.ts only for the leaving-class hook, appended at the end).
- **Wave D:** Task 4 (all reaction wiring: island.ts + views.ts + engine hookup) — needs T2, T3, T6.
- **Wave E:** Task 5 (battery poller) — needs T3, T4.
- **Wave F:** Task 7 (end-to-end pass) — needs all.
Reviews run as subagent seats pipelined behind each implement.

---

### Task 1: Spring core + tokens + test

**Files:**
- Create: `windows/src/core/spring.ts`
- Create: `windows/src/core/motion-tokens.ts`
- Create: `windows/src/core/spring.test.mjs`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (Tasks 2+ rely on these EXACT names):
  ```ts
  export interface SpringCfg { k: number; c: number; m?: number; restDelta?: number; }
  export interface Spring {
    set(target: number, immediate?: boolean): void;
    step(dtMs: number): number;   // returns the new value; no-op when done
    readonly done: boolean;
    readonly value: number;
    readonly target: number;
    readonly v: number;
  }
  export function spring(from: number, cfg: SpringCfg): Spring;
  ```
  ```ts
  // motion-tokens.ts
  import type { SpringCfg } from "./spring";
  export const SHELL_WIDTH: SpringCfg = { k: 400, c: 31 };
  export const SHELL_HEIGHT: SpringCfg = { k: 450, c: 29 };
  export const SHELL_Y: SpringCfg = { k: 550, c: 45, m: 0.8, restDelta: 0.001 };
  export const SHELL_RADIUS: SpringCfg = { k: 1000, c: 40 };
  export const DEFAULT: SpringCfg = { k: 500, c: 30 };
  ```

- [ ] **Step 1: Write `spring.test.mjs`** (mirror `anim.test.mjs` style: node assert runner, prints OK at the end). Cover:
  1. settle: `spring(0, {k:400,c:31})`, `set(100)`, step 16 ms until `done` (cap 5000 steps) → final value === 100 exactly, `|v| === 0`, and it reached within 1 of target in < 400 ms of accumulated time.
  2. retarget mid-flight: after 100 ms of stepping, `set(0)` → value continues from current position (no teleport: first post-retarget step changes value by < 30), eventually settles at 0.
  3. immediate: `set(50, true)` → `value === 50`, `done === true` on the next `step` (and `step` returns 50).
  4. sleep: once `done`, further `step` calls return the settled value and do not change `v`.
  5. clamp: a single `step(1000)` does not explode (`Number.isFinite(value)` after; the integrator clamps dt to 32 ms internally).
- [ ] **Step 2: Run the test — expect FAIL** (`node --experimental-strip-types src/core/spring.test.mjs` from `windows/`): module not found.
- [ ] **Step 3: Implement `spring.ts`.** Semi-implicit Euler, dt seconds internally, dt clamped to 32 ms per call:
  ```ts
  const dtSec = Math.min(dtMs, 32) / 1000;
  const acc = (-cfg.k * (this.value - this.target) - cfg.c * this.v) / m;
  this.v += acc * dtSec;
  this.value += this.v * dtSec;
  // settle check:
  if (Math.abs(this.v) < rd && Math.abs(this.value - this.target) < rd) {
    this.value = this.target; this.v = 0; this.done = true;
  }
  ```
  Defaults: `m = 1`, `restDelta = 0.01`. `set(t, immediate)` resets `done = false` (immediate also snaps value/v). These k/c are tuned to bloom's framer feel in this integrator; adjust constants ONLY if the test's settle-time bound fails, never the structure.
- [ ] **Step 4: Run the test — expect PASS**, output pristine. Also run `node --experimental-strip-types src/core/anim.test.mjs` → still `anim motion vocabulary OK`.
- [ ] **Step 5: Commit**
  ```powershell
  git add windows/src/core/spring.ts windows/src/core/motion-tokens.ts windows/src/core/spring.test.mjs
  git commit -m "feat(windows): semi-implicit Euler spring core + shell motion tokens"
  ```

---

### Task 2: Shell springs, event-peek, hover-grace (island.ts)

**Files:**
- Modify: `windows/src/island/island.ts`

**Interfaces:**
- Consumes: `spring`, `Spring` from `core/spring`; `SHELL_WIDTH/HEIGHT/Y/RADIUS` from `core/motion-tokens`; `prefersReduced` from `core/anim`; existing island geometry targets/visibility state (read the file first — find where width/height/y/radius and show/hide are applied today).
- Produces: shell springs private to the Island class; `peek(ms: number)` public method on Island (Task 4 will call it); hover-grace internal.

- [ ] **Step 1: Read `island.ts` fully** — locate: the frame loop that ticks Mochi canvases; where shell geometry is written (CSS transitions or style writes); the visibility/hide path and the busy-gate ternary (lines ~747-752 — read but do not alter the hidden arm); the pointer enter/leave handling if any.
- [ ] **Step 2: Replace shell geometry writes with four springs.** One `private shell = { w: spring(0, SHELL_WIDTH), h: spring(0, SHELL_HEIGHT), y: spring(0, SHELL_Y), r: spring(0, SHELL_RADIUS) }`. A single `private shellTarget()` computes today's intended width/height/y/radius from existing state (reuse the existing computed-target logic; do not re-measure mid-flight). Each frame of the EXISTING loop: if any spring not `done`, `step(dt)` and write `el.style.width/height/transform translateY/borderRadius`. When ALL done → skip writes entirely (loop already continues for Mochi; the springs just no-op via `done`).
- [ ] **Step 3: Hide path snap.** In the branch that hides the island, call `w.set(hiddenW, prefersReduced() || true)` — concretely: on hide, `set(target, true)` (immediate snap) for all four. Show path: `set(target)` normally (springs animate the reveal). This keeps the hidden arm of the gate untouched and guarantees sleeping springs while hidden.
- [ ] **Step 4: Remove the now-dead CSS-transition/JS-set path** for shell geometry (whichever existed) — delete, don't strand. Leave all non-geometry transitions (content fades) alone.
- [ ] **Step 5: Hover-grace.** On pointerenter over the island surface: mark interactive, reset `graceTimer`. On pointerleave: start an 800 ms timer → if no pointer activity in between and the island's own logic would collapse it, collapse. Any pointermove/down on the island resets the timer. If the island currently collapses via view-state rather than pointerleave, adapt: the grace applies to whatever path currently collapses on pointer exit — read first, wire smallest. Comment the seam `// hover-grace: 800ms`.
- [ ] **Step 6: Event-peek.** `peek(ms = 4000)`: if island hidden, force-visible for `ms` (clear on any real user interaction with the island; do not fight `settling` — if `settling`, defer until settled then peek). Store one timeout id; re-peek replaces it.
- [ ] **Step 7: Build + verify** (build command from Global Constraints; expect exit=0, 0). Live check if an instance is available: island expand/collapse now spring-feels (width lags height slightly, radius snaps); mid-flight hover retarget reverses smoothly; hidden → 0 % CPU unaffected (springs asleep). Else "not observed".
- [ ] **Step 8: Commit**
  ```powershell
  git add windows/src/island/island.ts
  git commit -m "feat(windows): island shell driven by per-property springs + event-peek + hover-grace"
  ```

---

### Task 3: Mochi engine aura/props + reaction bus + harness

**Files:**
- Create: `windows/src/mochi/reactions.ts`
- Create: `windows/src/mochi/props.ts`
- Modify: `windows/src/mochi/engine.ts` (additive only)
- Modify: `windows/src/island/island.ts` (TICK-LOOP + REGISTRATION ONLY — two small seams; do not touch geometry/visibility code Task 2 owns)

**Interfaces:**
- Consumes: `BotEngine` and its part-drawing internals from `engine.ts` (read first: body, eyes, mouth, hands, blush, squash/tween, badge, particles — compose from these; never restyle them).
- Produces (Tasks 4+ rely on these EXACT names):
  ```ts
  // engine.ts additions (methods on BotEngine)
  setAura(color: string | null, intensity: number): void;  // radial glow behind body; null clears
  setProp(name: "headphones" | null): void;                 // extensible union later if needed
  setPoseOverride(name: string | null, ttlMs?: number): void; // null clears; ttl auto-clears
  ```
  ```ts
  // reactions.ts
  export type ReactionKind =
    | "brightness" | "volume" | "mute-flash" | "theme-sparkle"
    | "battery-drained" | "battery-charging" | "battery-full" | "dnd-sleep"
    | "approval-wave" | "session-done" | "session-error" | "session-ratelimit"
    | "media-playing" | "media-paused" | "media-loud" | "track-change"
    | "tickle" | "nuzzle";
  export function setPrimaryEngine(e: BotEngine | null): void;
  export function setCondition(kind: "battery-drained" | "battery-charging" | "battery-full" | "dnd-sleep" | "media-playing" | "media-paused", on: boolean): void;
  export function react(kind: ReactionKind, opts?: { intensity?: number; color?: string }): void;
  export function tickReactions(nowMs: number): void; // called from the island frame loop AFTER engine tick
  export const REACTION_TTL: Record<ReactionKind, number>; // brightness/volume 3000, mute 2000, theme 1500, tickle 1200, nuzzle 2000, session-done 2500, session-error 2000, approval-wave 2000, ratelimit 2000, track-change 1500
  ```
- **Pose mapping table** inside reactions.ts (map kind/condition → engine pose-override name + aura spec). Pose names for NEW poses (engine task adds): `"squint-happy"`, `"drained"`, `"perky"`, `"flex"`, `"sleep"`, `"wave"`, `"dizzy-red"` (aura variant of existing dizzy), `"pant"`, `"headphones-idle"`, `"headphones-paused"`, `"squirm"`, `"nuzzle"`. Priority resolver: conditions (battery/dnd/media pose) > session state > media-paused > transient. Transient slot: one at a time, newest wins, armed with `until = now + TTL[kind]`. Aura: independent channel — brightness/volume set intensity from `opts.intensity`; track-change sets `opts.color`; battery-drained desaturates (implement as gray aura low intensity); session-error red-tinted. Jitter (tickle) and beat-bob (media) are engine-side params set by the bus: `engine.setJitter(ms)` / beat handled via pose `"headphones-idle"` internally.
- [ ] **Step 1: Read `mochi/engine.ts` fully** (draw pipeline, tween/particle systems, BotStateCfg) and `island.ts` frame loop + how the primary engine is constructed.
- [ ] **Step 2: Additive engine hooks.** Aura: before body draw, radial gradient (color, intensity → alpha ~0.15–0.45) centered on body, radius ~1.6× body; off when null. Props: `props.ts` draws headphones (band + two cups, 2-3 rounded rects/ellipses, ink color with slight highlight — parts-vocabulary-consistent); engine calls it when prop set, after body. Pose overrides: named poses composed from existing parts (squint = eye-height param; drained = droop + sag squash + desat param; flex = hands-up (hands exist) + proud blush; squirm = time-based jitter offset + eye-shut + blush spike; etc.). Beat bob for headphones-idle: reuse existing squash tween on a ~500 ms loop while prop is set and a `playing` flag is true. Reduced motion: skip jitter/beat (poses/aura still apply).
- [ ] **Step 3: Write `reactions.ts`** per the interface: catalog table, priority resolver, transient slot, TTL map, condition map, `tickReactions` (clears expired transients/overrides, applies resolved pose+aura to the primary engine; no-op when `setPrimaryEngine(null)`).
- [ ] **Step 4: Island seams.** In the constructor where the primary Mochi engine is created: `setPrimaryEngine(engine)`. In the frame loop, after the engine tick: `tickReactions(nowMs)`. NOTHING else in island.ts.
- [ ] **Step 5: Harness (`?reactions=1`).** In the island entry (constructor or boot), `if (new URLSearchParams(location.search).has("reactions"))` append an absolutely-positioned chip row (bottom of window, `z-index` above island, tiny buttons labelled per `ReactionKind`) that calls `react(kind)` / toggles `setCondition` for condition kinds. Pure dev affordance; ~40 lines; no build flag needed. Comment `// dev harness: ?reactions=1`.
- [ ] **Step 6: Build + verify.** Build gate + `node --experimental-strip-types src/core/anim.test.mjs` (untouched but sanity). If a dev instance can run with `?reactions=1`: click through every chip; each reaction visibly fires on Mochi (aura/pose/prop/particles per table). Record per-reaction observation in the report; "not observed" is acceptable but list what the harness WOULD show per row.
- [ ] **Step 7: Commit**
  ```powershell
  git add windows/src/mochi/reactions.ts windows/src/mochi/props.ts windows/src/mochi/engine.ts windows/src/island/island.ts
  git commit -m "feat(windows): Mochi reaction bus — aura, props, pose overrides, dev harness"
  ```

---

### Task 4: Reaction wiring — touch, sliders, session events, media

**Files:**
- Modify: `windows/src/island/island.ts` (click dispatch + event subscriptions)
- Modify: `windows/src/views/views.ts` (slider/mute/theme hooks)
- Modify: `windows/src/views/backgroundEffects.ts` or its event source (media track subscription — read where track changes arrive and piggyback the same event; do not duplicate detection)

**Interfaces:**
- Consumes: `react`, `setCondition` from `mochi/reactions` (exact names from Task 3); `Island.peek()` from Task 2.
- Produces: behaviour only — no new exports other than tiny local helpers.

- [ ] **Step 1: Tickle/nuzzle.** Find the bot canvas hit path in island.ts (the canvas and any existing invisible button overlays — upload/drop hit areas keep priority). On pointerdown on the plain body: record time+target; on pointerup on the same target within 250 ms with < 10 px travel → `react("tickle")` (re-trigger allowed). Hold ≥ 500 ms without travel → `react("nuzzle")` on release. A tickle during squirm re-triggers (bus newest-wins handles stacking).
- [ ] **Step 2: Control flashes.** In `views.ts` `makeSlider`'s `apply` (the same seam Task 4 of the UI-quality plan used for the readout — it exists): brightness slider → `react("brightness", { intensity: v })`; volume slider → `react("volume", { intensity: v })`. Mute toggle handler → `react("mute-flash")`. Theme/color change path (find where theme/custom color is applied in settings or island) → `react("theme-sparkle")`. Do not flash on external `sync()` (same rule as the readout).
- [ ] **Step 3: Session events.** Find where session state transitions arrive on the Windows side (hooks/state: working/finished/error/ratelimit/permission — grep `StopFailure`, `ratelimit`, `permission` in `windows/src`). Wire: approval/permission requested → `react("approval-wave")` + `island.peek(4000)`; finished → `react("session-done")`; error → `react("session-error")`; ratelimited → `react("session-ratelimit")`. Do NOT wire working/thinking (existing focused state owns it).
- [ ] **Step 4: Media.** At the existing track-change/transport event source (backgroundEffects.ts palette sampling seam or the media module behind the status strip): playing → `setCondition("media-playing", true)`; paused/stopped → false + `setCondition("media-paused", true/false)`; track change → `react("track-change", { color: <sampled palette primary> })`; volume coupling is already handled by the slider flash — also call `react("media-loud")` only when volume apply happens while `media-playing` condition is on (bus resolves).
- [ ] **Step 5: Build + verify.** Build gate. Harness (`?reactions=1`) still works. Live if possible: tap Mochi → squirm; drag brightness → aura follows; approval during a real session → wave + peek. Else "not observed" + per-hook report.
- [ ] **Step 6: Commit**
  ```powershell
  git add windows/src/island/island.ts windows/src/views/views.ts windows/src/views/backgroundEffects.ts
  git commit -m "feat(windows): wire Mochi reactions — touch, controls, sessions, media"
  ```

---

### Task 5: Battery + DnD conditions

**Files:**
- Create: `windows/src/mochi/power.ts`
- Modify: `windows/src/island/island.ts` (registration only: start/stop poller with island lifecycle)

**Interfaces:**
- Consumes: `setCondition` from `mochi/reactions`.
- Produces: `export function startPowerWatch(): () => void` (returns stop).

- [ ] **Step 1: Verify the Battery Status API** in the dev WebView: `navigator.getBattery` exists. If not, report the fact and ship the module with a feature-detect guard (reactions simply never fire — no stub UI). No Rust.
- [ ] **Step 2: Implement `power.ts`.** `startPowerWatch()`: `navigator.getBattery().then(b => { ... })`; on `level`/`charging` change (and once initially) compute: `percent = Math.round(b.level * 100)`; conditions — `battery-drained: percent < 20 && !b.charging`; `battery-charging: b.charging && percent < 100`; `battery-full: b.charging && percent === 100` OR `percent === 100`. `battery-full` additionally fires one-shot `react("battery-full")` each time it transitions false→true (the proud flex moment). Return a stop fn removing listeners. Poll fallback: if events misfire, a 60 s interval re-evaluates (ponytail: pick whichever is smaller code after reading the API shape).
- [ ] **Step 3: DnD (conditional).** Grep `windows/src` for a do-not-disturb/focus source (the Mac app has focus modes; Windows may expose one via settings state). If a boolean source exists: wire it to `setCondition("dnd-sleep", on)`. If none exists, do NOT invent one — note "no DnD source on Windows; reaction unreachable" in the report and leave the kind in the catalog (harness still shows it; bus no-ops).
- [ ] **Step 4: Island registration.** Start the watch with the island lifecycle; stop on teardown (mirror how other subscriptions are cleaned up in island.ts).
- [ ] **Step 5: Build + verify.** Build gate. Live if possible: unplug/plug charger → drained/charging/flex within seconds. Else "not observed".
- [ ] **Step 6: Commit**
  ```powershell
  git add windows/src/mochi/power.ts windows/src/island/island.ts
  git commit -m "feat(windows): battery conditions for Mochi (JS Battery Status API)"
  ```

---

### Task 6: DOM features — roll-digits, marquee, view enter/exit

**Files:**
- Modify: `windows/src/views/views.ts` (pomodoro digits)
- Modify: `windows/src/views/ticker.ts` (marquee mount)
- Modify: `windows/src/style.css` (digits, marquee, enter/exit keyframes)
- Modify: `windows/src/island/island.ts` (ONE seam: leaving-class on view switch — append last, smallest possible)

**Interfaces:**
- Consumes: `h` from `views/dom`; existing pomodoro timer text writer in views.ts; ticker row text path; the view-switch class toggle in island.ts.
- Produces: local helpers only (`rollDigits(host, text)` in views.ts; `mountMarquee(row, text)` in ticker.ts).

- [ ] **Step 1: Roll-digits.** In views.ts, find the pomodoro countdown text update. Replace plain text writes with `rollDigits(host, text)`: host is `span.pom-roll` (fixed box: height = line-height, `overflow: hidden`, `perspective: 300px`, `font-variant-numeric: tabular-nums`). Implementation: per-character slots keyed from the RIGHT (index from end), unchanged chars stay (identity), changed chars get a `span` that animates via CSS keyframes `roll-out` (old, absolute: `y -72% + rotateX 50° + opacity 0`) and `roll-in` (new: from `y 72% + rotateX -50°`), 400 ms `cubic-bezier(0.22, 1, 0.36, 1)`, `backface-visibility: hidden`, container `transform-style: preserve-3d`. Reduced motion: swap text instantly (global block handles duration; also guard: if `prefersReduced()`, skip the animation spans entirely).
- [ ] **Step 2: CSS for digits** (new block, header comment `/* ── Roll digits (pomodoro) ─── */`): the keyframes + `.pom-roll` box rules above. Exactly one declared second curve in the whole plan — this is it.
- [ ] **Step 3: Marquee.** In ticker.ts, after a row's text is set: measure `textEl.scrollWidth > textEl.clientWidth + 1`? If not → ensure no marquee (default state). If yes → add class `marquee-on` and write CSS custom props `--mq-distance: (scrollWidth - clientWidth)px` and `--mq-duration: max(distance/30, 5)s` (compute in JS: `Math.max(dist / 30, 5)`). CSS: keyframes translate `0 → calc(-1 * var(--mq-distance))` with hold plateaus (0–12 % hold start, 42–55 % hold end-of-first-pass feel — port bloom's shape: 0%/12% at 0, 42%/55% at −distance, 80%/100% back at 0 for ping-pong, or single-direction with restart hold — choose ping-pong, no jump); `animation: marquee var(--mq-duration) linear infinite`; right-edge mask (`mask-image: linear-gradient(90deg, #000 85%, transparent)` — NO color-mix; plain gradient). Re-measure only on text change or resize (one ResizeObserver per ticker instance max). Reduced motion: animation none, text truncated with ellipsis (existing behavior).
- [ ] **Step 4: View enter/exit.** CSS-only enter: `.view.on { animation: view-in 200ms ease-out }` (opacity 0→1 + translateY 4px→0; check existing overlap crossfade block ~300 — do NOT double-animate; if `.view.on` already transitions opacity, extend that rule instead of adding a second system). Exit seam in island.ts: where the previous view loses `.on`, add `.view-leaving` and remove it on `animationend` (100 ms `view-out`: opacity→0, `filter: blur(4px)`, `scale(0.98)`, `forwards`). If the current switcher rebuilds views wholesale (no lingering element), skip the leaving seam — enter-only is acceptable; note it in the report rather than restructuring the switcher (ponytail).
- [ ] **Step 5: Build + verify.** Build gate. Live if possible: pomodoro ticking shows digit rolls; a long agent step marquees at constant speed with holds; view switches feel snappier out than in. Else "not observed".
- [ ] **Step 6: Commit**
  ```powershell
  git add windows/src/views/views.ts windows/src/views/ticker.ts windows/src/style.css windows/src/island/island.ts
  git commit -m "feat(windows): pomodoro roll-digits, ticker marquee, asymmetric view enter/exit"
  ```

---

### Task 7: End-to-end pass

**Files:**
- Create: `docs/superpowers/plans/2026-10-10-mochi-reactive-motion-e2e.md` (report)
- Modify (only for confirmed defects): whatever a finding names — smallest fix, one commit per fix class.

**Interfaces:**
- Consumes: everything Tasks 1–6 produced; the harness; the build gates.

- [ ] **Step 1: Full build + both test runners.** `npm run build` (exit=0, 0 errors), `node --experimental-strip-types src/core/spring.test.mjs`, `node --experimental-strip-types src/core/anim.test.mjs`.
- [ ] **Step 2: Harness sweep.** Launch island with `?reactions=1` (dev). Click EVERY ReactionKind chip; toggle EVERY condition chip. Record a table: kind → pose/aura/prop/particles observed yes/no + notes. Any no → investigate: bus mapping missing vs engine pose missing vs tick not running; fix smallest (Task 4/3 files), build, re-fire, commit fix.
- [ ] **Step 3: Motion verification.** If a live island can run: (a) shell springs — expand/collapse feel, mid-flight retarget reverses, radius snaps before width settles; (b) hide mid-animation → instant snap, process idle (no sustained CPU — confirm loop skips sleeping springs); (c) reduced-motion ON → everything snaps; (d) event-peek — approval path or a harness-triggered peek forces visibility ≤ 4 s, cancelled by interaction; (e) digits/marquee/exits observed. If headless-only, state each as "not observed" with the mechanism-level evidence (code path) instead.
- [ ] **Step 4: Battery.** Live: charger dance → drained/charging/full(flex). Else feature-detect result + "not observed".
- [ ] **Step 5: Regression sweep.** The UI-quality-pass eyeball checklist still holds (CallChip, SwipeRow, segment, sliders — nothing from that plan regressed by shell springs or wiring). Busy-gate tombstone re-read (hidden arm untouched). `anim.ts` diff empty across the whole plan range.
- [ ] **Step 6: Write the E2E report** at the path above: the observation tables, defects found + fixes with commits, the consolidated "must-eyeball-when-running" list for anything still unverified. Commit:
  ```powershell
  git add docs/superpowers/plans/2026-10-10-mochi-reactive-motion-e2e.md
  git commit -m "docs: Mochi reactive-motion end-to-end verification report"
  ```
  (Plus any fix commits with their own explicit paths, listed in the report.)

---

## Self-Review

**Spec coverage:** §3.1–3.2 → T1. §3.3 shell+peek+grace → T2. §3.4–3.5 engine/bus/tickle → T3+T4. §4.1 controls → T4. §4.2 battery → T5 (DnD conditional, honestly gated). §4.3 sessions → T4. §4.4 media → T4. §4.5 touch → T4. §5 digits/marquee/exits → T6 (grace/peek in T2, glow via bus). §6 harness → T3 (documented placement deviation). §9 E2E → T7. Gaps: none known; "media-loud" folded into T4 volume+media intersection rather than a separate bus input (same effect, less code).

**Placeholder scan:** every step names exact files, signatures, constants, commands; conditional steps (DnD absent, leaving-class impossible, Battery API missing) have explicit honest outcomes — no TBDs.

**Type consistency:** `Spring`/`SpringCfg`/`spring()` T1→T2; `SHELL_*` tokens T1→T2; `ReactionKind`/`react`/`setCondition`/`setPrimaryEngine`/`tickReactions` T3→T4/T5; `Island.peek()` T2→T4; engine methods T3→T4. Harness uses only Task-3 exports. PowerShell throughout.
