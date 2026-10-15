// Uses only the disposable project/user made by tests/support/inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = process.env.INVENTORY_UI_BASE || `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  let context, otherProject;
  try {
    context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
    assert.equal((await context.request.post("/api/auth/local/login", { data: { username: fixture.username, password: fixture.password } })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const inventoryURL = `/projects/${fixture.projectId}/inventory`;
    const state = async () => (await (await context.request.get(endpoint)).json()).state;
    const command = async (action, data) => {
      const response = await context.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
      assert.equal(response.status(), 200, `${action}: ${await response.text()}`);
      return (await response.json()).state;
    };
    for (const id of ["order-main", "order-van"])
      await command("warehouse", { id, code: id.toUpperCase(), name: id, type: "physical", address: "Fixture only", userIds: [fixture.viewer.id] });
    await command("vendor", { id: "order-vendor", name: "Order supplier" });
    await command("item", { id: "order-bulk", sku: "ORDER-BULK", name: "Order bulk", tracking: "regular" });
    await command("item", { id: "order-serial", sku: "ORDER-SERIAL", name: "Order meter", tracking: "serialized" });
    const seedId = `ORDER-SEED-${crypto.randomUUID()}`;
    await command("order", { id: seedId, type: "purchase", destinationId: "order-main", vendorId: "order-vendor",
      lines: [{ itemId: "order-bulk", quantity: 20 }] });
    await command("release", { orderId: seedId });
    await command("receive", { orderId: seedId, lines: [{ itemId: "order-bulk", quantity: 20 }] });
    const order = (id, type) => ({ id, type, destinationId: type === "purchase" ? "order-main" : "order-van",
      sourceId: type === "transfer" ? "order-main" : null, vendorId: type === "purchase" ? "order-vendor" : null,
      lines: [{ itemId: "order-bulk", quantity: 2, serials: [] }], notes: `${id} saved notes` });
    await command("order", order("ORDER-PO", "purchase"));
    await command("order", order("ORDER-TR", "transfer"));
    const originalStock = (await state()).stock;
    const second = await context.request.post("/api/projects", { data: { name: `Order navigation fixture ${fixture.projectId}`, inventoryEnabled: true } });
    assert.equal(second.status(), 201);
    otherProject = (await second.json()).id;
    const otherURL = `/projects/${otherProject}/inventory`;
    const page = await context.newPage(), errors = [], posted = [];
    page.setDefaultTimeout(15000);
    page.on("pageerror", e => errors.push(e.message));
    page.on("request", r => { if (r.url().endsWith(`${endpoint}/commands`)) posted.push(r.postDataJSON()); });
    const builder = page.locator("fieldset");
    const notes = page.getByLabel("Order notes", { exact: true });
    const reference = page.getByLabel("Order ID / reference", { exact: true });
    const warning = page.getByRole("dialog", { name: "Unsaved order changes", exact: true });
    const countWarning = page.getByRole("dialog", { name: "Unsaved count changes", exact: true });
    const spa = url => page.evaluate(url => window.history.pushState({}, "", url), url);
    const unload = async dirty => assert.equal(await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), dirty, "Unload protection matches unsaved values");
    const choose = async name => {
      await warning.getByRole("button", { name, exact: true }).click();
      if (name !== "Save draft") await warning.waitFor({ state: "hidden" });
    };
    const ordersTab = () => page.getByRole("tab", { name: "Orders", exact: true }).click();
    const edit = id => page.locator("div.rounded-lg.border.p-4").filter({ hasText: id }).getByRole("button", { name: "Edit draft", exact: true }).click();
    const select = async (index, name) => {
      await builder.getByRole("combobox").nth(index).click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    const saved = async () => {
      await page.getByText(/^Order ID .+ saved as a draft\./).waitFor();
      await unload(false);
    };

    // Defaults and fully reverted changes are clean. Header-only and unadded
    // line edits, including invalid quantities and serial text, are not.
    await page.goto("/projects");
    await spa(inventoryURL);
    await ordersTab();
    await unload(false);
    await reference.fill("Header only");
    await unload(true);
    await reference.fill("");
    await notes.fill("Notes only");
    await unload(true);
    await notes.fill("");
    await unload(false);
    await select(0, "Transfer");
    await unload(true);
    await select(0, "Purchase");
    await select(1, "ORDER-MAIN · order-main");
    await unload(true);
    await select(2, "Order supplier");
    await select(3, "ORDER-SERIAL · Order meter");
    await builder.locator('input[type="number"]').fill("0");
    assert.equal(await builder.getByPlaceholder("One serial per line").count(), 0, "PO planning never captures serials");
    const noAutosaves = posted.length;
    await spa(otherURL);
    assert.equal(await warning.getByRole("button", { name: "Save draft", exact: true }).isDisabled(), true);
    await fs.mkdir("generated-artifacts/inventory", { recursive: true });
    await warning.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished)));
    await page.screenshot({ path: "generated-artifacts/inventory/order-warning-desktop.jpg" });
    await choose("Stay");
    assert.equal(await builder.locator('input[type="number"]').inputValue(), "0");
    assert.equal(await builder.getByPlaceholder("One serial per line").count(), 0);
    assert.equal(posted.length, noAutosaves, "Navigation and Stay must not autosave");
    await spa(otherURL);
    await choose("Discard");
    await page.waitForURL(`**${otherURL}`);
    await ordersTab();
    assert.equal(await reference.inputValue(), "");
    assert.equal(await notes.inputValue(), "");
    await unload(false);
    await page.goBack();
    await ordersTab();

    // Loading another draft requires a choice, and Discard leaves the saved
    // record unchanged. Saving before replacement persists only the first.
    await edit("ORDER-PO");
    await unload(false);
    await notes.fill("Purchase correction");
    await edit("ORDER-TR");
    await choose("Stay");
    assert.equal(await reference.inputValue(), "ORDER-PO");
    assert.equal(await notes.inputValue(), "Purchase correction");
    await edit("ORDER-TR");
    await choose("Discard");
    assert.equal(await reference.inputValue(), "ORDER-TR");
    await unload(false);
    assert.equal((await state()).orders.find(o => o.id === "ORDER-PO").notes, "ORDER-PO saved notes");
    await notes.fill("Transfer saved before replacement");
    await edit("ORDER-PO");
    await choose("Save draft");
    await warning.waitFor({ state: "hidden" });
    assert.equal(await reference.inputValue(), "ORDER-PO");
    await unload(false);
    assert.equal((await state()).orders.find(o => o.id === "ORDER-TR").notes, "Transfer saved before replacement");

    // An ordinary failed save, HTTP failure, network failure, and unconfirmed
    // success all retain the fields and the pending destination for a retry.
    for (const type of ["purchase", "transfer"]) {
      const id = type === "purchase" ? "ORDER-PO" : "ORDER-TR";
      if (await reference.inputValue() !== id) await edit(id);
      await notes.fill(`${type} retained correction`);
      await reference.fill(id);
      const fail = route => route.request().postDataJSON()?.action === "order"
        ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Fixture failure" }) }) : route.continue();
      await page.route(`**${endpoint}/commands`, fail);
      await builder.getByRole("button", { name: "Save draft", exact: true }).click();
      await page.getByText(/Order draft not saved/).waitFor();
      assert.equal(await notes.inputValue(), `${type} retained correction`);
      await unload(true);
      await spa(otherURL);
      await choose("Save draft");
      await warning.getByText(/Order draft not saved/).waitFor();
      assert.ok(page.url().endsWith(inventoryURL));
      assert.equal(await notes.inputValue(), `${type} retained correction`);
      await page.unroute(`**${endpoint}/commands`, fail);
      const abort = route => route.request().postDataJSON()?.action === "order" ? route.abort("failed") : route.continue();
      await page.route(`**${endpoint}/commands`, abort);
      await choose("Save draft");
      await warning.getByRole("button", { name: "Save draft", exact: true }).waitFor({ state: "visible" });
      await page.waitForFunction(() => !Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === "Save draft")?.disabled);
      assert.equal(await notes.inputValue(), `${type} retained correction`);
      await page.unroute(`**${endpoint}/commands`, abort);
      const unconfirmed = route => route.request().postDataJSON()?.action === "order"
        ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: { orders: [] } }) }) : route.continue();
      await page.route(`**${endpoint}/commands`, unconfirmed);
      await choose("Save draft");
      await warning.getByText(/could not be confirmed/).waitFor();
      await unload(true);
      await page.unroute(`**${endpoint}/commands`, unconfirmed);
      await choose("Save draft");
      await page.waitForURL(`**${otherURL}`);
      assert.equal(await warning.isVisible(), false);
      await ordersTab();
      assert.equal(await reference.inputValue(), "");
      assert.equal(await notes.inputValue(), "");
      await unload(false);
      assert.equal((await state()).orders.find(o => o.id === id).notes, `${type} retained correction`);
      await page.goBack();
      await ordersTab();
    }

    // Existing-line removal and adding a new line are
    // covered independently. Saving cannot silently omit an unfinished line.
    await edit("ORDER-PO");
    await builder.getByRole("button", { name: "Remove", exact: true }).click();
    await unload(true);
    await select(3, "ORDER-SERIAL · Order meter");
    await builder.locator('input[type="number"]').fill("2");
    assert.equal(await builder.getByPlaceholder("One serial per line").count(), 0);
    await spa(otherURL);
    assert.equal(await warning.getByRole("button", { name: "Save draft", exact: true }).isDisabled(), true);
    await choose("Stay");
    await builder.getByRole("button", { name: "Add line", exact: true }).click();
    assert.equal(await builder.getByLabel("Serial scans", { exact: true }).count(), 0);
    const inlineQuantity = builder.getByLabel("Quantity for Order meter", { exact: true });
    await inlineQuantity.fill("");
    assert.equal(await builder.getByRole("button", { name: "Save draft", exact: true }).isDisabled(), true);
    await spa(otherURL);
    assert.equal(await warning.getByRole("button", { name: "Save draft", exact: true }).isDisabled(), true);
    await choose("Stay");
    assert.equal(await inlineQuantity.inputValue(), "");
    for (const value of ["0", "1.5", "1000001"]) {
      await inlineQuantity.fill(value);
      assert.equal(await builder.getByRole("button", { name: "Save draft", exact: true }).isDisabled(), true);
    }
    await inlineQuantity.fill("3");
    await builder.getByRole("button", { name: "Save draft", exact: true }).click();
    await saved();
    assert.equal((await state()).orders.find(o => o.id === "ORDER-PO").status, "draft");
    assert.equal((await state()).orders.find(o => o.id === "ORDER-PO").lines[0].quantity, 3);
    assert.deepEqual((await state()).orders.find(o => o.id === "ORDER-PO").lines[0].serials, []);
    await select(3, "ORDER-BULK · Order bulk");
    await builder.getByRole("button", { name: "Clear unfinished line", exact: true }).click();
    await unload(false);

    // Refresh/close gets the browser warning; dismissal retains both types.
    for (const id of ["ORDER-PO", "ORDER-TR"]) {
      await edit(id);
      await notes.fill(`${id} local refresh edit`);
      const dialog = page.waitForEvent("dialog");
      await page.evaluate(() => { setTimeout(() => window.location.reload(), 0); });
      const native = await dialog;
      assert.equal(native.type(), "beforeunload");
      await native.dismiss();
      assert.equal(await notes.inputValue(), `${id} local refresh edit`);
      await spa(otherURL);
      await choose("Discard");
      await page.waitForURL(`**${otherURL}`);
      await page.goBack();
      await ordersTab();
      await edit(id);
      assert.notEqual(await notes.inputValue(), `${id} local refresh edit`);
    }

    // App links and both browser-history directions honor Stay/Discard/Save.
    await notes.fill("Saved before app link");
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await choose("Save draft");
    await page.waitForURL("**/projects");
    await page.goBack();
    await ordersTab();
    await notes.fill("Back edit");
    await page.evaluate(() => window.history.back());
    await choose("Stay");
    assert.equal(await notes.inputValue(), "Back edit");
    await page.evaluate(() => window.history.back());
    await choose("Discard");
    await page.waitForURL("**/projects");
    await page.goForward();
    await ordersTab();
    await spa(otherURL);
    await page.goBack();
    await ordersTab();
    await notes.fill("Forward edit");
    await page.evaluate(() => window.history.forward());
    await choose("Stay");
    assert.equal(await notes.inputValue(), "Forward edit");
    await page.evaluate(() => window.history.forward());
    await choose("Discard");
    await page.waitForURL(`**${otherURL}`);
    await page.goBack();
    await ordersTab();
    await unload(false);

    // Two dirty editors must each get a choice; saving count changes alone
    // never grants permission to discard the order.
    await edit("ORDER-TR");
    await notes.fill("Order and count correction");
    await page.getByRole("tab", { name: "Counts & assembly", exact: true }).click();
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "ORDER-MAIN · order-main", exact: true }).click();
    await page.getByRole("button", { name: "Start count", exact: true }).click();
    await page.getByLabel("Count adjustment reason", { exact: true }).fill("Count and order correction");
    await spa(otherURL);
    await countWarning.getByRole("button", { name: "Save draft", exact: true }).click();
    await warning.waitFor();
    await choose("Stay");
    await unload(true);
    await ordersTab();
    assert.equal(await notes.inputValue(), "Order and count correction");
    await spa(otherURL);
    await choose("Save draft");
    await page.waitForURL(`**${otherURL}`);
    assert.equal((await state()).counts.at(-1).draft.reason, "Count and order correction");
    assert.deepEqual((await state()).stock, originalStock, "Draft saves, discards and navigation must not change stock");

    // Transfer drafts also plan mixed products without physical identities and
    // keep inline quantities through save/reopen.
    await page.goto(inventoryURL);
    await ordersTab();
    await edit("ORDER-TR");
    await builder.getByLabel("Quantity for Order bulk", { exact: true }).fill("5");
    await select(3, "ORDER-SERIAL · Order meter");
    await builder.getByRole("button", { name: "Add line", exact: true }).click();
    assert.equal(await builder.getByLabel("Serial scans", { exact: true }).count(), 0);
    await builder.getByLabel("Quantity for Order meter", { exact: true }).fill("2");
    await builder.getByRole("button", { name: "Save draft", exact: true }).click();
    await saved();
    const plannedTransfer = (await state()).orders.find(o => o.id === "ORDER-TR");
    assert.deepEqual(plannedTransfer.lines.map(l => [l.quantity, l.serials]), [[5, []], [2, []]]);
    await edit("ORDER-TR");
    assert.equal(await builder.getByLabel("Quantity for Order bulk", { exact: true }).inputValue(), "5");
    assert.equal(await builder.getByLabel("Quantity for Order meter", { exact: true }).inputValue(), "2");
    const assertCompactLines = async () => {
      // Read both bounds in one browser frame; Edit draft scrolls smoothly.
      const distance = await builder.evaluate(el => {
        const rows = [...el.querySelectorAll('input[id^="draft-line-quantity-"]')];
        return rows.length === 2 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top : null;
      });
      assert.ok(distance !== null && distance <= 100, `draft quantity rows should stay compact (spacing: ${distance}px)`);
      assert.equal(await builder.evaluate(el => el.scrollWidth <= el.clientWidth), true, "compact editor must not clip horizontally");
    };
    await assertCompactLines();
    await fs.mkdir("generated-artifacts/inventory", { recursive: true });
    await builder.screenshot({ path: "generated-artifacts/inventory/order-lines-desktop.jpg" });
    await page.setViewportSize({ width: 390, height: 844 });
    await assertCompactLines();
    await builder.screenshot({ path: "generated-artifacts/inventory/order-lines-mobile.jpg" });
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.deepEqual((await state()).stock, originalStock);

    // Real PO lifecycle controls: un-release, edit/add a product, re-release,
    // reject receipt-backed reopening, clear with confirmation and restore.
    await command("order", order("ORDER-AMEND", "purchase"));
    await command("release", { orderId: "ORDER-AMEND" });
    await page.goto(inventoryURL);
    await ordersTab();
    const poRow = id => page.locator("div.rounded-lg.border.p-4").filter({ hasText: id });
    const amended = poRow("ORDER-AMEND");
    await amended.getByRole("button", { name: "Un-release to draft", exact: true }).click();
    await amended.getByRole("button", { name: "Edit draft", exact: true }).waitFor();
    assert.equal((await state()).orders.find(o => o.id === "ORDER-AMEND").status, "draft");
    await amended.getByRole("button", { name: "Edit draft", exact: true }).click();
    await select(3, "ORDER-SERIAL · Order meter");
    await builder.getByRole("button", { name: "Add line", exact: true }).click();
    await notes.fill("Added a meter before receiving");
    await builder.getByRole("button", { name: "Save draft", exact: true }).click();
    await saved();
    assert.equal((await state()).orders.find(o => o.id === "ORDER-AMEND").lines.length, 2);
    await amended.getByRole("button", { name: "Release", exact: true }).click();
    await amended.getByRole("button", { name: "Receive", exact: true }).waitFor();
    await command("receive", { orderId: "ORDER-AMEND", lines: [{ itemId: "order-bulk", quantity: 1 }] });
    const postedStock = (await state()).stock, postedReceipts = (await state()).receipts;
    const locked = await context.request.post(`${endpoint}/commands`, { data: {
      operationId: crypto.randomUUID(), action: "unrelease", data: { orderId: "ORDER-AMEND" },
    } });
    assert.equal(locked.status(), 409);
    await page.reload();
    await ordersTab();
    assert.equal(await amended.getByRole("button", { name: "Un-release to draft", exact: true }).count(), 0);
    await amended.getByRole("button", { name: "Cancel", exact: true }).click();
    await amended.getByRole("button", { name: "Clear", exact: true }).click();
    const clearDialog = page.getByRole("dialog", { name: "Clear cancelled purchase order?", exact: true });
    await clearDialog.getByRole("button", { name: "Keep order visible", exact: true }).click();
    assert.equal(await amended.count(), 1, "dismissal does not clear the PO");
    await amended.getByRole("button", { name: "Clear", exact: true }).click();
    await clearDialog.getByRole("button", { name: "Clear PO", exact: true }).click();
    await clearDialog.waitFor({ state: "hidden" });
    await amended.waitFor({ state: "detached" });
    await page.reload();
    await ordersTab();
    assert.equal(await amended.count(), 0, "cleared state persists after reloading");
    await page.getByRole("checkbox", { name: "Show cleared purchase orders", exact: true }).check();
    await amended.getByRole("button", { name: "Restore", exact: true }).waitFor();
    const printOrder = await context.request.get(`${endpoint}/print/order/ORDER-AMEND`);
    assert.equal(printOrder.status(), 200);
    assert.match(await printOrder.text(), /Order ID \/ reference: ORDER-AMEND/);
    const orderReceipt = postedReceipts.find(receipt => receipt.reference === "ORDER-AMEND");
    const printReceipt = await context.request.get(`${endpoint}/print/receipt/${orderReceipt.id}`);
    assert.equal(printReceipt.status(), 200);
    const receiptHTML = await printReceipt.text();
    assert.match(receiptHTML, /Order ID \/ reference: ORDER-AMEND/);
    assert.ok(receiptHTML.includes(`Receipt ID: ${orderReceipt.id}`));
    await fs.mkdir("generated-artifacts/inventory", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory/purchase-order-controls.jpg", fullPage: true });
    await amended.getByRole("button", { name: "Restore", exact: true }).click();
    await amended.getByRole("button", { name: "Clear", exact: true }).waitFor();
    await page.getByRole("checkbox", { name: "Show cleared purchase orders", exact: true }).uncheck();
    assert.equal(await amended.count(), 1);
    assert.equal((await state()).orders.find(o => o.id === "ORDER-AMEND").status, "cancelled");
    assert.deepEqual((await state()).stock, postedStock);
    assert.deepEqual((await state()).receipts, postedReceipts, "clear/restore never erases receipts");
    await command("order", order("ORDER-RELEASEABLE", "purchase"));
    await command("release", { orderId: "ORDER-RELEASEABLE" });

    // Permissions are granted through normal role administration, not raw DB
    // keys. A warning never enables the other order type's save permission.
    for (const permission of [null, "inventory.purchase", "inventory.transfer"]) {
      assert.equal((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, { data: {
        permissions: ["projects.view", "workOrders.view", "inventory.view", ...(permission ? [permission] : [])],
      } })).status(), 200);
      const viewer = await browser.newContext({ baseURL });
      try {
        assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
        const viewPage = await viewer.newPage();
        await viewPage.goto(inventoryURL);
        await viewPage.getByRole("tab", { name: "Orders", exact: true }).click();
        if (permission !== "inventory.purchase") {
          for (const action of ["unrelease", "archiveOrder", "restoreOrder"]) {
            const response = await viewer.request.post(`${endpoint}/commands`, { data: {
              operationId: crypto.randomUUID(), action, data: { orderId: action === "unrelease" ? "ORDER-RELEASEABLE" : "ORDER-AMEND" },
            } });
            assert.equal(response.status(), 403, `${action} must require purchase permission`);
          }
          assert.equal(await viewPage.getByRole("button", { name: "Un-release to draft", exact: true }).count(), 0);
          assert.equal(await viewPage.getByRole("button", { name: "Clear", exact: true }).count(), 0);
        } else {
          for (const [action, orderId] of [["unrelease", "ORDER-RELEASEABLE"], ["archiveOrder", "ORDER-AMEND"], ["restoreOrder", "ORDER-AMEND"]]) {
            const response = await viewer.request.post(`${endpoint}/commands`, { data: {
              operationId: crypto.randomUUID(), action, data: { orderId },
            } });
            assert.equal(response.status(), 200, `${action} works through an authorized non-admin role`);
          }
        }
        if (!permission) {
          assert.equal(await viewPage.locator("fieldset").count(), 0);
          assert.equal(await viewPage.getByRole("button", { name: "Edit draft", exact: true }).count(), 0);
          continue;
        }
        const form = viewPage.locator("fieldset");
        const allowedType = permission === "inventory.purchase" ? "purchase" : "transfer";
        const allowedId = allowedType === "purchase" ? "ORDER-PO" : "ORDER-TR";
        await viewPage.locator("div.rounded-lg.border.p-4").filter({ hasText: allowedId }).getByRole("button", { name: "Edit draft", exact: true }).click();
        await form.getByRole("combobox").first().click();
        await viewPage.getByRole("option", { name: allowedType === "purchase" ? "Transfer" : "Purchase", exact: true }).click();
        await viewPage.getByLabel("Order notes", { exact: true }).fill("No permission to save this type");
        await viewPage.evaluate(url => window.history.pushState({}, "", url), "/projects");
        const denied = viewPage.getByRole("dialog", { name: "Unsaved order changes", exact: true });
        assert.equal(await denied.getByRole("button", { name: "Save draft", exact: true }).isDisabled(), true);
        await denied.getByRole("button", { name: "Stay", exact: true }).click();
        assert.equal(await form.getByRole("button", { name: "Save draft", exact: true }).isDisabled(), true);
        const res = await viewer.request.post(`${endpoint}/commands`, { data: {
          operationId: crypto.randomUUID(), action: "order", data: order("ORDER-DENIED", allowedType === "purchase" ? "transfer" : "purchase"),
        } });
        assert.equal(res.status(), 403);
      } finally { await viewer.close(); }
    }
    // Serial identities are still required and captured on actual transfer
    // dispatch, then carried to arrival and its printed receipt.
    await command("order", { ...order("ORDER-SERIAL-SUPPLY", "purchase"),
      lines: [{ itemId: "order-serial", quantity: 2 }] });
    await command("release", { orderId: "ORDER-SERIAL-SUPPLY" });
    await command("receive", { orderId: "ORDER-SERIAL-SUPPLY", lines: [
      { itemId: "order-serial", quantity: 2, serials: ["000701", "000702"] },
    ] });
    await command("order", { ...order("ORDER-SERIAL-MOVE", "transfer"),
      lines: [{ itemId: "order-serial", quantity: 2 }, { itemId: "order-bulk", quantity: 1 }] });
    await command("release", { orderId: "ORDER-SERIAL-MOVE" });
    await page.goto(inventoryURL);
    await ordersTab();
    await poRow("ORDER-SERIAL-MOVE").getByRole("button", { name: "Dispatch", exact: true }).click();
    const dispatchDialog = page.getByRole("dialog", { name: /^Dispatch transfer/ });
    await dispatchDialog.locator("#order-serial-goodQuantity").fill("2");
    await dispatchDialog.locator("#order-bulk-goodQuantity").fill("1");
    const dispatchScanner = dispatchDialog.getByRole("textbox", { name: "Good serial scanner for Order meter", exact: true });
    for (const serial of ["000701", "000702"]) { await dispatchScanner.fill(serial); await dispatchScanner.press("Enter"); }
    await dispatchDialog.getByRole("button", { name: "Review movement", exact: true }).click();
    await dispatchDialog.getByRole("button", { name: "Post movement", exact: true }).click();
    await dispatchDialog.waitFor({ state: "hidden" });
    await poRow("ORDER-SERIAL-MOVE").getByRole("button", { name: "Accept arrival", exact: true }).click();
    const arrivalDialog = page.getByRole("dialog", { name: /^Accept transfer arrival/ });
    await arrivalDialog.locator("#order-serial-goodQuantity").fill("2");
    await arrivalDialog.locator("#order-bulk-goodQuantity").fill("1");
    const arrivalScanner = arrivalDialog.getByRole("textbox", { name: "Good serial scanner for Order meter", exact: true });
    assert.equal(await arrivalScanner.inputValue(), "", "expected dispatched identities are not proof of a physical arrival scan");
    for (const serial of ["000701", "000702"]) { await arrivalScanner.fill(serial); await arrivalScanner.press("Enter"); }
    await arrivalDialog.getByRole("button", { name: "Review movement", exact: true }).click();
    await arrivalDialog.getByRole("button", { name: "Post movement", exact: true }).click();
    await arrivalDialog.waitFor({ state: "hidden" });
    const delivered = await state();
    assert.equal(delivered.orders.find(o => o.id === "ORDER-SERIAL-MOVE").status, "completed");
    assert.deepEqual(delivered.stock.find(b => b.warehouseId === "order-van" && b.itemId === "order-serial").serials, ["000701", "000702"]);
    for (const receipt of delivered.receipts.filter(r => r.reference === "ORDER-SERIAL-MOVE")) {
      const printed = await context.request.get(`${endpoint}/print/receipt/${receipt.id}`);
      assert.equal(printed.status(), 200);
      const html = await printed.text();
      assert.match(html, /Order ID \/ reference: ORDER-SERIAL-MOVE/);
      assert.ok(html.includes(`Receipt ID: ${receipt.id}`));
    }
    assert.deepEqual(errors, []);
    console.log("Quantity-only PO/transfer drafts, inline quantity validation/save/reopen, operation-time serial dispatch/acceptance, order/receipt references and PO lifecycle/permission/navigation regressions passed.");
  } finally {
    try {
      if (context && otherProject) assert.ok([200, 204].includes((await context.request.delete(`/api/projects/${otherProject}`)).status()));
    } finally { await browser.close(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
