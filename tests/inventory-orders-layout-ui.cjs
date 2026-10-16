// Uses only the disposable inventory-ui-fixture accounts and project.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");
const XLSX = require("xlsx");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const out = "generated-artifacts/inventory-orders-layout";
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, acceptDownloads: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const command = async (action, data) => {
      const response = await context.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
      assert.equal(response.status(), 200, await response.text());
      return (await response.json()).state;
    };
    if (!process.argv.includes("--reuse-fixture")) {
    for (const id of ["main", "vehicle"]) await command("warehouse", { id, code: id.toUpperCase(),
      name: id === "main" ? "Main warehouse" : "Vehicle warehouse", type: "physical", address: "Disposable fixture" });
    await command("vendor", { id: "vendor", name: "Layout vendor" });
    for (let i = 0; i < 12; i++) await command("item", { id: `product-${i}`, sku: `SKU-${String(i).padStart(3, "0")}`,
      name: `Layout product ${i}`, tracking: "regular" });
    for (let i = 0; i < 60; i++) {
      const purchase = i % 2 === 0;
      await command("order", { id: crypto.randomUUID(), type: purchase ? "purchase" : "transfer",
        vendorId: purchase ? "vendor" : null, sourceId: purchase ? null : "main", destinationId: purchase ? "main" : "vehicle",
        reference: `BATCH-${purchase ? "PUR" : "TRN"}-${String(i).padStart(3, "0")}`,
        lines: Array.from({ length: i === 59 ? 12 : i % 3 === 0 ? 2 : 1 }, (_, index) =>
          ({ itemId: `product-${index}`, quantity: index + 1 })) });
    }
    const seedSnapshot = (await (await context.request.get(endpoint)).json()).state;
    const receivingOrder = seedSnapshot.orders.find(order => order.reference === "BATCH-PUR-000");
    await command("release", { orderId: receivingOrder.id });
    await command("shipmentDraftSave", { id: crypto.randomUUID(), revision: 0, orderId: receivingOrder.id, stage: "receive",
      capture: { entries: {}, scanBuffers: {}, reason: "Saved layout fixture capture", closeRemainder: false } });
    }
    const snapshot = (await (await context.request.get(endpoint)).json()).state;
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 1100 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Orders", exact: true }).click();
    const header = page.getByTestId("inventory-orders-subheader");
    const results = page.getByTestId("inventory-order-results");
    const pager = page.getByTestId("inventory-orders-pagination");
    const rows = results.locator("[data-order-id]");
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(1);
    let capacity = Number(await results.getAttribute("data-page-size"));
    await expect.poll(() => rows.count()).toBe(capacity);
    const allCount = snapshot.orders.length;
    assert.ok(capacity < allCount, "Only the screen-sized page is rendered");
    const firstId = await rows.first().getAttribute("data-order-id");
    await rows.first().getByRole("button", { name: "Edit draft", exact: true }).click();
    const editor = page.getByTestId("inventory-order-dialog");
    await expect(editor).toBeVisible();
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor).toBeHidden();
    await pager.getByRole("button", { name: "Next order page", exact: true }).click();
    await expect.poll(async () => rows.first().getAttribute("data-order-id")).not.toBe(firstId);
    await pager.getByRole("button", { name: "Previous order page", exact: true }).click();
    await expect.poll(async () => rows.first().getAttribute("data-order-id")).toBe(firstId);
    const before = await header.boundingBox();
    await rows.first().locator("summary").click();
    await results.evaluate(element => { element.scrollTop = 250; });
    assert.ok(await results.evaluate(element => element.scrollTop > 0), "Expanded row really scrolls locally");
    const after = await header.boundingBox();
    assert.ok(Math.abs(before.y - after.y) < 1, "Orders subheader stays fixed while results scroll");
    assert.equal(Number(await results.getAttribute("data-page-size")), capacity, "Expanded details do not permanently shrink capacity");
    await rows.first().locator("summary").click();
    await results.evaluate(element => { element.scrollTop = 0; });
    const largeCapacity = capacity;
    await page.setViewportSize({ width: 1440, height: 720 });
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeLessThan(largeCapacity);
    const smallCapacity = Number(await results.getAttribute("data-page-size"));
    await page.setViewportSize({ width: 1440, height: 1100 });
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(smallCapacity);
    await page.getByTestId("button-toggle-inventory-stats").click();
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeLessThan(largeCapacity);
    await page.getByTestId("button-toggle-inventory-stats").click();
    await header.getByRole("searchbox", { name: "Search orders", exact: true }).fill("BATCH-PUR");
    await expect(pager).toContainText("of 30");
    await header.getByRole("button", { name: "Filters", exact: true }).click();
    const filters = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /filter/i }) });
    await expect(filters).toBeVisible();
    await filters.getByRole("combobox", { name: "Order status", exact: true }).click();
    await page.getByRole("option", { name: "Draft", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(filters).toBeHidden();
    await expect(pager).toContainText("of 29");
    // Reset advanced filters while retaining the outer text search.
    await header.getByRole("button", { name: "Filters", exact: true }).click();
    await filters.getByRole("combobox", { name: "Order status", exact: true }).click();
    await page.getByRole("option", { name: "All statuses", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(pager).toContainText("of 30");
    const expected = snapshot.orders.filter(order => order.reference.startsWith("BATCH-PUR"));
    async function download(name, extension) {
      const pending = page.waitForEvent("download");
      await header.getByRole("button", { name, exact: true }).click();
      const file = await pending;
      const filename = `${out}/orders.${extension}`;
      await file.saveAs(filename);
      assert.equal(await file.failure(), null);
      return filename;
    }
    for (const [name, extension] of [["CSV", "csv"], ["Excel", "xlsx"]]) {
      const file = await download(name, extension);
      const workbook = XLSX.readFile(file, { raw: true });
      const data = XLSX.utils.sheet_to_json(workbook.Sheets.Orders || workbook.Sheets[workbook.SheetNames[0]], { header: 1 }).slice(1);
      assert.deepEqual(new Set(data.map(row => String(row[2]))), new Set(expected.map(order => order.id)),
        `${name} contains every matching order across all pages and no unrelated transfers`);
    }
    const popupPromise = page.waitForEvent("popup");
    await header.getByRole("button", { name: "PDF / Print", exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    const body = await popup.locator("body").innerText();
    for (const order of expected) assert.ok(body.includes(order.orderNumber));
    assert.ok(!body.includes("BATCH-TRN"));
    for (const format of ["Letter", "A4"]) {
      const file = `${out}/orders-${format}.pdf`;
      await popup.pdf({ path: file, format, landscape: true, printBackground: true });
      const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 5_000_000 });
      const pages = text.split("\f").filter(part => part.trim());
      assert.ok(pages.length > 1);
      for (const part of pages) assert.ok(part.includes("Timezone:") && part.includes("Order / reference"), "Repeated print identifiers/headings");
      for (const order of expected) assert.ok(text.includes(order.orderNumber), "PDF includes all matching orders");
    }
    await popup.close();
    await header.getByRole("searchbox", { name: "Search orders", exact: true }).fill("NO-SUCH-ORDER");
    await expect(rows).toHaveCount(0);
    for (const name of ["CSV", "Excel", "PDF / Print"]) await expect(header.getByRole("button", { name, exact: true })).toBeDisabled();
    await header.getByRole("searchbox", { name: "Search orders", exact: true }).fill("");
    await expect(rows.first()).toBeVisible();
    await page.screenshot({ path: `${out}/desktop.jpg` });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBe(1);
    const dimensions = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="inventory-orders-subheader"]');
      const results = document.querySelector('[data-testid="inventory-order-results"]');
      const pager = document.querySelector('[data-testid="inventory-orders-pagination"]');
      return { header: header.getBoundingClientRect().bottom, pager: pager.getBoundingClientRect().bottom,
        resultsHeight: results.clientHeight, resultsWidth: results.clientWidth, resultsScrollWidth: results.scrollWidth,
        viewport: innerHeight, pageWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth };
    });
    assert.ok(dimensions.header < dimensions.viewport && dimensions.pager <= dimensions.viewport + 1);
    assert.ok(dimensions.resultsHeight >= 50, "At least one bounded row remains reachable on mobile");
    assert.ok(dimensions.resultsScrollWidth <= dimensions.resultsWidth + 1 && dimensions.pageWidth <= dimensions.viewportWidth + 1);
    await page.screenshot({ path: `${out}/mobile.jpg` });
    await header.getByRole("button", { name: "Saved shipment drafts", exact: true }).click();
    const drafts = page.getByRole("dialog", { name: "Saved shipment drafts", exact: true });
    await expect(drafts).toBeVisible();
    await expect(drafts.getByRole("button", { name: "Resume", exact: true })).toHaveCount(1);
    await page.route(`**${endpoint}`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Fixture unavailable" }) }));
    await drafts.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(page.getByText("Could not refresh shipment draft", { exact: true }).first()).toBeVisible();
    await expect(drafts).toBeVisible();
    await page.unroute(`**${endpoint}`);
    await drafts.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(drafts).toBeHidden();
    await expect(page.getByRole("dialog").filter({ has: page.getByText(/Receive purchase/) }).first()).toBeVisible();
    const afterSnapshot = (await (await context.request.get(endpoint)).json()).state;
    assert.deepEqual(afterSnapshot.stock, snapshot.stock);
    assert.deepEqual(afterSnapshot.receipts, snapshot.receipts);
    const denied = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
    await denied.request.post("/api/auth/local/login", { data: fixture.viewer });
    assert.equal((await denied.request.get(endpoint)).status(), 403);
    await denied.close();
    assert.deepEqual(errors, []);
    console.log("Orders toolbar/paging passed: sticky scrolling, responsive capacity, filter reset, all-matching CSV/XLSX/PDF, mobile bounds, safe draft resume, permissions and no stock movement.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
