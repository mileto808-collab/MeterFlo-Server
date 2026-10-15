// Uses only the disposable project/accounts created by inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const admin = await browser.newContext({ baseURL });
    assert.equal((await admin.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const snapshot = async () => (await (await admin.request.get(endpoint)).json()).state;
    const send = (context, action, data, operationId = crypto.randomUUID()) => context.request.post(`${endpoint}/commands`, { data: { action, data, operationId } });
    const post = async (action, data) => {
      const response = await send(admin, action, data);
      assert.equal(response.status(), 200, await response.text());
    };
    for (const id of ["source", "destination"])
      await post("warehouse", { id, code: id.toUpperCase(), name: id, type: "physical", address: "Disposable test", userIds: [fixture.viewer.id] });
    await post("vendor", { id: "vendor", name: "Transfer fixture vendor" });
    await post("item", { id: "seal", sku: "TR-SEAL", name: "Transfer seal", tracking: "regular" });
    await post("order", { id: "seed", type: "purchase", vendorId: "vendor", destinationId: "source", lines: [{ itemId: "seal", quantity: 20 }] });
    await post("release", { orderId: "seed" });
    await post("receive", { orderId: "seed", lines: [{ itemId: "seal", quantity: 20 }] });
    const transfer = id => ({ id, type: "transfer", sourceId: "source", destinationId: "destination", lines: [{ itemId: "seal", quantity: 2 }] });
    await post("order", transfer("editable-transfer"));
    await post("release", { orderId: "editable-transfer" });
    await post("order", { id: "released-po", type: "purchase", vendorId: "vendor", destinationId: "destination", lines: [{ itemId: "seal", quantity: 1 }] });
    await post("release", { orderId: "released-po" });
    const setPermissions = async permissions => assert.equal((await admin.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, {
      data: { permissions: ["projects.view", "workOrders.view", "inventory.view", ...permissions] },
    })).status(), 200);
    await setPermissions(["inventory.purchase"]);
    const viewer = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    assert.equal((await send(viewer, "unrelease", { orderId: "editable-transfer" })).status(), 403, "purchase permission does not authorize a transfer");
    await setPermissions(["inventory.transfer"]);
    assert.equal((await send(viewer, "unrelease", { orderId: "released-po" })).status(), 403, "transfer permission does not authorize a PO");
    const page = await viewer.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Orders", exact: true }).click();
    const card = page.locator("div.rounded-lg.border.p-4").filter({ hasText: "editable-transfer" });
    const before = await snapshot(), original = before.orders.find(order => order.id === "editable-transfer");
    await card.getByRole("button", { name: "Un-release to draft", exact: true }).click();
    await card.getByRole("button", { name: "Edit draft", exact: true }).waitFor();
    await card.getByRole("button", { name: "Edit draft", exact: true }).click();
    const builder = page.getByTestId("inventory-order-dialog");
    await builder.getByLabel("Quantity for Transfer seal", { exact: true }).fill("4");
    await builder.getByRole("button", { name: "Save draft", exact: true }).click();
    await builder.waitFor({ state: "hidden" });
    await page.getByText(/^Order .+ saved as a draft/).waitFor();
    const edited = await snapshot(), changed = edited.orders.find(order => order.id === original.id);
    assert.equal(changed.orderNumber, original.orderNumber);
    assert.equal(changed.lines[0].quantity, 4);
    assert.equal(changed.status, "draft");
    assert.deepEqual(edited.stock, before.stock);
    assert.deepEqual(edited.receipts, before.receipts);
    await card.getByRole("button", { name: "Release", exact: true }).click();
    await card.getByRole("button", { name: "Dispatch", exact: true }).waitFor();
    await fs.mkdir("generated-artifacts/transfer-unrelease", { recursive: true });
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "generated-artifacts/transfer-unrelease/desktop.png" });
    const dispatch = await send(admin, "dispatch", { orderId: original.id, lines: [{ itemId: "seal", quantity: 1 }] });
    assert.equal(dispatch.status(), 200);
    assert.equal((await send(viewer, "unrelease", { orderId: original.id })).status(), 409, "posted transfers remain locked");
    await page.reload();
    await page.getByRole("tab", { name: "Orders", exact: true }).click();
    assert.equal(await card.getByRole("button", { name: "Un-release to draft", exact: true }).count(), 0);
    // The project lock makes competing dispatch/un-release commands exclusive.
    await post("order", transfer("race-transfer"));
    await post("release", { orderId: "race-transfer" });
    const race = await Promise.all([
      send(admin, "unrelease", { orderId: "race-transfer" }),
      send(admin, "dispatch", { orderId: "race-transfer", lines: [{ itemId: "seal", quantity: 1 }] }),
    ]);
    assert.deepEqual(race.map(response => response.status()).sort(), [200, 409]);
    assert.deepEqual(errors, []);
    console.log("Transfer un-release: normal role grants/denials, UI edit/release, identity and stock preservation, posted lock and concurrent dispatch passed.");
    await viewer.close(); await admin.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
