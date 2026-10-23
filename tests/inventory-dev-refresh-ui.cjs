const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const fs = require("node:fs/promises");

(async () => {
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL });
    const login = await context.request.post("/api/auth/local/login", { data: fixture });
    assert.ok(login.ok(), "Owned fixture must sign in through normal authentication");
    const errors = [];
    context.on("page", page => page.on("pageerror", error => errors.push(error.message)));
    const pages = [];
    // Multiple tabs exercise the persistent live streams used by warehouse workers.
    for (let n = 0; n < 3; n++) {
      if (pages.length) {
        // Headless Chromium keeps all pages "visible"; model a real tab switch.
        await pages[pages.length - 1].evaluate(() => {
          Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
          document.dispatchEvent(new Event("visibilitychange"));
        });
      }
      const page = await context.newPage();
      await page.goto(`/projects/${fixture.projectId}/inventory`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Start Inventory", exact: true }).waitFor({ timeout: 60000 });
      pages.push(page);
      console.log(`Signed-in Inventory tab ${n + 1} opened`);
    }
    const page = pages[0];
    await page.bringToFront();
    await pages[pages.length - 1].evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    for (let n = 0; n < 3; n++) {
      const start = Date.now();
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      await page.getByRole("button", { name: "Start Inventory", exact: true }).waitFor({ timeout: 30000 });
      console.log(`Signed-in Inventory refresh ${n + 1}: ${Date.now() - start} ms`);
    }
    await page.getByRole("button", { name: "Start Inventory", exact: true }).click();
    await page.getByText("Choose an inventory task", { exact: true }).waitFor({ timeout: 15000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Choose an inventory task", { exact: true }).waitFor({ timeout: 30000 });
    await fs.mkdir("generated-artifacts/dev-refresh", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/dev-refresh/signed-in-task-page.jpg" });
    assert.deepEqual(errors, [], "Refreshes must not produce uncaught browser exceptions");
    console.log("Signed-in repeated refresh and Start Inventory restoration passed.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
