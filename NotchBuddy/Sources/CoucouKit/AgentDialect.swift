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
}

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
        //
        // Three entries, because Hermes has no permission event of its own:
        //   pre_llm_call  -> UserPromptSubmit  (the prompt, in the ticker)
        //   pre_tool_call -> PermissionRequest (the gate; `matcher` scopes it)
        //   post_tool_call-> PostToolUse       (working)
        """
        \(hermesBeginMarker) — managed by Coucou. Edits inside these markers are overwritten.
        hooks:
          pre_llm_call:
            - command: '\(hookCommand) pre_llm_call'
              timeout: 10
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
            // Install put one blank line between the user's content and our block;
            // uninstall takes that blank back out, so the file we hand back is byte
            // for byte the one we were given. Mirrors merge_hermes_config in
            // windows/src-tauri/src/agents.rs.
            if body.hasSuffix("\n\n") { body.removeLast() }
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
