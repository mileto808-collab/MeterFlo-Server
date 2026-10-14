const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const base = process.env.INVENTORY_UI_BASE || `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: base });
    const login = await context.request.post("/api/auth/local/login", { data: { username: fixture.username, password: fixture.password } });
    assert.equal(login.status(), 200);
    const limited = await browser.newContext({ baseURL: base });
    const limitedLogin = await limited.request.post("/api/auth/local/login", { data: { username: fixture.viewer.username, password: fixture.viewer.password } });
    assert.equal(limitedLogin.status(), 200);
    const denied = await limited.request.get(`/api/projects/${fixture.projectId}/mobile/sync/download`);
    assert.equal(denied.status(), 403);
    assert.match((await denied.json()).message, /Inventory view permission/);
    assert.equal((await limited.request.get(`/api/projects/${fixture.projectId}/inventory`)).status(), 403);
    await limited.close();
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const commands = async (action, data) => {
      const res = await context.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
      assert.equal(res.status(), 200, `${action}: ${await res.text()}`); return res.json();
    };
    const permissions = await (await context.request.get("/api/permissions")).json();
    assert.ok(permissions.some(p => p.key === "inventory.configure"));
    await commands("warehouse", { id: "main", code: "MAIN", name: "Main warehouse", type: "physical", address: "100 Test Way" });
    await commands("warehouse", { id: "van", code: "VAN12", name: "Service van 12", type: "vehicle", vin: "1HGCM82633A004352", plate: "ABC123", plateState: "CO", assignedUserId: fixture.id });
    const invalid = await context.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action: "warehouse", data: { id: "bad", code: "bad", name: "Bad vehicle", type: "vehicle" } } });
    assert.equal(invalid.status(), 400);
    await commands("vendor", { id: "v", name: "Test supplier" });
    await commands("item", { id: "meter", sku: "E460", name: "Test meter", tracking: "serialized", equipment: "system" });
    await commands("item", { id: "seal", sku: "SEAL", name: "Seal", tracking: "regular" });
    await commands("order", { id: "PO-FIXTURE", type: "purchase", vendorId: "v", destinationId: "main", lines: [{ itemId: "meter", quantity: 2 }, { itemId: "seal", quantity: 20 }] });
    await commands("release", { orderId: "PO-FIXTURE" });
    await commands("receive", { orderId: "PO-FIXTURE", lines: [{ itemId: "meter", quantity: 2, serials: ["0000456", "0000457"] }, { itemId: "seal", quantity: 20 }] });
    const settings = await context.request.patch(`/api/projects/${fixture.projectId}`, { data: { changeoutEquipmentType: "system" } });
    assert.equal(settings.status(), 200);
    const created = await context.request.post(`/api/projects/${fixture.projectId}/work-orders`, { data: {
      customerWoId: "INVENTORY-UI-WO", customerId: "UI-CUSTOMER", customerName: "Inventory fixture", address: "100 Test Way",
      serviceType: "Electric", oldSystemId: "OLD-UI", assignedUserId: fixture.id,
    } });
    assert.equal(created.status(), 201, await created.text());
    const wo = await created.json();
    await commands("assign", { workOrderId: wo.id, lines: [{ itemId: "meter", warehouseId: "main", quantity: 1, serials: ["0000456"] }] });
    const synced = await context.request.get(`/api/projects/${fixture.projectId}/mobile/sync/download`);
    assert.equal(synced.status(), 200);
    const downloaded = await synced.json();
    assert.equal(downloaded.inventory.enabled, true);
    assert.equal(downloaded.workOrders.find(row => row.id === wo.id)?.inventoryAllocation.status, "reserved");
    const usage = { operationId: crypto.randomUUID(), revision: 1, mode: "changeout",
      used: [{ itemId: "meter", warehouseId: "main", quantity: 1, serials: ["0000456"] }],
      dispositions: [{ equipment: "system", serial: "OLD-UI", disposition: "left_onsite", warehouseId: null }] };
    const completed = await context.request.post(`/api/mobile/projects/${fixture.projectId}/work-orders/${wo.id}/complete`, { data: {
      canChange: true, oldSystemReading: "1.00", newSystemReading: "0.00", newSystemId: "0000456", inventoryUsage: usage,
    } });
    assert.equal(completed.status(), 200, await completed.text());
    assert.equal((await completed.json()).workOrder.status, "Completed");
    const repeated = await context.request.post(`/api/mobile/projects/${fixture.projectId}/work-orders/${wo.id}/complete`, { data: {
      canChange: true, oldSystemReading: "1.00", newSystemReading: "0.00", newSystemId: "0000456", inventoryUsage: usage,
    } });
    assert.equal(repeated.status(), 200, await repeated.text());
    const snapshot = await (await context.request.get(endpoint)).json();
    assert.equal(snapshot.state.allocations.find(a => a.workOrderId === wo.id).status, "consumed");
    assert.equal(snapshot.state.stock.find(b => b.itemId === "meter").quantity, 1);
    const print = await context.request.get(`${endpoint}/print/order/PO-FIXTURE`);
    assert.equal(print.status(), 200); assert.match(await print.text(), /PO-FIXTURE/);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("heading", { name: "Inventory", exact: true }).waitFor();
    await page.getByText("0000457", { exact: false }).first().waitFor();
    await page.getByRole("tab", { name: "Locations", exact: true }).click();
    assert.match(await page.locator("main").last().innerText(), /Service van 12/);
    await page.getByRole("tab", { name: /Count/ }).click();
    await page.getByRole("tab", { name: /Stock/ }).click();
    await fs.mkdir("generated-artifacts/inventory", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory/desktop.jpg", fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "generated-artifacts/inventory/mobile.jpg", fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2), false);
    const stockTable = page.locator("table").first();
    const stockScroller = stockTable.locator("..");
    assert.equal(await stockScroller.evaluate(el => el.scrollWidth > el.clientWidth), true);
    await stockScroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    assert.equal(await stockScroller.evaluate(el => el.scrollLeft > 0), true);
    assert.deepEqual(errors, []);
    console.log("Inventory authenticated desktop/mobile UI, real posting endpoints, registered permission and print checks passed.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
