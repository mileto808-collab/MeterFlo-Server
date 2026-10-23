const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const admin = await browser.newContext({ baseURL });
  const operator = await browser.newContext({ baseURL });
  const otherOperator = await browser.newContext({ baseURL });
  const techs = [await browser.newContext({ baseURL }), await browser.newContext({ baseURL })];
  const root = `/api/projects/${fixture.projectId}`, inv = `${root}/inventory`;
  let handoverPage;
  const request = async (method, path, data, context = admin) => {
    const response = await context.request.fetch(path, { method, data });
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const cmd = (action, data, context = admin) =>
    request("POST", `${inv}/commands`, { operationId: crypto.randomUUID(), action, data }, context);
  const list = context => request("GET", `${root}/work-orders`, undefined, context);
  try {
    await request("POST", "/api/auth/local/login", fixture);
    const fieldRole = (await request("GET", "/api/subroles")).find(role => role.key === "field_technician");
    await request("PUT", `/api/subroles/${fieldRole.id}/permissions`, { permissions: [
      "nav.projects", "workOrders.view", "workOrders.edit", "workOrders.meterChangeout", "inventory.view", "inventory.assign", "inventory.plan",
    ] });
    const permissions = ["nav.projects", "workOrders.view", "workOrders.edit", "workOrders.assign",
      "inventory.view", "inventory.assign", "inventory.transfer", "inventory.receive"];
    const role = await request("POST", "/api/subroles", { key: `handover_${crypto.randomUUID().slice(0, 8)}`,
      label: "Owned vehicle handover operator", baseRole: "user", permissions });
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions });
    const people = [];
    const groups = [];
    for (let i = 0; i < 3; i++) {
      if (i < 2) groups.push(await request("POST", "/api/user-groups", {
        name: `Handover crew ${i} ${crypto.randomUUID().slice(0, 8)}`, projectIds: [fixture.projectId],
      }));
      const credentials = { username: `handover-${i}-${crypto.randomUUID().slice(0, 8)}`, password: `Aa1!${crypto.randomUUID()}` };
      const user = await request("POST", "/api/users", { ...credentials, firstName: i === 2 ? "Warehouse" : `Crew ${i}`,
        lastName: "Handover", role: "user", subroleId: i === 2 ? role.id : fieldRole.id, projectIds: [fixture.projectId],
        ...(i < 2 ? { groupIds: [groups[i].id] } : {}) });
      people.push(user);
      await request("POST", "/api/auth/local/login", credentials, i === 2 ? operator : techs[i]);
    }
    const otherCredentials = { username: `handover-other-${crypto.randomUUID().slice(0, 8)}`, password: `Aa1!${crypto.randomUUID()}` };
    const otherUser = await request("POST", "/api/users", { ...otherCredentials, firstName: "Second", lastName: "Warehouse",
      role: "user", subroleId: role.id, projectIds: [fixture.projectId] });
    await request("POST", "/api/auth/local/login", otherCredentials, otherOperator);
    for (const id of ["vt-whse", "vt-stage"]) await cmd("warehouse", { id, code: id, name: id, type: "physical",
      address: "Owned handover fixture", ...(id === "vt-stage" ? { locationTypeId: "57e15eca-f991-4328-a091-000000000003" } : {}) });
    for (let i = 0; i < 2; i++) await cmd("warehouse", { id: `vt-${i}`, code: `VT${i}`, name: `Handover Vehicle ${i}`,
      type: "vehicle", vin: i ? "1HGCM82633A004353" : "1HGCM82633A004352", plate: `VT${i}`, plateState: "CO",
      userIds: [people[i].id, people[2].id, otherUser.id] });
    await cmd("vendor", { id: "vt-vendor", name: "Handover vendor" });
    await cmd("item", { id: "vt-meter", sku: "VT-METER", name: "Handover meter", tracking: "serialized" });
    await cmd("item", { id: "vt-part", sku: "VT-PART", name: "Spare fitting", tracking: "regular" });
    const receive = async (id, destinationId, itemId, quantity, serials = []) => {
      await cmd("order", { id, type: "purchase", vendorId: "vt-vendor", destinationId, lines: [{ itemId, quantity }] });
      await cmd("release", { orderId: id });
      await cmd("receive", { orderId: id, lines: [{ itemId, quantity, serials }] });
    };
    await receive("vt-po", "vt-whse", "vt-meter", 5, ["VT-A", "VT-B", "VT-C", "VT-D", "VT-E"]);
    await receive("vt-spares", "vt-0", "vt-part", 5);
    await require("./support/vehicle-transfer-draft-acceptance.cjs")({
      request, operator, otherOperator, tech: techs[0], inv,
    });
    const services = await request("GET", "/api/service-types");
    const works = [];
    for (let i = 0; i < 2; i++) {
      const work = await request("POST", `${root}/work-orders`, { customerWoId: `TAKEOVER-${i}`,
        serviceType: services[0].code, status: "Open", assignedGroupId: groups[0].name, address: "100 Owned Road" });
      works.push(work);
      await cmd("plan", { workOrderId: work.id, revision: 0, lines: [{ id: crypto.randomUUID(),
        itemId: "vt-meter", quantity: 1, kind: "addition", reason: "Picked work" }] });
    }
    const makeBatch = async (orders, mode, serials) => {
      const options = await request("GET", `${inv}/fulfillment`);
      const id = crypto.randomUUID();
      await cmd("fulfillmentCreate", { id, name: "Vehicle handover route", mode,
        sourceId: "vt-whse", stagingId: "vt-stage", vehicleId: "vt-0",
        workOrders: orders.map(work => ({ workOrderId: work.id,
          assignmentVersion: options.orders.find(order => order.workOrderId === work.id).assignmentVersion })) });
      const get = async () => (await request("GET", `${inv}/fulfillment`)).batches.find(batch => batch.id === id);
      for (const phase of ["stage", "vehicle"]) await cmd("fulfillmentMove", { id, revision: (await get()).revision,
        phase, lines: [{ itemId: "vt-meter", quantity: orders.length, serials }],
        reason: "Both crews verified this fixture custody", physicallyConfirmed: true });
      return get();
    };
    const batch = await makeBatch(works, "crew", ["VT-A", "VT-B"]);
    const originalLines = structuredClone(batch.lines);
    await request("POST", `${root}/work-orders/${works[1].id}/claim`, {}, techs[0]);
    await request("PUT", `${root}/work-orders/${works[1].id}/changeout-draft`, {
      baseRevision: 0, submissionId: crypto.randomUUID(), step: "inventory", capture: { technicianNote: "Field work in progress" },
    }, techs[0]);
    const blockedOptions = await request("GET", `${inv}/vehicle-transfers/options?sourceId=vt-0&batchId=${batch.id}&workOrderIds=${works[1].id}`, undefined, operator);
    const blockedBatch = blockedOptions.batches.find(value => value.id === batch.id);
    const blockedOrder = blockedBatch.workOrders.find(value => value.workOrderId === works[1].id);
    assert.equal(blockedOrder.eligible, false);
    assert.match(blockedOrder.reason, /draft/i);
    const blocked = await operator.request.post(`${inv}/commands`, { data: {
      operationId: crypto.randomUUID(), action: "vehicleTransfer", data: {
        mode: "work", revision: blockedOptions.revision, sourceId: "vt-0", destinationId: "vt-1",
        batchId: batch.id, batchRevision: blockedBatch.revision,
        workOrders: [{ workOrderId: works[1].id, assignmentVersion: blockedOrder.assignmentVersion }],
        lines: [{ itemId: "vt-meter", quantity: 1, serials: ["VT-B"] }],
        reason: "This must be blocked by a field draft", physicallyConfirmed: true,
      },
    } });
    assert.equal(blocked.status(), 409);
    assert.match(await blocked.text(), /draft/i);
    let options = await request("GET", `${inv}/vehicle-transfers/options?sourceId=vt-0`, undefined, operator);
    assert.equal(options.canWorkTransfer, true);
    // Stock-only uses the normal authorized handover, but never reassigns work.
    await cmd("vehicleTransfer", { mode: "stock", revision: options.revision, sourceId: "vt-0", destinationId: "vt-1",
      workOrders: [], lines: [{ itemId: "vt-part", quantity: 2, serials: [] }],
      reason: "Crews received the spare fittings", physicallyConfirmed: true }, operator);
    assert.equal((await request("GET", `${root}/work-orders/${works[0].id}`)).assigned_group_id, groups[0].name);
    assert.ok(!(await list(techs[1])).some(work => work.id === works[0].id));
    const denied = await techs[0].request.get(`${inv}/vehicle-transfers/options?sourceId=vt-0`);
    assert.equal(denied.status(), 403);
    const receivingPage = await techs[1].newPage();
    await receivingPage.goto(`/projects/${fixture.projectId}/work-orders`);
    await expect(receivingPage.getByText("TAKEOVER-0", { exact: true })).toHaveCount(0);
    const page = await operator.newPage();
    handoverPage = page;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByTestId("button-vehicle-transfers").first().click();
    const dialog = page.getByTestId("vehicle-transfer-dialog");
    await page.getByTestId("transfer-mode-work").click();
    await page.waitForTimeout(1100);
    assert.deepEqual((await request("GET", `${inv}/vehicle-transfer-drafts`, undefined, operator)).drafts, [],
      "opening a mode without real inputs must not create a ghost draft");
    const select = async (testId, name) => {
      await page.getByTestId(testId).click();
      await page.getByRole("option", { name, exact: false }).click();
    };
    await select("transfer-source", "Handover Vehicle 0");
    await select("transfer-destination", "Handover Vehicle 1");
    await select("transfer-batch", "Vehicle handover route");
    await page.getByTestId(`transfer-work-order-${works[0].id}`).click();
    const serials = page.locator("#transfer-serials-vt-meter");
    await serials.fill("NOT-IN-THIS-VEHICLE");
    await serials.press("Enter");
    await expect(serials).not.toHaveValue(/NOT-IN-THIS-VEHICLE/);
    await serials.fill("VT-A");
    await serials.press("Enter");
    await expect(serials).toHaveValue(/VT-A/);
    await page.getByTestId("transfer-reason").fill("Both crews verified the meter and outstanding work");
    let sharedDraft;
    await expect.poll(async () => {
      sharedDraft = (await request("GET", `${inv}/vehicle-transfer-drafts`, undefined, otherOperator)).drafts
        .find(value => value.capture.mode === "work" && value.capture.selectedOrders.includes(String(works[0].id)) &&
          value.capture.reason === "Both crews verified the meter and outstanding work" &&
          value.capture.scans["vt-meter"]?.includes("VT-A"));
      return !!sharedDraft;
    }).toBe(true);
    await page.reload();
    // Refresh preserves the wizard; shared captures resume from its draft list.
    await expect(page.getByTestId("vehicle-transfer-dialog")).toBeVisible();
    await page.locator(`[data-testid="transfer-draft-resume"][data-draft-id="${sharedDraft.id}"]`).click();
    await expect(serials).toHaveValue(/VT-A/);
    await expect(page.getByTestId("transfer-reason")).toHaveValue("Both crews verified the meter and outstanding work");
    await expect(page.getByTestId("transfer-review")).toBeEnabled();
    await page.getByTestId("transfer-review").click();
    await expect(page.getByTestId("transfer-physical-confirm")).not.toBeChecked();
    await page.getByTestId("transfer-physical-confirm").click();
    await fs.mkdir("generated-artifacts/vehicle-transfers", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/vehicle-transfers/desktop.jpg" });
    const desktopSize = page.viewportSize();
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
      await page.screenshot({ path: `generated-artifacts/vehicle-transfers/review-${viewport.width}.jpg` });
    }
    await page.setViewportSize(desktopSize);
    let committed;
    let forbiddenRetry = false;
    await page.route("**/inventory/commands", async route => {
      const data = route.request().postDataJSON();
      if (data.action === "vehicleTransfer" && !committed) {
        const response = await route.fetch();
        assert.ok(response.ok(), await response.text());
        committed = data;
        await route.abort("failed");
      } else if (data.action === "vehicleTransfer" && !forbiddenRetry) {
        forbiddenRetry = true;
        await route.fulfill({ status: 403, contentType: "application/json",
          body: JSON.stringify({ message: "Access is temporarily unavailable." }) });
      } else await route.continue();
    });
    await page.getByTestId("transfer-post").click();
    await expect(page.getByTestId("transfer-retry")).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => Boolean(committed), { timeout: 30_000 }).toBe(true);
    await expect(page.getByTestId("transfer-retry")).toBeEnabled();
    assert.ok(committed);
    const rejectedRetry = page.waitForResponse(response => response.url().endsWith("/inventory/commands") && response.status() === 403);
    await page.getByTestId("transfer-retry").click();
    await rejectedRetry;
    await expect(page.getByTestId("transfer-retry")).toBeEnabled();
    await page.reload();
    await expect(page.getByTestId("vehicle-transfer-dialog")).toBeVisible();
    await page.getByTestId("transfer-retry").click();
    await expect(dialog.getByRole("link", { name: /print.*receipt/i })).toBeVisible();
    await expect(receivingPage.getByText("TAKEOVER-0", { exact: true })).toBeVisible({ timeout: 15000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "generated-artifacts/vehicle-transfers/phone.jpg" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const received = await request("GET", `${inv}`, undefined, operator);
    const movedBatch = received.state.fulfillmentBatches.find(value => value.id === batch.id);
    assert.deepEqual(movedBatch.lines, originalLines, "original pick evidence survives takeover");
    assert.equal(movedBatch.workOrders.find(value => value.workOrderId === works[0].id).vehicleId, "vt-1");
    assert.equal(received.state.receipts.filter(value => value.id === committed.operationId).length, 1);
    assert.deepEqual(received.state.receipts.find(value => value.id === committed.operationId).workOrderIds, [works[0].id]);
    assert.equal(received.state.stock.find(value => value.warehouseId === "vt-1" && value.itemId === "vt-meter").quantity, 1);
    assert.equal((await list(techs[0])).some(work => work.id === works[0].id), false);
    const newList = await list(techs[1]);
    assert.equal(newList.find(work => work.id === works[0].id).inventoryDispatch.vehicleId, "vt-1");
    assert.ok((await list(techs[0])).some(work => work.id === works[1].id));
    const detail = await request("GET", `${root}/work-orders/${works[0].id}/inventory`, undefined, techs[1]);
    assert.equal(detail.inventoryDispatch.canStart, true);
    const print = await operator.request.get(`${inv}/print/receipt/${committed.operationId}`);
    assert.ok(print.ok());
    assert.match(await print.text(), /Handover Vehicle 0/);
    assert.match(await print.text(), /TAKEOVER-0/);
    assert.doesNotMatch(await print.text(), new RegExp(batch.id));
    const scheduled = await request("POST", `${root}/work-orders`, { customerWoId: "TAKEOVER-SCHEDULED",
      serviceType: services[0].code, status: "Scheduled", assignedUserId: people[0].id,
      scheduledAt: new Date(Date.now() + 3600000).toISOString() });
    await cmd("plan", { workOrderId: scheduled.id, revision: 0, lines: [{
      id: crypto.randomUUID(), itemId: "vt-meter", quantity: 1, kind: "addition", reason: "" }] });
    const scheduledBatch = await makeBatch([scheduled], "scheduled", ["VT-C"]);
    options = await request("GET", `${inv}/vehicle-transfers/options?sourceId=vt-0&batchId=${scheduledBatch.id}&workOrderIds=${scheduled.id}`, undefined, operator);
    const selected = options.batches.find(batch => batch.id === scheduledBatch.id).workOrders.find(work => work.workOrderId === scheduled.id);
    const payload = { mode: "work", revision: options.revision, sourceId: "vt-0", destinationId: "vt-1",
      batchId: scheduledBatch.id, batchRevision: scheduledBatch.revision,
      workOrders: [{ workOrderId: scheduled.id, assignmentVersion: selected.assignmentVersion }],
      lines: [{ itemId: "vt-meter", quantity: 1, serials: ["VT-C"] }], reason: "Receiving installer verified handover", physicallyConfirmed: true };
    const missingInstaller = await operator.request.post(`${inv}/commands`, { data: {
      operationId: crypto.randomUUID(), action: "vehicleTransfer", data: payload,
    } });
    assert.equal(missingInstaller.status(), 409);
    await cmd("vehicleTransfer", { ...payload, installerId: people[1].id }, operator);
    const scheduledDetails = await request("GET", `${root}/work-orders/${scheduled.id}/inventory`, undefined, techs[1]);
    assert.equal(scheduledDetails.inventoryDispatch.canStart, true);
    assert.equal(scheduledDetails.allocation.lines[0].warehouseId, "vt-1");
    assert.equal((await request("GET", `${root}/work-orders/${scheduled.id}`)).assigned_user_id, people[1].id);
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: permissions.filter(key => key !== "inventory.transfer") });
    assert.equal((await operator.request.post(`${inv}/commands`, { data: {
      operationId: crypto.randomUUID(), action: "vehicleTransfer", data: { ...payload, installerId: people[1].id },
    } })).status(), 403);
    assert.deepEqual(errors, []);
    console.log("PASS normal warehouse/technician permissions, stock-only isolation, immediate scan rejection, selected-work takeover, atomic assignment/custody, live dispatch scope, unknown-outcome browser recovery, replay exactly once, preserved pick history, scheduled installer/holds, receipt printing and phone layout.");
  } finally {
    await handoverPage?.unrouteAll({ behavior: "ignoreErrors" });
    await operator.close(); await admin.close(); await Promise.all(techs.map(context => context.close())); await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
