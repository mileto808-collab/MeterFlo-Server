// Real authenticated acceptance; all writes belong to the disposable UI fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = process.env.INVENTORY_UI_BASE || `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  let viewer;
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 950 } });
    assert.equal((await context.request.post("/api/auth/local/login", { data: { username: fixture.username, password: fixture.password } })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`, url = `/projects/${fixture.projectId}/inventory`;
    const state = async () => (await (await context.request.get(endpoint)).json()).state;
    const post = async (action, data, operationId = crypto.randomUUID(), status = 200, client = context) => {
      const response = await client.request.post(`${endpoint}/commands`, { data: { action, data, operationId } });
      assert.equal(response.status(), status, `${action}: ${await response.text()}`);
      return response.json();
    };
    for (const id of ["ship-main", "ship-van"]) await post("warehouse", { id, code: id.toUpperCase(), name: id,
      type: "physical", address: "Disposable shipment fixture", userIds: [fixture.viewer.id] });
    await post("vendor", { id: "ship-vendor", name: "Shipment supplier" });
    for (const [id, tracking] of [["ship-meter", "serialized"], ["ship-module", "serialized"], ["ship-bulk", "regular"]])
      await post("item", { id, sku: id.toUpperCase(), name: id, tracking });
    const order = async (id, lines, type = "purchase") => {
      await post("order", { id, type, lines, destinationId: type === "transfer" ? "ship-van" : "ship-main",
        ...(type === "transfer" ? { sourceId: "ship-main" } : { vendorId: "ship-vendor" }) });
      await post("release", { orderId: id });
    };
    await order("SHIP-PO", [{ itemId: "ship-meter", quantity: 5 }, { itemId: "ship-module", quantity: 1 }, { itemId: "ship-bulk", quantity: 5 }]);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(60000);
    const orders = () => page.getByRole("tab", { name: "Orders", exact: true }).click();
    const row = id => page.locator("div.rounded-lg.border.p-4").filter({ hasText: id });
    const receive = () => row("SHIP-PO").getByRole("button", { name: "Receive", exact: true }).click();
    await page.goto(url, { waitUntil: "domcontentloaded" }); await orders(); await receive();
    const dialog = page.getByRole("dialog", { name: /^Receive purchase/ });
    assert.equal(await dialog.getByRole("combobox").count(), 0);
    assert.equal(await dialog.getByRole("button", { name: "Add line", exact: true }).count(), 0);
    await dialog.locator("#ship-meter-goodQuantity").fill("2");
    await dialog.locator("#ship-module-goodQuantity").fill("1");
    await dialog.locator("#ship-meter-damagedQuantity").fill("1");
    await dialog.locator("#ship-meter-unreadableQuantity").fill("1");
    await dialog.locator("#ship-meter-damage-reason").fill("Crushed carton, one unreadable identity");
    await dialog.locator("#ship-bulk-goodQuantity").fill("2");
    await dialog.locator("#ship-bulk-damagedQuantity").fill("1");
    await dialog.locator("#ship-bulk-damage-reason").fill("Split package");
    const meter = dialog.getByRole("textbox", { name: "Good serial scanner for ship-meter", exact: true });
    const module = dialog.getByRole("textbox", { name: "Good serial scanner for ship-module", exact: true });
    const badMeter = dialog.getByRole("textbox", { name: "Known damaged serial scanner for ship-meter", exact: true });
    await meter.fill("X".repeat(101)); await meter.press("Enter");
    assert.equal((await meter.inputValue()).length, 101, "an overlong HID identity must not be silently truncated into another serial");
    await meter.fill("000501"); await meter.press("Enter");
    await meter.fill("000501"); await meter.press("Enter");
    await dialog.getByText("This serial is already in the movement.", { exact: true }).waitFor();
    assert.equal(await meter.inputValue(), "000501", "invalid scan is retained");
    await meter.fill("000502"); await meter.press("Tab");
    await badMeter.waitFor({ state: "visible" });
    assert.equal(await badMeter.evaluate(el => el === document.activeElement), true, "HID advances to the damaged serial entry");
    await badMeter.fill("000503"); await badMeter.press("Enter");
    assert.equal(await module.evaluate(el => el === document.activeElement), true, "HID advances to next eligible serialized product");
    await module.fill("000601");
    // Uncommitted raw scanner text participates in unload/dismissal protection.
    assert.equal(await page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }), true);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog.getByText("Discard movement edits?", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Stay", exact: true }).click();
    assert.equal(await module.inputValue(), "000601");
    await dialog.getByRole("button", { name: "Review movement", exact: true }).click();
    await dialog.getByText(/Commit each scanner entry/).waitFor();
    await module.press("Enter");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await dialog.getByRole("button", { name: "Review movement", exact: true }).scrollIntoViewIfNeeded();
    const mobileControls = await dialog.getByRole("button", { name: "Review movement", exact: true }).boundingBox();
    assert.ok(mobileControls.y >= 0 && mobileControls.y + mobileControls.height <= 844, "phone users can reach the review controls");
    await fs.mkdir("generated-artifacts/inventory", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory/shipment-mobile.jpg" });
    await page.setViewportSize({ width: 1280, height: 950 });
    await dialog.getByRole("button", { name: "Review movement", exact: true }).click();
    await page.screenshot({ path: "generated-artifacts/inventory/shipment-review-desktop.jpg" });
    // Let server commit, then lose its success response. Retry identical UUID.
    let lostOperation;
    const lose = async route => {
      const body = route.request().postDataJSON();
      if (body.action !== "receive" || body.data.orderId !== "SHIP-PO") return route.continue();
      lostOperation = body.operationId;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort("failed");
    };
    await page.route(`**${endpoint}/commands`, lose);
    await dialog.getByRole("button", { name: "Post movement", exact: true }).click();
    await dialog.getByText("Posting not confirmed", { exact: true }).waitFor();
    const committed = await state();
    assert.equal(committed.orders.find(o => o.id === "SHIP-PO").received.find(l => l.itemId === "ship-meter").quantity, 4);
    assert.equal(committed.shipmentHolds.filter(h => h.orderId === "SHIP-PO").length, 2);
    await page.unroute(`**${endpoint}/commands`, lose);
    const retry = page.waitForRequest(request => request.url().endsWith(`${endpoint}/commands`) && request.postDataJSON()?.action === "receive");
    await dialog.getByRole("button", { name: "Post movement", exact: true }).click();
    assert.equal((await retry).postDataJSON().operationId, lostOperation);
    await dialog.waitFor({ state: "hidden" });
    assert.deepEqual((await state()).stock, committed.stock, "lost-response retry cannot receive twice");
    assert.equal((await state()).receipts.filter(r => r.id === lostOperation).length, 1);
    // A NEW identical regular partial receipt is a fresh business operation.
    await order("SHIP-REPEAT", [{ itemId: "ship-bulk", quantity: 3 }]);
    for (let i = 0; i < 2; i++) {
      await page.reload(); await orders();
      await row("SHIP-REPEAT").getByRole("button", { name: "Receive", exact: true }).click();
      await dialog.locator("#ship-bulk-goodQuantity").fill("1");
      await dialog.getByRole("button", { name: "Review movement", exact: true }).click();
      await dialog.getByRole("button", { name: "Post movement", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
    }
    assert.equal((await state()).orders.find(o => o.id === "SHIP-REPEAT").received.reduce((sum, l) => sum + l.quantity, 0), 2);
    // Ordinary role grants must be selectable through the real administration API.
    viewer = await browser.newContext({ baseURL });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const grants = ["projects.view", "workOrders.view", "inventory.view", "inventory.receive"];
    const role = async permissions => assert.equal((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, { data: { permissions } })).status(), 200);
    await role(grants);
    const hold = committed.shipmentHolds.find(h => h.itemId === "ship-bulk");
    const closeData = { orderId: "SHIP-PO", reason: "Supplier short shipment" };
    await post("closeOrder", closeData, crypto.randomUUID(), 403, viewer);
    await post("receive", { orderId: "SHIP-PO", lines: [], closeRemainder: true, reason: "Attempt bypass" }, crypto.randomUUID(), 403, viewer);
    await post("resolveHold", { id: hold.id, outcome: "returned", reason: "RMA approved", reference: "Vendor / RMA-7" }, crypto.randomUUID(), 403, viewer);
    await role([...grants, "inventory.closeOrders", "inventory.resolveExceptions"]);
    await post("closeOrder", closeData, crypto.randomUUID(), 200, viewer);
    await post("resolveHold", { id: hold.id, outcome: "returned", reason: "RMA approved", reference: "Vendor / RMA-7" }, crypto.randomUUID(), 200, viewer);
    await post("resolveHold", { id: hold.id, outcome: "returned", reason: "Again", reference: "Vendor / RMA-7" }, crypto.randomUUID(), 409, viewer);
    const closed = (await state()).orders.find(o => o.id === "SHIP-PO");
    assert.deepEqual(closed.closure.unfulfilled.map(l => [l.itemId, l.quantity]), [["ship-meter", 1], ["ship-bulk", 2]]);
    const html = await (await context.request.get(`${endpoint}/print/order/SHIP-PO`)).text();
    assert.ok(html.includes("Closed with exceptions") && html.includes("Quarantined now") && html.includes("000503"));
    const receiptHTML = await (await context.request.get(`${endpoint}/print/receipt/${lostOperation}`)).text();
    assert.ok(receiptHTML.includes("Damaged / quarantined") && receiptHTML.includes("unidentified: 1"));
    // Real disposition UI can release unknown identities only after verification.
    await page.reload();
    await page.getByRole("tab", { name: "Shipment exceptions", exact: true }).click();
    const openHold = (await state()).shipmentHolds.find(h => h.itemId === "ship-meter");
    const holdCard = page.getByTestId(`shipment-hold-${openHold.id}`);
    await holdCard.getByRole("button", { name: "Resolve", exact: true }).click();
    const resolution = page.getByRole("dialog", { name: /Resolve shipment hold/ });
    await resolution.getByLabel("Resolution reason", { exact: true }).fill("Inspected labels; both units passed bench test");
    await resolution.getByLabel("Verified serial identities", { exact: true }).fill("000503\n000504");
    await resolution.press("Escape");
    await resolution.getByText("Discard inspection edits?", { exact: true }).waitFor();
    await resolution.getByRole("button", { name: "Stay", exact: true }).click();
    await resolution.getByRole("button", { name: "Record disposition", exact: true }).click();
    await resolution.waitFor({ state: "hidden" });
    assert.equal((await state()).shipmentHolds.find(h => h.id === openHold.id).status, "released");
    await page.screenshot({ path: "generated-artifacts/inventory/shipment-exceptions-desktop.jpg" });
    // Transfer arrival must physically scan only dispatched IDs, quarantine an
    // unreadable arrival using an explicit dispatch reference, then resolve loss.
    await order("SHIP-TR", [{ itemId: "ship-meter", quantity: 3 }, { itemId: "ship-bulk", quantity: 3 }], "transfer");
    await post("dispatch", { orderId: "SHIP-TR", lines: [
      { itemId: "ship-meter", quantity: 3, serials: ["000501", "000502", "000503"] },
      { itemId: "ship-bulk", quantity: 2 },
    ] });
    await page.reload(); await orders();
    await row("SHIP-TR").getByRole("button", { name: "Accept arrival", exact: true }).click();
    const arrival = page.getByRole("dialog", { name: /^Accept transfer arrival/ });
    await arrival.locator("#ship-meter-goodQuantity").fill("1");
    const arrivalScanner = arrival.getByRole("textbox", { name: "Good serial scanner for ship-meter", exact: true });
    assert.equal(await arrivalScanner.inputValue(), "");
    await arrivalScanner.fill("000501"); await arrivalScanner.press("Enter");
    await arrival.locator("#ship-meter-unreadableQuantity").fill("1");
    await arrival.getByRole("checkbox", { name: "000502", exact: true }).check();
    await arrival.locator("#ship-meter-damage-reason").fill("Crushed label; dispatch reference held for identity inspection");
    await arrival.locator("#ship-bulk-goodQuantity").fill("1");
    await arrival.getByRole("button", { name: "Review movement", exact: true }).click();
    await arrival.getByRole("button", { name: "Post movement", exact: true }).click();
    await arrival.waitFor({ state: "hidden" });
    const beforeLoss = await state();
    assert.deepEqual(beforeLoss.shipmentHolds.find(h => h.orderId === "SHIP-TR").expectedSerials, ["000502"]);
    await post("closeOrder", { orderId: "SHIP-TR", reason: "Cannot erase goods still in transit" }, crypto.randomUUID(), 409);
    await row("SHIP-TR").getByRole("button", { name: "Resolve transit loss", exact: true }).click();
    const loss = page.getByRole("dialog", { name: /^Resolve in-transit loss/ });
    await loss.locator("#loss-qty-ship-meter").fill("1");
    await loss.locator("#loss-scan-ship-meter").fill("000503");
    await loss.locator("#loss-scan-ship-meter").press("Enter");
    await loss.locator("#loss-qty-ship-bulk").fill("1");
    await loss.getByLabel("Loss resolution reason", { exact: true }).fill("Carrier confirmed carton loss; approved write-off");
    await loss.getByRole("button", { name: "Review write-off", exact: true }).click();
    await loss.getByRole("button", { name: "Confirm transit loss", exact: true }).click();
    await loss.waitFor({ state: "hidden" });
    assert.deepEqual((await state()).stock, beforeLoss.stock, "transit write-off neither invents arrival stock nor returns source stock");
    await row("SHIP-TR").getByRole("button", { name: "Close remainder", exact: true }).click();
    const closure = page.getByRole("dialog").filter({ has: page.getByLabel("Closure reason", { exact: true }) });
    await closure.getByLabel("Closure reason", { exact: true }).fill("Lost shipment resolved; cancel remaining unshipped units");
    await closure.getByRole("button", { name: "Confirm close with exceptions", exact: true }).click();
    await closure.waitFor({ state: "hidden" });
    assert.equal((await state()).orders.find(o => o.id === "SHIP-TR").status, "closed");
    assert.deepEqual(errors, []);
    console.log("Guided HID receiving, focus, mixed damage/unreadable custody, partials, retries, permissions, close-short, print, inspection, transfer-reference and transit-loss UI passed.");
  } finally { await viewer?.close(); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
