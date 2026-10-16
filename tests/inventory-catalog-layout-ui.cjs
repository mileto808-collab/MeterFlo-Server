// Only run using the disposable inventory-ui-fixture --large-counts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");
const XLSX = require("xlsx");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const out = "generated-artifacts/inventory-catalog-layout";
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, acceptDownloads: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const snapshot = async () => (await (await context.request.get(endpoint)).json()).state;
    assert.equal((await snapshot()).items.filter(item => item.id.startsWith("capacity-")).length, 3000, "Requires the disposable large-counts fixture");
    const command = async (action, data) => {
      const response = await context.request.post(`${endpoint}/commands`, { data: { action, data, operationId: crypto.randomUUID() } });
      assert.equal(response.status(), 200, await response.text());
    };
    for (let n = 0; n < 45; n++) await command("vendor", {
      id: `catalog-vendor-${n}`, name: `Catalog supplier ${String(n).padStart(3, "0")}`,
      contact: n % 2 ? "Buyer" : "", phone: n % 2 ? "0000123" : "", reference: `000${n}`,
      active: n !== 44,
    });
    await command("item", { id: "catalog-special", sku: "000099", name: "000 Test meter",
      tracking: "serialized", equipment: "system", category: " Meters ", vendorId: "catalog-vendor-1",
      barcode: "00000009", manufacturer: "Test maker", reorderPoint: 4 });
    const before = await snapshot();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    assert.equal(await page.getByRole("tab", { name: "Items & vendors", exact: true }).count(), 0);
    for (const kind of ["items", "vendors"]) {
      const singular = kind === "items" ? "item" : "vendor";
      await page.getByRole("tab", { name: kind === "items" ? "Items" : "Vendors", exact: true }).click();
      const header = page.getByTestId(`inventory-${kind}-subheader`);
      const results = page.getByTestId(`inventory-${kind}-results`);
      const pager = page.getByTestId(`inventory-${kind}-pagination`);
      const search = page.getByRole("searchbox", { name: `Search ${kind}` });
      const mounted = results.locator("[data-catalog-row]");
      await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(2);
      const tallSize = Number(await results.getAttribute("data-page-size"));
      const first = await mounted.first().innerText();
      await page.getByRole("button", { name: `Next ${singular} page` }).click();
      await expect.poll(() => mounted.first().innerText()).not.toBe(first);
      await page.getByRole("button", { name: `Previous ${singular} page` }).click();
      await page.setViewportSize({ width: 1440, height: 720 });
      await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeLessThan(tallSize);
      await page.getByTestId("button-toggle-inventory-stats").click();
      await expect(page.getByTestId("inventory-stats-region")).toBeVisible();
      await page.getByTestId("button-toggle-inventory-stats").click();
      await page.screenshot({ path: `${out}/${kind}-desktop.jpg` });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(async () => (await pager.boundingBox()).y + (await pager.boundingBox()).height).toBeLessThanOrEqual(844);
      assert.ok((await results.boundingBox()).height >= 150, "Phone has usable results height");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const widths = await results.evaluate(el => [...el.querySelectorAll("[data-catalog-row]")].every(row => row.scrollWidth <= row.clientWidth + 1));
      assert.ok(widths, "No hidden horizontal clipping");
      const headerY = (await header.boundingBox()).y;
      await results.evaluate(el => el.scrollTop = 1000);
      assert.ok(Math.abs((await header.boundingBox()).y - headerY) < 1, "Toolbar remains fixed");
      await results.evaluate(el => el.scrollTop = 0);
      await page.screenshot({ path: `${out}/${kind}-mobile.jpg` });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await search.fill("DOES-NOT-EXIST");
      await expect(pager).toContainText(`0 ${kind}`);
      for (const name of ["CSV", "Excel", "PDF / Print"]) await expect(header.getByRole("button", { name, exact: true })).toBeDisabled();
      await search.fill(kind === "items" ? "CAP-00" : "Catalog supplier");
      await page.getByRole("button", { name: `Filter ${kind}`, exact: true }).click();
      const filters = page.getByRole("dialog");
      if (kind === "items") {
        await filters.getByLabel("Category", { exact: true }).selectOption("Meters");
        await filters.getByRole("button", { name: /^Show \d+ items$/ }).click();
        await expect(pager).toContainText("0 items");
        await search.fill("00000009");
        await expect(pager).toContainText("of 1 items");
        await mounted.getByRole("button", { name: "Edit", exact: true }).click();
        await expect(page.getByLabel("Product ID (SKU)", { exact: false })).toHaveValue("000099");
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.getByRole("button", { name: "Filter items", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Clear filters", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: /^Show \d+ items$/ }).click();
        await search.fill("CAP-00");
      } else {
        await filters.getByLabel("Status", { exact: true }).selectOption("active");
        await filters.getByLabel("Contact availability", { exact: true }).selectOption("available");
        await filters.getByRole("button", { name: /^Show \d+ vendors$/ }).click();
        await expect(pager).toContainText("of 22 vendors");
        await page.getByRole("button", { name: "Filter vendors", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "Clear filters", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: /^Show \d+ vendors$/ }).click();
      }
      const expectedCount = kind === "items" ? 100 : 45;
      await expect(pager).toContainText(`of ${expectedCount} ${kind}`);
      for (const format of ["CSV", "Excel"]) {
        const downloadPromise = page.waitForEvent("download");
        await header.getByRole("button", { name: format, exact: true }).click();
        const download = await downloadPromise;
        const file = `${out}/${download.suggestedFilename()}`;
        await download.saveAs(file);
        const book = XLSX.readFile(file, { raw: true });
        const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
        assert.equal(rows.length, expectedCount + 1, "All matches exported, not just current page");
      }
      const popupPromise = context.waitForEvent("page");
      await header.getByRole("button", { name: "PDF / Print", exact: true }).click();
      const popup = await popupPromise;
      await popup.waitForLoadState();
      assert.equal(await popup.locator("tbody tr").count(), expectedCount);
      await popup.pdf({ path: `${out}/${kind}.pdf`, format: "A4", landscape: true });
      await popup.close();
      await header.getByRole("button", { name: `Add ${singular}`, exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      if (kind === "vendors") {
        await search.fill("Catalog supplier 001");
        await mounted.getByRole("button", { name: "Edit", exact: true }).click();
        await expect(page.getByLabel("Phone", { exact: true })).toHaveValue("0000123");
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
      }
    }
    assert.deepEqual(await snapshot(), before, "Read-only browsing and exports do not mutate inventory");
    assert.deepEqual(errors, []);
    await context.close();
    console.log("Catalog UI passed: 3,001 items / 45 vendors, desktop/phone adaptive paging, sticky controls, filters/search, complete CSV/Excel/PDF, existing Add/Edit dialogs, no mutation or browser errors.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
