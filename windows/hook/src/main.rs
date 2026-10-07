//! coucou-hook — the relay every agent runs on every hook event.
//!
//! Reads the hook JSON on stdin, adds a little terminal context, and hands it to
//! Coucou over the named pipe `\\.\pipe\coucou-<sid>` (Windows) or the Unix
//! socket `$XDG_RUNTIME_DIR/coucou.sock` (Linux).
//!
//! Hard rule (docs/CLAUDE.md): **never block the agent.**
//! * If the pipe does not exist — Coucou is closed — we exit 0 immediately with
//!   nothing on stdout, and the session carries on untouched.
//! * Every step runs under a deadline enforced by the main thread, so a pipe that
//!   accepts the connection and then stops reading cannot wedge the session
//!   either: we abandon the worker and exit.
//! * Only `PermissionRequest` waits for an answer, because approving from the
//!   island is the whole point. No answer means empty stdout for Claude Code,
//!   which re-asks in the terminal exactly as if Coucou were not installed;
//!   Hermes, which has no re-ask path, is blocked explicitly instead.
//!
//! Usage: `coucou-hook <EventName>` (the name is also read from the JSON).

use std::io::{Read, Write};
use std::sync::mpsc;
use std::time::Duration;

/// Budget for getting a pipe connection. Beyond this Claude Code wins, always.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
/// Whole-run budget for an event nobody waits on: connect and write, no more.
const FIRE_AND_FORGET_BUDGET: Duration = Duration::from_secs(2);
/// How long a permission prompt may stay on screen before the terminal takes over.
const DECISION_BUDGET: Duration = Duration::from_secs(110);

/// Fields that are pointless to forward and can be enormous (a whole file read,
/// a full command output). The island never shows them.
const DROPPED_FIELDS: &[&str] = &["tool_response", "transcript_path"];
/// Longest string forwarded for any single field; the island truncates to far
/// less than this anyway.
const MAX_FIELD_LEN: usize = 2_000;

#[cfg(windows)]
mod win;
#[cfg(windows)]
use win::connect;

#[cfg(target_os = "linux")]
mod unix;
#[cfg(target_os = "linux")]
use unix::connect;

fn main() {
    let Some((payload, event, agent_name)) = read_event() else { std::process::exit(0) };

    let waits_for_answer = event == "PermissionRequest";
    let budget = if waits_for_answer { DECISION_BUDGET } else { FIRE_AND_FORGET_BUDGET };

    let dialect = dialect_for(&agent_name);
    // The worker owns every blocking call. If it overruns the budget we simply
    // stop listening and exit: the process dying takes the pipe handle with it.
    // (No catch_unwind here — the release profile is panic = "abort", so it would
    // be dead code. `talk` is written to have nothing to panic on instead.)
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
}

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

/// Translate an agent's native event names into Coucou's canonical vocabulary, so
/// one app-side handler serves every agent.
///
/// `pre_tool_call` becomes `PermissionRequest`, **not** `PreToolUse`: Hermes has no
/// separate permission event, and its `pre_tool_call` hook is the only thing that can
/// stop a tool — so for the tools the `matcher` selects, it *is* the permission gate.
/// Mapping it to `PreToolUse` would leave `waits_for_answer` false, the relay would
/// never wait, and Allow/Deny from the island would be unreachable.
///
/// An unrecognised event is forwarded untouched rather than dropped, so a future
/// Hermes event still shows up in the island as an unknown event instead of vanishing.
fn canonical_event(dialect: Dialect, raw: &str) -> String {
    if dialect != Dialect::Hermes {
        return raw.to_string();
    }
    match raw {
        "pre_llm_call" => "UserPromptSubmit",
        "pre_tool_call" => "PermissionRequest",
        "post_tool_call" => "PostToolUse",
        other => other,
    }
    .to_string()
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

/// Reads stdin and returns the payload to forward, the event name, and the agent.
fn read_event() -> Option<(String, String, String)> {
    let mut raw = Vec::new();
    if std::io::stdin().read_to_end(&mut raw).is_err() || raw.is_empty() {
        return None;
    }
    // Some shells hand us a UTF-8 BOM; serde_json would choke on it.
    if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        raw.drain(..3);
    }

    let mut payload = serde_json::from_slice::<serde_json::Value>(&raw).ok()?;
    let map = payload.as_object_mut()?;

    // Parse argv: "coucou-hook.exe [--agent <name>] [<EventName>]"
    // --agent tags the payload with coucou_agent so the app routes to the right pill.
    // Absent or invalid names are validated and discarded by the app, not here.
    let mut agent = String::new();
    let mut arg_event = String::new();
    {
        let mut it = std::env::args().skip(1);
        while let Some(arg) = it.next() {
            if arg == "--agent" {
                agent = it.next().unwrap_or_default();
            } else if arg_event.is_empty() {
                arg_event = arg;
            }
        }
    }
    // Which agent this hook was installed for. Absent means Claude Code,
    // so existing hook commands keep working unchanged.
    if !agent.is_empty() {
        map.insert("coucou_agent".into(), serde_json::Value::String(agent.clone()));
    }
    let raw_event = map
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or(arg_event);

    // Translate before forwarding: the app routes on this exact field, so
    // canonicalising only in `main()` would leave the app seeing `pre_tool_call`
    // while the relay waits on `PermissionRequest`.
    let dialect = dialect_for(&agent);
    let event = canonical_event(dialect, &raw_event);
    map.insert("hook_event_name".into(), serde_json::Value::String(event.clone()));

    for field in DROPPED_FIELDS {
        map.remove(*field);
    }

    let cwd_missing = map
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(str::is_empty)
        .unwrap_or(true);
    if cwd_missing {
        if let Ok(cwd) = std::env::current_dir() {
            map.insert(
                "cwd".into(),
                serde_json::Value::String(cwd.to_string_lossy().to_string()),
            );
        }
    }

    // Which terminal the session runs in. Unlike macOS, Coucou here accepts
    // events from every terminal, so this is context only — never a filter.
    for (key, var) in [
        ("term_program", "TERM_PROGRAM"),
        ("wt_session", "WT_SESSION"),
        ("term_session_id", "TERM_SESSION_ID"),
        ("vscode_pid", "VSCODE_PID"),
        ("session_pid", "CLAUDE_CODE_SSE_PORT"),
    ] {
        if !map.contains_key(key) {
            let value = std::env::var(var).unwrap_or_default();
            map.insert(key.into(), serde_json::Value::String(value));
        }
    }

    truncate_strings(&mut payload);

    let mut line = payload.to_string();
    line.push('\n');
    Some((line, event, agent))
}

/// Caps every string in the payload. A single Write can carry a whole file.
fn truncate_strings(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(s) => {
            if s.len() > MAX_FIELD_LEN {
                // Cut on a char boundary; a lone byte index can split UTF-8.
                let mut end = MAX_FIELD_LEN;
                while end > 0 && !s.is_char_boundary(end) {
                    end -= 1;
                }
                s.truncate(end);
                s.push('…');
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(truncate_strings),
        serde_json::Value::Object(map) => map.values_mut().for_each(truncate_strings),
        _ => {}
    }
}

/// Connect, send, and — for a permission request — wait for the island's word.
fn talk(payload: &str, waits_for_answer: bool) -> Option<String> {
    let mut pipe = connect()?;

    if pipe.write_all(payload.as_bytes()).is_err() {
        return None;
    }
    let _ = pipe.flush();

    if !waits_for_answer {
        return None;
    }

    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match pipe.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.contains(&b'\n') {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    let answer = String::from_utf8_lossy(&buf).trim().to_string();
    (!answer.is_empty()).then_some(answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decision_json_matches_the_documented_shape() {
        assert_eq!(
            decision_json(Dialect::Claude, "allow").unwrap(),
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}"#
        );
        assert_eq!(
            decision_json(Dialect::Claude, "deny").unwrap(),
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Denied from Coucou"}}}"#
        );
        // "always" is an island concept; Claude Code just gets an allow.
        assert!(decision_json(Dialect::Claude, "always").unwrap().contains(r#""behavior":"allow""#));
    }

    #[test]
    fn anything_unrecognised_prints_nothing() {
        assert!(decision_json(Dialect::Claude, "").is_none());
        assert!(decision_json(Dialect::Claude, "maybe").is_none());
        // The shape the app used to send must not be mistaken for a decision.
        assert!(decision_json(Dialect::Claude, r#"{"permissionDecision":"allow"}"#).is_none());
    }

    #[test]
    fn long_strings_are_cut_on_a_char_boundary() {
        let mut v = serde_json::json!({ "tool_input": { "content": "é".repeat(4000) } });
        truncate_strings(&mut v);
        let s = v["tool_input"]["content"].as_str().unwrap();
        assert!(s.len() <= MAX_FIELD_LEN + 4);
        assert!(s.ends_with('…'));
    }

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
        // allow, which is worse than not having Coucou installed. Pinned byte-exact:
        // the macOS Python relay asserts the identical string, so a reformat on
        // either side must fail a test.
        assert_eq!(
            no_answer_json(Dialect::Hermes).unwrap(),
            r#"{"action":"block","message":"Coucou: no answer — re-run to be asked again."}"#
        );
        // Claude Code's fallback is silence: the terminal asks instead.
        assert!(no_answer_json(Dialect::Claude).is_none());
    }

    #[test]
    fn hermes_event_names_are_translated_to_canonical_ones() {
        // Hermes has no separate permission event. Its `pre_tool_call` hook is the
        // only thing that can stop a tool, so it IS the permission gate — and it
        // must map to PermissionRequest or the relay never waits for a decision.
        assert_eq!(canonical_event(Dialect::Hermes, "pre_tool_call"), "PermissionRequest");
        assert_eq!(canonical_event(Dialect::Hermes, "post_tool_call"), "PostToolUse");
        assert_eq!(canonical_event(Dialect::Hermes, "pre_llm_call"), "UserPromptSubmit");
        // An event we do not know is forwarded untouched rather than dropped.
        assert_eq!(canonical_event(Dialect::Hermes, "something_new"), "something_new");
        // Every other agent already speaks the canonical vocabulary.
        for e in ["PermissionRequest", "PreToolUse", "Stop", "SessionStart"] {
            assert_eq!(canonical_event(Dialect::Claude, e), e);
        }
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
}
