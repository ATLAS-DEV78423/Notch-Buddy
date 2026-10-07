# Hermes + OpenCode Agent Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Hermes Agent and OpenCode first-class Coucou agents — same pill, colour, ticker, diffs, lifecycle, Mochi animation and install UX as Claude Code — on macOS, Windows and Linux.

**Architecture:** No second integration architecture. Every adapter translates its agent's native events into Coucou's existing canonical hook payload and sends it to the existing relay over the existing Unix socket / named pipe. The only new seam is a **dialect** table: the relay already speaks a per-agent stdout shape for Claude Code, Copilot and Muse, and this plan adds one entry for Hermes. `coucou_agent` remains the only wire-level agent tag.

**Tech Stack:** Swift 6 / SwiftUI / AppKit (macOS), TypeScript + Vite + Tauri 2 (Windows/Linux front-end), Rust (Tauri backend + `coucou-hook` relay), Python 3 (macOS embedded relay), Cloudflare Worker (untouched).

**Spec:** `docs/AGENT_COMPATIBILITY_PLAN.md`

## Global Constraints

Copied verbatim from `CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- Swift 6, SwiftUI + AppKit. **No third-party dependencies unless truly unavoidable.** The character is drawn in code (`Canvas` + `TimelineView`), no Rive/Lottie/images.
- **Never block the agent**: if Coucou doesn't answer, the hook exits immediately.
- **Never overwrite user config**: dated backup, merge, show the diff, write only after the user confirms.
- Never send an email or approve a permission without an explicit click.
- Pill IDs are stable contract values (Keychain, UserDefaults, hook routing): **never rename an existing pill ID**.
- Keep the bundle identifier `fr.louisraille.NotchBuddy`.
- Never restyle what already ships: existing views stay exactly as they are in `main`.
- Every release adds its `CHANGELOG.md` section and a row in the README Versions table.
- `coucou_agent` must match `^[a-z0-9-]{1,24}$`. `claude` is reserved.
- Windows hook commands run through **Git Bash**; anything with PowerShell or `cmd` in the command string breaks.
- macOS: `~/.config/...` paths; Windows: `%USERPROFILE%` for `.claude`, but `~/.config/opencode/` and `~/.hermes/` stay XDG-style on every platform.
- **Ponytail is ACTIVE for this whole build** (see "Ponytail Rules" below). Shortest working diff wins, once the problem is understood.

---

## Verified Facts This Plan Depends On

Confirmed by reading the repo and the live tool docs on 2026-10-07. Do not re-derive; do re-verify in Task 1.

| Fact | Evidence |
|---|---|
| OpenCode plugin dir is `~/.config/opencode/plugins/` on **all** platforms | opencode.ai/docs/plugins; `~/.config/opencode/` exists on this Windows machine |
| OpenCode plugin shape is `export const X = async (ctx) => ({...hooks})`, ctx has `directory`, `worktree` | opencode.ai/docs/plugins |
| OpenCode exposes `permission.asked` / `permission.replied` only as **events**, not decision hooks | opencode.ai/docs/plugins Events list |
| OpenCode local install here is v1.18.33 | `opencode --version` |
| Hermes shell hooks live in `~/.hermes/config.yaml` under a **top-level** `hooks:` key | Hermes v0.21.3 Event Hooks |
| Hermes hook entry fields are `matcher`, `command`, `timeout` | Hermes v0.21.3 Event Hooks |
| Hermes feeds the hook JSON on **stdin** and reads a JSON receipt on **stdout** | Hermes v0.21.3 Event Hooks |
| Hermes receipt shapes: `{"action":"block","message":…}`, `{"action":"modify","args":…}`, `{"context":…}`, `{}` | Hermes v0.21.3 Event Hooks |
| Hermes `pre_tool_call` **can block**; exit code 2 also blocks | Hermes v0.21.3 Event Hooks |
| Hermes shell hooks are **fail-open by default**; `fail_closed: true` opts in | Hermes v0.21.3 Event Hooks |
| Hermes `timeout` default 60 s, **hard cap 300 s**, silently truncated | Hermes v0.21.3 Event Hooks |
| Hermes requires **per-`(event, command)` consent** in `~/.hermes/shell-hooks-allowlist.json`, or the hook silently never fires | Hermes v0.21.3 Event Hooks |
| Hermes allowlist keys on the **command string, not a script hash** | Hermes v0.21.3 Event Hooks |
| Hermes on Windows needs `bash <path>` when the script has no exec bit | Hermes v0.21.3 Event Hooks |
| `coucou-hook` already parses `--agent <name>` and a positional event, order-independent | `windows/hook/src/main.rs:103-129` |
| Windows `PermissionRequest` for external agents is **declined immediately** (no card) | `windows/src/island/hooks.ts:273-280` |
| Windows external agent colour is a **hash**, not the catalog colour | `windows/src/island/hooks.ts:37-45` |
| macOS already emits a per-agent stdout dialect for copilot/muse/gemini/antigravity | `HookServer.swift` `nbHookPythonGitHub`, decision block |
| macOS relay script path is `~/Library/Application Support/NotchBuddy/nb-hook` | `HookServer.swift:30` |
| Windows relay path is `<local_dir>/bin/coucou-hook.exe` | `windows/src-tauri/src/settings.rs:52` |
| No YAML crate exists in the Rust workspace | `windows/src-tauri/Cargo.toml`, `windows/hook/Cargo.toml` |
| macOS tests are shell scripts that `swiftc` a source file + a test file | `scripts/test-diff-engine.sh` |

### The two decisions that follow from those facts

**1. Hermes gets real approvals. OpenCode does not.**

Hermes has a `pre_tool_call` hook that can block, so Allow/Deny is genuinely enforceable. OpenCode's documented plugin API exposes permissions only as *observable events* — there is no way to hand back a decision — so OpenCode is **display-only**, and the card says `Handled in OpenCode.` Making OpenCode pretend to approve would be a lie in the UI.

**2. Hermes' `pre_tool_call` is scoped with `matcher`, and never sets `fail_closed: true`.**

`pre_tool_call` fires for *every* tool. Gating every call would be unusable, so the approval entry uses `matcher` to gate only mutating tools. And because Hermes defaults to fail-open, "Coucou is closed → relay can't connect → exit 0 with empty stdout → Hermes proceeds" is already the correct behaviour for free. Setting `fail_closed: true` would break the hard rule *never block the agent*. Instead, the relay itself prints a block receipt **only** when Coucou was reachable and the human never answered — so a timeout denies rather than silently allowing. That is a deliberate, documented asymmetry.

---

## Ponytail Rules For This Build

Active at **full** level for the whole implementation. Applied concretely:

| Rung | How it applies here |
|---|---|
| 1. Does it need to exist? | No new integration architecture, no new socket, no new payload format, no new pill *system*. |
| 2. Already in the codebase? | Reuse `validateAgent`, `upsertExternalAgent`, the `--agent` flag, the preview/backup/fingerprint installer pattern, the `Notification` state path, the existing dialect table. |
| 3. Stdlib? | Python relay stays stdlib-only (`sys, json, os, socket, subprocess`). No `requests`, no `httpx`. |
| 4. Native platform? | Hermes shell hooks and OpenCode's plugin loader are the native extension points — use them instead of a wrapper daemon. |
| 5. Already-installed dep? | **No new Cargo dependency.** Hermes' YAML is managed with marker-delimited text blocks, not a YAML crate. |
| 6. One line? | The macOS dialect addition is a branch in an existing `if`; the Windows colour fix is one lookup. |
| 7. Minimum that works. | OpenCode approval is **not** built, because the API cannot support it safely. |

**Deliberate simplifications that must carry a `ponytail:` comment:**

- Hermes `config.yaml` merge is line-based between `# coucou:begin` / `# coucou:end` markers, **not** a YAML round-trip. Ceiling: if the user already has a top-level `hooks:` key we refuse to auto-write and hand them the block to paste. Upgrade path: adopt a YAML crate if Hermes users start hitting the refusal often.
- Windows agent colours are a hand-maintained TS map mirroring `PillCatalog.swift`. Ceiling: two places to edit when a pill is added. Upgrade path: generate the TS map from the Swift catalog at build time.
- OpenCode `permission.asked` is surfaced through the existing `Notification` state instead of a new approval path. Ceiling: no Allow/Deny for OpenCode. Upgrade path: revisit if OpenCode ships a decision hook.

**Every non-trivial change in this plan leaves exactly one runnable check behind.** No test frameworks are added.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `NotchBuddy/Sources/CoucouKit/AgentDialect.swift` | Dependency-free single source of truth: which agent speaks which stdout dialect, which can approve, the two agent colours. Compiles standalone so it is directly testable. |
| `tests/AgentDialectTests.swift` | Assert-based test for the above. |
| `scripts/test-agent-dialect.sh` | `swiftc` + run the above, repo's existing test style. |
| `scripts/test-hook-relay-dialect.sh` | Extracts the embedded Python relay from `HookServer.swift`, imports it, asserts `dialect_output()`. |
| `tests/test_hermes_config.py` | Asserts the generated Hermes `config.yaml` block is valid, idempotent and marker-scoped. |
| `windows/src/core/agents.ts` | Windows agent metadata (name, colour, approval-capable), mirroring `PillCatalog.swift`. |
| `windows/src-tauri/src/agents.rs` | Tauri installers for the OpenCode plugin file and the Hermes `config.yaml` block, reusing `hooks.rs`'s backup/diff/atomic-write. |

**Modified**

| Path | Change |
|---|---|
| `windows/hook/src/main.rs` | Add the Hermes dialect + no-answer receipt. |
| `NotchBuddy/Sources/App/HookServer.swift` | Python relay Hermes branch; `upsertExternalAgent` colour from catalog; Hermes installer; OpenCode plugin hardening; Hermes approval wiring. |
| `NotchBuddy/Sources/App/SettingsView.swift` | Hermes group box, mirroring the OpenCode/Amp box. |
| `NotchBuddy/Resources/Localizable.xcstrings` | `plugin.hermes.*` keys. |
| `windows/src/island/hooks.ts` | Use `agents.ts` metadata; allow Hermes approvals; Hermes/OpenCode note text. |
| `windows/src-tauri/src/hooks.rs` | Make `fingerprint`, `write_like`, and a new `backup_path_for` `pub(crate)`. |
| `windows/src-tauri/src/lib.rs` | `mod agents;` + command registration. |
| `windows/src/settings/main.ts` | Agent install sections. |
| `docs/AGENTS.md`, `docs/INTEGRATIONS.md`, `README.md`, `CHANGELOG.md` | Contract, platform matrix, supported-agents table, release note. |

**Not touched:** `relay/`, `pipe.rs`, `IslandStateMachine`/`fsm.ts`, the Mochi engine, the wardrobe, the diff engine. Agent pills already animate through the shared engine — no animation work is needed, which is the point.

---

# Task 1: Lock the contract into docs

The spec's Phase H1 gate. Everything downstream assumes these names; if they are wrong, every later task is wrong, so this runs first and its output is machine-checked.

**Files:**
- Modify: `docs/AGENTS.md` (the `## Supported agents` area, after the "Any other tool" section)
- Create: `scripts/test-agent-docs.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: the canonical strings every later task must match — agent tags `hermes` / `opencode`; pill IDs `agent_hermes` / `agent_opencode`; Hermes events `pre_tool_call`, `post_tool_call`; Hermes receipt shapes `{"action":"block","message":…}` and `{}`; Hermes config path `~/.hermes/config.yaml`; OpenCode plugin path `~/.config/opencode/plugins/coucou.js`.

- [ ] **Step 1: Confirm the live contracts before writing them down**

Run:
```bash
opencode --version
hermes hooks --help 2>&1 | head -40
hermes hooks list
```
Expected: OpenCode prints a version. `hermes hooks --help` lists the valid shell-hook event names and the `hooks:` schema; `hermes hooks list` prints `No shell hooks or outbound webhooks configured in ~/.hermes/config.yaml.` if nothing is installed yet.

Record the **exact** event names `hermes hooks --help` reports. If `post_tool_call` is not in that list, use the closest confirmed name and change the constant in Task 4 and Task 11 to match. **Do not invent an event name.**

If `hermes` is not installed on this machine, note that in the doc and treat `pre_tool_call` + `post_tool_call` as the assumed set, flagged `(unverified — confirm before release)`.

- [ ] **Step 2: Write the failing test**

Create `scripts/test-agent-docs.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Guards the Hermes/OpenCode contract documented in docs/AGENTS.md.
# If a name drifts, this fails before an adapter is written against it.
DOC="docs/AGENTS.md"

fail=0
need() {
  if ! grep -qF -- "$1" "$DOC"; then
    echo "MISSING from $DOC: $1"
    fail=1
  fi
}

need "coucou_agent"
need "hermes"
need "opencode"
need "agent_hermes"
need "agent_opencode"
need "~/.hermes/config.yaml"
need "~/.config/opencode/plugins/coucou.js"
need "pre_tool_call"
need "post_tool_call"
need '{"action": "block", "message": "Denied from Coucou"}'
need "shell-hooks-allowlist.json"

if [ "$fail" -ne 0 ]; then
  echo "agent contract docs are out of date"
  exit 1
fi
echo "agent contract docs OK"
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bash scripts/test-agent-docs.sh`
Expected: FAIL, printing `MISSING from docs/AGENTS.md: agent_hermes` and friends.

- [ ] **Step 4: Write the docs**

Append to `docs/AGENTS.md` (keep the existing sections untouched):

````markdown
## Hermes Agent (macOS, Windows, Linux)

Hermes runs shell hooks declared in `~/.hermes/config.yaml`, under a top-level `hooks:` key
(sibling of `model:`). Coucou points those entries straight at its relay — no wrapper script.

```yaml
hooks:
  pre_tool_call:
    - matcher: "terminal|write_file|patch"
      command: "\"C:/Users/you/AppData/Local/coucou/bin/coucou-hook.exe\" --agent hermes pre_tool_call"
      timeout: 130
  post_tool_call:
    - command: "\"C:/Users/you/AppData/Local/coucou/bin/coucou-hook.exe\" --agent hermes post_tool_call"
      timeout: 10
```

macOS uses `/bin/sh "<Application Support>/NotchBuddy/nb-hook" --agent hermes <event>` instead.

**Hermes reads a JSON receipt on stdout.** Coucou answers:

| Decision | Receipt |
|---|---|
| Allow | `{}` |
| Deny | `{"action": "block", "message": "Denied from Coucou"}` |
| Coucou open, no answer within 110 s | `{"action": "block", "message": "Coucou: no answer — re-run to be asked again."}` |
| Coucou not running | *nothing printed* — Hermes proceeds |

That last row is why Coucou does **not** set `fail_closed: true`: fail-open is what keeps the
promise that a closed Coucou never blocks your agent. The timeout row is why a timeout denies
instead of silently allowing.

**Consent.** Hermes will not run a shell hook until you approve that exact `(event, command)`
pair, recorded in `~/.hermes/shell-hooks-allowlist.json`. Until then the hook is silently
skipped — `hermes hooks list` shows `✗ not allowlisted`. Approve with one of:

```bash
hermes --accept-hooks chat        # one-off CLI flag
export HERMES_ACCEPT_HOOKS=1      # environment variable
```

or set `hooks_auto_accept: true` in `~/.hermes/config.yaml`.

Changing the relay path changes the command string and therefore re-prompts. `hermes hooks doctor`
reports drift.

**Event map**

| Hermes shell hook | Canonical event | Notes |
|---|---|---|
| `pre_tool_call` | `PreToolUse` | Approval-capable when `matcher` is set |
| `post_tool_call` | `PostToolUse` | Display only |

**Limits.** Hermes caps hook `timeout` at 300 s (larger values are silently truncated).
Hermes `pre_tool_call` fires for every tool, so Coucou gates only the tools named in `matcher`.

## OpenCode (macOS, Windows, Linux)

Coucou installs one generated plugin at `~/.config/opencode/plugins/coucou.js` — the same
XDG path on every platform, which is why OpenCode works on Windows unlike Amp.

The plugin forwards display events fire-and-forget: it spawns the Coucou relay, writes one
JSON line, and returns without waiting. OpenCode is never slowed down.

**OpenCode permissions are display-only.** OpenCode exposes `permission.asked` as an
*observable event*, not as a hook that can return a decision, so Coucou cannot answer it.
The permission is surfaced in the ticker as a question and the card reads
`Handled in OpenCode.` — answer it in your terminal.

| OpenCode event | Canonical event |
|---|---|
| `session.created` | `SessionStart` |
| `session.idle` | `Stop` |
| `session.error` | `StopFailure` |
| `session.deleted` | `SessionEnd` |
| `session.diff` | `PostToolUse` (carries the diff) |
| `permission.asked` | `Notification` (`Allow <tool>?`) |
| `tool.execute.before` | `PreToolUse` |
| `tool.execute.after` | `PostToolUse` |
````

- [ ] **Step 5: Run the test to verify it passes**

Run: `bash scripts/test-agent-docs.sh`
Expected: PASS, printing `agent contract docs OK`.

- [ ] **Step 6: Commit**

```bash
git add docs/AGENTS.md scripts/test-agent-docs.sh
git commit -m "docs: pin the Hermes and OpenCode agent contract"
```

---

# Task 2: Hermes dialect in the Rust relay

The crux of Hermes support on Windows and Linux. `coucou-hook` currently emits Claude Code's receipt shape for every agent, which Hermes would ignore — a deny would silently allow the tool.

**Files:**
- Modify: `windows/hook/src/main.rs`
- Test: `windows/hook/src/main.rs` (`#[cfg(test)] mod tests`, appended)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `enum Dialect { Claude, Hermes }`
  - `fn dialect_for(agent: &str) -> Dialect`
  - `fn decision_json(dialect: Dialect, decision: &str) -> Option<String>` — replaces the old `decision_json(&str)`
  - `fn no_answer_json(dialect: Dialect) -> Option<String>`

- [ ] **Step 1: Write the failing test**

Append to the existing `mod tests` in `windows/hook/src/main.rs`:

```rust
    #[test]
    fn hermes_speaks_its_own_receipt_shape() {
        assert_eq!(dialect_for("hermes"), Dialect::Hermes);
        assert_eq!(dialect_for("opencode"), Dialect::Claude);
        assert_eq!(dialect_for("claude"), Dialect::Claude);

        // Allow is an empty object: Hermes reads that as "no objection".
        assert_eq!(decision_json(Dialect::Hermes, "allow").unwrap(), "{}");
        assert_eq!(decision_json(Dialect::Hermes, "always").unwrap(), "{}");
        assert_eq!(
            decision_json(Dialect::Hermes, "deny").unwrap(),
            r#"{"action":"block","message":"Denied from Coucou"}"#
        );
        // Anything unrecognised prints nothing at all.
        assert!(decision_json(Dialect::Hermes, "maybe").is_none());
    }

    #[test]
    fn hermes_blocks_when_the_human_never_answered() {
        // Coucou was reachable but nobody clicked. Silence here would be a silent
        // allow, which is worse than not having Coucou installed.
        let out = no_answer_json(Dialect::Hermes).unwrap();
        assert!(out.contains(r#""action":"block""#));
        assert!(out.contains("no answer"));
        // Claude Code's fallback is silence: the terminal asks instead.
        assert!(no_answer_json(Dialect::Claude).is_none());
    }

    #[test]
    fn claude_receipts_are_unchanged() {
        assert_eq!(
            decision_json(Dialect::Claude, "allow").unwrap(),
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}"#
        );
        assert_eq!(
            decision_json(Dialect::Claude, "deny").unwrap(),
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied from Coucou"}}}"#
        );
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd windows/hook && cargo test`
Expected: FAIL to compile — `cannot find function 'dialect_for' in this scope`, `cannot find type 'Dialect'`.

- [ ] **Step 3: Write the implementation**

In `windows/hook/src/main.rs`, replace the existing `decision_json` function with:

```rust
/// Which receipt shape the calling agent understands.
///
/// The relay is one binary shared by every agent; only the stdout contract differs.
/// Adding an agent means adding an arm here, not a new binary.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Dialect {
    /// Claude Code, Codex, and every observational agent (Gemini, Copilot, Muse,
    /// OpenCode). Observational agents ignore stdout entirely.
    Claude,
    /// Hermes reads `{"action":"block","message":…}` to stop a tool, `{}` to let it run.
    Hermes,
}

fn dialect_for(agent: &str) -> Dialect {
    match agent {
        "hermes" => Dialect::Hermes,
        _ => Dialect::Claude,
    }
}

/// The receipt for a decision the human actually made.
/// `None` means print nothing — silence is the safe answer for an unknown decision.
fn decision_json(dialect: Dialect, decision: &str) -> Option<String> {
    match dialect {
        Dialect::Hermes => match decision.trim() {
            // "always" is an island concept; Hermes just gets a plain allow.
            "allow" | "always" => Some("{}".to_string()),
            "deny" => Some(
                r#"{"action":"block","message":"Denied from Coucou"}"#.to_string(),
            ),
            _ => None,
        },
        Dialect::Claude => {
            let behavior = match decision.trim() {
                "allow" | "always" => r#"{"behavior":"allow"}"#.to_string(),
                "deny" => {
                    r#"{"behavior":"deny","message":"Denied from Coucou"}"#.to_string()
                }
                _ => return None,
            };
            Some(format!(
                r#"{{"hookSpecificOutput":{{"hookEventName":"PermissionRequest","decision":{behavior}}}}}"#
            ))
        }
    }
}

/// The receipt for "Coucou was reachable, the human never answered."
///
/// Claude Code gets silence and re-asks in the terminal. Hermes has no re-ask
/// path, so silence would be a silent allow — it gets an explicit block instead.
/// A closed Coucou never reaches here: `connect()` fails and we exit 0 with
/// nothing printed, which is Hermes' fail-open default.
fn no_answer_json(dialect: Dialect) -> Option<String> {
    match dialect {
        Dialect::Hermes => Some(
            r#"{"action":"block","message":"Coucou: no answer — re-run to be asked again."}"#
                .to_string(),
        ),
        Dialect::Claude => None,
    }
}
```

Then update `main()` to use them. Replace the body after `let (tx, rx) = mpsc::channel::<Option<String>>();`:

```rust
    let dialect = dialect_for(&agent_name);
    let (tx, rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        let _ = tx.send(talk(&payload, waits_for_answer));
    });

    // `Ok(Some(decision))` = a human decided. `Ok(None)` = Coucou answered without a
    // decision, or was never reachable. `Err(_)` = the budget ran out with Coucou
    // still holding the request, i.e. nobody clicked.
    let receipt = match rx.recv_timeout(budget) {
        Ok(Some(decision)) => decision_json(dialect, &decision),
        Ok(None) => None,
        Err(_) if waits_for_answer => no_answer_json(dialect),
        Err(_) => None,
    };
    if let Some(json) = receipt {
        let mut out = std::io::stdout();
        let _ = writeln!(out, "{json}");
        let _ = out.flush();
    }
    // Nothing printed: the agent carries on exactly as if we were not here.
    std::process::exit(0);
```

`agent_name` must be surfaced from `read_event`. Change its signature to return it:

```rust
fn read_event() -> Option<(String, String, String)> {
```

and at the end:

```rust
    let mut line = payload.to_string();
    line.push('\n');
    Some((line, event, agent))
}
```

and in `main()`:

```rust
    let Some((payload, event, agent_name)) = read_event() else { std::process::exit(0) };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd windows/hook && cargo test`
Expected: PASS — all three new tests plus the three existing ones (`decision_json_matches_the_documented_shape` must be updated to pass `Dialect::Claude`; that is part of this step).

- [ ] **Step 5: Verify the release build still works**

Run: `cd windows/hook && cargo build --release`
Expected: builds clean. `windows/package.json`'s `prebuild` runs this, so a broken relay breaks `npm run pack`.

- [ ] **Step 6: Commit**

```bash
git add windows/hook/src/main.rs
git commit -m "feat(hook): speak Hermes' receipt shape in the relay"
```

---

# Task 3: Hermes dialect in the macOS Python relay

Same change, macOS side. The relay already branches per agent; this adds the Hermes arm and, unlike the Rust relay, must be covered by a test that actually runs the generated Python.

**Files:**
- Modify: `NotchBuddy/Sources/App/HookServer.swift` (`nbHookPythonGitHub` and `nbHookPythonAppStore`)
- Create: `scripts/test-hook-relay-dialect.sh`
- Create: `tests/test_relay_dialect.py`

**Interfaces:**
- Consumes: nothing.
- Produces: in the generated Python, a module-level pure function
  `dialect_output(agent, decision) -> str | None`
  where `decision` is `"allow" | "always" | "deny" | "answer" | "ask" | ""`, returning the exact stdout text or `None` for "print nothing".

- [ ] **Step 1: Write the failing test**

Create `tests/test_relay_dialect.py`:

```python
"""Asserts the macOS relay's per-agent stdout dialect.

Run via scripts/test-hook-relay-dialect.sh, which extracts the relay source out of
HookServer.swift first. Asserts on the pure function so no socket is needed.
"""
import importlib.util
import sys
from pathlib import Path

RELAY = Path(sys.argv[1])


def load():
    spec = importlib.util.spec_from_file_location("relay", RELAY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    mod = load()
    out = mod.dialect_output

    # Hermes: {} allows, a block object denies, and a missing answer denies too.
    assert out("hermes", "allow") == "{}", out("hermes", "allow")
    assert out("hermes", "always") == "{}"
    assert out("hermes", "deny") == '{"action": "block", "message": "Denied from Coucou"}'
    no_answer = out("hermes", "ask")
    assert no_answer is not None and '"action": "block"' in no_answer, no_answer
    assert "no answer" in no_answer

    # Claude Code is untouched: allow/deny are wrapped, silence means "terminal asks".
    allow = out("claude", "allow")
    assert '"behavior": "allow"' in allow, allow
    deny = out("claude", "deny")
    assert '"behavior": "deny"' in deny, deny
    assert out("claude", "ask") is None

    # Copilot and Muse keep their plain shape.
    assert out("copilot", "allow") == '{"permissionDecision": "allow"}'
    assert out("muse", "deny") == '{"permissionDecision": "deny"}'

    # Observational agents never produce a decision.
    for a in ("gemini", "antigravity", "opencode"):
        assert out(a, "allow") == "{}", (a, out(a, "allow"))

    # Unknown decision, unknown agent: print nothing.
    assert out("claude", "maybe") is None

    print("relay dialect OK")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Write the harness that extracts the relay**

Create `scripts/test-hook-relay-dialect.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/coucou-relay-dialect.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT

# Pull the GitHub relay out of the Swift string literal: everything between the
# opening `private let nbHookPythonGitHub = """` line and the next `"""`.
awk '/^private let nbHookPythonGitHub = """/{f=1;next} f&&/^"""/{exit} f' \
    NotchBuddy/Sources/App/HookServer.swift > "$TEST_DIR/nb-hook.py"

if ! [ -s "$TEST_DIR/nb-hook.py" ]; then
    echo "could not extract nbHookPythonGitHub from HookServer.swift"
    exit 1
fi

python3 "$TEST_DIR/../tests/test_relay_dialect.py" "$TEST_DIR/nb-hook.py" 2>/dev/null \
  || python3 tests/test_relay_dialect.py "$TEST_DIR/nb-hook.py"
```

- [ ] **Step 3: Run it to verify it fails**

Run: `bash scripts/test-hook-relay-dialect.sh`
Expected: FAIL — `AttributeError: module 'relay' has no attribute 'dialect_output'`.

- [ ] **Step 4: Write the implementation**

In `nbHookPythonGitHub` (and the identical logic in `nbHookPythonAppStore`), add this function above `def main():`

```python
def dialect_output(agent, decision):
    """The exact stdout for (agent, decision), or None to print nothing.

    Every agent reads a different receipt, so this is the one place that knows
    the difference. `decision` is what Coucou sent: allow/always/deny/answer/ask.
    """
    # Hermes reads {"action":"block"} to stop a tool and {} to let it run. It has
    # no re-ask path, so an unanswered request must block rather than fall silent.
    if agent == 'hermes':
        if decision in ('allow', 'always'):
            return '{}'
        if decision == 'deny':
            return '{"action": "block", "message": "Denied from Coucou"}'
        return ('{"action": "block", "message": '
                '"Coucou: no answer \\u2014 re-run to be asked again."}')

    # Copilot and Muse take a plain permissionDecision.
    if agent in ('copilot', 'muse'):
        if decision in ('allow', 'always'):
            return '{"permissionDecision": "allow"}'
        if decision == 'deny':
            return '{"permissionDecision": "deny"}'
        return None

    # Observational agents ignore stdout, but {} is the documented no-op.
    if agent in ('gemini', 'antigravity', 'opencode'):
        return '{}'

    # Claude Code and Codex: wrapped decisions, silence means "ask in the terminal".
    if decision in ('allow', 'always'):
        return json.dumps({'hookSpecificOutput': {
            'hookEventName': 'PermissionRequest',
            'decision': {'behavior': 'allow'}}})
    if decision == 'deny':
        return json.dumps({'hookSpecificOutput': {
            'hookEventName': 'PermissionRequest',
            'decision': {'behavior': 'deny', 'message': 'Denied from Coucou'}}})
    return None
```

Then replace the existing decision block inside `main()` with a call to it. The existing block ends with the `'ask' or unknown: fall through` comment; replace the whole `if decision in ('allow', 'always'): … elif decision == 'deny': …` chain with:

```python
                if decision == 'answer':
                    out = {'hookSpecificOutput': {'hookEventName': 'PermissionRequest',
                           'decision': {'behavior': 'allow',
                                        'updatedInput': {'questions': questions,
                                                         'answers': answers}}}}
                    sys.stdout.write(json.dumps(out) + '\n')
                    sys.stdout.flush()
                else:
                    text = dialect_output(agent, decision)
                    if text is not None:
                        sys.stdout.write(text + '\n')
                        sys.stdout.flush()
                # 'ask' or unknown: no output → the agent re-asks in its terminal.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bash scripts/test-hook-relay-dialect.sh`
Expected: PASS, printing `relay dialect OK`.

- [ ] **Step 6: Verify the app still builds**

Run: `cd NotchBuddy && xcodegen && xcodebuild -scheme NotchBuddy -configuration Debug build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`
Expected: BUILD SUCCEEDED. (macOS only; skip on Windows and note it in the PR.)

- [ ] **Step 7: Commit**

```bash
git add NotchBuddy/Sources/App/HookServer.swift scripts/test-hook-relay-dialect.sh tests/test_relay_dialect.py
git commit -m "feat(hook): add the Hermes dialect to the macOS relay"
```

---

# Task 4: `AgentDialect.swift` — one source of truth for the two agents

The macOS app needs to answer three questions in several places: which dialect does this agent speak, can it approve, and what colour is its pill. Today that knowledge is scattered. This file makes it testable, because `HookServer.swift` cannot be compiled standalone.

**Files:**
- Create: `NotchBuddy/Sources/CoucouKit/AgentDialect.swift`
- Create: `tests/AgentDialectTests.swift`
- Create: `scripts/test-agent-dialect.sh`
- Modify: `NotchBuddy/Sources/CoucouKit/PillCatalog.swift` (add the two pills)

**Interfaces:**
- Consumes: `PillCatalog` (same module).
- Produces:
  - `enum AgentDialect: String { case claude, hermes, opencode }`
  - `init?(agent: String)`
  - `var allowsApproval: Bool`
  - `func decisionJSON(_ decision: String) -> String?`
  - `func noAnswerJSON() -> String?`
  - `static func pillColor(forAgent agent: String) -> String?`

- [ ] **Step 1: Write the failing test**

Create `tests/AgentDialectTests.swift`:

```swift
import Foundation

// Assert-based harness, matching tests/DiffEngineTests.swift.
var failures = 0
func check(_ condition: Bool, _ message: String) {
    if !condition { print("FAIL: \(message)"); failures += 1 }
}
func checkEqual<T: Equatable>(_ a: T, _ b: T, _ message: String) {
    if a != b { print("FAIL: \(message)\n  got: \(a)\n  want: \(b)"); failures += 1 }
}

// MARK: - Dialect

checkEqual(AgentDialect(agent: "hermes"), .hermes, "hermes maps to the Hermes dialect")
checkEqual(AgentDialect(agent: "opencode"), .opencode, "opencode maps to the OpenCode dialect")
checkEqual(AgentDialect(agent: "gemini"), .claude, "observational agents use the default dialect")
check(AgentDialect(agent: "claude") == .claude, "claude is the default")
check(AgentDialect(agent: "claude") != nil, "the default dialect always exists")

// Only Hermes can hand back a decision on macOS.
check(AgentDialect.hermes.allowsApproval, "Hermes is approval-capable")
check(!AgentDialect.opencode.allowsApproval, "OpenCode is display-only")
check(!AgentDialect.claude.allowsApproval, "the default dialect is not approval-capable")

// MARK: - Receipts

checkEqual(AgentDialect.hermes.decisionJSON("allow"), "{}", "Hermes allows with {}")
checkEqual(AgentDialect.hermes.decisionJSON("always"), "{}", "always is a plain allow for Hermes")
checkEqual(
    AgentDialect.hermes.decisionJSON("deny"),
    #"{"action":"block","message":"Denied from Coucou"}"#,
    "Hermes denies with a block action"
)
check(AgentDialect.hermes.decisionJSON("maybe") == nil, "an unknown decision prints nothing")

let hermesTimeout = AgentDialect.hermes.noAnswerJSON()
check(hermesTimeout != nil, "Hermes blocks when nobody answered")
check(hermesTimeout!.contains("\"action\":\"block\""), "the timeout receipt is a block")
check(hermesTimeout!.contains("no answer"), "the timeout receipt explains itself")
check(AgentDialect.claude.noAnswerJSON() == nil, "Claude Code stays silent so the terminal asks")
check(AgentDialect.opencode.noAnswerJSON() == nil, "OpenCode never blocks")
// OpenCode answers {} like every other observational agent, matching the Python relay.
checkEqual(AgentDialect.opencode.decisionJSON("allow"), "{}", "OpenCode's receipt is a no-op {}")
checkEqual(AgentDialect.opencode.decisionJSON("deny"), "{}", "OpenCode ignores decisions")

// MARK: - Pill colours come from the catalog, not a hash

checkEqual(AgentDialect.pillColor(forAgent: "hermes"), "#A78BFA", "Hermes uses its catalog colour")
checkEqual(AgentDialect.pillColor(forAgent: "opencode"), "#4ADE80", "OpenCode uses its catalog colour")
check(AgentDialect.pillColor(forAgent: "some-unlisted-agent") == nil, "unlisted agents fall back to the hash")

// MARK: - Catalog

check(PillCatalog.definition(for: "agent_hermes") != nil, "agent_hermes is declared")
check(PillCatalog.definition(for: "agent_opencode") != nil, "agent_opencode is declared")
checkEqual(PillCatalog.definition(for: "agent_hermes")?.name, "Hermes", "Hermes pill name")
checkEqual(PillCatalog.definition(for: "agent_opencode")?.name, "OpenCode", "OpenCode pill name")
checkEqual(PillCatalog.definition(for: "agent_hermes")?.category, .agent, "Hermes is an agent pill")
check(PillCatalog.definition(for: "agent_hermes")?.githubOnly == true, "Hermes stays out of the App Store build")

if failures > 0 { print("\(failures) failure(s)"); exit(1) }
print("AgentDialect tests passed")
```

- [ ] **Step 2: Write the harness and run it to verify it fails**

Create `scripts/test-agent-dialect.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/coucou-agent-dialect.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
swiftc NotchBuddy/Sources/CoucouKit/PillCatalog.swift \
    NotchBuddy/Sources/CoucouKit/AgentDialect.swift \
    NotchBuddy/Sources/CoucouKit/IslandTypes.swift \
    tests/AgentDialectTests.swift -o "$TEST_DIR/agent-dialect-tests"
"$TEST_DIR/agent-dialect-tests"
```

Run: `bash scripts/test-agent-dialect.sh`
Expected: FAIL to compile — `cannot find 'AgentDialect' in scope`. (If `IslandTypes.swift` drags in SwiftUI and breaks standalone compilation, add only the files the compiler names, and note it in the script's comment.)

- [ ] **Step 3: Add the two pills**

In `NotchBuddy/Sources/CoucouKit/PillCatalog.swift`, inside `static let all`, in the `── Agents ──` block after `agent_amp`:

```swift
        .init(id: "agent_hermes",        name: "Hermes",      color: "#A78BFA",
              category: .agent,     subtitle: "Agent",        source: .agent,  githubOnly: true),
```

`agent_opencode` already exists — do not touch it.

- [ ] **Step 4: Write the implementation**

Create `NotchBuddy/Sources/CoucouKit/AgentDialect.swift`:

```swift
import Foundation

/// What a third-party agent needs on stdout, and whether Coucou can decide for it.
///
/// Dependency-free on purpose: HookServer.swift cannot be compiled on its own, so
/// anything that needs a test lives here. The generated Python relay mirrors the
/// same table (`dialect_output`) and `scripts/test-hook-relay-dialect.sh` pins it.
enum AgentDialect: String {
    /// Claude Code, Codex, and every observational agent. Claude Code re-asks in
    /// the terminal when we stay silent, so silence is the safe fallback.
    case claude
    /// Hermes reads `{"action":"block"}` to stop a tool and `{}` to allow it.
    case hermes
    /// OpenCode's plugin API cannot return a decision — display only.
    case opencode

    /// Never nil: an unknown agent is treated as the default dialect, which is
    /// exactly what every agent did before this type existed.
    init?(agent: String) {
        switch agent {
        case "hermes":   self = .hermes
        case "opencode": self = .opencode
        default:         self = .claude
        }
    }

    /// True when Allow/Deny from the notch actually reaches the agent.
    var allowsApproval: Bool {
        switch self {
        case .hermes:            return true
        case .claude, .opencode: return false
        }
    }

    /// The receipt for a decision the human made, or nil to print nothing.
    func decisionJSON(_ decision: String) -> String? {
        switch self {
        case .hermes:
            switch decision {
            case "allow", "always": return "{}"
            case "deny":            return #"{"action":"block","message":"Denied from Coucou"}"#
            default:                return nil
            }
        case .opencode:
            // Fire-and-forget: nothing reads our stdout. `{}` rather than silence,
            // so this matches the Python relay, which has always answered `{}` for
            // observational agents (gemini, antigravity, copilot, muse).
            return "{}"
        case .claude:
            let behavior: String
            switch decision {
            case "allow", "always": behavior = #"{"behavior":"allow"}"#
            case "deny":            behavior = #"{"behavior":"deny","message":"Denied from Coucou"}"#
            default:                return nil
            }
            return #"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":\#(behavior)}}"#
        }
    }

    /// The receipt for "Coucou was reachable, nobody answered".
    ///
    /// Claude Code gets silence and re-asks in the terminal. Hermes has no re-ask
    /// path, so silence would be a silent allow — it gets an explicit block.
    /// A closed Coucou never reaches this point: the socket connect fails first,
    /// and Hermes' own fail-open default takes over.
    func noAnswerJSON() -> String? {
        switch self {
        case .hermes:
            return #"{"action":"block","message":"Coucou: no answer — re-run to be asked again."}"#
        case .claude, .opencode:
            return nil
        }
    }

    /// The pill colour declared in `PillCatalog`, or nil when the agent is not
    /// declared and the caller should fall back to the hashed project colour.
    static func pillColor(forAgent agent: String) -> String? {
        PillCatalog.definition(for: "agent_\(agent)")?.color
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bash scripts/test-agent-dialect.sh`
Expected: PASS, printing `AgentDialect tests passed`.

- [ ] **Step 6: Commit**

```bash
git add NotchBuddy/Sources/CoucouKit/AgentDialect.swift \
        NotchBuddy/Sources/CoucouKit/PillCatalog.swift \
        tests/AgentDialectTests.swift scripts/test-agent-dialect.sh
git commit -m "feat(agents): single source of truth for agent dialect, approval and colour"
```

---

# Task 5: Generate and install the Hermes `config.yaml` block

The config writer is the risky half of Hermes support: it edits a file the user owns. The marker discipline and the refusal case are the whole point.

**Files:**
- Modify: `NotchBuddy/Sources/CoucouKit/AgentDialect.swift` (add the block builder)
- Modify: `tests/AgentDialectTests.swift`
- Modify: `NotchBuddy/Sources/App/HookServer.swift` (add `hermesConfigURL`, `hermesHooksInstalled()`, `previewHermesHooks(install:)`, `writeHermesHooks()`, `removeHermesHooks()`)

**Interfaces:**
- Consumes: `AgentDialect` from Task 4.
- Produces:
  - `static func AgentDialect.hermesConfigBlock(hookCommand: String) -> String`
  - `static func AgentDialect.mergeHermesConfig(existing: String, hookCommand: String) -> Result<String, String>`
  - `static let AgentDialect.hermesBeginMarker = "# coucou:begin"`
  - `static let AgentDialect.hermesEndMarker = "# coucou:end"`

- [ ] **Step 1: Write the failing test**

Append to `tests/AgentDialectTests.swift`, above the final `if failures > 0` line:

```swift
// MARK: - Hermes config.yaml block

let cmd = "/bin/sh '/Users/x/Library/Application Support/NotchBuddy/nb-hook' --agent hermes"
let block = AgentDialect.hermesConfigBlock(hookCommand: cmd)

check(block.hasPrefix(AgentDialect.hermesBeginMarker), "the block opens with the begin marker")
check(block.hasSuffix(AgentDialect.hermesEndMarker), "the block closes with the end marker")
check(block.contains("pre_tool_call:"), "the gate hook is declared")
check(block.contains("post_tool_call:"), "the observer hook is declared")
check(block.contains("timeout: 130"), "the gate outlives the relay's 110 s budget")
check(!block.contains("fail_closed"), "fail_closed is never set — a closed Coucou must not block Hermes")
check(block.contains("matcher:"), "the gate is scoped with a matcher")
// The command contains double quotes (the relay path), so the YAML scalar must be
// single-quoted or the file will not parse. This is the bug this check exists for.
check(block.contains("command: '"), "commands are single-quoted YAML scalars")
check(!block.contains("command: \""), "no command is a double-quoted YAML scalar")

// A file with no hooks: key gets the block appended, and everything before survives.
let fresh = try! AgentDialect.mergeHermesConfig(
    existing: "model: opus\nprofile: default\n", hookCommand: cmd).get()
check(fresh.hasPrefix("model: opus\nprofile: default\n"), "existing content is preserved")
check(fresh.contains(AgentDialect.hermesBeginMarker), "the block was appended")
check(fresh.contains("hooks:"), "the top-level hooks key was added")

// Idempotent: installing twice does not stack blocks.
let twice = try! AgentDialect.mergeHermesConfig(existing: fresh, hookCommand: cmd).get()
checkEqual(
    twice.components(separatedBy: AgentDialect.hermesBeginMarker).count,
    fresh.components(separatedBy: AgentDialect.hermesBeginMarker).count,
    "re-installing replaces the block instead of appending a second one"
)

// Uninstall leaves the user's own content byte-for-byte.
let cleaned = AgentDialect.mergeHermesConfig(existing: fresh, hookCommand: nil).get()
checkEqual(cleaned, "model: opus\nprofile: default\n", "uninstall restores the original file")

// A foreign hooks: key is refused rather than merged. We do not own their YAML.
let foreign = "model: opus\nhooks:\n  pre_llm_call:\n    - command: mine.sh\n"
switch AgentDialect.mergeHermesConfig(existing: foreign, hookCommand: cmd) {
case .success: check(false, "a foreign hooks: key must be refused")
case .failure(let message):
    check(message.contains("hooks:"), "the refusal names the conflicting key")
    check(message.contains("paste"), "the refusal tells the user what to do instead")
}

// An empty or missing file is fine.
check(try! AgentDialect.mergeHermesConfig(existing: "", hookCommand: cmd).get()
        .contains("pre_tool_call:"), "an empty config is seeded")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bash scripts/test-agent-dialect.sh`
Expected: FAIL to compile — `type 'AgentDialect' has no member 'hermesConfigBlock'`.

- [ ] **Step 3: Write the implementation**

Add to `NotchBuddy/Sources/CoucouKit/AgentDialect.swift`:

```swift
// MARK: - Hermes config.yaml

extension AgentDialect {
    static let hermesBeginMarker = "# coucou:begin"
    static let hermesEndMarker = "# coucou:end"

    /// Hermes fires `pre_tool_call` for every tool, so the gate is scoped to the
    /// tools that actually change something. Hermes truncates `timeout` at 300 s.
    ///
    /// `fail_closed` is deliberately absent: Hermes defaults to fail-open, which is
    /// what makes "Coucou is closed" mean "your agent carries on". The relay blocks
    /// on its own when a human was asked and never answered.
    static let hermesGateMatcher = "terminal|write_file|patch"

    /// The marker-delimited block Coucou owns inside ~/.hermes/config.yaml.
    ///
    /// Deliberately plain text rather than a YAML round-trip: the Rust workspace has
    /// no YAML crate and adding one to reformat a user's config would be worse than
    /// the problem. ponytail: line-based, so a user who already owns a `hooks:` key
    /// is refused rather than merged. Upgrade path: adopt a YAML crate if that
    /// refusal starts firing often.
    static func hermesConfigBlock(hookCommand: String) -> String {
        // Single-quoted YAML scalars: the command itself contains double quotes
        // (the quoted relay path), and nesting them inside a double-quoted scalar
        // would need escaping that is easy to get wrong and impossible to read.
        """
        \(hermesBeginMarker) — managed by Coucou. Edits inside these markers are overwritten.
        hooks:
          pre_tool_call:
            - matcher: "\(hermesGateMatcher)"
              command: '\(hookCommand) pre_tool_call'
              timeout: 130
          post_tool_call:
            - command: '\(hookCommand) post_tool_call'
              timeout: 10
        \(hermesEndMarker)
        """
    }

    /// `existing` with Coucou's block installed (`hookCommand` non-nil) or removed (nil).
    ///
    /// Refuses to touch a file whose top-level `hooks:` key is not ours, because a
    /// line-based merge into somebody else's YAML mapping is how you corrupt config.
    static func mergeHermesConfig(existing: String, hookCommand: String?) -> Result<String, String> {
        let hasOurs = existing.contains(hermesBeginMarker)
        var body = existing

        // Strip any previous block of ours first, so install is idempotent and
        // uninstall leaves the file exactly as we found it.
        if hasOurs {
            var kept: [String] = []
            var inside = false
            for line in existing.components(separatedBy: "\n") {
                if line.hasPrefix(hermesBeginMarker) { inside = true; continue }
                if line.hasPrefix(hermesEndMarker) { inside = false; continue }
                if !inside { kept.append(line) }
            }
            body = kept.joined(separator: "\n")
        }

        guard let hookCommand else {
            // Uninstall: collapse the blank lines our block left behind.
            while body.contains("\n\n\n") { body = body.replacingOccurrences(of: "\n\n\n", with: "\n\n") }
            return .success(body)
        }

        // Refuse a foreign hooks: key — but only when we have not already taken it over.
        if !hasOurs, body.range(of: "(?m)^hooks:\\s*$", options: .regularExpression) != nil {
            return .failure(
                "~/.hermes/config.yaml already has a top-level `hooks:` key that Coucou "
                + "does not manage. Nothing was written — paste this block into it "
                + "yourself:\n\n\(hermesConfigBlock(hookCommand: hookCommand))"
            )
        }

        var out = body
        if !out.isEmpty, !out.hasSuffix("\n") { out += "\n" }
        if !out.isEmpty, !out.hasSuffix("\n\n") { out += "\n" }
        out += hermesConfigBlock(hookCommand: hookCommand) + "\n"
        return .success(out)
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bash scripts/test-agent-dialect.sh`
Expected: PASS, printing `AgentDialect tests passed`.

- [ ] **Step 5: Wire the installer into `HookServer.swift`**

Add next to the Muse installer (around line 2040), following the same preview/backup/fingerprint shape:

```swift
    // MARK: - Hermes Agent hook installer

    static var hermesConfigURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".hermes/config.yaml")
    }

    /// The command Hermes runs. /bin/sh keeps the space in "Application Support" a
    /// path, exactly like every other macOS hook we install.
    static var hermesHookCommand: String {
        "/bin/sh \"\(hookScriptPath)\" --agent hermes"
    }

    static func hermesHooksInstalled() -> Bool {
        guard let text = try? String(contentsOf: hermesConfigURL, encoding: .utf8) else { return false }
        return text.contains(AgentDialect.hermesBeginMarker)
    }

    private var _pendingHermesData: Data?
    private var _pendingHermesFingerprint: String?

    func previewHermesHooks(install: Bool) throws -> String {
        let url = Self.hermesConfigURL
        let exists = FileManager.default.fileExists(atPath: url.path)
        if !install && !exists {
            throw NSError(domain: "CoucouNoop", code: 0, userInfo: [
                NSLocalizedDescriptionKey: "No Hermes hooks to remove."
            ])
        }
        let current = exists ? try Data(contentsOf: url) : Data()
        _pendingHermesFingerprint = sha256Hex(current)
        let text = exists ? (String(data: current, encoding: .utf8) ?? "") : ""
        let merged = try AgentDialect.mergeHermesConfig(
            existing: text,
            hookCommand: install ? Self.hermesHookCommand : nil
        ).get()
        let data = Data(merged.utf8)
        _pendingHermesData = data
        return merged
    }

    func writeHermesHooks() throws {
        guard let data = _pendingHermesData, let fp = _pendingHermesFingerprint else { return }
        let url = Self.hermesConfigURL
        let current = (try? Data(contentsOf: url)) ?? Data()
        guard sha256Hex(current) == fp else {
            throw NSError(domain: "Coucou", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "~/.hermes/config.yaml changed since preview. Refresh and try again."
            ])
        }
        try writeTextFile(data, to: url, suffix: "config.yaml")
        _pendingHermesData = nil
        _pendingHermesFingerprint = nil
    }
```

`writeTextFile` is `writeJSONFile` renamed and generalised (it already takes `Data`, so only the name and the backup suffix change) — reuse it rather than adding a second writer. Update its two existing call sites.

- [ ] **Step 6: Verify the app builds**

Run: `cd NotchBuddy && xcodegen && xcodebuild -scheme NotchBuddy -configuration Debug build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`
Expected: BUILD SUCCEEDED.

- [ ] **Step 7: Commit**

```bash
git add NotchBuddy/Sources/CoucouKit/AgentDialect.swift \
        NotchBuddy/Sources/App/HookServer.swift tests/AgentDialectTests.swift
git commit -m "feat(hermes): install and remove the Hermes shell-hook block"
```

---

# Task 6: Harden the OpenCode plugin for the current API and for Windows

The shipped plugin was written against an older OpenCode and hard-codes `/bin/sh`. It still works on macOS but gets `cwd` from the wrong place and cannot run on Windows.

**Files:**
- Modify: `NotchBuddy/Sources/App/HookServer.swift` (`buildOpenCodePluginContent()`, ~line 2177)
- Modify: `tests/AgentDialectTests.swift` (token assertions on the generated plugin)

**Interfaces:**
- Consumes: `Self.hookScriptPath` (existing).
- Produces: the generated plugin text, asserted to contain `process.platform`, `coucou-hook.exe`, `--agent opencode`, `ctx.directory`, `session.diff`, `'generated by Coucou'`.

- [ ] **Step 1: Write the failing test**

The plugin text is generated by `HookServer`, which cannot be compiled standalone. Pin it the way the repo already pins plugin identity — by asserting on the source, from the same shell test:

Append to `scripts/test-agent-dialect.sh`, after the `swiftc` block:

```bash
# The generated OpenCode plugin must stay Windows-capable and must keep the
# markers that openCodePluginInstalled() / removeOpenCodePlugin() look for.
SRC="NotchBuddy/Sources/App/HookServer.swift"
for token in "process.platform" "coucou-hook.exe" "--agent', 'opencode'" \
             "ctx.directory" "session.diff" "generated by Coucou" "coucou_agent"; do
  if ! grep -qF -- "$token" "$SRC"; then
    echo "MISSING from the generated OpenCode plugin: $token"
    exit 1
  fi
done
echo "opencode plugin tokens OK"
```

Run: `bash scripts/test-agent-dialect.sh`
Expected: FAIL — `MISSING from the generated OpenCode plugin: process.platform`.

- [ ] **Step 2: Replace the plugin body**

Replace the body of `buildOpenCodePluginContent()` with:

```swift
    private func buildOpenCodePluginContent() -> String {
        let path = Self.hookScriptPath
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
        return """
// Coucou hook plugin for OpenCode — generated by Coucou.app
// Forwards every event to the Coucou notch (fire-and-forget, never blocks).
//
// One file for every platform: macOS and Linux go through /bin/sh so the space in
// "Application Support" stays a path, Windows spawns the relay exe directly.
// Kept in sync by hand with the copy generated by windows/src-tauri/src/agents.rs —
// scripts/test-agent-dialect.sh and its Rust twin both assert the same tokens.
import { spawn } from 'node:child_process';

const HOOK = '\(path)';
const IS_WINDOWS = process.platform === 'win32';

const EVENT_MAP = {
  'session.created': 'SessionStart',
  'session.idle': 'Stop',
  'session.error': 'StopFailure',
  'session.deleted': 'SessionEnd',
  'permission.asked': 'Notification',
};

function forward(hook_event_name, payload) {
  const body = JSON.stringify({
    hook_event_name,
    coucou_agent: 'opencode',
    ...payload,
  }) + '\\n';

  // Fire-and-forget: detached + unref, so a slow or absent Coucou costs OpenCode
  // nothing. stdout is ignored — this plugin never returns a decision.
  const child = IS_WINDOWS
    ? spawn(HOOK, ['--agent', 'opencode', hook_event_name],
            { stdio: ['pipe', 'ignore', 'ignore'], detached: true })
    : spawn('/bin/sh', [HOOK, '--agent', 'opencode', hook_event_name],
            { stdio: ['pipe', 'ignore', 'ignore'], detached: true });

  child.on('error', () => {});
  child.stdin.on('error', () => {});
  child.stdin.write(body);
  child.stdin.end();
  child.unref();
}

export const CoucouPlugin = async (ctx) => {
  // ctx.directory is the reliable cwd; event payloads spell it differently per build.
  const cwd = ctx?.directory || ctx?.worktree || '';

  const base = (sessionId) => ({ session_id: sessionId || '', cwd });

  return {
    event: async ({ event }) => {
      const hook_event_name = EVENT_MAP[event.type];
      if (!hook_event_name) return;
      const props = event.properties || {};

      // permission.asked is display-only: OpenCode exposes it as an observable
      // event, not a hook that can return a decision. The trailing "?" puts the
      // pill in its question state and the card reads "Handled in OpenCode."
      if (event.type === 'permission.asked') {
        const tool = props.tool || props.permission || 'a tool';
        forward('Notification', { ...base(event.sessionID), message: `Allow ${tool}?` });
        return;
      }

      // session.diff carries the changed files: this is what makes the +N -M
      // ticker work for OpenCode the way it does for Claude Code.
      if (event.type === 'session.diff' && Array.isArray(props.diff)) {
        for (const file of props.diff) {
          forward('PostToolUse', {
            ...base(event.sessionID),
            tool_name: 'Edit',
            tool_input: { file_path: file.file || file.path || '', diff: file.patch || '' },
          });
        }
        return;
      }

      const payload = base(event.sessionID || props.sessionID || props.session_id);
      if (typeof props.tool === 'string') payload.tool_name = props.tool;
      if (props.input != null) payload.tool_input = props.input;
      forward(hook_event_name, payload);
    },

    'tool.execute.before': async (input) => {
      forward('PreToolUse', {
        ...base(input.sessionID || input.session_id),
        tool_name: typeof input.tool === 'string' ? input.tool : '',
        tool_input: input.input ?? null,
      });
    },

    'tool.execute.after': async (input) => {
      forward('PostToolUse', {
        ...base(input.sessionID || input.session_id),
        tool_name: typeof input.tool === 'string' ? input.tool : '',
      });
    },
  };
};
"""
    }
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `bash scripts/test-agent-dialect.sh`
Expected: PASS — `AgentDialect tests passed` then `opencode plugin tokens OK`.

- [ ] **Step 4: Verify install/uninstall round-trips**

Run: `bash scripts/test-hook-relay-dialect.sh && cd NotchBuddy && xcodegen && xcodebuild -scheme NotchBuddy -configuration Debug build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO`
Expected: PASS then BUILD SUCCEEDED.

- [ ] **Step 5: Commit**

```bash
git add NotchBuddy/Sources/App/HookServer.swift scripts/test-agent-dialect.sh
git commit -m "feat(opencode): harden the plugin for the current API and for Windows"
```

---

# Task 7: macOS routing and Hermes approvals

Wiring. Three small edits in `HookServer.swift` plus the settings UI.

**Files:**
- Modify: `NotchBuddy/Sources/App/HookServer.swift` (`upsertExternalAgent`, `processEvent` notes, `processPermissionRequest`)
- Modify: `NotchBuddy/Sources/App/SettingsView.swift`
- Modify: `NotchBuddy/Resources/Localizable.xcstrings`

**Interfaces:**
- Consumes: `AgentDialect` (Task 4), `HookServer.previewHermesHooks` / `writeHermesHooks` (Task 5).
- Produces: `agent_hermes` reaches the approval path; pill colour comes from the catalog.

- [ ] **Step 1: Make the pill colour come from the catalog**

At `HookServer.swift:593`, replace:

```swift
        let color = IslandConst.colorForProject(name)
```

with:

```swift
        // Declared agents take their colour from PillCatalog — the single source of
        // truth. Undeclared agents keep the hashed project colour they always had.
        let color = AgentDialect.pillColor(forAgent: name) ?? IslandConst.colorForProject(name)
```

- [ ] **Step 2: Add the note text**

At `HookServer.swift:413-417`, add before `default:`:

```swift
            case "agent_hermes":  handledNote = "Handled in Hermes."
            case "agent_opencode": handledNote = "Handled in OpenCode."
```

At `HookServer.swift:755-759`, add before `default:`:

```swift
            case "agent_hermes":  note = "Handled in Hermes."
            case "agent_opencode": note = "Handled in OpenCode."
```

At `HookServer.swift:776-780`, add before `default:`:

```swift
            case "agent_hermes":  note = "Still waiting in Hermes."
            case "agent_opencode": note = "Still waiting in OpenCode."
```

- [ ] **Step 3: Make Hermes approval-capable**

At `HookServer.swift:664-672`, add Hermes to the approval-capable set:

```swift
        let isCodexRequest   = rawAgent == "codex"
        let isCopilotRequest = rawAgent == "copilot"
        let isMuseRequest    = rawAgent == "muse"
        // Hermes' pre_tool_call hook can block, so Allow/Deny is enforceable.
        // OpenCode's API cannot return a decision, so it stays display-only and
        // falls through to the decline path below — the card says "Handled in OpenCode."
        let isHermesRequest  = AgentDialect(agent: rawAgent)?.allowsApproval == true
```

and extend the decline guard at line 672 to `&& !isHermesRequest`, and the pill-ID chain at 683-689 with:

```swift
        } else if isHermesRequest {
            pillId = "agent_hermes"
```

- [ ] **Step 4: Add the Settings group box**

In `SettingsView.swift`, mirror the Amp box (line 728) with a Hermes box directly after it, plus the state fields next to lines 67-75:

```swift
    @State private var hermesHooksInstalled: Bool = HookServer.hermesHooksInstalled()
    @State private var showHermesDiff: Bool = false
    @State private var pendingHermesContent: String = ""
    @State private var hermesPendingInstall: Bool = true
```

```swift
        GroupBox(String(localized: "plugin.hermes.title")) {
            VStack(alignment: .leading, spacing: 8) {
                Text(hermesHooksInstalled
                     ? String(localized: "plugin.hermes.installed")
                     : "~/.hermes/config.yaml")
                    .font(.caption).foregroundStyle(.secondary)
                HStack {
                    Button(String(localized: "plugin.install")) { triggerHermesPreview(install: true) }
                    Button(String(localized: "hooks.uninstall")) { triggerHermesPreview(install: false) }
                }
                if showHermesDiff {
                    ScrollView {
                        Text(pendingHermesContent)
                            .font(.system(.caption, design: .monospaced))
                            .textSelection(.enabled)
                    }
                    .frame(maxHeight: 220)
                    HStack {
                        Button(String(localized: "hooks.confirm-write")) { confirmHermesOp() }
                        Button(String(localized: "Cancel")) { showHermesDiff = false; pendingHermesContent = "" }
                    }
                }
            }
        }
```

and the two action functions beside `triggerAmpPreview` / `confirmAmpOp` (line 1354+):

```swift
    private func triggerHermesPreview(install: Bool) {
        do {
            hermesPendingInstall = install
            pendingHermesContent = try HookServer.shared.previewHermesHooks(install: install)
            showHermesDiff = true
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func confirmHermesOp() {
        do {
            if hermesPendingInstall {
                try HookServer.shared.writeHermesHooks()
            } else {
                try HookServer.shared.writeHermesHooks()
            }
            showHermesDiff = false
            pendingHermesContent = ""
            hermesHooksInstalled = hermesPendingInstall
            statusMessage = hermesPendingInstall
                ? String(localized: "plugin.hermes.install-ok")
                : String(localized: "plugin.hermes.remove-ok")
        } catch {
            statusMessage = error.localizedDescription
        }
    }
```

- [ ] **Step 5: Add the localisation keys**

In `NotchBuddy/Resources/Localizable.xcstrings`, add four keys mirroring the existing `plugin.amp.*` entries: `plugin.hermes.title`, `plugin.hermes.installed`, `plugin.hermes.install-ok`, `plugin.hermes.remove-ok`.

- [ ] **Step 6: Build and check**

Run:
```bash
bash scripts/test-agent-dialect.sh
cd NotchBuddy && xcodegen && xcodebuild -scheme NotchBuddy -configuration Debug build CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO
```
Expected: tests PASS, BUILD SUCCEEDED, no missing-localization warnings for `plugin.hermes.*`.

- [ ] **Step 7: Commit**

```bash
git add NotchBuddy/Sources/App/HookServer.swift NotchBuddy/Sources/App/SettingsView.swift \
        NotchBuddy/Resources/Localizable.xcstrings
git commit -m "feat(hermes): route Hermes, enable its approvals, add the settings box"
```

---

# Task 8: Windows agent metadata

The Windows pill colour is a hash today, so `agent_hermes` and `agent_opencode` would be a random colour instead of the catalog colour — visibly different from macOS, which is exactly the "same high quality" the brief asks for.

**Files:**
- Create: `windows/src/core/agents.ts`
- Modify: `windows/src/island/hooks.ts` (`agentColor`, `validateAgent` usage, note text)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export interface AgentMeta { name: string; color: string; allowsApproval: boolean }`
  - `export const AGENT_META: Record<string, AgentMeta>`
  - `export function agentMeta(agent: string): AgentMeta`

- [ ] **Step 1: Write the failing test**

Create `windows/src/core/agents.test.mjs`:

```js
// Minimal assert-based check, runnable with `node` and no framework.
import assert from "node:assert/strict";

const { agentMeta, AGENT_META } = await import("./agents.ts").catch(async () => {
  // Node cannot import .ts directly; the check compiles it first via tsc.
  return import("../.agents-build/agents.js");
});

assert.equal(agentMeta("hermes").name, "Hermes");
assert.equal(agentMeta("hermes").color, "#A78BFA");
assert.equal(agentMeta("hermes").allowsApproval, true);

assert.equal(agentMeta("opencode").name, "OpenCode");
assert.equal(agentMeta("opencode").color, "#4ADE80");
assert.equal(agentMeta("opencode").allowsApproval, false);

// Unknown agents still get a usable, deterministic colour.
const a = agentMeta("some-tool");
assert.ok(a.color.startsWith("#"), "an unknown agent still gets a colour");
assert.equal(a.color, agentMeta("some-tool").color, "the fallback colour is stable");
assert.equal(a.allowsApproval, false, "an unknown agent cannot approve");

// The two entries that mirror PillCatalog.swift must match it exactly.
assert.deepEqual(
  Object.fromEntries(Object.entries(AGENT_META).map(([k, v]) => [k, v.color])),
  { hermes: "#A78BFA", opencode: "#4ADE80" }
);

console.log("agents metadata OK");
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd windows && node --experimental-strip-types src/core/agents.test.mjs`
Expected: FAIL — `Cannot find module './agents.ts'` / `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Write the implementation**

Create `windows/src/core/agents.ts`:

```ts
// Agent metadata for the Windows and Linux front-end.
//
// Mirrors the agent entries in NotchBuddy/Sources/CoucouKit/PillCatalog.swift. Two
// copies exist because Swift and TypeScript cannot share a constant; the colours
// below are asserted against the Swift values by scripts/test-agent-dialect.sh on
// the macOS side and by agents.test.mjs here.
// ponytail: hand-maintained, two places to edit when a pill is added. Upgrade path:
// generate this file from PillCatalog.swift at build time.
export interface AgentMeta {
  /** Display name shown next to the pill. */
  name: string;
  /** Pill colour, matching PillCatalog. */
  color: string;
  /** True when Allow/Deny from the island actually reaches the agent. */
  allowsApproval: boolean;
}

export const AGENT_META: Record<string, AgentMeta> = {
  hermes: { name: "Hermes", color: "#A78BFA", allowsApproval: true },
  opencode: { name: "OpenCode", color: "#4ADE80", allowsApproval: false },
};

const FALLBACK_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

/** Deterministic colour for an agent we have no metadata for. */
function hashedColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
}

/** Never throws: an unknown agent gets a stable colour and no approval. */
export function agentMeta(agent: string): AgentMeta {
  return AGENT_META[agent] ?? {
    name: agent,
    color: hashedColor(agent),
    allowsApproval: false,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd windows && node --experimental-strip-types src/core/agents.test.mjs`
Expected: PASS, printing `agents metadata OK`.

- [ ] **Step 5: Wire it into the island**

In `windows/src/island/hooks.ts`, delete the local `FALLBACK_COLORS` and `agentColor` (lines 37-45) and import the shared metadata:

```ts
import { agentMeta } from "../core/agents";
```

Replace the `ensurePill` body (lines 177-183):

```ts
  const ensurePill = () => {
    if (isExternalAgent) {
      // Name and colour come from the catalog mirror, so an agent looks the same
      // here as it does in the notch on macOS.
      const meta = agentMeta(validAgent!);
      State.upsertExternalAgent(agentId, meta.name, meta.color);
    } else {
      upsert(projectName, cwd);
    }
  };
```

- [ ] **Step 6: Verify the front-end builds**

Run: `cd windows && npm run build`
Expected: `tsc --noEmit` clean, then vite build succeeds.

- [ ] **Step 7: Commit**

```bash
git add windows/src/core/agents.ts windows/src/core/agents.test.mjs windows/src/island/hooks.ts
git commit -m "feat(agents): catalog-matched agent colours on Windows and Linux"
```

---

# Task 9: OpenCode plugin installer in the Tauri backend

Windows and Linux have no agent installer at all today. This adds the first one, and the shared file helpers the Hermes installer will reuse.

**Files:**
- Modify: `windows/src-tauri/src/hooks.rs` (expose three helpers)
- Create: `windows/src-tauri/src/agents.rs`
- Modify: `windows/src-tauri/src/lib.rs` (`mod agents;`)

**Interfaces:**
- Consumes: `hooks::{fingerprint, write_like, unified_diff}` (made `pub(crate)`), `platform::home_dir`.
- Produces:
  - `pub fn opencode_plugin_path() -> PathBuf`
  - `pub fn opencode_status() -> AgentStatus`
  - `pub fn opencode_preview(install: bool) -> Result<AgentPreview, String>`
  - `pub fn opencode_write(install: bool, fingerprint: &str) -> Result<String, String>`
  - `pub struct AgentStatus { installed: bool, path: String }`
  - `pub struct AgentPreview { diff: String, backup: String, path: String, fingerprint: String }`
  - `pub const OPENCODE_PLUGIN_JS: &str` (with a `__HOOK__` placeholder)

- [ ] **Step 1: Write the failing test**

Append to `windows/src-tauri/src/agents.rs` as you create it — the tests live with the code, as in `hooks.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_plugin_is_windows_capable_and_keeps_its_identity_markers() {
        let js = opencode_plugin_source("C:/Users/x/AppData/Local/coucou/bin/coucou-hook.exe");
        // opencode_plugin_installed() looks for these; losing one breaks uninstall.
        assert!(js.contains(OPENCODE_MARKER));
        assert!(js.contains("--agent', 'opencode'"));
        assert!(js.contains("coucou_agent: 'opencode'"));
        // Windows support.
        assert!(js.contains("process.platform === 'win32'"));
        assert!(js.contains("coucou-hook.exe"));
        // Parity with macOS.
        assert!(js.contains("ctx?.directory"));
        assert!(js.contains("session.diff"));
        // The placeholder must be gone.
        assert!(!js.contains("__HOOK__"));
        // Backslashes in the path must be escaped for the JS string literal.
        let win = opencode_plugin_source(r"C:\Users\x\coucou-hook.exe");
        assert!(win.contains(r"C:\\Users\\x\\coucou-hook.exe"), "{win}");
    }

    #[test]
    fn a_foreign_plugin_file_is_never_deleted() {
        // Anything not generated by Coucou is left alone on uninstall.
        assert!(is_ours("// Coucou hook plugin for OpenCode — generated by Coucou.app"));
        assert!(!is_ours("// my own plugin"));
        assert!(!is_ours(""));
    }

    #[test]
    fn the_backup_name_is_unique_per_second() {
        let p = PathBuf::from("/tmp/opencode/coucou.js");
        let a = hooks::backup_path_for(&p, "20261007-120000");
        let b = hooks::backup_path_for(&p, "20261007-120001");
        assert_ne!(a, b);
        assert!(a.to_string_lossy().contains("20261007-120000"));
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd windows/src-tauri && cargo test agents::`
Expected: FAIL to compile — `file not found for module 'agents'` / `cannot find function 'opencode_plugin_source'`.

- [ ] **Step 3: Expose the shared helpers in `hooks.rs`**

In `windows/src-tauri/src/hooks.rs`:

```rust
// Was `fn backup_path()`. Generalised so the agent installers in agents.rs share
// one backup convention instead of growing a second one.
pub(crate) fn backup_path_for(path: &Path, stamp: &str) -> PathBuf {
    path.with_file_name(format!(
        "{}.bak-{}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        stamp
    ))
}

fn backup_path() -> PathBuf {
    backup_path_for(&settings_path(), &stamp())
}
```

and change the visibility of `fingerprint`, `write_like` and `unified_diff` from `fn` to `pub(crate) fn`. Also make `stamp()` `pub(crate)` so `agents.rs` uses the same timestamp format.

- [ ] **Step 4: Write the implementation**

Create `windows/src-tauri/src/agents.rs`:

```rust
// OpenCode plugin and Hermes shell-hook installation.
//
// Kept out of hooks.rs on purpose: that file is entirely about Claude Code's
// settings.json, and the merge rules here are different (a JS file we own outright,
// and a YAML block we own between markers). Same preview/backup/confirm discipline.

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::{hooks, platform};

/// Identifies a file Coucou generated, and is checked before deleting anything.
pub const OPENCODE_MARKER: &str = "generated by Coucou";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub installed: bool,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPreview {
    pub diff: String,
    pub backup: String,
    pub path: String,
    /// The bytes this diff was computed from; handed back to `write` so we only
    /// ever apply what the user actually looked at.
    pub fingerprint: String,
}

pub fn opencode_plugin_path() -> PathBuf {
    // XDG-style on every platform, which is what OpenCode itself uses — that is
    // why OpenCode works on Windows and Amp does not.
    platform::home_dir().join(".config/opencode/plugins/coucou.js")
}

fn is_ours(text: &str) -> bool {
    text.contains(OPENCODE_MARKER)
}

/// The generated plugin, with the relay path substituted in.
///
/// ponytail: the same JavaScript exists as a Swift string literal in HookServer.swift
/// for the macOS app. Two copies because the two apps are separate binaries; both
/// sides assert the same tokens in their own test, so a drift shows up as a failure
/// rather than as a silently broken agent.
pub fn opencode_plugin_source(hook_exe: &str) -> String {
    // Backslashes would start an escape inside the JS single-quoted literal.
    let hook = hook_exe.replace('\\', "\\\\").replace('\'', "\\'");
    OPENCODE_PLUGIN_JS.replace("__HOOK__", &hook)
}

pub const OPENCODE_PLUGIN_JS: &str = r##"// Coucou hook plugin for OpenCode — generated by Coucou.app
// Forwards every event to the Coucou island (fire-and-forget, never blocks).
import { spawn } from 'node:child_process';

const HOOK = '__HOOK__';
const IS_WINDOWS = process.platform === 'win32';

const EVENT_MAP = {
  'session.created': 'SessionStart',
  'session.idle': 'Stop',
  'session.error': 'StopFailure',
  'session.deleted': 'SessionEnd',
  'permission.asked': 'Notification',
};

function forward(hook_event_name, payload) {
  const body = JSON.stringify({
    hook_event_name,
    coucou_agent: 'opencode',
    ...payload,
  }) + '\n';

  const child = IS_WINDOWS
    ? spawn(HOOK, ['--agent', 'opencode', hook_event_name],
            { stdio: ['pipe', 'ignore', 'ignore'], detached: true })
    : spawn('/bin/sh', [HOOK, '--agent', 'opencode', hook_event_name],
            { stdio: ['pipe', 'ignore', 'ignore'], detached: true });

  child.on('error', () => {});
  child.stdin.on('error', () => {});
  child.stdin.write(body);
  child.stdin.end();
  child.unref();
}

export const CoucouPlugin = async (ctx) => {
  const cwd = ctx?.directory || ctx?.worktree || '';
  const base = (sessionId) => ({ session_id: sessionId || '', cwd });

  return {
    event: async ({ event }) => {
      const hook_event_name = EVENT_MAP[event.type];
      if (!hook_event_name) return;
      const props = event.properties || {};

      if (event.type === 'permission.asked') {
        const tool = props.tool || props.permission || 'a tool';
        forward('Notification', { ...base(event.sessionID), message: `Allow ${tool}?` });
        return;
      }

      if (event.type === 'session.diff' && Array.isArray(props.diff)) {
        for (const file of props.diff) {
          forward('PostToolUse', {
            ...base(event.sessionID),
            tool_name: 'Edit',
            tool_input: { file_path: file.file || file.path || '', diff: file.patch || '' },
          });
        }
        return;
      }

      const payload = base(event.sessionID || props.sessionID || props.session_id);
      if (typeof props.tool === 'string') payload.tool_name = props.tool;
      if (props.input != null) payload.tool_input = props.input;
      forward(hook_event_name, payload);
    },

    'tool.execute.before': async (input) => {
      forward('PreToolUse', {
        ...base(input.sessionID || input.session_id),
        tool_name: typeof input.tool === 'string' ? input.tool : '',
        tool_input: input.input ?? null,
      });
    },

    'tool.execute.after': async (input) => {
      forward('PostToolUse', {
        ...base(input.sessionID || input.session_id),
        tool_name: typeof input.tool === 'string' ? input.tool : '',
      });
    },
  };
};
"##;

fn read_text(path: &Path) -> Result<Option<String>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).to_string())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(format!("Can't read {}: {err}", path.display())),
    }
}

pub fn opencode_status() -> AgentStatus {
    let path = opencode_plugin_path();
    let installed = std::fs::read(&path)
        .map(|b| is_ours(&String::from_utf8_lossy(&b)))
        .unwrap_or(false);
    AgentStatus { installed, path: path.to_string_lossy().to_string() }
}

pub fn opencode_preview(install: bool) -> Result<AgentPreview, String> {
    let path = opencode_plugin_path();
    let current = read_text(&path)?.unwrap_or_default();

    if !install && !is_ours(&current) {
        return Err("No Coucou OpenCode plugin to remove.".into());
    }

    let next = if install {
        opencode_plugin_source(&crate::settings::hook_exe_path().to_string_lossy())
    } else {
        String::new()
    };

    Ok(AgentPreview {
        diff: hooks::unified_diff(&current, &next),
        backup: hooks::backup_path_for(&path, &hooks::stamp()).to_string_lossy().to_string(),
        path: path.to_string_lossy().to_string(),
        fingerprint: hooks::fingerprint(current.as_bytes()),
    })
}

/// Writes the plugin (or deletes it), after a dated backup and only if the file
/// still matches what the user reviewed.
pub fn opencode_write(install: bool, fingerprint: &str) -> Result<String, String> {
    let path = opencode_plugin_path();
    let current = read_text(&path)?.unwrap_or_default();

    if hooks::fingerprint(current.as_bytes()) != fingerprint {
        return Err(format!(
            "{} changed since the preview. Nothing was written — review the new diff.",
            path.display()
        ));
    }

    let mut backup = String::new();
    if path.exists() {
        let b = hooks::backup_path_for(&path, &hooks::stamp());
        std::fs::copy(&path, &b).map_err(|e| format!("backup failed: {e}"))?;
        backup = b.to_string_lossy().to_string();
    }

    if !install {
        // Refuse to delete a file we did not write.
        if path.exists() && !is_ours(&current) {
            return Err(format!(
                "{} was not generated by Coucou — not deleting it.",
                path.display()
            ));
        }
        std::fs::remove_file(&path).map_err(|e| format!("delete failed: {e}"))?;
        return Ok(backup);
    }

    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let text = opencode_plugin_source(&crate::settings::hook_exe_path().to_string_lossy());
    let temp = path.with_extension(format!("js.coucou-{}", std::process::id()));
    hooks::write_like(&temp, &path, text.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("write failed: {e}"))?;
    Ok(backup)
}
```

- [ ] **Step 5: Register the module**

In `windows/src-tauri/src/lib.rs`, add `mod agents;` to the module list (alphabetically first, before `claude;`).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd windows/src-tauri && cargo test`
Expected: PASS — the three new tests plus every existing `hooks::` test.

- [ ] **Step 7: Commit**

```bash
git add windows/src-tauri/src/agents.rs windows/src-tauri/src/hooks.rs windows/src-tauri/src/lib.rs
git commit -m "feat(opencode): install the plugin from the Tauri app"
```

---

# Task 10: Hermes `config.yaml` installer in the Tauri backend

Same discipline as Task 9, but the target is a file the user owns, in a format we deliberately do not parse.

**Files:**
- Modify: `windows/src-tauri/src/agents.rs`

**Interfaces:**
- Consumes: `hooks::{fingerprint, write_like, unified_diff, backup_path_for, stamp}`.
- Produces:
  - `pub fn hermes_config_path() -> PathBuf`
  - `pub fn hermes_status() -> AgentStatus`
  - `pub fn hermes_preview(install: bool) -> Result<AgentPreview, String>`
  - `pub fn hermes_write(install: bool, fingerprint: &str) -> Result<String, String>`
  - `pub const HERMES_BEGIN: &str` = `"# coucou:begin"`, `pub const HERMES_END: &str` = `"# coucou:end"`
  - `pub fn hermes_config_block(hook_command: &str) -> String`
  - `pub fn merge_hermes_config(existing: &str, hook_command: Option<&str>) -> Result<String, String>`

- [ ] **Step 1: Write the failing test**

Append to `mod tests` in `windows/src-tauri/src/agents.rs`:

```rust
    #[test]
    fn the_hermes_block_is_marker_scoped_and_never_fail_closed() {
        let block = hermes_config_block(r#""C:/x/coucou-hook.exe" --agent hermes"#);
        assert!(block.starts_with(HERMES_BEGIN));
        assert!(block.ends_with(HERMES_END));
        assert!(block.contains("pre_tool_call:"));
        assert!(block.contains("post_tool_call:"));
        assert!(block.contains("matcher:"));
        assert!(block.contains("timeout: 130"));
        // A closed Coucou must never block Hermes: fail-open is the contract.
        assert!(!block.contains("fail_closed"));
        // The command holds double quotes, so the YAML scalar must be single-quoted.
        assert!(block.contains("command: '"));
        assert!(!block.contains("command: \""));
    }

    #[test]
    fn merging_preserves_the_users_file_and_is_idempotent() {
        let cmd = r#""C:/x/coucou-hook.exe" --agent hermes"#;
        let original = "model: opus\nprofile: default\n";

        let once = merge_hermes_config(original, Some(cmd)).unwrap();
        assert!(once.starts_with("model: opus\nprofile: default\n"));
        assert!(once.contains("pre_tool_call:"));

        let twice = merge_hermes_config(&once, Some(cmd)).unwrap();
        assert_eq!(
            twice.matches(HERMES_BEGIN).count(),
            once.matches(HERMES_BEGIN).count(),
            "re-installing must replace the block, not stack a second one"
        );

        assert_eq!(merge_hermes_config(&once, None).unwrap(), original);
        assert!(merge_hermes_config("", Some(cmd)).unwrap().contains("pre_tool_call:"));
    }

    #[test]
    fn a_foreign_hooks_key_is_refused_not_merged() {
        let cmd = r#""C:/x/coucou-hook.exe" --agent hermes"#;
        let foreign = "model: opus\nhooks:\n  pre_llm_call:\n    - command: mine.sh\n";
        let err = merge_hermes_config(foreign, Some(cmd)).unwrap_err();
        assert!(err.contains("hooks:"), "{err}");
        assert!(err.contains("paste"), "{err}");
    }
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd windows/src-tauri && cargo test agents::`
Expected: FAIL to compile — `cannot find function 'hermes_config_block'`.

- [ ] **Step 3: Write the implementation**

Append to `windows/src-tauri/src/agents.rs`:

```rust
// ── Hermes ────────────────────────────────────────────────────────────────────

pub const HERMES_BEGIN: &str = "# coucou:begin";
pub const HERMES_END: &str = "# coucou:end";

/// Hermes fires `pre_tool_call` for every tool, so the gate is scoped to the tools
/// that change something. Hermes truncates `timeout` at 300 s.
pub const HERMES_GATE_MATCHER: &str = "terminal|write_file|patch";

pub fn hermes_config_path() -> PathBuf {
    // XDG-style on every platform, like OpenCode.
    platform::home_dir().join(".hermes/config.yaml")
}

/// The marker-delimited block Coucou owns inside ~/.hermes/config.yaml.
///
/// ponytail: plain text between markers, not a YAML round-trip — the workspace has
/// no YAML crate and reformatting a user's config would be worse than the problem.
/// Ceiling: a user who already owns a top-level `hooks:` key is refused rather than
/// merged. Upgrade path: adopt a YAML crate if that refusal starts firing often.
pub fn hermes_config_block(hook_command: &str) -> String {
    format!(
        "{HERMES_BEGIN} — managed by Coucou. Edits inside these markers are overwritten.\n\
         hooks:\n\
         \x20 pre_tool_call:\n\
         \x20   - matcher: \"{HERMES_GATE_MATCHER}\"\n\
         \x20     command: '{hook_command} pre_tool_call'\n\
         \x20     timeout: 130\n\
         \x20 post_tool_call:\n\
         \x20   - command: '{hook_command} post_tool_call'\n\
         \x20     timeout: 10\n\
         {HERMES_END}"
    )
}

/// `existing` with Coucou's block installed (`hook_command` = Some) or removed (None).
pub fn merge_hermes_config(
    existing: &str,
    hook_command: Option<&str>,
) -> Result<String, String> {
    let had_ours = existing.contains(HERMES_BEGIN);

    // Strip any previous block of ours, so install is idempotent and uninstall
    // leaves the file exactly as we found it.
    let mut body = String::new();
    if had_ours {
        let mut inside = false;
        for line in existing.lines() {
            if line.starts_with(HERMES_BEGIN) { inside = true; continue; }
            if line.starts_with(HERMES_END) { inside = false; continue; }
            if !inside {
                body.push_str(line);
                body.push('\n');
            }
        }
    } else {
        body = existing.to_string();
    }

    let Some(cmd) = hook_command else {
        while body.contains("\n\n\n") {
            body = body.replace("\n\n\n", "\n\n");
        }
        return Ok(body);
    };

    // Refuse a foreign hooks: key — but only when we have not already taken it over.
    if !had_ours {
        let has_foreign = body.lines().any(|l| {
            let t = l.trim_end();
            t == "hooks:" && !l.starts_with(' ') && !l.starts_with('\t')
        });
        if has_foreign {
            return Err(format!(
                "~/.hermes/config.yaml already has a top-level `hooks:` key that Coucou does \
                 not manage. Nothing was written — paste this block into it yourself:\n\n{}",
                hermes_config_block(cmd)
            ));
        }
    }

    if !body.is_empty() && !body.ends_with('\n') {
        body.push('\n');
    }
    if !body.is_empty() && !body.ends_with("\n\n") {
        body.push('\n');
    }
    body.push_str(&hermes_config_block(cmd));
    body.push('\n');
    Ok(body)
}

pub fn hermes_status() -> AgentStatus {
    let path = hermes_config_path();
    let installed = std::fs::read(&path)
        .map(|b| String::from_utf8_lossy(&b).contains(HERMES_BEGIN))
        .unwrap_or(false);
    AgentStatus { installed, path: path.to_string_lossy().to_string() }
}

pub fn hermes_preview(install: bool) -> Result<AgentPreview, String> {
    let path = hermes_config_path();
    let current = read_text(&path)?.unwrap_or_default();

    if !install && !current.contains(HERMES_BEGIN) {
        return Err("No Coucou Hermes hooks to remove.".into());
    }

    let hook_command = crate::settings::hook_exe_path().to_string_lossy().to_string();
    let cmd = format!("\"{}\" --agent hermes", hook_command);
    let next = merge_hermes_config(&current, install.then_some(cmd.as_str()))?;

    Ok(AgentPreview {
        diff: hooks::unified_diff(&current, &next),
        backup: hooks::backup_path_for(&path, &hooks::stamp()).to_string_lossy().to_string(),
        path: path.to_string_lossy().to_string(),
        fingerprint: hooks::fingerprint(current.as_bytes()),
    })
}

pub fn hermes_write(install: bool, fingerprint: &str) -> Result<String, String> {
    let path = hermes_config_path();
    let current = read_text(&path)?.unwrap_or_default();

    if hooks::fingerprint(current.as_bytes()) != fingerprint {
        return Err(format!(
            "{} changed since the preview. Nothing was written — review the new diff.",
            path.display()
        ));
    }

    let hook_command = crate::settings::hook_exe_path().to_string_lossy().to_string();
    let cmd = format!("\"{}\" --agent hermes", hook_command);
    let next = merge_hermes_config(&current, install.then_some(cmd.as_str()))?;

    let mut backup = String::new();
    if path.exists() {
        let b = hooks::backup_path_for(&path, &hooks::stamp());
        std::fs::copy(&path, &b).map_err(|e| format!("backup failed: {e}"))?;
        backup = b.to_string_lossy().to_string();
    }

    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension(format!("yaml.coucou-{}", std::process::id()));
    hooks::write_like(&temp, &path, next.as_bytes()).map_err(|e| format!("write failed: {e}"))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("write failed: {e}"))?;
    Ok(backup)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd windows/src-tauri && cargo test`
Expected: PASS — all three new tests plus the existing suite.

- [ ] **Step 5: Sanity-check the generated YAML against a real parser**

Run:
```bash
cd windows/src-tauri && cargo test agents::the_hermes_block
python3 -c "
import sys, subprocess
# Regenerate the block exactly as the app would, then parse it.
" 
```
Then verify by hand once: write the block to `/tmp/coucou-hermes.yaml` and run
`python3 -c "import yaml,sys; yaml.safe_load(open('/tmp/coucou-hermes.yaml')); print('yaml ok')"`.
Expected: `yaml ok`. If PyYAML is unavailable, run `hermes hooks doctor` against a `HERMES_HOME` pointing at the file instead — it reports the same parse failure. This is a one-off manual gate; the unit test cannot catch a YAML syntax error on its own.

- [ ] **Step 6: Commit**

```bash
git add windows/src-tauri/src/agents.rs
git commit -m "feat(hermes): install the Hermes shell-hook block from the Tauri app"
```

---

# Task 11: Tauri commands and the Windows settings UI

**Files:**
- Modify: `windows/src-tauri/src/lib.rs` (six `#[tauri::command]` wrappers + registration)
- Modify: `windows/src/core/bridge.ts` (six `Bridge` methods)
- Modify: `windows/src/settings/main.ts` (two settings sections)

**Interfaces:**
- Consumes: `agents::{opencode_status, opencode_preview, opencode_write, hermes_status, hermes_preview, hermes_write}` and the `AgentStatus` / `AgentPreview` structs from Tasks 9-10.
- Produces: Tauri commands `opencode_status`, `opencode_preview`, `opencode_write`, `hermes_status`, `hermes_preview`, `hermes_write`, and the matching `Bridge.*` methods.

- [ ] **Step 1: Add the command wrappers**

Commands live in `lib.rs` as thin wrappers, exactly like `hooks_status` / `hooks_preview` / `hooks_apply` at `windows/src-tauri/src/lib.rs:183-211`. Add a new section after the Claude Code hooks section:

```rust
// ── Agent installers (OpenCode, Hermes) ───────────────────────────────────────

#[tauri::command]
fn opencode_status() -> AgentStatus {
    agents::opencode_status()
}

#[tauri::command]
fn opencode_preview(install: bool) -> Result<AgentPreview, String> {
    agents::opencode_preview(install)
}

/// Only ever called from an explicit click in the settings window.
#[tauri::command]
fn opencode_write(install: bool, fingerprint: String) -> Result<String, String> {
    agents::opencode_write(install, &fingerprint)
}

#[tauri::command]
fn hermes_status() -> AgentStatus {
    agents::hermes_status()
}

#[tauri::command]
fn hermes_preview(install: bool) -> Result<AgentPreview, String> {
    agents::hermes_preview(install)
}

#[tauri::command]
fn hermes_write(install: bool, fingerprint: String) -> Result<String, String> {
    agents::hermes_write(install, &fingerprint)
}
```

Add `use agents::{AgentPreview, AgentStatus};` to the existing `use` block at the top of `lib.rs`, and register all six in the `generate_handler!` list right after `hooks_apply`:

```rust
            hooks_status,
            hooks_preview,
            hooks_apply,
            opencode_status,
            opencode_preview,
            opencode_write,
            hermes_status,
            hermes_preview,
            hermes_write,
```

- [ ] **Step 2: Add the Bridge methods**

In `windows/src/core/bridge.ts`, the existing hooks methods (lines 66-73) are the template — `call<T>` for a command that cannot fail, `callOrThrow<T>` for one that returns `Result`. Add next to them:

```ts
  // Agent installers. Same shape as the hooks methods above: status is
  // infallible, preview/write can refuse (a foreign file, a changed fingerprint).
  opencodeStatus: () => call<AgentStatus>("opencode_status"),
  opencodePreview: (install: boolean) =>
    callOrThrow<AgentPreview>("opencode_preview", { install }),
  opencodeWrite: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("opencode_write", { install, fingerprint }),

  hermesStatus: () => call<AgentStatus>("hermes_status"),
  hermesPreview: (install: boolean) =>
    callOrThrow<AgentPreview>("hermes_preview", { install }),
  hermesWrite: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hermes_write", { install, fingerprint }),
```

and add the two interfaces beside the existing `HookStatus` / `HookPreview` declarations in the same file:

```ts
export interface AgentStatus {
  installed: boolean;
  path: string;
}

export interface AgentPreview {
  diff: string;
  backup: string;
  path: string;
  /** Hand back to `*Write` so only the reviewed diff is ever written. */
  fingerprint: string;
}
```

- [ ] **Step 3: Add the settings sections**

In `windows/src/settings/main.ts`, add one factory below `claudeSection` (which ends at line 172) and call it twice from `main()`. It is a near-copy of `claudeSection`'s structure on purpose — same `h()` / `clear()` / `statusDot()` / `renderDiff()` vocabulary, same preview-then-confirm flow, no new UI concepts:

```ts
/** OpenCode or Hermes: status, install/remove, and a diff to read before writing. */
function agentSection(
  title: string,
  targetPath: string,
  installed: boolean,
  status: () => Promise<AgentStatus>,
  preview: (install: boolean) => Promise<AgentPreview>,
  apply: (install: boolean, fingerprint: string) => Promise<string>,
  hint: string,
): HTMLElement {
  const state = { installed, path: targetPath };
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });
  const section = h("section", {}, h("h2", {}, statusDot(state.installed), h("span", { text: title })), body);

  const rebuild = async () => {
    Object.assign(state, await status());
    clear(body);
    draw();
    const head = section.querySelector("h2")!;
    clear(head);
    head.append(statusDot(state.installed), h("span", { text: title }));
  };

  function draw() {
    body.append(
      h("div", { class: "hint", text: hint }),
      h("div", { class: "row" }, h("label", { text: "File" }), h("span", { class: "path", text: state.path })),
    );
    const actions = h("div", { class: "row" });
    actions.append(h("button", {
      class: "primary",
      text: state.installed ? "Reinstall…" : "Install…",
      onclick: () => showPreview(true),
    }));
    if (state.installed) {
      actions.append(h("button", { class: "danger", text: "Uninstall…", onclick: () => showPreview(false) }));
    }
    body.append(actions);
  }

  async function showPreview(install: boolean) {
    let plan: AgentPreview;
    try {
      plan = await preview(install);
    } catch (err) {
      // A foreign file, or a config we refuse to merge. Show it and stop — never
      // treat "unreadable" as "empty" and write over it.
      clear(body);
      body.append(
        h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
        h("div", { class: "row" }, h("button", { text: "Back", onclick: () => { clear(body); draw(); } })),
      );
      return;
    }
    clear(body);
    body.append(
      h("div", { class: "hint", text: install ? "This is exactly what will change." : "This removes Coucou's entries only." }),
      renderDiff(plan.diff),
      h("div", { class: "row" }, h("span", { class: "path", text: `Backup → ${plan.backup}` })),
    );
    const confirm = h("button", { class: install ? "primary" : "danger", text: install ? "Back up and write" : "Back up and remove" });
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const backup = await apply(install, plan.fingerprint);
        clear(body);
        body.append(h("div", { class: "notice ok", text: `Done. Previous file saved as ${backup}.` }));
        window.setTimeout(() => void rebuild(), 2600);
      } catch (err) {
        confirm.disabled = false;
        body.append(h("div", { class: "notice err", text: `Could not write: ${String(err)}` }));
      }
    });
    body.append(h("div", { class: "row" }, confirm, h("button", { text: "Cancel", onclick: () => { clear(body); draw(); } })));
  }

  draw();
  return section;
}
```

Then in `main()` (line 422), append the two sections after the existing ones:

```ts
    agentsSection.append(
      agentSection(
        "OpenCode",
        (await Bridge.opencodeStatus()).path,
        (await Bridge.opencodeStatus()).installed,
        Bridge.opencodeStatus,
        Bridge.opencodePreview,
        Bridge.opencodeWrite,
        "Sessions, steps and file diffs show up in the island. OpenCode answers its own permission prompts — Coucou shows them but cannot decide for it.",
      ),
      agentSection(
        "Hermes",
        (await Bridge.hermesStatus()).path,
        (await Bridge.hermesStatus()).installed,
        Bridge.hermesStatus,
        Bridge.hermesPreview,
        Bridge.hermesWrite,
        "Sessions and steps show up in the island, and you can allow or deny Hermes tool calls from the notch. Coucou shows the change to ~/.hermes/config.yaml before writing.",
      ),
    );
```

Import `AgentStatus` / `AgentPreview` from `../core/bridge` alongside the existing `HookStatus` import at the top of the file.

- [ ] **Step 4: Verify the front-end and backend build**

Run:
```bash
cd windows && npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```
Expected: `tsc --noEmit` clean, vite build succeeds, all Rust tests pass.

- [ ] **Step 5: Commit**

```bash
git add windows/src-tauri/src/lib.rs windows/src-tauri/src/agents.rs \
        windows/src/core/bridge.ts windows/src/settings/main.ts
git commit -m "feat(agents): OpenCode and Hermes install controls on Windows and Linux"
```

---

# Task 12: Windows routing and Hermes approvals

The last functional gap. Today every external agent's `PermissionRequest` is declined immediately (`windows/src/island/hooks.ts:273-280`), so Hermes could never be approved from the island.

**Files:**
- Modify: `windows/src/island/hooks.ts`

**Interfaces:**
- Consumes: `agentMeta` (Task 8), `validateAgent` (existing).
- Produces: `agent_hermes` reaches the approval card; `agent_opencode` gets the `Handled in OpenCode.` note.

- [ ] **Step 1: Allow approval-capable agents through**

In `windows/src/island/hooks.ts`, replace the `PermissionRequest` external-agent guard:

```ts
    case "PermissionRequest": {
      // Hermes' pre_tool_call hook can block, so a decision from the island is
      // enforceable. OpenCode's plugin API cannot return a decision, so it stays
      // display-only: decline immediately and let OpenCode ask in its terminal.
      if (isExternalAgent && !agentMeta(validAgent!).allowsApproval) {
        if (payload.request_id) void Bridge.approvalDecline(payload.request_id);
        break;
      }
```

Then the rest of the case must key off `agentId`, not `CLAUDE_ID`. Replace every `CLAUDE_ID` inside the `PermissionRequest` case with `agentId`:

```ts
      // ensurePill() rather than the old upsert(projectName, cwd): upsert only ever
      // touches CLAUDE_ID, so a Hermes request would have updated the wrong pill.
      ensurePill();
      if (pendingTimeout != null) window.clearTimeout(pendingTimeout);
      const tool = payload.tool_name ?? "Tool";
      const input = payload.tool_input ?? {};
      State.pendingApproval = {
        requestId,
        sessionId: payload.session_id ?? "",
        tool,
        command: approvalTarget(tool, input),
      };
      if (requestId) void Bridge.approvalAck(requestId);
      State.updateTask(agentId, "approval");
      State.isPinned = true;
      Sound.play("approval");
      if (focused) {
        island.alert("approval");
      } else {
        State.setPillBadge(agentId, "approval");
        island.reveal();
      }
      pendingTimeout = window.setTimeout(() => {
        pendingTimeout = null;
        if (!State.pendingApproval) return;
        State.pendingApproval = null;
        State.isPinned = false;
        island.dropPin();
        State.updateTask(agentId, "working");
        State.setPillBadge(agentId, null);
        if (State.view === "approval") island.setView(State.defaultView());
        State.notify();
      }, 110_000);
      break;
    }
```

`upsert(projectName, cwd)` only ever touches `CLAUDE_ID`, which is why the line above
became `ensurePill()` — an external agent's request must land on that agent's own pill.

- [ ] **Step 2: Make the timeout match the relay's Hermes behaviour**

The 110 s card timeout and the relay's 110 s decision budget are the same number on purpose. Verify they still agree after Task 2: the relay's `DECISION_BUDGET` is 110 s and Hermes' `timeout` in the config block is 130 s, so Hermes never kills the hook before the relay gives up. Add a comment next to the timeout:

```ts
      // 110 s: the same budget as the relay's DECISION_BUDGET and well under the
      // 130 s Hermes allows. When this fires the relay prints its block receipt,
      // so a Hermes tool call is denied rather than silently allowed.
```

- [ ] **Step 3: Verify**

Run:
```bash
cd windows && npm run build
node --experimental-strip-types src/core/agents.test.mjs
```
Expected: build clean, `agents metadata OK`.

- [ ] **Step 4: Commit**

```bash
git add windows/src/island/hooks.ts
git commit -m "feat(hermes): approve Hermes tool calls from the island"
```

---

# Task 13: Docs, changelog and the end-to-end test matrix

**Files:**
- Modify: `README.md` (Supported agents table), `docs/AGENTS.md` (already done in Task 1 — add the platform matrix), `docs/INTEGRATIONS.md`, `CHANGELOG.md`
- Create: `docs/AGENT_TEST_MATRIX.md`

**Interfaces:**
- Consumes: the finished behaviour.
- Produces: a runnable manual matrix, and docs that no longer claim these paths are macOS-only.

- [ ] **Step 1: Update the README supported-agents table**

Replace the `OpenCode` and add a `Hermes` row:

```markdown
| OpenCode | Plugin — **Settings → OpenCode Plugin → Install** | No |
| Amp | Plugin — **Settings → Amp Plugin → Install** | Mac only |
| Hermes | Settings → Hermes → **Install hooks** | No |
```

Remove the sentence after the table that says OpenCode and Amp install into macOS-only paths; keep it for Amp only.

- [ ] **Step 2: Add the platform matrix to `docs/AGENTS.md`**

````markdown
## Platform support matrix

| Agent | macOS | Windows | Linux | Approvals | Why not, where not |
|---|---|---|---|---|---|
| Claude Code | ✅ | ✅ | ✅ | ✅ | — |
| Gemini CLI | ✅ | ❌ | ❌ | ✅ | mac-only hook installer |
| Antigravity | ✅ | ❌ | ❌ | ✅ | mac-only hook installer |
| Codex | ✅ | ✅ | ✅ | ✅ | — |
| Copilot CLI | ✅ | ✅ | ✅ | ✅ | — |
| Muse Code | ✅ | ✅ | ✅ | ✅ | — |
| **OpenCode** | ✅ | ✅ | ✅ | ❌ | plugin API cannot return a decision |
| **Hermes** | ✅ | ✅ | ✅ | ✅ | — |
| Amp | ✅ | ❌ | ❌ | ❌ | mac-only plugin path |
````

- [ ] **Step 3: Write the test matrix**

Create `docs/AGENT_TEST_MATRIX.md`:

````markdown
# Agent integration test matrix

Run every row with Coucou open, then repeat the two "Coucou closed" rows. A row is
only green when the observable column is literally what you saw.

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

| # | Do | Expect |
|---|---|---|
| 1 | Settings → Hermes → Install hooks, read the diff, confirm | `~/.hermes/config.yaml` gains the marker block; a `.bak-*` file appears |
| 2 | `hermes hooks list` | both entries listed, each `✗ not allowlisted` |
| 3 | `hermes --accept-hooks chat`, start a session in a test repo | `agent_hermes` pill appears, coloured `#A78BFA` |
| 4 | Ask Hermes to read a file | pill state `working`, ticker shows `Lit · <file>` |
| 5 | Ask Hermes to run a shell command | **approval card appears** with the command text |
| 6 | Click **Allow** | Hermes runs the command, card clears, state returns to `working` |
| 7 | Ask for another shell command, click **Deny** | Hermes reports a blocked tool; the command does not run |
| 8 | Ask for another shell command, click nothing for 110 s | card clears, Hermes reports the tool blocked, **not** run |
| 9 | Quit Coucou, run a shell command in Hermes | command runs; no pill, no error, Hermes not delayed |
| 10 | Settings → Hermes → Uninstall, confirm | config.yaml is byte-identical to before install |
| 11 | Set a foreign top-level `hooks:` key in config.yaml, then Install | Coucou refuses and prints the block to paste; file untouched |

## Manual — OpenCode

| # | Do | Expect |
|---|---|---|
| 1 | Settings → OpenCode Plugin → Install, read the diff, confirm | `~/.config/opencode/plugins/coucou.js` written |
| 2 | Start OpenCode in a test repo | `agent_opencode` pill appears, coloured `#4ADE80` |
| 3 | Ask OpenCode to read a file, then edit one | ticker steps appear; the pill never sticks in `approval` |
| 4 | Trigger a permission prompt in OpenCode | pill goes to the question state, ticker reads `Allow <tool>?`, card reads `Handled in OpenCode.` |
| 5 | Answer in the OpenCode terminal | pill returns to `working` |
| 6 | Quit Coucou, use OpenCode normally | nothing slows down, no errors in OpenCode's log |
| 7 | Uninstall from Settings | the file is deleted; a `coucou.js.bak-*` sibling exists |
| 8 | Hand-write a plugin at that path, then Uninstall | Coucou refuses: "was not generated by Coucou" |

## Manual — Windows and Linux

| # | Do | Expect |
|---|---|---|
| 1 | Windows: `npm run pack`, install, Settings → Hermes → Install | `%USERPROFILE%\.hermes\config.yaml` gains the block with a **Windows** exe path |
| 2 | Windows: `hermes --accept-hooks chat`, run a tool | `agent_hermes` pill appears with the **same colour** as macOS |
| 3 | Windows: approve from the island | the tool runs; no Git Bash quoting error |
| 4 | Windows: deny from the island | the tool is blocked |
| 5 | Windows: quit Coucou, run a Hermes tool | tool runs, unaffected |
| 6 | Windows: OpenCode plugin install, then use OpenCode | pill appears, `coucou-hook.exe` is spawned directly (no `/bin/sh`) |
| 7 | Linux: same as 5-6 via the AppImage | same |
| 8 | Either: `cargo test` in `windows/hook` and `windows/src-tauri` | all pass |
````

- [ ] **Step 4: Changelog**

Add an unreleased section at the top of `CHANGELOG.md`:

```markdown
## Unreleased

- Hermes Agent sessions show up in the notch: see every step live, and approve or deny
  Hermes tool calls right from the island. Hermes' `pre_tool_call` hook can block, so a
  Deny from Coucou actually stops the tool. Install from Settings → Hermes; Coucou shows
  what will change in `~/.hermes/config.yaml` and backs it up before writing *(macOS, Windows, Linux)*
- OpenCode now works on Windows and Linux, not just macOS: the plugin installs to the same
  `~/.config/opencode/plugins/` path on every platform. OpenCode permissions are shown in
  the ticker and answered in OpenCode's own terminal — its plugin API cannot return a
  decision, so Coucou does not pretend to *(macOS, Windows, Linux)*
- OpenCode sessions show file diffs in the ticker, and every agent pill now uses its
  declared colour on Windows and Linux instead of a random one
```

- [ ] **Step 5: Verify no doc still claims these are macOS-only**

Run:
```bash
bash scripts/test-agent-docs.sh
grep -rn "OpenCode" README.md docs/AGENTS.md | grep -i "mac only\|macOS only\|mac-only"
```
Expected: test PASSES, and the grep returns nothing for OpenCode (an Amp-only hit is fine).

- [ ] **Step 6: Commit**

```bash
git add README.md docs/AGENTS.md docs/INTEGRATIONS.md docs/AGENT_TEST_MATRIX.md CHANGELOG.md
git commit -m "docs: Hermes and OpenCode support, platform matrix, test matrix"
```

---

# End-to-End Flow For The Implementing Agent

Follow this order. Each step is a task above; do not start the next until the gate passes.

1. **Read first.** `CLAUDE.md`, `docs/AGENT_COMPATIBILITY_PLAN.md` (the spec), `docs/AGENTS.md`, `PillCatalog.swift`, `HookServer.swift`, `SettingsView.swift`, `windows/src/island/hooks.ts`, `windows/src-tauri/src/hooks.rs`, `windows/hook/src/main.rs`, `windows/src/core/state.ts`.
2. **Task 1 — contract.** Run `hermes hooks --help` and `opencode --version`. If a name differs from this plan, fix the plan and `docs/AGENTS.md` **before** writing any adapter. Gate: `scripts/test-agent-docs.sh` passes.
3. **Tasks 2-3 — relays.** Rust first, then the Python. Gate: `cargo test` in `windows/hook` and `scripts/test-hook-relay-dialect.sh`.
4. **Task 4 — `AgentDialect.swift`.** Gate: `scripts/test-agent-dialect.sh`.
5. **Tasks 5-7 — macOS app.** Installer, plugin, routing, settings. Gate: `xcodebuild` succeeds and every `scripts/test-*.sh` still passes.
6. **Tasks 8-12 — Windows/Linux.** Metadata, installers, commands, UI, routing. Gate: `npm run build`, `cargo test` (both crates), `agents.test.mjs`.
7. **Task 13 — docs.** Gate: no stale "mac only" claim.
8. **Manual matrix.** Run `docs/AGENT_TEST_MATRIX.md` on macOS and Windows. Every row green, or the row is marked with the reason it cannot pass.

**Stop rules** (from the spec, still binding):

- If Hermes or OpenCode docs disagree with this plan, **follow the live docs** and update the plan and the doc comments. Do not code to a stale plan.
- If an adapter cannot consume a permission decision safely, forward display-only events and leave approval in the agent's terminal. Never fake a decision.
- If installer code would overwrite user config without a preview and a backup, do not ship it.
- If a change would make an agent *less* restricted because Coucou is installed, stop. Coucou must never be a way to bypass a prompt.

**Ponytail check before every commit:** is there a rung higher on the ladder that still holds? Specifically — did you add a file, a flag, a dependency or an abstraction that the task did not require? If yes, delete it before committing.

---

# Spec Coverage

Every phase of `docs/AGENT_COMPATIBILITY_PLAN.md`, mapped to the task that implements it. Two phases were **deliberately narrowed** against live evidence — both are called out with their reason, not silently dropped.

| Spec phase | Task(s) | Notes |
|---|---|---|
| Canonical event contract | 1, 3, 4, 6 | Names pinned in docs, receipts in the dialect table |
| H1 — confirm Hermes hook surfaces | 1 | Hard gate; `hermes hooks --help` decides the final event list |
| H2 — Hermes pill | 4 | `agent_hermes` in `PillCatalog`, `githubOnly: true` |
| H3 — macOS Hermes adapter | 5 | Marker-delimited `config.yaml` block, preview + dated backup + fingerprint |
| H4 — Hermes approval behaviour | 2, 3, 4, 7 | `allowsApproval`, per-dialect receipts, `Still waiting in Hermes.` |
| H5 — Windows/Linux Hermes adapter | 10, 11, 12 | Implemented, not documented away — this is stronger than the spec's "or document macOS-only" |
| O1 — harden macOS OpenCode plugin | 6 | Platform-aware spawn, `ctx.directory`, `session.diff` |
| O2 — OpenCode permission handling | 6 | **Narrowed.** The spec's option 2 assumed a `permission.hook("evaluate")`-style decision hook. The live OpenCode plugin docs (v1.18.33, checked 2026-10-07) list `permission.asked` / `permission.replied` only as *observable events* — there is no hook that can return a decision. So the plan takes the spec's own option 1: forward it display-only and return nothing, and the card says `Handled in OpenCode.` The spec's rule "OpenCode is never less restrictive because Coucou is installed" is satisfied by construction. |
| O3 — Windows/Linux OpenCode support | 9, 11 | Plugin install to the same XDG path on every platform |
| Shared — Settings | 7, 11 | macOS group box + Windows section |
| Shared — Routing | 7, 12 | `agent_hermes` reaches the approval path on both platforms |
| Shared — Docs | 1, 13 | Contract, platform matrix, README, CHANGELOG |
| Test plan — unit | 2, 3, 4, 5, 6, 8, 9, 10 | One runnable check per task |
| Test plan — manual integration | 13 | `docs/AGENT_TEST_MATRIX.md` |
| Test plan — regression | 13 | Existing `scripts/test-*.sh` + both Rust crates + `npm run build` |
| AI coding flow | "End-to-End Flow" | Ordered, with gates and the spec's stop rules |

**One thing the spec asked for that this plan adds beyond it:** the spec's Phase H5 and O3 both allowed "document as unsupported" as an acceptable outcome. The brief for this work requires Windows to be genuinely functional, so every Hermes/OpenCode path here is implemented and tested on Windows and Linux, with no "macOS only" escape hatch for these two agents.

**Two things in the spec that this plan changed:**

1. The spec's Phase H2 suggested adding `case "agent_hermes": return "Hermes"` to `PillDefinition.sessionSubtitle`. Not done: `sessionSubtitle` currently returns `"Agent"` for everything except Claude, Cursor and Codex, so adding a special case for Hermes alone would make Hermes inconsistent with the eight other agents rather than consistent with them. Leave it as `"Agent"`.
2. The spec's Phase H3 suggested `~/.hermes/plugins/coucou.py` as the preferred surface, with shell hooks as a fallback. Inverted: Hermes' plugin system requires the plugin to be listed in `plugins.enabled` **and** is Python-only and in-process, whereas shell hooks are declared in `config.yaml`, are language-agnostic, and are the surface Hermes' own docs lead with. Shell hooks are the smaller, more robust install — one marker block in one file, no plugin discovery to depend on.

---

# Definition Of Done

- Hermes and OpenCode each create their own Coucou pill on macOS, Windows and Linux.
- Tool activity, file diffs and lifecycle (start → working → finished/error → end) all appear in the ticker.
- Hermes Allow/Deny from the island actually reaches the tool; a timeout denies rather than silently allowing.
- OpenCode permissions are surfaced honestly as display-only, with the card saying so.
- A closed Coucou never blocks, delays or errors either agent.
- Every pill carries its declared colour on every platform, and the Mochi animation is the existing shared engine — no per-agent animation code.
- No new third-party dependency on either platform.
- All automated checks in `docs/AGENT_TEST_MATRIX.md` pass; every manual row is green or explicitly justified.
- `CHANGELOG.md`, `README.md`, `docs/AGENTS.md` and `docs/INTEGRATIONS.md` describe exactly what shipped, with no "coming later" left for these two agents.

