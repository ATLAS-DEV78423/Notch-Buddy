# Notch-Buddy Windows UI & Motion Reliability — Detailed Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the highest-impact Windows/Linux island UI, interaction wiring, layout collisions, and motion reliability issues while preserving the existing Tauri + vanilla TypeScript architecture.

**Architecture:** Keep the existing DOM helper, global `State`, island frame loop, Canvas Pip engine, reaction queue, and token CSS. Move repeated interaction/layout rules into the smallest existing modules that already own them; do not introduce a framework. Use semantic native controls and CSS/Web Animations API behavior before considering a new dependency.

**Tech Stack:** Tauri 2, Rust, Vite, vanilla TypeScript, DOM/CSS, Canvas 2D, Node `node:test`/assert scripts, existing Rust tests.

**Spec:** `docs/superpowers/specs/2026-10-13-notch-buddy-ui-motion-reliability-design.md`

**Plan status:** This document is the detailed execution authority. The compact
task list below is expanded by the execution appendix at the end. The appendix
records the research, inspiration, ownership boundaries, exact acceptance gates,
and the evidence standard for the visual work.

## Global Constraints

- Only the `windows/` tree and project documentation may change.
- Keep the existing Tauri 2 + Vite + vanilla TypeScript stack.
- No secrets in source, logs, reports, or fixtures.
- No new npm or Cargo dependency by default.
- Keep the hidden island at effectively 0% application polling/render cost.
- Keep approval clicks explicit; never auto-approve or fake an OpenCode decision.
- Keep existing IDs and CSS selectors unless a narrowly-scoped compatibility fix is required.
- Preserve the four intentional uncommitted in-flight changes already present before this work.

## Review Focus

1. **Keyboard-only operation:** a user can reach and activate dashboard widgets,
   agent pills, icon actions, approval buttons, sliders, timer controls, and
   chat controls without a pointer. Test through semantic DOM behavior and the
   browser smoke flow.
2. **Long/untrusted labels:** long tool commands, paths, provider names, agent
   names, and malformed relay labels remain bounded and never overlap controls.
   Test with representative long strings and object-shaped relay fields.
3. **Rapid state changes:** switching views, retargeting shell geometry, and
   firing reactions during another reaction leaves no stale class, listener,
   option payload, or input blocker. Test repeated view/reaction sequences.
4. **Reduced motion:** the state change remains visible without animated
   movement, and the hidden loop still sleeps. Test the existing reduced-motion
   hooks and the browser media query path.
5. **Unavailable native services:** missing media, weather, Bluetooth, n8n,
   battery, or provider status shows a truthful empty/error state instead of a
   fake success or dead control. Test the existing bridge stubs and error paths.

---

### Task 1: Repair DOM semantics and interaction affordances

**Files:**
- Modify: `windows/src/views/dom.ts`
- Modify: `windows/src/views/views.ts`
- Modify: `windows/src/views/chat.ts`
- Modify: `windows/src/views/integrations.ts`
- Modify: `windows/src/style.css`
- Test: `windows/scripts/test-controls.mjs` (extend existing behavior checks)

**Interfaces:**
- Consumes: existing `h()`, `svg()`, `ViewActions`, `State`, and view builders.
- Produces: semantic controls with accessible names, focus states, and the same
  callbacks/IDs as before; no caller changes outside the view layer.

- [ ] **Step 1: Add the failing regression assertions**

  Extend the existing controls test harness with cases for:

  - dashboard navigation controls exposing button semantics and labels;
  - agent pills exposing keyboard activation without changing the stable task ID;
  - icon-only buttons exposing an accessible name;
  - the chat send control remaining keyboard-triggerable;
  - long labels remaining text content rather than object coercion.

  Run from `windows/`:

  ```bash
  node scripts/test-controls.mjs
  ```

  Expected: the new assertions fail against the current clickable `<div>` and
  missing-name implementation.

- [ ] **Step 2: Extend `h()` only as needed for safe DOM attributes**

  In `windows/src/views/dom.ts`, preserve current event and text behavior while
  allowing the existing helper to express boolean/ARIA attributes without an
  `innerHTML` path. Do not add a component abstraction or a second DOM factory.

- [ ] **Step 3: Convert clickable non-controls in `views.ts`**

  Replace dashboard widget and agent pill clickable containers with `<button>`
  elements while preserving their existing classes, task IDs, callbacks, and
  mini-canvas children. Add explicit labels where the visible text is not
  sufficient. Keep `title` as supplemental hover text, not as the only name.

- [ ] **Step 4: Name and focus icon actions**

  Add `aria-label`/focus-visible coverage to header actions, jump/open actions,
  media transport, mute, Bluetooth refresh/connect, task delete, banner actions,
  and chat send. Use the existing icon paths; do not add an icon dependency.

- [ ] **Step 5: Make the visible control states coherent**

  In `style.css`, add the smallest shared focus-visible and pointer cursor rules
  needed for the converted controls. Keep the existing dark palette and radius
  vocabulary. Do not restyle unrelated shipped cards.

- [ ] **Step 6: Run the focused test and frontend checks**

  ```bash
  node scripts/test-controls.mjs
  npx tsc --noEmit
  npx vite build
  ```

  Expected: all existing and new control assertions pass, with zero TypeScript
  errors and a successful Vite bundle.

- [ ] **Step 7: Commit**

  ```bash
  git add windows/src/views/dom.ts windows/src/views/views.ts windows/src/views/chat.ts windows/src/views/integrations.ts windows/src/style.css windows/scripts/test-controls.mjs
  git commit -m "fix(windows): restore semantic island interactions"
  ```

### Task 2: Fix verified dead and misleading action paths

**Files:**
- Modify: `windows/src/views/views.ts`
- Modify: `windows/src/core/state.ts`
- Modify: `windows/src/core/bridge.ts` only if an existing bridge status/result is required
- Modify: `windows/src/settings/main.ts` only if the same provider/status contract is shared
- Test: `windows/scripts/test-controls.mjs`

**Interfaces:**
- Consumes: existing `ViewActions`, `State`, and bridge result types.
- Produces: truthful error/provider/timer behavior without changing native
  command names or agent protocol.

- [ ] **Step 1: Add failing behavior checks**

  Add focused assertions for:

  - the error view not exposing an action that calls `openUrl("")`;
  - timer view synchronization not producing repeated state mutation/notify
    cycles once the mode already matches;
  - provider/API status not claiming a known failure when the state is unknown.

- [ ] **Step 2: Trace the real source of each value**

  Read the bridge command/result and settings schema before editing. If a native
  status is unavailable, render `Unavailable`/`Not configured` rather than
  inventing a green or red result. If an n8n target cannot be resolved from the
  existing task data, remove the dead button instead of creating a guessed URL.

- [ ] **Step 3: Move timer mode correction out of render-time mutation**

  Add the smallest equality guard or one-time mode transition needed so
  `buildPomodoroView().sync()` and `buildStopwatchView().sync()` do not mutate
  state on every notification. Preserve the current timer reset semantics.

- [ ] **Step 4: Make error/provider actions truthful**

  Update the error and settings surfaces to use only real existing destinations
  and known status values. Keep explicit user clicks for all external opens.

- [ ] **Step 5: Run targeted and neighboring checks**

  ```bash
  node scripts/test-controls.mjs
  npx tsc --noEmit
  npx vite build
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add windows/src/views/views.ts windows/src/core/state.ts windows/src/core/bridge.ts windows/src/settings/main.ts windows/scripts/test-controls.mjs
  git commit -m "fix(windows): remove dead and misleading UI actions"
  ```

### Task 3: Harden reaction and view-transition reliability

**Files:**
- Modify: `windows/src/mochi/reactions.ts`
- Modify: `windows/src/mochi/reaction-queue.ts` only if the regression requires queue behavior changes
- Modify: `windows/src/island/island.ts`
- Modify: `windows/src/core/anim.ts`
- Modify: `windows/src/style.css`
- Test: `windows/scripts/check-queue.mjs`
- Test: `windows/scripts/test-controls.mjs` if the behavior is shared with existing control fixtures

**Interfaces:**
- Consumes: `ReactionKind`, `createQueue`, `tickReactions`, `Island.leaveView`,
  `prefersReduced()`, and the existing single island frame loop.
- Produces: the same public reaction names and view contracts, with safe option
  lifecycle, interruptible transitions, and reduced-motion preservation.

- [ ] **Step 1: Add regression cases for the known failure modes**

  Extend `check-queue.mjs` or the existing control fixture to prove:

  - queued options are applied to the entry being played and cannot leak into a
    later reaction of the same kind;
  - repeated same-kind enqueueing follows the documented dedupe/refresh rule;
  - control reactions remain observable while an agent or media condition is active;
  - a rapid view re-entry does not leave duplicate `animationend` listeners or
    a stale leaving class.

- [ ] **Step 2: Fix option ownership at dequeue time**

  Keep the current queue API unless the failing case proves it insufficient. Make
  `pendingOpts` lifecycle explicit: the options consumed by `beginReaction()` are
  removed once consumed, without changing the public `react()` signature.

- [ ] **Step 3: Verify view-exit cleanup and animation interruption**

  Keep `leaveView()` as the single owner of the outgoing view listener. Ensure
  re-entry, reduced motion, and a missing `animationend` path cannot leave
  `view-leaving` or a blocking pointer state behind. Prefer an existing CSS/DOM
  mechanism over a new animation package.

- [ ] **Step 4: Replace the global reduced-motion kill switch**

  In the reduced-motion block, preserve state and selection feedback while
  disabling only decorative loops and movement. Use explicit property lists and
  instant-but-visible state transitions rather than making every animation
  `0.01ms` globally.

- [ ] **Step 5: Check hidden-loop behavior**

  Trace every condition that calls `ensureRunning()` and every source of a
  repeating timer. Do not add a new loop. If the timer interval is unrelated to
  hidden rendering, keep the functional timer behavior but prevent it from
  forcing visual work while the island is hidden.

- [ ] **Step 6: Run reaction and frontend checks**

  ```bash
  node scripts/check-queue.mjs
  node scripts/test-controls.mjs
  npx tsc --noEmit
  npx vite build
  ```

- [ ] **Step 7: Commit**

  ```bash
  git add windows/src/mochi/reactions.ts windows/src/mochi/reaction-queue.ts windows/src/island/island.ts windows/src/core/anim.ts windows/src/style.css windows/scripts/check-queue.mjs windows/scripts/test-controls.mjs
  git commit -m "fix(windows): make reactions and transitions reliable"
  ```

### Task 4: Consolidate Pip-safe layout and improve surface hierarchy

**Files:**
- Modify: `windows/src/core/layout.ts`
- Modify: `windows/src/views/views.ts` only for layout classes/attributes, not behavior already owned by Tasks 1–2
- Modify: `windows/src/style.css`
- Test: `windows/scripts/test-controls.mjs` for layout/state keys where practical

**Interfaces:**
- Consumes: `VIEW_LAYOUTS`, `botPosition`, existing view classes, and the solo
  session mode already present in the working tree.
- Produces: a shared Pip-safe content inset and consistent surface hierarchy
  without changing stable selectors or view names.

- [ ] **Step 1: Record representative collision fixtures**

  Add or extend deterministic fixtures for overview/session, approval, media,
  control center, dashboard, Bluetooth, timer, weather, upload, and long diff
  content. The fixture must assert bounded content, not pixel-perfect screenshots.

- [ ] **Step 2: Introduce one layout-owned safe inset**

  Add a named constant or existing-style layout value in `layout.ts` for the
  Pip-safe content start. Replace repeated magic inline paddings only where the
  same rule is already intended. Do not redesign every view’s copy or spacing.

- [ ] **Step 3: Repair hierarchy and overflow**

  Use the existing token vocabulary to make the live session primary, secondary
  pills subordinate, and dashboard widgets consistent with the rest of the
  island. Ensure long labels have `min-width: 0`, truncation, or wrapping where
  appropriate. Keep one card/radius/elevation language.

- [ ] **Step 4: Fix dashboard interaction styling**

  Make the converted widget controls visibly interactive with hover, active, and
  focus-visible states. Preserve the compact 720×320 geometry and do not add
  full-page dashboard scaffolding.

- [ ] **Step 5: Run UI checks**

  ```bash
  node scripts/test-controls.mjs
  npx tsc --noEmit
  npx vite build
  ```

  Then run the detector after all UI edits, not during concept selection:

  ```bash
  node C:\Users\Stanley\.agents\skills\impeccable\scripts\detect.mjs --json windows/src/core/layout.ts windows/src/views/views.ts windows/src/style.css
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add windows/src/core/layout.ts windows/src/views/views.ts windows/src/style.css windows/scripts/test-controls.mjs
  git commit -m "refactor(windows): unify island layout hierarchy"
  ```

### Task 5: Browser and live-surface verification

**Files:**
- Create: `windows/scripts/smoke-ui.mjs` only if the existing harness cannot
  express the repeatable browser checks without a new dependency
- Modify: project documentation only for actual findings and commands
- Test: built frontend, reaction harness, live Tauri window

**Interfaces:**
- Consumes: the completed implementation from Tasks 1–4 and the existing Vite
  browser fallback (`bridge.ts` degrades outside Tauri).
- Produces: observed evidence separating passed checks, unobserved visuals, and
  remaining platform-specific gaps.

- [ ] **Step 1: Start the browser fallback**

  From `windows/`, run the existing Vite dev server on `127.0.0.1:1420` and
  open the app with `?reactions=1`.

- [ ] **Step 2: Run the browser smoke path**

  Verify boot has no uncaught console errors; exercise group navigation,
  dashboard widget navigation, session/solo mode, approval display, chat focus,
  media controls, slider input, Bluetooth empty/error state, timer controls,
  upload cancellation, and every reaction harness chip.

- [ ] **Step 3: Run the Tauri live pass**

  Run `npm run tauri dev` with the documented Rust target workaround if needed.
  Check the nine-item live list from the existing E2E document, including shell
  feel, Pip geometry, queue playback, folder hold, settings, and reduced motion.

- [ ] **Step 4: Run final gates**

  ```bash
  npx tsc --noEmit
  npx vite build
  node scripts/check-queue.mjs
  node scripts/test-controls.mjs
  ```

  From `windows/src-tauri/`, run `cargo check` and `cargo test` with
  `CARGO_TARGET_DIR` outside the damaged default target when required.

- [ ] **Step 5: Record evidence and remaining gaps**

  Update the handoff or an existing project report only with actual observations.
  Mark any visual or native behavior not seen as `NOT OBSERVED`; do not turn
  static inspection into a live-pass claim.

## Self-review

- **Spec coverage:** interaction semantics are Task 1; dead/misleading wiring is
  Task 2; reaction/view motion is Task 3; layout hierarchy is Task 4; browser and
  live evidence is Task 5.
- **Conflict scan:** Tasks 1 and 2 both touch `views.ts`, so they are ordered,
  not parallel. Task 3 owns motion files; Task 4 owns layout styling after the
  semantic changes. Task 5 runs only after all implementation tasks.
- **Known cross-task interface:** Task 1 preserves callbacks and selectors;
  Task 2 consumes those semantic controls; Task 4 may adjust only their layout
  classes; Task 5 tests the combined surface.
- **Test coverage:** each task has a focused check plus the frontend build; the
  final task adds browser/live evidence because visible motion cannot be proven
  by unit tests.
- **Proportion:** the plan deliberately avoids a framework migration, new design
  system, or broad visual rewrite. Those are deferred because no evidence yet
  justifies their cost.

---

## Detailed execution appendix

### 1. Product target and design inspirations

The target is a compact desktop utility that a developer can understand in one
glance while an agent is working. It is not a miniature web dashboard and it is
not a showcase of unrelated animation techniques.

#### Primary product references

These references are used for specific behaviors, not for copying branding or
assets:

| Reference | Borrowed idea | Explicitly not copied |
|---|---|---|
| macOS Dynamic Island / Live Activities | A small surface expands around an urgent state, then returns to a quiet state. | Apple branding, proprietary assets, or a literal macOS clone. |
| Apple Now Playing | One clear primary control, readable transport order, album/context hierarchy. | Apple icons, exact typography, or a full media-player rewrite. |
| macOS Control Center | Related system controls grouped into a compact, scannable surface. | A full system-settings information architecture. |
| Windows 11 Quick Settings / Fluent 2 | Strong selected, hover, disabled, and focus states with familiar controls. | Fluent’s full component language or a generic Windows dashboard. |
| Raycast | Keyboard-first command density and direct action labels. | Command-palette scope beyond the current product. |
| Linear | Quiet hierarchy, short transitions, restrained surfaces, high information density. | SaaS project-management metaphors or a Linear visual clone. |
| VS Code / terminal output | Code, tool, path, and diff content should be legible and bounded. | Terminal chrome as decoration. |
| Pip itself | The character is the emotional status indicator; the UI must leave room for it. | Additional mascots, stickers, or competing decorative illustration. |

#### Chosen visual direction

- Dark neutral surfaces with one active accent and semantic status colors.
- A single clear primary state per surface.
- Small-radius utility controls; larger radius only for the island shell/cards.
- System sans for product text; monospace only for code, paths, commands, and
  measured values.
- No gradients as the primary hierarchy mechanism.
- No permanent shimmer, bounce, glow, or marquee unless it communicates a live
  state and stops when that state ends.
- Pip’s aura, pose, particles, and props carry emotional delight; DOM motion
  carries information and action feedback.

### 2. UI-library and motion-library research record

Tauri’s official frontend guidance says the shell is frontend-agnostic and
recommends Vite for plain JavaScript/TypeScript and SPA frameworks:

- <https://v2.tauri.app/start/frontend/>

The project already uses Vite + vanilla TypeScript, so adopting a library is an
incremental decision rather than a Tauri requirement.

#### Framework-free component candidates

| Candidate | Official evidence | Useful pieces | Cost/risk here | Decision |
|---|---|---|---|---|
| Web Awesome | <https://webawesome.com/> | Accessible Web Components, buttons, dialogs, switches, sliders, menus, themes, utilities, localization. | Adds a component theme and Lit/runtime surface to a highly bespoke 720×320 UI; generic defaults can fight Pip’s identity. | Do not add in the first repair. Reconsider only for a focused settings/dialog gap after measurement. |
| Fluent UI Web Components | <https://learn.microsoft.com/en-us/fluent-ui/web-components/> | Framework-free Web Components, Fluent tokens, accessible Windows-oriented controls. | Strong Windows vocabulary, but default Fluent density and shapes may clash with the existing island and macOS parity goal. | Keep as a reference and possible selective settings control, not a wholesale adoption. |
| Spectrum Web Components | <https://opensource.adobe.com/spectrum-web-components/> | Standards-based accessible controls and overlays, framework agnostic. | Adobe/Spectrum visual language is not the product language; broad adoption would make the island look like another product. | Do not use. |
| Material Web | <https://material-web.dev/> | Web Components for buttons, dialogs, sliders, tabs, switches, and menus. | Official site notes maintenance mode pending new maintainers. | Do not use. |
| UI5 Web Components | <https://ui5.github.io/webcomponents/> | Enterprise-ready Web Components, themes, density, accessibility. | SAP enterprise vocabulary is unrelated to a playful developer companion. | Do not use. |
| Shoelace | <https://shoelace.style/> | Mature framework-free components. | Official site says Shoelace is sunset and points ongoing work to Web Awesome. | Do not use; Web Awesome is the successor if needed. |

#### Framework-bound candidates

| Candidate | Official evidence | Why it is not the first move |
|---|---|---|
| Radix Primitives | <https://www.radix-ui.com/primitives/docs/overview/introduction> | React component primitives; adopting them means introducing React and a new rendering model. |
| Base UI | <https://base-ui.com/> | Official documentation states it is a React library; not usable directly in this vanilla tree. |
| shadcn/ui | <https://ui.shadcn.com/> | Source-owned React components are useful in a new React surface, but migrating this app would be a separate project. |
| Motion React | <https://motion.dev/> | The React API is not applicable without a framework migration. Motion also has JavaScript APIs, which remain a later option. |

#### Focused motion and positioning candidates

| Candidate | Official evidence | Use case | Decision |
|---|---|---|---|
| Web Animations API | <https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API> | Directly controlled, cancellable DOM transitions and small choreography. | First choice for a gap that CSS cannot express. No dependency. |
| Motion JavaScript | <https://motion.dev/> | Spring/layout/gesture utilities for vanilla JavaScript. | Evaluate only if repeated DOM spring logic becomes larger than a small native implementation. |
| GSAP | <https://gsap.com/> | Complex timelines, SVG choreography, scroll-linked sequences. | Too broad for the island’s current needs; no scroll-storytelling requirement. |
| Floating UI | <https://floating-ui.com/> | Collision-safe popovers, tooltips, dropdowns, and anchored overlays. | Add only when a real floating surface is requested; current views do not justify it. |

#### Library selection gate

No package may be added merely because it has attractive examples. A package is
eligible only when all of the following are true:

1. The existing platform and DOM primitives cannot solve the requirement
   without a larger local abstraction.
2. The behavior is needed by a named acceptance criterion.
3. The package works with the current Tauri webview targets and CSP.
4. The package can be tree-shaken or imported narrowly.
5. Its accessibility and reduced-motion behavior are better than the current
   implementation, not merely different.
6. A focused bundle/performance check shows an acceptable cost.
7. The package does not force React or a second component vocabulary.

### 3. Architecture ownership map

The execution must keep ownership obvious. Do not make a view file responsible
for the frame loop or make the Canvas engine decide DOM layout.

| Concern | Owning file/module | Allowed changes |
|---|---|---|
| Global state and notifications | `windows/src/core/state.ts` | Guards, truthful state, mutation timing, and pure helpers. No new store. |
| Tauri/native boundary | `windows/src/core/bridge.ts` | Result/status shaping only when an existing command already provides it. No secrets to the frontend. |
| View dimensions and Pip placement | `windows/src/core/layout.ts` | Shared safe-inset constants and collision fixtures. Keep view names and stable geometry contracts. |
| Easing and reduced motion | `windows/src/core/anim.ts`, `spring.ts`, `motion-tokens.ts` | Small corrections and tests. Do not replace springs with a new engine. |
| Shell, FSM, input, shared frame loop | `windows/src/island/island.ts`, `fsm.ts` | Cleanup, wake/sleep, transition ownership, pointer/keyboard boundary fixes. |
| Relay event normalization | `windows/src/island/hooks.ts` | Trust-boundary validation only. Never fabricate agent facts. |
| Reactions and queue | `windows/src/mochi/reactions.ts`, `reaction-queue.ts` | Queue lifecycle, side-effect timing, reaction priority. Emotes/conditions remain last-writer-wins. |
| Pip rendering | `windows/src/mochi/engine.ts`, `properties.ts` | Only changes directly required by verified visual collisions or props. |
| DOM views | `windows/src/views/views.ts`, `chat.ts`, `upload.ts`, `integrations.ts` | Semantics, state rendering, actions, labels, and view-local behavior. |
| DOM primitives | `windows/src/views/dom.ts` | Safe text/attribute creation and small semantic helpers only. |
| Visual language | `windows/src/style.css`, `tokens.css`, settings CSS | Tokens, layout, states, and motion. Avoid global restyles that are not tied to a finding. |
| Settings window | `windows/src/settings/main.ts` | Provider/status controls only when the state contract is known. |

### 4. Execution phases

The work proceeds in bounded phases. Each phase has an entry condition, owned
files, a verification gate, and an exit condition. Do not mix phases to hide a
failing gate.

#### Phase 0 — Recovery and baseline

**Purpose:** establish exactly which checkout and revision are being changed.

1. Read `CLAUDE.md`, the approved spec, this plan, and `HANDOFF.md`.
2. Confirm the repository root, branch, linked worktree state, and uncommitted
   files with the safe-directory Git command.
3. Preserve the four pre-existing changes in `hooks.ts`, `island.ts`, `style.css`,
   and `views.ts`; do not overwrite them while creating a worktree.
4. Install only from the lockfile with `npm ci` if `windows/node_modules` is
   absent. Do not run a package-upgrade command.
5. Run the baseline frontend, queue, and controls checks.
6. Record any Rust target-directory failure separately from frontend failures.

**Exit evidence:** the handoff names the exact revision, baseline results, and
the checkout in which implementation will actually occur.

#### Phase 1 — Contract and semantics

**Purpose:** make the UI correctly operable before changing its visual rhythm.

Owned surfaces:

- `dom.ts` safe text/attribute handling;
- dashboard widgets and agent pills;
- header, media, mute, settings, Bluetooth, task, banner, integration, and chat
  control names;
- focus-visible states and native button reset rules;
- keyboard semantics for sliders and media seeking;
- tests that exercise runtime behavior where the existing harness allows it.

**Exit evidence:** no known pointer-only essential action remains, and all
controls have truthful names/state labels.

#### Phase 2 — Logic and truthfulness

**Purpose:** remove dead, misleading, and render-time mutation paths.

Owned checks:

- no `openUrl("")` or equivalent empty external action;
- no static red/green provider status where the state is unknown;
- timer mode changes occur at explicit state boundaries, not repeatedly in
  `sync()`;
- native failures have an inline recovery message or a truthful unavailable
  state;
- dynamic agent/relay labels remain bounded and text-safe.

**Exit evidence:** every action on the reviewed surfaces has an observable
success, unavailable, loading, or error result.

#### Phase 3 — Motion reliability

**Purpose:** make existing motion communicate state and survive interruption.

Owned checks:

- reaction options are consumed and cleared at the correct lifecycle point;
- queue priority/FIFO/dedupe/cap/TTL rules remain unchanged unless a failing
  test proves the contract wrong;
- view exit listeners cannot stack or leave stale classes;
- reduced motion preserves state feedback while removing decorative movement;
- hidden mode does not remain visually busy because of a decorative condition;
- DOM transitions animate compositor-friendly properties where possible.

**Exit evidence:** queue tests and reduced-motion tests pass, and a browser
reaction harness run has no uncaught errors.

#### Phase 4 — Layout and hierarchy

**Purpose:** make every view readable around Pip and make the primary state win.

Owned surfaces:

- overview/session solo mode;
- approval and question states;
- dashboard widgets;
- media, control center, Bluetooth, stats, timers, weather;
- upload/drop/choose flow;
- long diff/command/path labels;
- shared Pip-safe inset and overflow rules.

**Exit evidence:** deterministic fixtures cover every `VIEW_LAYOUTS` entry, and
the browser render shows no known collision at short and long content lengths.

#### Phase 5 — Browser and live visual verification

**Purpose:** separate what code proves from what a person must see.

Browser checks:

- Vite fallback at `127.0.0.1:1420`;
- boot with no uncaught console errors;
- group navigation and all dashboard widget routes;
- solo session enter/exit;
- approval and OpenCode display-only states;
- chat focus/send and file cancellation;
- media controls and slider input;
- Bluetooth empty/loading/error/success states;
- timer controls and digit transitions;
- every reaction harness chip.

Live Tauri checks:

- shell open/close feel and compact wake strip;
- Pip placement in every view;
- approval click routing and explicit decision behavior;
- session rail/diff/command/target rendering;
- queue reactions back-to-back;
- folder hold after file swallow and clear on consume/cancel;
- settings provider switch and status truthfulness;
- reduced-motion rendering;
- hidden CPU/render sleep behavior.

**Exit evidence:** a dated report marks each item `OBSERVED`, `PASS`, `FAIL`,
or `NOT OBSERVED` with a reason and next check.

#### Phase 6 — Release hygiene and handoff

1. Run the final gates from the real working folders.
2. Run the Impeccable detector once over changed UI files.
3. Review `git diff`, `git status`, and the complete commit list included in the
   change.
4. Update the handoff with actual results and unresolved issues.
5. Do not bump the product version unless the user explicitly asks to ship a
   release; if shipping, update all four version files, changelog, README, and
   installer outputs together.

### 5. Work packages and exact implementation details

#### Package A — Semantic DOM contract

Files: `dom.ts`, `views.ts`, `chat.ts`, `integrations.ts`, `style.css`.

Required changes:

1. Keep `h()` text content based. Never use `innerHTML` for relay/provider/task
   content. Unknown runtime text is normalized before it reaches the DOM.
2. Use native `<button type="button">` for dashboard widgets and agent pills.
3. Give every icon-only control an `aria-label` that updates when its state
   changes. Examples: `Play`/`Pause`, `Mute`/`Unmute`, `Settings`, `Open`,
   `Details`, `Back`, `Delete task`.
4. Use `aria-pressed` for toggles that expose a binary state. Use `role="switch"`
   and `aria-checked` only when the control’s interaction truly follows switch
   semantics.
5. Use `aria-live="polite"` only for status changes that a user needs to hear;
   do not make the entire island a live region.
6. Preserve visible text, stable task IDs, and callbacks.
7. Add focus-visible outlines that are legible on dark cards and do not change
   layout dimensions.

#### Package B — Keyboard range and seeking contract

Files: `views.ts`, `style.css`, `test-controls.mjs`.

The volume slider, brightness slider, and media scrubber are stateful controls.
They must support:

- `Tab` focus;
- `ArrowLeft`/`ArrowDown` decrement;
- `ArrowRight`/`ArrowUp` increment;
- `Home` sets the minimum;
- `End` sets the maximum;
- visible current value;
- `aria-valuemin`, `aria-valuemax`, and `aria-valuenow` if implemented as ARIA
  sliders, or native range semantics if a native input can preserve the design;
- pointer dragging using the existing bridge calls;
- no duplicate bridge commit caused by pointerup plus keyboard events;
- reduced-motion behavior that changes value instantly without removing focus.

The smallest acceptable implementation is the one that reuses the current
`apply()`, `commit()`, `Bridge.setVolume()`, `Bridge.setBrightness()`, and
`Bridge.mediaSeek()` paths instead of adding a new slider abstraction.

#### Package C — Truthful state and error paths

Files: `views.ts`, `state.ts`, `bridge.ts`, `settings/main.ts` only where the
existing contract requires it.

Audit each action with this table:

| Action | Success evidence | Loading evidence | Failure evidence | Empty/unavailable evidence |
|---|---|---|---|---|
| Open agent/n8n target | Native opener called with known target | Optional short pressed state | Inline error/banner if opener returns failure | Hide or label unavailable when target is absent |
| Provider/API status | Known key/config state | Checking only while a real check runs | Explicit failure with recovery | `Not configured` or `Unknown`, never an invented red/green state |
| Timer mode | Mode and remaining value update once | No repeated render mutation | No broken reset/stop behavior | Correct empty task list state |
| Bluetooth connect | Row changes through native event/state | `Connecting…`/`Disconnecting…` | Inline row error | `No paired devices` |
| Media | Track/art/playing state updates | No media loading spinner without a pending operation | Player error or empty state | `No media playing` |
| Weather | Temperature/condition/details | `Loading…` while request is pending | `Weather unavailable` | Same unavailable state with no fake values |
| Upload | Progress and choose state | Progress bar and Pip choreography | Error note with recovery | Cancel restores default view and clears file state |

#### Package D — Reaction and transition lifecycle

Files: `reactions.ts`, `reaction-queue.ts`, `island.ts`, `anim.ts`, `style.css`.

For every transient reaction, verify this lifecycle:

1. `react(kind, opts)` validates the known kind through TypeScript’s union and
   enqueues it without immediately emitting particles.
2. Queue dequeue selects priority and FIFO according to the existing contract.
3. `beginReaction()` consumes exactly the options belonging to that dequeue.
4. Engine side effects happen once at play start.
5. The deadline ends the transient without clearing persistent conditions.
6. A new higher-priority reaction can be visible without corrupting the queue.
7. Repeated same-kind input does not leave stale options for a later play.
8. Reduced motion keeps the pose/aura/state result but removes unnecessary
   travel, blur, shimmer, and infinite loops.

For view transitions, verify:

- outgoing view gets exactly one exit listener;
- re-entry cancels or replaces the old listener;
- no child animation can prematurely finish the view exit;
- missing animation events have a bounded fallback;
- hidden views do not receive pointer events;
- transition retargeting does not flash a blank frame.

#### Package E — Pip-safe layout matrix

Use `VIEW_LAYOUTS` as the authoritative list. For each entry capture:

- view name and group;
- shell width/height;
- Pip center and diameter;
- safe content start;
- interactive controls;
- maximum expected text lengths;
- known dynamic children;
- collision result.

The matrix must include:

`overview`, `empty`, `approval`, `question`, `error`, `finished`, `confused`,
`upload`, `uploading`, `choose`, `mail`, `prompt`, `searching`, `result`, `note`,
`settings`, `greeting`, `dashboard`, `media`, `controlCenter`, `bluetooth`,
`stats`, `pomodoro`, `stopwatch`, and `weather`.

The layout pass may centralize an inset or add a class, but it may not silently
change a view’s product meaning, approval semantics, or stable selector.

### 6. Motion inventory and expected behavior

The following inventory is the verification contract for the existing action
set. The task is not to add an animation to every row; it is to prove that each
action has a deliberate response or an explicit reason to stay still.

| # | Action | Existing response | Verification target |
|---:|---|---|---|
| 1 | Volume slider | Volume reaction, note particle, level bob | Value changes immediately, note/bob are short and do not stack forever. |
| 2 | Mute toggle | Mute flash and mute pose | Icon, label, Pip pose, and native mute state agree. |
| 3 | Brightness slider | Brightness aura and high-value squint | Keyboard and pointer changes share one response path. |
| 4 | Night Light on | Warm aura and squint-happy pose | Toggle response arrives only after native command confirms the change. |
| 5 | Night Light off | Cool aura and perky pose | Off-state feedback is distinct but restrained. |
| 6 | DND on | Sleep condition and z particles | Persistent condition wins according to documented resolver priority. |
| 7 | DND off | Wake reaction and blink | Wake is visible in reduced motion as a state change. |
| 8 | Memory boost start | Perky/freeing response | Button disables during the real native operation and shows progress state. |
| 9 | Memory boost done | Squint, squash, sparks | Completion reaction cannot appear on a failed native result. |
| 10 | Battery charging | Charging condition | Condition starts only from a confirmed charging transition. |
| 11 | Battery full | Flex and spark | Boot sample does not fake a full transition. |
| 12 | Battery drained | Drained pose | Threshold transitions do not chatter at the boundary. |
| 13 | Battery exhausted | Exhausted pose | Exhausted state outranks lower battery conditions. |
| 14 | Agent finished | Happy/squint and hearts | Finish reaction belongs to the correct agent pill. |
| 15 | Agent error | Red dizzy/wobble | Error remains legible without relying on motion alone. |
| 16 | Agent rate limit | Drained, sweat, steam | Steam/sweat are rate-limited and stop when the reaction ends. |
| 17 | Approval request | Approval wave | Approval card and Pip response are aligned; click remains explicit. |
| 18 | Media playing | Headphones and beat aura | Headphones condition follows media state, not a stale track. |
| 19 | Media paused | Paused headphones | Paused response remains distinct and quiet. |
| 20 | Track change | Perky/track change response | Track/art text and Pip response change once per track key. |
| 21 | Loud media | Pant pose | Volume intersection does not overwrite higher-priority agent/control state. |
| 22 | Theme/accent change | Sparkle/stars | One response per confirmed accent change, no infinite sparkle. |
| 23 | Hover Pip | Delayed love emote | Hover grace and cooldown avoid accidental repeated sounds. |
| 24 | Click/slap Pip | Slap; triple-click dizzy | Pointer release paths cannot trigger a stale hold or double reaction. |
| 25 | Fast Pip tap | Tickle/squirm | Short press uses the same hit test as slap without stealing buttons. |
| 26 | Long Pip press | Nuzzle/hearts | Hold threshold is stable and canceled by movement/leave. |
| 27 | Timer focus/break | Thinking/happy state | Timer state and Pip state remain consistent after reset/mode switch. |
| 28 | Bluetooth connect | Surprised emote | Emote fires only on confirmed device event, not command start. |
| 29 | Clipboard URL | Banner | Banner has keyboard actions, pause/resume, and truthful open behavior. |
| 30 | Weather update | Banner/data update | Unavailable and loading are distinct from success. |
| 31 | Stats tick | Display update | Frequent ticks do not replay entry animations or wake hidden decoration. |
| 32 | Charger connect/disconnect | Banner | Banner describes the event and does not invent a battery transition. |
| 33 | Media next/previous | Track-change when track changes | Native command and later media event stay separate. |
| 34 | Bluetooth disconnect | No dedicated reaction | Keep still if the row and state update are clear; do not add noise by default. |
| 35 | Tray/screen changed | No dedicated reaction | Keep still; verify repositioning and no stale hit rectangle. |

#### Motion acceptance language

- “Smooth” means no visible jump, flash, stuck state, or input loss during a
  retarget—not simply a longer duration.
- “High quality” means the animation has a state purpose, an end condition, a
  reduced-motion variant, and an observable failure behavior.
- “Delight” belongs to Pip’s expressive pose/particle language; it should not
  make approval, error, or command text harder to read.

### 7. Surface-by-surface acceptance matrix

| Surface | Primary job | Must be true before completion |
|---|---|---|
| Compact island | Signal that something is active | Wakes reliably, shows compact status, does not intercept input when hidden, sleeps when settled. |
| Overview idle | Choose an agent or surface | Pills are keyboard controls, empty state teaches the next action, Pip does not cover copy. |
| Overview live session | Follow an agent | Solo mode gives the session room, step rail is selectable, viewer is bounded, model/thinking are report-only. |
| Approval | Make one explicit decision | Real agents get Allow/Deny, OpenCode gets truthful display-only copy, command text truncates safely, decision routes to `taskId`. |
| Question | Direct the user to the real answer path | Copy clearly says where to answer; no fake answer buttons. |
| Error | Explain and recover | No dead external action, error detail is bounded, recovery is explicit. |
| Finished | Close or inspect result | Finish state is distinguishable from idle and returns cleanly to the default view. |
| Chat | Send a prompt with optional context | Input focus, send keyboard path, empty-submit behavior, loading/error status, and file context remain stable. |
| Dashboard | Navigate to utilities | Six widgets are real buttons, hover/focus/active states work, empty data is truthful. |
| Media | Control a real media session | Play/mute labels track state, scrubber supports pointer and keyboard, missing art/media is safe. |
| Control center | Change volume/brightness/system modes | Sliders support keyboard and pointer, native results gate reactions, failures are visible. |
| Bluetooth | Inspect and connect devices | Loading/pending/error states do not replay rows, no emoji-only semantics, row buttons are named. |
| Stats | Read live resource values | Values use tabular numerals, bars remain bounded, ticks do not replay entrance motion. |
| Pomodoro/stopwatch | Run a timer | Mode changes are explicit, digits update without re-mounting input/list state, task delete is named. |
| Weather | Read current weather | Loading, unavailable, and success states are distinct; values are not fabricated. |
| Upload/drop | Safely ingest context | Drag, swallow, progress, cancel, choose, and failure all clear temporary state correctly. |
| Settings window | Configure providers and behavior | Provider selection, key state, and model state are truthful; no secrets reach the frontend. |

### 8. Failure taxonomy and triage rules

Every discovered issue is classified before editing:

- **P0 blocking:** the user cannot complete the primary task, an approval can
  be sent incorrectly, a security boundary is crossed, or the app crashes.
- **P1 major:** a primary surface is misleading, inaccessible, permanently
  stuck, visibly overlapping, or a real native action is silently dropped.
- **P2 minor:** a recoverable annoyance, stale decoration, inconsistent label,
  or missing secondary-state polish.
- **P3 polish:** aesthetic improvement without behavior or comprehension impact.

Rules:

1. P0/P1 enters the current task and requires a regression check.
2. P2 enters the plan only when the same file is already being changed and the
   fix is low-risk; otherwise it goes to the handoff ledger.
3. P3 is not bundled into a correctness task unless a live visual pass proves
   it materially harms hierarchy.
4. A suspected issue is not called a bug until a reproduction or source-level
   root cause is recorded.
5. Three failed fix attempts on the same root cause trigger an architecture
   review instead of a fourth patch.

### 9. Verification matrix

#### Static and unit-level gates

Run from `windows/`:

```powershell
npx tsc --noEmit
npx vite build
node scripts/check-queue.mjs
node scripts/test-controls.mjs
node --experimental-strip-types src/core/spring.test.mjs
node --experimental-strip-types src/core/anim.test.mjs
```

Run from `windows/src-tauri/` with the documented alternate target when the
default target is locked:

```powershell
$env:CARGO_TARGET_DIR='C:\Users\Stanley\AppData\Local\Temp\opencode\coucou-target'
cargo check
cargo test
```

Record TypeScript, Vite, Node tests, Cargo check, and Cargo tests separately.
A command that was not run is `NOT RUN`, not pass.

#### Mechanical UI quality gate

After all UI edits, not after every speculative change:

```powershell
node C:\Users\Stanley\.agents\skills\impeccable\scripts\detect.mjs --json windows/src/core/layout.ts windows/src/views/views.ts windows/src/views/dom.ts windows/src/views/chat.ts windows/src/views/integrations.ts windows/src/style.css
```

Each detector warning is verified in context. Pre-existing warnings are listed
as pre-existing; new warnings require a fix or a ledger ruling.

#### Browser fallback gate

1. Start `npm run dev -- --host 127.0.0.1` from `windows/`.
2. Open `http://127.0.0.1:1420/?reactions=1`.
3. Capture the console and screenshot evidence.
4. Confirm no uncaught boot error.
5. Click every reaction harness control once, then run a burst sequence of
   control → session → media → battery reactions.
6. Exercise keyboard-only navigation using Tab, Enter, Space, arrows, Home,
   and End on each relevant control.
7. Check a long command, a long path, a long agent name, an empty service state,
   a loading state, and a failed native result.

If no browser automation tool is available, record repeatable manual steps and
mark visual results `NOT OBSERVED` until a live display pass is possible.

#### Live Tauri gate

Run `npm run tauri dev` from `windows/` using `CARGO_TARGET_DIR` outside the
damaged target if the prebuild hook needs it. Check:

1. hidden → compact → expanded shell feel;
2. hover grace and event peek;
3. overview idle and live solo mode;
4. approval and OpenCode display-only state;
5. session rail, diff, command, and target content;
6. every header group and dashboard route;
7. media player and scrubber;
8. control center sliders/toggles/memory boost;
9. Bluetooth loading/pending/error/success;
10. timer digit motion and task interactions;
11. file drop swallow/progress/folder hold/choose/cancel;
12. reduced motion;
13. hidden loop behavior and no stale click-through rectangle.

### 10. Subagent-driven execution protocol

Each task follows this exact loop:

1. Record the current commit and task scope in the SDD ledger.
2. Give the implementer only the task brief, relevant constraints, and report
   path. The implementer does not spawn subagents.
3. Require a failing regression check before the fix when the behavior can be
   expressed as a test.
4. Require the implementer to run the smallest focused check plus the related
   frontend/build check.
5. Generate a complete diff review package containing commit range, stat, and
   full diff.
6. Dispatch an independent task reviewer for spec compliance and code quality.
7. Fix all Important/Critical findings before starting the next task.
8. Minor findings are recorded with a one-line defer/ruling, never silently
   discarded.
9. Maximum five fix rounds per task. Rounds four and five require fresh eyes and
   a more capable implementer. At the cap, adjudicate and ledger the finding.
10. Mark the task complete only after the reviewer is clean or every residual
    finding has an explicit ledger ruling.
11. After all tasks, dispatch one whole-branch review across the complete commit
    range, then run the final verification matrix.

#### Worktree caveat for this Windows session

The available task runner may execute child work in the original checkout even
when the controller is using a linked worktree. The controller must check
`git branch --show-current`, `git status --short`, and `git log --oneline -3`
inside every child result before accepting a commit. If a child committed in the
wrong checkout:

- do not duplicate its implementation manually;
- preserve the commit hash and report;
- record the mismatch in the ledger;
- integrate the exact commit into the intended branch with a reviewed operation;
- re-run the task review against the integrated commit.

### 11. Commit and integration strategy

Recommended logical commits:

1. `docs(windows): define ui motion reliability execution plan` — plan/spec only.
2. `fix(windows): restore semantic island interactions` — native controls,
   accessible names, focus, safe text, and regression checks.
3. `fix(windows): remove dead and misleading UI actions` — no-op/status/timer
   corrections.
4. `fix(windows): make reactions and transitions reliable` — queue lifecycle,
   view-exit cleanup, reduced motion, and hidden-loop corrections.
5. `refactor(windows): unify island layout hierarchy` — safe inset, overflow,
   hierarchy, and layout fixtures.
6. `test(windows): record browser and live ui verification` — only if the repo
   gains a durable test/report artifact; otherwise keep evidence in the handoff.

Do not combine release version bumps with this repair plan. Do not include
`HANDOFF.md`, `windows/target*`, installers, secrets, or generated local caches
in a product commit.

### 12. Definition of done

This plan is complete only when all of the following are true:

- The approved spec acceptance criteria are mapped to a task and have evidence.
- No P0/P1 finding remains without a fix or a written blocker/ruling.
- Native controls are keyboard reachable and have truthful accessible state.
- No known no-op action remains on the reviewed surfaces.
- Long/untrusted content is bounded and cannot render as accidental object text.
- Reactions and view transitions have tested lifecycle ownership.
- Reduced motion preserves meaning and hidden mode sleeps.
- All available frontend/Node/Rust gates have been run and reported separately.
- Impeccable findings were verified after the final UI edits.
- Browser and Tauri visual results distinguish observed behavior from static
  inference.
- The handoff names the exact next action if any platform or display gap remains.
