const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required; never run against user data.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const out = "generated-artifacts/inventory-date-filters";
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")(), acceptDownloads: true });
    assert.ok((await context.request.post("/api/auth/local/login", { data: fixture })).ok());
    const root = `/api/projects/${fixture.projectId}/inventory`;
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    // These are rendering fixtures only, never persisted as stock or history.
    await page.route(`**${root}`, async route => {
      const response = await route.fetch(), json = await response.json(), state = json.state;
      const warehouseId = state.warehouses[0].id;
      json.timezone = "America/Denver";
      state.receipts = ["early", "late", "unknown"].map((id, index) => ({
        id, action: "countPost", reference: id, warehouseId, lines: [], actor: fixture.id,
        occurredAt: index === 0 ? "2026-10-19T03:01:17Z" : index === 1 ? "2026-10-19T07:01:17Z" : "",
      }));
      state.counts = state.receipts.map(receipt => ({ id: receipt.id, warehouseId, status: "posted", snapshot: [] }));
      state.returns = state.receipts.map(receipt => ({
        id: receipt.id, equipment: "system", serial: `SERIAL-${receipt.id}`, workOrderId: 777,
        disposition: "returned", warehouseId, status: "scrapped",
        history: receipt.occurredAt ? [{ operationId: receipt.id, actor: fixture.id, occurredAt: receipt.occurredAt,
          outcome: "scrapped", reason: "Date fixture" }] : [],
      }));
      state.shipmentHolds = state.receipts.map(receipt => ({
        id: receipt.id, orderId: "date-order", receiptId: receipt.id, itemId: "date-item", warehouseId,
        quantity: 1, serials: [], unidentifiedQuantity: 1, expectedSerials: [], status: "held",
        actor: fixture.id, occurredAt: receipt.occurredAt, reason: "Date fixture", dispositions: [],
      }));
      await route.fulfill({ response, json });
    });
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    for (const [tab, kind, noun] of [
      ["Removed Equipment", "returns", "returns"], ["Shipment exceptions", "exceptions", "exceptions"],
      ["Cycle counts", "counts", "counts"], ["Activity", "activity", "activity"],
    ]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await page.getByRole("button", { name: `Filter ${noun}`, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(/America\/Denver/)).toBeVisible();
      await dialog.getByLabel("From date", { exact: true }).fill("2026-10-18");
      await dialog.getByLabel("To date", { exact: true }).fill("2026-10-18");
      await expect(dialog.getByRole("button", { name: `Show 1 ${noun}`, exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: `Show 1 ${noun}`, exact: true }).click();
      if (kind === "returns") await expect(page.getByTestId(`inventory-${kind}-results`)).toContainText("SERIAL-early");
      if (kind === "returns") {
        const download = page.waitForEvent("download");
        await page.getByRole("button", { name: "CSV", exact: true }).click();
        const file = await download;
        const csv = await fs.readFile(await file.path(), "utf8");
        assert.ok(csv.includes("SERIAL-early"));
        assert.ok(!csv.includes("SERIAL-late") && !csv.includes("SERIAL-unknown"), "Export follows the entire filtered scope");
      }
      await page.getByRole("button", { name: `Filter ${noun}`, exact: true }).click();
      await dialog.getByLabel("From date", { exact: true }).fill("2026-10-20");
      await expect(dialog.getByRole("alert")).toContainText("From date must be on or before the to date.");
      await expect(dialog.getByRole("button", { name: `Show 0 ${noun}`, exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Clear filters", exact: true }).click();
      await expect(dialog.getByLabel("From date", { exact: true })).toHaveValue("");
      await expect(dialog.getByLabel("To date", { exact: true })).toHaveValue("");
      await dialog.getByRole("button", { name: `Show 3 ${noun}`, exact: true }).click();
    }
    await page.getByRole("tab", { name: "Locations", exact: true }).click();
    await page.getByRole("button", { name: "Filter locations", exact: true }).click();
    await expect(page.getByRole("dialog").getByLabel("From date", { exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Removed Equipment", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const tools = page.getByRole("button", { name: "Show Search & Tools" });
    if (await tools.isVisible()) await tools.click();
    await page.getByRole("button", { name: "Filter returns", exact: true }).click();
    await expect(page.getByRole("dialog").getByLabel("From date", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${out}/phone-date-filters.jpg`, fullPage: true });
    assert.deepEqual(errors, []);
    console.log("PASS: all four dated tabs filter by inclusive project-local dates; invalid ranges, clear, filtered CSV, phone controls and undated catalogs verified.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
