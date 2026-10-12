# Session Handoff — Notch-Buddy v0.4 Campaign

**Date:** 2026-10-12  
**Session:** Brainstorming → Design Approval → Implementation Planning  
**Status:** Design approved, implementation ready to dispatch

---

## What This Campaign Does

Four independent sub-projects for the Notch-Buddy Windows app (Tauri 2 + vanilla TS):

| Sub-project | Summary | Complexity |
|---|---|---|
| **A — UI Fixes** | Fix session card overlap (Pip covers step chips/diff text) + audit every view for collisions | CSS/layout |
| **B — Animation Queue** | Replace single-slot reaction system with priority queue so ALL animations play, even during bursts | New module + reactions.ts |
| **C — Multi-Provider Chat** | Add OpenAI/NVIDIA NIM/OpenRouter/OpenCode Zen as chat providers alongside Claude | Rust backend + settings UI |
| **D — Folder Hold** | Pip holds a generic folder prop while a file is in the temp clipboard | Canvas prop + trigger wiring |

**Execution order:** A ∥ B ∥ C (parallel subagents) → D (needs B's reactions.ts) → final verification

---

## Key Files

| Area | Path |
|---|---|
| **Spec (design authority)** | `docs/superpowers/specs/2026-10-12-notch-buddy-v0.4-design.md` |
| **Plan (step-by-step tasks)** | `docs/superpowers/plans/2026-10-12-notch-buddy-v0.4.md` |
| **Frontend entry** | `windows/src/main.ts` |
| **Island controller** | `windows/src/island/island.ts` (1116 lines) |
| **Bot engine (Pip renderer)** | `windows/src/mochi/engine.ts` (1432 lines) |
| **Reaction bus** | `windows/src/mochi/reactions.ts` (210 lines) |
| **Props (headphones, etc.)** | `windows/src/mochi/properties.ts` |
| **All views** | `windows/src/views/views.ts` (1747 lines) |
| **View styles** | `windows/src/style.css` (2780 lines) |
| **Layout/positions** | `windows/src/core/layout.ts` |
| **State** | `windows/src/core/state.ts` |
| **Rust chat client** | `windows/src-tauri/src/claude.rs` |
| **Rust secrets** | `windows/src-tauri/src/secrets.rs` |
| **Rust settings** | `windows/src-tauri/src/settings.rs` |
| **Settings window UI** | `windows/src/settings/main.ts` |

---

## Architecture Summary

**Framework:** Tauri 2 (Rust backend) + vanilla TypeScript/Vite frontend. No React, no Electron. Pip is drawn with Canvas 2D — no sprite sheets, no Lottie/Rive.

**Island structure:**
- Fixed 720×320 panel, island drawn inside
- `#bot-canvas` is a sibling of `#island-clip` (appended after → paints above cards)
- Pip positioned per-view via `VIEW_LAYOUTS` (layout.ts:79-107)
- Canvas spans ~137px tall (body 58px + BOT_OVERHANG 40px)

**Reaction system:**
- 26 catalog reactions with custom poses/auras/particles (reactions.ts:35-61)
- 7 persistent conditions (battery states, DND, media)
- Single transient slot (reactions.ts:81) — **the bug being fixed**
- Priority resolver: control > session > battery > media

**Chat system:**
- Currently Claude-only (Anthropic messages API)
- Key in Windows Credential Manager (`secrets.rs`)
- History in-memory per Rust process
- Settings: `model` field in `settings.json`

---

## Decisions Made (User-Approved)

### Sub-project A — UI Fixes
- **Root cause:** `.session` (style.css:1600) has no left padding; all other cards use 108px inset
- **Fix:** Add `padding-left: 108px` to `.session`
- **Audit scope:** Every view in VIEW_LAYOUTS — fix all collisions with same inset pattern
- **No restyles** — refinement only

### Sub-project B — Animation Queue
- **Inventory:** 26 custom animations exist and are wired (verified against codebase)
- **Why user hasn't seen most:** Single-slot overwrite — 2nd reaction kills 1st mid-play
- **Solution:** Priority queue (control > session > other), FIFO within class, dedupe, cap 5, TTL starts at play time
- **New file:** `windows/src/mochi/reaction-queue.ts` (pure, zero-import)
- **Runnable check:** `windows/scripts/check-queue.mjs` (tsc compile + assert)
- **Engine side-effects** (particles/blink) move from `react()` time to dequeue time
- **Scope boundary:** Only the reaction bus queues; emotes/pose overrides/conditions stay last-writer-wins

### Sub-project C — Multi-Provider Chat
- **Providers:** Anthropic (existing), OpenAI, NVIDIA NIM, OpenRouter, OpenCode Zen
- **All four new ones** use OpenAI-compatible `/chat/completions` format
- **Settings:** `chat_provider: String` + `chat_models: HashMap<String,String>` (serde defaults = no migration)
- **History:** Per-provider (HashMap) so switching providers doesn't corrupt threads
- **Anthropic path:** Byte-for-byte unchanged
- **Settings UI:** Extend existing section with provider `<select>`, rebind key row per provider, model input for non-Claude
- **File context (OpenAI):** Images → base64 `image_url`, text ≤200KB inline, PDFs → name-only

### Sub-project D — Folder Hold
- **Keep** swallow/eat choreography untouched
- **After swallow:** Pip holds generic folder while `State.droppedFile` is set
- **New function:** `drawFolder()` in props.ts — self-contained (draws own grip blobs, no hand rigging)
- **Engine:** Widen `prop` type to `"headphones" | "folder" | null`
- **Trigger:** One line in reactions.ts:173
- **Lifecycle:** Folder clears when `State.droppedFile` is consumed/cancelled

---

## Global Constraints

- Only `windows/` tree — never touch `NotchBuddy/` (Swift)
- No new npm or cargo dependencies
- Secrets only via `secrets.rs` keychain — never on disk, never to frontend
- Pill IDs, existing view styling, and CSS selectors stay as-is
- Every task ends with `npm run build` (tsc --noEmit + vite) or `cargo check`
- Ponytail ultra mode active — minimal code, no over-engineering
- Impeccable detector runs on all changed UI files after each UI task
- Subagent-driven development: fresh subagent per task, review between tasks

---

## Animation Inventory (All 35 Notch Actions)

### Custom animations (26 — all exist and wired):

| # | Action | Trigger | Reaction/Effect |
|---|---|---|---|
| 1 | Volume slider | views.ts:1068 | `volume` — aura, note particle, level bob |
| 2 | Mute toggle | views.ts:1087, 893 | `mute-flash` — mute pose |
| 3 | Brightness slider | views.ts:1077 | `brightness` — aura, squint-happy ≥0.75 |
| 4 | Night Light ON | views.ts:1118 | `night-light-on` — squint-happy, warm aura |
| 5 | Night Light OFF | views.ts:1119 | `night-light-off` — perky, cool aura |
| 6 | DND ON | views.ts:1120-1125 | `dnd-sleep` condition — sleep pose, zzz |
| 7 | DND OFF | views.ts:1126 | `dnd-wake` — perky + blink |
| 8 | Memory boost start | views.ts:1141 | `memory-freeing` — perky |
| 9 | Memory boost done | views.ts:1150 | `memory-freed` — squint-happy, squash, sparks |
| 10 | Battery charging | power.ts:17 | `battery-charging` — perky condition |
| 11 | Battery full (100%) | power.ts:19-22 | `battery-full` — flex pose + spark |
| 12 | Battery drained (≤15%) | power.ts:16 | `battery-drained` — drained pose |
| 13 | Battery exhausted (≤10%) | power.ts:15 | `battery-exhausted` — exhausted pose |
| 14 | Agent session finished | hooks.ts:221 | `session-done` — squint-happy + hearts |
| 15 | Agent session error | hooks.ts:240 | `session-error` — dizzy-red wobble |
| 16 | Agent rate-limited | hooks.ts:209 | `session-ratelimit` — drained + sweat/steam |
| 17 | Approval requested | hooks.ts:302 | `approval-wave` — wave pose |
| 18 | Media playing | backgroundEffects.ts:101 | `media-playing` — headphones, beat aura |
| 19 | Media paused | backgroundEffects.ts:105 | `media-paused` — headphones-paused |
| 20 | Track change | backgroundEffects.ts:111 | `track-change` — perky |
| 21 | Volume loud while playing | views.ts:1071 | `media-loud` — pant pose |
| 22 | Accent/theme change | backgroundEffects.ts:80 | `theme-sparkle` — squint-happy + stars |
| 23 | Hover Pip | island.ts:736,745 | `love` emote (1.9s) |
| 24 | Click/slap Pip | island.ts:630 | slap animation; 3 slaps → dizzy |
| 25 | Fast click (≤250ms) | island.ts:655 | `tickle` — squirm pose |
| 26 | Long press (≥500ms) | island.ts:656 | `nuzzle` — nuzzle pose + hearts |

### Basic/generic (9 — no dedicated custom animation):

| # | Action | What happens |
|---|---|---|
| 27 | Timer focus/break | Generic `thinking` state / `happy` emote (state.ts:250-263) |
| 28 | Bluetooth connect | Generic `surprised` emote (bridge.ts:316) |
| 29 | Clipboard URL copied | Banner only (bridge.ts:351-356) |
| 30 | Weather update | Banner only (bridge.ts:329-332) |
| 31 | System stats tick | Display only (bridge.ts:277-280) |
| 32 | Charger connect/disconnect | Banner only (bridge.ts:342-344) |
| 33 | Media next/prev | Only `track-change` (#20) reacts |
| 34 | Bluetooth disconnect | No reaction |
| 35 | Tray/screen-changed | No animation needed |

---

## Verification Commands

```bash
# Frontend (from windows/)
npm run build          # tsc --noEmit + vite build
npm run tauri dev      # visual dev server

# Backend (from windows/src-tauri/)
cargo check
cargo test

# Queue check (from windows/)
node scripts/check-queue.mjs

# UI detector
node C:\Users\Stanley\.agents\skills\impeccable\scripts\detect.mjs --json <changed-files>

# Reaction harness
# Open npm run tauri dev with ?reactions=1 query param
```

---

## What's Next

1. **SDD setup:** Create workspace + ledger, pre-flight conflict scan
2. **Wave 1 (parallel):** Dispatch subagents for A (UI fixes), B (queue), C (chat)
3. **Wave 2:** Dispatch subagent for D (folder hold — needs B's reactions.ts)
4. **Final verification:** All build/check commands + visual pass + report

---

## Session Prompt for New Agent

See `docs/SESSION-PROMPT.md` — paste the entire file contents into any new agent session to bring it up to speed.
