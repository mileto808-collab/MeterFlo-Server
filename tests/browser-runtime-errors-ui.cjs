// Owned-data browser checks capture ErrorEvents, including events with no Error object.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

(async () => {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")() });
  try {
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    await context.addInitScript(() => {
      window.__browserErrorEvents = [];
      window.addEventListener("error", event => {
        window.__browserErrorEvents.push({ message: event.message, hasError: event.error instanceof Error });
      }, true);
    });
    const page = await context.newPage();
    const observed = [];
    for (const section of ["profile", "access-levels"]) {
      await page.goto(`/settings?section=${section}`);
      await expect(page.getByTestId("settings-workspace")).toBeVisible();
      for (let index = 0; index < 16; index++) {
        await page.setViewportSize(index % 2 ? { width: 1280, height: 720 } : { width: 390, height: 844 });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      observed.push(...await page.evaluate(() => window.__browserErrorEvents));
    }
    assert.deepEqual(observed, [], "Settings resizing must not produce browser ErrorEvents");
    console.log("PASS: Settings profile and access levels resize between desktop and phone without browser ErrorEvents.");
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
