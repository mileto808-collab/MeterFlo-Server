// Uses only the disposable project created by inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
    args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
      viewport: { width: 1440, height: 900 }, hasTouch: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const base = `/api/projects/${fixture.projectId}/inventory`;
    const command = async (action, data) => {
      const response = await context.request.post(`${base}/commands`, {
        data: { action, data, operationId: crypto.randomUUID() },
      });
      assert.equal(response.status(), 200, await response.text());
    };
    await command("warehouse", { id: "density", code: "DENSITY", name: "Density test location",
      type: "physical", address: "Disposable fixture" });
    await command("vendor", { id: "density-vendor", name: "Density vendor" });
    const lines = [];
    for (let i = 0; i < 18; i++) {
      const serialized = i === 3 || i === 7 || i === 13;
      const id = `density-${String(i).padStart(2, "0")}`;
      await command("item", { id, sku: id, name: `Item ${String(i).padStart(2, "0")}${serialized
        ? " with a longer serialized description for mixed height records" : ""}`,
        tracking: serialized ? "serialized" : "regular" });
      lines.push({ itemId: id, quantity: 1, serials: serialized ? [`SERIAL-${i}`] : [] });
    }
    await command("order", { id: "density-order", type: "purchase", vendorId: "density-vendor",
      destinationId: "density", lines });
    await command("release", { orderId: "density-order" });
    await command("receive", { orderId: "density-order", lines });
    const page = await context.newPage(), errors = [], requests = [], pending = new Set();
    page.on("pageerror", error => errors.push(error.message));
    const isStock = request => new URL(request.url()).pathname === `${base}/stock`;
    page.on("request", request => {
      if (!isStock(request)) return;
      requests.push(request.url()); pending.add(request);
    });
    page.on("requestfinished", request => pending.delete(request));
    page.on("requestfailed", request => pending.delete(request));
    // Make loading transitions observable without changing response data or layout.
    await page.route(new RegExp(`${base}/stock\\?`), async route => {
      await new Promise(resolve => setTimeout(resolve, 80));
      await route.continue();
    });
    await page.goto(`/projects/${fixture.projectId}/inventory`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const results = page.getByTestId("inventory-stock-results");
    const rows = results.locator("[data-stock-row]");
    const pager = page.getByTestId("inventory-stock-pagination");
    const capacity = async () => Number(await results.getAttribute("data-page-size"));
    const settle = async () => {
      await expect(rows.first()).toBeVisible({ timeout: 30000 });
      await expect.poll(async () => pending.size === 0 &&
        await rows.count() === await capacity(), { timeout: 30000 }).toBe(true);
      // A repeated measurement/refetch loop can look blurred while never reaching a stable page.
      await page.waitForTimeout(500);
      const count = requests.length, size = await capacity();
      await page.waitForTimeout(800);
      assert.equal(requests.length, count, "idle list must stop requesting new page sizes");
      assert.equal(await capacity(), size, "idle capacity must stop oscillating");
    };
    const metrics = () => results.evaluate(container => {
      const records = [...container.querySelectorAll("[data-stock-row]")];
      const bounds = container.getBoundingClientRect(), last = records.at(-1)?.getBoundingClientRect();
      const style = getComputedStyle(container);
      return { height: bounds.height, top: bounds.top, bottom: bounds.bottom,
        free: last ? bounds.bottom - last.bottom : 0,
        heights: records.map(row => row.getBoundingClientRect().height),
        padding: parseFloat(style.paddingBottom),
        keys: records.map(row => row.getAttribute("data-stock-key")),
        filters: records.map(row => getComputedStyle(row).filter), scrollTop: container.scrollTop };
    });
    await settle();
    const originalCapacity = await capacity(), original = await metrics();
    assert.ok(originalCapacity > 1 && originalCapacity <= 100);
    assert.ok(original.free >= original.padding - 1, "initial records fit fully");
    assert.ok(original.free < original.heights[0] + 8 + original.padding,
      "unused first-page space cannot fit another complete short record");
    assert.ok(original.filters.every(value => value === "none"), "records do not have a blur filter");
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "Next stock page" }).click();
      await expect(pager).toContainText("Page 2");
      await settle();
      assert.equal(await capacity(), originalCapacity, "taller later-page rows cannot change server page boundaries");
      await results.evaluate(element => { element.scrollTop = 50; });
      await page.getByRole("button", { name: "Previous stock page" }).click();
      await expect(pager).toContainText("Page 1");
      await settle();
      assert.equal(await capacity(), originalCapacity);
      const returned = await metrics();
      assert.deepEqual(returned.keys, original.keys, "Previous restores the exact first page");
      assert.equal(returned.scrollTop, 0);
    }
    await fs.mkdir("generated-artifacts/stock-paging", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/stock-paging/desktop.png" });
    await page.getByRole("button", { name: "Next stock page" }).click();
    await expect(pager).toContainText("Page 2");
    await page.setViewportSize({ width: 1440, height: 1100 });
    await expect.poll(capacity).toBeGreaterThan(originalCapacity);
    await settle();
    await expect(pager).toContainText("Page 1");
    const expandedCapacity = await capacity();
    await page.getByRole("button", { name: "Show inventory stats", exact: true }).click();
    await expect.poll(capacity).toBeLessThan(expandedCapacity);
    await settle();
    await page.getByRole("button", { name: "Hide inventory stats", exact: true }).click();
    await expect.poll(capacity).toBe(expandedCapacity);
    await settle();
    await page.setViewportSize({ width: 390, height: 844 });
    await settle();
    const toggle = page.getByTestId("inventory-mobile-tools-stock-toggle");
    if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
    await settle();
    const compactCapacity = await capacity();
    assert.ok(compactCapacity > 1, "collapsed phone tools leave space for multiple records");
    await page.screenshot({ path: "generated-artifacts/stock-paging/phone.png" });
    await toggle.click();
    await expect.poll(capacity).toBeLessThan(compactCapacity);
    await settle();
    await toggle.click();
    await expect.poll(capacity).toBe(compactCapacity);
    await settle();
    await page.setViewportSize({ width: 844, height: 390 });
    await settle();
    const landscape = await metrics();
    const pagerBounds = await pager.boundingBox();
    assert.ok(landscape.height > 60, "landscape retains usable results space");
    assert.ok(pagerBounds.y + pagerBounds.height <= 391, "landscape pager stays visible");
    await page.screenshot({ path: "generated-artifacts/stock-paging/landscape.png" });
    for (const url of requests) assert.ok(Number(new URL(url).searchParams.get("limit")) <= 100);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, initialCapacity: originalCapacity, expandedCapacity,
      phoneCapacity: compactCapacity, landscapeCapacity: await capacity(), requests: requests.length }));
    await context.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
