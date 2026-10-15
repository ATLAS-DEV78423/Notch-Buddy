import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createDOM } from "./navigation-dom.mjs";

// Compile real production modules in memory, including State and DOM helpers.
// Type-only imports keep unrelated page builders and Tauri out of this test.
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  const require = (name) => {
    assert.ok(name.startsWith("."), `unexpected runtime dependency: ${name}`);
    return load(resolve(dirname(file), `${name}.ts`));
  };
  new Function("require", "module", "exports", outputText)(require, module, module.exports);
  return module.exports;
}
const { window, document } = createDOM();
globalThis.window = window;
globalThis.document = document;
const source = (path) => load(fileURLToPath(new URL(`../src/${path}.ts`, import.meta.url)));
const { State } = source("core/state");
const { Sound } = source("core/sound");
const { buildHeader } = source("views/header");
const { NAV_ITEMS, navigationIsActive } = source("views/navigation");
const { ICONS } = source("views/icons");

assert.deepEqual(
  NAV_ITEMS.map(({ view }) => view),
  ["dashboard", "overview", "media", "controlCenter", "bluetooth", "stats", "pomodoro", "stopwatch", "weather"],
);
assert.equal(new Set(NAV_ITEMS.map(({ view }) => view)).size, NAV_ITEMS.length);
for (const current of NAV_ITEMS) {
  assert.deepEqual(NAV_ITEMS.filter((item) => navigationIsActive(item, current.view)), [current]);
  assert.ok(ICONS[current.icon], `${current.label} has a real icon`);
  assert.ok(current.label.trim(), `${current.view} has an accessible name`);
}
for (const view of ["prompt", "upload", "settings"]) {
  assert.equal(NAV_ITEMS.some((item) => navigationIsActive(item, view)), false);
}

const sounds = [];
Sound.play = (name) => { sounds.push(name); };
const geometryInputs = [];
State.mode = "expanded";
State.setView("overview");
const header = buildHeader({
  blip() { Sound.play("blip"); },
  setView(view) {
    // The island's setView action animates using the current expansion state.
    geometryInputs.push({ view, agentExpanded: State.agentExpanded });
    State.setView(view);
  },
  setAgentExpanded(expanded) { State.setAgentExpanded(expanded); Sound.play("blip"); },
  toggleSound() { State.settings.soundEnabled = !State.settings.soundEnabled; State.notify(); },
});
document.body.append(header.el);
State.subscribe(() => header.sync());
header.sync();
const all = (node) => [node, ...node.children.flatMap(all)];
const find = (name, root = header.el) => {
  const element = all(root).find((node) => node.getAttribute("aria-label") === name);
  assert.ok(element, `${name} exists`);
  return element;
};
const nav = all(header.el).find((node) => node.tagName === "DETAILS");
const summary = find("Navigate");
const grid = find("Pages");
const home = find("Home");
const agents = find("Agents");
const outside = document.createElement("button");
document.body.append(outside);
const click = (button) => { button.focus(); button.dispatch("click"); };

// Verify real rendered names, glyphs, route handlers and current-page attributes.
assert.equal(grid.children.length, 9);
for (const button of all(header.el).filter((node) => ["BUTTON", "SUMMARY"].includes(node.tagName))) {
  const label = button.getAttribute("aria-label");
  assert.ok(label);
  assert.equal(button.title, label);
  assert.equal(button.getAttribute("data-tooltip"), label);
  assert.equal(button.textContent, "", `${label} stays icon-only`);
  assert.equal(button.children[0].getAttribute("aria-hidden"), "true");
}
for (const [button, view] of [[home, "dashboard"], [agents, "overview"],
  ...NAV_ITEMS.map((item) => [find(item.label, grid), item.view])]) {
  State.setAgentExpanded(true);
  nav.open = true;
  const before = sounds.length;
  click(button);
  assert.equal(State.view, view);
  assert.equal(State.viewGroup, NAV_ITEMS.find((item) => item.view === view).group);
  assert.equal(nav.open, false);
  assert.deepEqual(sounds.slice(before), ["blip"], `${view} plays exactly one blip`);
  if (view === "dashboard" || view === "overview") {
    assert.equal(State.agentExpanded, false);
    assert.deepEqual(geometryInputs.at(-1), { view, agentExpanded: false });
  }
  for (const item of NAV_ITEMS) {
    const destination = find(item.label, grid);
    assert.equal(destination.classList.contains("active"), item.view === view);
    assert.equal(destination.getAttribute("aria-current"), item.view === view ? "page" : null);
  }
  assert.equal(home.getAttribute("aria-current"), view === "dashboard" ? "page" : null);
  assert.equal(agents.getAttribute("aria-current"), view === "overview" ? "page" : null);
}
for (const [label, view] of [["Ask", "prompt"], ["Drop", "upload"], ["Settings", "settings"]]) {
  click(find(label));
  assert.equal(State.view, view);
  assert.equal(find(label).getAttribute("aria-current"), "page");
  assert.equal(agents.getAttribute("aria-current"), null);
}
click(find("Mute sounds"));
assert.equal(find("Unmute sounds").getAttribute("aria-pressed"), "true");

// External State navigation (e.g. the dashboard shortcut) dismisses only when
// the view changes, and never steals focus from the new page or header controls.
nav.open = true;
const media = find("Media", grid);
media.focus();
State.setView(State.view);
State.notify();
assert.equal(nav.open, true, "same-view notifications leave navigation open");
assert.equal(document.activeElement, media);
State.setView("dashboard");
assert.equal(nav.open, false);
assert.equal(document.activeElement, summary, "hidden popover focus returns to summary");
for (const focus of [outside, home, summary]) {
  nav.open = true;
  focus.focus();
  State.setView(State.view === "dashboard" ? "overview" : "dashboard");
  assert.equal(nav.open, false);
  assert.equal(document.activeElement, focus, "view changes preserve focus outside the popover");
}

// A window bubbling listener represents the island's Escape/Tab shortcuts.
const bubbled = [];
window.addEventListener("keydown", (event) => { bubbled.push(event.key); });
nav.open = true;
media.focus();
const tab = media.dispatch("keydown", { key: "Tab" });
assert.equal(tab.defaultPrevented, false, "native Tab traversal remains available");
assert.equal(nav.open, true);
assert.deepEqual(bubbled, []);
const escape = media.dispatch("keydown", { key: "Escape" });
assert.equal(escape.defaultPrevented, true);
assert.equal(nav.open, false);
assert.equal(document.activeElement, summary);
assert.deepEqual(bubbled, [], "Escape never reaches the island while dismissing navigation");
summary.dispatch("keydown", { key: "Escape" });
summary.dispatch("keydown", { key: "Tab" });
assert.deepEqual(bubbled, ["Escape", "Tab"], "closed navigation leaves island shortcuts intact");

nav.open = true;
media.focus();
media.dispatch("pointerdown");
assert.equal(nav.open, true, "inside pointer events keep navigation open");
outside.dispatch("pointerdown");
assert.equal(nav.open, false);
assert.equal(document.activeElement, summary);
nav.open = true;
outside.focus();
outside.dispatch("pointerdown");
assert.equal(nav.open, false);
assert.equal(document.activeElement, outside);

console.log("icon navigation metadata and production header interactions: ok");
