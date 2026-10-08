# Agent integration test matrix

Run every row with Notch-Buddy open, then repeat the two "Notch-Buddy closed" rows. A row is
only green when the observable column is literally what you saw.

The **Status** column records what the 2026-10-08 live test on Windows actually proved.
**verified** = observed; **needs-human** = requires a click in a running GUI and has not been done;
**planned** = not yet run. Never treat a *planned* or *needs-human* row as working.

## Automated (run on every PR)

| Check | Command | Expected |
|---|---|---|
| Contract docs | `bash scripts/test-agent-docs.sh` | `agent contract docs OK` |
| Agent dialect + plugin tokens | `bash scripts/test-agent-dialect.sh` | `AgentDialect tests passed` + `opencode plugin tokens OK` |
| macOS relay dialects | `bash scripts/test-hook-relay-dialect.sh` | `relay dialect OK` |
| Rust relay | `cd windows/hook && cargo test` | all pass |
| Rust Tauri installers | `cd windows/src-tauri && cargo test` | all pass |
| Windows front-end | `cd windows && npm run build` | clean |
| Windows agent metadata | `node --experimental-strip-types src/core/agents.test.mjs` | `agents metadata OK` |
| macOS app | `cd NotchBuddy && xcodegen && xcodebuild -scheme NotchBuddy -configuration Debug build` | BUILD SUCCEEDED |
| Existing suite | every `scripts/test-*.sh` | all pass |

## Manual — Hermes

| # | Do | Expect | Status |
|---|---|---|---|
These rows were verified on Windows 2026-10-08 against Hermes Agent v0.21.5 and the built relay. Status: **verified** = observed; **needs-human** = requires a click in a running GUI; **planned** = not yet run. Never treat a *planned* or *needs-human* row as working.

### Windows — verified 2026-10-08  

Hermes Agent v0.21.5; `hermes config path` → `%LOCALAPPDATA%\hermes\config.yaml`; OpenCode v1.18.35.

| # | Do | Expect | Status |
|---|---|---|---|
| 1 | `hermes config path` | `%LOCALAPPDATA%\hermes\config.yaml` (not `~/.hermes`) | **verified** (Windows) |
| 2 | built `coucou-hook.exe --agent hermes pre_tool_call` with a synthetic payload | relay prints `{}` for allow, `{"action":"block","message":"Denied from Coucou"}` for deny, a block receipt for no-answer, and nothing when Coucou is unreachable | **verified** (headless) |
| 3 | Rust relay test `hermes_event_names_are_translated_to_canonical_ones` | `pre_tool_call` → `PermissionRequest`, `on_session_start` → `SessionStart`, `on_session_end` → `SessionEnd`, `subagent_start` → `SubagentStart`, `subagent_stop` → `SubagentStop`, `post_llm_call` → `Stop` | **verified** |
| 4 | Rust Tauri test `the_hermes_config_lives_where_hermes_says_it_does` | Windows path contains no `.hermes` segment; matches `%LOCALAPPDATA%\hermes\config.yaml`; `$HERMES_HOME` wins | **verified** |
| 5 | Rust Tauri test `a_hermes_install_uninstall_cycle_leaves_the_users_file_untouched` | install → install → uninstall returns the original file byte-for-byte | **verified** |
| 6 | `scripts/test-agent-docs.sh` | `agent contract docs OK`; seven Hermes events present in the generated block; `fail_closed` absent | **verified** |
| 7 | `scripts/test-hook-relay-dialect.sh` | `relay dialect OK (both relays)`; macOS relay emits the same Hermes receipts as the Rust relay | **verified** |
| 8 | `cd windows/hook && cargo test` | 9/9 pass, including the Hermes dialect and event-mapping tests | **verified** |
| 9 | `cd windows/src-tauri && cargo test` | 17/17 pass, including the Hermes home-resolution and install/uninstall round-trip tests | **verified** |
| 10 | `cd windows && npm run build` + `node --experimental-strip-types src/core/agents.test.mjs` | clean build; `agents metadata OK` | **verified** |

### Windows — manual (GUI or live session)

| # | Do | Expect | Status |
|---|---|---|---|
| A1 | Settings → Hermes → Install hooks, read the diff, confirm | the Hermes config (`hermes config path`) gains the marker block with **seven** events; a `.bak-*` file appears | **needs-human** |
| A2 | After install, `hermes hooks list` | all **seven** entries listed, each with the **Windows** exe path, each `✗ not allowlisted` | **needs-human** (headless verdict: would pass) |
| A3 | Start a Hermes session in a test repo | `agent_hermes` pill appears, coloured `#A78BFA` | **planned** (live) |
| A4 | Ask Hermes to run a shell command | **approval card appears** with the command text | **planned** (live) |
| A5 | Click **Allow** | Hermes runs the command, card clears, state returns to `working` | **planned** (live) |
| A6 | Ask for another shell command, click **Deny** | Hermes reports a blocked tool; the command does not run | **planned** (live) |
| A7 | Ask for another shell command, click nothing for ~115 s | card clears, Hermes reports the tool blocked, **not** run | **planned** (live) |
| A8 | Quit Notch-Buddy, run a shell command in Hermes | command runs normally; no delay, no error, no hook output | **verified** (headless) |
| A9 | Settings → Hermes → Uninstall, confirm | config.yaml is byte-identical to before install | **planned** (GUI; unit test verified) |
| A10 | Set a foreign top-level `hooks:` key in config.yaml, then Install | Notch-Buddy refuses and prints the block to paste; file untouched | **planned** |

### OpenCode — Windows (verified headless where marked)

| # | Do | Expect | Status |
|---|---|---|---|
| O1 | `scripts/test-agent-docs.sh` asserts the generated plugin tokens | `process.platform === 'win32'`, `coucou-hook.exe`, `--agent', 'opencode'`, `coucou_agent: 'opencode'`, `session.diff` in EVENT_MAP | **verified** |
| O2 | built `coucou-hook.exe --agent opencode session.created` with a synthetic payload | relay forwards it; OpenCode dialect returns `{}` for every decision | **verified** (headless) |
| O3 | Install the plugin through Settings → OpenCode Plugin → Install | `~/.config/opencode/plugins/coucou.js` written; `.bak-*` sibling if one existed | **planned** (GUI) |
| O4 | Start OpenCode in a test repo with Coucou running | `agent_opencode` pill appears, coloured `#4ADE80` | **planned** (live) |
| O5 | Ask OpenCode to read a file, then edit one | ticker steps appear; pill never sticks in `approval` | **planned** (live) |
| O6 | Trigger a permission prompt in OpenCode | pill enters question state, ticker reads `Allow <tool>?`, **no Allow/Deny card** — display-only | **planned** (live) |
| O7 | Answer in the OpenCode terminal | pill returns to `working` | **planned** (live) |
| O8 | Quit Notch-Buddy, use OpenCode normally | nothing slows down, no errors in OpenCode's log | **planned** (live; headless verdict: would pass) |
| O9 | Settings → OpenCode → Uninstall | the file is deleted; a `.bak-*` sibling exists | **planned** (GUI) |
| O10 | Hand-write a foreign plugin at that path, then Uninstall | Notch-Buddy refuses: "was not generated by Coucou" | **planned** (GUI; unit test verified) |

## Manual — OpenCode

| # | Do | Expect | Status |
|---|---|---|---|
| 1 | Settings → OpenCode Plugin → Install, read the diff, confirm | `~/.config/opencode/plugins/coucou.js` written | planned (GUI) |
| 2 | Start OpenCode in a test repo | `agent_opencode` pill appears, coloured `#4ADE80` | planned (live) |
| 3 | Ask OpenCode to read a file, then edit one | ticker steps appear; the pill never sticks in `approval` | planned (live) |
| 4 | Trigger a permission prompt in OpenCode | pill goes to the question state, ticker reads `Allow <tool>?`, **no Allow/Deny card** | partly verified (maps to `Notification`, message shape — headless); GUI planned |
| 5 | Answer in the OpenCode terminal | pill returns to `working` | planned (live) |
| 6 | Quit Notch-Buddy, use OpenCode normally | nothing slows down, no errors in OpenCode's log | planned (live) |
| 7 | Uninstall from Settings | the file is deleted; a `coucou.js.bak-*` sibling exists | planned (GUI) |
| 8 | Hand-write a plugin at that path, then Uninstall | Notch-Buddy refuses: "was not generated by Notch-Buddy" | planned (GUI) |

## Manual — Windows and Linux

### Windows — verified 2026-10-08 against Hermes Agent v0.21.5 and the built relay

| # | Do | Expect | Status |
|---|---|---|---|
| 1 | `npm run pack` (where the NSIS step produces an installer) | build completes; the packaged `coucou-hook.exe` is the one tested above | **planned** (installer) |
| 2 | Install the produced installer, launch Coucou | `%LOCALAPPDATA%\coucou\bin\coucou-hook.exe` exists and is the built binary | **planned** (installer) |
| 3 | After install, Settings → Hermes → Install hooks | `%LOCALAPPDATA%\hermes\config.yaml` gains the block with a **Windows** exe path — **not** `%USERPROFILE%\.hermes`; `.bak-*` appears | **needs-human** |
| 4 | After install, `hermes hooks list` | all **seven** entries, each with the **Windows** exe path, each `✗ not allowlisted` | **verified** (hand-appended block; app installer planned) |
| 5 | Approve at session startup with `HERMES_ACCEPT_HOOKS=1`, run a tool | `agent_hermes` pill appears with the **same colour** as macOS | **planned** (live) |
| 6 | Approve from the island | the tool runs; no Git Bash quoting error | **needs-human** |
| 7 | Deny from the island | the tool is blocked | **needs-human** (relay half verified) |
| 8 | Quit Notch-Buddy, run a Hermes tool | tool runs, unaffected | **verified** (headless) |
| 9 | OpenCode plugin install, then use OpenCode | pill appears, `coucou-hook.exe` is spawned directly (no `/bin/sh`) | partly verified (spawn headless); live planned |
| 10 | `cargo test` in `windows/hook` and `windows/src-tauri` | all pass (9 and 17 respectively) | **verified** |
