// Agent metadata for the Windows and Linux front-end.
//
// Mirrors the agent entries in NotchBuddy/Sources/CoucouKit/PillCatalog.swift. Two
// copies exist because Swift and TypeScript cannot share a constant; the colours
// below are asserted against the Swift values by scripts/test-agent-dialect.sh on
// the macOS side and by agents.test.mjs here.
// ponytail: hand-maintained, two places to edit when a pill is added. Upgrade path:
// generate this file from PillCatalog.swift at build time.
export interface AgentMeta {
  /** Display name shown next to the pill. */
  name: string;
  /** Pill colour, matching PillCatalog. */
  color: string;
  /** True when Allow/Deny from the island actually reaches the agent. */
  allowsApproval: boolean;
}

export const AGENT_META: Record<string, AgentMeta> = {
  hermes: { name: "Hermes", color: "#A78BFA", allowsApproval: true },
  opencode: { name: "OpenCode", color: "#4ADE80", allowsApproval: false },
};

const FALLBACK_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

/** Deterministic colour for an agent we have no metadata for. */
function hashedColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
}

/** Never throws: an unknown agent gets a stable colour and no approval. */
export function agentMeta(agent: string): AgentMeta {
  return AGENT_META[agent] ?? {
    name: agent,
    color: hashedColor(agent),
    allowsApproval: false,
  };
}
