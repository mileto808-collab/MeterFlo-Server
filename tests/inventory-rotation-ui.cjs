// Run with the disposable inventory-ui-fixture --operations, never customer data.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport: { width: 393, height: 850 }, isMobile: true, hasTouch: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const command = async (action, data) => {
      const response = await context.request.post(`${endpoint}/commands`, { data: { action, data, operationId: crypto.randomUUID() } });
      assert.equal(response.status(), 200, await response.text());
    };
    const seeded = (await (await context.request.get(endpoint)).json()).state.stock.length > 0;
    for (let n = 0; !seeded && n < 6; n++) {
      const orderId = crypto.randomUUID();
      await command("order", { id: orderId, type: "purchase", vendorId: "ops-vendor", destinationId: `ops-location-${n}`,
        lines: [{ itemId: "ops-meter", quantity: 2 }, { itemId: "ops-bulk", quantity: 2 }] });
      await command("release", { orderId });
      await command("receive", { orderId, lines: [{ itemId: "ops-meter", quantity: 2, serials: [`ROT-${n}-01`, `ROT-${n}-02`] }, { itemId: "ops-bulk", quantity: 2 }] });
    }
    const before = (await (await context.request.get(endpoint)).json()).state;
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await fs.mkdir("generated-artifacts/inventory-rotation", { recursive: true });
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    for (const kind of ["stock", "locations", "items", "vendors", "orders", "exceptions", "counts", "returns", "activity"]) {
      await page.setViewportSize({ width: 393, height: 850 });
      await page.getByTestId("inventory-mobile-menu").click();
      await page.getByTestId(`inventory-mobile-menu-item-${kind}`).click();
      const toggle = page.getByTestId(`inventory-mobile-tools-${kind}-toggle`);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      const results = page.getByTestId(kind === "orders" ? "inventory-order-results" : `inventory-${kind}-results`);
      const pager = page.getByTestId(`inventory-${kind}-pagination`);
      if (kind !== "counts") {
        await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(0);
        const capacity = Number(await results.getAttribute("data-page-size"));
        await toggle.click();
        await expect.poll(async () => (await results.boundingBox()).height).toBeGreaterThan(50);
        const expandedCapacity = Number(await results.getAttribute("data-page-size"));
        await toggle.click();
        await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThanOrEqual(capacity);
        if (["stock", "locations", "activity"].includes(kind)) {
          assert.ok(capacity > expandedCapacity, `${kind}: hiding tools adds records`);
        }
        await page.getByTestId("button-toggle-inventory-stats").click();
        await expect(page.getByTestId("inventory-stats-region")).toBeVisible();
        const smallHeight = (await results.boundingBox()).height;
        await page.getByTestId("button-toggle-inventory-stats").click();
        await expect.poll(async () => (await results.boundingBox()).height).toBeGreaterThan(smallHeight);
        await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThanOrEqual(capacity);
      }
      for (const size of [{ width: 844, height: 390 }, { width: 915, height: 412 }, { width: 740, height: 360 }]) {
        await page.setViewportSize(size);
        await expect(page.getByTestId("inventory-mobile-menu")).toBeVisible();
        await expect.poll(async () => (await page.getByTestId("inventory-mobile-menu").boundingBox()).y).toBeGreaterThanOrEqual(0);
        assert.equal(await page.getByRole("tab").count(), 0, `${kind}: no desktop tabs on rotated phone`);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        if (kind !== "counts") {
          await expect.poll(async () => (await results.boundingBox()).height).toBeGreaterThanOrEqual(55);
          await expect.poll(async () => { const r = await pager.boundingBox(); return r.y + r.height; }).toBeLessThanOrEqual(size.height);
          // Rotation must not preserve a scroll offset that leaves only a card's bottom visible.
          assert.equal(await results.evaluate(el => el.scrollTop), 0);
        }
        await page.getByTestId("inventory-mobile-menu").click();
        await expect(page.getByTestId("inventory-mobile-menu-item-activity")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toBeHidden();
      }
      await page.screenshot({ path: `generated-artifacts/inventory-rotation/${kind}-landscape.jpg` });
      await toggle.click();
      await expect(page.getByTestId(`inventory-mobile-tools-${kind}`)).toBeVisible();
      await toggle.click();
      await page.setViewportSize({ width: 393, height: 850 });
      if (kind !== "counts") {
        await expect.poll(async () => (await results.boundingBox()).height).toBeGreaterThan(400);
        await page.screenshot({ path: `generated-artifacts/inventory-rotation/${kind}-portrait.jpg` });
      }
      console.log(`PASS ${kind}: rotation, navigation and collapsed-space capacity`);
    }
    assert.deepEqual((await (await context.request.get(endpoint)).json()).state, before);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
