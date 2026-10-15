import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const { chromium } = await import(process.env.UI_TEST_PLAYWRIGHT || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({ root, configFile: false, server: { port: 0, host: "127.0.0.1", watch: null }, optimizeDeps: { noDiscovery: true } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 320 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/src/main.ts", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `import '/src/style.css'; import '/src/app-materials.css';
      import { Island } from '/src/island/island.ts'; import { State } from '/src/core/state.ts';
      import { initMotionPreferences } from '/src/core/anim.ts'; initMotionPreferences();
      State.settings.soundEnabled = false; State.loadIntegrationTasks();
      State.shelf.add({ name: 'photo.png', path: '/inbox/photo.png', size: 12 }, 1);
      State.shelf.add({ name: 'report.pdf', path: '/inbox/report.pdf', size: 24 }, 2);
      window.testState = State; window.testIsland = new Island(document.querySelector('#root'));
      window.testIsland.fsm.forceHome(); window.testIsland.fsm.pinned = true;`,
  }));
  await page.goto(server.resolvedUrls.local[0], { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".overview.on");
  await page.getByRole("button", { name: "Drop", exact: true }).click();
  await page.waitForSelector(".drop-card");
  await page.getByRole("button", { name: "View shelf", exact: true }).click();
  await page.waitForSelector(".shelf-card");
  assert.equal(await page.locator(".shelf-row").count(), 2);
  await page.getByRole("button", { name: /photo\.png, image/ }).click();
  await page.evaluate(() => {
    window.testState.chatHistory = [{ id: 1, role: "user", content: "previous conversation" }];
    if (!window.testState.attachSelectedShelfItem()) throw new Error("shelf attachment failed");
    if (window.testState.chatHistory.length !== 1) throw new Error("shelf attachment cleared chat history");
  });
  await page.getByRole("button", { name: "Ask Pip", exact: true }).click();
  await page.waitForSelector(".chat-card");
  assert.equal(await page.locator(".chat-card .chip").innerText(), "photo.png");
  await page.locator("#header .tab[aria-label='Agents']").click();
  await page.getByRole("button", { name: "Drop", exact: true }).click();
  await page.getByRole("button", { name: "View shelf", exact: true }).click();
  await page.getByRole("button", { name: "Remove photo.png" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".shelf-row").length === 1);
  assert.equal(await page.locator(".shelf-row").count(), 1);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".shelf-row").length === 0);
  assert.equal(await page.locator(".shelf-row").count(), 0);
  assert.deepEqual(errors, []);
  console.log("file shelf UI: ok");
} finally {
  await browser.close();
  await server.close();
}
