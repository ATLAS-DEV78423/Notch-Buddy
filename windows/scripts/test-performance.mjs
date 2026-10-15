import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createDOM } from "./navigation-dom.mjs";

// Production State, Island/FSM, springs, reactions, upload timeline and mini
// engines. Only native services, page builders and canvas rasterization are
// replaced. Counts measure JS scheduling/work, not CPU or native frame time.
const benchmark = process.argv.includes("--benchmark");
const before = process.argv.find((arg) => arg.startsWith("--before="))?.slice("--before=".length);
const snapshots = new Map([["island/island", "island.ts"], ["core/state", "state.ts"],
  ["core/spring", "spring.ts"], ["mochi/minibots", "minibots.ts"]]);
function harness() {
  const { window, document } = createDOM();
  let now = 0, dateNow = 0, nextId = 0;
  const timers = new Map(), raf = new Map();
  const counts = { raf: 0, timerCallbacks: 0, sync: 0, primaryUpdates: 0, primaryDraws: 0,
    miniUpdates: 0, miniDraws: 0, viewTicks: 0, backgroundDraws: 0, uploadDraws: 0 };
  const sounds = [];
  const context = new Proxy({}, { get: (_o, key) => key === "measureText"
    ? () => ({ width: 0 }) : () => context });
  const proto = Object.getPrototypeOf(document.body);
  Object.defineProperty(proto, "isConnected", { get() { return document.contains(this); }, configurable: true });
  proto.replaceChildren = function (...children) {
    for (const child of [...this.children]) this.removeChild(child);
    this.append(...children);
  };
  proto.removeEventListener = function (type, callback) {
    this.listeners = this.listeners.filter((entry) => entry.type !== type || entry.callback !== callback);
  };
  const oldClassList = Object.getOwnPropertyDescriptor(proto, "classList").get;
  Object.defineProperty(proto, "classList", { get() {
    const list = oldClassList.call(this);
    list.add = (...names) => names.forEach((name) => list.toggle(name, true));
    list.remove = (...names) => names.forEach((name) => list.toggle(name, false));
    return list;
  }, configurable: true });
  const create = document.createElement;
  document.createElement = (tag) => {
    const node = create(tag);
    node.dataset = {};
    node.getContext = () => context;
    return node;
  };
  window.setTimeout = (fn, delay = 0) => {
    const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id;
  };
  window.setInterval = (fn, delay) => {
    const id = ++nextId; timers.set(id, { fn, at: now + delay, delay }); return id;
  };
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  globalThis.window = window;
  globalThis.document = document;
  globalThis.performance = { now: () => now };
  Date.now = () => dateNow;
  Math.random = () => 0.5;
  globalThis.setTimeout = window.setTimeout;
  globalThis.requestAnimationFrame = (fn) => { const id = ++nextId; raf.set(id, fn); return id; };
  const frame = (dt = 1000 / 60) => {
    now += dt;
    const callbacks = [...raf.values()]; raf.clear();
    for (const fn of callbacks) { counts.raf++; fn(now); }
  };
  // Deliver each currently due callback once, like an event loop resuming after
  // a suspension. Intervals do not synthesize missed callbacks.
  const advance = (ms) => {
    now += ms;
    dateNow += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at > now || !timers.has(id)) continue;
      if (timer.delay) timer.at = now + timer.delay;
      else timers.delete(id);
      counts.timerCallbacks++; timer.fn();
    }
  };
  const host = () => ({ el: document.createElement("div"), sync() { counts.sync++; },
    tick() { counts.viewTicks++; } });
  const hosts = new Map(["overview", "dashboard", "approval", "greeting", "upload", "uploading", "choose", "pomodoro", "stopwatch", "note"]
    .map((name) => [name, host()]));
  let effect = "off";
  const stubs = new Map([
    ["core/bridge", { Bridge: new Proxy({}, { get: () => () => Promise.resolve() }), IS_TAURI: true, onDragDrop: () => {} }],
    ["core/sound", { Sound: new Proxy({}, { get: (_o, key) => key === "play" ? (name) => sounds.push(name) : () => {} }) }],
    ["mochi/power", { startPowerWatch: () => () => {} }],
    ["mochi/greeting", { Greeting: class { start() {} interrupt() {} draw() {} } }],
    ["upload/canvas", { UploadCanvas: class { el = document.createElement("canvas"); draw() { counts.uploadDraws++; } } }],
    ["views/backgroundEffects", { backgroundEffect: () => effect, backgroundColors: () => [], drawBackground: () => counts.backgroundDraws++ }],
    ["views/views", { buildHeader: host, buildBanners: host, buildCompactStatus: host, buildViews: () => hosts }],
  ]);
  const root = fileURLToPath(new URL("../src/", import.meta.url));
  const modules = new Map();
  function load(file) {
    const key = file.slice(root.length).replace(/\\/g, "/").replace(/\.ts$/, "");
    if (stubs.has(key)) return stubs.get(key);
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} }; modules.set(file, module);
    const sourceFile = before && snapshots.has(key) ? resolve(before, snapshots.get(key)) : file;
    const { outputText } = ts.transpileModule(readFileSync(sourceFile, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
    });
    new Function("require", "module", "exports", outputText)((name) => {
      assert.ok(name.startsWith("."), `unexpected runtime dependency ${name}`);
      return load(resolve(dirname(file), `${name}.ts`));
    }, module, module.exports);
    return module.exports;
  }
  const source = (path) => load(resolve(root, `${path}.ts`));
  const { State, startTimerTick } = source("core/state");
  const { BotEngine } = source("mochi/engine");
  const update = BotEngine.prototype.update;
  BotEngine.prototype.update = function (dt) {
    counts[this.isMini ? "miniUpdates" : "primaryUpdates"]++;
    update.call(this, dt);
    for (const value of [this.yaw, this.pitch, this.sy, this.sx, this.slotH]) assert.ok(Number.isFinite(value));
  };
  BotEngine.prototype.draw = function () { counts[this.isMini ? "miniDraws" : "primaryDraws"]++; };
  const { Island } = source("island/island");
  const island = new Island(document.body);
  const mini = source("mochi/minibots");
  const task = (id, state = "idle") => ({ id, name: id, color: "#FFFFFF", state, steps: [], stepDetails: [], stepIndex: 0, source: "agent", isIntegration: false });
  const setupMinis = () => {
    State.tasks = [task("primary"), task("other", "working")]; State.focusId = "primary";
    hosts.get("overview").el.append(mini.createMiniBot(State.tasks[1], 24));
    State.mode = "compact";
    island.dirty = true; island.ensureRunning(); frame();
    island.fsm.state = "petit";
    island.fsm.forceHidden(); frame();
  };
  const reset = () => { for (const key of Object.keys(counts)) counts[key] = 0; };
  const active = (view = "overview") => { island.alert(view); frame(); };
  return { State, startTimerTick, island, mini, task, frame, advance, setDateNow: (value) => { dateNow = value; }, raf, timers, counts, sounds,
    setupMinis, reset, active, hosts, source, setEffect: (fx) => { effect = fx; } };
}

const results = {};
{
  const h = harness(); h.setupMinis(); h.reset();
  for (let i = 0; i < 100; i++) { h.State.notify(); h.frame(); }
  results.hiddenNotifications = { ...h.counts };
}
{
  const h = harness(); h.startTimerTick(); h.reset();
  for (let i = 0; i < 60; i++) h.advance(1000);
  results.idleTimer = { callbacks: h.counts.timerCallbacks, pending: h.timers.size };
  h.State.timerSetMode("stopwatch"); h.State.timerToggle(); h.reset();
  for (let i = 0; i < 10; i++) { h.advance(1000); h.frame(); }
  results.runningTimer = { callbacks: h.counts.timerCallbacks, seconds: h.State.timer.remaining, raf: h.counts.raf };
  h.State.timerReset(); h.advance(1000); h.reset();
  for (let i = 0; i < 60; i++) h.advance(1000);
  results.resetTimer = { callbacks: h.counts.timerCallbacks, pending: h.timers.size };
}
for (const mode of ["hidden", "compact", "expanded"]) {
  const h = harness(); h.setupMinis();
  if (mode === "compact") h.island.reveal();
  if (mode === "expanded") h.active();
  h.reset();
  for (let i = 0; i < 60; i++) { if (mode === "hidden") h.State.notify(); h.frame(); }
  results[`minis_${mode}`] = { frames: h.counts.raf, updates: h.counts.miniUpdates, draws: h.counts.miniDraws };
}
results.cadence = {};
for (const hz of [60, 120, 144, 240]) {
  const h = harness(); h.State.stateOverride = "working"; h.active(); h.reset();
  for (let i = 0; i < hz; i++) h.frame(1000 / hz);
  results.cadence[hz] = { frames: h.counts.raf, draws: h.counts.primaryDraws };
}
{
  const h = harness();
  const { spring } = h.source("core/spring"), { SHELL_WIDTH } = h.source("core/motion-tokens");
  results.spring200ms = {};
  for (const hz of [60, 120, 144, 240]) {
    const s = spring(0, SHELL_WIDTH); s.set(720);
    let time = 0;
    while (time < 200 - 1e-6) { const dt = Math.min(1000 / hz, 200 - time); s.step(dt); time += dt; }
    results.spring200ms[hz] = s.value;
  }
}
console.log(JSON.stringify(results, null, 2));
if (benchmark) process.exit(0);

assert.equal(results.hiddenNotifications.raf, 0, "routine hidden notifications must not schedule frames");
assert.equal(results.hiddenNotifications.sync, 0, "hidden DOM sync is deferred until reveal");
assert.equal(results.hiddenNotifications.primaryDraws, 0);
assert.equal(results.hiddenNotifications.miniUpdates, 0);
assert.equal(results.idleTimer.callbacks, 0, "stopped timer has no 1Hz callback");
assert.equal(results.idleTimer.pending, 0);
assert.equal(results.resetTimer.callbacks, 0);
assert.equal(results.runningTimer.seconds, 10);
assert.equal(results.runningTimer.raf, 0, "running hidden stopwatch notifies without rendering");
for (const mode of ["compact", "expanded"]) {
  assert.equal(results[`minis_${mode}`].frames, 60);
  assert.equal(results[`minis_${mode}`].updates, 60, "only the visible mini surface updates");
  assert.equal(results[`minis_${mode}`].draws, 60);
}
assert.equal(results.minis_hidden.updates, 0);
for (const hz of [60, 120, 144, 240]) assert.deepEqual(results.cadence[hz], { frames: hz, draws: hz });
const positions = Object.values(results.spring200ms);
assert.ok(Math.max(...positions) - Math.min(...positions) < 1, "shell trajectory stays within 1px across refresh rates");

{
  const h = harness(); h.startTimerTick(); h.startTimerTick();
  h.State.timerSetMode("stopwatch"); h.State.timerToggle();
  assert.equal(h.timers.size, 1, "timer registration is idempotent");
  h.advance(4500);
  assert.equal(h.State.timer.remaining, 4, "delayed stopwatch tick catches up to wall time");
  h.State.notify(); h.advance(500);
  assert.equal(h.State.timer.remaining, 4, "routine notifications do not reset the timer clock");
  h.advance(500);
  assert.equal(h.State.timer.remaining, 5, "fractional seconds survive a delayed tick");
  h.State.setView("pomodoro");
  assert.equal(h.State.timer.mode, "focus"); assert.equal(h.State.timer.running, false);
  assert.equal(h.timers.size, 0, "timer ownership change cancels ticking");
  h.State.timer.remaining = 3;
  h.State.timerToggle(); h.advance(4500);
  assert.equal(h.State.timer.remaining, 0); assert.equal(h.State.timer.running, false);
  assert.ok(h.sounds.includes("finish"), "hidden completion still chimes");
  assert.equal(h.State.mode, "compact", "hidden completion still peeks");
  assert.ok(h.raf.size > 0, "peek wakes rendering");
  h.frame(); h.advance(4000); h.frame();
  assert.equal(h.State.mode, "hidden"); h.reset(); h.State.notify(); h.frame();
  assert.equal(h.counts.raf, 0, "peek retracts back to sleep");
}
{
  const h = harness(); h.startTimerTick(); h.State.timerSetMode("break"); h.State.timerToggle();
  h.advance(2300); assert.equal(h.State.timer.remaining, 298);
  h.State.timerToggle(); h.reset(); h.advance(60000);
  assert.equal(h.counts.timerCallbacks, 0, "pause removes the clock");
  assert.equal(h.State.timer.remaining, 298);
  h.State.timerToggle(); h.advance(1000); assert.equal(h.State.timer.remaining, 297);
  h.State.timerSetMode("stopwatch");
  assert.equal(h.State.timer.remaining, 0); assert.equal(h.State.timer.running, false);
  assert.equal(h.timers.size, 0, "switching timer mode stops and rewinds");
}
{
  const h = harness(); h.setupMinis();
  h.State.setFocus("other"); h.State.setView("dashboard");
  assert.equal(h.raf.size, 0);
  h.island.reveal(); h.frame();
  assert.equal(h.island.engine.state, "working", "reveal consumes the latest dirty state");
  h.island.alert("approval"); h.frame();
  assert.equal(h.State.view, "approval"); assert.equal(h.State.mode, "expanded");
  assert.equal(h.island.botGlow.style.display, "block");
  h.island.fsm.forceHidden(); h.frame(); h.reset();
  h.source("mochi/reactions").react("volume", { intensity: 0.8 }); h.frame();
  assert.equal(h.counts.raf, 0, "unseen reactions cannot resurrect a hidden renderer");
  h.island.reveal(); h.frame();
  assert.ok(h.island.engine.busy, "visible reactions remain active");
  h.island.alert("approval"); h.frame();
  assert.equal(h.island.botGlow.style.display, "block", "same-color glow returns after hiding");
}
{
  const h = harness(); h.setupMinis(); h.active("dashboard"); h.reset();
  for (let i = 0; i < 120; i++) h.frame();
  assert.equal(h.counts.miniDraws, 0, "inactive overview and compact grid stay undrawn");
  h.active("overview"); h.island.engine.update = () => {};
  Object.defineProperty(h.island.engine, "busy", { get: () => false });
  h.island.botCx.set(h.island.botCx.target); h.island.botCy.set(h.island.botCy.target); h.island.botSize.set(h.island.botSize.target);
  h.reset(); for (let i = 0; i < 240; i++) h.frame();
  assert.equal(h.counts.miniDraws, 240, "visible minis keep animating when the primary is idle");
  h.island.fsm.forceHidden(); h.frame(); h.reset(); h.island.onCursor(-10000, -10000); h.frame();
  assert.equal(h.counts.raf, 0, "hidden cursor updates stay asleep");
  const detached = h.mini.createMiniBot(h.task("detached", "working"), 24);
  h.State.notify(); h.island.alert("overview"); h.frame(); h.reset(); h.frame();
  assert.equal(h.counts.miniDraws, 1, "disconnected canvases never draw");
  assert.equal(detached.isConnected, false);
}
{
  const h = harness(); h.active("dashboard"); h.setEffect("rain"); h.State.notify(); h.reset();
  for (let i = 0; i < 240; i++) h.frame(1000 / 240);
  assert.equal(h.counts.backgroundDraws, 240, "active effect runs on every display frame");
  const { UploadSeq } = h.source("upload/sequence");
  h.island.onDragDrop({ type: "enter" });
  // The real drop path sets this after ingestion succeeds; keep the isolated
  // timeline fixture on that successful path instead of testing the failure gate.
  h.State.droppedFile = { name: "fixture.txt", path: "fixture.txt" };
  UploadSeq.performDrop(h.State.uploadDuration); h.island.setView("uploading"); h.reset();
  for (let i = 0; i < 1200; i++) h.frame(1000 / 240);
  assert.equal(h.counts.uploadDraws, 1200); assert.equal(h.State.view, "choose", "upload timeline reaches choose");
  h.island.setView("dashboard"); assert.equal(UploadSeq.isActive, false);
  h.source("core/anim").setPrefersReduced(true);
  h.island.animateGeometry(); assert.equal(h.island.shellMoving, false, "reduced motion snaps geometry");
  h.island.fsm.forceHidden(); h.frame(); h.reset(); h.State.notify(); h.frame();
  assert.equal(h.counts.raf, 0, "active effects/upload do not keep hidden rendering awake");
}
{
  const h = harness(); const { spring } = h.source("core/spring");
  h.State.stateOverride = "working"; h.active();
  const { SHELL_WIDTH, SHELL_HEIGHT, SHELL_Y, SHELL_RADIUS } = h.source("core/motion-tokens");
  for (const cfg of [SHELL_WIDTH, SHELL_HEIGHT, SHELL_Y, SHELL_RADIUS]) {
    const s = spring(0, cfg); s.set(720);
    for (let i = 0; i < 500; i++) {
      if (i === 12) s.set(160);
      s.step([1000 / 240, 16.67, 50, 8.33, 6.94][i % 5]);
      h.frame([1000 / 240, 16.67, 50, 8.33, 6.94][i % 5]);
      assert.ok(Number.isFinite(s.value) && Number.isFinite(s.v));
    }
    assert.equal(s.done, true); assert.equal(s.value, 160);
  }
}
{
  const h = harness(); h.active(); h.island.fsm.forceHidden(); h.frame();
  // Exercise the hidden-settling guard independently of the current hide snap.
  h.island.shell.w.set(400, true); h.island.shell.w.set(0);
  h.island.ensureRunning(); h.island.peek(4000); h.reset();
  for (let i = 0; i < 240 && h.State.mode === "hidden"; i++) {
    h.State.notify(); h.frame(1000 / 120);
    assert.equal(h.counts.primaryDraws, 0, "hidden settling only steps geometry");
    assert.equal(h.counts.miniDraws, 0);
  }
  assert.equal(h.State.mode, "compact", "a deferred event peek wakes after settling");
  h.advance(4000); h.frame(); assert.equal(h.State.mode, "hidden");
  h.reset(); h.State.notify(); h.frame(); assert.equal(h.counts.raf, 0);
}
{
  const h = harness(); h.startTimerTick(); h.State.timerSetMode("stopwatch"); h.State.timerToggle();
  h.advance(1500);
  h.setDateNow(500); h.advance(1000);
  assert.equal(h.State.timer.remaining, 2, "stopwatch ignores a backward wall-clock jump");
  h.setDateNow(10000); h.advance(1000);
  assert.equal(h.State.timer.remaining, 3, "stopwatch ignores a forward wall-clock jump");
}
{
  const h = harness(); h.startTimerTick(); h.State.timerSetMode("focus"); h.State.timer.remaining = 4; h.State.timerToggle();
  h.advance(1500);
  h.setDateNow(500); h.advance(1000);
  assert.equal(h.State.timer.remaining, 2, "countdown ignores a backward wall-clock jump");
  h.setDateNow(10000); h.advance(1000);
  assert.equal(h.State.timer.remaining, 1, "countdown ignores a forward wall-clock jump");
}
console.log("production performance scheduling, timer, mini visibility, display cadence and motion: ok");
