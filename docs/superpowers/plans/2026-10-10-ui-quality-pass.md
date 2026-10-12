# Windows Island UI Quality Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the React Bits port (CallChip on the ticker, SwipeRow on pomodoro rows), give the header one sliding-thumb segment, and add knob/glow/readout micro-interactions to the control-center sliders — buttery, restrained, within the existing motion vocabulary.

**Architecture:** Hand-rolled TS DOM modules (`windows/src/ui/*.ts`) + one CSS block each in `windows/src/style.css`, driven by CSS transitions for interruptible UI and `core/anim.ts` where a spring is needed. No new dependencies. The island's single rAF clock stays the only JS loop; nothing starts a timer at boot.

**Tech Stack:** TypeScript (strict), Vite (`chrome110` target — **no `color-mix()`**), plain CSS, Tauri shell. Shell for commands is **PowerShell 5.1** (NOT Git Bash: no `&&`, no `| cat`).

**Spec:** `docs/superpowers/specs/2026-10-10-ui-quality-pass-design.md` — every requirement below argues from it; executors read both.

## Global Constraints

- No new npm dependencies. No `motion`, no `@hugeicons`. `color-mix()` is unavailable (chrome110).
- Motion vocabulary is `windows/src/core/anim.ts` (`Ease`, `cubicBezier`, `Spring`, `Tracked`, `prefersReduced`, `staggerDelay`) or plain CSS transitions with the curve `cubic-bezier(0.23, 1, 0.32, 1)`. No second easing system.
- Animate `transform`/`opacity`/`left`-of-one-knob only; UI animations ≤ 300 ms except the CallChip's nominal 2500 ms fill (a progress affordance, not UI chrome); ease-out on enters; reduced motion snaps (existing `prefersReduced()` + the CSS media block at style.css:1965).
- Tokens live in `windows/src/tokens.css`. Existing colors: `--ink #f5f6f8`, `--tab-on #1d1f23`, `--accent #3b9eff`, `--accent-soft rgba(59,158,255,0.18)`, `--green #22c55e`, `--red #f4505e`. Hardcode rgba siblings for washes; never invent a new hue.
- Geometry that must not change: ticker `ROW_H = 22`, `DURATION = 380`, `MAX_QUEUE = 4`, `place()` transform math; header height 34 px; pomodoro task row height budget (font 12, padding 3px 4px); slider track height 6 px.
- Island loop rule: never add an expression to the busy gate in `island.ts:747-752` that can be true while `State.mode === "hidden"` — the hidden branch is a ternary arm that ignores everything but `settling`; keep it that way.
- Ponytail: smallest diff that works; delete dead code rather than leave it; no speculative abstractions; reuse `ui/pointer.ts` and existing helpers before writing new ones.
- Verification after every task: `npm run build` must exit 0 with zero `error TS`, from `windows/`; run `anim.test.mjs` when `anim.ts`-adjacent code changes (it never should in this plan).
- Git: explicit paths only, never `git add .` — this tree carries a large pre-existing dirty set that must not be absorbed.
- Reference sources (read-only): `UI and UX reference and pull github repos/react-bits/src/content/Micro/CallChip/CallChip.{jsx,css}` and `.../SwipeRow/SwipeRow.{jsx,css}`; payload transcription in `session hand off/inspo frm react bits.md`.
- Pattern modules to mirror: `windows/src/ui/thoughtline.ts` (host-tick clock, data-attribute states), `windows/src/ui/squishswitch.ts` (pointer capture, velocity, CSS settle), `windows/src/ui/swipetoast.ts`.

---

### Task 1: CallChip → the overview ticker's current row

The running step becomes a chip: glyph slot (tool → tick), the step text, a live ms readout, a linear fill wipe, and an error freeze + shake. Only row **b** (current) becomes a chip; rows **a** (completed) and **c** (incoming) keep today's chevron/check text treatment — the 3-row scroll geometry is untouched.

**Files:**
- Create: `windows/src/ui/callchip.ts`
- Modify: `windows/src/views/ticker.ts` (row b body, `sync`, `tick`, `animating` getter)
- Modify: `windows/src/style.css` (new block after the SwipeToast block, ~line 1246)
- Modify: `windows/src/tokens.css` (two wash tokens)
- Modify: `windows/src/views/icons.ts` (delete the unconsumed `refresh` entry, line ~40)

**Interfaces:**
- Consumes: `h`, `svg` from `views/dom`; `ICONS` (chevronRight, check only); `prefersReduced` is NOT imported — the module asks the media query directly (settings-window precedent in squishswitch.ts:35-36, and ticker runs in the island where `initMotionPreferences` has run, but the media query is correct in both worlds and immune to boot order).
- Produces (used by Task 1's own ticker wiring; nothing later depends on it):
  ```ts
  export type ChipStatus = "running" | "done" | "error" | "idle";
  export interface CallChip {
    el: HTMLElement;
    /** Patch text/status. `restart` re-arms the fill wipe and the clock (a new step). */
    sync(text: string, status: ChipStatus, restart?: boolean): void;
    /** Frame tick from Ticker.tick; writes the ms readout at most every 100 ms. No-op unless running. */
    tick(nowMs: number): void;
    readonly running: boolean;
  }
  export function createCallChip(): CallChip;
  ```
- Status mapping inside `ticker.ts` (from `AgentTask.state: BotStateName`):
  `"working" | "thinking" | "searching" | "ratelimit"` → `"running"`; `"finished"` → `"done"`; `"error" | "dizzy"` → `"error"`; everything else → `"idle"`.

**Pinned constants (callchip.ts):**

```ts
const EXPECTED_MS = 2500;                       // fixed nominal — no per-tool table exists
const SHAKE = [0, -1, 1, -0.66, 0.66, -0.33, 0]; // reference keyframes
const SHAKE_PX = 1.5;                           // reference uses 6px on a 34px chip; ours is 22px
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const fmt = (ms: number) => (ms < 10000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
```

- [ ] **Step 1: Add the wash tokens to `tokens.css`** (first consumption — declare both, they are legitimate component tokens):
  ```css
  --wash-ok: rgba(34, 197, 94, 0.14);    /* --green at the reference's 14% wash */
  --wash-err: rgba(244, 80, 94, 0.14);   /* --red at 14% */
  ```

- [ ] **Step 2: Write `callchip.ts`.** DOM shape (all built with `h()`):
  ```
  div.call-chip[data-status]
    span.call-chip__fill            (absolutely filled, scaleX, transform-origin left)
    span.call-chip__slot            (overflow hidden, one glyph box)
      span.call-chip__glyph[data-state] ×2   (tool glyph = svg(ICONS.chevronRight, 11); tick = svg(ICONS.check, 10))
    span.call-chip__text            (the step text, ellipsis)
    span.call-chip__timer           (tabular-nums, min-width 6ch, right-aligned)
    span.call-chip__sr[role=status] (announce: `${text}, running/done/failed`)
  ```
  Behaviour:
  - `sync(text, status, restart)`: patch text + `data-status`; glyph roll — the newly-current glyph gets `data-state="in"`, the previous gets `"out"`, others neither (reference `roll` pattern, lines 58-59 + 144); if `restart || status transitioned into "running"`, reset clock (`since = null`) and re-arm the fill: set `transition: none`, `scaleX(0)`, force reflow (`getBoundingClientRect()`), clear inline transition so the CSS rule takes over, then next frame set `scaleX(0.9)`.
  - `tick(nowMs)`: if not running, no-op; else `ms = nowMs - since` (set `since = nowMs` on first tick after a running restart), write `fmt(ms)` at most every 100 ms (ThoughtLine's throttle pattern, thoughtline.ts:59-63).
  - `running` getter: last status === `"running"`.
  - `done`: `scaleX(1)` via the CSS rule (200 ms ease-out) + `--wash-ok` background + tick glyph in. `error`: freeze the live scale (read computed `transform` matrix `a`, like the reference line 81, write it back with `transition: none`), wash-err background, tick slot shows the retry glyph **as a glyph only** — no retry button (the ticker surface has no retry action; the spec says drop rather than fake). Shake: `el.animate(SHAKE.map(k => ({ transform: \`translateX(${k * SHAKE_PX}px)\`, easing: EASE_OUT })), { duration: 450 })`, skipped when the media query reports reduce.

- [ ] **Step 3: CSS block in `style.css`**, header comment `/* ── React Bits port: CallChip ───…`, placed after the SwipeToast block. Port `CallChip.css` with these adaptations (no `color-mix`):
  ```css
  .call-chip {
    --cc-size: 22px; --cc-font: 12px; --cc-pad: 8px; --cc-gap: 5px;
    --cc-radius: 8px; --cc-expected: 2500ms;
    --cc-ease-out: cubic-bezier(0.23, 1, 0.32, 1);
    position: relative; display: inline-flex; align-items: center;
    gap: var(--cc-gap); height: var(--cc-size); padding: 0 var(--cc-pad);
    border-radius: var(--cc-radius); overflow: hidden;
    background: var(--tab-on); color: var(--ink);
    font: 500 var(--cc-font) var(--font); line-height: 1; white-space: nowrap;
    max-width: 100%; user-select: none;
  }
  .call-chip__fill {
    position: absolute; inset: 0; transform: scaleX(0);
    transform-origin: left center; pointer-events: none;
    background: rgba(245, 246, 248, 0.08); /* ink at the reference's 8% — no color-mix */
  }
  .call-chip[data-status="running"] .call-chip__fill {
    transition: transform var(--cc-expected) linear;
  }
  .call-chip[data-status="done"] .call-chip__fill {
    background: var(--wash-ok);
    transition: transform 200ms var(--cc-ease-out), background-color 120ms ease;
  }
  .call-chip[data-status="error"] .call-chip__fill {
    background: var(--wash-err);
    transition: background-color 200ms ease;
  }
  ```
  Plus the glyph slot, `__glyph[data-state=in/out]` (translateY ±70% + blur 3px, 240/160 ms, same as reference lines 86-121 with `--cc-done: var(--green)` / `--cc-error: var(--red)` on the in-glyph), `__text` (ellipsis, min-width 0), `__timer` (tabular-nums, 6ch, opacity .5), `__sr` (visually hidden), and a `@media (prefers-reduced-motion: reduce)` block that disables the glyph transforms/filters and the done clip (mirror reference lines 167-180 minus the retry button). The `clip-path` reveal on done from the reference is optional polish — include it only if it costs nothing extra (it transitions `clip-path: inset(100% 0 0 0)` → `inset(0)` at 400 ms ease-out delayed 200 ms; chrome110 supports clip-path transitions).

- [ ] **Step 4: Wire the ticker.** In `ticker.ts`:
  - `makeRow()` keeps its signature; add a dedicated chip row body for **b only**: construct `const chip = createCallChip()` in the `Ticker` constructor; row `b`'s element becomes `h("div", { class: "ticker-row" }, chip.el)` — keep the outer `.ticker-row` so `place()` still positions it (the chip replaces icon+text inside the row, not the row itself).
  - Store `private chipStatus: ChipStatus = "idle"` and the raw task state from `sync(task)`.
  - `sync(task)`: in addition to today's logic, derive status from `task?.state` via the mapping above; `setText(this.b, …)` calls become `chip.sync(this.b.text, status, restart)` where `restart` is true when b's text changed while status is running (a new step re-arms the wipe). Rows a/c unchanged.
  - `tick(nowMs)`: append `this.chip.tick(nowMs);` before the early return at line 140 so the timer updates even with no scroll queued.
  - Busy gate — extend the getter (this is the documented trap; the proof is that `island.ts:747` evaluates this only in the visible arm of the ternary):
    ```ts
    get animating(): boolean {
      return this.startMs != null || this.queue.length > 0 || this.chipRunning;
    }
    ```
    with `private get chipRunning(): boolean { return this.chip.running; }`. Do NOT touch `island.ts`.

- [ ] **Step 5: Delete the dead icon.** Remove `refresh:` from `views/icons.ts` (line ~40) and its comment — no retry button means no consumer, and the handoff housekeeping says delete rather than leave it.

- [ ] **Step 6: Build + verify.**
  Run (PowerShell, from `windows/`):
  ```powershell
  npm run build *> $env:TEMP\build.log; "exit=$LASTEXITCODE"; (Select-String -Path $env:TEMP\build.log -Pattern "error TS" -SimpleMatch | Measure-Object).Count
  ```
  Expected: `exit=0`, `0`.
  Live (when a session is available): the overview's current row is a chip whose fill wipes over ~2.5 s with a ticking `ms` readout; a new step re-arms it; `finished` snaps the fill to full with a green wash + tick glyph; killing the session mid-call freezes the fill with a red wash and the shake plays once. The 3-row scroll still reads identically. Hidden island: process stays at 0 % CPU (the gate change is inside the visible arm only — re-read `island.ts:747-752` to confirm).

- [ ] **Step 7: Commit** (explicit paths only):
  ```powershell
  git add windows/src/ui/callchip.ts windows/src/views/ticker.ts windows/src/style.css windows/src/tokens.css windows/src/views/icons.ts docs/superpowers/plans/2026-10-10-ui-quality-pass.md
  git commit -m "feat(windows): CallChip on the overview ticker — fill wipe, ms clock, error freeze"
  ```

---

### Task 2: SwipeRow → the pomodoro task row's delete gesture

A leftward drag on a task row reveals a Delete drawer with rubber-banding; crossing 60 % of the row (or a hard flick) commits — fold first, then delete. The existing `×` button stays (keyboard + pointer fail-safe).

**Files:**
- Create: `windows/src/ui/swiperow.ts`
- Modify: `windows/src/views/views.ts` (`buildPomodoroView.buildRow`, ~lines 1103-1133)
- Modify: `windows/src/style.css` (new `React Bits port: SwipeRow` block)
- Modify: `windows/src/views/icons.ts` (delete the unconsumed `archive` entry, ~line 42)

**Interfaces:**
- Consumes: `velocityOf`, `project` from `ui/pointer.ts` (`rubber` is re-derived in the module because SwipeRow's `map`/`inv` pair needs the inverse too — the shared `rubber` handles the forward case; port `unrubber` locally as the reference does, lines 20 + 124-132); `h` from `views/dom`; `prefersReduced` from `core/anim` (the island view — `initMotionPreferences` has run).
- Produces:
  ```ts
  export interface SwipeRow {
    el: HTMLElement;            // clip container; surface holds the row's children
    surface: HTMLElement;       // append the row content here
  }
  export function createSwipeRow(opts: {
    onCommit: () => void;       // called AFTER the fold completes
    label?: string;             // aria-label, default "Task"
  }): SwipeRow;
  ```
  The pomodoro view owns what "delete" means (splice + save + notify); the row owns the gesture and the fold.

**Pinned constants:**

```ts
const HYST = 10;          // press → drag threshold
const FLICK = 110;        // px/s release speed that decides by velocity
const DECEL = 0.998;
const COMMIT_AT = 0.6;    // fraction of row width that commits
const ACTION_W = 56;      // drawer width — one Delete action
const COLLAPSE_MS = 200;
const SPRING_MS = 300;    // settle: CSS transition, cubic-bezier(0.23, 1, 0.32, 1)
```

- [ ] **Step 1: Write `swiperow.ts`.** DOM:
  ```
  div.swipe-row[data-phase="idle|dragging|settling|collapsing"]   (position relative, overflow hidden)
    div.swipe-row__drawer          (absolute, right:0, width ACTION_W; background #3f3f46 → use var(--dim-5); a centered "Delete" button, color var(--ink))
    div.swipe-row__surface         (the row content; translateX follows the drag; transition transform SPRING_MS ease-out when settling)
  ```
  Travel model (single action, `direction: "right"` → `s = +1`, drag leftwards produces positive `exposed = s * -dx`… follow the reference exactly with `s = +1` and `x` stored as the surface's translateX which is **negative** when the drawer is revealed — implement `exposed = -x` for `s = +1`, `map(raw)` rubber-bands `raw < 0` (over-drag past closed) and `raw > D` where `D = ACTION_W`; `commitPoint = max(COMMIT_AT * width, D + ACTION_W / 2)`; `canCommit = commitPoint <= width`. Port `inv` alongside `map` (reference lines 115-132) so pointerdown can resume a mid-grip without a jump.
  Gesture:
  - `pointerdown` on surface: capture pointer, record `x0/y0`, start window-level `pointermove`/`pointerup` listeners (the reference's `watchWindow`, lines 37-52 — surface capture alone loses events over child elements that stop propagation; mirror the pattern).
  - `pointermove`: ignore until `|dx| ≥ HYST` and `|dx| ≥ |dy|` (axis lock — a vertical scroll over the list must not start a drawer); then set `data-dragging`, apply `x = -map(exposed)` per move, track a 5-entry `[time, x]` history, and toggle a `data-armed` attribute when `exposed >= commitPoint` (the drawer's Delete button brightens — CSS handles the look).
  - `pointerup`: `v = velocityOf(hist)`. If exposed ≥ commitPoint → commit path. Else target = `|v| >= FLICK ? (v > 0 ? ACTION_W : 0) : exposed + project(v) > ACTION_W / 2 ? ACTION_W : 0` — note `project(v)` sign follows the reference with the s-orientation above; verify by dragging both ways. Settle: add the transition class, set `x` to `-target`, `data-phase="settling"`, remove it on `transitionend`.
  - Commit: `data-phase = "collapsing"`; collapse the **outer** `.swipe-row`: read `offsetHeight`, set inline `height: ${h}px`, force reflow, set `height: 0; opacity: 0` with `transition: height ${COLLAPSE_MS}ms ease, opacity ${COLLAPSE_MS}ms ease` (a real measured height — the rows are content-sized); on `transitionend` call `opts.onCommit()` and clean up inline styles (the element is about to be discarded by the list rebuild anyway). Reduced motion: skip the fold (`onCommit()` immediately) — `prefersReduced()`.
  - A tap that never moved does nothing (the `×` and SpringCheck own their own clicks — do not intercept).
  - Keyboard: the surface is not focusable; no key handling here (the `×` remains the keyboard path — that is the design).

- [ ] **Step 2: CSS block** (`/* ── React Bits port: SwipeRow ───…`):
  ```css
  .swipe-row { position: relative; overflow: hidden; border-radius: 8px; }
  .swipe-row__drawer {
    position: absolute; inset: 0 0 0 auto; width: 56px;
    display: grid; place-items: center; background: var(--dim-5);
  }
  .swipe-row__drawer button {
    border: 0; background: transparent; color: var(--ink);
    font: 600 11px var(--font); cursor: default;
    opacity: 0.55; transition: opacity 160ms ease-out;
  }
  .swipe-row[data-armed] .swipe-row__drawer button { opacity: 1; }
  .swipe-row__surface {
    position: relative; background: transparent; /* the row's own look shows through */
    transition: transform 300ms cubic-bezier(0.23, 1, 0.32, 1);
    touch-action: pan-y;   /* vertical scrolling still belongs to the list */
  }
  .swipe-row[data-dragging] .swipe-row__surface { transition: none; }
  .swipe-row[data-phase="collapsing"] { transition: height 200ms ease, opacity 200ms ease; }
  ```
  The drawer button is inert while `data-phase` is not `idle` (`pointer-events: none` except when armed+idle).

- [ ] **Step 3: Wire `buildRow` in `views.ts`.** Replace the row assembly (lines ~1115-1130) so the SpringCheck + `×` live inside `row.surface`:
  ```ts
  const swipe = createSwipeRow({
    label: text,
    onCommit: () => {
      const at = State.timer.tasks.findIndex((x) => x.text === text);
      if (at < 0) return;
      State.timer.tasks.splice(at, 1);
      State.savePomoTasks();
      State.notify();   // shape change → list rebuild drops the collapsed row
    },
  });
  swipe.surface.append(check.el, delBtn);
  const el = h("div", { class: done ? "task done stagger" : "task stagger", style: `--i:${i}` }, swipe.el);
  ```
  Keep `rows.push({ text, el, check })` — the patch path (`row.check.set`) is unaffected. The `×` handler is unchanged. The rebuild-on-shape-change path (line 1149) already discards old rows; the collapsed row's DOM is removed with it.

- [ ] **Step 4: Delete `ICONS.archive`** from `views/icons.ts` — the single-action drawer needs no icon (text label), and the handoff says delete rather than leave it.

- [ ] **Step 5: Build + verify.**
  ```powershell
  npm run build *> $env:TEMP\build.log; "exit=$LASTEXITCODE"; (Select-String -Path $env:TEMP\build.log -Pattern "error TS" -SimpleMatch | Measure-Object).Count
  ```
  Expected: `exit=0`, `0`.
  Live: drag a task row left → drawer reveals with rubber-band past 56 px; release before 60 % → springs back (or open); drag past 60 % → Delete brightens, release folds the row 200 ms then the task is gone; hard flick commits too; a small wiggle does not; vertical drag over the list scrolls/does nothing; `×` still deletes; stagger enter still plays for the remaining rows on rebuild.

- [ ] **Step 6: Commit**
  ```powershell
  git add windows/src/ui/swiperow.ts windows/src/views/views.ts windows/src/style.css windows/src/views/icons.ts
  git commit -m "feat(windows): SwipeRow on pomodoro tasks — rubber-band drawer, 60% commit, fold"
  ```

---

### Task 3: Header segment — one sliding thumb for the group tabs

The five group buttons become one track with a thumb that glides between slots. Per the frequency gate this is a fast, non-bouncy CSS glide (the spec's bounce-0 spring feel, implemented as the repo's interruptible-UI mechanism — a CSS transition; a `Tracked` spring would need a frame source the header does not have, and squishswitch made the same call for the same reason).

**Files:**
- Create: `windows/src/ui/tabsegment.ts`
- Modify: `windows/src/views/views.ts` (`buildHeader`, ~lines 128-142 + `sync` 176-177)
- Modify: `windows/src/style.css` (extend the `Header tab groups` block, ~line 281)

**Interfaces:**
- Consumes: `h` from `views/dom`; `ICONS` untouched.
- Produces:
  ```ts
  export function attachTabSegment(host: HTMLElement): (active: HTMLElement) => void;
  ```
  `host` is the `.tab-groups` element (buttons already appended by `buildHeader`). Returns the updater: call it from the header's `sync()` with the active group's button. First call measures every button's `offsetLeft/offsetWidth` (cached; re-measure on `window.resize` via one listener owned by the module).

- [ ] **Step 1: Write `tabsegment.ts`.** Insert as the host's first child: `const thumb = h("span", { class: "tab-seg-thumb", "aria-hidden": "true" })`. Cache `Map<HTMLElement, {x: number, w: number}>` from `offsetLeft/offsetWidth` (force one reflow to populate; refresh on `resize`). Updater: if the active button is unchanged, no-op; else `thumb.style.width = ${w}px; thumb.style.transform = translateX(${x}px);` and toggle a `data-on` attribute for the label-color flip (CSS handles colors — buttons keep their own `.active` class for anything else; the thumb is purely visual, painted behind the labels).

- [ ] **Step 2: CSS** (in the `Header tab groups` block):
  ```css
  .tab-groups { position: relative; }
  .tab-seg-thumb {
    position: absolute; top: 0; left: 0; height: 100%;
    border-radius: 8px; background: var(--tab-on);
    transition: transform 300ms cubic-bezier(0.23, 1, 0.32, 1), width 300ms cubic-bezier(0.23, 1, 0.32, 1);
    pointer-events: none;
  }
  .tab-groups .tab-group { position: relative; }        /* labels above the thumb */
  .tab-groups .tab-group.active { background: transparent; color: var(--ink); }  /* thumb carries the fill now */
  @media (prefers-reduced-motion: reduce) {
    .tab-seg-thumb { transition: none; }
  }
  ```
  Keep `.tab-group.active`'s color exactly as today (`#F5F6F8` = `var(--ink)`); only the background moves to the thumb.

- [ ] **Step 3: Wire `buildHeader`.** After the group-tabs loop, `const setThumb = attachTabSegment(groupsEl);`. In `sync()` (line ~177), next to the existing `classList.toggle("active", …)`: `setThumb(tabOf(group))` using the `groupTabs` map. The very first `sync()` also positions the thumb without a glide: the updater's first invocation should set the transition to `none`, position, force reflow, then restore the transition (the mounted-flag pattern from squishswitch's `data-squish` restart, or simply check a module-local `placed` boolean).

- [ ] **Step 4: Build + verify.**
  ```powershell
  npm run build *> $env:TEMP\build.log; "exit=$LASTEXITCODE"; (Select-String -Path $env:TEMP\build.log -Pattern "error TS" -SimpleMatch | Measure-Object).Count
  ```
  Expected: `exit=0`, `0`.
  Live: switching groups glides one thumb (300 ms, no bounce) with the active label in `--ink`; rapid switching retargets mid-flight (CSS transition, no jump); sub-view pills row and icon tabs untouched; reduced-motion jumps.

- [ ] **Step 5: Commit**
  ```powershell
  git add windows/src/ui/tabsegment.ts windows/src/views/views.ts windows/src/style.css
  git commit -m "feat(windows): header group tabs become one sliding-thumb segment"
  ```

---

### Task 4: Slider micro-interactions — knob, glow, readout

One `makeSlider` change covers volume and brightness: a 14 px accent knob that rides the value, a soft glow while dragging, and a tabular percentage that fades in on interaction and out 600 ms after the last change.

**Files:**
- Modify: `windows/src/views/views.ts` (`makeSlider`, lines ~701-758; row assembly ~825-837)
- Modify: `windows/src/style.css` (Control center block, ~line 1269)

**Interfaces:**
- Consumes: existing `makeSlider(write, commit)` closure — no new imports.
- Produces: `makeSlider` returns `{ el, sync, valueEl }` where `valueEl` is the readout span (rows append it after the track). No other module consumes this.

- [ ] **Step 1: Extend `makeSlider`.**
  - Add `const knob = h("div", { class: "cc-slider-knob", "aria-hidden": "true" })` inside the track (after the fill).
  - Add `const valueEl = h("span", { class: "cc-value", "aria-hidden": "true" })`.
  - `place(v)` helper used by both `apply` and `sync`:
    ```ts
    const place = (v: number) => {
      fill.style.transform = `scaleX(${v})`;
      const w = track.clientWidth - 14;
      knob.style.left = `${7 + v * Math.max(0, w)}px`;
    };
    ```
    (`clientWidth` is already paid for on `pointerdown` via the cached rect — for the rare external `sync`, one read is acceptable; do not cache stale widths.)
  - Readout lifecycle: a `showReadout()` that writes `Math.round(v * 100) + "%"`, sets `valueEl.dataset.on = ""`, and (re)arms a 600 ms `setTimeout` that removes `data-on`. Call it from `apply()` and from the wheel handler; **not** from `sync()` (external OS changes while the user isn't interacting should not flash the readout — Emil: no decoration without feedback purpose).
  - Drag class: `pointerdown` adds `dragging` to the track (exists today); also set `data-dragging` on the knob's parent for the CSS transition kill (the existing `.dragging` class on the track is enough — style off it).
  - `sync(v)`: `place(clamp01(v))` and update `valueEl` text only if the readout is currently on (so the value stays truthful mid-fade).
  - The knob's own motion: while `.dragging`, `transition: none` (1:1 with the pointer — already true because we write `left` directly each move); when not dragging, the CSS rule below glides it (wheel steps and seeds). No JS spring — the transition is the spring-equivalent here (one element, occasional external updates; a `Tracked` + frame source is machinery for nothing).

- [ ] **Step 2: CSS** (Control center block):
  ```css
  .cc-slider { position: relative; }
  .cc-slider-knob {
    position: absolute; top: 50%; width: 14px; height: 14px; margin-top: -7px;
    left: 7px; border-radius: 50%; background: var(--accent);
    box-shadow: 0 0 0 2px var(--card);
    transition: left 250ms cubic-bezier(0.23, 1, 0.32, 1);
    pointer-events: none;
  }
  .cc-slider.dragging .cc-slider-knob { transition: none; }
  .cc-slider.dragging .cc-slider-fill,
  .cc-slider.dragging .cc-slider-knob {
    box-shadow: 0 0 10px var(--accent-soft);   /* soft accent halo while held — not a neon outer glow */
  }
  .cc-slider.dragging .cc-slider-knob { box-shadow: 0 0 0 2px var(--card), 0 0 10px var(--accent-soft); }
  .cc-value {
    font: 500 11px var(--font); font-variant-numeric: tabular-nums;
    color: var(--dim-2); width: 4ch; flex: none;
    opacity: 0; transition: opacity 250ms ease-out;
  }
  .cc-value[data-on] { opacity: 1; transition: opacity 150ms ease-out; }
  @media (prefers-reduced-motion: reduce) {
    .cc-slider-knob, .cc-value { transition: none; }
  }
  ```
  (The two `dragging` box-shadow rules merge into one selector list in the real edit; the knob's static ring `0 0 0 2px var(--card)` is what keeps it from looking pasted onto the fill.)

- [ ] **Step 3: Wire the rows.** In `buildControlCenter`, append `volume.valueEl` after `volume.el` in the volume row (before `muteBtn`), and `brightness.valueEl` after `brightness.el` in the brightness row. No layout change otherwise.

- [ ] **Step 4: Build + verify.**
  ```powershell
  npm run build *> $env:TEMP\build.log; "exit=$LASTEXITCODE"; (Select-String -Path $env:TEMP\build.log -Pattern "error TS" -SimpleMatch | Measure-Object).Count
  ```
  Expected: `exit=0`, `0`.
  Live: drag volume/brightness → knob tracks 1:1, track swells (existing), accent halo appears, percentage shows and stays while adjusting; release → halo gone, readout fades after ~600 ms; wheel-step the slider → knob glides 250 ms and the readout flashes; seed-on-open → knob lands without flashing the readout; mute button still toggles; debounced commit (150 ms + flush on release) unchanged.

- [ ] **Step 5: Commit**
  ```powershell
  git add windows/src/views/views.ts windows/src/style.css
  git commit -m "feat(windows): control-center sliders get knob, drag glow, value readout"
  ```

---

### Task 5: Gated micro-interaction scan (report + at-most-CSS fixes)

The restraint pass. Read-only sweep of the island + settings views against the four-question gate (find-animation-opportunities skill — read `C:\Users\Stanley\Downloads\coucou\.agents\skills\find-animation-opportunities\SKILL.md` and follow its workflow and output format). Its frequency table and purpose list are the acceptance bar; the skill's hard cap of 5-7 suggestions applies to the *whole* app, and Tasks 1-4 already spent four of those slots (CallChip fill/clock, SwipeRow gesture, segment glide, slider knob/glow/readout are their rows — cite them in the report rather than re-proposing).

**Files:**
- Create: `docs/superpowers/plans/2026-10-10-ui-quality-pass-scan.md` (the report)
- Modify (only if a survivor is CSS-only and unambiguous): `windows/src/style.css`

**Interfaces:**
- Consumes: the whole of `windows/src/views/`, `windows/src/settings/`, `windows/src/style.css`; the skills above.
- Produces: the report; at most 3 CSS-only fixes (each ≤ 10 lines, each citing its gate answers). Anything larger or behavior-touching is listed as "for the user to approve" — do NOT implement it in this task.

- [ ] **Step 1: Sweep** the hunt seams (press states, conditional renders without transitions, drag handlers, list enters, empty/success states) across island + settings. Existing coverage to recognize as shipped (do not re-propose): unified press scale (style.css:422-447), overlap view crossfade + 35 ms stagger (style.css:296-331), ThoughtLine, SpringCheck, SquishSwitch, SwipeToast, CallChip, SwipeRow, segment, sliders.
- [ ] **Step 2: Gate every candidate** through frequency → purpose → speed ≤ 300 ms → function. Expect to reject most; the reject list is mandatory (2-5 entries with the killing question).
- [ ] **Step 3: Write the report** in the skill's three-part format (opportunities table / rejects / verdict). If nothing survives, say so plainly — that is a passing result.
- [ ] **Step 4: Ship at most 3 CSS-only survivors** (examples of the only class that qualifies without sign-off: a missing `:active` scale on a pressable that the unified block missed; a missing `opacity` transition on a state swap). Each gets its own build check. Anything else: stop and hand the row to the user.
- [ ] **Step 5: Build + commit**
  ```powershell
  npm run build *> $env:TEMP\build.log; "exit=$LASTEXITCODE"; (Select-String -Path $env:TEMP\build.log -Pattern "error TS" -SimpleMatch | Measure-Object).Count
  git add docs/superpowers/plans/2026-10-10-ui-quality-pass-scan.md windows/src/style.css
  git commit -m "docs: gated micro-interaction scan + css-only survivors"
  ```

---

## Self-Review

**Spec coverage:** A1 CallChip → Task 1 (fill/expected nominal 2500, wash tokens, shake, busy-gate proof, retry dropped, geometry kept). A2 SwipeRow → Task 2 (map/inv, commitAt .6, flick, fold, `×` kept, `project`/`velocityOf` consumed, `archive` deleted). B segment → Task 3 (one thumb, 300 ms bounce-0 feel via CSS transition with the documented Tracked-deviation rationale, sub-pills untouched). C sliders → Task 4 (knob, glow, readout, drag 1:1, external glide, no readout flash on seed). D scan → Task 5 (gate, cap, report, reject list). Out-of-scope list honored: no CometDial/GlideSelect/JellyRadio, no settings redesign, no segment drag.

**Placeholder scan:** every step carries exact constants, DOM shapes, CSS, and commands; the two "port from reference" steps name the exact reference file and the exact lines/patterns to mirror (the references are in-repo). No TBDs.

**Type consistency:** `ChipStatus` used by both callchip.ts and ticker.ts; `createSwipeRow({onCommit, label})` matches its single call site; `attachTabSegment(host) → (active) => void` matches the header's `sync` usage; `makeSlider`'s new `valueEl` is consumed in the same task. Shell snippets are PowerShell throughout.
