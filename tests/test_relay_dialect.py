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
