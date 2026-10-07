#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/coucou-agent-dialect.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
# AgentDialect.swift imports only Foundation, so it compiles with the test alone.
# Do NOT add PillCatalog.swift or IslandTypes.swift here: IslandTypes reaches
# IslandScreenGeometry and EyeShape in BotEngine.swift, which pulls in SwiftUI, the
# wardrobe and the outfit drawing, and the build never finishes.
swiftc NotchBuddy/Sources/CoucouKit/AgentDialect.swift \
    tests/AgentDialectTests.swift -o "$TEST_DIR/agent-dialect-tests"
"$TEST_DIR/agent-dialect-tests"
