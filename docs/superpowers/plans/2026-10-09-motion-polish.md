# Motion & Visual Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every island + settings interaction butter-smooth (kill the jank sources, unify the motion system on the SPEC spring curves, polish micro-interactions) and tighten spacing/typography/colors to the Mac quality bar — no visual redesign, no new deps.

**Architecture:** One hand-rolled motion system in `core/anim.ts` (SwiftUI-equivalent springs + SPEC curves) drives everything on the island's single rAF clock. Jank is fixed at the source: `contain` on the island shell, in-place DOM patching instead of wholesale rebuilds, cached glow sprite, settle-gated canvas resizes, compositor-only fills. Reduced motion is one `matchMedia` flag + one CSS block. Tokens live in one file imported by both windows.

**Tech Stack:** TypeScript (hand-rolled, `h()` DOM helpers), CSS transitions/keyframes (compositor-first), Tauri 2 WebView2, Node 24 `--experimental-strip-types` for zero-dep unit tests.

**Spec:** `docs/superpowers/specs/2026-10-09-motion-polish-design.md`
**Testing:** `docs/superpowers/specs/2026-10-09-motion-polish-testing.md` (written by Task 1)

## Global Constraints

- No new npm or crate dependencies. No GSAP. Hand-rolled TS + CSS only.
- 0 % CPU while the island is hidden (PollGate + self-stopping frame loop) must survive every change.
- No visual redesign: same design language, same layout geometry (corner 22, compact width stay).
- Pill IDs, Tauri commands, Rust backends, macOS Swift app, `Reference Only/` untouched.
- Builds that must stay green: `cd windows && npm run build` (tsc + vite), `cd windows/src-tauri && cargo build`, `cd windows/src-tauri && cargo test --lib`.
- Unit tests: `cd windows && node --experimental-strip-types src/core/anim.test.mjs` (pattern from `src/core/agents.test.mjs`).
- `style.css` is edited by Tasks 4, 5, 7, 8 — execute those tasks sequentially, never in parallel.
- Commit after every task. Stage files explicitly (`git add <paths>`); never `git add .` (the repo has EOL noise on untouched files).

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `windows/src/core/anim.ts` | Single easing/spring source: `Ease`, `cubicBezier`, `closeCurve`, `Spring`, `Tracked`, `staggerDelay`, `prefersReduced`/`setPrefersReduced`/`initMotionPreferences` | 2, 3 |
| `windows/src/core/anim.test.mjs` | Zero-dep unit tests for the motion vocabulary (node `--experimental-strip-types`) | 2, 3 |
| `windows/src/mochi/greeting.ts` | Greeting choreography — imports easings from `anim.ts` | 2 |
| `windows/src/upload/sequence.ts` | Drop-sequence choreography — imports easings from `anim.ts` | 2 |
| `windows/src/tokens.css` | **New.** Single `:root` token set shared by both windows | 4 |
| `windows/src/style.css` | Island styling: tokens import, `contain`, crossfade overlap, stagger keyframes, reduced-motion block, compositor fills, press springs | 3, 4, 5, 7, 8 |
| `windows/src/settings/settings.css` | Settings styling — imports shared tokens, parity values | 4 |
| `windows/src/views/backgroundEffects.ts` | Applies the saved accent to the `--accent` custom property | 4 |
| `windows/src/island/island.ts` | Frame loop: glow sprite cache, settle-gated canvas resize, ticker busy gate | 5 |
| `windows/src/views/views.ts` | View hosts: in-place patching (dashboard/stopwatch/weather/banners/compact), `stagger` rows, scaleX fills, slider rect cache | 6, 7, 8 |
| `windows/src/main.ts` | Boot: calls `initMotionPreferences()` | 3 |
| `docs/superpowers/specs/2026-10-09-motion-polish-testing.md` | **New.** E2E categories, requirements, checklist, perf gates | 1 |

---

### Task 1: Testing & acceptance doc

**Files:**
- Create: `docs/superpowers/specs/2026-10-09-motion-polish-testing.md`

**Interfaces:**
- Produces: the acceptance gates every later task is reviewed against.

- [ ] **Step 1: Write the testing doc**

Create `docs/superpowers/specs/2026-10-09-motion-polish-testing.md` with exactly these sections:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-10-09-motion-polish-testing.md
git commit -m "docs: motion polish testing & acceptance gates"
```

---

### Task 2: anim.ts — consolidated motion vocabulary + unit tests

**Files:**
- Modify: `windows/src/core/anim.ts`
- Create: `windows/src/core/anim.test.mjs`
- Modify: `windows/src/mochi/greeting.ts` (local `E` at lines 49–57)
- Modify: `windows/src/upload/sequence.ts` (local `eOut/eIn/eInOut/eBack` at lines 53–60)

**Interfaces:**
- Consumes: nothing (pure module, no DOM imports — safe under node type-stripping).
- Produces: `Ease`, `EaseFn`, `lerp`, `clamp`, `seg`, `cubicBezier`, `closeCurve`, `Spring`, `Tracked` (all unchanged signatures), plus new `STAGGER_MS = 35`, `staggerDelay(i: number): string`, `prefersReduced(): boolean`, `setPrefersReduced(v: number): void`, `initMotionPreferences(): void`.

- [ ] **Step 1: Write the failing test**

Create `windows/src/core/anim.test.mjs`:

```js
// Zero-dep motion-vocabulary check. Run from windows/:
//   node --experimental-strip-types src/core/anim.test.mjs
import assert from "node:assert/strict";

const {
  Ease, Spring, Tracked, closeCurve, cubicBezier,
  prefersReduced, setPrefersReduced, staggerDelay,
} = await import("./anim.ts");

// Easings hit their endpoints exactly.
assert.equal(Ease.out(0), 0);
assert.equal(Ease.out(1), 1);
assert.equal(Ease.inOut(0), 0);
assert.equal(Ease.inOut(1), 1);
assert.equal(Ease.back(0), 0);
assert.equal(Ease.back(1), 1);
assert.ok(Ease.back(0.7) > 1, "back overshoots mid-flight");

// closeCurve is the SPEC close curve: endpoints exact, monotonic non-decreasing.
assert.equal(closeCurve(0), 0);
assert.equal(closeCurve(1), 1);
let prev = -1;
for (let i = 0; i <= 20; i++) {
  const v = closeCurve(i / 20);
  assert.ok(v >= prev - 1e-9, `closeCurve monotonic at ${i}`);
  prev = v;
}

// A spring converges on its target and reports settled.
const s = new Spring(0);
s.target = 100;
for (let i = 0; i < 600; i++) s.step(1 / 60);
assert.ok(Math.abs(s.value - 100) < 0.5, `spring converged: ${s.value}`);
assert.ok(s.settled, "spring reports settled");

// Tracked curve mode lands exactly on target.
const t = new Tracked(10);
t.curveTowards(0, 340, 0);
t.step(1 / 60, 400);
assert.equal(t.value, 0);

// Stagger math: 35 ms per item (SPEC §4).
assert.equal(staggerDelay(0), "0ms");
assert.equal(staggerDelay(3), "105ms");

// Reduced motion starts unset; the flag is settable.
assert.equal(prefersReduced(), false);
setPrefersReduced(true);
assert.equal(prefersReduced(), true);
setPrefersReduced(false);

console.log("anim motion vocabulary OK");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd windows; node --experimental-strip-types src/core/anim.test.mjs`
Expected: FAIL — `staggerDelay` / `prefersReduced` / `setPrefersReduced` are not exported.

- [ ] **Step 3: Add the motion vocabulary to anim.ts**

Append to `windows/src/core/anim.ts` (after the `Tracked` class):

```ts
// ── Motion vocabulary shared by every animated surface ─────────────────────────

/** SPEC §4 stagger: 35 ms per item (mini pills, view rows). */
export const STAGGER_MS = 35;

/** CSS transition-delay for stagger item `i` (0-based). */
export function staggerDelay(i: number): string {
  return `${i * STAGGER_MS}ms`;
}

// ── Reduced motion (OS setting only — see design spec §1) ─────────────────────

let reduced = false;
let reducedQuery: MediaQueryList | null = null;

export function prefersReduced(): boolean {
  return reduced;
}

/** Test hook + media-listener target. */
export function setPrefersReduced(v: boolean): void {
  reduced = v;
}

/** Call once at boot. Safe to call without a DOM (tests): it no-ops. */
export function initMotionPreferences(): void {
  if (typeof window === "undefined") return;
  reducedQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduced = reducedQuery.matches;
  reducedQuery.addEventListener("change", () => {
    reduced = reducedQuery?.matches ?? false;
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd windows; node --experimental-strip-types src/core/anim.test.mjs`
Expected: `anim motion vocabulary OK`

- [ ] **Step 5: Migrate greeting.ts to the shared easings**

In `windows/src/mochi/greeting.ts`: delete the local `E` object (lines 49–57) and add `Ease` to the import from `../core/anim` (the file already imports `seg` from there). Replace the two call sites:
- line 134: `1 - E.easeIn(seg(...))` → `1 - Ease.easeIn(seg(...))`
- line 177: `E.inOut(seg(...))` → `Ease.inOut(seg(...))`

- [ ] **Step 6: Migrate upload/sequence.ts to the shared easings**

In `windows/src/upload/sequence.ts`: delete the local `eOut/eIn/eInOut/eBack` definitions (lines 53–60) and add `Ease` to the existing `../core/anim` import (it already imports `lerp`). Replace every call site:
- `eOut(` → `Ease.out(`
- `eIn(` → `Ease.easeIn(`
- `eInOut(` → `Ease.inOut(`
- `eBack(` → `Ease.back(`

- [ ] **Step 7: Verify the build**

Run: `cd windows; npm run build`
Expected: exit 0 (tsc finds no remaining `E.` / `eOut` references).

- [ ] **Step 8: Commit**

```bash
git add windows/src/core/anim.ts windows/src/core/anim.test.mjs windows/src/mochi/greeting.ts windows/src/upload/sequence.ts
git commit -m "feat: consolidate easings into anim.ts, add stagger + reduced-motion vocabulary"
```

---

### Task 3: Reduced-motion system

**Files:**
- Modify: `windows/src/core/anim.ts` (`Spring.step`, `Tracked.step`)
- Modify: `windows/src/style.css` (media-query block at the end)
- Modify: `windows/src/main.ts` (boot call)
- Modify: `windows/src/core/anim.test.mjs` (snap tests)

**Interfaces:**
- Consumes: `prefersReduced`, `setPrefersReduced` from Task 2.
- Produces: reduced-motion behaviour for all structural motion (springs snap) + CSS block.

- [ ] **Step 1: Write the failing tests**

Append to `windows/src/core/anim.test.mjs` (before the final console.log):

```ts
// Reduced motion: one step snaps to target, both spring and curve modes.
setPrefersReduced(true);
const s2 = new Spring(0);
s2.target = 100;
s2.step(1 / 60);
assert.equal(s2.value, 100, "spring snaps under reduced motion");
const t2 = new Tracked(10);
t2.curveTowards(0, 340, 0);
t2.step(1 / 60, 1);
assert.equal(t2.value, 0, "curve snaps under reduced motion");
setPrefersReduced(false);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd windows; node --experimental-strip-types src/core/anim.test.mjs`
Expected: FAIL — `s2.value` is ~0.0x after one step, not 100.

- [ ] **Step 3: Make springs snap under reduced motion**

In `windows/src/core/anim.ts`, edit `Spring.step`:

```ts
  step(dt: number) {
    if (prefersReduced()) {
      this.set(this.target);
      return;
    }
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
```

and `Tracked.step`:

```ts
  step(dt: number, now = performance.now()) {
    if (prefersReduced()) {
      this.jump(this.spring.target);
      return;
    }
    if (this.mode === "spring") {
```

- [ ] **Step 4: Add the CSS reduced-motion block**

Append to the end of `windows/src/style.css`:

```css
/* ── Reduced motion (OS setting only) ───────────────────────────────────────
   Windows: Settings → Accessibility → Animation effects → off. Everything
   collapses to near-instant; infinite decorations stop; springs snap via JS. */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    transition-duration: 0.01ms !important;
    transition-delay: 0ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }

  .shimmer,
  .typing i,
  .pulse,
  .drop-frame rect,
  .bt-btn.pending::before {
    animation: none !important;
  }

  .view.on .stagger {
    animation: none !important;
  }
}
```

- [ ] **Step 5: Wire the boot call**

In `windows/src/main.ts`, add `import { initMotionPreferences } from "./core/anim";` and call `initMotionPreferences();` as the first statement of the boot sequence (before the Island is constructed).

- [ ] **Step 6: Run tests + build**

Run: `cd windows; node --experimental-strip-types src/core/anim.test.mjs`
Expected: `anim motion vocabulary OK`
Run: `cd windows; npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add windows/src/core/anim.ts windows/src/core/anim.test.mjs windows/src/style.css windows/src/main.ts
git commit -m "feat: reduced-motion support — springs snap, CSS collapses, OS setting"
```

---

### Task 4: Shared tokens + accent property + settings parity

**Files:**
- Create: `windows/src/tokens.css`
- Modify: `windows/src/style.css` (:root lines 4–29 → import; `#3b9eff` literals at lines 844, 872, 883, 892, 896, 941)
- Modify: `windows/src/settings/settings.css` (:root lines 3–19; section radius line 58)
- Modify: `windows/src/views/backgroundEffects.ts` (accent application)

**Interfaces:**
- Consumes: nothing.
- Produces: `tokens.css` with the full `:root` set incl. `--accent: #3b9eff`; both stylesheets import it.

- [ ] **Step 1: Create tokens.css**

Create `windows/src/tokens.css` with the `:root` block copied verbatim from `windows/src/style.css` lines 4–29, plus one added line:

```css
:root {
  color-scheme: dark;

  --font: system-ui, "Segoe UI Variable Text", "Segoe UI", "Segoe UI Emoji", sans-serif;
  --mono: "Cascadia Mono", "Consolas", ui-monospace, monospace;

  --ink: #f5f6f8;        /* primary text */
  --ink-2: #f1f2f4;
  --dim: #9398a1;
  --dim-2: #8e939c;
  --dim-3: #6b7079;
  --dim-4: #5f646d;
  --dim-5: #4b5563;
  --card: #141518;
  --card-flat: #0e0f11;
  --tab-on: #1d1f23;
  --hairline: rgba(255, 255, 255, 0.035);
  --red: #f4505e;
  --red-text: #ff8d97;
  --green: #22c55e;
  --green-2: #34d399;
  --amber: #f5a524;
  --cyan: #22d3ee;
  --indigo: #6366f1;
  --pink: #f472b6;
  --accent: #3b9eff;     /* single source for the accent colour (settings picker) */
}
```

- [ ] **Step 2: Make style.css import the tokens**

In `windows/src/style.css`, replace lines 4–29 (the whole `:root` block) with:

```css
@import "./tokens.css";
```

- [ ] **Step 3: Replace the accent literals in style.css**

Replace every `#3b9eff` literal in `windows/src/style.css` with `var(--accent)`:
- line 844: `.banner-open { background: #3b9eff; … }` → `background: var(--accent);`
- line 872: `.media-progress-fill { … background: #3b9eff; … }` → `var(--accent)`
- line 883: `.stat-fill { … background: #3b9eff; … }` → `var(--accent)`
- line 892: `.cc-slider-fill { … background: #3b9eff; … }` → `var(--accent)`
- line 896: `.cc-toggle.on { … color: #3b9eff; }` → `color: var(--accent);`
- line 941: `.task input[type="checkbox"] { … accent-color: #3b9eff; }` → `accent-color: var(--accent);`

- [ ] **Step 4: Make settings.css import the tokens**

In `windows/src/settings/settings.css`, replace lines 3–19 (the whole `:root` block) with:

```css
@import "../tokens.css";

:root {
  /* Settings-only: the window background. Everything else is shared. */
  --bg: #0b0c0e;
}
```

Then align the two divergent values:
- `section { border-radius: 14px; }` (line 58) → `border-radius: 20px;` (matches `.card`)
- `.switch { background: rgba(255,255,255,0.15); }` (line 153) → `background: var(--tab-on);` (matches island switches)

- [ ] **Step 5: Wire the accent to the custom property**

In `windows/src/views/backgroundEffects.ts`, add after `let accent = readAccent();` (line 55):

```ts
function applyAccent(): void {
  document.documentElement.style.setProperty("--accent", accent);
}

applyAccent();
```

and in the `storage` handler, after `accent = readAccent();` (line 63) add `applyAccent();`.

- [ ] **Step 6: Verify the build**

Run: `cd windows; npm run build`
Expected: exit 0 (vite resolves both `@import` paths).

- [ ] **Step 7: Commit**

```bash
git add windows/src/tokens.css windows/src/style.css windows/src/settings/settings.css windows/src/views/backgroundEffects.ts
git commit -m "feat: shared token set, single --accent source, settings parity"
```

---

### Task 5: Island shell jank fixes

**Files:**
- Modify: `windows/src/style.css` (`#island` line 68, `#island-clip` line 78, `.view` line 319, scroll containers)
- Modify: `windows/src/island/island.ts` (`updateBotTargets` 785–809, `drawBackgroundCanvas` 762–783, `drawBot` 811–847, busy gate 741–758)

**Interfaces:**
- Consumes: `Ticker.animating` from `windows/src/views/ticker.ts` (already exported).
- Produces: no API changes; frame loop writes fewer styles per frame.

- [ ] **Step 1: Add contain to the island shell**

In `windows/src/style.css`:
- `#island { … }` (line 68): add `contain: layout style paint;`
- `#island-clip { … }` (line 78): add `contain: layout paint;`
- `.view { … }` (line 319): add `contain: layout style;`
- `.int-rows` (line 1326), `.chat-log` (line 1001), `.task-list` (line 937), `.int-detail-text` (line 1563): add `content-visibility: auto;`

- [ ] **Step 2: Cache the glow sprite in updateBotTargets**

In `windows/src/island/island.ts`, add a field `private glowKey = "";` and rewrite the glow block inside `updateBotTargets` (lines 796–805):

```ts
    if (State.mode === "expanded" && State.view !== "uploading" && !greetingActive && !this.uploadActive) {
      const d = p.diameter;
      const color = botGlowColor(State.effectiveState);
      // The gradient string is expensive to rebuild — only touch the DOM when
      // the size or colour actually changed. Position still follows the spring.
      const key = `${Math.round(d)}|${color}`;
      if (key !== this.glowKey) {
        this.glowKey = key;
        this.botGlow.style.display = "block";
        this.botGlow.style.width = `${d * 2.2}px`;
        this.botGlow.style.height = `${d * 2.2}px`;
        this.botGlow.style.background = `radial-gradient(circle, ${color} 0%, transparent 62%)`;
      }
      this.botGlow.style.left = `${this.botCx.value - d * 1.1}px`;
      this.botGlow.style.top = `${this.botCy.value - d * 1.1}px`;
      this.botGlow.style.opacity = String(botGlowOpacity(State.effectiveState));
    } else {
      this.botGlow.style.display = "none";
      this.glowKey = "";
    }
```

- [ ] **Step 3: Settle-gate the canvas resizes**

In `drawBackgroundCanvas` (lines 768–778), skip the backing-store resize while the geometry spring is running — the effect stretches imperceptibly for ≤ 520 ms instead of reallocating mid-spring:

```ts
    const w = Math.round(this.width.value);
    const h = Math.round(this.height.value);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    const settling = this.width.animating || this.height.animating;
    if (!settling && (this.bgCanvas.width !== bw || this.bgCanvas.height !== bh)) {
      this.bgCanvas.width = bw;
      this.bgCanvas.height = bh;
      this.bgCanvas.style.width = `${w}px`;
      this.bgCanvas.style.height = `${h}px`;
    }
```

In `drawBot` (lines 816–822), same guard:

```ts
    const settling = this.botSize.animating;
    if (!settling && this.canvasPx !== w) {
      this.canvasPx = w;
      this.botCanvas.width = Math.round(w * dpr);
      this.botCanvas.height = Math.round(hCss * dpr);
      this.botCanvas.style.width = `${w}px`;
      this.botCanvas.style.height = `${hCss}px`;
    }
```

- [ ] **Step 4: Add the ticker to the busy gate**

In `windows/src/island/island.ts`, add `import { Ticker } from "../views/ticker";` and extend the busy expression (lines 746–751):

```ts
    const busy = State.mode === "hidden"
      ? settling
      : settling ||
        !this.botCx.settled || !this.botCy.settled || !this.botSize.settled ||
        greetingActive || this.engine.busy || UploadSeq.isActive ||
        Ticker.animating || backgroundEffect() !== "off";
```

- [ ] **Step 5: Verify the build**

Run: `cd windows; npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add windows/src/style.css windows/src/island/island.ts
git commit -m "perf: contain the island shell, cache the glow sprite, settle-gate canvas resizes"
```

---

### Task 6: liveView in-place patching

**Files:**
- Modify: `windows/src/views/views.ts` (`renderDashboardView` 555–609, `renderStopwatchView` 1042–1060, `renderWeatherView` 1061–1082, `buildBanners` 1086–1123, `buildCompactStatus` 1128–1148, registry 1181–1188)

**Interfaces:**
- Consumes: `ViewHost` contract (`{ el, sync(), focus?, tick? }`), `h()`, `State`.
- Produces: same registry — `buildViews()` returns the same map; only the sync behaviour changes.

- [ ] **Step 1: Convert the dashboard to build-once + patch**

Replace `renderDashboardView` (lines 555–609) and its registry entry with:

```ts
function buildDashboardView(): ViewHost {
  const mediaWidget = h("div", { class: "widget", onclick: () => State.setView("media") },
    h("div", { class: "widget-title" }, "Media"));
  const mediaBody = h("div", { class: "widget-media" });
  const mediaEmpty = h("div", { class: "widget-empty" }, "No media playing");
  mediaWidget.append(mediaBody, mediaEmpty);
  const art = h("img", { class: "widget-album-art" });
  const mediaText = h("div");
  mediaBody.append(art, mediaText);

  const statsWidget = h("div", { class: "widget", onclick: () => State.setView("stats") },
    h("div", { class: "widget-title" }, "Stats"));
  const statsValue = h("div", { class: "widget-value" });
  statsWidget.append(statsValue);

  const timerWidget = h("div", { class: "widget", onclick: () => State.setView("pomodoro") },
    h("div", { class: "widget-title" }, "Timer"));
  const timerValue = h("div", { class: "widget-value" });
  timerWidget.append(timerValue);

  const weatherWidget = h("div", { class: "widget", onclick: () => State.setView("weather") },
    h("div", { class: "widget-title" }, "Weather"));
  const weatherValue = h("div", { class: "widget-value" });
  const weatherEmpty = h("div", { class: "widget-empty" });
  weatherWidget.append(weatherValue, weatherEmpty);

  const batteryWidget = h("div", { class: "widget", onclick: () => State.setView("controlCenter") },
    h("div", { class: "widget-title" }, "Battery"));
  const batteryValue = h("div", { class: "widget-value" });
  batteryWidget.append(batteryValue);

  const btWidget = h("div", { class: "widget", onclick: () => State.setView("bluetooth") },
    h("div", { class: "widget-title" }, "Bluetooth"));
  const btValue = h("div", { class: "widget-value" });
  const btEmpty = h("div", { class: "widget-empty" }, "No devices");
  btWidget.append(btValue, btEmpty);

  const el = h("div", { class: "view" },
    h("div", { class: "dashboard-grid" },
      mediaWidget, statsWidget, timerWidget, weatherWidget, batteryWidget, btWidget));

  let mediaKey = "";
  return {
    el,
    sync() {
      const m = State.media;
      mediaBody.style.display = m ? "" : "none";
      mediaEmpty.style.display = m ? "none" : "";
      if (m) {
        const key = `${m.track}|${m.artist}|${m.albumArt}`;
        if (key !== mediaKey) {
          mediaKey = key;
          art.src = m.albumArt;
          art.style.display = m.albumArt ? "" : "none";
          mediaText.replaceChildren(m.track, h("br"), m.artist);
        }
      }
      const s = State.stats;
      statsValue.textContent = `CPU ${Math.round(s.cpu)}% · RAM ${Math.round(s.ram)}%`;
      const t = State.timer;
      const label = t.mode.charAt(0).toUpperCase() + t.mode.slice(1);
      timerValue.textContent = `${label} · ${pad2(t.remaining / 60)}:${pad2(t.remaining % 60)}`;
      const w = State.weather;
      const hasW = w.condition && w.condition !== "Unavailable";
      weatherValue.style.display = hasW ? "" : "none";
      weatherEmpty.style.display = hasW ? "none" : "";
      if (hasW) weatherValue.textContent = `${w.temp}° ${w.condition}`;
      else weatherEmpty.textContent = w.condition ? "Weather unavailable" : "No weather data";
      const b = State.battery;
      batteryValue.textContent = `${b.level}%${b.charging ? " · Charging" : ""}`;
      const devices = State.bluetooth.devices;
      const any = devices.length > 0;
      btValue.style.display = any ? "" : "none";
      btEmpty.style.display = any ? "none" : "";
      if (any) btValue.textContent = `${devices.filter((d) => d.connected).length}/${devices.length} connected`;
    },
  };
}
```

Registry: `map.set("dashboard", liveView(renderDashboardView));` → `map.set("dashboard", buildDashboardView());`

- [ ] **Step 2: Convert the stopwatch**

Replace `renderStopwatchView` (lines 1042–1060) with:

```ts
function buildStopwatchView(): ViewHost {
  const display = h("div", { class: "timer-display" });
  const startBtn = btn("Start", "primary", () => State.timerToggle());
  const startLabel = startBtn.querySelector("span") as HTMLElement;
  const el = h("div", { class: "view" },
    h("div", { class: "view-stopwatch" },
      display,
      h("div", { class: "timer-controls" },
        startBtn,
        btn("Reset", "secondary", () => State.timerReset()))));
  return {
    el,
    sync() {
      const t = State.timer;
      if (t.mode !== "stopwatch") State.timerSetMode("stopwatch");
      display.textContent = `${pad2(t.remaining / 3600)}:${pad2((t.remaining % 3600) / 60)}:${pad2(t.remaining % 60)}`;
      startLabel.textContent = t.running ? "Pause" : "Start";
    },
  };
}
```

Registry: `map.set("stopwatch", liveView(renderStopwatchView));` → `map.set("stopwatch", buildStopwatchView());`

- [ ] **Step 3: Convert the weather**

Replace `renderWeatherView` (lines 1061–1082) with:

```ts
function buildWeatherView(): ViewHost {
  const temp = h("div", { class: "weather-temp" });
  const cond = h("div", { class: "weather-condition" });
  const details = h("div", { class: "weather-details" });
  const full = h("div", { class: "view-weather" }, temp, cond, details);
  const empty = h("div", { class: "view-weather weather-empty" }, "Loading…");
  const el = h("div", { class: "view" }, full, empty);
  full.style.display = "none";
  return {
    el,
    sync() {
      const w = State.weather;
      const has = w.condition && w.condition !== "Unavailable";
      full.style.display = has ? "" : "none";
      empty.style.display = has ? "none" : "";
      if (has) {
        temp.textContent = `${w.temp}°`;
        cond.textContent = w.condition;
        details.replaceChildren(`Humidity: ${w.humidity}%`, h("br"), `Wind: ${w.wind} km/h`);
      } else {
        empty.textContent = w.condition ? "Weather unavailable" : "Loading…";
      }
    },
  };
}
```

Registry: `map.set("weather", liveView(renderWeatherView));` → `map.set("weather", buildWeatherView());`

- [ ] **Step 4: Patch banners only when the banner changes**

In `buildBanners` (lines 1086–1123), add `let key = "";` and guard the rebuild:

```ts
export function buildBanners(): ViewHost {
  const el = h("div", { class: "banners" });
  let key = "";
  return {
    el,
    sync() {
      const b = State.banner;
      if (!b) {
        el.style.display = "none";
        key = "";
        return;
      }
      const next = `${b.url ?? ""}|${b.text}`;
      if (next === key) return; // already built — no churn on every notify
      key = next;
      el.style.display = "";
      const text = b.url && b.url.length > 48 ? `${b.url.slice(0, 47)}…` : b.text;
      el.replaceChildren(
        h(
          "div",
          { class: "banner" },
          h("span", { class: "banner-text", text }),
          b.url
            ? h("button", {
                class: "banner-open",
                text: "Open",
                onclick: () => {
                  void Bridge.openUrl(b.url!);
                  State.dismissBanner();
                },
              })
            : null,
          h("button", {
            class: "banner-close",
            text: "×",
            onclick: () => State.dismissBanner(),
          }),
        ),
      );
    },
  };
}
```

- [ ] **Step 5: Patch the compact status in place**

Replace `buildCompactStatus` (lines 1128–1148) with:

```ts
export function buildCompactStatus(): ViewHost {
  const el = h("div", { id: "compact-status" });
  const timer = h("span", { class: "cs-timer" });
  const media = h("span", { class: "cs-media" });
  const battery = h("span", { class: "cs-battery" });
  el.append(timer, media, battery);
  return {
    el,
    sync() {
      const on = State.mode === "compact";
      el.style.opacity = on ? "1" : "0";
      if (!on) return;
      const t = State.timer;
      timer.style.display = t.running ? "" : "none";
      timer.textContent = `${pad2(t.remaining / 60)}:${pad2(t.remaining % 60)}`;
      const m = State.media;
      media.style.display = m?.playing ? "" : "none";
      media.textContent = m?.playing ? `♪ ${m.track}` : "";
      const b = State.battery;
      battery.textContent = `${b.charging ? "⚡" : ""}${b.level}%`;
    },
  };
}
```

- [ ] **Step 6: Verify the build**

Run: `cd windows; npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add windows/src/views/views.ts
git commit -m "perf: patch dashboard/stopwatch/weather/banners/compact in place on every notify"
```

---

### Task 7: View transitions — overlap crossfade + staggered enters

**Files:**
- Modify: `windows/src/style.css` (`.view` lines 319–333; new stagger block)
- Modify: `windows/src/views/views.ts` (add `stagger` class + `--i` index to row builders)

**Interfaces:**
- Consumes: `staggerDelay` concept (35 ms) from Task 2 — implemented in CSS, not JS.
- Produces: `.view.on .stagger` enter animation; `class: "stagger"` + `style: "--i:N"` on rows.

- [ ] **Step 1: Overlap the crossfade in CSS**

In `windows/src/style.css`, replace the `.view` / `.view.on` rules (lines 319–333):

```css
.view {
  position: absolute;
  inset: 0;
  opacity: 0;
  transform: scale(0.97);
  pointer-events: none;
  transition: opacity 0.16s ease-in, transform 0.16s ease-in;
}

.view.on {
  opacity: 1;
  transform: scale(1);
  pointer-events: auto;
  /* Incoming starts at 120 ms — overlapping the 160 ms outgoing fade, so the
     handoff is continuous instead of blinking through a blank frame. */
  transition: opacity 0.3s ease-out 0.12s, transform 0.3s cubic-bezier(0.3, 1.2, 0.4, 1) 0.12s;
}
```

- [ ] **Step 2: Add the stagger keyframes**

Append after the `.view.on` block in `windows/src/style.css`:

```css
/* Staggered row enter — SPEC §4: 35 ms per item. Rows opt in with
   class="stagger" and an inline style="--i:N" index. */
.view.on .stagger {
  animation: row-in 0.3s cubic-bezier(0.2, 0.8, 0.3, 1) both;
  animation-delay: calc(120ms + var(--i, 0) * 35ms);
}

@keyframes row-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

- [ ] **Step 3: Tag the dashboard widgets**

In `buildDashboardView` (Task 6), add `class: "widget stagger"` and a per-widget index to each of the six widgets. Media widget:

```ts
  const mediaWidget = h("div", { class: "widget stagger", style: "--i:0", onclick: () => State.setView("media") },
```

and likewise `--i:1` stats, `--i:2` timer, `--i:3` weather, `--i:4` battery, `--i:5` bluetooth.

- [ ] **Step 4: Tag rows in the other views**

In `windows/src/views/views.ts`, add `stagger` + `--i` to the row builders (index = position in the list):
- `.stat-row` in the stats view sync (around line 932): `h("div", { class: "stat-row stagger", style: `--i:${i}` }, …)`
- `.bt-device` in the bluetooth view: same pattern with the device index.
- `.task` in the pomodoro task list (line 1009): `h("div", { class: `${task.done ? "task done" : "task"} stagger`, style: `--i:${i}` }, …)`
- `.int-row` in the integration rows (line 1338): same pattern with the row index.

- [ ] **Step 5: Verify the build**

Run: `cd windows; npm run build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add windows/src/style.css windows/src/views/views.ts
git commit -m "feat: overlap view crossfade, stagger row enters (35 ms)"
```

---

### Task 8: Compositor fills + control micro-interactions

**Files:**
- Modify: `windows/src/style.css` (fills at lines 872, 883, 892; press rules; slider dragging)
- Modify: `windows/src/views/views.ts` (media fill line 656, stats fills 932–938, sliders 668–717)

**Interfaces:**
- Consumes: `clamp01` (already defined at views.ts line 663), `pct` (line 611).
- Produces: fills driven by `transform: scaleX()`; unified press feedback on all controls.

- [ ] **Step 1: Make the fills compositor-only in CSS**

In `windows/src/style.css`:
- `.media-progress-fill` (line 872): replace `transition: width 0.3s;` with:

```css
.media-progress-fill { height: 100%; width: 100%; background: var(--accent); border-radius: 2px; transform-origin: left center; }
```

- `.stat-fill` (line 883): same replacement (`width: 100%`, `transform-origin: left center`, no transition).
- `.cc-slider-fill` (line 892): same replacement.
- Add slider-drag feedback after `.cc-slider` (line 891):

```css
.cc-slider { flex: 1; height: 6px; background: var(--tab-on); border-radius: 3px; cursor: pointer; touch-action: none; transition: transform 0.12s ease-out; }
.cc-slider.dragging { transform: scaleY(1.5); }
```

- Add the unified press block at the end of the buttons section (after line 418):

```css
/* Unified press feedback — every control presses like .btn already does. */
.pill:active,
.tab-group:active,
.sub-view-pill:active,
.cc-toggle:active,
.bt-btn:active,
.bt-refresh:active,
.seg button:active,
.icon-btn:active,
.swatch:active,
.fx-opt:active {
  transform: scale(0.94);
}

.tab-group,
.sub-view-pill,
.cc-toggle,
.bt-btn,
.bt-refresh,
.seg button,
.icon-btn,
.swatch,
.fx-opt {
  transition: transform 0.08s ease-out, background 0.12s ease-out, color 0.12s ease-out,
    border-color 0.12s ease-out, box-shadow 0.12s ease-out;
}
```

- [ ] **Step 2: Switch the JS fills to scaleX**

In `windows/src/views/views.ts`:
- media fill (line 656): `fill.style.width = pct(m.duration > 0 ? (m.position / m.duration) * 100 : 0);` →

```ts
      fill.style.transform = `scaleX(${clamp01(m.duration > 0 ? m.position / m.duration : 0)})`;
```

- stats fills (lines 932–938): replace each `fill.style.width = pct(...)` with scaleX:

```ts
      cpu.fill.style.transform = `scaleX(${clamp01(s.cpu / 100)})`;
      ram.fill.style.transform = `scaleX(${clamp01(s.ram / 100)})`;
      rx.fill.style.transform = `scaleX(${clamp01(s.netRx / NET_FULL_SCALE)})`;
      tx.fill.style.transform = `scaleX(${clamp01(s.netTx / NET_FULL_SCALE)})`;
```

- slider fills (lines 682, 717): `fill.style.width = pct(value * 100);` → `fill.style.transform = `scaleX(${clamp01(value)})`;`

- [ ] **Step 3: Cache the slider track rect + dragging class**

In `makeSlider` (lines 668–682), rewrite the rect handling:

```ts
  const makeSlider = (write: (v: number) => void, commit: (v: number) => void) => {
    const fill = h("div", { class: "cc-slider-fill" });
    const track = h("div", { class: "cc-slider" }, fill);
    let trackRect: DOMRect | null = null;
    const setFromEvent = (ev: PointerEvent) => {
      const r = trackRect ?? track.getBoundingClientRect();
      write(clamp01((ev.clientX - r.left) / r.width));
    };
    track.addEventListener("pointerdown", (ev) => {
      trackRect = track.getBoundingClientRect();
      track.classList.add("dragging");
      track.setPointerCapture(ev.pointerId);
      setFromEvent(ev);
    });
    track.addEventListener("pointermove", (ev) => {
      if (trackRect != null) setFromEvent(ev);
    });
    const end = () => {
      trackRect = null;
      track.classList.remove("dragging");
    };
    track.addEventListener("pointerup", end);
    track.addEventListener("pointercancel", end);
    return track;
  };
```

(Keep the existing wheel handler and `commit` call intact — only the pointer path changes.)

- [ ] **Step 4: Verify the build**

Run: `cd windows; npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add windows/src/style.css windows/src/views/views.ts
git commit -m "perf: compositor-only fills, unified press springs, cached slider rects"
```

---

### Task 9: Integration verification + E2E + perf gates

**Files:**
- Modify: none (verification only). Report written to `.superpowers/sdd/2026-10-09-motion-polish/report.md` (gitignored).

**Interfaces:**
- Consumes: everything from Tasks 2–8.
- Produces: green builds + test evidence + E2E checklist results + perf measurements.

- [ ] **Step 1: Full build + test sweep**

Run: `cd windows; npm run build`
Expected: exit 0.
Run: `cd windows/src-tauri; cargo build`
Expected: 0 errors, 0 warnings.
Run: `cd windows/src-tauri; cargo test --lib`
Expected: 22 passed (or more if Rust tests were added elsewhere).
Run: `cd windows; node --experimental-strip-types src/core/anim.test.mjs`
Expected: `anim motion vocabulary OK`.

- [ ] **Step 2: Boot the app**

Run: `cd windows; npm run tauri dev`
Expected: island appears, expands on interaction, no console errors.

- [ ] **Step 3: Execute the E2E checklist**

Work through all 12 items of the E2E manual checklist in `docs/superpowers/specs/2026-10-09-motion-polish-testing.md`. Record pass/fail per item in the report. Pay special attention to:
- open/close ×50 (item 1) — watch for stutter or radius lag;
- view switches (items 2–3) — no blank frame;
- reduced motion (item 12) — Windows Settings → Accessibility → Animation effects → off, then re-test open/close + a view switch.

- [ ] **Step 4: Measure the perf gates**

- Frame time: devtools Performance panel, record 10 open/close cycles, p95 < 8 ms.
- 0 % CPU hidden: let the island hide, count rAF frames over 5 s (must be 0) and process CPU over 12 s (must be 0.00 %) — Task 20 method.
- No forced-reflow warnings in the console during any interaction.

- [ ] **Step 5: Fix anything that fails**

Only genuine breakage — no scope creep. Re-run Step 1 after any fix.

- [ ] **Step 6: Write the report**

Write `.superpowers/sdd/2026-10-09-motion-polish/report.md` with: build/test evidence, E2E checklist results (pass/fail per item), perf measurements, any issues found + fixes.

- [ ] **Step 7: Commit (only if fixes were needed)**

```bash
git add <fixed files>
git commit -m "fix: <what the integration pass caught>"
```
If nothing needed fixing: no commit — report "clean" in the final message.

---

## Self-Review

**Spec coverage:**
- §1 motion architecture → Tasks 2, 3 ✓
- §2 jank fixes (10 items) → Tasks 5 (1, 4, 5, 6, 9), 6 (2), 7 (3), 8 (7, 8) ✓
- §3 micro-interactions → Tasks 7 (stagger), 8 (press, slider) ✓
- §4 visual polish → Task 4 (tokens, accent, settings parity) ✓
- §5 settings parity → Task 4 ✓
- §6 testing & acceptance → Tasks 1, 9 ✓
- §7 constraints → Global Constraints ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code. ✓

**Type consistency:** `ViewHost`, `h()`, `State`, `btn()`, `pct()`, `clamp01()`, `pad2()`, `Ticker.animating`, `staggerDelay`, `prefersReduced`, `setPrefersReduced`, `initMotionPreferences` — all defined before use. ✓
