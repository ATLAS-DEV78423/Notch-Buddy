# Mochi Reactive Motion — End-to-End Verification Report (Task 7)

**Plan:** `docs/superpowers/plans/2026-10-10-mochi-reactive-motion.md`
**Range verified:** `0189856` (plan) → `29b6047` (HEAD, Tasks 1–6 done)
**Commits:** `322b0a7`, `2e7824d`, `dee506b`, `43e9070`, `818b5b3`, `4d7b477`, `29b6047`
**Host:** Windows 11, bash + PowerShell 5.1. **No live island instance and no browser automation in this environment.**

> **Honesty rule for this report.** Every purely visual item is marked **NOT OBSERVED**. For each, the
> mechanism-level evidence (the exact code path that implements it, `file:line`) is given so the
> consolidated eyeball checklist below is actionable when a live instance runs. Nothing here claims an
> observation that was not made. The only *observed* facts are the build/test gates and static diffs.

---

## Step 1 — Build + test gates (OBSERVED)

| Gate | Command (from `windows/`) | Result |
|---|---|---|
| Build | `npm run build` | **exit=0**, **0** lines matching `error TS` |
| Spring test | `node --experimental-strip-types src/core/spring.test.mjs` | **exit=0** — `spring integrator OK` |
| Anim test | `node --experimental-strip-types src/core/anim.test.mjs` | **exit=0** — `anim motion vocabulary OK` |

Build tail confirms a clean bundle (`✓ built in 12.43s`; `island-j7ywelTN.js 146.35 kB`). The `grep -c`
returns `0` (which is why the wrapper reports a non-zero shell status — `grep` exits 1 on zero matches;
the build itself is exit=0).

## Step 5 — Static regression checks (OBSERVED)

| Check | Result |
|---|---|
| `git diff 0189856..29b6047 -- windows/src/core/anim.ts` | **EMPTY** (0 lines) — `anim.ts` never changed across the whole plan |
| Plan range touches only `windows/src/{core,island,mochi,views,style.css}` | confirmed by `git diff --stat` (13 files, +928/-63) |
| Busy-gate tombstone hidden arm | **untouched**: `State.mode === "hidden" ? settling : …` at `island.ts:856-857`; hidden arm ignores everything but `settling` (`shellMoving`) |

### Busy-gate re-read (mechanism evidence)

`windows/src/island/island.ts:852-861`:

```ts
const settling = this.shellMoving;
const busy = State.mode === "hidden"
  ? settling
  : settling || !this.botCx.settled || !this.botCy.settled || !this.botSize.settled ||
    greetingActive || this.engine.busy || UploadSeq.isActive ||
    Ticker.animating || backgroundEffect() !== "off";
```

The hidden arm is exactly `settling`. `engine.busy` (which is permanently true for any state with a
looping animation, and also true while a reaction's `poseName`/`auraColor` is set — `engine.ts:529-548`)
is **only** consulted in the visible arm. The shell springs snap-and-sleep on hide
(`animateGeometry()`: `State.mode === "hidden" || prefersReduced()` → `set(target, true)`,
`island.ts:527-536`), so a hidden island keeps no springs awake. 0 %-CPU-when-hidden preserved.

---

## Step 2 — Harness sweep (all 18 kinds: NOT OBSERVED; code paths cited)

Harness: `?reactions=1` self-installing chip row, `windows/src/mochi/reactions.ts:131-160`. It is a
top-level side-effect guarded on `location.search` and `document.body` (`reactions.ts:158-160`); chips
iterate `Object.keys(CATALOG)` (18 entries), condition kinds route to `setCondition`, all others to
`react(kind, { intensity: 0.8 })` (`reactions.ts:144-153`).

The tick path is: island frame loop → `tickReactions(nowMs)` (`island.ts:834`) → `resolve()`
(`reactions.ts:103-110`) → `engine.setPoseOverride` / `setAura` / `setProp` (`reactions.ts:126-128`).
The engine registration is `setPrimaryEngine(this.engine)` (`island.ts:116`).

**Legend — columns:**
- **Pose** → pose name in `CATALOG` (`reactions.ts:32-51`) → `POSES` entry (`engine.ts:137-150`) → forced fields in `engine.update` (`engine.ts:679-720`); eye drawn via `poseEye` (`engine.ts:887`).
- **Aura** → `CATALOG` aura → `withOpts` (`reactions.ts:113-119`) → `setAura` (`engine.ts:326-329`) → `drawAura` radial gradient (`engine.ts:810-820`).
- **Prop** → only set when `media-playing || media-paused` → `setProp("headphones")` (`reactions.ts:128`) → `drawHeadphones` (`engine.ts:782`, `props.ts:8-33`).
- **Particles** → `react()` one-shot `engine.emit(...)` (`reactions.ts:91-96`) → `drawParticles` (`engine.ts:1208-1257`).

| # | Kind | Chip route | Pose → code path | Aura | Prop | Particles | Observed |
|---|---|---|---|---|---|---|---|
| 1 | `brightness` | `react` (transient) | none | `#FFFFFF` 0.7 (harness intensity 0.8) | — | — | NOT OBSERVED |
| 2 | `volume` | `react` | none | `#7CC7FF` 0.7 | — | — | NOT OBSERVED |
| 3 | `mute-flash` | `react` | none | `#F4505E` 0.9 | — | — | NOT OBSERVED |
| 4 | `theme-sparkle` | `react` | `squint-happy` (`engine.ts:138`) → eye `happy`, `es 0.6`, `blush 0.5` | `#F7B32B` 0.6 | — | **star ×5** (`reactions.ts:92`) | NOT OBSERVED |
| 5 | `battery-drained` | `setCondition` | `drained` (`engine.ts:139`) → eye `tired`, `pitch -0.12`, `sy 1.07`, `sx 0.95` | `#9AA0A8` 0.3 | — | — | NOT OBSERVED |
| 6 | `battery-charging` | `setCondition` | `perky` (`engine.ts:140`) → eye `wide`, `es 1.15`, `blush 0.4`, `tilt -0.06` | `#6BD9FF` 0.6 | — | — | NOT OBSERVED |
| 7 | `battery-full` | `setCondition` | `perky` | `#55D499` 0.5 | — | — | NOT OBSERVED |
| 8 | `dnd-sleep` | `setCondition` | `sleep` (`engine.ts:142`) → eye `closed`, `pitch -0.14`, breath loop (`engine.ts:691-696`) | `#6E80B8` 0.25 | — | — | NOT OBSERVED |
| 9 | `approval-wave` | `react` | `wave` (`engine.ts:143`) → eye `happy`, `hands 1`, wave loop (`engine.ts:710-713`) | `#F5A524` 0.7 | — | — | NOT OBSERVED |
| 10 | `session-done` | `react` | `flex` (`engine.ts:141`) → `hands 1`, `blush 0.7`, `tilt -0.1` | `#34D49A` 0.7 | — | **spark ×5** (`reactions.ts:93`) | NOT OBSERVED |
| 11 | `session-error` | `react` | `dizzy-red` (`engine.ts:144`) → eye `spiral` + roll (`engine.ts:351`, `707-709`) | `#F4505E` 0.8 | — | — | NOT OBSERVED |
| 12 | `session-ratelimit` | `react` | `drained` | `#FBA63C` 0.5 | — | **sweat ×1** (`reactions.ts:94`) | NOT OBSERVED |
| 13 | `media-playing` | `setCondition` | `headphones-idle` (`engine.ts:146`) → beat squash loop (`engine.ts:714-719`) | `#7C5CFF` 0.5 | **headphones** | — | NOT OBSERVED |
| 14 | `media-paused` | `setCondition` | `headphones-paused` (`engine.ts:147`) → eye `closed` | `#7C5CFF` 0.3 | **headphones** | — | NOT OBSERVED |
| 15 | `media-loud` | `react` | `pant` (`engine.ts:145`) → eye `tired`, `blush 0.6`, breath loop (`engine.ts:697-703`) | `#FF7AA2` 0.7 | — | — | NOT OBSERVED |
| 16 | `track-change` | `react` (colour) | `perky` | `#7C5CFF` 0.6 (bus colour from `backgroundColors()[0]`, `backgroundEffects.ts:111`) | — | — | NOT OBSERVED |
| 17 | `tickle` | `react` | `squirm` (`engine.ts:148`) → eye `closed`, `blush 1`, jitter `ox` (`engine.ts:704-706`) | none | — | — | NOT OBSERVED |
| 18 | `nuzzle` | `react` | `nuzzle` (`engine.ts:149`) → eye `happy`, `blush 0.8`, `tilt 0.14`, `pitch -0.06` | `#FF9FB0` 0.5 | — | **heart ×2** (`reactions.ts:95`) | NOT OBSERVED |

**Cross-check (static):** all 12 pose names referenced by `CATALOG` exist in `POSES`; all six
condition kinds in the harness are members of `CONDITION_KINDS` (`reactions.ts:53-56`) and are handled
by `resolve()` (five in `CONDITION_ORDER`, `media-paused` via the explicit branch at
`reactions.ts:107`). No kind is missing a mapping, no pose name is dangling, and `tickReactions` is
wired into the live loop — so there is **no bus-mapping / engine-pose / tick-not-running defect** to fix.

**Known unreachable-by-source (already recorded, not a defect):** `dnd-sleep` has no Windows DnD
source, so only the harness can drive it (bus no-ops in production) — ledger Task 5. `media-loud` has
no separate event; it is folded into the volume-apply ∩ media-playing intersection
(`views.ts:796`).

---

## Step 3 — Motion verification (NOT OBSERVED; mechanism evidence)

| Item | Evidence (code path) | Status |
|---|---|---|
| (a) Shell springs; mid-flight retarget reverses; radius leads width | Four per-property springs `shell.w/h/y/r` (`island.ts:62-67`); retarget via `set()` each `animateGeometry` (`island.ts:527-536`); integrated + written in the loop only while `shellMoving` (`island.ts:800-806`). Distinct tunings `SHELL_WIDTH/HEIGHT/Y/RADIUS` (`motion-tokens.ts`) ⇒ width lags height; `SHELL_RADIUS k=1000` is the stiffest ⇒ radius snaps first. | NOT OBSERVED |
| (b) Hide mid-animation → instant snap; process idle | Hide branch `set(target, true)` for all four (`island.ts:530-534`); hidden gate = `settling` only (`island.ts:856-857`) ⇒ springs sleep, loop stops (`island.ts:863-868`). | NOT OBSERVED |
| (c) Reduced motion → everything snaps | `prefersReduced()` in `animateGeometry` snap (`island.ts:530`); digits swap without spans (`views.ts:1108,1115-1117`); jitter/beat/roll gated (`engine.ts:351,698,705,708,715`); CSS block `style.css:2283`. | NOT OBSERVED |
| (d) Event-peek ≤ 4 s, cancelled by interaction | `peek(ms=4000)` (`island.ts:372-389`): defers via rAF while `shellMoving` (generation-guarded), else `fsm.reveal()` + `setTimeout(fsm.forceHidden, ms)`. Cancelled by `cancelPeek()` on mousedown (`island.ts:607`) and on cursor-enter (`island.ts:687`). Approval path calls `island.peek(4000)` (`hooks.ts:321`). | NOT OBSERVED |
| (e) Digits / marquee / exits | Digits: `rollDigits` (`views.ts:1098-1124`) → `.pom-roll`/`.pom-digit`/`roll-in`/`roll-out` (`style.css:1524-1568`, curve `cubic-bezier(0.22,1,0.36,1)`). Marquee: `ticker.ts:73-76` toggles `marquee-on` + `--mq-distance/--mq-duration`; CSS ping-pong `style.css:610-630`. Exits: `leaveView` adds `view-leaving` on the outgoing view, cleared on `animationend` (`island.ts:1009-1011,1060-1068`; CSS `style.css:323-338`). | NOT OBSERVED |
| Hover-grace 800 ms | `startGrace`/`cancelGrace` (`island.ts:747-761`); wired on cursor leave/enter and mousedown (`island.ts:598,606,686,690`). | NOT OBSERVED |

---

## Step 4 — Battery (NOT OBSERVED; mechanism + feature-detect)

`power.ts:20-49`: `startPowerWatch()` feature-detects `navigator.getBattery` and returns a no-op if
absent (`power.ts:21-23`); otherwise `getBattery().then` applies once then listens to `levelchange` /
`chargingchange`, driving `battery-drained` (`<20 && !charging`), `battery-charging`
(`charging && <100`), `battery-full` (`charging && ==100` or `==100`) and a one-shot
`react("battery-full")` on each false→true. Registered with the island lifecycle
(`island.ts:117`) and torn down on `pagehide` (`island.ts:118`).

**Feature-detect result:** NOT OBSERVED — no live WebView2 in this environment, so
`navigator.getBattery` availability was not exercised. Note: the plan's approved deviation is a **JS
Battery Status API** module, but the ledger records a controller **amendment** to instead reuse the
Rust-backed `State.battery` (bridge.ts / state.ts); that amendment's fix is **DEFERRED** to the final
review wave, so this report verifies the shipped `power.ts` as-is.

---

## Step 5 — Regression sweep (NOT OBSERVED for UI; static scope OBSERVED)

The UI-quality-pass eyeball checklist (CallChip on the ticker, SwipeRow on pomodoro rows, header
sliding-thumb segment, control-center sliders with knob/glow/readout) is **NOT OBSERVED** — no live
island. Static risk assessment: this plan touches `views.ts` only at the slider `apply` seams
(`views.ts:789-816`, adding `react(...)` calls) and pomodoro digit writes (`views.ts:1098-1124`); it
does **not** alter CallChip/SwipeRow/segment structure. `style.css` gained additive blocks only
(roll-digits, marquee, view-out). No existing geometry constant was changed. Shell geometry is now
spring-driven instead of the previous write path — the one behavioural change that could affect the
checklist, so the eyeball list below keeps the four widgets in scope.

---

## Defects

**No new defect was CONFIRMED in this pass.** No production code was modified. All items previously
recorded as DEFERRED minors in `.superpowers/sdd/2026-10-10-mochi-reactive-motion/progress.md` remain
deferred and untouched (per the brief, the final whole-branch review triages them):

1. `engine.busy` stays true under `prefersReduced` while a condition is held → visible loop draws a
   static frame (hidden CPU unaffected).
2. `island.ts` `leaveView` leaks its `animationend` listener when a view re-enters before exit ends.
3. `hooks.ts` `peek(4000)` early-returns because `alert()`/`reveal()` already raised the island.
4. Battery: `power.ts` still uses `navigator.getBattery`; the Rust-`State.battery` amendment fix is deferred.
5. `power.ts` stop-fn race if the watch is stopped before `getBattery` resolves.

## Consolidated "must-eyeball-when-running" list

Run the island (`npm run tauri dev`) with `?reactions=1`, then confirm:

1. **Harness — all 18 chips** fire the pose/aura/prop/particle in the table above (esp. particles:
   theme-sparkle stars, session-done sparks, session-ratelimit sweat, nuzzle hearts).
2. **Shell springs:** expand/collapse feels springy; mid-flight retarget reverses; radius snaps before
   width settles.
3. **Hide mid-animation:** snaps instantly; island idle; no sustained CPU (springs asleep).
4. **Reduced motion ON:** shell snaps, digits snap, aura/particles still show, jitter/beat freeze.
5. **Event-peek:** a hidden island force-reveals for ≤4 s; any click/hover cancels it; approval path
   peeks without cutting a pinned card.
6. **Digits/marquee/exits:** pomodoro digits roll (400 ms); a long ticker row ping-pongs with holds;
   view switches exit faster than they enter.
7. **Battery:** unplug → drained; plug → charging; reach 100 % → one-shot flex (`battery-full`).
8. **UI-quality pass not regressed:** CallChip fill, SwipeRow drawer, header segment thumb, slider
   knob/glow/readout all still behave.
9. **DnD:** confirm `dnd-sleep` is harness-only (no Windows source) as recorded.

## Fix commits

None — no confirmed defect.

---

## Addendum (post-review) — headless browser E2E

After the final whole-branch review and its fix wave, the island was run in a **real browser** to turn
some of the "NOT OBSERVED" items into actual observations.

**Setup:** `vite` dev server on `127.0.0.1:1420` (the Tauri shell is not needed for the DOM/canvas
path — `bridge.ts` degrades to `null` when `IS_TAURI` is false), driven by headless Chrome.

**Observed (real, not mechanism-level):**
- The island page boots in Chromium with **0 console errors and 0 exceptions**.
- With `?reactions=1` the harness self-installs **all 18 chips** (`brightness` … `nuzzle`).
- Clicking **all 18 chips** programmatically produced **0 errors / 0 exceptions**; 12 canvases live.
- Screenshot: island header (tabs + pills) renders; the 18-chip harness row renders at the bottom.

**Still NOT OBSERVED (needs the real Tauri window):** spring "feel", pose/aura/prop geometry,
particle shapes, digit rolls, marquee, view exits, battery transitions. The headless run proves the
code path *executes*; it cannot judge how it *looks*.

**Defect found and fixed here:** the parked boot glitch — a spurious `battery-full` on the first
sample, because `State.battery` defaults to 100 %. `power.ts` now fires the one-shot flex only on a
real false→true transition (`full` starts `null`). Build gate: exit=0, 0 `error TS`.
