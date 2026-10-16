// Run against the disposable project/accounts created by inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const passed = [], prefix = `unrelease-${Date.now()}`;
  try {
    const admin = await browser.newContext({ baseURL });
    assert.equal((await admin.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const send = (context, action, data) => context.request.post(`${endpoint}/commands`, {
      data: { action, data, operationId: crypto.randomUUID() },
    });
    const post = async (action, data) => {
      const response = await send(admin, action, data);
      assert.equal(response.status(), 200, await response.text());
      return (await response.json()).state;
    };
    const state = async () => {
      const response = await admin.request.get(endpoint);
      assert.equal(response.status(), 200);
      return (await response.json()).state;
    };
    const grant = async permissions => assert.equal((await admin.request.put(
      `/api/subroles/${fixture.viewerRoleId}/permissions`, {
        data: { permissions: ["projects.view", "workOrders.view", "inventory.view", ...permissions] },
      })).status(), 200);
    for (const suffix of ["source", "destination"]) {
      await post("warehouse", { id: `${prefix}-${suffix}`, code: `${prefix}-${suffix}`,
        name: `Editor ${suffix}`, type: "physical", address: "Disposable fixture",
        userIds: [fixture.viewer.id] });
    }
    await post("vendor", { id: `${prefix}-vendor`, name: "Editor vendor" });
    for (const suffix of ["item", "extra"]) await post("item", {
      id: `${prefix}-${suffix}`, sku: `${prefix}-${suffix}`, name: `Editor ${suffix}`, tracking: "regular",
    });
    const create = async (suffix, type = "transfer", replacementFor) => {
      const id = `${prefix}-${suffix}`;
      await post("order", { id, type, destinationId: `${prefix}-destination`,
        ...(type === "transfer" ? { sourceId: `${prefix}-source` } : { vendorId: `${prefix}-vendor` }),
        reference: `Reference ${suffix}`, notes: `Notes ${suffix}`, ...(replacementFor ? { replacementFor } : {}),
        lines: [{ itemId: `${prefix}-item`, quantity: 2 }] });
      await post("release", { orderId: id });
      return id;
    };
    const parent = await create("parent", "purchase");
    const po = await create("purchase", "purchase", parent), transfer = await create("transfer");
    await grant(["inventory.purchase", "inventory.transfer"]);
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, hasTouch: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const page = await context.newPage(), errors = [], unreleaseRequests = [];
    page.setDefaultTimeout(15000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (request.url().endsWith(`${endpoint}/commands`) && request.postDataJSON()?.action === "unrelease")
        unreleaseRequests.push(request.postDataJSON());
    });
    const editor = page.getByTestId("inventory-order-dialog");
    const warning = page.getByRole("dialog", { name: "Unsaved order changes", exact: true });
    const card = id => page.locator(`[data-order-id="${id}"]`);
    const orders = async id => {
      await page.goto(`/projects/${fixture.projectId}/inventory`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.getByTestId("inventory-sticky-header").waitFor();
      const tab = page.getByRole("tab", { name: "Orders", exact: true });
      if (await tab.isVisible()) await tab.click();
      else {
        await page.getByRole("button", { name: /^Inventory sections, current:/ }).click();
        await page.getByRole("menuitem", { name: "Orders", exact: true }).click();
      }
      await page.getByTestId("inventory-orders-subheader").waitFor();
      const tools = page.getByTestId("inventory-mobile-tools-orders-toggle");
      if (await tools.isVisible() && await tools.getAttribute("aria-expanded") === "false") await tools.click();
      await page.getByPlaceholder("Order number, reference, ID, product, vendor or location").fill(id);
      await card(id).waitFor();
    };
    const unrelease = async id => {
      await card(id).getByRole("button", { name: "Un-release to draft", exact: true }).click();
    };
    const close = async () => {
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
    };
    const waitState = async (id, status) => {
      for (let i = 0; i < 30; i++) {
        const snapshot = await state();
        if (snapshot.orders.find(order => order.id === id)?.status === status) return snapshot;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.fail(`Order did not become ${status}`);
    };
    await fs.mkdir("generated-artifacts/unrelease-editor", { recursive: true });
    for (const [id, type] of [[po, "purchase"], [transfer, "transfer"]]) {
      await orders(id);
      const before = await state(), original = before.orders.find(order => order.id === id);
      await unrelease(id);
      await editor.waitFor();
      if (type === "purchase") await page.screenshot({ path: "generated-artifacts/unrelease-editor/desktop.png" });
      assert.equal(await editor.getByLabel("Order notes", { exact: true }).inputValue(), original.notes);
      assert.equal(await editor.getByLabel("Supplier/customer reference", { exact: true }).inputValue(), original.reference);
      const after = await waitState(id, "draft"), changed = after.orders.find(order => order.id === id);
      assert.deepEqual(changed, { ...original, status: "draft" }, "opening the editor only changes persisted status");
      for (const field of ["stock", "allocations", "receipts", "shipmentDrafts"])
        assert.deepEqual(after[field], before[field], `${field} unchanged`);
      await editor.getByLabel("Quantity for Editor item", { exact: true }).fill("4");
      const addExtra = async () => {
        await editor.getByRole("combobox").nth(3).click();
        await page.getByRole("option", { name: `${prefix}-extra · Editor extra`, exact: true }).click();
        await editor.getByRole("button", { name: "Add line", exact: true }).click();
      };
      await addExtra();
      await editor.getByRole("button", { name: "Remove", exact: true }).nth(1).click();
      await addExtra();
      await editor.getByLabel("Order notes", { exact: true }).fill(`Edited ${type}`);
      await editor.getByRole("button", { name: "Save draft", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      await page.getByText(/^Order .+ saved as a draft/).waitFor();
      const saved = (await state()).orders.find(order => order.id === id);
      assert.equal(saved.id, original.id);
      assert.equal(saved.orderNumber, original.orderNumber);
      assert.equal(saved.reference, original.reference);
      assert.equal(saved.lines[0].quantity, 4);
      assert.equal(saved.lines[1].itemId, `${prefix}-extra`);
      assert.equal(saved.notes, `Edited ${type}`);
      await card(id).getByRole("button", { name: "Edit draft", exact: true }).click();
      await editor.waitFor();
      assert.equal(await editor.getByLabel("Quantity for Editor item", { exact: true }).inputValue(), "4");
      await close();
      await card(id).getByRole("button", { name: "Release", exact: true }).click();
      await card(id).getByRole("button", { name: "Un-release to draft", exact: true }).waitFor();
      assert.equal((await waitState(id, "released")).orders.find(order => order.id === id).status, "released");
      passed.push(`${type}: automatic editor, same identity/values, inline quantity save, normal Edit draft, re-release, no stock/history changes`);
    }

    // A committed command whose response is lost must reconcile, not create/edit from the released closure.
    const lost = await create("lost");
    await orders(lost);
    await page.route(`**${endpoint}/commands`, async route => {
      if (route.request().postDataJSON()?.action !== "unrelease") return route.continue();
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort("failed");
    });
    await unrelease(lost);
    await editor.waitFor();
    assert.equal(await editor.getByLabel("Order notes", { exact: true }).inputValue(), "Notes lost");
    assert.equal((await state()).orders.find(order => order.id === lost).status, "draft");
    await close();
    await page.unroute(`**${endpoint}/commands`);
    passed.push("lost committed response reconciles authoritative draft and opens populated editor");

    // Hold the second GET (the explicit reconciliation, after mutation invalidation).
    // The shared mutation is no longer pending, but no second editor/command may overtake this read.
    const pending = await create("pending");
    await orders(pending);
    let releaseRead, readStarted, reads = 0;
    const readGate = new Promise(resolve => { releaseRead = resolve; });
    const reading = new Promise(resolve => { readStarted = resolve; });
    await page.route(`**${endpoint}`, async route => {
      if (++reads === 2) { readStarted(); await readGate; }
      await route.continue();
    });
    const requestsBeforePending = unreleaseRequests.length;
    await unrelease(pending);
    await Promise.race([reading, new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Reconciliation read did not start")), 15000))]);
    assert.match(await card(pending).getByRole("status").innerText(), /Returning order|Checking/);
    assert.equal(await card(pending).getByRole("button", { name: "Un-release to draft", exact: true }).count(), 0);
    assert.equal(await card(pending).getByRole("button", { name: "Edit draft", exact: true }).isDisabled(), true);
    assert.equal(await card(pending).getByRole("button", { name: "Release", exact: true }).isDisabled(), true);
    await page.getByTestId("inventory-sticky-header").getByRole("button", { name: "Build an order draft", exact: true }).click();
    assert.equal(await editor.isVisible(), false, "another editor cannot overtake pending reconciliation");
    releaseRead();
    await editor.waitFor();
    assert.equal(unreleaseRequests.length, requestsBeforePending + 1);
    await close();
    await page.unroute(`**${endpoint}`);
    passed.push("pending reconciliation disables duplicate un-release and cannot overwrite a newly opened editor");

    // An unknown outcome plus an unavailable read must keep the modal closed until explicit read-only recovery.
    const unknown = await create("unknown");
    await orders(unknown);
    let unavailable = true;
    await page.route(`**${endpoint}`, route => unavailable
      ? route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Fixture read unavailable"}' })
      : route.continue());
    await page.route(`**${endpoint}/commands`, async route => {
      if (route.request().postDataJSON()?.action !== "unrelease") return route.continue();
      assert.equal((await route.fetch()).status(), 200);
      await route.abort("failed");
    });
    const priorRequests = unreleaseRequests.length;
    await unrelease(unknown);
    const checkStatus = card(unknown).getByRole("button", { name: /check authoritative status/i });
    await checkStatus.waitFor();
    assert.equal(await editor.isVisible(), false);
    assert.equal(await card(unknown).getByRole("button", { name: "Un-release to draft", exact: true }).isDisabled(), true);
    await page.getByTestId("inventory-sticky-header").getByRole("button", { name: "Build an order draft", exact: true }).click();
    await editor.getByLabel("Order notes", { exact: true }).fill("Keep this newer local draft");
    // Exercise the handler's navigation guard even if an action is dispatched while a modal is active.
    const dispatchCheck = () => card(unknown).locator('button[aria-label^="Check authoritative status"]')
      .evaluate(button => button.click());
    await dispatchCheck();
    await warning.getByRole("button", { name: "Stay", exact: true }).click();
    await warning.waitFor({ state: "hidden" });
    assert.equal(await editor.getByLabel("Order notes", { exact: true }).inputValue(), "Keep this newer local draft");
    await dispatchCheck();
    await warning.getByRole("button", { name: "Discard", exact: true }).click();
    await warning.waitFor({ state: "hidden" });
    await card(unknown).getByText(/^Could not confirm the order status/).waitFor();
    assert.equal(await editor.getByLabel("Order notes", { exact: true }).inputValue(), "Keep this newer local draft",
      "permission to discard is not permission to lose values when reconciliation fails");
    unavailable = false;
    await dispatchCheck();
    await warning.getByRole("button", { name: "Discard", exact: true }).click();
    await warning.waitFor({ state: "hidden" });
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="Order notes"]')?.value === "Notes unknown");
    assert.equal(unreleaseRequests.length, priorRequests + 1, "recovery never sends a second un-release command");
    await close();
    await page.unroute(`**${endpoint}`);
    await page.unroute(`**${endpoint}/commands`);
    passed.push("unknown outcome stays closed; guarded status recovery preserves newer dirty values on Stay/failure and never posts twice");

    const rejected = await create("rejected");
    await orders(rejected);
    await page.route(`**${endpoint}/commands`, route => route.request().postDataJSON()?.action === "unrelease"
      ? route.fulfill({ status: 409, contentType: "application/json", body: '{"message":"Fixture conflict: order cannot be un-released"}' })
      : route.continue());
    await unrelease(rejected);
    await card(rejected).getByText(/Fixture conflict/).waitFor();
    assert.equal(await editor.isVisible(), false);
    assert.equal((await state()).orders.find(order => order.id === rejected).status, "released");
    await page.unroute(`**${endpoint}/commands`);
    passed.push("server conflict is visible per record and never opens a released order");

    // Another user's capture is intentionally hidden in this user's snapshot; the server still blocks the action.
    const captured = await create("captured");
    const captureId = crypto.randomUUID();
    await orders(captured);
    await post("shipmentDraftSave", { id: captureId, revision: 0, stage: "dispatch", orderId: captured,
      capture: { entries: {}, scanBuffers: {}, reason: "", closeRemainder: false } });
    const capturedBefore = await state();
    await unrelease(captured);
    await card(captured).getByText(/Resume or discard saved shipment drafts/).waitFor();
    assert.equal(await editor.isVisible(), false);
    const capturedAfter = await state();
    assert.deepEqual(capturedAfter.shipmentDrafts, capturedBefore.shipmentDrafts, "no automatic capture discard");
    assert.deepEqual(capturedAfter.orders, capturedBefore.orders);
    passed.push("hidden saved capture blocks un-release without deleting scans or changing order");

    // Permissions are changed through normal role administration, never seeded keys.
    await grant(["inventory.purchase"]);
    assert.equal((await send(context, "unrelease", { orderId: transfer })).status(), 403);
    await orders(transfer);
    assert.equal(await card(transfer).getByRole("button", { name: "Un-release to draft", exact: true }).count(), 0);
    await grant(["inventory.transfer"]);
    assert.equal((await send(context, "unrelease", { orderId: po })).status(), 403);
    await orders(po);
    assert.equal(await card(po).getByRole("button", { name: "Un-release to draft", exact: true }).count(), 0);
    passed.push("normal role management enforces purchase/transfer distinctions in UI and API");

    await grant(["inventory.purchase", "inventory.transfer"]);
    const revoked = await create("revoked");
    await orders(revoked);
    // Keep the rendered button stale while normal role management revokes its capability.
    await grant(["inventory.purchase"]);
    await unrelease(revoked);
    await card(revoked).getByText(/current inventory access does not allow editing/).waitFor();
    assert.equal(await editor.isVisible(), false);
    assert.equal((await state()).orders.find(order => order.id === revoked).status, "released");
    await grant(["inventory.purchase", "inventory.transfer"]);
    const warehouseDenied = await create("warehouse-denied");
    await orders(warehouseDenied);
    await post("warehouse", { id: `${prefix}-source`, code: `${prefix}-source`,
      name: "Editor source", type: "physical", address: "Disposable fixture", userIds: [] });
    await unrelease(warehouseDenied);
    await card(warehouseDenied).getByText(/access|warehouse/i).filter({ hasText: /Status checked/ }).waitFor();
    assert.equal(await editor.isVisible(), false);
    assert.equal((await state()).orders.find(order => order.id === warehouseDenied).status, "released");
    await post("warehouse", { id: `${prefix}-source`, code: `${prefix}-source`,
      name: "Editor source", type: "physical", address: "Disposable fixture", userIds: [fixture.viewer.id] });
    passed.push("stale permission and warehouse access are rejected by server without opening an editor");

    const mobile = await create("mobile");
    await page.setViewportSize({ width: 390, height: 844 });
    await orders(mobile);
    await unrelease(mobile);
    await editor.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].every(element =>
      element.getAnimations({ subtree: true }).every(animation => animation.playState !== "running")));
    await page.screenshot({ path: "generated-artifacts/unrelease-editor/phone.png" });
    await editor.getByLabel("Order notes", { exact: true }).fill("Phone draft retained");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await warning.waitFor();
    await warning.getByRole("button", { name: "Stay", exact: true }).click();
    await warning.waitFor({ state: "hidden" });
    assert.equal(await editor.getByLabel("Order notes", { exact: true }).inputValue(), "Phone draft retained");
    await page.route(`**${endpoint}/commands`, route => route.request().postDataJSON()?.action === "order"
      ? route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Fixture save unavailable"}' })
      : route.continue());
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await warning.getByRole("button", { name: "Save draft", exact: true }).click();
    await warning.getByText(/not saved or not confirmed/).waitFor();
    await warning.getByRole("button", { name: "Stay", exact: true }).click();
    await warning.waitFor({ state: "hidden" });
    assert.equal(await editor.getByLabel("Order notes", { exact: true }).inputValue(), "Phone draft retained");
    await page.unroute(`**${endpoint}/commands`);
    await page.setViewportSize({ width: 844, height: 390 });
    await editor.getByRole("button", { name: "Save draft", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "generated-artifacts/unrelease-editor/landscape.png" });
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await warning.getByRole("button", { name: "Discard", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), false, "Discard closes and clears hidden dirty state");
    passed.push("phone/landscape auto editor, Stay and failed-save preserve entries, Discard closes cleanly");
    // A purchase receipt permanently prevents reopening, including when it was only a partial receipt.
    await post("receive", { orderId: po, lines: [{ itemId: `${prefix}-item`, quantity: 1 }] });
    const received = await state();
    assert.equal((await send(context, "unrelease", { orderId: po })).status(), 409);
    await orders(po);
    assert.equal(await card(po).getByRole("button", { name: "Un-release to draft", exact: true }).count(), 0);
    const locked = await state();
    for (const field of ["orders", "stock", "receipts", "allocations", "shipmentDrafts"])
      assert.deepEqual(locked[field], received[field]);
    passed.push("posted partial PO receipt blocks un-release with stock, receipt and capture history intact");
    assert.deepEqual(errors, []);
    for (const result of passed) console.log(`PASS ${result}`);
    await context.close(); await admin.close();
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
