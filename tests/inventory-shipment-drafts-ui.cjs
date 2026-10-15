const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", headless: true });
  const contexts = [];
  const baseURL = process.env.INVENTORY_UI_BASE || `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const base = `/api/projects/${fixture.projectId}/inventory`;
  const login = async user => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 950 } });
    contexts.push(context);
    assert.equal((await context.request.post("/api/auth/local/login", { data: { username: user.username, password: user.password } })).status(), 200);
    return context;
  };
  let context, page;
  const state = async () => (await (await context.request.get(base)).json()).state;
  const post = async (action, data, client = context, status = 200, operationId = crypto.randomUUID()) => {
    const response = await client.request.post(`${base}/commands`, { data: { action, data, operationId } });
    assert.equal(response.status(), status, `${action}: ${await response.text()}`);
    return response.json();
  };
  const openPage = async () => {
    page = await context.newPage(); page.setDefaultNavigationTimeout(60000);
    page.on("pageerror", error => { throw error; });
    await page.goto(`/projects/${fixture.projectId}/inventory`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Orders", exact: true }).click();
  };
  const orderCard = id => page.locator("div.rounded-lg.border.p-4").filter({ hasText: id });
  const draftCard = id => page.locator("div.rounded-md.border.p-3").filter({ hasText: id });
  const guide = () => page.getByRole("dialog", { name: /^(Receive purchase|Dispatch transfer|Accept transfer arrival)/ });
  const scans = async parent => {
    await parent.getByRole("button", { name: "Scan / edit serials for Resume meter", exact: true }).click();
    const child = page.getByRole("dialog", { name: "Scan serials for Resume meter", exact: true });
    await child.waitFor(); return child;
  };
  const save = async parent => {
    await parent.getByRole("button", { name: "Save draft", exact: true }).click();
    await parent.getByText("Draft saved. You can cancel and resume it later.", { exact: true }).waitFor();
  };
  const cancel = async parent => { await parent.getByRole("button", { name: "Cancel", exact: true }).click(); await parent.waitFor({ state: "hidden" }); };
  const blank = () => ({ entries: {}, scanBuffers: {}, reason: "", closeRemainder: false });
  const capture = (serial, quantity = "1") => ({ ...blank(), entries: { meter: { itemId: "meter", goodQuantity: quantity,
    damagedQuantity: "0", unreadableQuantity: "0", damageReason: "", goodSerials: [serial], damagedSerials: [], expectedSerials: [] } } });
  const order = async (id, type = "purchase", quantity = 3) => {
    await post("order", { id, type, destinationId: type === "purchase" ? "main" : "van",
      ...(type === "purchase" ? { vendorId: "vendor" } : { sourceId: "main" }), lines: [{ itemId: "meter", quantity }] });
    await post("release", { orderId: id });
  };
  try {
    context = await login(fixture);
    for (const id of ["main", "van"]) await post("warehouse", { id, code: id, name: id,
      type: "physical", address: "Disposable restart fixture", userIds: [fixture.viewer.id] });
    await post("vendor", { id: "vendor", name: "Resume vendor" });
    await post("item", { id: "meter", sku: "R-METER", name: "Resume meter", tracking: "serialized" });
    await require("./helpers/inventory-shipment-autosave-ui.cjs")({ browser, baseURL, base, fixture, admin: context, order, state, post });
    await order("RESUME-PO");
    await openPage();
    await orderCard("RESUME-PO").getByRole("button", { name: "Receive", exact: true }).click();
    let parent = guide();
    await parent.locator("#meter-goodQuantity").fill("2");
    let child = await scans(parent), scanner = child.getByRole("textbox", { name: "Good serial scanner for Resume meter", exact: true });
    await scanner.fill("00001"); await scanner.press("Enter"); await scanner.fill("0000");
    await child.getByRole("button", { name: "Done", exact: true }).click();
    const loseSave = async route => {
      if (route.request().postDataJSON().action !== "shipmentDraftSave") return route.continue();
      assert.equal((await route.fetch()).status(), 200); await route.abort("failed");
    };
    await page.route(`**${base}/commands`, loseSave);
    await save(parent);
    await page.unroute(`**${base}/commands`, loseSave);
    let saved = (await state()).shipmentDrafts[0];
    assert.equal(saved.capture.scanBuffers["meter-goodSerials"], "0000");
    assert.equal((await state()).receipts.length, 0);
    // Another tab wins its CAS update. A failed Save must not remount this editor
    // with the other tab's capture or discard its newly typed local values.
    await parent.locator("#meter-goodQuantity").fill("3");
    await post("shipmentDraftSave", { id: saved.id, revision: saved.revision, orderId: saved.orderId,
      stage: saved.stage, capture: { ...saved.capture, reason: "Changed in another session" } });
    await parent.getByRole("button", { name: "Save draft", exact: true }).click();
    await parent.getByText(/saved draft changed in another session/).waitFor();
    assert.equal(await parent.locator("#meter-goodQuantity").inputValue(), "3");
    await parent.getByRole("button", { name: "Cancel", exact: true }).click();
    await parent.getByRole("button", { name: "Discard", exact: true }).click();
    await parent.waitFor({ state: "hidden" });
    await context.close();
    context = await login(fixture); await openPage();
    await draftCard("RESUME-PO").getByRole("button", { name: "Resume", exact: true }).click();
    parent = guide();
    assert.equal(await parent.locator("#meter-goodQuantity").inputValue(), "2");
    child = await scans(parent); scanner = child.getByRole("textbox", { name: "Good serial scanner for Resume meter", exact: true });
    assert.equal(await scanner.inputValue(), "0000");
    await scanner.fill("00002"); await scanner.press("Enter");
    await child.getByRole("button", { name: "Done", exact: true }).click();
    await save(parent);
    await parent.getByRole("button", { name: "Review movement", exact: true }).click();
    let attempt;
    const fail = async route => {
      const body = route.request().postDataJSON();
      if (body.action !== "receive") return route.continue();
      attempt = body; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporary test outage" }) });
    };
    await page.route(`**${base}/commands`, fail);
    await parent.getByRole("button", { name: "Post movement", exact: true }).click();
    let recovery = page.getByRole("dialog", { name: "Recover prepared shipment", exact: true });
    await recovery.waitFor();
    let recoverySaves = 0;
    const observeRecovery = request => {
      if (request.url().endsWith(`${base}/commands`) && request.postDataJSON().action === "shipmentDraftSave") recoverySaves++;
    };
    page.on("request", observeRecovery);
    await page.waitForTimeout(1100);
    page.off("request", observeRecovery);
    assert.equal(recoverySaves, 0, "prepared recovery never starts an automatic checkpoint");
    assert.equal((await state()).receipts.length, 0);
    await page.unroute(`**${base}/commands`, fail);
    await recovery.getByRole("button", { name: "Close — keep saved draft", exact: true }).click();
    await context.close();
    context = await login(fixture); await openPage();
    await draftCard("RESUME-PO").getByRole("button", { name: "Resume", exact: true }).click();
    recovery = page.getByRole("dialog", { name: "Recover prepared shipment", exact: true });
    await recovery.getByRole("button", { name: "Check status", exact: true }).click();
    const lose = async route => {
      const body = route.request().postDataJSON();
      if (body.action !== "receive") return route.continue();
      assert.deepEqual(body, attempt, "restart retries the exact prepared payload and identity");
      assert.equal((await route.fetch()).status(), 200); await route.abort("failed");
    };
    await page.route(`**${base}/commands`, lose);
    await recovery.getByRole("button", { name: "Retry unchanged", exact: true }).click();
    await recovery.getByText(/Retry response was lost/).waitFor();
    assert.equal((await state()).receipts.length, 1);
    await context.close();
    context = await login(fixture); await openPage();
    await draftCard("RESUME-PO").getByRole("button", { name: "Resume", exact: true }).click();
    recovery = page.getByRole("dialog", { name: "Recover prepared shipment", exact: true });
    await recovery.getByRole("button", { name: "Check status", exact: true }).click();
    await recovery.getByText("Shipment already posted", { exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await recovery.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await fs.mkdir("generated-artifacts/inventory", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory/shipment-recovery-phone.jpg" });
    await recovery.getByRole("button", { name: "Confirm receipt and close", exact: true }).click();
    await recovery.waitFor({ state: "hidden" });
    assert.equal((await state()).shipmentDrafts.length, 0);
    assert.equal((await state()).receipts.length, 1);
    assert.equal((await state()).stock[0].quantity, 2);
    await page.setViewportSize({ width: 1280, height: 950 });
    // Both transfer stages retain captured identities across a full page reload.
    await order("RESUME-TR", "transfer", 1);
    for (const [button, stage] of [["Dispatch", "dispatch"], ["Accept arrival", "accept"]]) {
      await page.reload(); await page.getByRole("tab", { name: "Orders", exact: true }).click();
      await orderCard("RESUME-TR").getByRole("button", { name: button, exact: true }).click();
      parent = guide(); await parent.locator("#meter-goodQuantity").fill("1");
      child = await scans(parent); scanner = child.getByRole("textbox", { name: "Good serial scanner for Resume meter", exact: true });
      await scanner.fill("00001"); await scanner.press("Enter");
      await child.getByRole("button", { name: "Done", exact: true }).click();
      await parent.getByTestId("shipment-checkpoint-status").getByText("Saved — latest capture confirmed on server.", { exact: true }).waitFor();
      await cancel(parent);
      assert.equal((await state()).shipmentDrafts[0].stage, stage);
      await page.reload(); await page.getByRole("tab", { name: "Orders", exact: true }).click();
      await draftCard("RESUME-TR").getByRole("button", { name: "Resume", exact: true }).click();
      parent = guide(); await parent.getByRole("button", { name: "Review movement", exact: true }).click();
      await parent.getByRole("button", { name: "Post movement", exact: true }).click();
      await parent.waitFor({ state: "hidden" });
    }
    assert.equal((await state()).orders.find(o => o.id === "RESUME-TR").status, "completed");
    // First-ever automatic save + preparation loses its preparation reply.
    // Recover by the stable draft ID even before React's savedDraft closure has
    // observed the new record. Atomic unlock then rejects a late original POST.
    await order("PREPARE-LOST");
    await page.reload(); await page.getByRole("tab", { name: "Orders", exact: true }).click();
    await orderCard("PREPARE-LOST").getByRole("button", { name: "Receive", exact: true }).click();
    parent = guide(); await parent.locator("#meter-goodQuantity").fill("1");
    child = await scans(parent); scanner = child.getByRole("textbox", { name: "Good serial scanner for Resume meter", exact: true });
    await scanner.fill("PREPARE-0001"); await scanner.press("Enter");
    await child.getByRole("button", { name: "Done", exact: true }).click();
    await parent.getByRole("button", { name: "Review movement", exact: true }).click();
    const losePreparation = async route => {
      if (route.request().postDataJSON().action !== "shipmentDraftPrepare") return route.continue();
      assert.equal((await route.fetch()).status(), 200); await route.abort("failed");
    };
    await page.route(`**${base}/commands`, losePreparation);
    await parent.getByRole("button", { name: "Post movement", exact: true }).click();
    recovery = page.getByRole("dialog", { name: "Recover prepared shipment", exact: true });
    await recovery.waitFor(); await page.unroute(`**${base}/commands`, losePreparation);
    const prepared = (await state()).shipmentDrafts.find(d => d.orderId === "PREPARE-LOST");
    assert.ok(prepared.pending);
    await recovery.getByRole("button", { name: "Check status", exact: true }).click();
    await recovery.getByRole("button", { name: "Return to editing safely", exact: true }).click();
    parent = guide(); await parent.waitFor();
    assert.equal(await parent.locator("#meter-goodQuantity").inputValue(), "1");
    await post("receive", { ...prepared.pending.payload, draftId: prepared.id, draftRevision: prepared.revision }, context, 409, prepared.pending.operationId);
    await cancel(parent);
    page.once("dialog", dialog => dialog.accept());
    await draftCard("PREPARE-LOST").getByRole("button", { name: "Discard saved draft", exact: true }).click();
    // A fresh resume detects a captured serial subsequently received elsewhere.
    await order("STALE-PO"); await order("OTHER-PO");
    const staleId = crypto.randomUUID();
    await post("shipmentDraftSave", { id: staleId, revision: 0, orderId: "STALE-PO", stage: "receive", capture: capture("STALE-0001") });
    await post("receive", { orderId: "OTHER-PO", lines: [{ itemId: "meter", quantity: 1, serials: ["STALE-0001"] }] });
    await page.reload(); await page.getByRole("tab", { name: "Orders", exact: true }).click();
    await draftCard("STALE-PO").getByRole("button", { name: "Resume", exact: true }).click();
    parent = guide(); await parent.getByRole("button", { name: "Review movement", exact: true }).click();
    await parent.getByText(/STALE-0001: This serial is already in current stock/).waitFor();
    assert.equal((await state()).shipmentDrafts.find(d => d.id === staleId).capture.entries.meter.goodSerials[0], "STALE-0001");
    await cancel(parent);
    // Normal role-management path tests permissions and private owner scope.
    assert.equal((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, {
      data: { permissions: ["projects.view", "workOrders.view", "inventory.view"] },
    })).status(), 200);
    const viewer = await login(fixture.viewer);
    assert.deepEqual((await (await viewer.request.get(base)).json()).state.shipmentDrafts, []);
    await post("shipmentDraftSave", { id: crypto.randomUUID(), revision: 0, orderId: "OTHER-PO", stage: "receive", capture: blank() }, viewer, 403);
    const grant = await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, {
      data: { permissions: ["projects.view", "workOrders.view", "inventory.view", "inventory.receive"] },
    });
    assert.equal(grant.status(), 200);
    await post("shipmentDraftSave", { id: staleId, revision: 1, orderId: "STALE-PO", stage: "receive", capture: blank() }, viewer, 409);
    const otherDraft = crypto.randomUUID();
    await post("shipmentDraftSave", { id: otherDraft, revision: 0, orderId: "OTHER-PO", stage: "receive",
      capture: { ...blank(), scanBuffers: { "meter-goodSerials": "RESTORE-0000" } } }, viewer);
    await post("shipmentDraftClaim", { id: staleId, revision: 1 }, viewer, 403);
    await post("warehouse", { id: "main", code: "main", name: "main", type: "physical", address: "Disposable restart fixture", userIds: [] });
    assert.deepEqual((await (await viewer.request.get(base)).json()).state.shipmentDrafts, []);
    await post("shipmentDraftSave", { id: otherDraft, revision: 1, orderId: "OTHER-PO", stage: "receive", capture: blank() }, viewer, 409);
    await page.reload(); await page.getByRole("tab", { name: "Orders", exact: true }).click();
    page.once("dialog", dialog => dialog.accept());
    await draftCard("OTHER-PO").getByRole("button", { name: "Take ownership", exact: true }).click();
    parent = guide(); child = await scans(parent);
    assert.equal(await child.getByRole("textbox", { name: "Good serial scanner for Resume meter", exact: true }).inputValue(), "RESTORE-0000");
    await child.getByRole("button", { name: "Done", exact: true }).click();
    await cancel(parent);
    page.once("dialog", dialog => dialog.accept());
    await draftCard("OTHER-PO").getByRole("button", { name: "Discard saved draft", exact: true }).click();
    await page.waitForFunction(async base => {
      const body = await (await fetch(base)).json();
      return !body.state.shipmentDrafts.some(d => d.orderId === "OTHER-PO");
    }, base);
    console.log("Restart-resume, raw buffers, CAS retention, durable retry/receipt acknowledgement, both transfer stages, stale scans, normal-role access, warehouse revocation and administrator adoption passed.");
  } finally {
    await Promise.all(contexts.map(c => c.close().catch(() => {}))); await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
