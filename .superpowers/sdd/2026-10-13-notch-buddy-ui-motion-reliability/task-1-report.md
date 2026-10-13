# Task 1 report — DOM semantics and interaction affordances

## Scope

Implemented Task 1 from the recovered `docs/superpowers/plans/2026-10-13-notch-buddy-ui-motion-reliability.md` and its design specification. The requested `.superpowers/sdd/2026-10-13-notch-buddy-ui-motion-reliability/task-1-brief.md` was not present in the linked worktree, so the Task 1 plan section and spec were used as the authoritative scope.

## Preserved in-flight changes

The four pre-existing changes were restored from the worktree transfer stash before editing and remain intact:

- `windows/src/island/hooks.ts`: validates relay `tool_name` before rendering it.
- `windows/src/island/island.ts`: routes approval completion to the requesting task.
- `windows/src/style.css`: adds solo live-session layout rules.
- `windows/src/views/views.ts`: toggles solo layout while a live session owns the overview.

## Implementation

### Semantic controls

- Converted the six dashboard widgets from clickable `div` elements to native `button` elements, preserving classes, callbacks, labels, and dashboard geometry.
- Converted agent pills to native `button` elements, preserving stable task IDs and focus callbacks.
- Added explicit accessible names to icon-only header tabs/actions, the overview open action, media transport and mute controls, the chat send control, and integration details/back controls.
- Preserved dynamic accessible names when media play/mute state changes.
- Added pointer affordance and visible `:focus-visible` styling for the converted and related controls.
- Reset native button typography/alignment/borders where needed so the semantic controls retain the existing island visual treatment.

### Safe DOM text

- Extended the existing `h()` helper to accept unknown attribute values and serialize text/attributes through `safeText()`.
- Object-shaped or circular runtime labels no longer become `[object Object]`; text content remains escaped DOM text, and circular/unserializable values become empty text.

### Regression checks

Extended `windows/scripts/test-controls.mjs` with assertions covering:

- dashboard widget and agent-pill button semantics;
- icon-only/header/media/integration accessible names;
- keyboard-triggerable native chat send control;
- safe handling of object-shaped DOM text/attribute values.

The new assertions were observed failing against the baseline (14 existing tests passed, 3 new tests failed), then passed after the implementation.

## Files changed by Task 1

- `windows/src/views/dom.ts`
- `windows/src/views/views.ts`
- `windows/src/views/chat.ts`
- `windows/src/views/integrations.ts`
- `windows/src/style.css`
- `windows/scripts/test-controls.mjs`

The preserved `hooks.ts` and `island.ts` changes were not rewritten by this task.

## Verification

All commands were run from `windows/` unless noted:

| Check | Result |
|---|---|
| `node scripts/test-controls.mjs` | PASS — 17/17 |
| `npx tsc --noEmit` | PASS |
| `npx vite build` | PASS |
| `npm run build` | BLOCKED by access denied removing the existing `windows/target/release/.../proc-macro2.../build-script-build.exe` |
| `$env:CARGO_TARGET_DIR='target-fresh'; npm run build` | PASS — Rust hook build, TypeScript check, and Vite build |
| `node C:\Users\Stanley\.agents\skills\impeccable\scripts\detect.mjs --json windows/src/style.css` | 17 pre-existing warnings; none are on the new rules |

The detector findings are the existing bounce/layout-transition rules elsewhere in `style.css`; changing them would be an unrelated restyle. No live Tauri/browser visual pass was run in this task.

## Self-review

- Stable selectors, callbacks, task IDs, and existing view contracts are preserved.
- Native button conversion avoids nested interactive controls.
- Dynamic icon states update both hover text and accessible names.
- Malformed labels are rendered through text content rather than HTML or implicit object coercion.
- The default build failure is an environment/locked-target issue; the documented alternate target directory produces a complete passing build.

## Status

Implementation is complete and ready to commit. Remaining concerns are the missing task brief file, the locked default Cargo target, and unobserved live visual behavior.
