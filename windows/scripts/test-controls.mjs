// Regression tests execute the real TypeScript modules, bundled in memory.
import { build } from "esbuild";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const domSource = readFileSync(resolve(root, "src/views/dom.ts"), "utf8");
const viewsSource = readFileSync(resolve(root, "src/views/views.ts"), "utf8");
const headerSource = readFileSync(resolve(root, "src/views/header.ts"), "utf8");
const viewUiSource = `${viewsSource}\n${headerSource}`;
const chatSource = readFileSync(resolve(root, "src/views/chat.ts"), "utf8");
const integrationsSource = readFileSync(resolve(root, "src/views/integrations.ts"), "utf8");
const settingsSource = readFileSync(resolve(root, "src/settings/main.ts"), "utf8");
const styleSource = readFileSync(resolve(root, "src/style.css"), "utf8");
const layoutSource = readFileSync(resolve(root, "src/core/layout.ts"), "utf8");
const result = await build({
  stdin: { contents: `
    export { State } from "./src/core/state";
    export { BotEngine } from "./src/mochi/engine";
    export { startPowerWatch } from "./src/mochi/power";
    export { setPrimaryEngine, setCondition, react, tickReactions } from "./src/mochi/reactions";
    export { batteryTier } from "./src/ui/batteryicon";
    export { setPrefersReduced } from "./src/core/anim";
    export { h } from "./src/views/dom";
    export { VIEW_LAYOUTS, PIP_SAFE_INSET } from "./src/core/layout";
    export { Bridge } from "./src/core/bridge";
    export { buildMediaView, buildControlCenter, buildSettings, buildDashboardView, buildWeatherView } from "./src/views/views";
    export { captureStep, stepKind, diffForStep, diffLines, diffStat, modelFromPayload, thinkingFromPayload } from "./src/core/steps";
  `, resolveDir: root },
  bundle: true, platform: "node", format: "esm", write: false,
   plugins: [{ name: "test-view-exports", setup(build) {
     build.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, namespace: "css-stub" }));
     build.onLoad({ filter: /.*/, namespace: "css-stub" }, () => ({ contents: "", loader: "js" }));
     build.onLoad({ filter: /[/\\]views[/\\]views\.ts$/ }, () => ({
       contents: viewsSource + "\nexport { buildMediaView, buildControlCenter, buildSettings, buildDashboardView, buildWeatherView };",
       loader: "ts", resolveDir: resolve(root, "src/views"),
     }));
   } }],
});
const app = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const { State, BotEngine, startPowerWatch, setPrimaryEngine, setCondition, react, tickReactions, batteryTier, setPrefersReduced, captureStep, stepKind, diffForStep, diffLines, diffStat, modelFromPayload, thinkingFromPayload } = app;
const { VIEW_LAYOUTS, PIP_SAFE_INSET } = app;

function setup() {
  State.tasks = [];
  State.stateOverride = null;
  State.media = null;
  State.battery = { level: 100, charging: false, timeRemaining: 0, known: false };
  State.systemControls = { dnd: false, nightLight: false };
  for (const kind of ["battery-drained", "battery-exhausted", "battery-charging", "battery-full", "dnd-sleep", "media-playing", "media-paused"]) setCondition(kind, false);
  setPrefersReduced(false);
  const engine = new BotEngine();
  setPrimaryEngine(engine);
  tickReactions(performance.now() + 60000); // clear previous transient
  const stop = startPowerWatch();
  return { engine, stop };
}
function sample(level, charging = false, known = true) {
  State.battery = { level, charging, known, timeRemaining: 0 };
  State.notify();
  tickReactions(performance.now());
}

test("battery icon warns red at 20 percent and stays yellow in low-power mode", () => {
  assert.equal(batteryTier(20, false), "critical");
  assert.equal(batteryTier(21, false), "healthy");
  assert.equal(batteryTier(50, false, true), "low");
  assert.equal(batteryTier(8, true, true), "charging");
});
test("unknown battery sample cannot make Pip flex at boot", () => {
  const { engine, stop } = setup();
  try { sample(100, false, false); assert.equal(engine.poseName, null); }
  finally { stop(); }
});
test("Pip changes from full energy to normal to tired to exhausted, then recovers", () => {
  const { engine, stop } = setup();
  try {
    sample(100); assert.equal(engine.poseName, "flex"); assert.equal(engine.badge, null);
    sample(50); assert.equal(engine.poseName, null);
    sample(15); assert.equal(engine.poseName, "drained");
    sample(10); assert.equal(engine.poseName, "exhausted");
    engine.update(1 / 60); assert.ok(engine.sy < 1, "exhausted body slumps instead of stretching tall");
    sample(50); assert.equal(engine.poseName, null);
    sample(8, true); assert.equal(engine.poseName, "perky");
  } finally { stop(); }
});
test("active agent approvals are not hidden behind battery fatigue", () => {
  const { engine, stop } = setup();
  try {
    State.stateOverride = "approval";
    sample(8);
    assert.equal(engine.poseName, null);
  } finally { State.stateOverride = null; stop(); }
});
test("DND puts a fully charged Pip to sleep and waking restores his energy", () => {
  const { engine, stop } = setup();
  try {
    sample(100); setCondition("dnd-sleep", true); tickReactions(performance.now());
    assert.equal(engine.poseName, "sleep");
    setCondition("dnd-sleep", false); react("dnd-wake"); tickReactions(performance.now());
    assert.equal(engine.poseName, "perky");
  } finally { setCondition("dnd-sleep", false); stop(); }
});
test("night-light and memory feedback remain visible while music plays", () => {
  const { engine, stop } = setup();
  try {
    sample(50); setCondition("media-playing", true);
    react("night-light-on"); tickReactions(performance.now());
    assert.equal(engine.poseName, "squint-happy");
    react("memory-freed"); tickReactions(performance.now());
    assert.equal(engine.poseName, "squint-happy");
    assert.ok(engine.auraI > 0);
  } finally { setCondition("media-playing", false); stop(); }
});
test("reduced motion freezes DND breathing", () => {
  const engine = new BotEngine();
  setPrefersReduced(true);
  engine.setPoseOverride("sleep");
  engine.update(1 / 60);
  assert.equal(engine.sy, 1);
  setPrefersReduced(false);
});
test("triple click spins spiral eyes for the whole dizzy hold, and only there", () => {
  // The engine's tweens and busy deadline ride performance.now(), and its blink
  // schedule rides Math.random (engine.ts nextBlink = now + 1.5 + rand*2,
  // re-armed at +2.2 + rand*3.2): freeze both so the hold is a pure fake clock.
  // A random blink tween landing in the recovery window keeps engine.busy true
  // legitimately and flakes the final assertion.
  const realNow = performance.now;
  const realRandom = Math.random;
  let clock = realNow.call(performance);
  performance.now = () => clock;
  Math.random = () => 0.5; // nextBlink crosses at t+2.5s; its 200ms tween ends at 2.7s, re-arm lands at 6.3s
  let engine, stop;
  try {
    ({ engine, stop } = setup());
    const frame = () => { clock += 1000 / 60; engine.update(1 / 60); };
    // Mirror island.handleDizzy: the engine fires onDizzy on the third slap and
    // the island pins the dizzy state for 3.3 s.
    let dizzyFired = 0;
    engine.onDizzy = () => {
      dizzyFired++;
      State.stateOverride = "dizzy";
      engine.setState("dizzy");
    };
    engine.slap(); engine.slap(); engine.slap();
    assert.equal(dizzyFired, 1);
    assert.equal(engine.state, "dizzy");
    // The annoyed "line" override from the first two slaps must not mask the
    // spiral: from the first frame the eyes resolve to the state's spiral.
    assert.equal(engine.eyeOverride, null);
    assert.equal(engine.cfg.eye, "spiral");
    // The roll tween covers 1.3 s; afterwards the dizzy state itself has to
    // keep the loop awake, or the spiral freezes mid-spin for the ~2 s hold.
    for (let i = 0; i < 120; i++) frame();
    assert.equal(engine.tweens.size, 0, "the roll has finished");
    assert.equal(engine.busy, true, "dizzy holds the frame loop after the roll");
    // Recovery (handleDizzy's 3.3 s timer) releases the loop again.
    State.stateOverride = null;
    engine.setState("idle");
    for (let i = 0; i < 200; i++) frame();
    assert.equal(engine.busy, false,
      `busy terms — tweens: [${[...engine.tweens.keys()]}], particles: ${engine.particles.length}, ` +
      `reactionUntil-clock: ${Math.round(engine.reactionUntil - clock)}ms, pose: ${engine.poseName}, ` +
      `aura: ${engine.auraColor}, state: ${engine.state}`);
    assert.equal(engine.eyeOverride, null);
  } finally {
    performance.now = realNow;
    Math.random = realRandom;
    State.stateOverride = null;
    if (engine) engine.onDizzy = null;
    if (stop) stop();
  }
});
test("step capture classifies tools and keeps their arguments for the viewer", () => {
  const bash = captureStep("Bash", { command: "cargo test --all" });
  assert.equal(bash.label, "Exécute · cargo test --all");
  assert.equal(stepKind(bash), "bash");

  const read = captureStep("Read", { file_path: "C:/repo/src\\main.ts" });
  assert.equal(read.label, "Lit · main.ts");
  assert.equal(stepKind(read), "read");

  const edit = captureStep("Edit", { file_path: "a.ts" });
  assert.equal(stepKind(edit), "edit");

  const prompt = { label: "Fix the tests", tool: "", input: {} };
  assert.equal(stepKind(prompt), "prompt");
});

test("the viewer's diff covers Claude Code edits, OpenCode patches and writes", () => {
  // Claude Code Edit: old_string / new_string become a line diff.
  const edit = diffForStep(captureStep("Edit", {
    file_path: "src/a.ts",
    old_string: "const TVA = 0.196;",
    new_string: "const TVA = 0.21;",
  }));
  assert.ok(edit);
  assert.equal(edit.path, "src/a.ts");
  assert.deepEqual(diffStat(edit.rows), { added: 1, removed: 1 });

  // A real edit keeps unchanged context lines.
  const ctx = diffLines("a\nb\nc", "a\nB\nc");
  assert.deepEqual(ctx.map((r) => r.kind), ["ctx", "del", "add", "ctx"]);
  assert.deepEqual(ctx.map((r) => r.text), ["a", "b", "B", "c"]);

  // OpenCode session.diff: a unified patch.
  const patch = diffForStep({
    label: "Modifie · x.ts",
    tool: "Edit",
    input: {
      file_path: "x.ts",
      diff: "@@ -1,2 +1,2 @@\n-old\n+new\n ctx",
    },
  });
  assert.ok(patch);
  assert.deepEqual(patch.rows.map((r) => r.kind), ["hunk", "del", "add", "ctx"]);
  assert.deepEqual(diffStat(patch.rows), { added: 1, removed: 1 });

  // Write: everything is new.
  const write = diffForStep(captureStep("Write", { file_path: "n.ts", content: "one\ntwo" }));
  assert.deepEqual(write.rows.map((r) => r.kind), ["add", "add"]);

  // Bash has no diff.
  assert.equal(diffForStep(captureStep("Bash", { command: "ls" })), null);
});

test("model and thinking come only from what the agent reports", () => {
  assert.equal(modelFromPayload({ model: "opus-4.1" }), "opus-4.1");
  assert.equal(modelFromPayload({ coucou_model: "hermes-large" }), "hermes-large");
  assert.equal(modelFromPayload({}), null);
  assert.equal(thinkingFromPayload({ thinking: "high" }), "high");
  assert.equal(thinkingFromPayload({ reasoning_effort: "Medium" }), "medium");
  assert.equal(thinkingFromPayload({}), null);
});

test("steps and their details stay aligned, and a reset clears the session", () => {
  State.tasks = [];
  State.focusId = null;
  State.settings.activeIntegrations = [];
  State.loadIntegrationTasks();
  const hermes = State.tasks.find((t) => t.id === "agent_hermes");
  State.updateTask("agent_hermes", "working");
  State.appendStep("agent_hermes", captureStep("Bash", { command: "cargo build" }));
  State.appendStep("agent_hermes", "plain label");
  assert.deepEqual(hermes.steps, ["Exécute · cargo build", "plain label"]);
  assert.equal(hermes.stepDetails.length, hermes.steps.length);
  assert.equal(hermes.stepDetails[0].tool, "Bash");
  assert.equal(hermes.stepDetails[1].tool, "");
  assert.equal(hermes.stepIndex, 1);

  State.setAgentInfo("agent_hermes", { model: "opus-4.1", thinking: "high" });
  assert.equal(hermes.model, "opus-4.1");
  assert.equal(hermes.thinking, "high");

  State.resetTask("agent_hermes");
  assert.deepEqual(hermes.steps, []);
  assert.deepEqual(hermes.stepDetails, []);
  assert.equal(hermes.model, null);
  assert.equal(hermes.thinking, null);
  assert.equal(hermes.state, "idle");
});

test("reduced motion lets the dizzy hold sleep the loop", () => {
  const { engine, stop } = setup();
  const realNow = performance.now;
  let clock = realNow.call(performance);
  performance.now = () => clock;
  const frame = () => { clock += 1000 / 60; engine.update(1 / 60); };
  try {
    State.stateOverride = "dizzy";
    engine.setState("dizzy");
    for (let i = 0; i < 120; i++) frame(); // the motion phase runs first
    setPrefersReduced(true);
    for (let i = 0; i < 60; i++) frame(); // wobble off — the head settles
    assert.equal(engine.busy, false, "static frame — the loop may sleep");
  } finally {
    performance.now = realNow;
    setPrefersReduced(false);
    State.stateOverride = null;
    stop();
  }
});
test("the notch lineup is VS Code, Hermes and OpenCode — not the integration Mochis", () => {
  State.tasks = [];
  State.focusId = null;
  State.settings.activeIntegrations = [];
  State.loadIntegrationTasks();
  assert.deepEqual(
    State.tasks.map((t) => t.id),
    ["integration_claude", "agent_hermes", "agent_opencode"],
  );
  // Names and colours ride the agent catalog mirror.
  assert.equal(State.tasks[1].name, "Hermes");
  assert.equal(State.tasks[2].name, "OpenCode");
  // A live session lights the standing pill; its end resets it to sleep
  // instead of removing the Mochi from the notch.
  const hermes = State.tasks.find((t) => t.id === "agent_hermes");
  hermes.state = "working";
  hermes.steps = ["Bash · cargo test"];
  hermes.pillBadge = "finished";
  State.resetTask("agent_hermes");
  assert.equal(hermes.state, "idle");
  assert.deepEqual(hermes.steps, []);
  assert.equal(hermes.pillBadge, null);
  assert.ok(State.tasks.some((t) => t.id === "agent_hermes"));
  // Re-enabling an integration adds it without evicting the standing roster.
  State.toggleIntegration("integration_n8n");
  assert.deepEqual(
    State.tasks.map((t) => t.id),
    ["integration_claude", "agent_hermes", "agent_opencode", "integration_n8n"],
  );
  // Re-seeding is idempotent.
  State.loadIntegrationTasks();
  assert.equal(State.tasks.filter((t) => t.id === "agent_hermes").length, 1);
});

test("dashboard widgets and agent pills are semantic keyboard controls", () => {
  assert.match(viewsSource, /const mediaWidget = h\("button"/);
  assert.match(viewsSource, /const statsWidget = h\("button"/);
  assert.match(viewsSource, /const timerWidget = h\("button"/);
  assert.match(viewsSource, /const pill = h\(\s*"button"/s);
  assert.doesNotMatch(viewsSource, /class: "widget"[^}]*onclick/s);
  assert.doesNotMatch(viewsSource, /class: "pill", onclick/);
});

test("icon-only and chat actions expose accessible names", () => {
  assert.match(viewUiSource, /class: "tab",\s*"aria-label": "Agents"/s);
  assert.match(viewUiSource, /class: "tab",\s*"aria-label": "Ask"/s);
  assert.match(viewUiSource, /class: "tab",\s*"aria-label": "Drop"/s);
  assert.match(viewUiSource, /class: "icon-btn jump",\s*"aria-label": "Open"/s);
  assert.match(viewUiSource, /class: "mc-btn",\s*"aria-label": "Previous"/s);
  assert.match(viewUiSource, /class: "mc-btn mc-play",\s*"aria-label": "Play"/s);
  assert.match(viewUiSource, /class: "mc-btn",\s*"aria-label": "Next"/s);
  assert.match(chatSource, /class: "send-btn"[^}]*"aria-label": "Send"/s);
  assert.match(integrationsSource, /class: "int-more",\s*"aria-label": "Details"/s);
});

test("DOM text and attributes never fall back to object coercion", () => {
  assert.match(domSource, /function safeText\(value: unknown\)/);
  assert.match(domSource, /JSON\.stringify\(value\)/);
  assert.match(domSource, /textContent = safeText\(v\)/);
});

// Just the DOM surface these views use; execute their real listeners and syncs.
class TestElement {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attrs = new Map();
    this.listeners = new Map();
    this.dataset = {};
    this.style = { setProperty() {} };
    this.className = "";
    this.clientWidth = 100;
    this.classList = {
      contains: (name) => this.className.split(" ").includes(name),
      toggle: (name, on) => {
        const classes = new Set(this.className.split(" ").filter(Boolean));
        if (on ?? !classes.has(name)) classes.add(name); else classes.delete(name);
        this.className = [...classes].join(" ");
      },
      add: (name) => this.classList.toggle(name, true),
      remove: (name) => this.classList.toggle(name, false),
    };
  }
  set textContent(text) { this.children = []; this.text = String(text); }
  get textContent() { return (this.text ?? "") + this.children.map((c) => c.textContent ?? String(c)).join(""); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.text = ""; this.children = children; }
  setAttribute(name, value) { this.attrs.set(name, String(value)); }
  getAttribute(name) { return this.attrs.get(name) ?? null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { this.attrs.delete(name); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  fire(type, props = {}) {
    const event = { preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...props };
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
  focus() {}
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, width: 100 }; }
}
function withDOM(run) {
  const before = { document: globalThis.document, window: globalThis.window };
  const timers = new Map();
  let id = 0;
  globalThis.document = {
    createElement: (tag) => new TestElement(tag),
    createElementNS: (_ns, tag) => new TestElement(tag),
    createTextNode: (text) => ({ textContent: text }),
  };
  globalThis.window = {
    setTimeout: (fn) => { timers.set(++id, fn); return id; },
    clearTimeout: (key) => timers.delete(key),
  };
  try { run(() => { for (const fn of timers.values()) fn(); timers.clear(); }); }
  finally { Object.assign(globalThis, before); }
}
function find(el, predicate) {
  if (predicate(el)) return el;
  for (const child of el.children ?? []) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

test("volume and brightness keyboard events share the bounded apply/Bridge path", () => withDOM((flush) => {
  const before = { setVolume: app.Bridge.setVolume, setBrightness: app.Bridge.setBrightness };
  const calls = [];
  app.Bridge.setVolume = (v) => calls.push(["volume", v]);
  app.Bridge.setBrightness = (v) => calls.push(["brightness", v]);
  try {
    State.volume = { level: 0.5, muted: false };
    State.brightness = { level: 0.5 };
    const view = app.buildControlCenter();
    view.sync(); /*
    console.log("DEBUG", view.el.children?.map((x) => [x.className, x.children?.map((y) => [y.className, y.attrs && [...y.attrs])])));
    */
    for (const [label, key, state] of [["Volume", "volume", State.volume], ["Brightness", "brightness", State.brightness]]) {
      const slider = find(view.el, (el) => el.getAttribute?.("aria-label") === label);
      assert.ok(slider, `${label} is named`);
      assert.equal(slider.getAttribute("role"), "slider");
      assert.equal(slider.getAttribute("tabindex"), "0");
      assert.equal(slider.getAttribute("aria-valuenow"), "50");
      assert.equal(slider.fire("keydown", { key: "ArrowRight" }).defaultPrevented, true);
      assert.equal(state.level, 0.51);
      flush();
      assert.deepEqual(calls.at(-1), [key, 0.51]);
      slider.fire("keydown", { key: "End" });
      slider.fire("keydown", { key: "ArrowUp" });
      flush();
      assert.equal(state.level, 1);
      assert.equal(slider.getAttribute("aria-valuenow"), "100");
      slider.fire("keydown", { key: "Home" });
      slider.fire("keydown", { key: "ArrowDown" });
      flush();
      assert.equal(state.level, 0);
      slider.fire("keydown", { key: "PageUp" });
      flush();
      assert.deepEqual(calls.at(-1), [key, 0.1]);
      assert.equal(slider.fire("keydown", { key: "Tab" }).defaultPrevented, undefined);
    }
    const mute = find(view.el, (el) => el.className === "cc-icon-btn");
    State.volume.muted = true;
    view.sync();
    assert.equal(mute.getAttribute("aria-label"), "Unmute");
    assert.equal(mute.getAttribute("aria-pressed"), "true");
    State.volume.muted = false;
    view.sync();
    assert.equal(mute.getAttribute("aria-label"), "Mute");
    assert.equal(mute.getAttribute("aria-pressed"), "false");
  } finally { Object.assign(app.Bridge, before); }
}));

test("media seek keyboard and pointer input use the same bounded Bridge path", () => withDOM(() => {
  const before = app.Bridge.mediaSeek;
  const calls = [];
  app.Bridge.mediaSeek = (v) => calls.push(v);
  try {
    State.media = { track: "Track", artist: "Artist", albumArt: "", duration: 100, position: 50, playing: false };
    const view = app.buildMediaView();
    view.sync();
    const slider = find(view.el, (el) => el.className === "media-progress");
    assert.equal(slider.getAttribute("role"), "slider");
    assert.equal(slider.getAttribute("aria-valuenow"), "50");
    for (const [key, expected] of [["ArrowRight", 55], ["ArrowLeft", 50], ["Home", 0], ["End", 100], ["PageUp", 100]]) {
      assert.equal(slider.fire("keydown", { key }).defaultPrevented, true);
      assert.equal(calls.at(-1), expected);
    }
    slider.fire("click", { clientX: 200 });
    assert.equal(calls.at(-1), 100);
    State.media.duration = 0;
    view.sync();
    const count = calls.length;
    slider.fire("keydown", { key: "End" });
    slider.fire("click", { clientX: 50 });
    assert.equal(calls.length, count);
    assert.equal(slider.getAttribute("aria-disabled"), "true");
    State.media = null;
    view.sync();
    slider.fire("keydown", { key: "Home" });
    assert.equal(calls.length, count);
  } finally { app.Bridge.mediaSeek = before; }
}));

test("media seek keeps rapid keyboard input and pointer dragging responsive", () => withDOM(() => {
  const before = app.Bridge.mediaSeek;
  const calls = [];
  app.Bridge.mediaSeek = (v) => calls.push(v);
  try {
    State.media = { track: "Track", artist: "Artist", albumArt: "", duration: 100, position: 50, playing: false };
    const view = app.buildMediaView();
    view.sync();
    const slider = find(view.el, (el) => el.className === "media-progress");
    slider.fire("keydown", { key: "ArrowRight" });
    slider.fire("keydown", { key: "ArrowRight" });
    assert.deepEqual(calls.slice(-2), [55, 60]);
    slider.fire("pointerdown", { pointerId: 7, clientX: 20 });
    slider.fire("pointermove", { pointerId: 7, clientX: 80 });
    slider.fire("pointerup", { pointerId: 7, clientX: 80 });
    assert.equal(calls.at(-1), 80);
    assert.equal(slider.getAttribute("aria-valuenow"), "80");
  } finally { app.Bridge.mediaSeek = before; }
}));

test("runtime media/weather text and settings state stay safe and current", () => withDOM(() => {
  const circular = {}; circular.self = circular;
  State.media = { track: { title: "Track" }, artist: circular, albumArt: "", duration: 0, position: 0, playing: true };
  const dashboard = app.buildDashboardView();
  dashboard.sync();
  assert.ok(dashboard.el.textContent.includes('{"title":"Track"}'));
  assert.ok(!dashboard.el.textContent.includes("[object Object]"));
  const media = app.buildMediaView();
  media.sync();
  assert.ok(media.el.textContent.includes('{"title":"Track"}'));
  assert.ok(!media.el.textContent.includes("[object Object]"));
  State.weather = { condition: { label: "Sunny" }, temp: 20, humidity: { value: 40 }, wind: circular };
  const weather = app.buildWeatherView();
  weather.sync();
  assert.ok(weather.el.textContent.includes('{"label":"Sunny"}'));
  assert.ok(weather.el.textContent.includes('Humidity: {"value":40}%'));
  assert.ok(!weather.el.textContent.includes("[object Object]"));
  const settings = app.buildSettings({ toggleSound() { State.settings.soundEnabled = !State.settings.soundEnabled; } });
  settings.sync();
  const sound = find(settings.el, (el) => el.getAttribute?.("role") === "switch");
  assert.equal(sound.getAttribute("aria-label"), "Sound");
  sound.fire("click"); settings.sync();
  assert.equal(sound.getAttribute("aria-checked"), String(State.settings.soundEnabled));
  const text = app.h("div", { text: circular });
  assert.equal(text.textContent, "");
}));

test("header sound, settings-window switch and task deletion expose updated names/states", () => {
  assert.match(headerSource, /soundBtn\.setAttribute\("aria-label", State\.settings\.soundEnabled \? "Mute sounds" : "Unmute sounds"\)/);
  assert.match(headerSource, /soundBtn\.setAttribute\("aria-pressed", String\(!State\.settings\.soundEnabled\)\)/);
  assert.match(viewUiSource, /class: "task-del",\s*"aria-label": `Delete task: \$\{safeText\(text\)\}`/s);
  assert.match(settingsSource, /el\.setAttribute\("aria-checked", String\(next\)\)/);
  assert.match(settingsSource, /toggle\(settings\.soundEnabled, [^\n]*, "Sound"\)/);
  assert.match(styleSource, /\.send-btn \{[^}]*cursor: pointer;/s);
  assert.match(styleSource, /\.cc-slider:focus-visible/);
  assert.match(styleSource, /\.media-progress:focus-visible/);
});

test("system and integration toggles expose their current state", () => {
  assert.match(viewsSource, /initialOn \? " on" : ""/);
  assert.match(viewsSource, /"aria-pressed": String\(initialOn\)/);
  assert.match(viewsSource, /State\.systemControls\.nightLight/);
  assert.match(viewsSource, /State\.systemControls\.dnd/);
  assert.match(viewsSource, /btn\.setAttribute\("aria-pressed", String\(on\)\)/);
  assert.match(settingsSource, /"aria-label": def\.name/);
  assert.match(settingsSource, /"aria-pressed": String\(active\)/);
  assert.match(settingsSource, /sw\.setAttribute\("aria-pressed", String\(!on\)\)/);
});

test("long agent labels are bounded and the error view has no empty n8n action", () => {
  const whoStyles = styleSource.match(/\.who-row \.n \{[^}]*\}/s)?.[0] ?? "";
  assert.match(whoStyles, /min-width: 0;/);
  assert.match(whoStyles, /overflow: hidden;/);
  assert.match(whoStyles, /text-overflow: ellipsis;/);
  assert.match(whoStyles, /white-space: nowrap;/);
  assert.doesNotMatch(viewsSource, /btn\("Open in n8n"/);
  assert.doesNotMatch(viewsSource, /actions\.openUrl\(""\)/);
});

test("timer view selection owns mode changes instead of render sync", () => {
  assert.doesNotMatch(viewsSource, /if \(t\.mode === "stopwatch"\) State\.timerSetMode\("focus"\)/);
  assert.doesNotMatch(viewsSource, /if \(t\.mode !== "stopwatch"\) State\.timerSetMode\("stopwatch"\)/);
  State.timer.mode = "stopwatch";
  State.timer.running = true;
  State.timer.remaining = 12;
  let notifications = 0;
  const unsubscribe = State.subscribe(() => { notifications++; });
  try {
    State.setView("pomodoro");
    assert.equal(State.timer.mode, "focus");
    assert.equal(State.timer.running, false);
    assert.equal(notifications, 1);
  } finally {
    unsubscribe();
    State.timer.mode = "focus";
    State.timer.running = false;
    State.timer.remaining = 1500;
  }
});

test("unknown API status is not rendered as a known failure", () => {
  assert.match(viewsSource, /API unavailable/);
  assert.doesNotMatch(viewsSource, /apiBadge\.append\(dot\("#F4505E"/);
});

test("representative surfaces keep content beyond Pip with one layout-owned inset", () => {
  assert.equal(typeof PIP_SAFE_INSET, "number");
  for (const [view, layout] of Object.entries(VIEW_LAYOUTS)) {
    if (["upload", "uploading", "choose", "greeting"].includes(view)) continue;
    assert.ok(
      layout.botX + layout.botDiameter / 2 + 8 <= PIP_SAFE_INSET,
      `${view} content inset clears Pip`,
    );
  }
  assert.match(layoutSource, /PIP_SAFE_INSET/);
  assert.match(viewsSource, /--pip-safe-inset/);
  assert.match(styleSource, /\.session[^}]*padding-left: var\(--pip-safe-inset/s);
  assert.match(styleSource, /\.widget:active[^}]*background:/s);
});
