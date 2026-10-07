import Foundation

// Assert-based harness, matching tests/DiffEngineTests.swift.
//
// Note on shape: this file is compiled by scripts/test-agent-dialect.sh alongside
// PillCatalog.swift / AgentDialect.swift / IslandTypes.swift. swiftc only permits
// top-level statements in a file literally named main.swift, so the harness is an
// @main enum (the same shape every other test in tests/ uses) rather than bare
// top-level code.
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
    }
}
