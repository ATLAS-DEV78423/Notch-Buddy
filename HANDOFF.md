# Notch-Buddy — Project Handoff Document

**For:** the next AI coding agent continuing development.
**Written:** 2026-10-15 · **Version at time of writing:** **0.3.6**, with the release tree verified locally and installers built (see §3 and §6).
**Repo root:** `D:\Notch-Buddy-windows-v0.3.3\Notch-Buddy-windows-v0.3.3\` (the folder `D:\Notch-Buddy-windows-v0.3.3\` also holds `latest installer for notch buddy\` with the shipped installers, and `graphify-out\` with a knowledge graph of the codebase).

> **Note:** the outer folder is named `v0.3.3` — that name is stale. The product is at **0.3.6**.

---

## 1. What the project is

A desktop companion app. **Pip** (renamed from "Mochi" in the fork) is a small character drawn entirely in code (Canvas 2D / Swift `Canvas` + `TimelineView`, no sprite sheets, no Lottie/Rive) that lives in the MacBook notch on macOS and at the **top centre of the screen on Windows/Linux**. It shows AI coding-agent sessions (Claude Code, Hermes, OpenCode, Codex, Copilot, Muse, Gemini CLI, Antigravity, Amp, or any tool via `--agent <name>`), lets the user **approve/deny permissions, answer questions, chat, drop files**, and doubles as a system/media/control-centre island (stats, battery, weather, media player, pomodoro, Bluetooth, clipboard).

**Provenance / licensing (critical, read §7 rules too):**
- Fork of **[Coucou](https://github.com/Louis-CFM/coucou)** by Louis Raillé (MIT). Rebranded Coucou → **Notch-Buddy**, Mochi → **Pip**. Fork changes © ATLAS-DEV78423.
- Original MIT copyright retained in `LICENSE`. Attribution in `NOTICE.md`.
- **The Coucou name, the Mochi character, the icon, the sounds and the media remain © Louis Raillé and must be replaced before any public distribution** — `NOTICE.md` lists exactly which files.
- Build artifacts/on-disk identifiers were deliberately **not** renamed (`Coucou.app`, `Coucou-Windows-*-setup.exe`, `fr.louisraille.NotchBuddy`, `nb.sock`, `coucou-hook`, pipe `\\.\pipe\coucou-<sid>`) because existing installs and builds depend on them.

**Three codebases live in this repo:**

| Tree | What | Language |
|---|---|---|
| `NotchBuddy/` | The **macOS app** (and shared `CoucouKit`, iPhone app, widgets) | Swift 6, SwiftUI + AppKit, XcodeGen |
| `windows/` | The **Windows + Linux app** — this is where all active development happens | Tauri 2 (Rust) + vanilla TypeScript/Vite, no React, no Electron |
| `relay/` | Stateless **Cloudflare Worker** forwarding iPhone Live Activity pushes (holds the APNs key) | TypeScript/Worker |

---

## 2. Architecture of the Windows/Linux app (`windows/`)

### Frontend (`windows/src/`, vanilla TS, no framework)

```
src/main.ts                entry
src/core/
  state.ts     (20KB)  global State: tasks, pills, settings mirror, droppedFile, chatProvider…
  bridge.ts    (14KB)  Tauri bridge; degrades to null when not in Tauri (browser dev works)
  layout.ts    (8KB)   VIEW_LAYOUTS + Pip position per view (VIEW_LAYOUTS at layout.ts:79-107)
  anim.ts, spring.ts, motion-tokens.ts   animation vocabulary + hand-rolled semi-implicit Euler springs
  steps.ts     (7KB)   pure: step capture, kind classification, LCS line diff + patch parser
  agents.ts, sound.ts
src/island/
  island.ts    (43KB)  THE island controller: geometry springs, FSM glue, frame loop, hover/peek/busy-gate
  fsm.ts               open/close/pinned state machine
  hooks.ts     (13KB)  named-pipe event handling → pills, steps, approvals, model/thinking capture
  integrations.ts
src/mochi/
  engine.ts    (52KB)  Pip renderer (poses, eyes, aura, particles, badges)
  reactions.ts (10KB)  the reaction bus: CATALOG, conditions, priority, queue integration
  reaction-queue.ts (1KB)  pure priority queue (v0.4 campaign, task B)
  properties.ts        props: headphones, folder (drawFolder, v0.4 task D)
  greeting.ts, minibots.ts, power.ts (battery reactions)
src/views/views.ts (66KB)  every island view (tabs: Home/Agents/Media/System/Tools, dashboard, session view, approvals, chat…)
src/views/…      backgroundEffects.ts, ticker.ts, chat.ts, upload.ts, integrations.ts, icons.ts, dom.ts
src/settings/main.ts (28KB)  the Settings window
src/ui/…         ported React Bits micro-interactions: thoughtline, springcheck, squishswitch,
                 swiperow, swipetoast, callchip*, tabsegment, pointer, batteryicon  (*callchip/ticker deleted in 0.3.5)
src/upload/…     file-drop choreography (canvas + sequence engine)
style.css (2780+ lines) — all island styling; index.html / settings.html are the two windows
```

### Backend (`windows/src-tauri/src/`, Rust)

- `claude.rs` — chat client: Anthropic path **plus** OpenAI-compatible path (`send_openai`) for provider table:
  `anthropic` (native) · `openai` · `nvidia` (`https://integrate.api.nvidia.com/v1`) · `openrouter` (`https://openrouter.ai/api/v1`) · `opencode` (OpenCode Zen). Provider → keychain-key name table at claude.rs:194-195.
- `secrets.rs` — **Windows Credential Manager** (Linux: Secret Service). Keys never on disk, never sent to the frontend (frontend only asks "does a key exist").
- `settings.rs` — settings schema + one-time migrations. `chat_provider: String`, `chat_models: HashMap<String,String>` (serde `rename_all = camelCase` → frontend fields are `chatProvider`/`chatModels`).
- `agents.rs` — installs/installs-out agent hook configs + the OpenCode plugin (forwards `model`/thinking via `modelInfo`).
- `hooks.rs` — hook installer with fingerprinting + backups; `platform/` — Windows/Linux differences; pollers (battery, system stats, media…).

### The relay (`windows/hook/` → `coucou-hook.exe`)

- Rust binary copied to `%LOCALAPPDATA%\Coucou\bin\` at launch. Transports: Windows named pipe `\\.\pipe\coucou-<user-SID>`, Unix socket `$XDG_RUNTIME_DIR/coucou.sock`.
- **Security:** pipe verifies the connecting process runs as the same user (v0.3.3 fix; previously any same-machine process could inject forged events). Linux always checked this; the hook checks the other direction too.
- **Never blocks the agent:** 300 ms budget to reach the app, then exits cleanly; fail-open (a closed Notch-Buddy never blocks Claude/Hermes). Hermes receipts: allow `{}`, deny `{"action":"block","message":"Denied from Coucou"}`, no-answer-timeout block (110 s); `fail_closed` deliberately NOT set.
- Any tool can get its own pill: add `coucou_agent: ^[a-z0-9-]{1,24}$` to a hook payload or pass `--agent <name>` (see `docs/AGENTS.md` for per-agent event dialects).

### Key mechanics

- **Island:** fixed 720×320 panel; `#bot-canvas` is a sibling appended after `#island-clip` so Pip paints above cards. Four per-property springs (`shell.w/h/y/r`) — each settles independently; radius stiffest (snaps first).
- **0 % CPU when hidden:** nothing polls while hidden; the frame loop sleeps; springs snap-and-sleep; the hidden busy-gate arm is `settling` only (`island.ts:852-861`).
- **Reaction system:** 26 catalog reactions (poses/auras/particles) + 7 persistent conditions. Priority resolver: **control > session > battery > media**. Since v0.4: a **priority queue** (`reaction-queue.ts` — FIFO within class, dedupe, cap 5, TTL starts at play time, control exempt from stale-drop) so bursts play sequentially instead of overwriting. Engine side-effects move to dequeue time (`beginReaction()`).
- **Approval semantics (never fake):** VS Code/Claude Code + Hermes = real Allow/Deny (their hooks block on a decision). **OpenCode = display-only** ("Handled in OpenCode's terminal") because its plugin API is fire-and-forget and cannot return a decision. Copilot/Muse/Codex = real. Model/thinking chips show only what the agent reports — **never invented**.

---

## 3. Version status — what exists right now

| Item | Status |
|---|---|
| **Product version** | **0.3.6** (`windows/package.json`, `src-tauri/tauri.conf.json`, Cargo workspace and lockfile all say `0.3.6`; CHANGELOG has a 0.3.6 section) |
| **Shipped installers** | `D:\Notch-Buddy-windows-v0.3.3\latest installer for notch buddy\`: `Coucou-Windows-0.3.4-setup.exe/.msi`, `0.3.5`, and **`0.3.6`** (NSIS + MSI, unsigned → SmartScreen warns; Defender may false-positive `Trojan:Win32/Wacatac.H!ml`) |
| **Git** | Repo exists at the nested root. Local `master` contains the 0.3.6 implementation and release metadata, ahead of remote `main`; publish after the verification matrix and release-asset gate. ⚠️ Git needs `git -c safe.directory=D:/Notch-Buddy-windows-v0.3.3/Notch-Buddy-windows-v0.3.3 …` — the drive does not record file ownership, so plain git reports "dubious ownership". |
| **Uncommitted work (in-flight)** | 4 modified files, +35/−3: `windows/src/island/hooks.ts` (validate `tool_name` from untrusted relay JSON → no "[object Object]"), `island.ts` (use `req.taskId` instead of hardcoded `integration_claude` on approval answer), `style.css` + `views.ts` (**new "solo mode"**: while a live agent session is active the overview's pills card collapses and the session view gets full width; reverts when idle/finished). Not committed, not in any installer. |

**Git history highlights (chronological):** fork/rebrand → motion-polish campaign (design/testing specs, easings, tokens, reduced-motion, CallChip, SwipeRow, segment tabs, sliders) → Mochi reactive-motion campaign (spring core, reaction bus, shell springs, event-peek, battery conditions, E2E report) → 0.3.0/0.3.1/0.3.2/0.3.3 releases → 0.3.4 (media player, control-centre animations, standing agent lineup, bicep-flex) → 0.3.5 campaign (v0.4 A–D) → merge.

---

## 4. Feature inventory (by release, from CHANGELOG)

- **0.3.6** — Security and bounded-state hardening; authenticated iPhone relay; stable Bluetooth IDs and safer upload flow; accessibility regression coverage and cross-platform backend test harness.
- **0.3.5** — Agent **session view** (step rail: Read/Edit/Bash/Done, unified diff with +N −M, per-step command/target); **inline Approvals** in the session view (real for VS Code+Hermes, display-only for OpenCode); **model + thinking chips** when reported; **ticker/CallChip retired**.
- **0.3.4** — Notch **lineup** = standing agents (VS Code/Claude Code, Hermes, OpenCode) instead of integration Mochis (old default list migrated once); Apple-style **media player** transport; **control centre** animated toggles (Night light glow, DND z's + Pip sleeps, Memory boost sparkle); Pip triple-click spiral fix; mini-Mochi/battery alignment.
- **0.3.3** — Windows pipe **same-user verification** (security); bicep-flex entrance at 100 %.
- **0.3.2** — Real reaction artwork: ♪ note particle, 100 % badge + arms-up flex, hands-over-ears mute, z-particles DND, steam wisps rate-limit, volume-driven headphone beat (additive only).
- **0.3.1** — Reduced-motion frame-loop sleep; mute dim-aura; brightness squint; ticker marquee; React Bits/bloom credits.
- **0.3.0** — Pip as living indicator: per-property springs, reaction bus, DOM choreography (digit rolls, marquee, asymmetric view transitions), hover-grace + 4 s event-peek, `?reactions=1` dev harness, battery via Rust source, session > media priority.
- **0.2.0 (Windows)** — Island becomes tab groups (Home/Agents/Media/System/Tools) + dashboard; media player; control centre; system stats; Bluetooth; pomodoro/stopstop; weather (wttr.in, ~30 min, only while open); battery alerts; clipboard URL banner; 9 background effects + accent; compact mode status strip; 0 % CPU at rest.
- **0.1.x (Windows)** — Hermes config-path fix (Windows `%LOCALAPPDATA%\hermes`), 7 Hermes hooks with receipts, OpenCode plugin (Win/Linux/macOS, display-only), agent pills, `--agent` generic routing.
- **macOS-only / not in Windows build:** iPhone app + iCloud Live Activity (via `relay/` worker), wardrobe/outfits, desktop Pip drag-out, weekly recap, file-by-email, attach-window-to-chat, i18n (10 languages), Amp, Gemini CLI/Antigravity installers.
- **Linux:** same Tauri app — gtk-layer-shell overlay (`platform/`), Unix socket, Secret Service keys, `COUCOU_LAYER_SHELL=0` fallback; builds AppImage/.deb/.rpm.

Full history: `CHANGELOG.md` (fork sections + unchanged upstream Coucou sections).

---

## 5. Decisions made (the contract — do not re-litigate)

**Product / UX**
1. Session view replaced the ticker; approvals live inline in the session view.
2. OpenCode approvals are **display-only forever** unless OpenCode exposes a decision-returning API. Never fake a decision.
3. Values an agent doesn't report (model, thinking) are **hidden, never guessed**.
4. Notch lineup = VS Code (Claude Code sessions), Hermes, OpenCode as standing agents; integration pills moved to Settings → Active pills (max 4), one-time migration for old defaults.
5. Solo mode (uncommitted): a live session owns the full island width; pills return automatically when idle/finished — no manual toggle.

**v0.4 campaign decisions (2026-10-12, approved, all four shipped in 0.3.5; subsequent hardening shipped in 0.3.6)**
- **A (UI):** root cause of session-card overlap was `.session` lacking the 108 px left inset every other card has → `padding-left: 108px`; audit all 25 `VIEW_LAYOUTS` entries with the same pattern; refinement only, no restyles.
- **B (Animation queue):** single-slot reaction bus was overwriting animations mid-play. New pure module `reaction-queue.ts`: priority **control > session > other**, FIFO within class, dedupe, cap 5, TTL starts at play time; control class exempt from stale-drop; `react()` opts (intensity/color) survive the queue via `pendingOpts`. Runnable check `scripts/check-queue.mjs`. Scope boundary: **only the reaction bus queues** — emotes/pose overrides/conditions stay last-writer-wins.
- **C (Multi-provider chat):** OpenAI/NVIDIA NIM/OpenRouter/OpenCode Zen all via one OpenAI-compatible `/chat/completions` path. Settings `chat_provider` + `chat_models` (serde defaults = no migration); **history per-provider** (HashMap) so switching doesn't corrupt threads; **Anthropic path byte-for-byte unchanged**; keys in keychain (`nvidia-api-key`, `openrouter-api-key`…); file context: images → base64 `image_url`, text ≤200 KB inline, PDFs name-only; eager default-model seeding on provider pick (prevents `claude-opus-5` → OpenAI 400).
- **D (Folder hold):** keep swallow/eat choreography; after swallow Pip holds a generic folder while `State.droppedFile` is set; `drawFolder()` in props.ts self-contained (own grip blobs, no hand rigging); engine `prop: "headphones" | "folder" | null`; one-line trigger in reactions.ts:173; cleared when droppedFile is consumed/cancelled (chat.ts, upload.ts, island.ts — including a cancel-path clear the brief missed).
- **Execution:** A ∥ B ∥ C parallel subagents (pre-flight conflict scan showed disjoint files; B→D ordered because both touch `reactions.ts`), then final verification F1.

**Engineering rules (from `CLAUDE.md` + campaign constraints)**
- **Only `windows/` tree** for the campaign work — never touch `NotchBuddy/` (Swift) unless explicitly asked.
- **No new npm or cargo dependencies.**
- Secrets only via keychain — never on disk, never to the frontend.
- **Pill IDs are stable contract values** (Keychain, UserDefaults, hook routing) — never rename.
- Bundle identifier stays `fr.louisraille.NotchBuddy` (Keychain/prefs/permissions depend on it).
- **Never block Claude Code:** if the app doesn't answer, the hook exits immediately.
- **Never overwrite `~/.claude/settings.json` / agent configs:** dated backup → merge → show diff → write only after explicit confirmation.
- **Never send an email or approve a permission without an explicit click.**
- No telemetry; network only to user-configured services (+ optional wttr.in).
- **Never restyle what already ships** (pills, cards, Settings, chat…) unless explicitly asked. New views follow the existing style; `design/prototype/notch-buddy.html` + `design/captures/` are references, not licences to change existing views.
- Every release: CHANGELOG section + README Versions row + version bump in **package.json, package-lock.json, Cargo.toml (workspace), tauri.conf.json** (CI has a "check the tag and every version agree" gate).
- Swift 6; character drawn in code; 0 % CPU when hidden.

**Process rulings worth remembering (from the SDD ledger)**
- On win32, the superpowers SDD skill's workspace/brief/diff scripts were unusable (bash-only, no git at the time) → briefs composed manually, reviews read changed files directly. Ledger kept because it was the only execution record.
- Impeccable detector's 17 pre-existing bounce-easing findings ruled **out of scope** (changing shipped easing = restyle, not a reported error).
- Deferred minors triaged ship-as-is (see §8).

---

## 6. Testing — what exists, what passed, what E2E means here

### 6.1 Verified right now (run on 2026-10-15, this handoff session)

| Gate | Command | Result |
|---|---|---|
| Frontend build | `cd windows && npm run build` (`tsc --noEmit && vite build`) | ✅ pass, 0 TS errors |
| Frontend/unit suites | `test-controls`, queue, navigation, carousel, spring, anim, agents, Bluetooth, file shelf, performance, backend poll log | ✅ **27/27 controls pass**; all other non-Playwright suites pass |
| Rust check | `CARGO_TARGET_DIR=… cargo check --workspace` (in `windows/src-tauri`) | ✅ pass |
| Rust tests | `CARGO_TARGET_DIR=… cargo test --workspace` | ✅ **49/49 pass** (40 app + 9 hook) |
| Relay and shell checks | `relay/npm run typecheck`; `scripts/test-hook-relay-dialect.sh`; `scripts/test-agent-docs.sh` | ✅ pass |
| Installer package | `cd windows && npm run pack` | ✅ fresh 0.3.6 NSIS + MSI bundles built and copied to the installer folder |
| Release hygiene | `git diff --check`; version agreement across package/lockfile/Cargo/Tauri config | ✅ pass |

⚠️ **Building Rust on this machine:** the default `windows\target` is damaged — several `build-script-build.exe` files there are undeletable ("Access is denied", the drive's FS doesn't record ownership / AV interference), and the debug dir still contains stale absolute paths from when the project lived in `C:\Users\Stanley\Downloads\...`, which makes plain `cargo check` fail with a "permissions/app_hide.toml not found" error. **Workaround used:** `CARGO_TARGET_DIR='C:/Users/Stanley/AppData/Local/Temp/omnirush/notch-buddy-full-cargo'` for check/test. The release hook must exist at `windows\target\release\coucou-hook.exe` (tauri.conf resource) — it was rebuilt. Cleanup of `windows\target` / `windows\target-fresh` is pending (§9).

The Playwright-backed UI smoke scripts were not run because this checkout does not install `playwright`; no dependency was added just for release verification. The live Tauri visual pass is still **NOT OBSERVED** on this host.

### 6.2 Test inventory

- **Windows/Linux app:** `windows/scripts/test-controls.mjs` (14 tests), `check-queue.mjs` (assert-based queue check), `src/core/spring.test.mjs`, `src/core/anim.test.mjs` (`node --experimental-strip-types …`). Rust: 27 unit tests across `claude.rs` (provider table, base64), `agents.rs` (install/uninstall, foreign-key refusal), `hooks.rs` (fingerprint/backup), etc.
- **macOS app:** `tests/*.swift` (13 files: DiffEngine, ChatParsing, Shortcut, GitHubPulse, MochiWardrobe, IslandScreenGeometry…) + `scripts/test-*.sh` (10 bash suites) run by CI `build.yml` on `macos-latest` with xcodegen/xcodebuild. **Not runnable on this Windows box** (no Swift toolchain) — treat all Swift/macOS as *implemented, untested here*.
- **Relay dialect:** `tests/test_relay_dialect.py`, `tests/fake_local_llm.py`, `scripts/test-hook-relay-dialect.sh` (receipts must be byte-identical across macOS/Windows relays).
- **Agent integration matrix:** `docs/AGENT_TEST_MATRIX.md`, `docs/AGENT_COMPATIBILITY_PLAN.md`; per-agent verified/unverified notes are in `docs/AGENTS.md` (e.g. Hermes verified headless on Windows v0.21.5 — hooks list/doctor, receipts, fail-open; **not** tested: live Allow/Deny card, 115 s timeout, macOS end-to-end).
- **CI (`.github/workflows/`):** `build.yml` (macOS: xcodegen + xcodebuild + the 10 bash suites), `windows.yml` (npm ci → **version-agreement check** → `tauri build` → publish setup.exe/msi/portable to releases + rolling `windows-latest`), `linux.yml` (AppImage/deb/rpm), `release.yml` (macOS build check). **CI does not run the Rust/TS test suites** — those are run manually per task.

### 6.3 End-to-end testing — methodology and history

There is **no browser-automation E2E suite in the repo**. E2E has been done in three escalating layers, documented in `docs/superpowers/plans/2026-10-10-mochi-reactive-motion-e2e.md` (the model to copy):

1. **Build/test gates (OBSERVED):** exit codes of `npm run build`, spring/anim tests, `cargo test`.
2. **Mechanism-level static verification (OBSERVED):** for every visual behaviour, cite the exact `file:line` code path that implements it (e.g. all 18 harness chips → pose/aura/prop/particle table; busy-gate re-read proving 0 %-CPU-when-hidden). Any item not actually seen is honestly marked **NOT OBSERVED** — that honesty rule is mandatory in this project's reports.
3. **Headless browser E2E (OBSERVED):** run `vite` dev server on `127.0.0.1:1420` (the Tauri shell is not needed — `bridge.ts` degrades when `IS_TAURI` is false), drive it with headless Chrome: verify **0 console errors/exceptions on boot**, self-install of the `?reactions=1` 18-chip harness, programmatically click every chip → 0 errors, screenshot the render. This found and fixed the "parked boot glitch" (spurious `battery-full` on the first sample because `State.battery` defaulted to 100 %; `power.ts` now fires only on a real false→true transition).
4. **Live Tauri window (MANUAL):** `npm run tauri dev` — the only way to judge spring *feel*, pose/particle geometry, digit rolls, marquee, battery transitions. The consolidated 9-item must-eyeball list lives at the end of that E2E doc.

**Reaction harness:** run `npm run tauri dev` (or `npm run dev` in a browser) with **`?reactions=1`** — a chip row installs itself; all 26 reactions/conditions can be fired individually.

**Known caveats recorded in that report (still true):** `dnd-sleep` has no Windows Do-Not-Disturb source (harness-only); `media-loud` is folded into volume∩media-playing; `power.ts` uses the JS Battery Status API (`navigator.getBattery`, feature-detected, no-op if absent) — the deferred amendment to reuse the Rust-backed `State.battery` was **not** applied.

---

## 7. Repo map — docs you should read before coding

| File | Why |
|---|---|
| `CLAUDE.md` | The agent guide + hard rules (this is the canonical rule list) |
| `CHANGELOG.md` | Every release decision, fork rebrand notes |
| `docs/SESSION-PROMPT.md` | The paste-in up-to-speed prompt used between sessions |
| `docs/SESSION-HANDOFF-2026-10-12.md` | Full v0.4 campaign summary + 35-action animation inventory (26 custom, 9 generic) |
| `session-handoff-2026-10-11.txt` | Previous session: 0.3.4/0.3.5 work, file-by-file scope, what was explicitly out of scope |
| `docs/superpowers/specs/*.md` | Design authorities (motion polish, reactive motion, UI quality pass, v0.4) — specs are the authority, plans are step-by-step |
| `docs/superpowers/plans/*.md` | Executed implementation plans (checkboxes in the v0.4 plan were never ticked, but the work shipped — trust commit `7a9ee99` + the ledger) |
| `.superpowers/sdd/2026-10-12-notch-buddy-v0.4/progress.md` | **The execution ledger:** per-task rulings, deferred minors, F1 results |
| `docs/AGENTS.md` | Third-party agent integration protocol (event dialects, receipts, platform matrix) |
| `docs/SPEC.md`, `docs/INTEGRATIONS.md` | Behaviour/views/integrations (in French) |
| `windows/README.md` | Windows build/install/agent table, what differs from Mac, Linux notes |
| `NOTICE.md` | Files that must be replaced before distribution |
| `design/prototype/notch-buddy.html` | The visual source of truth for new work |

**Knowledge graph:** `graphify-out/` at the outer folder contains `graph.html` (interactive, 4,866 nodes / 11,166 edges / 251 communities), `GRAPH_REPORT.md`, `graph.json`, `manifest.json`. Query it with `graphify query "<question>"`. Caveats: 207 dangling-endpoint edges, 85 self-loops, 1,572 collapsed duplicate pairs (undirected build); audio (`*.wav`, `demo.mp4`) was **not** transcribed (faster-whisper not installed) — treat audio as unmodelled.

---

## 8. Known issues / deferred items (do not rediscover)

**From the v0.4 ledger (deferred minors, triaged ship-as-is):**
1. `pendingOpts.delete` after `beginReaction()` consumption (one line) not done.
2. OpenAI empty-text path leaves a dangling user message (no `chat.pop`).
3. Empty model input saved as `""` beats fallback → 400; should fall back on empty.
4. `SYSTEM_PROMPT` claims web search on providers that don't have it (brief-mandated body text).
5. `call_openai` duplicates ~25 lines of `call()` (brief-directed, accepted).
6. Pip blush ellipses can overlap folder corners; folder grips read as ink blobs on the body rather than at the edge (visual pass items).
7. `chat.ts` droppedFile clear fires even if context null (unreachable).
8. Ingest-catch race: late rejection of a prior drop can clear a newer drop's state (pre-existing race family).
9. Pomodoro/stopwatch/weather containers start left of Pip though their glyphs are centred/below (recorded, not forced).

**From the reactive-motion E2E report:**
10. `engine.busy` stays true under `prefersReduced` while a condition is held → visible loop draws a static frame (hidden CPU unaffected).
11. `island.ts` `leaveView` leaks its `animationend` listener when a view re-enters before the exit ends.
12. `hooks.ts` `peek(4000)` early-returns because `alert()`/`reveal()` already raised the island.
13. `power.ts` stop-fn race if the watch stops before `getBattery` resolves.

**Environment / tooling:**
14. `windows\target` partially corrupted: undeletable `build-script-build.exe` files (Access denied) + stale pre-move absolute paths → plain `cargo check` fails. Use a `CARGO_TARGET_DIR` off this drive, or delete `windows\target` and `windows\target-fresh` after closing anything that could lock them.
15. Git needs the `-c safe.directory=…` workaround (drive doesn't record ownership).
16. Visual pass of the whole 0.3.6 tree is **still pending** (needs a display with the app running); automated release checks and installer packaging are the repeatable gates available on this host.
17. macOS is untested end-to-end for Hermes/OpenCode paths (no Swift toolchain on this machine).
18. Installers are unsigned; SmartScreen/Defender warnings are known-accepted.

---

## 9. Open work — what to do next

1. **Commit or finish the in-flight "solo mode" work** (4 files, §3). Verify first: `npm run build`, then eyeball the session view + approval card in solo mode. Commit message style in this repo: lowercase type prefix + scope, e.g. `feat(windows): …`, `fix(mochi): …`, `chore(release): …`.
2. **Visual pass** of 0.3.6: every tab, session overlap gone, queue plays reactions back-to-back, folder hold on/off, settings provider switch — use `?reactions=1` and the 9-item eyeball list in the E2E doc.
3. **Deferred minors** in §8 — cheap one-liners; batch them in one commit if touched.
4. **Release hygiene** when shipping 0.3.6+: bump the four version files together, CHANGELOG section, README Versions row, `npm run pack` in `windows/`, move installers to `latest installer for notch buddy\`.
5. **Replace Coucou-owned assets** before any public distribution (icon, sounds, character, media) — `NOTICE.md` is the checklist.
6. Cleanup: delete damaged `windows\target` and `windows\target-fresh` when unlocked (keep `windows\target\release\coucou-hook.exe` buildable via `prebuild`).

### Verification commands (copy-paste)

```bash
# Frontend (from windows/)
npm run build                    # tsc --noEmit + vite build
node scripts/check-queue.mjs     # reaction queue logic
node scripts/test-controls.mjs   # 14 controls tests
npm run tauri dev                # live island (add ?reactions=1 for the harness)

# Rust (from windows/src-tauri/)
$env:CARGO_TARGET_DIR='C:\Users\Stanley\AppData\Local\Temp\opencode\coucou-target'  # if default target is locked
cargo check
cargo test                       # 27 tests

# UI quality detector (changed UI files)
node C:\Users\Stanley\.agents\skills\impeccable\scripts\detect.mjs --json <changed-files>
```

### Session start checklist for the next agent

1. Read `CLAUDE.md` (rules) → `docs/SESSION-PROMPT.md` → the section of this doc marked *open work*.
2. `git -c safe.directory=… status` to see in-flight changes before touching anything.
3. Run the verification commands above to establish a green baseline.
4. For UI changes: design references (`design/prototype/notch-buddy.html`, `design/captures/`) → implement in existing style → `npm run build` → impeccable detector → visual pass → CHANGELOG note if user-visible.

---

## 10. Current UI/motion-reliability planning session — 2026-10-13

The product owner approved a broader Windows UI/motion reliability pass after
reporting that the app feels underwhelming, messy, under-performing, and not
properly wired or stress-tested.

### Approved direction

- Treat the Windows/Linux app as an operate-mode desktop companion, not a generic
  web dashboard.
- Preserve Tauri 2 + Vite + vanilla TypeScript, the Canvas Pip renderer, the
  existing shell/frame loop, stable pill IDs, and approval semantics.
- Do not migrate to React or add a component library by default.
- Use native semantic HTML, existing token CSS, the current spring loop, and the
  Web Animations API/CSS before adding a dependency.
- Consider Web Awesome only for a proven focused component gap; do not adopt it
  wholesale. Fluent UI Web Components are a Windows-oriented reference, not a
  committed dependency. Material Web is rejected because its official site says
  it is in maintenance mode. Radix/Base UI/shadcn are React-based and would
  require a separate migration project.
- Browser/library research sources are recorded in:
  `docs/superpowers/plans/2026-10-13-notch-buddy-ui-motion-reliability.md`.

### New planning artifacts

- Approved design authority:
  `docs/superpowers/specs/2026-10-13-notch-buddy-ui-motion-reliability-design.md`
- Detailed execution plan:
  `docs/superpowers/plans/2026-10-13-notch-buddy-ui-motion-reliability.md`
- SDD ledger/worktree notes:
  `D:\Notch-Buddy-windows-v0.3.3-ui-motion\.superpowers\sdd\2026-10-13-notch-buddy-ui-motion-reliability\progress.md`

The detailed plan now includes product inspirations, official UI-library
references, architecture ownership, phased execution, a 35-action motion
inventory, per-surface acceptance criteria, failure taxonomy, browser/live test
matrix, and the subagent review protocol.

### Implementation state

The active original checkout is currently on `master` at commit `0a9e5d4`
(`fix(windows): restore semantic island interactions`). That commit was created
by the Task 1 implementer in the original checkout, despite the controller also
creating `D:\Notch-Buddy-windows-v0.3.3-ui-motion` as an isolated worktree.

Task 1 commit contents:

- Dashboard widgets and agent pills converted to native buttons.
- Accessible names added to many icon-only controls.
- `h()` gained safe text/attribute serialization.
- Focus/pointer affordances added.
- Existing solo mode, approval-task routing, and relay tool-name validation
  were preserved.
- `windows/scripts/test-controls.mjs` grew from 14 to 24 tests, including a
  dependency-free DOM shim for real view listeners.

The initial Task 1 review returned **Changes requested**. Its three Important
findings and the listed Minor issues were repaired in the existing uncommitted
work. A fresh scoped review then found five additional Important issues:

1. Media seeking lacked pointer dragging and optimistic rapid-keyboard state.
2. Settings integration switches were unnamed and had no synchronized state.
3. Night Light and Do Not Disturb lacked synchronized accessible state.
4. Agent status names were not bounded for long/untrusted labels.
5. The error view exposed an empty n8n action.

All five were repaired and covered by tests before production edits were kept.
The following files remain uncommitted in the original checkout:

- `.superpowers/sdd/2026-10-13-notch-buddy-ui-motion-reliability/task-1-report.md`
- `windows/scripts/test-controls.mjs`
- `windows/src/island/hooks.ts`
- `windows/src/island/island.ts`
- `windows/src/settings/main.ts`
- `windows/src/style.css`
- `windows/src/views/dom.ts`
- `windows/src/views/views.ts`

Do not discard those changes: they include the verified Task 1 follow-up fixes
and the four preserved in-flight changes.

### Current Git/environment facts

- Original checkout: `D:\Notch-Buddy-windows-v0.3.3\Notch-Buddy-windows-v0.3.3`
- Original branch: `master`
- Current committed revision: `0a9e5d4`
- Linked worktree: `D:\Notch-Buddy-windows-v0.3.3-ui-motion`
- Linked worktree branch: `fix/windows-ui-motion-reliability`
- The task runner did not reliably honor the linked worktree; check branch and
  status inside every subagent result before accepting a commit.
- `HANDOFF.md`, the new spec, and the new plan are currently untracked in the
  original checkout and must be preserved.
- `windows/target-fresh/` and `windows/target-fresh-verify/` are local build
  directories; do not commit them.

### Checks actually observed in this session

Before the Task 1 fix round, from `windows/`:

- `npm ci`: passed in the isolated worktree using the existing lockfile; npm
  warned that `esbuild` had a pending install script approval.
- `npx tsc --noEmit`: passed.
- `npx vite build`: passed.
- `node scripts/check-queue.mjs`: passed.
- `node scripts/test-controls.mjs`: passed 14/14 before Task 1; Task 1 report
  records 17/17 after its semantic-control commit.
- The Task 1 report records `npm run build` blocked by the default Rust target
  lock and a full alternate-target build passing with `CARGO_TARGET_DIR=target-fresh`.
- No browser smoke or live Tauri visual pass has been completed for this repair.
- After the follow-up repair, `node scripts/test-controls.mjs` passed **24/24**;
  `npx tsc --noEmit`, `npx vite build`, and `git diff --check` also passed.
- The UI detector still reports only the 17 pre-existing bounce/layout-transition
  warnings; no new warning was introduced by the repair.

### Historical Task 1 next step (superseded)

1. Read the detailed execution plan and this section.
2. If desired, inspect and commit the verified Task 1 changes with the plan's
   message (`fix(windows): restore semantic island interactions`); no commit was
   created in this session because the user did not explicitly request one.
3. Before Task 2, run the browser smoke/live Tauri visual pass if a display is
   available; current automated Task 1 evidence is 24/24 plus typecheck/build.
4. Do not start Task 2 until the visual gap is accepted or recorded as an
   explicit ruling; Task 1's scoped code review findings are otherwise resolved.

### Task 2 checkpoint — 2026-10-14

Task 2 is implemented in the same uncommitted working tree:

- `windows/src/core/state.ts`: timer mode/reset ownership moves into
  `State.setView()`, so rendering pomodoro/stopwatch no longer mutates state or
  creates repeated notification cycles.
- `windows/src/views/views.ts`: removes render-time timer corrections and
  changes the in-island API badge from a hardcoded red failure to truthful
  `API unavailable` with a neutral status dot.
- `windows/scripts/test-controls.mjs`: adds the Task 2 timer/provider checks.

Fresh Task 2 checks from `windows/`:

- `node scripts/test-controls.mjs` — **26/26 passed**
- `npx tsc --noEmit` — passed
- `npx vite build` — passed
- `git diff --check` — passed

The empty n8n error action is already removed and covered by the Task 1
regression test. No commit was created. Task 3's reaction/view-transition
checkpoint is recorded below; preserve the known visual verification gap and do
not add new dependencies.

### Task 3 checkpoint — 2026-10-14

Task 3 is implemented in the same uncommitted working tree:

- `windows/src/mochi/reactions.ts`: consumes `pendingOpts` at dequeue time so
  reaction options cannot survive into a later entry.
- `windows/src/island/island.ts`: cancels exit handlers on re-entry, handles
  `animationcancel`, and has a bounded fallback timer for missing
  `animationend` events.
- `windows/src/style.css`: replaces the global reduced-motion `0.01ms` kill
  switch with an explicit list of movement/decorative surfaces while preserving
  state and selection feedback.
- `windows/scripts/check-queue.mjs`: adds regression assertions for option
  ownership, exit cleanup, and reduced-motion scope.

Fresh Task 3 checks from `windows/`:

- `node scripts/check-queue.mjs` — `queue checks OK`
- `node scripts/test-controls.mjs` — **26/26 passed**
- `npx tsc --noEmit` — passed
- `npx vite build` — passed
- `git diff --check` — passed
- UI detector — same 17 pre-existing bounce/layout-transition warnings; no new
  warning from the Task 3 rules.

No commit was created. The Task 4 layout checkpoint follows; the browser
smoke/live Tauri visual pass remains the main unobserved acceptance gap.

### Task 4 checkpoint — 2026-10-14

Task 4 is implemented in the same uncommitted working tree:

- `windows/src/core/layout.ts`: adds the layout-owned `PIP_SAFE_INSET = 120`.
- `windows/src/views/views.ts`: applies the shared inset to ordinary cards and
  exposes it to session content through `--pip-safe-inset`.
- `windows/src/style.css`: uses the shared session inset and adds a non-layout-
  shifting active background state for dashboard widgets.
- `windows/scripts/test-controls.mjs`: adds deterministic representative layout
  fixtures for Pip clearance and widget interaction styling.

Fresh Task 4 checks from `windows/`:

- `node scripts/test-controls.mjs` — **27/27 passed**
- `npx tsc --noEmit` — passed
- `npx vite build` — passed
- `git diff --check` — passed
- UI detector — same pre-existing bounce/layout-transition warnings; no new
  Task 4 warning.

No commit was created. The next plan item is **Task 5: browser and live-surface
verification**. The remaining acceptance gap is runtime visual evidence in the
browser fallback and live Tauri window.

### Task 5 checkpoint — 2026-10-14 (partial)

The existing Vite fallback was started on `127.0.0.1:1420` and then stopped
after verification. The built-in browser controller timed out twice and exposed
no tab, so no pointer/keyboard click sequence or console-error capture was
claimed.

Headless Chrome did render the fallback DOM for
`http://127.0.0.1:1420/?reactions=1`:

- `dom-bytes=107174`
- `has-app-root=True`
- `reaction-chips=24`
- `dashboard-widgets=6`
- `named-slider-controls=3`

This confirms boot-time DOM construction and harness installation only. The
following remain **not observed**: clicking every reaction chip, browser
console-error cleanliness, group/widget/session navigation, focus traversal,
upload cancellation, and all live Tauri visual checks. The next concrete action
is to rerun the browser smoke path when a browser tab can be controlled, then
run `npm run tauri dev` for the nine-item live checklist.

### Full test matrix checkpoint — 2026-10-14

A full executable test/build pass was run after the Task 4 changes. One real
contract regression was found and fixed before the final rerun:

- `windows/src/core/agents.ts`: OpenCode was incorrectly marked
  `allowsApproval: true`; it is now `false`, preserving OpenCode's permanent
  display-only approval semantics.

#### Windows frontend tests

- `node scripts/test-controls.mjs` — **27/27 passed**
- `node scripts/check-queue.mjs` — `queue checks OK`
- `node --experimental-strip-types src/core/spring.test.mjs` — passed
- `node --experimental-strip-types src/core/anim.test.mjs` — passed
- `node --experimental-strip-types src/core/agents.test.mjs` — passed after the
  OpenCode metadata fix

#### Windows typecheck/build

- `npx tsc --noEmit` — passed
- `npx vite build` — passed
- `npm run build` — passed, including the release `coucou-hook` build,
  TypeScript, and Vite bundle

#### Rust workspace

- `$env:CARGO_TARGET_DIR='C:\Users\Stanley\AppData\Local\Temp\omnirush\notch-buddy-full-cargo'; cargo check --workspace` — passed
- Same target: `cargo test --workspace` — **36 passed, 0 failed**
  - `coucou_lib`: 27 passed
  - `coucou_hook`: 9 passed

#### Relay and documentation checks

- `relay/npm ci` — installed 36 packages; npm reported pending install-script
  approval for `esbuild` and `workerd`
- `relay/npm run typecheck` — passed
- `scripts/test-hook-relay-dialect.sh` via Git Bash — passed for both embedded
  macOS relay variants
- `scripts/test-agent-docs.sh` via Git Bash — `agent contract docs OK`
- `scripts/test-agent-dialect.sh` — **not runnable**: `swiftc` is unavailable on
  this Windows host

#### Static/UI checks

- UI detector on changed layout/agent/state/island/reaction/view/style files —
  only the known pre-existing bounce/layout-transition warnings
- `git diff --check` — passed

The browser/Tauri visual gap remains unchanged: headless DOM construction was
observed previously, but browser click/console automation and live Tauri visual
behavior were not observed. No commit was created.
