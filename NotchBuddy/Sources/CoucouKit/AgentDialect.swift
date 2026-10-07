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
