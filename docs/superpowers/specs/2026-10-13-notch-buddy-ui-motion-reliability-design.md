# Notch-Buddy Windows UI & Motion Reliability — Design Specification

**Date:** 2026-10-13
**Status:** Approved by the product owner
**Scope:** `windows/` only

## Intent

Make the Windows/Linux Tauri island feel deliberate, responsive, and trustworthy.
The repair must improve the things a person can see and feel: clear state
hierarchy, reliable feedback, predictable layouts, complete interaction wiring,
and motion that communicates rather than decorates.

The project is an operate-mode desktop companion, not a generic web dashboard.
Pip's Canvas renderer, agent-session protocol, stable pill IDs, and existing
dark island identity remain the product foundation.

## Design read

This is an operate-mode desktop companion for coding-agent sessions, with an
Apple-adjacent dark island language, restrained hierarchy, and motion intensity
around 5 rather than animation everywhere.

### Dials

- **Design variance:** 4 — familiar product layout with small asymmetric details.
- **Motion intensity:** 5 — springy shell and authored reactions, short DOM transitions.
- **Visual density:** 6 — compact desktop utility that must scan quickly.

## Problem statement

The codebase contains a substantial UI and motion system, including 26 custom
reactions and 9 generic action responses, but the implementation does not yet
deliver a consistently finished experience. Some controls are not semantically
interactive, some actions are visibly or logically incomplete, and several
effects compete with layout/state updates or are disabled too aggressively.

The current architecture is not itself the problem. A React migration or a
large component-library adoption would add cost and new failure modes without
proving that it solves the observed issues.

## Goals

1. Make the current primary task/session unmistakable.
2. Ensure every visible interactive control has a real, complete interaction
   path: pointer, keyboard where applicable, focus, active, disabled, loading,
   and error states.
3. Remove verified no-op or misleading actions.
4. Make view transitions, reactions, and feedback interruptible and state-driven.
5. Preserve useful reduced-motion feedback while respecting the OS preference.
6. Reduce avoidable work while hidden and avoid introducing new frame loops.
7. Centralize the layout rules that prevent Pip/content collisions.
8. Stress-test the resulting behavior with repeatable unit, browser, and live
   Tauri checks.

## Non-goals

- No React, Vue, Svelte, or Electron migration.
- No replacement of Pip's Canvas renderer or shell spring implementation.
- No changes to the macOS Swift tree during this work.
- No renaming of pill IDs, agent IDs, bundle identifiers, or hook protocols.
- No change to the approved OpenCode display-only permission semantics.
- No new animation library unless a measured gap cannot be solved with the
  existing spring system, CSS, or the Web Animations API.
- No wholesale restyle of shipped cards or integrations merely for novelty.
- No claim that unobserved live visual behavior is fixed based only on static code.

## Constraints

- Only the `windows/` tree and project documentation may change.
- Keep the existing Tauri 2 + Vite + vanilla TypeScript stack.
- No secrets in source, logs, reports, or fixtures.
- No new npm or Cargo dependency by default.
- Keep the hidden island at effectively 0% application polling/render cost.
- Keep approval clicks explicit; never auto-approve or fake an OpenCode decision.
- Keep existing IDs and CSS selectors unless a narrowly-scoped compatibility fix
  is required.
- Preserve the four intentional uncommitted in-flight changes already present
  before this work.

## Current evidence

The current code-level inventory and baseline are:

- `windows/src/island/island.ts` owns shell geometry, input, the shared frame
  loop, view syncing, Pip placement, upload choreography, and Tauri hit testing.
- `windows/src/views/views.ts` owns the header, overview/session, dashboard,
  media, control center, Bluetooth, stats, timer, weather, and banners.
- `windows/src/mochi/engine.ts` owns Canvas rendering and Pip animation state.
- `windows/src/mochi/reactions.ts` owns transient reactions, conditions,
  priority resolution, and queue consumption.
- `windows/src/core/state.ts` owns state mutation and notifications.
- `windows/src/style.css` owns the island visual system and most DOM motion.
- `windows/src/core/layout.ts` contains per-view geometry and Pip positions.

Checks observed before editing:

- `npx tsc --noEmit` from `windows/`: pass.
- `npx vite build` from `windows/`: pass.
- `node scripts/check-queue.mjs`: pass.
- `node scripts/test-controls.mjs`: 14/14 pass.
- `npm run build`: blocked by the documented locked/corrupt Rust target
  directory during the `prebuild` hook, not by a TypeScript error.
- No live Tauri visual pass has been performed in this work yet.

## Library decision

Tauri is frontend-agnostic and officially supports plain Vite/TypeScript.

### Evaluated options

- **Web Awesome:** strongest framework-free component candidate. It is the
  successor to Shoelace and offers accessible Web Components, themes, and
  utilities. It is not needed for the first repair because the island already
  has a bespoke visual language and the urgent problems are wiring and motion.
- **Fluent UI Web Components:** technically suitable and Windows-friendly, but
  its Microsoft product vocabulary would need careful selective adoption.
- **Spectrum Web Components:** standards-based and accessible, but its Adobe
  visual language is not a fit for Pip.
- **Material Web:** currently in maintenance mode; not selected.
- **Radix, Base UI, and shadcn:** React-oriented; not selected without an
  approved framework migration.
- **Motion:** useful for DOM layout/gesture animation, but the existing app
  already has a shared animation clock and Canvas engine.
- **GSAP:** capable but broader than this overlay needs.
- **Floating UI:** a focused future option for collision-safe popovers only.

### Selected implementation approach

Use semantic native HTML, the existing token CSS, the existing spring/frame
loop, and the Web Animations API or explicit CSS transitions for short DOM
feedback where they are simpler. Re-evaluate a focused Web Component or motion
dependency only after a measured implementation gap remains.

## Interaction principles

### Hierarchy

- A live agent session is the primary surface.
- Approval/error/question/finished states must visually outrank passive widgets.
- Agent pills are secondary navigation, not competing cards.
- Dashboard widgets are navigation controls with clear labels and feedback.

### Semantics

- Actions use `<button>`.
- Navigation uses links or explicit buttons with accessible names.
- Icon-only actions expose `aria-label`.
- Dynamic status changes use a restrained live-region strategy.
- Focus remains visible and is not covered by the Pip overlay.

### Motion

- Motion communicates state change, feedback, progress, or hierarchy.
- DOM motion animates transform/opacity where possible.
- Every animation is interruptible or safely retargetable.
- Hidden views do not continue decorative animation.
- Reduced motion snaps geometry but preserves selected state, color, and
  concise feedback.

### Layout

- View content uses a shared Pip-safe inset instead of repeated inline values.
- Long agent names, tool commands, file paths, and provider labels truncate
  without overlapping controls.
- Desktop touch targets remain usable without bloating the compact island.
- Cards use one elevation/radius vocabulary and do not accumulate nested shells.

## Acceptance criteria

### A. Interaction integrity

- Dashboard widgets and agent pills are keyboard-accessible controls.
- Icon-only buttons have accessible names and visible focus states.
- The n8n error action either opens its real target or is removed/renamed; it
  must not remain a no-op.
- Provider/API status text reflects real known state or is explicitly labeled
  unavailable/unknown.
- Timer view synchronization does not mutate state repeatedly during rendering.
- Slider, swipe, tab, upload, approval, and chat interactions retain their
  existing contracts and do not regress.

### B. Layout integrity

- All `VIEW_LAYOUTS` surfaces are checked for Pip/content collision.
- Session, approval, media, control-center, dashboard, Bluetooth, timer, and
  upload states are checked with short and long realistic content.
- The solo-session mode enters and exits without clipping or stale layout.
- Repeated view changes do not leave stale exit classes/listeners or invisible
  overlays blocking input.

### C. Motion integrity

- Each catalog reaction can be triggered in the harness and remains visible
  long enough to communicate its state.
- Back-to-back reactions follow the priority/FIFO rules without silent loss
  caused by stale options or mid-play overwrites.
- View enter/exit animations do not blink, stick, or leave a hidden element
  intercepting input.
- Reduced motion removes decorative movement but preserves state changes and
  control feedback.
- Hidden mode does not retain an unnecessary render/poll loop.

### D. Verification

- TypeScript build and existing queue/control tests pass.
- New regression checks cover every fixed logic bug that can be expressed as a
  pure rule.
- Browser smoke verifies boot, view switching, harness reactions, and no
  uncaught console errors.
- A live Tauri pass checks shell feel, Pip geometry, approval/session layout,
  queue playback, folder hold, settings, and reduced motion.
- The Impeccable detector runs once over changed UI files after implementation.

## Deferred findings

Anything that is real but cannot be safely fixed without new product decisions,
live OS capabilities, or a larger architectural change is recorded with file,
trigger, impact, and next check. It is not silently bundled into the redesign.
