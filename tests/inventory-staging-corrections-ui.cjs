const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const admin = await browser.newContext({ baseURL }), warehouse = await browser.newContext({ baseURL }), tech = await browser.newContext({ baseURL });
  const inventory = `/api/projects/${fixture.projectId}/inventory`;
  const request = async (context, method, path, data) => {
    const result = await context.request.fetch(path, { method, data });
    assert.ok(result.ok(), `${method} ${path}: ${result.status()} ${await result.text()}`);
    return result.json();
  };
  const command = (action, data, operationId = crypto.randomUUID(), context = warehouse) =>
    request(context, "POST", `${inventory}/commands`, { operationId, action, data });
  try {
    await request(admin, "POST", "/api/auth/local/login", fixture);
    const makeUser = async (prefix, permissions) => {
      const role = await request(admin, "POST", "/api/subroles", { key: `${prefix}_${crypto.randomUUID().slice(0, 8)}`,
        label: prefix, baseRole: "user", permissions });
      const credentials = { username: `${prefix}-${crypto.randomUUID().slice(0, 8)}`, password: `Aa1!${crypto.randomUUID()}` };
      const user = await request(admin, "POST", "/api/users", { ...credentials, firstName: prefix, lastName: "Test",
        role: "user", subroleId: role.id, projectIds: [fixture.projectId] });
      return { user, credentials, role };
    };
    const worker = await makeUser("correction", ["workOrders.view", "inventory.view", "inventory.maintain", "inventory.assign",
      "inventory.transfer", "inventory.receive", "inventory.purchase", "inventory.plan", "nav.projects"]);
    const installer = await makeUser("pickupreport", ["workOrders.view", "nav.projects"]);
    await request(warehouse, "POST", "/api/auth/local/login", worker.credentials);
    await request(tech, "POST", "/api/auth/local/login", installer.credentials);
    for (const id of ["correction-source", "correction-stage", "correction-vehicle"]) {
      const vehicle = id.endsWith("vehicle"), stage = id.endsWith("stage");
      await command("warehouse", { id, name: vehicle ? "Correction service vehicle" : stage ? "Correction staging shelf" : "Correction warehouse",
        code: id, type: vehicle ? "vehicle" : "physical", address: "Owned acceptance warehouse",
        ...(stage ? { locationTypeId: "57e15eca-f991-4328-a091-000000000003" } : {}),
        ...(vehicle ? { vin: "1HGCM82633A004351", plate: "CORRECT", plateState: "CO", userIds: [worker.user.id, installer.user.id] } : {}) }, crypto.randomUUID(), admin);
    }
    await command("item", { id: "correction-meter", sku: "COR-MTR", name: "Correction meter", tracking: "serialized" });
    await command("item", { id: "correction-part", sku: "COR-PART", name: "Correction fitting", tracking: "regular" });
    await command("vendor", { id: "correction-vendor", name: "Correction vendor" });
    await command("order", { id: "correction-po", type: "purchase", vendorId: "correction-vendor", destinationId: "correction-source",
      lines: [{ itemId: "correction-meter", quantity: 4 }, { itemId: "correction-part", quantity: 4 }] });
    await command("release", { orderId: "correction-po" });
    await command("receive", { orderId: "correction-po", lines: [{ itemId: "correction-meter", quantity: 4,
      serials: ["COR-001", "COR-002", "COR-003", "COR-004"] }, { itemId: "correction-part", quantity: 4 }] });
    const services = await request(admin, "GET", "/api/service-types");
    const work = await request(admin, "POST", `/api/projects/${fixture.projectId}/work-orders`, {
      customerWoId: "CORRECT-CUSTOMER-ORDER", customerName: "Correction customer", serviceType: services[0].code,
      status: "Scheduled", assignedUserId: installer.user.id, scheduledAt: new Date(Date.now() + 86400000).toISOString() });
    await command("plan", { workOrderId: work.id, revision: 0, lines: [
      { id: crypto.randomUUID(), itemId: "correction-meter", kind: "addition", quantity: 2, reason: "Test meters" },
      { id: crypto.randomUUID(), itemId: "correction-part", kind: "addition", quantity: 2, reason: "Test parts" }] });
    const discovery = await request(warehouse, "GET", `${inventory}/fulfillment`), id = crypto.randomUUID();
    await command("fulfillmentCreate", { id, name: "Scheduled correction pickup", mode: "scheduled",
      sourceId: "correction-source", stagingId: "correction-stage", vehicleId: "correction-vehicle",
      workOrders: [{ workOrderId: work.id, assignmentVersion: discovery.orders.find(row => row.workOrderId === work.id).assignmentVersion }] });
    const firstPull = crypto.randomUUID();
    await command("fulfillmentMove", { id, revision: 1, phase: "stage", physicallyConfirmed: true,
      reason: "Physical stock moved to the staging shelf", lines: [
        { itemId: "correction-meter", quantity: 2, serials: ["COR-001", "COR-002"] },
        { itemId: "correction-part", quantity: 2, serials: [] }] }, firstPull);
    const snapshot = () => request(warehouse, "GET", inventory);
    const notices = () => request(tech, "GET", "/api/inventory/pickups");
    let state = (await snapshot()).state;
    const original = structuredClone(state), reportId = crypto.randomUUID();
    const reportBody = { operationId: reportId, revision: 2, itemId: "correction-meter", category: "wrong_serial",
      description: "Actual staged meter is COR-003, not COR-001." };
    assert.equal((await tech.request.get(inventory)).status(), 403);
    await request(tech, "POST", `/api/inventory/pickups/${fixture.projectId}/${id}/problem`, reportBody);
    await request(tech, "POST", `/api/inventory/pickups/${fixture.projectId}/${id}/problem`, reportBody);
    let pickup = (await notices()).pickups.find(row => row.batchId === id);
    assert.equal(pickup.status, "review"); assert.equal(pickup.issues.length, 1);
    assert.deepEqual((await snapshot()).state.stock, original.stock);
    const stale = await warehouse.request.post(`${inventory}/commands`, { data: { operationId: crypto.randomUUID(), action: "fulfillmentMove",
      data: { id, revision: 3, phase: "vehicle", lines: [{ itemId: "correction-meter", quantity: 1, serials: ["COR-002"] }],
        reason: "Attempted pickup while a review is outstanding", physicallyConfirmed: true } } });
    assert.equal(stale.status(), 409);
    const denied = await tech.request.post(`${inventory}/commands`, { data: { operationId: crypto.randomUUID(), action: "fulfillmentCorrect", data: {} } });
    assert.equal(denied.status(), 403);
    const correctionData = { id, revision: 3, mode: "recording", lines: [
      { itemId: "correction-meter", quantity: 2, serials: ["COR-002", "COR-003"] },
      { itemId: "correction-part", quantity: 1, serials: [] }], observedReturns: [], confirmed: true, sourceVerified: true, ready: true,
      reason: "Verified staged serials and fitting quantity against original source" };
    const correctionId = crypto.randomUUID();
    await command("fulfillmentCorrect", correctionData, correctionId);
    await command("fulfillmentCorrect", correctionData, correctionId);
    state = (await snapshot()).state;
    assert.equal(state.fulfillmentBatches.find(row => row.id === id).revision, 4);
    assert.deepEqual(state.receipts.find(row => row.id === firstPull), original.receipts.find(row => row.id === firstPull));
    assert.equal(state.receipts.filter(row => row.id === correctionId).length, 1);
    pickup = (await notices()).pickups.find(row => row.batchId === id);
    assert.equal(pickup.status, "partial"); assert.deepEqual(pickup.items.find(row => row.itemId === "correction-meter").serials.sort(), ["COR-002", "COR-003"]);
    const ticket = await warehouse.request.get(`${inventory}/fulfillment/${id}/pick-ticket`);
    assert.match(await ticket.text(), /Revision 4/);
    const combined = await warehouse.request.get(`${inventory}/print/fulfillment/${id}`);
    assert.match(await combined.text(), /Before:.*COR-001/s);
    const techPage = await tech.newPage();
    await techPage.goto(`${baseURL}/projects/${fixture.projectId}/work-orders?pickup=${id}`);
    await techPage.getByTestId("pickup-report-problem").click();
    await techPage.getByTestId("pickup-report-item").click();
    await techPage.getByRole("option", { name: "Correction meter · COR-MTR", exact: true }).click();
    await techPage.locator("#pickup-issue-description").fill("Actual replacement meter on the shelf is COR-004, not COR-003.");
    await techPage.getByTestId("pickup-issue-submit").click();
    await expect.poll(async () => (await notices()).pickups.find(row => row.batchId === id)?.status).toBe("review");
    const page = await warehouse.newPage();
    const launchCorrections = async () => {
      const start = page.getByRole("button", { name: "Start Inventory", exact: true });
      await expect(start.or(page.getByRole("button", { name: /Fulfill \/ Stage Work Orders/ }))).toBeVisible();
      if (await start.isVisible()) await start.click();
      await page.getByRole("button", { name: /Fulfill \/ Stage Work Orders/ }).click();
      await page.getByTestId("fulfillment-open-corrections-chooser").click();
    };
    await page.goto(`${baseURL}/projects/${fixture.projectId}/inventory`);
    await launchCorrections();
    await page.getByTestId(`staging-correction-batch-${id}`).click();
    const serials = page.getByTestId("staging-correction-serials-correction-meter");
    await serials.fill("COR-002\n");
    await serials.press("End");
    await serials.type("COR-004");
    await serials.press("Enter");
    await expect(serials).toHaveValue("COR-002\nCOR-004\n");
    await serials.type("COR-004");
    await serials.press("Enter");
    assert.equal((await serials.inputValue()).split(/\n/).filter(token => token === "COR-004").length, 1);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await launchCorrections();
    await expect(serials).toHaveValue("COR-002\nCOR-004\n");
    await page.getByTestId("staging-correction-identify-next").click();
    await page.getByTestId("staging-correction-reason").fill("Verified the corrected serials with the physical staging shelf and source.");
    await page.getByTestId("staging-correction-source-verified").check();
    await page.getByTestId("staging-correction-verify-next").click();
    await page.getByTestId("staging-correction-confirmed").check();
    await page.getByTestId("staging-correction-ready").check();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const dialog = page.getByTestId("inventory-fulfillment-page");
    await fs.mkdir("generated-artifacts/inventory-staging-corrections", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory-staging-corrections/review-phone.png" });
    await expect.poll(async () => {
      const bounds = await dialog.boundingBox();
      return !!bounds && bounds.x >= -1 && bounds.x + bounds.width <= 391;
    }, { message: "Settled correction dialog fits the phone viewport." }).toBe(true);
    assert.equal(await page.getByTestId("fulfillment-step-body").evaluate(body => body.scrollWidth <= body.clientWidth + 1), true);
    let lostCorrection = null;
    await page.route(`**${inventory}/commands`, async route => {
      const body = route.request().postDataJSON();
      if (body.action === "fulfillmentCorrect" && !lostCorrection) {
        lostCorrection = body.operationId;
        const response = await route.fetch();
        assert.equal(response.ok(), true, await response.text());
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByTestId("staging-correction-submit").click();
    await expect.poll(async () => (await notices()).pickups.find(row => row.batchId === id)?.items.find(row =>
      row.itemId === "correction-meter")?.serials.sort().join(",")).toBe("COR-002,COR-004");
    state = (await snapshot()).state;
    assert.equal(state.fulfillmentBatches.find(row => row.id === id).issues.filter(row => row.status === "open").length, 0);
    await expect(techPage.getByText("Pickup needs review", { exact: true })).toHaveCount(0, { timeout: 20000 });
    await page.reload();
    await launchCorrections();
    const retry = page.getByRole("button", { name: "Retry exact saved command", exact: true });
    if (await retry.first().isVisible()) await retry.first().click();
    state = (await snapshot()).state;
    assert.ok(lostCorrection);
    assert.equal(state.receipts.filter(row => row.id === lostCorrection).length, 1);
    assert.equal(state.fulfillmentBatches.find(row => row.id === id).revision, 6);
    console.log("PASS isolated technician report, paused handoff, role enforcement, exact retries, corrected custody, notices and revisioned print history.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
