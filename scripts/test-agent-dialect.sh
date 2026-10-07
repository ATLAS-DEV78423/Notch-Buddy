#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/coucou-agent-dialect.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT
# Dependency note (Task 4).
#
# PillCatalog.swift needs IslandTypes.swift (for ChatProvider / AgentSource), and
# IslandTypes.swift is NOT dependency-free: it references IslandScreenGeometry
# (IslandScreenGeometry.swift) and EyeShape. EyeShape lives in BotEngine.swift,
# which imports SwiftUI and itself pulls in MochiWardrobe.swift,
# MochiOutfitDrawing.swift and a SoundEngine stub — see scripts/render-outfits.sh,
# which compiles the same set and links -framework SwiftUI for that reason.
#
# The brief's file list is kept below; on a real macOS run the compiler will name
# the additional files above. This was determined by reading, not by running:
# there is no Swift toolchain on the machine this task was authored on, so
# `swiftc` is unavailable and this script could not be executed here.
swiftc NotchBuddy/Sources/CoucouKit/PillCatalog.swift \
    NotchBuddy/Sources/CoucouKit/AgentDialect.swift \
    NotchBuddy/Sources/CoucouKit/IslandTypes.swift \
    tests/AgentDialectTests.swift -o "$TEST_DIR/agent-dialect-tests"
"$TEST_DIR/agent-dialect-tests"
