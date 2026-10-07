#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/coucou-relay-dialect.XXXXXX")"
trap 'rm -rf "$TEST_DIR" 2>/dev/null || true' EXIT

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
