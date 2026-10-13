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
const chatSource = readFileSync(resolve(root, "src/views/chat.ts"), "utf8");
const integrationsSource = readFileSync(resolve(root, "src/views/integrations.ts"), "utf8");
const result = await build({
  stdin: { contents: `
    export { State } from "./src/core/state";
    export { BotEngine } from "./src/mochi/engine";
    export { startPowerWatch } from "./src/mochi/power";
    export { setPrimaryEngine, setCondition, react, tickReactions } from "./src/mochi/reactions";
    export { batteryTier } from "./src/ui/batteryicon";
    export { setPrefersReduced } from "./src/core/anim";
    export { captureStep, stepKind, diffForStep, diffLines, diffStat, modelFromPayload, thinkingFromPayload } from "./src/core/steps";
  `, resolveDir: root },
  bundle: true, platform: "node", format: "esm", write: false,
});
const app = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const { State, BotEngine, startPowerWatch, setPrimaryEngine, setCondition, react, tickReactions, batteryTier, setPrefersReduced, captureStep, stepKind, diffForStep, diffLines, diffStat, modelFromPayload, thinkingFromPayload } = app;

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
  const { engine, stop } = setup();
  // The engine's tweens and busy deadline ride performance.now(), so drive the
  // hold on a fake 60 fps clock instead of waiting real seconds out.
  const realNow = performance.now;
  let clock = realNow.call(performance);
  performance.now = () => clock;
  const frame = () => { clock += 1000 / 60; engine.update(1 / 60); };
  try {
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
    assert.equal(engine.busy, false);
    assert.equal(engine.eyeOverride, null);
  } finally {
    performance.now = realNow;
    State.stateOverride = null;
    engine.onDizzy = null;
    stop();
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
  assert.match(viewsSource, /class: "tab",\s*"aria-label": "Overview"/s);
  assert.match(viewsSource, /class: "tab",\s*"aria-label": "Ask"/s);
  assert.match(viewsSource, /class: "tab",\s*"aria-label": "Drop"/s);
  assert.match(viewsSource, /class: "icon-btn jump",\s*"aria-label": "Open"/s);
  assert.match(viewsSource, /class: "mc-btn",\s*"aria-label": "Previous"/s);
  assert.match(viewsSource, /class: "mc-btn mc-play",\s*"aria-label": "Play"/s);
  assert.match(viewsSource, /class: "mc-btn",\s*"aria-label": "Next"/s);
  assert.match(chatSource, /class: "send-btn"[^}]*"aria-label": "Send"/s);
  assert.match(integrationsSource, /class: "int-more",\s*"aria-label": "Details"/s);
});

test("DOM text and attributes never fall back to object coercion", () => {
  assert.match(domSource, /function safeText\(value: unknown\)/);
  assert.match(domSource, /JSON\.stringify\(value\)/);
  assert.match(domSource, /textContent = safeText\(v\)/);
});
