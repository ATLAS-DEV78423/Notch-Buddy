#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Guards the Hermes/OpenCode contract documented in docs/AGENTS.md.
# If a name drifts, this fails before an adapter is written against it.
DOC="docs/AGENTS.md"

fail=0
need() {
  if ! grep -qF -- "$1" "$DOC"; then
    echo "MISSING from $DOC: $1"
    fail=1
  fi
}

need "coucou_agent"
need "hermes"
need "opencode"
need "agent_hermes"
need "agent_opencode"
need "~/.hermes/config.yaml"
need "~/.config/opencode/plugins/coucou.js"
need "pre_llm_call"
need "pre_tool_call"
need "post_tool_call"
need "UserPromptSubmit"
need "PermissionRequest"
need '{"action":"block","message":"Denied from Coucou"}'
need '{"action":"block","message":"Coucou: no answer — re-run to be asked again."}'
need "shell-hooks-allowlist.json"

# The pill catalog is the single source of truth for the two agents' IDs and colours.
# Checked here rather than in the Swift test, because that test compiles
# AgentDialect.swift alone (see Task 4) and cannot see PillCatalog.swift.
CAT="NotchBuddy/Sources/CoucouKit/PillCatalog.swift"
catneed() {
  if ! grep -qF -- "$1" "$CAT"; then
    echo "MISSING from $CAT: $1"
    fail=1
  fi
}
catneed 'id: "agent_hermes"'
catneed 'id: "agent_opencode"'
catneed '#A78BFA'
catneed '#4ADE80'

if [ "$fail" -ne 0 ]; then
  echo "agent contract docs are out of date"
  exit 1
fi
echo "agent contract docs OK"
