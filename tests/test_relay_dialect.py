"""Asserts the macOS relay's per-agent stdout dialect.

Run via scripts/test-hook-relay-dialect.sh, which extracts the relay source out of
HookServer.swift first. Most assertions are on the pure functions; the last group
runs the relay's ``main`` against a fake socket so the empty-response path (Coucou
reachable but never answered) is exercised without needing a real socket.
"""
import io
import json
import sys
import types
from pathlib import Path

RELAY = Path(sys.argv[1])


def load():
    """Load the extracted relay as a module.

    The relay lives inside a Swift multi-line string literal, so a newline escape
    is written ``\\n`` there to make the *generated* Python source read ``\n``.
    Extracting the raw text keeps Swift's doubled backslashes, so undo that one
    level here — otherwise the relay emits a literal backslash-n instead of a
    newline and diverges from the script the app actually writes.
    """
    source = RELAY.read_text(encoding="utf-8").replace("\\\\", "\\")
    mod = types.ModuleType("relay")
    exec(compile(source, str(RELAY), "exec"), mod.__dict__)
    return mod


def run_relay(mod, argv, stdin_bytes, recv_bytes):
    """Run the relay's ``main`` with a fake Unix socket.

    ``recv_bytes`` is what the fake connection returns from ``recv``: ``b""`` models
    a reachable Coucou that never answered (EOF), ``None`` models Coucou not running
    (connect raises). Returns ``(stdout_text, forwarded_payload_or_None)``.
    """
    sent = {}

    class FakeConn:
        def settimeout(self, _t):
            pass

        def connect(self, _path):
            if recv_bytes is None:
                raise OSError("no socket")

        def sendall(self, data):
            sent["data"] = data

        def recv(self, _n):
            return recv_bytes if recv_bytes is not None else b""

        def close(self):
            pass

    fake_socket = types.SimpleNamespace(
        AF_UNIX=1, SOCK_STREAM=1, socket=lambda *a, **k: FakeConn())

    old = (mod.socket, sys.argv, sys.stdin, sys.stdout)
    out = io.StringIO()
    try:
        mod.socket = fake_socket
        sys.argv = argv
        sys.stdin = io.TextIOWrapper(io.BytesIO(stdin_bytes))
        sys.stdout = out
        try:
            mod.main()
        except SystemExit:
            pass
    finally:
        mod.socket, sys.argv, sys.stdin, sys.stdout = old

    forwarded = json.loads(sent["data"].decode()) if "data" in sent else None
    return out.getvalue(), forwarded


def check_behavior(mod):
    """The reachable-but-unanswered path, end to end through ``main``."""
    hermes_argv = ["nb-hook", "--agent", "hermes", "pre_tool_call"]
    hermes_in = (b'{"hook_event_name":"pre_tool_call","session_id":"s",'
                 b'"tool_name":"terminal","coucou_agent":"hermes"}\n')

    # Coucou reachable, empty response (nobody answered) -> Hermes must block, and
    # the forwarded event must already be canonical: the app routes on that field.
    out, forwarded = run_relay(mod, hermes_argv, hermes_in, b"")
    assert '"action":"block"' in out, repr(out)
    assert "no answer" in out, repr(out)
    assert forwarded is not None, forwarded
    assert forwarded.get("hook_event_name") == "PermissionRequest", forwarded

    # Coucou not running -> Hermes prints nothing at all (fail-open).
    out, _ = run_relay(mod, hermes_argv, hermes_in, None)
    assert out == "", repr(out)

    # A real answer still reaches Hermes as a decision.
    out, _ = run_relay(mod, hermes_argv, hermes_in,
                       b'{"permissionDecision":"allow"}\n')
    assert out.strip() == "{}", repr(out)

    # Same empty response for Claude Code -> nothing printed (terminal re-asks).
    claude_argv = ["nb-hook", "--agent", "claude", "PermissionRequest"]
    claude_in = (b'{"hook_event_name":"PermissionRequest","session_id":"s",'
                 b'"tool_name":"Bash"}\n')
    out, forwarded = run_relay(mod, claude_argv, claude_in, b"")
    assert out == "", repr(out)
    assert forwarded.get("hook_event_name") == "PermissionRequest", forwarded

    # Copilot is fail-closed: an empty response still yields a valid ask.
    copilot_argv = ["nb-hook", "--agent", "copilot", "PermissionRequest"]
    copilot_in = (b'{"hook_event_name":"PermissionRequest","session_id":"s",'
                  b'"tool_name":"Bash","coucou_agent":"copilot"}\n')
    out, _ = run_relay(mod, copilot_argv, copilot_in, b"")
    assert '"permissionDecision":"ask"' in out, repr(out)


def main():
    mod = load()
    out = mod.dialect_output
    norm = mod.normalize_event

    # Hermes event names must be translated before the relay decides whether to
    # wait. Hermes has no permission event of its own, so `pre_tool_call` *is* the
    # gate: it must become `PermissionRequest`, not `PreToolUse`. If this mapping
    # is deleted the relay takes the fire-and-forget branch, never waits, and the
    # app sees an event it has no case for — no pill, no card, no receipt.
    assert norm("pre_tool_call") == "PermissionRequest", norm("pre_tool_call")
    assert norm("post_tool_call") == "PostToolUse", norm("post_tool_call")
    assert norm("pre_llm_call") == "UserPromptSubmit", norm("pre_llm_call")

    # OpenCode events are forwarded untouched — the plugin emits canonical names.
    assert norm("session.created") == "session.created"
    assert norm("permission.asked") == "permission.asked"
    assert norm("tool.execute.before") == "tool.execute.before"

    # The lifecycle events. Deleting any one of these mappings lets a Hermes
    # session leak its pill (never created / never removed) or lose subagent
    # activity, so each is pinned individually — the pure-dialect assertions
    # above would not notice a dropped mapping.
    assert norm("on_session_start") == "SessionStart", norm("on_session_start")
    assert norm("on_session_end") == "SessionEnd", norm("on_session_end")
    assert norm("subagent_start") == "SubagentStart", norm("subagent_start")
    assert norm("subagent_stop") == "SubagentStop", norm("subagent_stop")
    assert norm("post_llm_call") == "Stop", norm("post_llm_call")

    # An unknown event is forwarded untouched rather than dropped.
    assert norm("something_new") == "something_new", norm("something_new")

    # Hermes: {} allows, a block object denies, and a missing answer denies too.
    assert out("hermes", "allow") == "{}", out("hermes", "allow")
    assert out("hermes", "always") == "{}"
    assert out("hermes", "deny") == '{"action":"block","message":"Denied from Coucou"}'
    no_answer = out("hermes", "ask")
    assert no_answer is not None and '"action":"block"' in no_answer, no_answer
    assert "no answer" in no_answer
    # Byte-identical to the Rust relay's receipt, so the two platforms cannot drift.
    assert no_answer == '{"action":"block","message":"Coucou: no answer — re-run to be asked again."}', \
        repr(no_answer)

    # Claude Code is untouched: allow/deny are wrapped, silence means "terminal asks".
    allow = out("claude", "allow")
    assert '"behavior": "allow"' in allow, allow
    deny = out("claude", "deny")
    assert '"behavior": "deny"' in deny, deny
    assert out("claude", "ask") is None
    # "Always" must still persist the rule, or it silently degrades to "Allow".
    always = out("claude", "always", ["Bash(npm test)"])
    assert '"updatedPermissions": ["Bash(npm test)"]' in always, always
    # Codex does not understand updatedPermissions and must not receive it.
    assert "updatedPermissions" not in out("codex", "always", ["x"])

    # Copilot and Muse keep their plain shape.
    assert out("copilot", "allow") == '{"permissionDecision": "allow"}'
    assert out("muse", "deny") == '{"permissionDecision": "deny"}'

    # Observational agents never produce a decision.
    for a in ("gemini", "antigravity", "opencode"):
        assert out(a, "allow") == "{}", (a, out(a, "allow"))

    # Unknown decision, unknown agent: print nothing.
    assert out("claude", "maybe") is None

    # End-to-end: reachable-but-unanswered blocks Hermes, silence when unreachable.
    check_behavior(mod)

    print("relay dialect OK")


if __name__ == "__main__":
    main()
