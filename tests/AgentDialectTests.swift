import Foundation

// Assert-based harness, matching tests/DiffEngineTests.swift.
//
// Note on shape: swiftc only permits top-level statements in a file literally
// named main.swift, so the harness is an @main enum (the same shape every other
// test in tests/ uses) rather than bare top-level code.
//
// This file must compile with AgentDialect.swift alone. AgentDialect.swift
// imports only Foundation, so scripts/test-agent-dialect.sh compiles exactly
// those two files and nothing else — no PillCatalog.swift, no IslandTypes.swift.
@main
enum AgentDialectTests {

    static var failures = 0

    static func check(_ condition: Bool, _ message: String) {
        if !condition { print("FAIL: \(message)"); failures += 1 }
    }
    static func checkEqual<T: Equatable>(_ a: T, _ b: T, _ message: String) {
        if a != b { print("FAIL: \(message)\n  got: \(a)\n  want: \(b)"); failures += 1 }
    }

    static func main() {

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

        // MARK: - Pill catalogue (checked by grep in scripts/test-agent-docs.sh)

        // The catalogue assertions live in scripts/test-agent-docs.sh rather than here,
        // because this file must compile with AgentDialect.swift alone. Keeping
        // PillCatalog.swift out of the compile set is what makes this test runnable at all.

        // MARK: - Hermes config.yaml block

        let cmd = "/bin/sh '/Users/x/Library/Application Support/NotchBuddy/nb-hook' --agent hermes"
        let block = AgentDialect.hermesConfigBlock(hookCommand: cmd)

        check(block.hasPrefix(AgentDialect.hermesBeginMarker), "the block opens with the begin marker")
        check(block.hasSuffix(AgentDialect.hermesEndMarker), "the block closes with the end marker")
        check(block.contains("pre_llm_call:"), "the per-turn hook is declared")
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

        if failures > 0 { print("\(failures) failure(s)"); exit(1) }
        print("AgentDialect tests passed")
    }
}
