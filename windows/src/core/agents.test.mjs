// Minimal assert-based check, runnable with `node` and no framework.
//
// Run from `windows/` with:
//   node --experimental-strip-types src/core/agents.test.mjs
//
// Node v22.22.2 strips the types from the `.ts` import directly, so no build step
// is needed. If type stripping is unavailable, compile first and re-run:
//   npx tsc src/core/agents.ts --outDir src/.agents-build --module esnext --target es2022
// then the import below falls back to `src/.agents-build/agents.js`.
import assert from "node:assert/strict";

const { agentMeta, AGENT_META } = await import("./agents.ts").catch(async () => {
  // Node cannot import .ts directly; the check compiles it first via tsc.
  return import("../.agents-build/agents.js");
});

assert.equal(agentMeta("hermes").name, "Hermes");
assert.equal(agentMeta("hermes").color, "#A78BFA");
assert.equal(agentMeta("hermes").allowsApproval, true);

assert.equal(agentMeta("opencode").name, "OpenCode");
assert.equal(agentMeta("opencode").color, "#4ADE80");
assert.equal(agentMeta("opencode").allowsApproval, false);

// Unknown agents still get a usable, deterministic colour.
const a = agentMeta("some-tool");
assert.ok(a.color.startsWith("#"), "an unknown agent still gets a colour");
assert.equal(a.color, agentMeta("some-tool").color, "the fallback colour is stable");
assert.equal(a.allowsApproval, false, "an unknown agent cannot approve");

// The two entries that mirror PillCatalog.swift must match it exactly.
assert.deepEqual(
  Object.fromEntries(Object.entries(AGENT_META).map(([k, v]) => [k, v.color])),
  { hermes: "#A78BFA", opencode: "#4ADE80" }
);

console.log("agents metadata OK");
