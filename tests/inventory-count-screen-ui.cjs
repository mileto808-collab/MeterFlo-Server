// Only use the disposable fixture created by tests/support/inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");
const XLSX = require("xlsx");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`, base = `/api/projects/${fixture.projectId}/inventory`;
  const admin = await browser.newContext({ baseURL, acceptDownloads: true });
  assert.equal((await admin.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
  const post = async (action, data) => {
    const response = await admin.request.post(`${base}/commands`, { data: { action, data, operationId: crypto.randomUUID() } });
    assert.equal(response.status(), 200, `${action}: ${await response.text()}`);
    return (await response.json()).state;
  };
  const snapshot = async () => (await (await admin.request.get(base)).json()).state;
  const warehouseId = `responsive-${crypto.randomUUID().slice(0, 8)}`, prefix = warehouseId;
  const itemId = n => `${prefix}-${String(n).padStart(2, "0")}`;
  try {
    await fs.mkdir("generated-artifacts", { recursive: true });
    await post("warehouse", { id: warehouseId, code: prefix, name: "Responsive count warehouse", type: "physical", address: "Fixture only" });
    await post("vendor", { id: prefix, name: "Responsive count supplier" });
    const lines = [];
    for (let n = 0; n < 26; n++) {
      await post("item", { id: itemId(n), sku: `${prefix}-COUNT-${String(n).padStart(2, "0")}`, name: `Count product ${String(n).padStart(2, "0")}`, tracking: n === 0 ? "serialized" : "regular" });
      lines.push({ itemId: itemId(n), quantity: n === 0 ? 2 : 5, serials: n === 0 ? [`000010${prefix}`, `000011${prefix}`] : [] });
    }
    await post("order", { id: prefix, vendorId: prefix, type: "purchase", destinationId: warehouseId,
      lines: lines.map(({ serials, ...line }) => line) });
    await post("release", { orderId: prefix });
    await post("receive", { orderId: prefix, lines });
    for (const [mode, viewport] of [["desktop", { width: 1440, height: 1000 }], ["phone", { width: 390, height: 844 }], ["landscape", { width: 844, height: 390 }]]) {
      const context = await browser.newContext({ baseURL, viewport, isMobile: mode !== "desktop", hasTouch: mode !== "desktop", acceptDownloads: true });
      assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`/projects/${fixture.projectId}/inventory`);
      const previewBanner = page.getByRole("button", { name: "Close banner", exact: true });
      if (await previewBanner.isVisible()) await previewBanner.click();
      await page.getByTestId("inventory-sticky-header").waitFor();
      const menu = page.getByTestId("inventory-mobile-menu");
      if (await menu.isVisible()) {
        await menu.click();
        await page.getByRole("menuitem", { name: "Cycle counts", exact: true }).click();
      } else await page.getByRole("tab", { name: "Cycle counts", exact: true }).click();
      const header = page.getByTestId("inventory-counts-subheader");
      const start = async scope => {
        await expect(header).toBeVisible();
        const tools = header.getByTestId("inventory-mobile-tools-counts-toggle");
        if (await tools.isVisible() && await tools.getAttribute("aria-expanded") === "false") await tools.click();
        await header.getByRole("button", { name: "Start count", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Start cycle count", exact: true });
        await dialog.getByLabel("Warehouse or vehicle", { exact: true }).click();
        await page.getByRole("option", { name: `${prefix} · Responsive count warehouse`, exact: true }).click();
        await dialog.getByTestId(scope === "warehouse" ? "count-scope-warehouse" : "count-scope-selected").check();
        return dialog;
      };
      let dialog = await start("warehouse");
      await expect(dialog.getByTestId("count-start-product-picker")).toHaveCount(0);
      await dialog.getByRole("button", { name: "Start count", exact: true }).click();
      const editor = page.getByTestId("inventory-count-editor");
      await expect(editor).toBeVisible();
      let state = await snapshot(), count = state.counts.at(-1);
      assert.equal(count.scope, "warehouse");
      assert.equal(count.snapshot.length, 26);
      const entries = editor.getByTestId("inventory-count-entry-list");
      const pager = editor.getByTestId("inventory-count-pagination");
      await expect.poll(async () => Number(await entries.getAttribute("data-page-size"))).toBeGreaterThan(0);
      assert.ok(await entries.locator("[data-count-entry]").count() < 26);
      const firstId = await entries.locator('input[type="number"]').first().getAttribute("id");
      await pager.getByRole("button", { name: "Next count entries page", exact: true }).click();
      await expect(entries.locator('input[type="number"]').first()).not.toHaveAttribute("id", firstId);
      await pager.getByRole("button", { name: "Previous count entries page", exact: true }).click();
      await expect(entries.locator('input[type="number"]').first()).toHaveAttribute("id", firstId);
      const show = editor.getByRole("button", { name: "Show Search & Tools", exact: true });
      await show.click();
      const search = editor.getByLabel("Search count entries", { exact: true });
      await search.fill("Count product 01");
      await editor.locator(`#count-${itemId(1)}`).fill("7");
      await search.fill("no-such-count-product");
      await editor.getByTestId("count-export-scope").selectOption("filtered");
      await expect(editor.getByTestId("count-export-csv")).toBeDisabled();
      await expect(editor.getByTestId("count-export-scope")).toHaveValue("filtered");
      await editor.getByTestId("count-export-scope").selectOption("all");
      await expect(editor.getByTestId("count-export-csv")).toBeEnabled();
      const beforeExport = await snapshot();
      const downloadCsv = page.waitForEvent("download");
      await editor.getByTestId("count-export-csv").click();
      const csv = await fs.readFile(await (await downloadCsv).path(), "utf8");
      const csvRows = XLSX.utils.sheet_to_json(XLSX.read(csv, { type: "string", raw: true }).Sheets.Sheet1, { header: 1, raw: true });
      assert.equal(csvRows.length, 27);
      assert.equal(csvRows.find(row => row[0] === `${prefix}-COUNT-01`)[4], "7");
      assert.ok(csv.includes(`000010${prefix}\n000011${prefix}`));
      assert.equal((await snapshot()).revision, beforeExport.revision, "Export must not save or post");
      await search.fill("Count product 01");
      await editor.getByTestId("count-export-scope").selectOption("filtered");
      const excelDownload = page.waitForEvent("download");
      await editor.getByTestId("count-export-xlsx").click();
      const workbook = XLSX.read(await fs.readFile(await (await excelDownload).path()), { type: "buffer" });
      assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets["Count entries"]).length, 1);
      const popupPromise = page.waitForEvent("popup");
      await editor.getByTestId("count-export-pdf").click();
      const popup = await popupPromise;
      await expect(popup.getByRole("heading", { level: 1 })).toContainText("Count entries");
      await expect(popup.locator("tbody tr")).toHaveCount(1);
      await popup.close();
      await search.fill("");
      await editor.getByRole("button", { name: "Hide Search & Tools", exact: true }).click();
      if (mode === "desktop") {
        await expect.poll(async () => Number(await entries.getAttribute("data-page-size"))).toBeGreaterThan(1);
      }
      const seen = [];
      for (;;) {
        seen.push(...await entries.locator('input[type="number"]').evaluateAll(inputs => inputs.map(input => input.id)));
        const next = pager.getByRole("button", { name: "Next count entries page", exact: true });
        if (await next.isDisabled()) break;
        await next.click();
        assert.ok(seen.length <= 26, "Pagination must not repeat or skip records when row sizes differ");
      }
      assert.equal(seen.length, 26);
      assert.equal(new Set(seen).size, 26);
      while (await pager.getByRole("button", { name: "Previous count entries page", exact: true }).isEnabled())
        await pager.getByRole("button", { name: "Previous count entries page", exact: true }).click();
      if (mode === "phone") {
        await page.setViewportSize({ width: 844, height: 390 });
        await expect(entries.locator('input[type="number"]').first()).toHaveAttribute("id", `count-${itemId(0)}`);
        await page.setViewportSize(viewport);
        await expect(entries.locator('input[type="number"]').first()).toHaveAttribute("id", `count-${itemId(0)}`);
      }
      // The public preview banner and success toasts are not part of count layout.
      // Dismiss toasts before checking actual visible editor content.
      for (const toast of await page.locator("[toast-close]").all()) await toast.click({ force: true }).catch(() => {});
      await pager.scrollIntoViewIfNeeded();
      if (mode === "landscape") {
        const quantity = await entries.locator('input[type="number"]').first().boundingBox();
        const footer = await editor.getByRole("button", { name: "Save draft", exact: true }).boundingBox();
        assert.ok(quantity && footer && quantity.y + quantity.height <= footer.y,
          "Landscape must show an actual-quantity input above the sticky actions");
      }
      await page.screenshot({ path: `generated-artifacts/count-editor-${mode}.jpg` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
      await editor.getByRole("button", { name: "Save draft", exact: true }).click();
      await expect.poll(async () => (await snapshot()).counts.find(value => value.id === count.id)?.draft?.rows.find(row => row.itemId === itemId(1))?.quantity).toBe("7");
      await editor.getByTestId("inventory-editor-back").click();
      dialog = await start("selected");
      await dialog.getByTestId("count-start-product-search").fill("Count product 00");
      await dialog.getByTestId(`count-start-item-${itemId(0)}`).check();
      await dialog.getByTestId("count-start-product-search").fill("Count product 01");
      await dialog.getByTestId(`count-start-item-${itemId(1)}`).check();
      await expect(dialog.getByTestId("count-start-selected-count")).toContainText("2 selected");
      await page.screenshot({ path: `generated-artifacts/count-start-${mode}.jpg` });
      await dialog.getByRole("button", { name: "Start count", exact: true }).click();
      await expect(editor).toBeVisible();
      state = await snapshot(); count = state.counts.at(-1);
      assert.equal(count.scope, "selected");
      assert.equal(count.snapshot.length, 26);
      assert.equal(count.draft.rows.length, 2);
      assert.ok(count.draft.rows.every(row => row.quantity === "" && row.serials === ""));
      await expect(editor).toContainText("2 count entries");
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${mode}: full/selected start, saved product selection, adaptive pages, unsaved and filtered exports, no-match safety, draft preservation.`);
    }
  } finally { await admin.close(); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
