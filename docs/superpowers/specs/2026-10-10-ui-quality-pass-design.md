# Windows island UI quality pass — design

**Date:** 2026-10-10 · **Status:** approved in chat, pending spec review
**Scope:** `windows/` only (Tauri island + settings window). The macOS tree is untouched.

## Goal

Finish the React Bits port (Tasks 3 and 7), then raise the island's interaction quality: buttery, restrained micro-interactions on the controls that lack them, a decluttered header, and one new segmented control — all within the existing hand-rolled motion vocabulary (`windows/src/core/anim.ts`, island rAF clock, `h()` DOM helpers). No new dependencies (`motion` / `@hugeicons` stay uninstalled; chrome110 build target rules out `color-mix()`).

## Design read

Operate-mode dark app UI, Linear/Apple-adjacent. Dials: VARIANCE 5, MOTION 5, DENSITY 6. Motion budget is spent on **feedback** and **state indication** only (Emil's frequency gate): the island opens dozens of times/day, so every new animation stays ≤ 300 ms, uses the repo's strong ease-out / spring curves, is interruptible (CSS transitions over keyframes for retargetable UI), and honors the existing reduced-motion path (`prefersReduced` + the CSS media block). Animate `transform`/`opacity` only.

## Workstreams

### A. Finish the port (handoff tasks 3 + 7)

Carried from `docs/superpowers/plans/2026-10-09-reactbits-ui-port.md` and `session hand off/05_NEXT_TASKS.md`. The full step lists live there; this spec pins only the decisions:

**A1. CallChip → overview ticker rows** (`ui/callchip.ts` new, `views/ticker.ts`, `style.css`)
- Chip body: glyph slot (tool → tick → `ICONS.refresh` retry), tool name, argument, live ms readout.
- Fill wipe: `transform: scaleX()` to 90 % over a **fixed nominal duration** (no per-tool expectation table exists — inventing one is product behaviour we don't own; the number is written into the plan step), completed to 100 % on done, frozen on error. Linear **CSS transition**, not the rAF loop.
- Error: 450 ms small-amplitude `translateX` shake, skipped under reduced motion.
- Washes: declare `--wash-ok` / `--wash-err` in `tokens.css` at first consumption (legitimate component tokens; no `color-mix`).
- **Busy-gate rule:** a running chip's fill must not be driven by the overview loop. The CSS transition runs off-thread; if any flag is added to the island's `animating` expression, prove it is `false` while `State.mode === "hidden"` (island.ts carries the tombstone of the last time this burned frames on a hidden island).
- `ROW_H = 22`, `DURATION = 380`, `MAX_QUEUE = 4`, `place()` geometry unchanged — only the row body changes.
- Data: `AgentTask.steps[]` + `stepIndex` already carry everything; no Rust or `state.ts` changes.

**A2. SwipeRow → pomodoro delete gesture** (`ui/swiperow.ts` new, `views/views.ts` `buildPomodoroView`, `style.css`)
- Port `map()` / `inv()` travel model with rubber-banding, `commitAt` 0.6, flick threshold, `snapBounce` settle, full-swipe leap — via the already-ported `ui/pointer.ts` (`velocityOf`, `rubber`, `project` finally consumed).
- `direction: "right"`: leftward drag reveals Delete, matching the `×` it sits beside.
- **The `×` stays.** This is the island's only destructive gesture; keyboard/pointer users keep it. Both controls coexisting is the intended end state.
- Commit: fold animation first (`collapseMs` height collapse, keeping the 12 px row budget and the 35 ms stagger for siblings), then remove + `savePomoTasks` + notify.

### B. Header segment (declutter + new control)

The five group tabs (Home / Agents / Media / System / Tools) become **one sliding-thumb segment** (RubberSegment-inspired, hand-rolled):
- One thumb element absolutely positioned over the group row; on active-group change it springs to the new slot: `Spring` duration 0.3 s, bounce 0 (the reference's own `SPRING_UI`), driven by the island rAF clock + `Tracked`, so an interrupted move carries velocity (Emil: springs for interruptible gestures).
- Thumb: `#1D1F23` fill, radius 8 px, label color flips to `#F5F6F8` on the active slot (existing colors — no new palette).
- **No dilation/stretch/drag**: five labels, dozens of switches/day — per the frequency gate this is near-imperceptible motion territory. The slide *is* the affordance.
- Sub-view pills, icon tabs, gear/sound: untouched. Selecting a group still jumps to its first view; `blip()` on tap stays.
- Reduced motion: thumb jumps (existing `prefersReduced` pattern).
- Effect: five separate active-pills collapse into one track — the declutter move.

### C. Slider micro-interactions (brightness + volume)

Both sliders share `makeSlider` (`views.ts:701`), so one change covers both:

- **Knob:** a 14 px accent circle at the fill's end. While dragging it tracks the pointer 1:1 (no spring between pointer and knob — Emil: direct tracking for functional drag); on external changes (wheel, seed fetch, `sync()`) it springs to the value (stiffness via existing `Spring`, duration ~0.25 s, bounce 0.15 max).
- **Glow:** while `.dragging`, fill + knob get a soft accent `box-shadow` (inset-safe, subtle — no neon outer glow per taste-skill bans).
- **Readout:** a tabular-num percentage (`72%`) beside the slider, opacity 0 → 1 on first interaction, fading out ~600 ms after the last change. Pure `opacity` transition (150 ms ease-out in, 250 ms out).
- Track swell on grab (`scaleY(1.5)`) stays as shipped.
- Wheel/keyboard: unchanged behavior, knob now animates instead of teleporting.
- The existing pointer-capture, cached-rect, 150 ms debounced-commit logic is untouched — this is presentation layered on the value path, not a rewrite.

### D. Gated micro-interaction sweep

With `find-animation-opportunities` active: one read-only pass over island + settings views against the four-question gate (frequency → purpose → speed ≤ 300 ms → function). Output: a table of survivors (hard cap **7**, including the slider/segment items above) and an explicit reject list with the killing gate question — written into the implementation plan's scan task. Ship only survivors that aren't already covered by A–C. Press springs, overlap crossfade, stagger enters, ThoughtLine/SpringCheck/SquishSwitch/SwipeToast are baseline — not re-audited, not restyled.

## Explicitly out of scope (YAGNI)

- CometDial, GlideSelect, JellyRadio, BranchedMenu, FolderFloat, PromptBar, CodeSlots, FuseButton — none earns its keep against the gate today.
- Settings-window redesign; the `<select>`s stay native.
- Drag-to-flick / stretch / squash on the segment.
- macOS tree, Rust side, new deps, telemetry of any kind.

## Architecture notes

- New modules follow the existing port pattern: `windows/src/ui/<name>.ts` exporting a factory (`createX()` / `x()`), stable nodes, class-patched updates; CSS in a clearly-commented `style.css` block next to the sibling ports.
- One motion vocabulary: everything goes through `anim.ts` (`Ease`, `cubicBezier`, `Spring`, `Tracked`, `staggerDelay`, `prefersReduced`) or plain CSS transitions; no second easing system.
- The island's single rAF clock remains the only JS loop; no module starts its own.
- State flow unchanged: `State.notify()` → `sync()` patches; slider commits stay debounced 150 ms with flush-on-release.

## Error handling

- CallChip error path: frozen fill + shake + retry affordance; retry glyph is inert unless wired to a real retry (if no retry action exists on the ticker surface, the affordance renders but is dropped from the plan rather than faked).
- SwipeRow: commit only on threshold/flick; interrupted drags settle back; the `×` remains the fail-safe path.
- Bridge calls that fail (brightness, volume) leave the knob where the user put it — no snap-back punishment.

## Verification

- `cd windows; npm run build` → 0 TS errors after every task (capture `$LASTEXITCODE`, PowerShell-safe).
- `node --experimental-strip-types src/core/anim.test.mjs` after anim.ts-touching tasks.
- New spring/knob logic gets a small check alongside the existing anim test pattern if non-trivial (one test file, no framework).
- Live smoke (human, when convenient): drag both sliders, switch group tabs, run a pomodoro task delete, observe a live agent session's ticker chip. The standing manual E2E checklist in `05_NEXT_TASKS.md` stays open debt — this spec does not close it.
- Commit discipline: explicit paths only, never `git add .` in this tree; two-commit split preserved (port vs. accent-wash fix) if the user asks to commit.
