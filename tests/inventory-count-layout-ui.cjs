// Only run against the owned tests/support/inventory-ui-fixture.ts fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const out = "generated-artifacts/inventory-counts";
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
      viewport: { width: 1440, height: 1000 }, hasTouch: true, isMobile: true,
    });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const snapshot = async () => (await (await context.request.get(endpoint)).json()).state;
    const command = async (action, data) => {
      const res = await context.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
      assert.equal(res.status(), 200, await res.text()); return (await res.json()).state;
    };
    for (const id of ["count-main", "count-empty"]) await command("warehouse", {
      id, code: id.toUpperCase(), name: `${id} fixture`, type: "physical", address: "Disposable test location",
    });
    await command("item", { id: "count-bulk", sku: "COUNT-BULK", name: "Count bulk fixture", tracking: "regular" });
    await command("vendor", { id: "count-vendor", name: "Count test vendor" });
    await command("order", { id: "count-po", type: "purchase", vendorId: "count-vendor", destinationId: "count-main",
      lines: [{ itemId: "count-bulk", quantity: 5 }] });
    await command("release", { orderId: "count-po" });
    await command("receive", { orderId: "count-po", lines: [{ itemId: "count-bulk", quantity: 5 }] });
    const before = (await snapshot()).stock;
    for (let n = 0; n < 28; n++) {
      const id = `layout-count-${n}`;
      await command("countStart", { id, warehouseId: n % 2 ? "count-empty" : "count-main" });
      if (n % 4 === 0) await command("countCancel", { id, reason: `Cancelled fixture ${n}` });
      if (n === 1) await command("countPost", { id, lines: [], reason: "Empty location verified" });
    }
    assert.deepEqual((await snapshot()).stock, before, "starting/cancelling counts never changes stock");
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Cycle counts", exact: true }).click();
    const results = page.getByTestId("inventory-counts-results");
    const header = page.getByTestId("inventory-counts-subheader");
    const pager = page.getByTestId("inventory-counts-pagination");
    const countDialog = page.getByRole("dialog", { name: /^Continue count ·/ });
    const unsaved = page.getByRole("dialog", { name: "Unsaved count changes", exact: true });
    const capacity = async () => {
      await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(1);
      return Number(await results.getAttribute("data-page-size"));
    };
    const desktopCapacity = await capacity();
    await expect(results.locator("[data-count-record]")).toHaveCount(Math.min(28, desktopCapacity));
    await expect(pager).toContainText("of 28 counts");
    await pager.getByRole("button", { name: "Next counts page" }).click();
    await expect(pager).toContainText("Page 2");
    // Filtered exports cover every match, not only the adaptive page.
    await header.getByRole("button", { name: "Filter counts" }).click();
    const filters = page.getByRole("dialog", { name: "Filter counts", exact: true });
    await filters.getByLabel("Status", { exact: true }).selectOption("cancelled");
    await filters.getByRole("button", { name: /Show 7 counts/ }).click();
    await expect(pager).toContainText("of 7 counts");
    await expect(results.locator("[data-count-record]").first()).toContainText("cancelled");
    await expect(results.getByRole("button", { name: "Continue count", exact: true })).toHaveCount(0);
    const download = page.waitForEvent("download");
    await header.getByRole("button", { name: "CSV", exact: true }).click();
    const csv = await fs.readFile(await (await download).path(), "utf8");
    assert.equal(csv.trim().split(/\r?\n/).length, 8);
    assert.ok(csv.includes('"Count #1"'));
    assert.ok(!csv.includes("layout-count-"), "exports use readable count references");
    const excelDownload = page.waitForEvent("download");
    await header.getByRole("button", { name: "Excel", exact: true }).click();
    assert.ok((await excelDownload).suggestedFilename().endsWith(".xlsx"));
    const popupEvent = page.waitForEvent("popup");
    await header.getByRole("button", { name: "PDF / Print", exact: true }).click();
    const popup = await popupEvent;
    await expect(popup.locator("tbody tr")).toHaveCount(7); await popup.close();
    await header.getByRole("searchbox", { name: "Search counts", exact: true }).fill("no-match-fixture");
    await expect(header.getByRole("button", { name: "CSV", exact: true })).toBeDisabled();
    await expect(pager).toContainText("0 counts");
    await header.getByRole("searchbox", { name: "Search counts", exact: true }).fill("");
    await header.getByRole("button", { name: "Filter counts" }).click();
    await filters.getByRole("button", { name: "Clear filters" }).click();
    await filters.getByRole("button", { name: /Show 28 counts/ }).click();

    // Start chooses location in a modal, then leaves only the editor open.
    await header.getByRole("button", { name: "Start count", exact: true }).click();
    const start = page.getByRole("dialog", { name: "Start count", exact: true });
    await start.getByRole("combobox", { name: "Warehouse or vehicle" }).click();
    await page.getByRole("option", { name: "COUNT-MAIN · count-main fixture", exact: true }).click();
    await start.getByRole("button", { name: "Start count", exact: true }).click();
    await expect(start).toBeHidden(); await expect(countDialog).toBeVisible();
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "H2");
    await expect(countDialog.locator("#count-count-bulk")).toHaveValue("5");
    await countDialog.locator("#count-count-bulk").fill("8");
    await countDialog.getByLabel("Count adjustment reason").fill("Saved modal count");
    await countDialog.getByRole("button", { name: "Close", exact: true }).first().click();
    await expect(unsaved).toBeVisible();
    await unsaved.getByRole("button", { name: "Stay", exact: true }).click();
    await expect(countDialog.locator("#count-count-bulk")).toHaveValue("8");
    await countDialog.getByRole("button", { name: "Close", exact: true }).last().click();
    await unsaved.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(countDialog).toBeHidden(); await expect(unsaved).toBeHidden();
    assert.deepEqual((await snapshot()).stock, before);
    const id = (await snapshot()).counts.at(-1).id;
    const record = results.locator(`[data-count-id="${id}"]`);
    await record.getByRole("button", { name: "Continue count", exact: true }).click();
    await expect(countDialog.locator("#count-count-bulk")).toHaveValue("8");
    // Rejected reload/save retains the visible editor and local values.
    await countDialog.locator("#count-count-bulk").fill("9");
    const failSave = route => route.request().postDataJSON()?.action === "countSaveDraft"
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Fixture save unavailable" }) })
      : route.continue();
    await page.route(`**${endpoint}/commands`, failSave);
    await countDialog.getByRole("button", { name: "Close", exact: true }).first().click();
    await unsaved.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(unsaved).toContainText("Draft not saved");
    await expect(page.locator("#count-count-bulk")).toHaveValue("9");
    await page.unroute(`**${endpoint}/commands`, failSave);
    await unsaved.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(countDialog).toBeHidden();
    await record.getByRole("button", { name: "Continue count", exact: true }).click();
    await expect(countDialog.locator("#count-count-bulk")).toHaveValue("8");
    await countDialog.getByRole("button", { name: "Post count", exact: true }).click();
    await expect(countDialog).toBeHidden();
    assert.equal((await snapshot()).stock.find(row => row.itemId === "count-bulk").quantity, 8);
    await expect(record).toContainText("posted");
    await expect(record.getByRole("button", { name: "Print", exact: true })).toBeVisible();

    // Phone rotation and toolbar collapse must resize the actual result area.
    await header.getByRole("button", { name: "Filter counts" }).click();
    await filters.getByLabel("Status", { exact: true }).selectOption("open");
    await filters.getByRole("button", { name: /Show 20 counts/ }).click();
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const tools = header.getByRole("button", { name: /Search & Tools/ });
      await expect(tools).toBeVisible();
      if (await tools.getAttribute("aria-expanded") === "true") await tools.click();
      await expect(header.getByRole("button", { name: "Start count", exact: true })).toBeHidden();
      const collapsed = Number(await results.getAttribute("data-page-size"));
      await tools.click();
      await expect(tools).toHaveAttribute("aria-expanded", "true");
      await expect(header.getByRole("button", { name: "Start count", exact: true })).toBeVisible();
      await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeLessThanOrEqual(collapsed);
      const expanded = Number(await results.getAttribute("data-page-size"));
      await tools.click();
      await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThanOrEqual(expanded);
      const box = await results.boundingBox();
      assert.ok(box && box.height > 50 && box.x >= -1 && box.x + box.width <= viewport.width + 1);
      await page.screenshot({ path: `${out}/list-${viewport.width}.jpg` });
      await results.getByRole("button", { name: "Continue count", exact: true }).first().click();
      await expect(countDialog).toBeVisible();
      assert.ok(!["INPUT", "TEXTAREA"].includes(await page.evaluate(() => document.activeElement?.tagName)), "opening does not summon the phone keyboard");
      const modal = await countDialog.boundingBox();
      assert.ok(modal.y >= 0 && modal.y + modal.height <= viewport.height + 1);
      const footerClose = countDialog.getByRole("button", { name: "Close", exact: true }).first();
      await expect(footerClose).toBeInViewport();
      await page.screenshot({ path: `${out}/modal-${viewport.width}.jpg` });
      await footerClose.click(); await expect(countDialog).toBeHidden();
    }
    assert.deepEqual(errors, []);
    console.log("Cycle count workspace passed: adaptive paging, rotation, toolbar collapse, scoped exports, start/resume modals, focus, dirty guards, save failure, discard and posting.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
