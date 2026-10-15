export const CAROUSEL_AGENT_IDS = ["integration_claude", "agent_opencode", "agent_hermes"] as const;

/** The promoted agent is omitted; the remaining standing agents form the rail. */
export function carouselAgents<T extends { id: string }>(tasks: readonly T[], focusId: string | null): T[] {
  return tasks
    .filter((task) => task.id !== focusId && (CAROUSEL_AGENT_IDS as readonly string[]).includes(task.id))
    .slice(0, 2);
}
