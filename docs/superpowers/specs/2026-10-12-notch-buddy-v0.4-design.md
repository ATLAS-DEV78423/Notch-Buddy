# Notch-Buddy v0.4 — Design Spec

Date: 2026-10-12 · Status: approved (chat review) · Scope: `windows/` (Tauri app) only

Four independent sub-projects, approved separately in brainstorming, executed as one campaign:

- **A** — UI fixes (session card overlap) + full view audit
- **B** — Notch action/animation inventory + reaction priority queue
- **C** — Multi-provider chat (NVIDIA, OpenAI, OpenCode, OpenRouter + Claude)
- **D** — "Pip holds a folder" while a file is in the temp clipboard

Execution order: A ∥ B ∥ C (parallel subagents) → D (needs B's `reactions.ts`) → final verification.

---

## A. UI fixes + full audit

### Root cause of the reported overlap

The big Pip canvas (`#bot-canvas`) is an absolutely-positioned sibling of `#island-clip`, appended after it (`island.ts:234-251`), so it paints above all card content. In the overview its box spans roughly x=19–116 (botX 68, diameter 58, canvas = diameter/0.6). Every card type clears this box with a left inset:

- `.int-card` → `padding: 10px 12px 0 108px` (style.css:2416)
- `.who` → `padding: 0 36px 0 108px` (style.css:543)
- `.dashboard-grid` → `padding-left: 100px` (style.css:1229)

…but the agent **session view** (`.session`, style.css:1600) has **no inset**, so step chips, the cmd/diff viewer, the "Waiting for the first step…" line and the inline approval row all render under Pip (visible in the user's screenshots).

### Fix

1. `.session` gets `padding-left: 108px` (same value as `.int-card`/`.who`). All rows — head, step rail, step view, approval — share the inset. Chips and diff rows already ellipsize/wrap; ~200px usable width in the 322px card.
2. **Full audit**: every view in `VIEW_LAYOUTS` (layout.ts:79-107) is checked by computing Pip's canvas box for that view's `botX`/`botDiameter` and comparing to content start. Any collision is fixed with the same 100–108px inset pattern (or a layout-specific fix where the inset would break the layout). Also audited: pill mini-bot clipping, `#bot-glow` overlap, chat view, control center, banners.
3. Verification: `npm run build`, visual pass per view in `npm run tauri dev`, impeccable detector (`node .agents/skills/impeccable/scripts/detect.mjs --json <changed>`).

Design rule: refinement only — keep the shipped look, fix collisions; do not restyle.

---

## B. Notch action/animation inventory + reaction queue

### Inventory — everything the notch can detect/act on, and its animation status

**Custom animations (catalog reaction with dedicated pose/aura/particles, or dedicated interaction animation):**

| # | Action / event | Trigger site | Reaction | Custom? |
|---|---|---|---|---|
| 1 | Volume slider moved | views.ts:1068 | `volume` (aura, note particle, level bob) | yes |
| 2 | Mute toggle | views.ts:1087, 893 | `mute-flash` (mute pose) | yes |
| 3 | Brightness slider | views.ts:1077 | `brightness` (aura, squint-happy ≥0.75) | yes |
| 4 | Night Light ON | views.ts:1118 | `night-light-on` (squint-happy, warm aura) | yes |
| 5 | Night Light OFF | views.ts:1119 | `night-light-off` (perky, cool aura) | yes |
| 6 | Do Not Disturb ON | views.ts:1120-1125 | `dnd-sleep` condition (sleep pose, floating z's) | yes |
| 7 | Do Not Disturb OFF | views.ts:1126 | `dnd-wake` (perky + blink) | yes |
| 8 | Memory boost start | views.ts:1141 | `memory-freeing` (perky) | yes |
| 9 | Memory boost done | views.ts:1150 | `memory-freed` (squint-happy, squash, sparks) | yes |
| 10 | Battery charging (plug in) | power.ts:17 | `battery-charging` condition (perky) | yes |
| 11 | Battery full (100%) | power.ts:19-22 | `battery-full` (flex pose + spark) | yes |
| 12 | Battery drained (≤15%) | power.ts:16 | `battery-drained` (drained pose) | yes |
| 13 | Battery exhausted (≤10%) | power.ts:15 | `battery-exhausted` (exhausted pose) | yes |
| 14 | Agent session finished | hooks.ts:221 | `session-done` (squint-happy + hearts) | yes |
| 15 | Agent session error | hooks.ts:240 | `session-error` (dizzy-red wobble) | yes |
| 16 | Agent rate-limited | hooks.ts:209 | `session-ratelimit` (drained + sweat/steam) | yes |
| 17 | Approval requested | hooks.ts:302 | `approval-wave` (wave pose) | yes |
| 18 | Media playing | backgroundEffects.ts:101 | `media-playing` condition (headphones pose, beat aura) | yes |
| 19 | Media paused | backgroundEffects.ts:105 | `media-paused` condition (headphones-paused) | yes |
| 20 | Track change | backgroundEffects.ts:111 | `track-change` (perky) | yes |
| 21 | Volume loud while playing | views.ts:1071 | `media-loud` (pant pose) | yes |
| 22 | Accent/theme change | backgroundEffects.ts:80 | `theme-sparkle` (squint-happy + stars) | yes |
| 23 | Hover Pip | island.ts:736,745 | `love` emote (1.9 s) | yes |
| 24 | Click / slap Pip | island.ts:630-633 | slap animation; 3 slaps → dizzy (island.ts:781) | yes |
| 25 | Fast click (≤250 ms) | island.ts:655 | `tickle` (squirm pose) | yes |
| 26 | Long press (≥500 ms) | island.ts:656 | `nuzzle` (nuzzle pose + hearts) | yes |

**No dedicated Pip animation (banner/display/generic emote only):**

| # | Action / event | What happens today |
|---|---|---|
| 27 | Clipboard URL copied | banner only (bridge.ts:351-356 → `State.showBanner`) |
| 28 | Weather update | banner only (bridge.ts:329-332) |
| 29 | Bluetooth device connected | generic `surprised` emote (bridge.ts:316) |
| 30 | Bluetooth device disconnected | no reaction |
| 31 | Pomodoro focus / break | generic `thinking` state / `happy` emote (state.ts:250-263) |
| 32 | System stats tick (cpu/ram/net) | display only (bridge.ts:277-280) |
| 33 | Charger connect/disconnect banner | banner only (bridge.ts:342-344); the charging *reaction* (#10) exists separately |
| 34 | Media next/prev buttons | only `track-change` (#20) reacts |
| 35 | Volume/mute via media keys | no reaction (only slider/mute-button paths call `react()`) |

All 26 existing custom animations must remain visible even when reactions arrive back-to-back — that is the queue's job. Items 27–35 are documented, **not** given new animations in v0.4 (out of approved scope; can be a follow-up).

### Queue design (B)

Today: one transient slot (`reactions.ts:81`); a second `react()` overwrites the first mid-play. Replacement:

- **New pure module** `windows/src/mochi/reaction-queue.ts` (zero imports):
  - `enqueue(kind, prio, nowMs)` — priority classes carried from the resolver: `0 = CONTROL` (dnd-wake, night-light, memory), `1 = SESSION` (approval, done, error, ratelimit), `2 = OTHER` (everything else).
  - FIFO within a class; **dedupe**: enqueuing a kind already in the queue refreshes it instead of duplicating.
  - **Cap 5**: when full, drop the oldest lowest-priority entry (never a control entry if avoidable — drop oldest OTHER first, then SESSION).
  - `dequeue(nowMs, minPrio)` returns the highest-priority eligible entry; entries older than **15 s** at dequeue time are dropped as stale (a burst shouldn't replay irrelevant reactions).
  - **TTL starts when the reaction starts playing** (not when enqueued), so every animation is seen in full: `REACTION_TTL` unchanged.
- **Integration** in `reactions.ts`:
  - `react()` → `queue.enqueue(...)` + `State.notify()`; the engine side-effects switch (reactions.ts:103-112: particles, blink, squash, notes) **moves to play time** — fired when a queued entry is dequeued, otherwise queued animations play silently.
  - `tickReactions()` → if no active transient (or it just expired), dequeue the next entry and activate it (set `transient` with `until = now + TTL`, fire its side-effects).
  - `resolve()` unchanged: control kinds still beat `agentBusy`; queued non-control entries simply wait until active rather than being dropped (subject to the 15 s stale rule).
  - Conditions (`setCondition`) unchanged — persistent states are not queued.
- **Runnable check**: `windows/scripts/check-queue.mjs` compiles the pure module with `tsc` to a temp dir and runs assert scenarios (priority order, FIFO, dedupe, cap, stale drop). Run: `node scripts/check-queue.mjs` from `windows/`.
- Scope boundary (user-confirmed): only the reaction-bus layer queues. Emotes, pose overrides, greeting, and conditions keep last-writer-wins/priority semantics as today.

---

## C. Multi-provider chat

**Decision (user-approved):** one active provider at a time; all keys stored simultaneously in the OS keychain; no per-message choice, no failover.

| Provider | Base URL | Key name (keychain) | Default model placeholder |
|---|---|---|---|
| Anthropic (existing) | `https://api.anthropic.com/v1` (messages API) | `anthropic-api-key` | `claude-opus-5` (select, existing) |
| OpenAI | `https://api.openai.com/v1` | `openai-api-key` | `gpt-4o` |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | `nvidia-api-key` | `meta/llama-3.3-70b-instruct` |
| OpenRouter | `https://openrouter.ai/api/v1` | `openrouter-api-key` | `anthropic/claude-sonnet-4` |
| OpenCode Zen | `https://opencode.ai/zen/v1` | `opencode-api-key` | `deepseek-v4-flash` |

- All four new providers use the OpenAI-compatible `POST {base}/chat/completions` shape: `Authorization: Bearer <key>`, `messages = [system, …history, user]`, reply = `choices[0].message.content`.
- **Settings schema** (`settings.rs`): `#[serde(default)] chat_provider: String` (default `"anthropic"`) and `#[serde(default)] chat_models: HashMap<String, String>` (provider → model). Serde defaults mean existing `settings.json` files load unchanged.
- **History**: `Chat.messages` becomes per-provider (`HashMap<String, Vec<Value>>`) so switching providers can't mix Anthropic block format with OpenAI strings. `chat_reset` clears all.
- **Anthropic path stays byte-for-byte identical** (web search tool, fallback beta, refusal handling, file blocks).
- **File context (OpenAI path)**: images → base64 `image_url` data URIs; text/code files ≤200 KB → inline text; everything else (incl. PDF) → `File: <name>` note only (OpenAI-compatible chat completions has no portable PDF block). Window context → plain text, first message only, mirroring `claude.rs:86-103`.
- **Secrets**: extend `KNOWN_KEYS` with the four names above. Never on disk, never sent to the frontend (only `secret_present`).
- **Settings UI** (`settings/main.ts:260-341`): same section, same widgets, no restyle. Row: **Provider** `<select>` (5 options). Key row rebinds to the selected provider's key name (dot/placeholder/Save/Remove per provider, presence refreshed on switch). **Model**: Claude keeps its `<select>`; the other four get a text input with the placeholder default above (free text — model lists go stale). Provider + model persist via `save()` on change.
- Errors: HTTP error message surfaced like `claude.rs:180-190` (bad key must be obvious). Missing key → existing "API key missing. Open settings." message.

---

## D. Folder hold (temp clipboard)

**Decision (user-approved):** keep the swallow/eat choreography; once the file rests in the temp clipboard (`State.droppedFile`), Pip holds a **single generic folder** — no per-file-type variations.

- `props.ts`: new `drawFolder(x, R, rx, ry)` — body-local ink-outline folder (`INK` fill + white glint, same vocabulary as `drawHeadphones`), plus two small grip blobs at the folder's lower edges so it reads as "held" **without touching the hand rigging** (resting hands are hidden, engine.ts:1166, so the folder draws its own grips).
- `engine.ts`: `prop` type widens to `"headphones" | "folder" | null`; draw branch beside `drawHeadphones` (engine.ts:872); `setProp` signature widened (engine.ts:355).
- Trigger (one line in `reactions.ts:173`): `engine.setProp(headphonesActive ? "headphones" : State.droppedFile ? "folder" : null)` — headphones win if media is playing.
- Folder disappears when `State.droppedFile` is cleared (file consumed by chat send, or Cancel in the choose view) — audit those paths during implementation and clear the field where missing.
- The upload-sequence canvas owns its own Mochi for the swallow animation; it is untouched (folder only appears after the sequence hands back to the main canvas).

---

## Cross-cutting

- No new dependencies (npm or cargo). No telemetry. Secrets in Credential Manager only.
- Verification everywhere: `npm run build` (tsc --noEmit + vite), `cargo check`, `node windows/scripts/check-queue.mjs`, `?reactions=1` dev harness for the queue, impeccable `detect.mjs` on changed UI files, manual visual pass in `npm run tauri dev`.
- Execution: superpowers subagent-driven development, parallel dispatch (A ∥ B ∥ C → D), review between tasks.
