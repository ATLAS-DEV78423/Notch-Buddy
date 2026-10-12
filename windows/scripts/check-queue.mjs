import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert";

const out = mkdtempSync(join(tmpdir(), "rq-"));
try {
  execSync(`npx tsc src/mochi/reaction-queue.ts --outDir "${out}" --module esnext --target es2022 --skipLibCheck`, { stdio: "inherit" });
  const { createQueue, STALE_MS } = await import(pathToFileURL(join(out, "reaction-queue.js")).href);

  const q = createQueue(5);
  q.enqueue("other-a", 2, 1000);
  q.enqueue("session-x", 1, 1001);
  q.enqueue("control-y", 0, 1002);
  assert.equal(q.dequeue(1003).kind, "control-y");
  assert.equal(q.dequeue(1004).kind, "session-x");
  assert.equal(q.dequeue(1005).kind, "other-a");

  const d = createQueue(5);
  d.enqueue("k", 2, 0); d.enqueue("k", 1, 10);
  assert.equal(d.size(), 1);

  const c = createQueue(2);
  c.enqueue("a", 2, 0); c.enqueue("b", 2, 1); c.enqueue("c", 2, 2);
  assert.equal(c.size(), 2);

  const s = createQueue(5);
  s.enqueue("old", 2, 0);
  assert.equal(s.dequeue(STALE_MS + 1), null);

  const p = createQueue(5);
  p.enqueue("o", 2, 0); p.enqueue("ctl", 0, 1);
  p.enqueue("o2", 2, 2); p.enqueue("o3", 2, 3); p.enqueue("o4", 2, 4); p.enqueue("o5", 2, 5);
  assert.equal(p.size(), 5);
  assert.equal(p.dequeue(100000).prio, 0);

  console.log("queue checks OK");
} finally {
  rmSync(out, { recursive: true, force: true });
}
