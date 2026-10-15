import assert from "node:assert/strict";
import { carouselAgents } from "../src/core/agent-carousel.ts";

const agents = [
  { id: "integration_claude" },
  { id: "agent_opencode" },
  { id: "agent_hermes" },
  { id: "integration_stripe" },
];

assert.deepEqual(
  carouselAgents(agents, "integration_claude").map(({ id }) => id),
  ["agent_opencode", "agent_hermes"],
);
assert.deepEqual(
  carouselAgents(agents, "agent_opencode").map(({ id }) => id),
  ["integration_claude", "agent_hermes"],
);
assert.deepEqual(
  carouselAgents(agents, "agent_hermes").map(({ id }) => id),
  ["integration_claude", "agent_opencode"],
);

console.log("agent carousel switching: ok");
