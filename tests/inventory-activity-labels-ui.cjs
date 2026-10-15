// Run only with the disposable project from tests/support/inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const send = async (action, data) => {
      const response = await context.request.post(`${endpoint}/commands`, {
        data: { operationId: crypto.randomUUID(), action, data },
      });
      assert.equal(response.status(), 200, await response.text());
      return (await response.json()).state;
    };
    for (const id of ["activity-source", "activity-destination"])
      await send("warehouse", { id, code: id.toUpperCase(), name: id, type: "physical", address: "Disposable fixture" });
    await send("vendor", { id: "activity-vendor", name: "Activity vendor" });
    await send("item", { id: "activity-seal", sku: "ACT-SEAL", name: "Activity seal", tracking: "regular" });
    const purchaseId = crypto.randomUUID(), transferId = crypto.randomUUID();
    const lines = [{ itemId: "activity-seal", quantity: 2 }];
    await send("order", { id: purchaseId, type: "purchase", vendorId: "activity-vendor", destinationId: "activity-source", lines });
    await send("release", { orderId: purchaseId });
    await send("receive", { orderId: purchaseId, lines });
    await send("order", { id: transferId, type: "transfer", sourceId: "activity-source", destinationId: "activity-destination", lines });
    await send("release", { orderId: transferId });
    await send("dispatch", { orderId: transferId, lines });
    const before = await send("accept", { orderId: transferId, lines });
    const purchase = before.orders.find(order => order.id === purchaseId);
    const transfer = before.orders.find(order => order.id === transferId);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    const titles = page.getByTestId("inventory-activity-title");
    await titles.first().waitFor();
    const displayed = await titles.allTextContents();
    for (const [action, order] of [["receive", purchase], ["dispatch", transfer], ["accept", transfer]]) {
      assert.ok(displayed.includes(`${action} · ${order.orderNumber}`), `${action} displays readable order number`);
      assert.ok(!displayed.some(text => text.includes(order.id)), "Title does not expose internal order UUID");
    }
    const popupPromise = page.waitForEvent("popup");
    await page.getByTestId("inventory-activity-entries").getByRole("button", { name: "Print", exact: true }).first().click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    assert.ok((await popup.locator("body").innerText()).includes(transfer.orderNumber), "Print still resolves the transfer");
    const receipt = before.receipts.find(receipt => receipt.action === "accept" && receipt.reference === transferId);
    assert.ok(popup.url().includes(encodeURIComponent(receipt.id)), "Print uses the immutable receipt ID");
    await popup.close();
    const after = (await (await context.request.get(endpoint)).json()).state;
    assert.deepEqual(after.receipts, before.receipts, "Displaying labels never rewrites receipt references");
    await fs.mkdir("generated-artifacts/inventory-activity", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory-activity/readable-order-labels.jpg" });
    assert.deepEqual(errors, []);
    console.log("Activity uses readable PO/transfer numbers for receive, dispatch and accept; print links and stored references preserved.");
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
