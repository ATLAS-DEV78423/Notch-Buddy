// Run with a dev-only Playwright installation; no app dependency is required.
// UI_TEST_PLAYWRIGHT may point to an external playwright package entry point.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const { chromium } = await import(process.env.UI_TEST_PLAYWRIGHT || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const screenshots = process.env.UI_TEST_SCREENSHOTS;
const motion = process.env.UI_TEST_MOTION || "reduce";
if (screenshots) await mkdir(screenshots, { recursive: true });
const server = await createServer({ root, configFile: false, server: { port: 0, host: "127.0.0.1", watch: null }, optimizeDeps: { noDiscovery: true } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const defects = [];
try {
  for (const scale of [1, 1.5]) {
    const page = await browser.newPage({ viewport: { width: 720, height: 320 }, deviceScaleFactor: scale, reducedMotion: motion });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // Test the real Island and its controls without native services or live sessions.
    await page.route("**/src/main.ts", (route) => route.fulfill({
      contentType: "application/javascript",
      body: `import '/src/style.css'; import '/src/app-materials.css';
        import { Island } from '/src/island/island.ts';
        import { State } from '/src/core/state.ts';
        import { initMotionPreferences } from '/src/core/anim.ts';
        initMotionPreferences();
        State.settings.soundEnabled = false; State.loadIntegrationTasks();
        State.tasks.find(({ id }) => id === 'agent_opencode').name = 'OpenCode — a very long workspace name';
        window.testState = State; window.testIsland = new Island(document.querySelector('#root'));
        window.testIsland.fsm.forceHome(); window.testIsland.fsm.pinned = true;`,
    }));
    await page.goto(server.resolvedUrls.local[0], { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForSelector(".overview.on");
    await page.evaluate(() => {
      const state = window.testState;
      const task = state.tasks.find(({ id }) => id === "agent_opencode");
      task.name = "OpenCode — a very long workspace name";
      task.model = "reported-model-with-a-long-identifier";
      task.thinking = "high";
      task.state = "working";
      state.appendStep(task.id, { label: "Read · invoice.ts", tool: "Read", input: { file_path: "src/invoice.ts", output: "export const TVA = 0.196;" } });
      state.appendStep(task.id, { label: "Edit · invoice.ts", tool: "Edit", input: {
        file_path: "src/long-project-path/invoice.ts",
        old_string: "const TVA = 0.196;",
        new_string: "const TVA = 0.20; // " + "long source content ".repeat(40) + "\n" + "const total = 1;\n".repeat(50),
      } });
      state.appendStep(task.id, { label: "Bash · npm test", tool: "Bash", input: {
        command: "npm test -- " + "long-argument/".repeat(45), output: "PASS invoice.test.ts\n".repeat(80),
      } });
    });
    const expand = page.getByRole("button", { name: "Expand OpenCode — a very long workspace name agent session", exact: true });
    await expand.click();
    await page.waitForSelector(".overview.agent-detail");
    assert.equal(await page.evaluate(() => window.testState.focusId), "agent_opencode");
    await page.locator(".agent-detail .step-chip").nth(1).click();
    await page.waitForSelector(".agent-detail .diff-body");

    async function layout(label, expanded = true) {
      await page.waitForFunction((height) => Math.abs(document.querySelector("#island").getBoundingClientRect().height - height) < 0.1, expanded ? 300 : 160);
      const issues = await page.evaluate((expanded) => {
        const view = document.querySelector(".overview.on");
        const visible = (el) => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
        const rect = (el) => el.getBoundingClientRect();
        const overlaps = (a, b) => visible(a) && visible(b) && rect(a).left < rect(b).right - 1 && rect(a).right > rect(b).left + 1 && rect(a).top < rect(b).bottom - 1 && rect(a).bottom > rect(b).top + 1;
        const issues = [];
        const head = view.querySelector(".session-head");
        const children = [...head.children].filter(visible);
        for (let i = 0; i < children.length; i++) for (let j = i + 1; j < children.length; j++) {
          if (overlaps(children[i], children[j])) issues.push(`heading overlap: ${children[i].className}/${children[j].className}`);
        }
        const rail = view.querySelector(".step-rail");
        const viewer = view.querySelector(".step-view");
        const approval = view.querySelector(".approval-inline");
        const back = view.querySelector(".agent-collapse");
        const switcher = view.querySelector(":scope > .right");
        const jump = view.querySelector(".jump");
        for (const [a, b, name] of [[head, rail, "heading/steps"], [approval, viewer, "approval/viewer"], [back, viewer, "back/viewer"], [jump, viewer, "jump/viewer"], [switcher, viewer, "switcher/viewer"], [back, switcher, "back/switcher"], [back, jump, "back/jump"]]) {
          if (overlaps(a, b)) issues.push(name + " overlap");
        }
        for (const pill of view.querySelectorAll(".agent-pill")) {
          if (overlaps(pill.querySelector(".mini"), pill.querySelector(".lbl"))) issues.push("pill avatar/label overlap");
        }
        if (visible(approval) && approval.querySelector(".cmd-line").textContent === "npm test") {
          for (const button of approval.querySelectorAll(".btn")) {
            if (rect(button).bottom > rect(approval).bottom - 1 || rect(button).top < rect(approval).top) issues.push("approval button clipped");
          }
        }
        const shell = rect(document.querySelector("#island"));
        for (const el of [head, rail, viewer, approval, back, switcher]) if (visible(el)) {
          const r = rect(el);
          if (r.left < shell.left - 1 || r.right > shell.right + 1 || r.top < shell.top - 1 || r.bottom > shell.bottom + 1) issues.push("outside island: " + el.className);
        }
        if (expanded && rect(head).top < shell.top + 116) issues.push("identity intrudes on character space");
        if (expanded && visible(viewer) && rect(viewer).height < 25) issues.push("work viewer collapsed");
        return issues;
      }, expanded);
      defects.push(...issues.map((issue) => `${scale}x ${motion} ${label}: ${issue}`));
      if (screenshots) await page.screenshot({ path: resolve(screenshots, `${scale}x-${motion}-${label}.png`) });
    }
    await layout("diff");
    assert(await page.locator(".diff-body").evaluate((el) => el.scrollWidth > el.clientWidth), "long source must be horizontally scrollable");
    await page.getByRole("button", { name: "Back to agents", exact: true }).click();
    await page.waitForSelector(".overview.agent-carousel");
    assert.equal(await page.evaluate(() => window.testState.focusId), "agent_opencode");
    await layout("carousel", false);
    await page.getByRole("button", { name: "Expand agent session", exact: true }).click();
    await page.waitForSelector(".overview.agent-detail");
    assert.equal(await page.locator(".step-chip.on").getAttribute("title"), "Edit · invoice.ts");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => window.testState.agentExpanded), true, "Tab must navigate, not close detail");
    await page.locator(".step-chip").nth(2).click();
    await layout("command");
    await page.evaluate(() => {
      const state = window.testState;
      state.pendingApproval = { requestId: "test-opencode", sessionId: "test", taskId: "agent_opencode", tool: "Bash", command: "npm test -- " + "long/path/".repeat(30) };
      state.notify();
    });
    await page.waitForSelector(".agent-detail .approval-inline", { state: "visible" });
    assert.equal(await page.locator(".agent-detail .approval-inline .btn").count(), 0, "OpenCode cannot receive approvals");
    await layout("display-only-approval");
    await page.getByRole("button", { name: "Expand VS Code agent session", exact: true }).click();
    await page.evaluate(() => {
      const state = window.testState;
      state.pendingApproval = { requestId: "test-claude", sessionId: "test", taskId: "integration_claude", tool: "Bash", command: "npm test" };
      state.notify();
    });
    await page.waitForSelector(".agent-detail .approval-inline .btn");
    assert.equal(await page.locator(".agent-detail .approval-inline .btn").count(), 2);
    await layout("approval");
    await page.getByRole("button", { name: "Back to agents", exact: true }).click();
    await page.waitForSelector(".overview.agent-carousel");
    await layout("compact-approval", false);
    await page.evaluate(() => { window.testState.pendingApproval = null; window.testState.notify(); });
    await page.getByRole("button", { name: "Expand agent session", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.waitForSelector(".overview.agent-carousel");
    assert.equal(await page.evaluate(() => window.testState.agentExpanded), false);
    await page.getByRole("button", { name: "Expand Hermes agent session", exact: true }).click();
    await page.waitForSelector(".overview.agent-detail");
    assert.match(await page.locator(".step-view").innerText(), /Waiting for the first step/);
    await layout("empty");
    await page.getByRole("button", { name: "Back to agents", exact: true }).click();
    // There is no Stripe task by default: add the real integration, then test its click path.
    await page.evaluate(() => {
      const state = window.testState;
      state.settings.activeIntegrations = ["integration_stripe"];
      state.loadIntegrationTasks(); state.setFocus("integration_stripe");
    });
    await page.locator(".overview .left .card").click({ position: { x: 200, y: 70 } });
    assert.equal(await page.evaluate(() => window.testState.agentExpanded), false, "integration cards must not open agent detail");
    assert.deepEqual(errors, [], "no frontend runtime errors");
    await page.close();
    console.log(`agent detail controls and layout at ${scale}x (${motion}): checked`);
  }
  assert.deepEqual(defects, [], "agent detail layout defects");
  console.log("agent detail regression checks: passed");
} finally {
  await browser.close();
  await server.close();
}
