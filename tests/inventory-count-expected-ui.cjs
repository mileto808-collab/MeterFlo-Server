// Disposable inventory-ui-fixture.ts project only; never uses customer inventory.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport: { width: 1280, height: 900 }, hasTouch: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const base = `/api/projects/${fixture.projectId}/inventory`;
    const command = async (action, data) => {
      const r = await context.request.post(`${base}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
      assert.equal(r.status(), 200, await r.text());
    };
    await command("warehouse", { id: "expected-main", code: "EXPECTED", name: "Expected quantity warehouse", type: "physical", address: "Fixture warehouse" });
    await command("vendor", { id: "expected-vendor", name: "Expected quantity vendor" });
    for (const id of ["bulk", "discovery", "empty"])
      await command("item", { id, sku: id.toUpperCase(), name: `Expected ${id}`, tracking: "regular" });
    let po = 0;
    const receive = async lines => {
      const id = `expected-po-${++po}`;
      await command("order", { id, type: "purchase", vendorId: "expected-vendor", destinationId: "expected-main", lines });
      await command("release", { orderId: id });
      await command("receive", { orderId: id, lines });
    };
    await receive([{ itemId: "bulk", quantity: 5 }]);
    await command("countStart", { id: "expected-count", warehouseId: "expected-main" });
    await command("countSaveDraft", { id: "expected-count", revision: 0, reason: "Verify expected quantity", rows: [
      { itemId: "bulk", quantity: "4", serials: "" }, { itemId: "discovery", quantity: "3", serials: "" }, { itemId: "empty", quantity: "0", serials: "" },
    ] });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Cycle counts", exact: true }).click();
    await page.getByRole("button", { name: "Continue count", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: /^Continue count/ });
    const expected = id => dialog.locator(`#expected-count-${id}`);
    await expect(expected("bulk")).toHaveText("5");
    await expect(expected("discovery")).toHaveText("0");
    await expect(expected("empty")).toHaveText("0");
    await expect(dialog.getByTestId("inventory-count-stock-drift")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Post count", exact: true })).toBeEnabled();
    await dialog.locator("#count-bulk").fill("2");
    await receive([{ itemId: "bulk", quantity: 2 }, { itemId: "discovery", quantity: 6 }]);
    await expect(expected("bulk")).toHaveText("7", { timeout: 15000 });
    await expect(expected("discovery")).toHaveText("6");
    await expect(expected("empty")).toHaveText("0");
    await expect(dialog.locator("#count-bulk")).toHaveValue("2");
    await expect(dialog.locator("#count-discovery")).toHaveValue("3");
    await expect(dialog.getByTestId("inventory-count-stock-drift")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Post count", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Save count draft", exact: true })).toBeEnabled();
    const output = await expected("bulk").evaluate(element => ({
      tag: element.tagName, border: getComputedStyle(element).borderTopWidth, background: getComputedStyle(element).backgroundColor,
    }));
    assert.deepEqual(output, { tag: "OUTPUT", border: "0px", background: "rgba(0, 0, 0, 0)" });
    await expect(expected("bulk")).toHaveAccessibleName("Expected quantity");
    const directory = "generated-artifacts/inventory-count-expected";
    await fs.mkdir(directory, { recursive: true });
    for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 402, height: 874 }]]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      await expected("bulk").scrollIntoViewIfNeeded();
      const widths = await dialog.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
      assert.ok(widths.content <= widths.width + 1, `${name}: modal must not overflow horizontally`);
      await page.screenshot({ path: `${directory}/${name}.png` });
    }
    assert.deepEqual(errors, []);
    console.log("PASS: plain live expected quantities, zero discovery, SSE refresh preserves actuals, stale posting blocked, desktop/phone layout.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
