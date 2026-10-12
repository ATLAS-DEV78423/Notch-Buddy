You are continuing work on the Notch-Buddy Windows app (Tauri 2 + vanilla TS). Read these files in order to get up to speed:

1. `docs/SESSION-HANDOFF-2026-10-12.md` — full session summary, all decisions, animation inventory
2. `docs/superpowers/specs/2026-10-12-notch-buddy-v0.4-design.md` — design spec (the authority)
3. `docs/superpowers/plans/2026-10-12-notch-buddy-v0.4.md` — step-by-step implementation plan

Then read these key source files as needed for your task:
- `windows/src/mochi/reactions.ts` — reaction bus (Phase B target)
- `windows/src/mochi/engine.ts` — Pip renderer (Phase D target)
- `windows/src/mochi/properties.ts` — props like headphones (Phase D target)
- `windows/src/style.css` — all view styles (Phase A target)
- `windows/src/core/layout.ts` — view layouts and bot positions
- `windows/src-tauri/src/claude.rs` — chat client (Phase C target)
- `windows/src-tauri/src/secrets.rs` — keychain (Phase C target)
- `windows/src-tauri/src/settings.rs` — settings schema (Phase C target)
- `windows/src/settings/main.ts` — settings window UI (Phase C target)

## The Campaign

Four sub-projects, executed via subagent-driven development (parallel where possible):

- **A — UI Fixes:** Fix `.session` padding (add `padding-left: 108px` at style.css:1600) + audit every view for Pip/content collisions
- **B — Animation Queue:** New `reaction-queue.ts` (pure priority queue) + integrate into `reactions.ts` so all 26 reactions play even during bursts. Runnable check: `scripts/check-queue.mjs`
- **C — Multi-Provider Chat:** Add OpenAI/NVIDIA NIM/OpenRouter/OpenCode Zen alongside Claude. One OpenAI-compatible code path. Settings: `chat_provider` + `chat_models`. Keys in keychain. Settings UI extended.
- **D — Folder Hold:** New `drawFolder()` in props.ts + engine prop widening + trigger in reactions.ts:173. Pip holds folder while `State.droppedFile` is set.

**Execution order:** A ∥ B ∥ C (parallel) → D (after B) → final verification

## Global Constraints

- Only `windows/` tree — never touch `NotchBuddy/` (Swift)
- No new npm or cargo dependencies
- Secrets only via keychain — never on disk, never to frontend
- Pill IDs, existing view styling, CSS selectors stay as-is
- Every task: `npm run build` (from `windows/`) or `cargo check` (from `windows/src-tauri/`) must pass
- Ponytail ultra: minimal code, no over-engineering, no unrequested abstractions
- Impeccable detector on changed UI files: `node C:\Users\Stanley\.agents\skills\impeccable\scripts\detect.mjs --json <files>`
- Subagent-driven development: fresh subagent per task, review between tasks, parallel dispatch where files don't overlap

## Verification

```bash
cd windows && npm run build          # tsc + vite
cd windows/src-tauri && cargo check   # Rust
cd windows && node scripts/check-queue.mjs  # queue logic
```

## Current State

- Spec and plan written and approved
- All 26 custom animations verified as existing and wired in codebase
- No code changes made yet — ready to dispatch Wave 1

## Your Task

[DESCRIBE YOUR SPECIFIC TASK HERE — e.g., "Execute Task A1 from the plan", "Execute Tasks B1+B2 from the plan", etc.]

Read the plan file for exact steps, code, and file paths. Follow the subagent-driven-development skill for execution methodology.
