// Uses only the disposable project/accounts from tests/support/inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const output = "generated-artifacts/order-discovery";
  await fs.mkdir(output, { recursive: true });
  try {
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const snapshot = async () => (await (await context.request.get(endpoint)).json()).state;
    const command = async (action, data, operationId = crypto.randomUUID()) => {
      const response = await context.request.post(`${endpoint}/commands`, { data: { action, data, operationId } });
      assert.equal(response.status(), 200, await response.text());
      return (await response.json()).state;
    };
    for (const id of ["main", "van"]) await command("warehouse", {
      id, code: id.toUpperCase(), name: id === "main" ? "Discovery warehouse" : "Discovery vehicle",
      type: "physical", address: "Disposable fixture",
    });
    await command("vendor", { id: "supplier", name: "Discovery supplier" });
    await command("item", { id: "meter", sku: "000701", name: "Discovery meter", tracking: "regular" });
    const initial = await snapshot();
    const errors = [], page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.goto(`/projects/${fixture.projectId}/inventory`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.getByRole("tab", { name: "Orders", exact: true }).click();
    const header = page.getByTestId("inventory-orders-subheader");
    const search = header.getByRole("searchbox", { name: "Search orders", exact: true });
    const editor = page.getByTestId("inventory-page-editor");
    const card = () => page.getByTestId("inventory-order-card");
    const choose = async (control, name) => {
      await control.click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    await header.getByRole("button", { name: "Build an order draft", exact: true }).click();
    await choose(editor.getByRole("combobox").nth(1), "MAIN · Discovery warehouse");
    await choose(editor.getByRole("combobox").nth(2), "Discovery supplier");
    await choose(editor.getByRole("combobox").nth(3), "000701 · Discovery meter");
    await editor.getByRole("button", { name: "Add line", exact: true }).click();
    await editor.getByLabel("Supplier/customer reference", { exact: true }).fill("DISCOVERY-INITIAL");
    await expect(editor).toContainText("Assigned automatically when saved");
    // Commit the request but lose its response. A reference correction must edit
    // that same order, not create a different identity or consume another number.
    let lostId;
    await page.route(`**${endpoint}/commands`, async route => {
      const input = route.request().postDataJSON();
      if (input.action === "order" && !lostId) {
        const response = await route.fetch();
        assert.equal(response.status(), 200);
        lostId = input.data.id;
        await route.abort("failed");
      } else await route.continue();
    });
    await editor.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(editor).toContainText("Order draft not saved or not confirmed");
    const committed = (await snapshot()).orders.find(order => order.id === lostId);
    assert.ok(committed?.orderNumber);
    await editor.getByLabel("Supplier/customer reference", { exact: true }).fill("DISCOVERY-CORRECTED");
    await editor.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(editor).toBeHidden();
    await page.unroute(`**${endpoint}/commands`);
    let state = await snapshot();
    assert.equal(state.orders.length, initial.orders.length + 1);
    let purchase = state.orders.find(order => order.id === lostId);
    assert.equal(purchase.orderNumber, committed.orderNumber);
    assert.equal(purchase.reference, "DISCOVERY-CORRECTED");
    assert.deepEqual(state.stock, initial.stock);
    for (const query of [purchase.orderNumber.toLowerCase(), purchase.id, purchase.reference, "000701",
      "Discovery meter", "Discovery supplier", "MAIN", "Discovery warehouse"]) {
      await search.fill(query);
      await expect(card()).toHaveCount(1);
      await expect(card()).toContainText(purchase.orderNumber);
    }
    await header.getByRole("button", { name: "Filters", exact: true }).click();
    const filters = page.getByRole("dialog", { name: "Filter orders", exact: true });
    await choose(filters.getByRole("combobox", { name: "Order type", exact: true }), "Transfer");
    await expect(filters).toContainText("0 of 1 orders");
    await filters.getByRole("button", { name: "Reset filters", exact: true }).click();
    await choose(filters.getByRole("combobox", { name: "Order type", exact: true }), "Purchase");
    await choose(filters.getByRole("combobox", { name: "Order status", exact: true }), "Draft");
    await choose(filters.getByRole("combobox", { name: "Vendor filter", exact: true }), "Discovery supplier");
    await choose(filters.getByRole("combobox", { name: "Destination filter", exact: true }), "Discovery warehouse · MAIN");
    await expect(filters).toContainText("1 of 1 orders");
    await filters.getByLabel("From date", { exact: true }).fill("2099-01-02");
    await filters.getByLabel("To date", { exact: true }).fill("2000-01-01");
    await expect(filters.getByRole("alert")).toBeVisible();
    await filters.getByRole("button", { name: "Reset filters", exact: true }).click();
    for (const sort of ["Oldest first", "Order number", "Newest first"])
      await choose(filters.getByRole("combobox", { name: "Sort orders", exact: true }), sort);
    await page.keyboard.press("Escape");
    await search.fill(purchase.orderNumber);
    // Editing/back navigation preserves filter context and unsaved guards.
    await card().getByRole("button", { name: "Edit draft", exact: true }).click();
    await expect(editor).toContainText(purchase.orderNumber);
    await editor.getByRole("textbox", { name: "Order notes", exact: true }).fill("Keep my local order notes");
    await editor.getByTestId("inventory-editor-back").click();
    const unsaved = page.getByRole("dialog", { name: "Unsaved order changes", exact: true });
    await unsaved.getByRole("button", { name: "Stay", exact: true }).click();
    await expect(editor.getByRole("textbox", { name: "Order notes", exact: true })).toHaveValue("Keep my local order notes");
    await editor.getByTestId("inventory-editor-back").click();
    await unsaved.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(search).toHaveValue(purchase.orderNumber);
    // Exercise actual shipment controls, preserving transport IDs and print links.
    const ship = async (action, itemId) => {
      const title = action === "Receive" ? "Receive purchase" : action === "Dispatch" ? "Dispatch transfer" : "Accept transfer arrival";
      await card().getByRole("button", { name: action, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: new RegExp(`^${title}`) });
      await expect(dialog).toBeVisible();
      await dialog.locator(`[id="${itemId}-goodQuantity"]`).fill("1");
      await dialog.getByRole("button", { name: "Review movement", exact: true }).click();
      await dialog.getByRole("button", { name: "Post movement", exact: true }).click();
      await expect(dialog).toBeHidden();
    };
    await card().getByRole("button", { name: "Release", exact: true }).click();
    await expect(card()).toContainText("released");
    await ship("Receive", "meter");
    state = await command("order", { id: crypto.randomUUID(), type: "transfer", sourceId: "main", destinationId: "van",
      reference: "DISCOVERY-TRANSFER", lines: [{ itemId: "meter", quantity: 1 }] });
    const transfer = state.orders.find(order => order.reference === "DISCOVERY-TRANSFER");
    assert.notEqual(transfer.orderNumber, purchase.orderNumber);
    await header.getByRole("button", { name: "Refresh orders", exact: true }).click();
    await search.fill(transfer.orderNumber);
    await expect(card()).toHaveCount(1);
    await card().getByRole("button", { name: "Release", exact: true }).click();
    await ship("Dispatch", "meter");
    await ship("Accept arrival", "meter");
    state = await snapshot();
    assert.equal(state.orders.find(order => order.id === transfer.id).status, "completed");
    assert.equal(state.stock.find(stock => stock.warehouseId === "van" && stock.itemId === "meter").quantity, 1);
    for (const order of [purchase, transfer]) {
      const response = await context.request.get(`${endpoint}/print/order/${encodeURIComponent(order.id)}`);
      assert.equal(response.status(), 200);
      const html = await response.text();
      assert.ok(html.includes(order.orderNumber) && html.includes(order.reference));
      for (const receipt of state.receipts.filter(receipt => receipt.reference === order.id)) {
        const printed = await context.request.get(`${endpoint}/print/receipt/${receipt.id}`);
        assert.equal(printed.status(), 200);
        assert.ok((await printed.text()).includes(order.orderNumber));
      }
    }
    await page.screenshot({ path: `${output}/desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileTools = header.getByTestId("inventory-mobile-tools-orders-toggle");
    if (await mobileTools.isVisible() && await mobileTools.getAttribute("aria-expanded") === "false") await mobileTools.click();
    await search.fill("discovery-transfer");
    await expect(card()).toHaveCount(1);
    await expect(card()).toContainText(transfer.orderNumber);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    const bounds = await card().evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
    assert.ok(bounds.content <= bounds.width + 1, JSON.stringify(bounds));
    await page.screenshot({ path: `${output}/phone.png` });
    await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, {
      data: { permissions: ["projects.view", "workOrders.view", "inventory.view"] },
    }).then(response => assert.equal(response.status(), 200));
    const viewer = await browser.newContext({ baseURL });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    assert.equal((await viewer.request.get(endpoint)).status(), 200);
    for (const action of ["numberOrders", "order"])
      assert.equal((await viewer.request.post(`${endpoint}/commands`, { data: {
        action, data: {}, operationId: crypto.randomUUID(),
      } })).status(), 403);
    await viewer.close();
    assert.deepEqual(errors, []);
    console.log("PASS: readable numbers, lost-save/reference identity, combined discovery, unsaved guards, purchase/transfer shipment UI, prints, desktop/phone and normal role permissions.");
  } catch (error) {
    await context.pages()[0]?.screenshot({ path: `${output}/failure.png` });
    throw error;
  } finally { await context.close(); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
