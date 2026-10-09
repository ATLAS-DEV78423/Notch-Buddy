// Zero-dep motion-vocabulary check. Run from windows/:
//   node --experimental-strip-types src/core/anim.test.mjs
import assert from "node:assert/strict";

const {
  Ease, Spring, Tracked, closeCurve, cubicBezier,
  prefersReduced, setPrefersReduced, staggerDelay,
} = await import("./anim.ts");

// Easings hit their endpoints exactly.
assert.equal(Ease.out(0), 0);
assert.equal(Ease.out(1), 1);
assert.equal(Ease.inOut(0), 0);
assert.equal(Ease.inOut(1), 1);
assert.equal(Ease.back(0), 0);
assert.equal(Ease.back(1), 1);
assert.ok(Ease.back(0.7) > 1, "back overshoots mid-flight");

// closeCurve is the SPEC close curve: endpoints exact, monotonic non-decreasing.
assert.equal(closeCurve(0), 0);
assert.equal(closeCurve(1), 1);
let prev = -1;
for (let i = 0; i <= 20; i++) {
  const v = closeCurve(i / 20);
  assert.ok(v >= prev - 1e-9, `closeCurve monotonic at ${i}`);
  prev = v;
}

// A spring converges on its target and reports settled.
const s = new Spring(0);
s.target = 100;
for (let i = 0; i < 600; i++) s.step(1 / 60);
assert.ok(Math.abs(s.value - 100) < 0.5, `spring converged: ${s.value}`);
assert.ok(s.settled, "spring reports settled");

// Tracked curve mode lands exactly on target.
const t = new Tracked(10);
t.curveTowards(0, 340, 0);
t.step(1 / 60, 400);
assert.equal(t.value, 0);

// Stagger math: 35 ms per item (SPEC §4).
assert.equal(staggerDelay(0), "0ms");
assert.equal(staggerDelay(3), "105ms");

// Reduced motion starts unset; the flag is settable.
assert.equal(prefersReduced(), false);
setPrefersReduced(true);
assert.equal(prefersReduced(), true);
setPrefersReduced(false);

// Reduced motion: one step snaps to target, both spring and curve modes.
setPrefersReduced(true);
const s2 = new Spring(0);
s2.target = 100;
s2.step(1 / 60);
assert.equal(s2.value, 100, "spring snaps under reduced motion");
const t2 = new Tracked(10);
t2.curveTowards(0, 340, 0);
t2.step(1 / 60, 1);
assert.equal(t2.value, 0, "curve snaps under reduced motion");
setPrefersReduced(false);

console.log("anim motion vocabulary OK");
