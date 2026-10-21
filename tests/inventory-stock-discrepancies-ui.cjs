// Run only in the owned database/application sandbox.
const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")() });
  const root = `/api/projects/${fixture.projectId}`, endpoint = `${root}/inventory`;
  const json = async (method, path, data, client = context) => {
    const response = await client.request.fetch(path, { method, data });
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const send = (action, data, client = context) => json("POST", `${endpoint}/commands`,
    { action, data, operationId: crypto.randomUUID() }, client);
  const current = async () => (await json("GET", endpoint)).state;
  const errors = [];
  try {
    await json("POST", "/api/auth/local/login", fixture);
    await send("warehouse", { id: "field", code: "FIELD", name: "Field stock", type: "physical", address: "Fixture" });
    await send("fieldSettings", { sourceMode: "project_warehouse", warehouseId: "field", fulfillment: "components" });
    await send("vendor", { id: "vendor", name: "Fixture vendor" });
    await send("item", { id: "part", sku: "SHORT-PART", name: "Field service part", tracking: "regular" });
    await send("item", { id: "system", sku: "SYSTEM", name: "Replacement system", tracking: "regular", equipment: "system" });
    await send("order", { id: "systems-po", type: "purchase", vendorId: "vendor", destinationId: "field",
      lines: [{ itemId: "system", quantity: 2 }] });
    await send("release", { orderId: "systems-po" });
    await send("receive", { orderId: "systems-po", lines: [{ itemId: "system", quantity: 2, serials: [] }] });
    const service = (await json("GET", "/api/service-types"))[0];
    const signaturePage = await context.newPage();
    const signatureData = await signaturePage.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 30;
      const ctx = canvas.getContext("2d"); ctx.beginPath(); ctx.moveTo(4, 20); ctx.lineTo(70, 6); ctx.stroke();
      return canvas.toDataURL("image/png");
    });
    await signaturePage.close();
    const orders = [];
    for (let index = 0; index < 2; index++) {
      const work = await json("POST", `${root}/work-orders`, { customerWoId: `SHORT-${index}`, serviceType: service.code,
        customerName: "Field use fixture", oldSystemId: `OLD-FIELD-${index}`, oldSystemReading: "1",
        status: "Open", assignedUserId: fixture.id });
      await send("prepareUse", { workOrderId: work.id, revision: 0, mode: "changeout",
        used: [{ itemId: "part", warehouseId: "field", quantity: index + 2, serials: [] },
          { itemId: "system", warehouseId: "field", quantity: 1, serials: [] }],
        dispositions: [{ equipment: "system", serial: `OLD-FIELD-${index}`, disposition: "returned", warehouseId: "field" }] });
      orders.push(work);
    }
    // Receive while both field-use declarations are open, then complete in
    // parallel against one available part. Database locks must retain both.
    await send("order", { id: "initial-part-po", type: "purchase", vendorId: "vendor", destinationId: "field",
      lines: [{ itemId: "part", quantity: 1 }] });
    await send("release", { orderId: "initial-part-po" });
    await send("receive", { orderId: "initial-part-po", lines: [{ itemId: "part", quantity: 1, serials: [] }] });
    await Promise.all(orders.map((work, index) => json("PATCH", `${root}/work-orders/${work.id}`, {
      status: "Completed", newSystemId: `NEW-FIELD-${index}`, newSystemReading: "0", signatureData, signatureName: "Fixture technician" })));
    await expect.poll(async () => (await json("GET", `${root}/changeout-reconciliation`)).jobs
      .filter(job => orders.some(work => work.id === job.workOrderId) && job.status === "succeeded").length,
    { timeout: 30000 }).toBe(orders.length);
    for (const work of orders) {
      assert.equal((await json("GET", `${root}/work-orders/${work.id}`)).status, "Completed");
      const detail = await json("GET", `${root}/work-orders/${work.id}/inventory`);
      assert.equal(detail.stockDiscrepancies.length, 1);
    }
    let state = await current();
    const first = state.stockDiscrepancies.find(value => value.workOrderId === orders[0].id);
    const second = state.stockDiscrepancies.find(value => value.workOrderId === orders[1].id);
    assert.equal(first.quantity + second.quantity, 4);
    assert.ok(state.stock.every(value => value.quantity >= 0));
    await send("order", { id: "correction-po", type: "purchase", vendorId: "vendor", destinationId: "field",
      lines: [{ itemId: "part", quantity: first.quantity }] });
    await send("release", { orderId: "correction-po" });
    await send("receive", { orderId: "correction-po", lines: [{ itemId: "part", quantity: first.quantity, serials: [] }] });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Stock discrepancies", exact: true }).click();
    await expect(page.getByTestId("stock-discrepancies")).toBeVisible();
    await fs.mkdir("generated-artifacts/field-stock-discrepancies", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/field-stock-discrepancies/1500.png" });
    const touch = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")(),
      hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, storageState: await context.storageState() });
    const phone = await touch.newPage();
    await phone.goto(`/projects/${fixture.projectId}/inventory`);
    await phone.getByTestId("inventory-mobile-menu").click();
    await phone.getByTestId("inventory-mobile-menu-item-stock-discrepancies").click();
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1180, height: 820 }]) {
      await phone.setViewportSize(size);
      await expect(phone.getByTestId("stock-discrepancies")).toBeVisible();
      await expect(phone.getByTestId(`stock-discrepancy-${first.id}`)).toBeVisible();
      assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const box = await phone.getByTestId("stock-discrepancies").locator("article").first().boundingBox();
      assert.ok(box.y < size.height - 64, "Compact tools must leave actual records visible without scrolling past instructions");
      await phone.screenshot({ path: `generated-artifacts/field-stock-discrepancies/${size.width}.png` });
    }
    await touch.close();
    await page.getByTestId("stock-discrepancy-search").fill("SHORT-0");
    await expect(page.getByTestId(`stock-discrepancy-${second.id}`)).toHaveCount(0);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV", exact: true }).click();
    const download = await downloadPromise, chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString("utf8");
    assert.ok(csv.includes("SHORT-0") && !csv.includes("SHORT-1"), "Export respects applied filters");
    await page.getByTestId("stock-discrepancy-search").clear();
    await page.getByTestId(`resolve-stock-discrepancy-${first.id}`).click();
    await page.getByTestId("discrepancy-resolution-reason").fill("Posted and verified the missing receiving transaction.");
    await page.getByTestId("discrepancy-resolution-evidence").fill("Receiving document TEST-100");
    await page.getByTestId("stock-discrepancy-resolution-dialog").locator('input[type="checkbox"]').first().check();
    await page.getByTestId("submit-stock-discrepancy-resolution").click();
    await expect(page.getByTestId("stock-discrepancy-resolution-dialog")).toHaveCount(0);
    state = await current();
    assert.equal(state.stockDiscrepancies.find(value => value.id === first.id).method, "apply_stock");
    assert.equal(state.stock.find(value => value.itemId === "part").quantity, 0);
    await page.getByTestId(`resolve-stock-discrepancy-${second.id}`).click();
    await page.getByTestId("discrepancy-method").click();
    await page.getByRole("option", { name: "Document evidenced accounting adjustment", exact: true }).click();
    await page.getByTestId("discrepancy-resolution-reason").fill("Investigated confirmed off-book parts used at the site.");
    await page.getByTestId("discrepancy-resolution-evidence").fill("Investigation TEST-101");
    await send("resolveStockDiscrepancy", { id: second.id, method: "documented_adjustment",
      reason: "Another reviewer verified the documented off-book usage.", evidence: "Case TEST-101", receiptIds: [] });
    await expect(page.getByTestId("submit-stock-discrepancy-resolution")).toBeDisabled({ timeout: 15000 });
    assert.equal(await page.getByTestId("discrepancy-resolution-evidence").inputValue(), "Investigation TEST-101");
    const viewer = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")() });
    await json("POST", "/api/auth/local/login", fixture.viewer, viewer);
    const forbidden = await viewer.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(),
      action: "resolveStockDiscrepancy", data: { id: second.id, method: "documented_adjustment", reason: "Viewer cannot authorize a correction.", evidence: "TEST-102" } } });
    assert.equal(forbidden.status(), 403);
    const final = await current();
    assert.ok(final.stockDiscrepancies.every(value => value.status === "resolved"));
    assert.equal(final.allocations.filter(value => value.status === "consumed").length, 2);
    assert.equal(final.stock.find(value => value.itemId === "part").quantity, 0);
    assert.deepEqual(errors, []);
    console.log("PASS field shortage completion, relational persistence, warehouse resolution, scoped export, same-user live conflict, permission denial, desktop/phone/landscape.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
