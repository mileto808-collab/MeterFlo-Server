// Run only with the disposable inventory-ui-fixture.ts project.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport: { width: 1280, height: 900 }, hasTouch: true,
    });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const base = `/api/projects/${fixture.projectId}/inventory`;
    const command = async (action, data) => {
      const response = await context.request.post(`${base}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
      assert.equal(response.status(), 200, await response.text());
    };
    await command("warehouse", { id: "tools-main", code: "TOOLS", name: "Count tools fixture", type: "physical", address: "Fixture" });
    await command("vendor", { id: "tools-vendor", name: "Count tools vendor" });
    const lines = [];
    for (let n = 0; n < 18; n++) {
      const id = `tools-${n}`;
      await command("item", { id, sku: `TOOLS-${String(n + 1).padStart(2, "0")}`, name: `Count item ${String(n + 1).padStart(2, "0")}`, tracking: "regular" });
      lines.push({ itemId: id, quantity: 5 });
    }
    await command("item", { id: "tools-extra", sku: "TOOLS-EXTRA", name: "Discovery extra", tracking: "regular" });
    await command("order", { id: "tools-po", type: "purchase", vendorId: "tools-vendor", destinationId: "tools-main", lines });
    await command("release", { orderId: "tools-po" });
    await command("receive", { orderId: "tools-po", lines });
    await command("countStart", { id: "tools-count", warehouseId: "tools-main" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Cycle counts", exact: true }).click();
    await page.getByRole("button", { name: "Continue count", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /^Continue count/ });
    const show = () => dialog.getByRole("button", { name: "Show Search & Tools", exact: true });
    const hide = () => dialog.getByRole("button", { name: "Hide Search & Tools", exact: true });
    await expect(show()).toHaveAttribute("aria-expanded", "false");
    await expect(dialog.locator("#count-product-scanner-input")).toHaveCount(0);
    await expect(dialog.locator("#count-tools-0")).toBeVisible();
    await dialog.locator("#count-tools-0").fill("4");
    await show().click();
    await dialog.locator("#count-product-scanner-input").fill("Discovery extra");
    await dialog.locator("#count-discovery-product").click();
    await page.getByRole("option", { name: "TOOLS-EXTRA · Discovery extra", exact: true }).click();
    await hide().click();
    await expect(dialog.getByText(/Entry filter active:/)).toBeVisible();
    await show().click();
    await expect(dialog.locator("#count-product-scanner-input")).toHaveValue("Discovery extra");
    await expect(dialog.locator("#count-discovery-product")).toContainText("Discovery extra");
    await dialog.getByRole("button", { name: "Add discovery to count", exact: true }).click();
    await expect(dialog.locator("#count-tools-extra")).toHaveValue("");
    await expect(dialog.locator("#expected-count-tools-extra")).toHaveText("0");
    await expect(dialog.locator("#count-tools-0")).toHaveValue("4");
    await hide().click();
    const output = "generated-artifacts/inventory-count-tools";
    await fs.mkdir(output, { recursive: true });
    for (const [name, viewport] of [
      ["desktop", { width: 1280, height: 900 }],
      ["phone", { width: 402, height: 874 }],
      ["landscape", { width: 874, height: 402 }],
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      const scroller = dialog.locator(".overflow-y-auto").first();
      await scroller.evaluate(element => { element.scrollTop = 0; });
      const before = await show().boundingBox();
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.waitForTimeout(100);
      const after = await show().boundingBox();
      if (!before || !after || Math.abs(before.y - after.y) >= 2)
        await page.screenshot({ path: `${output}/failure-${name}.png` });
      assert.ok(before && after && Math.abs(before.y - after.y) < 2, `${name}: collapsed toggle stays sticky ${JSON.stringify({ before, after })}`);
      assert.ok(!await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), `${name}: no modal overflow`);
      await scroller.evaluate(element => { element.scrollTop = 0; });
      await page.screenshot({ path: `${output}/${name}.png` });
      await show().click();
      const expandedBefore = await hide().boundingBox();
      await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await page.waitForTimeout(100);
      const expandedAfter = await hide().boundingBox();
      assert.ok(expandedBefore && expandedAfter && Math.abs(expandedBefore.y - expandedAfter.y) < 2, `${name}: expanded header stays sticky`);
      await expect(dialog.locator("#count-tools-0")).toHaveValue("4");
      await hide().click();
    }
    assert.deepEqual(errors, []);
    console.log("PASS: collapsed by default; sticky collapsed/expanded header; discovery/filter/edit state retained; desktop/phone/landscape fit.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
