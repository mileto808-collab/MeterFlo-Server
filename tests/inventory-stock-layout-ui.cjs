// Run only with the isolated inventory-ui-fixture --large-counts project.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");
const XLSX = require("xlsx");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const out = "generated-artifacts/inventory-stock-layout";
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
    headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, acceptDownloads: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const command = async (action, data) => {
      const response = await context.request.post(`${endpoint}/commands`, { data: { action, data, operationId: crypto.randomUUID() } });
      assert.equal(response.status(), 200, await response.text());
    };
    await command("warehouse", { id: "stock-layout", code: "00099", name: "Secondary store", type: "physical", address: "Disposable fixture" });
    await command("vendor", { id: "stock-layout-vendor", name: "Layout vendor" });
    await command("item", { id: "stock-layout-meter", sku: "00001111", name: "000 Serial meter", category: "Meters", tracking: "serialized" });
    await command("item", { id: "stock-layout-seal", sku: "00002222", name: "000 Seal", category: "Supplies", tracking: "regular" });
    const orderId = crypto.randomUUID();
    await command("order", { id: orderId, type: "purchase", vendorId: "stock-layout-vendor", destinationId: "stock-layout",
      lines: [{ itemId: "stock-layout-meter", quantity: 2 }, { itemId: "stock-layout-seal", quantity: 3 }] });
    await command("release", { orderId });
    await command("receive", { orderId, lines: [{ itemId: "stock-layout-meter", quantity: 2, serials: ["00000001", "ROW-EXACT-001"] },
      { itemId: "stock-layout-seal", quantity: 3, serials: [] }] });
    const before = (await (await context.request.get(endpoint)).json()).state;
    assert.equal(before.stock.length, 602, "Use --large-counts, not a customer project");
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1100 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    const header = page.getByTestId("inventory-stock-subheader");
    const results = page.getByRole("region", { name: "Stock balances", exact: true });
    const pager = page.getByTestId("inventory-stock-pagination");
    const rows = results.locator("[data-stock-row]");
    const search = header.getByRole("searchbox", { name: "Search inventory", exact: true });
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(1);
    let capacity = Number(await results.getAttribute("data-page-size"));
    await expect.poll(() => rows.count()).toBe(capacity);
    const firstKey = await rows.first().getAttribute("data-stock-key");
    await pager.getByRole("button", { name: "Next stock page", exact: true }).click();
    await expect.poll(async () => rows.first().getAttribute("data-stock-key")).not.toBe(firstKey);
    await pager.getByRole("button", { name: "Previous stock page", exact: true }).click();
    await expect.poll(async () => rows.first().getAttribute("data-stock-key")).toBe(firstKey);
    const firstRect = await header.boundingBox();
    // Force real local overflow by narrowing the viewport to a single tall record.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBe(1);
    await results.evaluate(element => { element.scrollTop = 200; });
    const bounds = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="inventory-stock-subheader"]');
      const region = document.querySelector('[data-testid="inventory-stock-results"]');
      const pager = document.querySelector('[data-testid="inventory-stock-pagination"]');
      return { y: header.getBoundingClientRect().y, pagerBottom: pager.getBoundingClientRect().bottom,
        resultHeight: region.clientHeight, resultWidth: region.clientWidth, scrollWidth: region.scrollWidth,
        scrollTop: region.scrollTop, viewport: innerHeight, pageWidth: document.documentElement.scrollWidth, width: innerWidth };
    });
    assert.ok(bounds.scrollTop > 0, "A tall mobile row scrolls within results");
    assert.ok(bounds.pagerBottom <= bounds.viewport + 1 && bounds.resultHeight >= 50);
    assert.ok(bounds.scrollWidth <= bounds.resultWidth + 1 && bounds.pageWidth <= bounds.width + 1);
    assert.ok(Math.abs((await header.boundingBox()).y - bounds.y) < 1);
    await page.screenshot({ path: `${out}/mobile.jpg` });
    await page.setViewportSize({ width: 1440, height: 1100 });
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(1);
    capacity = Number(await results.getAttribute("data-page-size"));
    await page.setViewportSize({ width: 1440, height: 720 });
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeLessThan(capacity);
    await page.setViewportSize({ width: 1440, height: 1100 });
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBe(capacity);
    await page.getByTestId("button-toggle-inventory-stats").click();
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeLessThan(capacity);
    await page.getByTestId("button-toggle-inventory-stats").click();
    await search.fill("row-exact-001");
    await expect(rows).toHaveCount(1);
    await rows.getByRole("button", { name: "View serials (2) for 00001111 at 00099", exact: true }).click();
    const serialDialog = page.getByRole("dialog", { name: "Stock serials", exact: true });
    await expect(serialDialog).toBeVisible();
    await expect(serialDialog).toContainText("00000001");
    await page.keyboard.press("Escape");
    await expect(serialDialog).toBeHidden();
    await search.fill("");
    await header.getByRole("button", { name: "Filters", exact: true }).click();
    const filters = page.getByRole("dialog", { name: "Filter stock", exact: true });
    await filters.getByLabel("Warehouse or vehicle", { exact: true }).selectOption("stock-layout");
    await filters.getByLabel("Category", { exact: true }).selectOption("Meters");
    await filters.getByLabel("Tracking", { exact: true }).selectOption("serialized");
    await filters.getByRole("button", { name: "Show 1 balance", exact: true }).click();
    await expect(rows).toHaveCount(1);
    await header.getByRole("button", { name: "Filters", exact: true }).click();
    await filters.getByRole("button", { name: "Clear filters", exact: true }).click();
    await filters.getByLabel("Availability", { exact: true }).selectOption("out-of-stock");
    await filters.getByRole("button", { name: "Show 0 balances", exact: true }).click();
    await expect(rows).toHaveCount(0);
    for (const name of ["CSV", "Excel", "PDF / Print"]) await expect(header.getByRole("button", { name, exact: true })).toBeDisabled();
    await results.getByRole("button", { name: "Clear search and filters", exact: true }).click();
    await search.fill("CAP-00");
    await expect(pager).toContainText("of 100 balances");
    await header.getByRole("button", { name: "Filters", exact: true }).click();
    await filters.getByLabel("Sort balances", { exact: true }).selectOption("item-desc");
    await filters.getByRole("button", { name: "Show 100 balances", exact: true }).click();
    const expectedItems = before.items.filter(item => item.sku.startsWith("CAP-00")).sort((a, b) =>
      `${b.name} ${b.sku}`.localeCompare(`${a.name} ${a.sku}`));
    for (const [label, extension] of [["CSV", "csv"], ["Excel", "xlsx"]]) {
      const pending = page.waitForEvent("download");
      await header.getByRole("button", { name: label, exact: true }).click();
      const download = await pending;
      const filename = `${out}/stock.${extension}`;
      await download.saveAs(filename);
      assert.equal(await download.failure(), null);
      const book = XLSX.readFile(filename, { raw: true });
      const data = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 }).slice(1);
      assert.deepEqual(data.map(row => row[0]), expectedItems.map(item => item.sku), "All matching balances in selected order, not just current page");
      for (const row of data) assert.deepEqual(row.slice(8, 12).map(Number), [2, 0, 2, 0]);
    }
    const pendingPopup = page.waitForEvent("popup");
    await header.getByRole("button", { name: "PDF / Print", exact: true }).click();
    const popup = await pendingPopup;
    await popup.waitForLoadState();
    for (const format of ["Letter", "A4"]) {
      const filename = `${out}/stock-${format}.pdf`;
      await popup.pdf({ path: filename, format, landscape: true, printBackground: true });
      const text = execFileSync("pdftotext", ["-layout", filename, "-"], { encoding: "utf8" });
      for (const item of expectedItems) assert.ok(text.includes(item.sku));
      assert.ok(!text.includes("ROW-EXACT-001"));
      const pages = text.split("\f").filter(part => part.trim());
      assert.ok(pages.length > 1);
      for (const part of pages) assert.ok(part.includes("Timezone:") && part.includes("Item / SKU"), "Repeated context/table headings");
    }
    await popup.close();
    await search.fill("");
    await page.screenshot({ path: `${out}/desktop.jpg` });
    // Switching tab must restore the main height before Orders installs its own bound.
    await page.getByRole("tab", { name: "Orders", exact: true }).click();
    await expect(page.getByTestId("inventory-orders-subheader")).toBeVisible();
    await page.getByRole("tab", { name: "Stock & search", exact: true }).click();
    await expect(header).toBeVisible();
    assert.ok(Math.abs((await header.boundingBox()).y - firstRect.y) < 2);
    const after = (await (await context.request.get(endpoint)).json()).state;
    assert.deepEqual(after.stock, before.stock);
    assert.deepEqual(after.receipts, before.receipts);
    const denied = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
    await denied.request.post("/api/auth/local/login", { data: fixture.viewer });
    assert.equal((await denied.request.get(endpoint)).status(), 403);
    await denied.close();
    assert.deepEqual(errors, []);
    console.log("Stock workspace passed: 602 balances, responsive paging, sticky mobile/desktop bounds, filters/serial search, full-match sorted CSV/Excel/Letter/A4 PDF, serial modal and read-only permissions.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
