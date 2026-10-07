# Coucou agent compatibility plan: Hermes + OpenCode

Goal: make Coucou show, route, approve, and test Hermes Agent and OpenCode sessions through the same event path already used by Claude Code, Codex, Copilot CLI, Muse Code, Gemini CLI, and Antigravity.

Do not create a second integration architecture. The smallest durable design is:

1. Keep Coucou's canonical hook payload as the only wire contract.
2. Add thin adapters for Hermes and OpenCode that translate their native events into that contract.
3. Reuse the existing socket/pipe, approval card, pill catalog, backup/diff/install UI, and test style.

## Current state

Existing contract:

- `docs/AGENTS.md` documents `coucou_agent`, canonical event names, socket/pipe paths, and third-party agent lifecycle.
- macOS receives events in `NotchBuddy/Sources/App/HookServer.swift`.
- Windows/Linux receive events in `windows/src-tauri/src/pipe.rs` and route them in `windows/src/island/hooks.ts`.
- Declared pills live in `NotchBuddy/Sources/CoucouKit/PillCatalog.swift`.
- Settings UI for hook/plugin install lives in `NotchBuddy/Sources/App/SettingsView.swift`.
- Windows/Linux Claude hook installation lives in `windows/src-tauri/src/hooks.rs`.

Existing agent support:

- Codex, Copilot CLI, Muse Code: hook installers that call the Coucou relay with `--agent <name>`.
- OpenCode: macOS-only generated plugin at `~/.config/opencode/plugins/coucou.js`.
- Amp: macOS-only generated plugin at `~/.config/amp/plugins/coucou.ts`.
- Generic agents: can send `coucou_agent` directly, but undeclared pills do not get first-class settings or docs.

Gap:

- Hermes has no catalog pill, installer, plugin, docs, or tests.
- OpenCode exists, but should be hardened against current V1/V2 plugin APIs and covered by tests.
- Windows/Linux do not install OpenCode or Hermes adapters, even though the relay path can support them.

## Canonical event contract

Every adapter must emit newline-terminated JSON to Coucou:

```json
{
  "hook_event_name": "PreToolUse",
  "session_id": "opaque-session-id",
  "coucou_agent": "hermes",
  "cwd": "/path/to/project",
  "tool_name": "bash",
  "tool_input": { "command": "npm test" }
}
```

Allowed `coucou_agent` values for this work:

- `hermes` -> `agent_hermes`
- `opencode` -> `agent_opencode`

Canonical event mapping:

| Canonical event | Required fields | Effect |
|---|---|---|
| `SessionStart` | `session_id`, optional `cwd` | Create/reset pill, state `idle` |
| `UserPromptSubmit` | `session_id`, optional `prompt` | State `thinking` |
| `PreToolUse` | `session_id`, `tool_name`, optional `tool_input` | State `working`, ticker step |
| `PermissionRequest` | `session_id`, `tool_name`, optional `tool_input` | Show Allow/Deny when the adapter can consume a decision |
| `PostToolUse` | `session_id`, optional `tool_name`, `tool_input` | Resolve matching approval, record step/diff when available |
| `PostToolUseFailure` | same as `PostToolUse` | Keep working/error detail |
| `Notification` | `session_id`, optional detail | Rate-limit/question detail when parseable |
| `Stop` | `session_id`, optional final text | State `finished` |
| `StopFailure` | `session_id`, optional error text | State `error` |
| `SessionEnd` | `session_id` | Reset declared pill or remove dynamic pill |
| `SubagentStart` / `SubagentStop` | `session_id` | Ticker step |

Completion criterion: `HookServer.processEvent`, `windows/src/island/hooks.ts`, and docs all agree on the same event names and routing.

## Hermes plan

### Phase H1: Confirm Hermes hook surfaces

At implementation time, verify current Hermes docs and code before editing Coucou. Expected usable surfaces:

- Hermes plugin hooks via `ctx.register_hook(...)` for CLI + Gateway sessions.
- Shell hooks from Hermes profile config for drop-in command adapters.
- Human/approval hooks such as `pre_approval_request`, `post_approval_response`, or current equivalents.
- Session hooks such as `on_session_start`, `on_session_end`, `pre_tool_call`, `post_tool_call`, `subagent_start`, `subagent_stop`, and stream/error hooks.

Completion criterion: write the exact Hermes event names and payload fields into `docs/AGENTS.md` before coding the adapter. If names changed, follow Hermes source/docs, not this plan.

### Phase H2: Add the Hermes pill

Edit `NotchBuddy/Sources/CoucouKit/PillCatalog.swift`:

- Add `.init(id: "agent_hermes", name: "Hermes", color: "#A78BFA", category: .agent, subtitle: "Agent", source: .agent, githubOnly: true)`.
- Add `case "agent_hermes": return "Hermes"` to `sessionSubtitle` only if the UI needs the exact active header. Otherwise leave default `"Agent"`.

Edit Windows/Linux catalog equivalent if present in `windows/src` after searching for hardcoded pill lists.

Completion criterion: Hermes appears in Active pills in GitHub builds and never in App Store builds.

### Phase H3: macOS Hermes adapter

Add generated plugin content in `HookServer.swift`, mirroring the OpenCode/Amp pattern:

- `static var hermesPluginURL`: prefer `~/.hermes/plugins/coucou.py` if Hermes plugin packaging supports direct local plugins; otherwise use the documented Hermes hook folder path.
- `static func hermesPluginInstalled() -> Bool`.
- `previewHermesPlugin(install:)`, `writeHermesPlugin()`, `removeHermesPlugin()`.
- Generated Python plugin should:
  - accept `**kwargs` on every hook callback;
  - never throw out of a hook callback;
  - set a short socket timeout for observer events;
  - block only on approval hooks that Hermes expects to be decision-producing;
  - emit `coucou_agent: "hermes"`;
  - normalize `session_id`, `cwd`, `tool_name`, and `tool_input`.

Prefer plugin hooks over shell hooks for Hermes because a plugin can map rich payload fields without parsing shell stdin. Keep shell-hook support as a fallback only if plugin installation is unavailable.

Completion criterion: installing Hermes from Settings writes only Coucou-owned files, backs up replaced Coucou-owned files, refuses to delete a file not generated by Coucou, and never edits unrelated Hermes config without a preview.

### Phase H4: Hermes approval behavior

In `HookServer.processPermissionRequest`:

- Treat `rawAgent == "hermes"` like Copilot/Muse if Hermes expects plain permission decisions.
- If Hermes expects a custom return shape, keep that shape inside the generated Hermes plugin, not inside Coucou's socket protocol.
- Add note text: `Handled in Hermes.` and `Still waiting in Hermes.`

In `nbHookPython` only add Hermes if it is useful for direct shell-hook mode. Keep plugin-specific output in the plugin where possible.

Completion criterion: Allow and Deny from Coucou unblock Hermes with the decision format Hermes expects; timeout/fallback leaves Hermes in its native prompt path.

### Phase H5: Windows/Linux Hermes adapter

Add the same Hermes generated adapter in the Tauri side only if Hermes supports plugins on Windows/Linux. Otherwise document macOS-only for now.

Implementation targets:

- `windows/src-tauri/src/hooks.rs` or a new `agent_plugins.rs` only if the logic would otherwise bloat `hooks.rs`.
- Settings UI only if Windows/Linux already exposes comparable agent setup controls.
- Generated adapter must write to `\\.\pipe\coucou-<sid>` on Windows and `$XDG_RUNTIME_DIR/coucou.sock` on Linux.

Completion criterion: platform support is either implemented and tested, or explicitly documented as unsupported with a reason.

## OpenCode plan

### Phase O1: Harden macOS OpenCode plugin

Update `buildOpenCodePluginContent()` in `HookServer.swift` to support both OpenCode plugin API shapes:

- V1 server-style object that handles `"tool.execute.before"`, `"tool.execute.after"`, and event stream callbacks if still supported.
- V2 `setup(ctx)` style that uses `ctx.tool.hook("execute.before")`, `ctx.tool.hook("execute.after")`, and permission/session hooks where available.

Keep one generated file, with feature detection:

- If `ctx.tool?.hook` exists, register V2 hooks.
- If the V1 plugin loader calls exported handlers directly, expose the current handler object too.
- Always forward display events fire-and-forget unless a permission hook explicitly supports an async decision.

Completion criterion: one plugin file works on current OpenCode and still preserves the existing V1 behavior.

### Phase O2: OpenCode permission handling

Current docs and code mention `permission.asked`, while newer OpenCode docs expose permission APIs and `permission.hook("evaluate")`.

Implement the least risky path:

1. For display-only permission events, forward `PermissionRequest` and return nothing.
2. If OpenCode exposes a decision hook that can await Coucou, call Coucou and translate:
   - Coucou `allow` -> OpenCode one-time allow/once, depending on API.
   - Coucou `deny` -> deny with message `Denied from Coucou`.
   - timeout/no response -> leave OpenCode's native prompt behavior unchanged.
3. Do not auto-allow.

Completion criterion: OpenCode is never less restrictive because Coucou is installed.

### Phase O3: Windows/Linux OpenCode support

Add OpenCode plugin install support to the Tauri app if OpenCode loads plugins from a cross-platform config path.

Expected path candidates:

- User config: `~/.config/opencode/plugins/coucou.js`
- Project config: `.opencode/plugins/` only if the user explicitly chooses project-local install.

Default to user config, matching macOS.

Completion criterion: OpenCode support matrix says exactly which platforms are implemented and why.

## Shared code changes

### Settings

In `SettingsView.swift`:

- Add Hermes state fields beside OpenCode/Amp.
- Add a Hermes group box in Agents.
- Reuse the same preview modal used by OpenCode/Amp.
- Keep install/uninstall text short: `~/.hermes/.../coucou.py`.

In localization:

- Add keys for Hermes title, installed text, status install/remove success, and any error copy.

Completion criterion: settings compile without missing localized strings.

### Routing

In macOS `HookServer.swift`:

- Keep generic `agent_<name>` routing for valid `coucou_agent`.
- Add Hermes to approval-capable explicit agents only if the adapter supports decisions.
- Keep `claude` reserved.

In Windows/Linux `windows/src/island/hooks.ts`:

- Ensure `validateAgent("hermes")` routes to `agent_hermes`.
- Add Hermes-specific note text if approval-capable.

Completion criterion: Hermes and OpenCode both route to declared catalog pills when enabled, and dynamic pills when not enabled.

### Docs

Update:

- `docs/AGENTS.md`: Hermes section, updated OpenCode section, platform matrix, quick tests.
- `docs/INTEGRATIONS.md`: add Hermes/OpenCode details to the agents subsection.
- `docs/SPEC.md`: pill catalog and settings behavior.
- `README.md`: Supported agents table.
- `CHANGELOG.md`: unreleased entry.

Completion criterion: no doc claims "support coming later" for Hermes/OpenCode paths that now work.

## Test plan

Use the smallest runnable checks that catch regressions.

### Unit tests

macOS Swift tests:

- Add `tests/AgentRoutingTests.swift` or extend an existing hook test.
- Assert agent validation:
  - `hermes` -> valid.
  - `opencode` -> valid.
  - `claude` -> invalid/reserved if current behavior reserves it.
  - uppercase/underscore/over-24 chars -> invalid.
- Assert pill catalog contains `agent_hermes` and `agent_opencode`.

Hook/plugin generation tests:

- Extract pure string/path helpers if needed.
- Assert generated Hermes plugin contains:
  - `coucou_agent`
  - `hermes`
  - canonical event names
  - socket timeout
  - `**kwargs`
- Assert generated OpenCode plugin contains:
  - `opencode`
  - both V1 and V2 registration paths, if implemented
  - no unconditional allow.

Windows/Rust tests:

- Extend `windows/src-tauri/src/hooks.rs` tests only if installers are added there.
- Assert merge/backup/fingerprint behavior for any new config writer.

TypeScript tests:

- Add a tiny assert-based test for `windows/src/island/hooks.ts` routing if the project already has a test entry; otherwise add a script-level test only if it can run with `npm run build`.

Completion criterion: one test fails if Hermes/OpenCode routing or generated plugin content is accidentally removed.

### Manual integration tests

Run with Coucou open.

Hermes:

1. Install Hermes adapter from Settings.
2. Start a Hermes session in a test repo.
3. Confirm `agent_hermes` pill appears.
4. Run a read-only tool; confirm ticker shows tool name.
5. Run an edit/write tool; confirm state goes working then finished.
6. Trigger an approval; click Allow; confirm Hermes continues.
7. Trigger another approval; click Deny; confirm Hermes blocks or re-prompts according to native semantics.
8. Quit Coucou; run Hermes again; confirm Hermes still runs and falls back natively.

OpenCode:

1. Install OpenCode plugin from Settings.
2. Start OpenCode in a test repo.
3. Confirm `agent_opencode` pill appears.
4. Run read, edit, and shell tools; confirm ticker and final state.
5. Trigger permission ask; confirm Coucou shows the card only if the plugin can consume a decision.
6. Deny from Coucou; confirm OpenCode does not run the action.
7. Quit Coucou; confirm OpenCode is not blocked.

Cross-platform:

1. Windows: install hooks/plugins if supported; run `npm run build`; run a hook smoke payload through `coucou-hook.exe --agent hermes UserPromptSubmit`.
2. Linux: run `npm run build`; smoke payload through `~/.local/share/coucou/bin/coucou-hook --agent hermes UserPromptSubmit`.

Completion criterion: all supported platforms either pass a smoke test or are documented as not supported.

### Regression tests

Run:

```bash
cd NotchBuddy
xcodegen
xcodebuild -scheme NotchBuddy -configuration Debug build
```

Run existing script tests:

```bash
./scripts/test-chat-parsing.sh
./scripts/test-ask-question.sh
./scripts/test-safe-links.sh
./scripts/test-diff-engine.sh
./scripts/test-github-activity.sh
./scripts/test-github-pulse.sh
./scripts/test-plan-gauge.sh
./scripts/test-shortcuts.sh
./scripts/test-wardrobe.sh
./scripts/test-weekly-recap.swift
```

Run Windows/Linux build checks:

```bash
cd windows
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path hook/Cargo.toml
```

Completion criterion: every existing test still passes, plus the new Hermes/OpenCode checks.

## AI coding flow

Give this to the implementation agent:

1. Read `CLAUDE.md`, `docs/AGENTS.md`, `docs/INTEGRATIONS.md`, `docs/SPEC.md`, `PillCatalog.swift`, `HookServer.swift`, `SettingsView.swift`, `windows/src/island/hooks.ts`, `windows/src-tauri/src/hooks.rs`, and `windows/src-tauri/src/pipe.rs`.
2. Verify current Hermes and OpenCode hook/plugin docs. Update this plan's assumptions if the APIs changed.
3. Add Hermes pill and routing first. Run the smallest catalog/routing test.
4. Add macOS Hermes installer/plugin. Keep generated plugin code minimal and fail-open except for explicit approval decisions.
5. Harden OpenCode plugin generation for current API compatibility. Preserve existing behavior.
6. Add Settings UI and localization.
7. Add Windows/Linux support only where the platform relay and agent plugin path are real. Otherwise document the gap.
8. Update docs and changelog.
9. Run unit/build tests.
10. Run manual smoke tests with Coucou open and Coucou closed.

Stop rules:

- If Hermes or OpenCode docs disagree with this plan, follow the live docs and update the plan/doc comments.
- If an adapter cannot consume a permission decision safely, forward display-only events and leave approval in the agent terminal.
- If installer code would overwrite user config without a preview and backup, do not ship it.

Definition of done:

- Hermes and OpenCode can each create their own Coucou pill.
- Tool activity appears in the ticker.
- Stop/error/session end lifecycle works.
- Approvals work only where native agent APIs support safe decisions.
- Coucou closed never blocks either agent.
- Docs tell users exactly how to install, test, and remove each integration.
