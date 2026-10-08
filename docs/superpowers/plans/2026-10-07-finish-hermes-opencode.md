# Finish Hermes + OpenCode on Windows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the Hermes and OpenCode integrations from "compiles and unit-tests green" to "verified working end to end on Windows", and close the two real bugs that live testing has just exposed.

**Architecture:** Unchanged. Each agent's native events are translated into Coucou's canonical payload by the relay, and installed by a marker-scoped config writer. This plan fixes where those writers point, adds the events they missed, and proves the whole path with a real Hermes and a real OpenCode.

**Tech Stack:** Rust (Tauri backend + `coucou-hook` relay), TypeScript (front-end), Python 3 (macOS relay), Hermes Agent v0.21.5, OpenCode v1.18.35.

**Spec:** `docs/AGENT_COMPATIBILITY_PLAN.md`
**Prior plan (all 13 tasks complete):** `docs/superpowers/plans/2026-10-07-agent-compat-hermes-opencode.md`

## Global Constraints

- **Never block the agent.** A closed Coucou must never block, delay or error the user's agent.
- **Never overwrite user config.** Dated backup, preview, fingerprint, write only what the user confirmed.
- **Never rewrite upstream history** and never reattribute the original author. See `NOTICE.md`.
- Do not rename build artifacts or on-disk identifiers (`Coucou.app`, `fr.louisraille.NotchBuddy`, `nb.sock`, `coucou-hook`).
- Windows hook commands run through **Git Bash**.
- **Ponytail is active**: shortest working diff, reuse before writing, no new dependency.
- The Hermes receipts stay byte-identical across platforms: `{}` allow, `{"action":"block","message":"Denied from Coucou"}` deny, the no-answer block.

---

## Verified Ground Truth (read this before changing anything)

Measured against the **installed** Hermes and OpenCode on this machine on 2026-10-07, not from docs.

### Hermes Agent v0.21.5

```
hermes --version  → Hermes Agent v0.21.5+8828.gcb6ffe6 (2026.9.24)
install dir       → C:\Users\Stanley\AppData\Local\hermes\hermes-agent   (method: git)
hermes config path → C:\Users\Stanley\AppData\Local\hermes\config.yaml
```

| Fact | Value | Source |
|---|---|---|
| **Windows home** | `%LOCALAPPDATA%\hermes` | `hermes config path` |
| **POSIX home** | `~/.hermes` | `hermes hooks --help` |
| Config | `<home>/config.yaml` | `hermes config path` |
| Consent allowlist | `<home>/shell-hooks-allowlist.json` | `hermes hooks --help` |
| Override | `HERMES_HOME` env var | `hermes_constants.py` |
| Max `timeout` | **300 s**, silently truncated | `shell_hooks.py: MAX_TIMEOUT_SECONDS` |
| **Blocking-capable events** | **only `pre_tool_call`** | `shell_hooks.py: _BLOCKING_EVENTS` |
| Shell-unsupported | only `transform_api_error_classification` | `plugins.py: SHELL_UNSUPPORTED_HOOKS` |
| Block exit code | `2` | `shell_hooks.py: BLOCK_EXIT_CODE` |

**Valid events** (`plugins.py: VALID_HOOKS`) — the ones this plan cares about:

```
pre_tool_call, post_tool_call, pre_llm_call, post_llm_call,
on_session_start, on_session_end, on_session_finalize, on_session_reset,
subagent_start, subagent_stop, pre_verify, on_skill_lifecycle, pre_gateway_dispatch
```

**stdin payload** (`shell_hooks.py: _payload_fields`) — note `args` is renamed to `tool_input` on the wire:

```json
{
  "hook_event_name": "pre_tool_call",
  "tool_name": "terminal",
  "tool_input": { "command": "rm -rf /" },
  "session_id": "sess_abc123",
  "cwd": "/home/user/project",
  "profile": "default",
  "extra": {}
}
```

**stdout receipts** (`shell_hooks.py: _parse_response`) — both dialects are accepted:

```
{"action":"block","message":"..."}      ← what Coucou sends
{"decision":"block","reason":"..."}     ← Claude Code dialect, also accepted
{"action":"modify","args":{...}}
{"action":"approve"}
{"context":"..."}                        ← pre_llm_call only
{}                                       ← no-op
```

### OpenCode v1.18.35

```
opencode --version → 1.18.35
config dir         → ~/.config/opencode/        (exists)
plugin dir         → ~/.config/opencode/plugins/ (does NOT exist yet — nothing installed)
```

---

## The Two Bugs Live Testing Found

**Bug 1 (Critical) — the Windows installer writes the hooks to a file Hermes never reads.**
`windows/src-tauri/src/agents.rs` resolves the Hermes config as `platform::home_dir().join(".hermes/config.yaml")`
→ `C:\Users\Stanley\.hermes\config.yaml`.
The installed Hermes reads `C:\Users\Stanley\AppData\Local\hermes\config.yaml`.
`~/.hermes` does not even exist on this machine. **Hermes would never see Coucou's hooks on Windows** — the
installer would report success and nothing would happen.

**Bug 2 (Important) — session and subagent events are missing.**
The generated block wires only `pre_llm_call`, `pre_tool_call`, `post_tool_call`. Hermes also has
`on_session_start`, `on_session_end`, `subagent_start` and `subagent_stop`, all shell-supported. Without them
a Hermes session never emits `SessionStart` or `SessionEnd`, so the pill is never created cleanly and never
cleaned up, and subagent steps never reach the ticker. Claude Code gets all four.

---

# Task 1: Resolve the Hermes home the way Hermes does

Fixes Bug 1. Both platforms, one function, fully testable.

**Files:**
- Modify: `windows/src-tauri/src/agents.rs`
- Modify: `NotchBuddy/Sources/CoucouKit/AgentDialect.swift` (the macOS path helper)
- Test: the `#[cfg(test)] mod tests` in `agents.rs`

**Interfaces:**
- Produces: `pub fn hermes_home() -> PathBuf` and `pub fn hermes_config_path() -> PathBuf`
- Produces: `pub fn hermes_allowlist_path() -> PathBuf` (needed by Task 5's docs and the manual test)

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `windows/src-tauri/src/agents.rs`:

```rust
    #[test]
    fn the_hermes_config_lives_where_hermes_says_it_does() {
        // Hermes resolves its home as: $HERMES_HOME, else %LOCALAPPDATA%\hermes on
        // Windows, else ~/.hermes. Writing anywhere else means the installer reports
        // success and Hermes never loads the hook. Verified against the real install:
        //   $ hermes config path
        //   C:\Users\Stanley\AppData\Local\hermes\config.yaml
        std::env::remove_var("HERMES_HOME");
        let p = hermes_config_path();

        if cfg!(windows) {
            let local = std::env::var("LOCALAPPDATA").expect("LOCALAPPDATA is set on Windows");
            let want = PathBuf::from(local).join("hermes").join("config.yaml");
            assert_eq!(p, want, "must match `hermes config path`");
            // The old bug: a `.hermes` segment under the user profile.
            assert!(
                !p.to_string_lossy().contains(".hermes"),
                "the Windows home has no .hermes segment — got {p:?}"
            );
        } else {
            assert!(p.ends_with(".hermes/config.yaml"), "got {p:?}");
        }

        // $HERMES_HOME wins, and the allowlist sits beside the config.
        std::env::set_var("HERMES_HOME", r"C:\tmp\hermes-test");
        assert_eq!(hermes_config_path(), PathBuf::from(r"C:\tmp\hermes-test").join("config.yaml"));
        assert_eq!(hermes_allowlist_path(), PathBuf::from(r"C:\tmp\hermes-test").join("shell-hooks-allowlist.json"));
        std::env::remove_var("HERMES_HOME");
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd windows/src-tauri && cargo test agents::the_hermes_config_lives`
Expected: FAIL to compile — `cannot find function 'hermes_config_path'` (or, if it resolves, the Windows assertion fails because the path contains `.hermes`).

- [ ] **Step 3: Implement the resolution**

In `windows/src-tauri/src/agents.rs`, replace the existing `hermes_config_path` with:

```rust
/// Hermes' home directory, resolved the way Hermes resolves it.
///
/// `$HERMES_HOME` wins. Otherwise Windows uses `%LOCALAPPDATA%\hermes` — **not**
/// `~/.hermes`, which is the POSIX default and does not exist on a Windows install.
/// Getting this wrong is silent: the installer reports success, and Hermes never
/// loads the hook. Verified with `hermes config path`, which prints
/// `C:\Users\<user>\AppData\Local\hermes\config.yaml` on this machine.
pub fn hermes_home() -> PathBuf {
    if let Some(home) = std::env::var_os("HERMES_HOME") {
        if !home.is_empty() {
            return PathBuf::from(home);
        }
    }
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            if !local.is_empty() {
                return PathBuf::from(local).join("hermes");
            }
        }
    }
    platform::home_dir().join(".hermes")
}

pub fn hermes_config_path() -> PathBuf {
    hermes_home().join("config.yaml")
}

/// The consent allowlist Hermes keeps beside its config. Coucou does not write it —
/// the user approves each hook — but the docs and the manual test need the path.
pub fn hermes_allowlist_path() -> PathBuf {
    hermes_home().join("shell-hooks-allowlist.json")
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd windows/src-tauri && cargo test agents::`
Expected: PASS — 8 tests, including the new one.

- [ ] **Step 5: Fix the macOS side to match**

The macOS default (`~/.hermes`) is correct, but it should honour `HERMES_HOME` too, and it should say so. In `NotchBuddy/Sources/CoucouKit/AgentDialect.swift`, replace the `hermesConfigURL` computation in `HookServer.swift` (Task 5 of the prior plan added it) with a helper that reads `HERMES_HOME` first:

```swift
    static var hermesConfigURL: URL {
        // $HERMES_HOME wins; ~/.hermes is the POSIX default. Windows uses
        // %LOCALAPPDATA%\hermes instead — see agents.rs there.
        if let home = ProcessInfo.processInfo.environment["HERMES_HOME"], !home.isEmpty {
            return URL(fileURLWithPath: home).appendingPathComponent("config.yaml")
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hermes/config.yaml")
    }
```

- [ ] **Step 6: Commit**

```bash
git add windows/src-tauri/src/agents.rs NotchBuddy/Sources/App/HookServer.swift
git commit -m "fix(hermes): resolve the Hermes home the way Hermes does

The Windows installer wrote ~/.hermes/config.yaml, but a Windows Hermes reads
%LOCALAPPDATA%\\hermes\\config.yaml — verified with \`hermes config path\`. The
installer reported success and Hermes never loaded the hook. Now resolves
HERMES_HOME first, then the platform default, and the tests pin it."
```

---

# Task 2: Wire the session and subagent events

Fixes Bug 2.

**Files:**
- Modify: `windows/src-tauri/src/agents.rs` (`hermes_config_block`, `canonical_event` lives in `windows/hook/src/main.rs`)
- Modify: `windows/hook/src/main.rs` (`canonical_event`)
- Modify: `NotchBuddy/Sources/CoucouKit/AgentDialect.swift` (`hermesConfigBlock`, and the Python relay's `normalize_event`)
- Test: both Rust test modules + `tests/test_relay_dialect.py`

**Interfaces:**
- Consumes: `hermes_config_block(hook_command)` from the prior plan.
- Produces: a block with **seven** entries, and a `canonical_event` that maps all of them.

- [ ] **Step 1: Write the failing tests**

In `windows/hook/src/main.rs`, extend `hermes_event_names_are_translated_to_canonical_ones`:

```rust
        // Session and subagent lifecycle, so a Hermes session behaves like a Claude one.
        assert_eq!(canonical_event(Dialect::Hermes, "on_session_start"), "SessionStart");
        assert_eq!(canonical_event(Dialect::Hermes, "on_session_end"), "SessionEnd");
        assert_eq!(canonical_event(Dialect::Hermes, "subagent_start"), "SubagentStart");
        assert_eq!(canonical_event(Dialect::Hermes, "subagent_stop"), "SubagentStop");
        assert_eq!(canonical_event(Dialect::Hermes, "post_llm_call"), "Stop");
```

In `windows/src-tauri/src/agents.rs`, extend `the_hermes_block_is_marker_scoped_and_never_fail_closed`:

```rust
        for event in ["pre_llm_call", "pre_tool_call", "post_tool_call",
                      "on_session_start", "on_session_end", "subagent_start", "subagent_stop"] {
            assert!(block.contains(&format!("{event}:")), "the block must declare {event}");
        }
        // Only pre_tool_call may carry a matcher or a long timeout: Hermes honours a
        // block directive on that event alone (shell_hooks.py: _BLOCKING_EVENTS).
        assert_eq!(block.matches("matcher:").count(), 1, "exactly one matcher, on pre_tool_call");
        assert_eq!(block.matches("timeout: 130").count(), 1, "only the gate waits");
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd windows/hook && cargo test` then `cd windows/src-tauri && cargo test agents::`
Expected: FAIL — unknown events map to themselves, and the block has only three entries.

- [ ] **Step 3: Extend the relay's mapping**

In `windows/hook/src/main.rs`, extend `canonical_event`:

```rust
    match raw {
        "pre_llm_call" => "UserPromptSubmit",
        // Hermes has no permission event; its pre_tool_call is the only hook that can
        // block, so for the tools the matcher selects it *is* the gate.
        "pre_tool_call" => "PermissionRequest",
        "post_tool_call" => "PostToolUse",
        // Lifecycle. Without these the pill is never created cleanly and never removed.
        "on_session_start" => "SessionStart",
        "on_session_end" => "SessionEnd",
        "subagent_start" => "SubagentStart",
        "subagent_stop" => "SubagentStop",
        // post_llm_call ends a turn; Hermes has no separate Stop event.
        "post_llm_call" => "Stop",
        other => other,
    }
```

- [ ] **Step 4: Extend the generated block (Rust)**

In `hermes_config_block`, add the four new entries. `timeout: 10` for all of them — they are observers, and Hermes caps at 300 s anyway:

```rust
         \x20 on_session_start:\n\
         \x20   - command: '{hook_command} on_session_start'\n\
         \x20     timeout: 10\n\
         \x20 on_session_end:\n\
         \x20   - command: '{hook_command} on_session_end'\n\
         \x20     timeout: 10\n\
         \x20 subagent_start:\n\
         \x20   - command: '{hook_command} subagent_start'\n\
         \x20     timeout: 10\n\
         \x20 subagent_stop:\n\
         \x20   - command: '{hook_command} subagent_stop'\n\
         \x20     timeout: 10\n\
```

- [ ] **Step 5: Mirror it in Swift and in the Python relay**

Same seven entries in `AgentDialect.hermesConfigBlock` (Task 5 of the prior plan), and the same mapping added to `normalize_event` in **both** embedded relays in `HookServer.swift`. Extend `tests/test_relay_dialect.py` with the four new mappings so deleting them fails the test.

- [ ] **Step 6: Run everything**

Run:
```bash
cd windows/hook && cargo test
cd windows/src-tauri && cargo test
cd windows && npm run build
awk '/^private let nbHookPythonGitHub = """/{f=1;next} f&&/^"""/{exit} f' ../../NotchBuddy/Sources/App/HookServer.swift > /tmp/github.py
python3 tests/test_relay_dialect.py /tmp/github.py
```
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add windows/hook/src/main.rs windows/src-tauri/src/agents.rs \
        NotchBuddy/Sources/App/HookServer.swift NotchBuddy/Sources/CoucouKit/AgentDialect.swift \
        tests/test_relay_dialect.py
git commit -m "feat(hermes): wire session and subagent lifecycle events"
```

---

# Task 3: Install Hermes into the real profile and prove the hook fires

The first genuinely end-to-end test. No code changes unless it finds something.

**Files:**
- No source changes expected. Findings go in the report.

**Interfaces:**
- Consumes: the built binaries from the prior plan (`windows/target/release/coucou-hook.exe`).

- [ ] **Step 1: Back up the real config**

The user's Hermes config is 128 KB and load-bearing. Back it up before touching it.

```bash
cp "$LOCALAPPDATA/hermes/config.yaml" "$LOCALAPPDATA/hermes/config.yaml.pre-coucou"
wc -c "$LOCALAPPDATA/hermes/config.yaml"
```

- [ ] **Step 2: Generate the block and append it by hand**

Do **not** use the app for the first attempt — hand-editing isolates a bad block from a bad installer.

```bash
mkdir -p ~/.hermes/agent-hooks   # only if the docs' example path is wanted; not required
python3 - <<'PY'
import os, pathlib
local = os.environ["LOCALAPPDATA"]
cfg = pathlib.Path(local) / "hermes" / "config.yaml"
exe = r"C:\Users\Stanley\Downloads\coucou\windows\target\release\coucou-hook.exe"
block = f"""# coucou:begin — managed by Coucou
hooks:
  pre_llm_call:
    - command: '"{exe}" --agent hermes pre_llm_call'
      timeout: 10
  pre_tool_call:
    - matcher: "terminal|write_file|patch"
      command: '"{exe}" --agent hermes pre_tool_call'
      timeout: 130
  post_tool_call:
    - command: '"{exe}" --agent hermes post_tool_call'
      timeout: 10
  on_session_start:
    - command: '"{exe}" --agent hermes on_session_start'
      timeout: 10
  on_session_end:
    - command: '"{exe}" --agent hermes on_session_end'
      timeout: 10
  subagent_start:
    - command: '"{exe}" --agent hermes subagent_start'
      timeout: 10
  subagent_stop:
    - command: '"{exe}" --agent hermes subagent_stop'
      timeout: 10
# coucou:end
"""
t = cfg.read_text(encoding="utf-8")
assert "# coucou:begin" not in t, "block already present"
cfg.write_text(t.rstrip("\n") + "\n\n" + block, encoding="utf-8")
print("appended the block")
PY
```

- [ ] **Step 3: Ask Hermes whether it can see them — this is the real gate**

```bash
export PATH="$LOCALAPPDATA/hermes/bin:$PATH"
hermes hooks list
```
Expected: **seven entries**, each showing its matcher/timeout and `✗ not allowlisted`.

If it prints `No shell hooks or outbound webhooks configured`, the block is in the wrong file or malformed — that is Bug 1 recurring, and it is the single most likely failure. Do not proceed until it lists seven.

- [ ] **Step 4: Check the block parses and the script is executable**

```bash
hermes hooks doctor
```
Expected: each hook reports `✓ script exists and is executable` and `✗ not allowlisted`. Record the exact output.

- [ ] **Step 5: Approve the hooks**

```bash
hermes --accept-hooks chat --help >/dev/null 2>&1 || true
```
If `--accept-hooks` needs a real session, set the non-interactive path instead and note which was used:
```bash
export HERMES_ACCEPT_HOOKS=1
```
Then re-run `hermes hooks list` and confirm the `✗ not allowlisted` markers are gone.

- [ ] **Step 6: Fire a synthetic event — proves the relay runs and answers**

```bash
hermes hooks test pre_tool_call --for-tool terminal
```
Expected: the hook fires, `exit=0`, and the parsed receipt is shown. With Coucou **closed**, the receipt must be empty (fail-open) — that is the hard rule. Record the exact output.

- [ ] **Step 7: Report**

Write findings to `.superpowers/rebrand/hermes-live-test.md`: the exact `hooks list` output, the `doctor` output, the `test` output, and any deviation from the expected above.

---

# Task 4: Prove the Hermes approval path end to end

The test that has never been run: does **Deny** actually block a tool?

**Files:**
- No source changes expected.

- [ ] **Step 1: Start Coucou**

Run the built app: `windows/target/release/coucou.exe`. Confirm the island appears and `agent_hermes` is a selectable pill in Settings → Active pills.

- [ ] **Step 2: Deny a tool and confirm it blocks**

With Coucou running and the hooks approved, ask Hermes to run a shell command. Expected: the island shows an Allow/Deny card naming the command. Click **Deny**. Expected: Hermes reports the tool as blocked and does **not** run it.

This is the single most important assertion in this plan. If Deny does not block, the Hermes integration is cosmetic and must be documented as such.

- [ ] **Step 3: Allow a tool and confirm it runs**

Same flow, click **Allow**. Expected: the tool runs, the card clears, the pill returns to `working`.

- [ ] **Step 4: Let the timeout fire**

Trigger a third command and click nothing for ~115 s. Expected: the card clears, Hermes reports the tool **blocked**, and the relay's no-answer receipt is what did it. It must **not** silently run.

- [ ] **Step 5: Confirm a closed Coucou is invisible**

Quit Coucou entirely. Run a Hermes shell command. Expected: it runs normally, with no delay, no error, and no output from the hook. This is the hard rule.

- [ ] **Step 6: Confirm lifecycle and the ticker**

Start a Hermes session in a test repo. Expected: `agent_hermes` pill appears (colour `#A78BFA`), the prompt shows in the ticker, tool steps appear, and the pill clears on session end.

- [ ] **Step 7: Record every result**

Append to `.superpowers/rebrand/hermes-live-test.md`, one row per step with the observed result. **Any step that does not match is a bug report, not a note.**

---

# Task 5: Prove OpenCode on Windows

**Files:**
- No source changes expected.

- [ ] **Step 1: Install the plugin through the app**

Settings → OpenCode → Install…, read the diff, confirm. Expected: `~/.config/opencode/plugins/coucou.js` is created, and a `.bak-*` sibling appears if one already existed.

- [ ] **Step 2: Confirm the file is Windows-correct**

```bash
grep -n "process.platform === 'win32'" ~/.config/opencode/plugins/coucou.js
grep -n "session.diff" ~/.config/opencode/plugins/coucou.js
grep -c "coucou_agent: 'opencode'" ~/.config/opencode/plugins/coucou.js
```
Expected: the Windows branch present, `session.diff` in `EVENT_MAP`, the agent tag present.

- [ ] **Step 3: Run OpenCode and watch the island**

Start OpenCode in a test repo with Coucou running. Expected: `agent_opencode` pill appears, colour `#4ADE80`, ticker steps on tool use, and file diffs on `session.diff`.

- [ ] **Step 4: Confirm OpenCode permissions are display-only and honest**

Trigger a permission prompt. Expected: the pill enters its question state, the ticker reads `Allow <tool>?`, and **no Allow/Deny card appears** — OpenCode's plugin API cannot return a decision. Answer in OpenCode's terminal.

- [ ] **Step 5: Confirm OpenCode is not slowed or broken by a closed Coucou**

Quit Coucou. Use OpenCode normally. Expected: nothing blocks, nothing errors, no stray processes.

- [ ] **Step 6: Uninstall round-trip**

Settings → OpenCode → Uninstall. Expected: the file is deleted, the backup exists, and a hand-written foreign file at that path would be **refused** rather than deleted.

- [ ] **Step 7: Record results**

Append to `.superpowers/rebrand/opencode-live-test.md`.

---

# Task 6: Build the Windows installer

**Files:**
- No source changes expected.

- [ ] **Step 1: Build**

```bash
cd windows && npm run pack
```
Expected: the AppImage/deb/rpm step is Linux-only; on Windows this produces an NSIS installer in `windows/release/`. Note which artifacts actually appear.

- [ ] **Step 2: Confirm the relay ships inside the bundle**

The prior plan recorded a real past bug: `resources` was once a glob, NSIS mirrored the source path, no candidate matched, and the relay was never installed — which only looked healthy on a dev machine. Verify the built installer contains `coucou-hook.exe` by listing the bundle contents.

- [ ] **Step 3: Install and confirm the relay lands**

Install the produced `.exe`, launch Coucou, and confirm `%LOCALAPPDATA%\coucou\bin\coucou-hook.exe` exists and matches the built one.

- [ ] **Step 4: Repeat Task 3 Step 3 and Task 4 Step 2 against the installed build**

The dev build passing proves nothing about the packaged one.

---

# Task 7: Correct the documentation with the verified facts

**Files:**
- Modify: `docs/AGENTS.md`, `docs/INTEGRATIONS.md`, `README.md`, `docs/AGENT_TEST_MATRIX.md`, `CHANGELOG.md`

- [ ] **Step 1: Fix the Hermes home in the docs**

`docs/AGENTS.md` currently says the config lives at `~/.hermes/config.yaml` for every platform. Replace with:

> The config lives in the Hermes home: `$HERMES_HOME` if set, otherwise `%LOCALAPPDATA%\hermes`
> on Windows and `~/.hermes` on macOS and Linux. Run `hermes config path` to print it.
> On Windows that is `C:\Users\<you>\AppData\Local\hermes\config.yaml` — **not** `~/.hermes`.

- [ ] **Step 2: Add the real event list and the blocking rule**

Document that only `pre_tool_call` can block (`shell_hooks.py: _BLOCKING_EVENTS`), that `timeout` caps at 300 s, and the seven events Coucou installs.

- [ ] **Step 3: Update the test matrix**

Add the Task 3-6 rows to `docs/AGENT_TEST_MATRIX.md`, and mark which are now verified rather than planned.

- [ ] **Step 4: Changelog**

Extend the fork's `## Rebrand — Notch-Buddy fork` entry, or add a `## Unreleased` one, recording the config-path fix and the added lifecycle events.

- [ ] **Step 5: Verify and commit**

```bash
bash scripts/test-agent-docs.sh
bash scripts/test-hook-relay-dialect.sh
```
Expected: both green.

---

# Task 8: What is left after this — recorded, not silently dropped

These are **not** in this plan's scope, and each needs a decision rather than a code change.

- [ ] **Record in the ledger**

| Item | Why it is out of scope | What unblocks it |
|---|---|---|
| **macOS end-to-end** | No Swift toolchain on this machine; every Swift change on this branch is uncompiled and unexecuted | A Mac: `xcodegen`, `xcodebuild`, then Tasks 3-5 |
| **Reserved assets** | The app icon, 28 WAVs and the media are © Louis Raillé and must be replaced before distribution — `NOTICE.md` lists them | Someone has to draw and record replacements |
| **Amp on Windows** | Out of scope for this work; still macOS-only | A separate task |
| **OpenCode approvals** | Its plugin API cannot return a decision — display-only by design | An upstream OpenCode feature |
| **Hermes `pre_verify`** | Hermes can nudge the agent to keep working; Coucou has no equivalent canonical event | A product decision |
| **`transform_*` hooks** | Hermes can rewrite tool output and prompts; Coucou is an observer | A product decision |

---

## Verification Matrix

| Check | Command | Where |
|---|---|---|
| Hermes home resolution | `cd windows/src-tauri && cargo test agents::` | Windows ✅ |
| Relay event mapping | `cd windows/hook && cargo test` | Windows ✅ |
| macOS relay dialect | `bash scripts/test-hook-relay-dialect.sh` | either ✅ |
| Front-end | `cd windows && npm run build` | Windows ✅ |
| Docs contract | `bash scripts/test-agent-docs.sh` | either ✅ |
| **Hermes sees the hooks** | `hermes hooks list` → 7 entries | Windows — Task 3 |
| **Deny blocks a tool** | island → Deny → tool blocked | Windows — Task 4 |
| **Closed Coucou is invisible** | quit Coucou, run a tool | Windows — Task 4 |
| **OpenCode pill + diffs** | live session | Windows — Task 5 |
| **Installer** | `npm run pack`, install, re-test | Windows — Task 6 |
| macOS end to end | Tasks 3-5 on a Mac | **blocked** |

## Definition Of Done

- `hermes hooks list` shows all seven hooks, and `hermes hooks doctor` reports them healthy.
- **Deny from the island actually blocks a Hermes tool call**, and a timeout blocks rather than silently allowing.
- A closed Coucou leaves Hermes completely untouched — no delay, no error, no output.
- OpenCode shows its pill, ticker and diffs on Windows, and its permissions stay honestly display-only.
- The packaged installer reproduces all of the above, not just the dev build.
- The docs state the real config path for each platform, and no doc claims a platform works that has not been tested on it.
- Every remaining gap is recorded in Task 8's table with the reason it is out of scope.
