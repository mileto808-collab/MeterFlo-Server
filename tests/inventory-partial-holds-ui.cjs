// Real API/browser acceptance, using only the disposable inventory UI fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const baseURL = process.env.INVENTORY_UI_BASE || `https://${process.env.REPLIT_DEV_DOMAIN}`;
    const context = await browser.newContext({ baseURL,
      viewport: { width: 1280, height: 950 } });
    assert.equal((await context.request.post("/api/auth/local/login", {
      data: { username: fixture.username, password: fixture.password },
    })).status(), 200);
    const base = `/api/projects/${fixture.projectId}/inventory`;
    const snapshot = async () => (await (await context.request.get(base)).json()).state;
    const post = async (action, data, status = 200, client = context) => {
      const response = await client.request.post(`${base}/commands`, { data: { action, data, operationId: crypto.randomUUID() } });
      assert.equal(response.status(), status, `${action}: ${await response.text()}`);
    };
    for (const id of ["partial-main", "partial-van"]) await post("warehouse", { id, code: id.toUpperCase(), name: id,
      type: "physical", address: "Disposable fixture", userIds: [fixture.viewer.id] });
    await post("vendor", { id: "partial-vendor", name: "Partial supplier" });
    for (const [id, tracking] of [["partial-meter", "serialized"], ["partial-bulk", "regular"]])
      await post("item", { id, sku: id, name: id, tracking });
    await post("order", { id: "PARTIAL-PO", type: "purchase", destinationId: "partial-main", vendorId: "partial-vendor",
      lines: [{ itemId: "partial-meter", quantity: 4 }, { itemId: "partial-bulk", quantity: 6 }] });
    await post("release", { orderId: "PARTIAL-PO" });
    await post("receive", { orderId: "PARTIAL-PO", lines: [], damaged: [
      { itemId: "partial-meter", quantity: 4, serials: ["PH-0001", "PH-0002"], unidentifiedQuantity: 2, reason: "Crushed meters" },
      { itemId: "partial-bulk", quantity: 6, reason: "Wet seals" },
    ] });
    const initial = await snapshot(), hold = initial.shipmentHolds.find(h => h.itemId === "partial-meter");
    const bulk = initial.shipmentHolds.find(h => h.itemId === "partial-bulk");
    const page = await context.newPage(), errors = [], commands = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (request.url().endsWith(`${base}/commands`)) commands.push(request.postDataJSON());
    });
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(60000);
    await page.goto(`/projects/${fixture.projectId}/inventory`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Shipment exceptions", exact: true }).click();
    const card = id => page.getByTestId(`shipment-hold-${id}`);
    const dialog = page.getByRole("dialog", { name: "Resolve shipment hold", exact: true });
    const open = async id => { await card(id).getByRole("button", { name: "Resolve", exact: true }).click(); };
    const quantity = value => dialog.locator("#shipment-disposition-quantity").fill(String(value));
    const unknown = value => dialog.locator("#shipment-unidentified-quantity").fill(String(value));
    const reason = value => dialog.getByLabel("Resolution reason", { exact: true }).fill(value);
    const outcome = async label => {
      await dialog.getByRole("combobox").click();
      await page.getByRole("option", { name: label, exact: true }).click();
    };
    const record = async () => {
      await dialog.getByRole("button", { name: "Record disposition", exact: true }).click();
      await dialog.waitFor({ state: "detached" });
    };
    await open(hold.id);
    await quantity(1);
    await dialog.getByRole("checkbox", { name: "PH-0002", exact: true }).uncheck();
    await unknown(0);
    await dialog.getByLabel("Verified serial identities", { exact: true }).fill("PH-0001");
    await reason("One inspected meter passed");
    // Partial selection itself is protected by the normal dirty-dismiss prompt.
    await dialog.press("Escape");
    await dialog.getByText("Discard inspection edits?", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Stay", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await fs.mkdir("generated-artifacts/inventory", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory/partial-inspection-phone.jpg" });
    await page.setViewportSize({ width: 1280, height: 950 });
    let lost;
    const loseResponse = async route => {
      if (route.request().postDataJSON().action !== "resolveHold") return route.continue();
      lost = route.request().postDataJSON();
      assert.equal((await route.fetch()).status(), 200);
      await route.abort("failed");
    };
    await page.route(`**${base}/commands`, loseResponse);
    await dialog.getByRole("button", { name: "Record disposition", exact: true }).click();
    await dialog.getByText(/original hold remains unchanged/).waitFor();
    await page.unroute(`**${base}/commands`, loseResponse);
    assert.equal((await snapshot()).shipmentHolds.find(h => h.id === hold.id).dispositions.length, 1);
    assert.equal(await dialog.getByLabel("Verified serial identities", { exact: true }).inputValue(), "PH-0001");
    await record();
    assert.deepEqual(commands.filter(c => c.action === "resolveHold").at(-1), lost);
    let current = await snapshot();
    assert.equal(current.shipmentHolds.find(h => h.id === hold.id).dispositions.length, 1);
    assert.equal(current.stock.find(s => s.itemId === "partial-meter").quantity, 1);
    assert.deepEqual(current.orders.find(o => o.id === "PARTIAL-PO").received, initial.orders[0].received);
    await card(hold.id).getByText(/3 held/).waitFor();

    // A single unidentified purchase unit can be physically returned; others stay.
    await open(hold.id); await outcome("Record physical return"); await quantity(1); await unknown(1);
    await dialog.getByRole("checkbox", { name: "PH-0002", exact: true }).uncheck();
    await dialog.getByLabel("Return destination / reference", { exact: true }).fill("Vendor RMA-101");
    await reason("One unreadable unit returned"); await record();
    await card(hold.id).getByText(/2 held/).waitFor();
    await open(hold.id); await quantity(1); await unknown(1);
    await dialog.getByRole("checkbox", { name: "PH-0002", exact: true }).uncheck();
    await dialog.getByLabel("Verified serial identities", { exact: true }).fill("PH-0003");
    await reason("Cleaned and verified label"); await record();
    await open(hold.id); await outcome("Scrap / write off");
    await reason("Last meter destroyed"); await record();
    current = await snapshot();
    assert.equal(current.shipmentHolds.find(h => h.id === hold.id).status, "resolved");
    assert.ok(current.serialOccupancy.some(s => s.serial === "PH-0002" && s.workOrderId === null));
    const unchangedReceipt = current.receipts.find(r => r.id === hold.receiptId);
    assert.deepEqual(unchangedReceipt, initial.receipts.find(r => r.id === hold.receiptId));

    // Identical later regular batches are new actions, not replayed old releases.
    for (let n = 0; n < 2; n++) {
      await open(bulk.id); await quantity(2); await reason("Two seals passed inspection"); await record();
    }
    await open(bulk.id); await outcome("Record physical return"); await quantity(1);
    await dialog.getByLabel("Return destination / reference", { exact: true }).fill("RMA-bulk");
    await reason("One seal returned"); await record();
    await open(bulk.id); await outcome("Scrap / write off"); await reason("Last seal unusable"); await record();
    current = await snapshot();
    assert.equal(current.stock.find(s => s.itemId === "partial-bulk").quantity, 4);
    assert.equal(current.shipmentHolds.find(h => h.id === bulk.id).dispositions.length, 4);
    const releases = commands.filter(c => c.action === "resolveHold" && c.data.id === bulk.id && c.data.outcome === "released");
    assert.equal(releases.length, 2);
    assert.notEqual(releases[0].operationId, releases[1].operationId);
    const print = await context.request.get(`${base}/print/order/PARTIAL-PO`);
    assert.equal(print.status(), 200);
    const html = await print.text();
    assert.ok(html.includes("Remaining quarantined: 0"));
    assert.ok(html.includes("Vendor RMA-101"));
    for (const event of current.shipmentHolds.find(h => h.id === hold.id).dispositions) {
      assert.ok(html.includes(event.operationId));
      const receiptPrint = await context.request.get(`${base}/print/receipt/${event.operationId}`);
      assert.equal(receiptPrint.status(), 200);
      assert.ok((await receiptPrint.text()).includes("covers 1 units only"));
    }
    // Transfer references select unidentified custody, not fabricated identities.
    await post("order", { id: "PARTIAL-TR", type: "transfer", sourceId: "partial-main", destinationId: "partial-van",
      lines: [{ itemId: "partial-meter", quantity: 2 }] });
    await post("release", { orderId: "PARTIAL-TR" });
    await post("dispatch", { orderId: "PARTIAL-TR",
      lines: [{ itemId: "partial-meter", quantity: 2, serials: ["PH-0001", "PH-0003"] }] });
    await post("accept", { orderId: "PARTIAL-TR", lines: [], damaged: [{ itemId: "partial-meter", quantity: 2,
      unidentifiedQuantity: 2, expectedSerials: ["PH-0001", "PH-0003"], reason: "Unreadable transfer labels" }] });
    const arrival = (await snapshot()).shipmentHolds.find(h => h.orderId === "PARTIAL-TR");
    await page.reload(); await page.getByRole("tab", { name: "Shipment exceptions", exact: true }).click();
    await open(arrival.id); await quantity(1); await unknown(1);
    await dialog.getByRole("checkbox", { name: "PH-0003", exact: true }).uncheck();
    await dialog.getByLabel("Verified serial identities", { exact: true }).fill("PH-0003");
    await reason("Transfer identity verified");
    await dialog.getByRole("button", { name: "Record disposition", exact: true }).click();
    await dialog.getByText(/Verified identities must match/).waitFor();
    await dialog.getByLabel("Verified serial identities", { exact: true }).fill("PH-0001");
    await record();
    const remainingArrival = (await snapshot()).shipmentHolds.find(h => h.id === arrival.id);
    assert.equal(remainingArrival.dispositions.length, 1);
    assert.deepEqual(remainingArrival.dispositions[0].expectedSerials, ["PH-0001"]);
    await card(arrival.id).getByText(/1 held/).waitFor();
    // Two inspectors cannot both dispose the same still-held reference.
    const concurrent = { id: arrival.id, outcome: "scrapped", quantity: 1, unidentifiedQuantity: 1,
      expectedSerials: ["PH-0003"], reason: "Damaged label and unit destroyed" };
    const races = await Promise.all([0, 1].map(() => context.request.post(`${base}/commands`, {
      data: { action: "resolveHold", data: concurrent, operationId: crypto.randomUUID() },
    })));
    assert.deepEqual(races.map(response => response.status()).sort(), [200, 409]);
    const afterRace = (await snapshot()).shipmentHolds.find(h => h.id === arrival.id);
    assert.equal(afterRace.dispositions.length, 2);
    // Existing real role management must gate the partial command, not just UI.
    const permissions = ["projects.view", "workOrders.view", "inventory.view", "inventory.receive"];
    assert.equal((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, {
      data: { permissions },
    })).status(), 200);
    const viewer = await browser.newContext({ baseURL });
    assert.equal((await viewer.request.post("/api/auth/local/login", {
      data: { username: fixture.viewer.username, password: fixture.viewer.password },
    })).status(), 200);
    await post("resolveHold", { id: hold.id, outcome: "released", quantity: 1, serials: ["PH-0001"],
      verifiedSerials: ["PH-0001"], reason: "Unauthorized" }, 403, viewer);
    // Full authorized history is queryable under the original posting identity.
    const audit = await context.request.get(`/api/audit?projectId=${fixture.projectId}&q=${lost.operationId}`);
    assert.equal(audit.status(), 200);
    assert.ok((await audit.json()).total > 0, "partial disposition is audited");
    assert.deepEqual(errors, []);
    console.log("Partial inspection UI passed: subset custody, serial verification, regular goods, lost-response retry, new identical batches, print, audit, permission gates and phone layout.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
