export type Prio = 0 | 1 | 2;
export interface Entry { kind: string; prio: Prio; atMs: number }
export const STALE_MS = 15_000;

export function createQueue(cap = 5) {
  let items: Entry[] = [];
  return {
    enqueue(kind: string, prio: Prio, nowMs: number) {
      const i = items.findIndex((e) => e.kind === kind);
      if (i >= 0) { items[i] = { kind, prio, atMs: nowMs }; return; }   // dedupe refreshes
      if (items.length >= cap) {
        let drop = -1;                                                  // cap: drop oldest
        for (const p of [2, 1, 0] as const) {                           // lowest-prio first,
          const j = items.findIndex((e) => e.prio === p);               // control (0) last resort
          if (j >= 0) { drop = j; break; }
        }
        items.splice(drop, 1);
      }
      items.push({ kind, prio, atMs: nowMs });
    },
    dequeue(nowMs: number): { kind: string; prio: Prio } | null {
      items = items.filter((e) => e.prio === 0 || nowMs - e.atMs < STALE_MS); // drop stale; control never stale
      if (items.length === 0) return null;
      let best = 0;                                                      // highest priority first,
      for (let i = 1; i < items.length; i++) if (items[i].prio < items[best].prio) best = i;
      const [e] = items.splice(best, 1);                                 // FIFO within class
      return { kind: e.kind, prio: e.prio };
    },
    clear() { items = []; },
    size() { return items.length; },
  };
}
