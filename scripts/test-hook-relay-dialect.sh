#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/coucou-relay-dialect.XXXXXX")"
trap 'rm -rf "$TEST_DIR" 2>/dev/null || true' EXIT

# Pull a relay out of its Swift string literal: everything between the opening
# `private let <name> = """` line and the next `"""`.
extract_relay() {
    awk -v name="$1" '
        $0 ~ ("^private let " name " = \"\"\"") {f=1; next}
        f && /^"""/ {exit}
        f
    ' NotchBuddy/Sources/App/HookServer.swift > "$2"
}

# The extractor above only matches a closer at column 0, so it is blind to a `"""`
# that ends a literal early from *inside* it — an indented docstring, say. Swift
# ends a multiline literal at the first unescaped `"""` no matter the indentation,
# so such a line breaks the build while the extracted Python still looks fine.
# Every `"""` line must therefore be an opener (`= """` / `return """`) or a bare
# column-0 closer; anything else would terminate a literal mid-string.
literal_bad="$(awk '
    /"""/ {
        if (index($0, "= \"\"\"") || index($0, "return \"\"\"")) next
        if ($0 == "\"\"\"") next
        printf "%d: %s\n", NR, $0
    }
' NotchBuddy/Sources/App/HookServer.swift)"
if [ -n "$literal_bad" ]; then
    echo "HookServer.swift has a \"\"\" that would terminate a multiline literal early:"
    echo "$literal_bad"
    exit 1
fi

# HookServer.swift embeds two relays: the GitHub build and the App Store build.
# They are generated from the same logic and must emit identical bytes — they have
# drifted once before, so run the dialect suite against both and fail if either
# diverges.
for relay in nbHookPythonGitHub nbHookPythonAppStore; do
    extract_relay "$relay" "$TEST_DIR/$relay.py"
    if ! [ -s "$TEST_DIR/$relay.py" ]; then
        echo "could not extract $relay from HookServer.swift"
        exit 1
    fi
    python3 tests/test_relay_dialect.py "$TEST_DIR/$relay.py"
done

echo "relay dialect OK (both relays)"
