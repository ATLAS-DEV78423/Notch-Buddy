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
need "pre_tool_call"
need "post_tool_call"
need '{"action":"block","message":"Denied from Coucou"}'
need "shell-hooks-allowlist.json"

if [ "$fail" -ne 0 ]; then
  echo "agent contract docs are out of date"
  exit 1
fi
echo "agent contract docs OK"
