// Zero-dep spring-integrator check. Run from windows/:
//   node --experimental-strip-types src/core/spring.test.mjs
import assert from "node:assert/strict";

const { spring } = await import("./spring.ts");

// 1. Settle: converges exactly, fast enough (< 400 ms to come within 1).
const s1 = spring(0, { k: 400, c: 31 });
s1.set(100);
let t = 0;
let firstNear = -1;
for (let i = 0; i < 5000 && !s1.done; i++) {
  s1.step(16);
  t += 16;
  if (firstNear < 0 && Math.abs(s1.value - 100) < 1) firstNear = t;
}
assert.ok(s1.done, "settles within 5000 steps");
assert.equal(s1.value, 100, "final value is exactly the target");
assert.equal(Math.abs(s1.v), 0, "velocity zeroed on settle");
assert.ok(firstNear > 0 && firstNear < 400, `within 1 of target in ${firstNear} ms`);

// 2. Retarget mid-flight: no teleport, then settles at the new target.
const s2 = spring(0, { k: 400, c: 31 });
s2.set(100);
let acc = 0;
while (acc < 100) {
  s2.step(16);
  acc += 16;
}
s2.set(0);
const before = s2.value;
s2.step(16);
assert.ok(Math.abs(s2.value - before) < 30, `no teleport: jumped ${Math.abs(s2.value - before).toFixed(2)}`);
for (let i = 0; i < 5000 && !s2.done; i++) s2.step(16);
assert.ok(s2.done, "retarget settles");
assert.equal(s2.value, 0, "settles at the new target");

// 3. Immediate set snaps and settles on the next step.
const s3 = spring(0, { k: 500, c: 30 });
s3.set(50, true);
assert.equal(s3.value, 50, "immediate set snaps value");
assert.equal(s3.step(16), 50, "step returns the snapped value");
assert.equal(s3.done, true, "done on the next step");

// 4. Sleep: once done, steps are no-ops.
assert.equal(s1.done, true, "s1 still settled");
const vBefore = s1.v;
assert.equal(s1.step(16), 100, "sleeping step returns the settled value");
assert.equal(s1.value, 100, "value unchanged while sleeping");
assert.equal(s1.v, vBefore, "velocity unchanged while sleeping");

// 5. Clamp: a huge dt does not explode (dt capped to 32 ms internally).
const s5 = spring(0, { k: 400, c: 31 });
s5.set(100);
s5.step(1000);
assert.ok(Number.isFinite(s5.value), "value stays finite");
assert.ok(Number.isFinite(s5.v), "velocity stays finite");
assert.ok(Math.abs(s5.value) < 1000, `dt clamped: value ${s5.value.toFixed(1)}`);

console.log("spring integrator OK");
