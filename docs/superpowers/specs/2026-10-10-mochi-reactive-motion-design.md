# Mochi Reactive Motion — design spec

**Date:** 2026-10-10 · **Status:** approved by user (design sections 1–3 + catalog 2b) · **Target:** `windows/` Tauri app only (Mac Swift app untouched; no taskbar/dock surface)

## 1. Goal

Make the Windows island's motion feel like bloom's ("mechanical", per-property, interruptible) and make **Mochi**, the canvas-drawn blob, the living indicator of everything that happens: system state, media, agent sessions, and direct touch. The island reacts; Mochi *shows* it.

## 2. Non-goals

- Mac app (`NotchBuddy/`), phone, widgets, relay — untouched.
- Bloom's dock/taskbar, AppBar, screen corners, settings redesign.
- Heuristic "video vs audio" detection (one media reaction covers both; fullscreen-video is v2).
- Rewriting Mochi's shipped poses/expression set (additive only: aura, props, new poses composed from existing parts).
- Any new npm dependency.

## 3. Architecture

### 3.1 Spring core — `windows/src/core/spring.ts` (new)

- Semi-implicit Euler spring integrator (~40 lines): `k` stiffness, `c` damping, `m` mass, `restDelta`, velocity carried across retargets (re-targeting mid-flight reverses naturally — the bloom mechanism feel).
- API shape: `const s = spring(value, cfg); s.set(target); s.step(dtMs): number; s.done: boolean`.
- `dtMs` comes from the island's **existing** frame loop (the one that ticks Mochi canvases). **No second rAF loop anywhere.**
- Sleep: when `|v| < restDelta` and `|value − target| < restDelta`, `step` becomes a no-op returning the settled value and `done = true`. The frame loop skips sleeping springs entirely → the **0 %-CPU-when-hidden rule is preserved**.
- Reduced motion (`prefersReduced()`): `set()` jumps instantly (`value = target`, `v = 0`, `done = true`).

### 3.2 Motion tokens — `windows/src/core/motion-tokens.ts` (new)

Single source of spring configs, ported from bloom's per-property split (App.tsx:2016-2026):

| Token | Use | Config |
|---|---|---|
| `SHELL_WIDTH` | island width | `k 400, c 31` |
| `SHELL_HEIGHT` | island height | `k 450, c 29` |
| `SHELL_Y` | island slide | `k 550, c 45, m 0.8, restDelta 0.001` |
| `SHELL_RADIUS` | corner radius | `k 1000, c 40` |
| `DEFAULT` | anything else | `k 500, c 30` |

CSS micro-states keep the existing curve `cubic-bezier(0.23, 1, 0.32, 1)`. No second easing system; springs replace only the shell geometry animations, not CSS transitions.

### 3.3 Shell migration — `windows/src/island/island.ts`

- The island's DOM width/height/y/radius retarget through the four shell springs instead of today's CSS-transition/JS-set path. Each property writes per frame only while awake.
- **Authorized island.ts edits** (deviation from the previous plan's freeze — required here). Sacred invariant preserved: the busy-gate ternary's hidden arm (`island.ts:747-752` shape) ignores everything but `settling`; spring ticking must not keep the loop alive while hidden — when the island hides, shell springs snap to hidden targets (reduced-motion-style jump) and sleep.
- Existing geometry functions stay the single source of target values (computed, not measured mid-flight — bloom rule).

### 3.4 Reaction bus — `windows/src/mochi/reactions.ts` (new)

- One entry point: `react(kind: ReactionKind, opts?)`.
- **Priority stack** (highest wins for body pose): persistent system condition (battery/DnD) > session state (working/error/done/ratelimit/approval) > media state > transient flash (controls, touch). One body pose at a time; **one transient at a time — newest wins**; TTLs built in.
- Aura color/intensity composes independently of pose (pose from state, tint from context — e.g. headphones pose + album-tinted aura).
- Every reaction is `{ pose?, aura?, particles?, ttl? }` resolved against `BotStateCfg`; unknown kinds no-op.
- Engine additions in `windows/src/mochi/engine.ts` are **additive**: an `aura` render pass (soft radial glow behind the body, color/intensity params), a `props` slot (headphones drawn from existing part vocabulary), and new poses composed from existing parts (eyes/mouth/hands/blush/squash). Existing poses and the shipped look are not restyled.

### 3.5 Touch — tickle

- Plain clicks on Mochi's body canvas (not the invisible button hit-areas, which keep priority) trigger `react("tickle")`: ~1.2 s jitter + squash ripple, eyes shut, blush flare, sparkle particles. Re-tap during a squirm re-triggers (stacking jitter phase).
- Long-press → `react("nuzzle")` (calm lean, ~2 s). Same dispatch seam.

## 4. Reaction catalog

TTLs default, tunable in one table inside `reactions.ts`.

### 4.1 Control flashes (transient)

| Trigger | Reaction | TTL |
|---|---|---|
| Brightness slider change | aura intensity follows value; happy squint at high values | 3 s |
| Volume slider change | note particles, bob amplitude ∝ level | 3 s |
| Mute toggle on | hands over ears, aura dims | 2 s |
| Theme/color change | sparkle burst | 1.5 s |

### 4.2 System conditions (persistent while true)

| Condition | Reaction |
|---|---|
| Battery < 20 %, not charging | drained pose: droopy eyes, sagging squash, desaturated aura, occasional sweat particle |
| Charging | perky pose, charge sparks |
| Battery = 100 % | **flex**: arms-up bicep pose, `100%` badge, one proud sparkle (re-triggers on each newly observed full) |
| Do Not Disturb | sleep pose, zzz particles |

Battery data: one new Rust power command (`get_power_status` → `{ percent: number, charging: boolean }`) polled sparsely (on change events if the API allows, else 60 s), pushed to the bus. No new crate unless a std/Win32 path is sufficient — implementer verifies and reports.

### 4.3 Agent domain (session states)

| Session event | Reaction |
|---|---|
| Approval requested | wave-at-card pose, question badge, attention particles; **doubles as event-peek seed** (§5.1) |
| Working / thinking | existing focused state — untouched |
| Session finished | hearts celebration (existing hearts) |
| Error / StopFailure | dizzy (existing), red-tinted aura |
| Rate limit | tired/panting, steam wisp |

### 4.4 Media (persistent while playing)

| Condition | Reaction |
|---|---|
| Any media playing (Spotify, video, browser) | **headphones** prop + rhythmic bob (~0.5 s beat squash), note particles |
| Loud volume while playing | bob amplitude grows |
| Track change | perk-up + aura tints to the new track's album palette (colors `backgroundEffects.ts` already samples per track) |
| Paused | headphones tilted, patient waiting, bob stops |
| Muted while playing | hands over headphones, aura dims |

Source: the existing track-change/media events already consumed by `backgroundEffects.ts` — the bus subscribes; no new detection plumbing.

### 4.5 Touch

| Gesture | Reaction |
|---|---|
| Tap Mochi body | ticklish squirm (§3.5) |
| Long-press Mochi body | nuzzle |

## 5. DOM features (the bloom seven, adapted)

1. **Per-property springs** — §3.1–3.3.
2. **Event-peek** — a salient agent event (approval requested, error, pomodoro done) force-reveals the hidden island for a bounded window (default 4 s) *with* its Mochi reaction playing; manual interaction cancels the peek timer (sticky open). Implementation lives in the island's visibility path; does not fight `settling`.
3. **Odometer roll-digits** — pomodoro countdown: fixed box, `overflow: hidden`, `perspective`, digits keyed from the right, roll `y ±72 % + rotateX ±50°`, 400 ms `cubic-bezier(0.22, 1, 0.36, 1)` (bloom's expo-out; declared second curve, used only here). Reduced motion snaps.
4. **Asymmetric enter/exit** — in-island view swaps: enter ~200 ms ease-out; exit ~100 ms with `blur(4px)` + slight scale-down (CSS; container-level, applied to the view root, never per-widget).
5. **Hover-grace** — 800 ms grace before collapse when the pointer leaves the island surface (crossing the pill↔panel gap must not flicker-shut); any island pointer activity resets the timer.
6. **Measured marquee** — ticker row text that overflows: measure once (ResizeObserver), duration `max(distance / 30px/s, 5s)`, CSS-var-driven keyframes with hold-at-ends, edge mask. Only mounts when text actually overflows.
7. **Ambient glow** — delivered as the reaction bus's aura (§3.4), not a separate mechanism.

## 6. Reaction preview harness (verification affordance)

A debug-only row in the settings window (hidden behind an existing debug/advanced section if one exists; otherwise a `?reactions=1` query flag on settings.html): every `ReactionKind` as a clickable chip that fires `react(kind)` against a live Mochi instance. This is how the catalog is eyeballed without a live agent session. Not new user-facing UI surface.

## 7. Files touched (expected)

| File | Change |
|---|---|
| `core/spring.ts` | new — integrator |
| `core/motion-tokens.ts` | new — configs |
| `mochi/reactions.ts` | new — bus + catalog table |
| `mochi/props.ts` | new — headphones etc. draw helpers |
| `mochi/engine.ts` | additive: aura pass, prop/pose hooks |
| `island/island.ts` | shell springs, tick wiring, event-peek, tickle dispatch |
| `views/views.ts` | slider → react() hooks, pomodoro digits, view exit classes |
| `views/ticker.ts` | marquee mount |
| `settings/*` + `src-tauri/*` | battery command + preview harness |
| `style.css` / new CSS blocks | exits, digits, grace, masks |
| `core/anim.ts` | unchanged (springs live beside it) |

## 8. Constraints

- No new npm dependencies; no `color-mix()` (chrome110); TypeScript strict.
- One frame loop (the island's). Springs and reactions are passengers on it.
- Reduced motion snaps everywhere, including springs and digit rolls.
- Existing shipped Mochi poses/views are never restyled — additive only.
- Busy-gate tombstone and 0 %-CPU-when-hidden rule preserved (§3.3).
- Git: explicit paths only; per-task commits.
- Ponytail discipline throughout: smallest diff, delete dead code, no speculative abstraction.

## 9. Verification

- Per task: `npm run build` exit 0, zero `error TS` (PowerShell, from `windows/`); `anim.test.mjs` stays green (`anim.ts` untouched).
- Per reaction work: fire the reaction in the preview harness; screenshot-or-eyeball checklist recorded in the task report (live instance permitting).
- **End-to-end pass (final task):** full build; harness sweep of every catalog row; live-or-harness verification of shell springs (mid-flight retarget, hidden snap, reduced motion); battery command against a real or mocked status; media reactions against a real player if available; peek/digits/marquee/grace/exits each confirmed once; busy-gate + hidden-CPU check; consolidated eyeball checklist for anything unverifiable headlessly.

## 10. Execution shape

Subagent pipeline with file-ownership partitioning so implementers can run in parallel where files don't collide (springs/Rust/media ≠ Mochi engine ≠ DOM features), one reviewer seat per task, reviews pipelined behind implements, ponytail skill active for every implementer, writing-plans artifact as the contract.
