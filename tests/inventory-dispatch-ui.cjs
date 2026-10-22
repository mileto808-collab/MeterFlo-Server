const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const admin = await browser.newContext({ baseURL });
  const contexts = [await browser.newContext({ baseURL }), await browser.newContext({ baseURL })];
  const root = `/api/projects/${fixture.projectId}`, inv = `${root}/inventory`;
  const request = async (method, url, data, context = admin) => {
    const r = await context.request.fetch(url, { method, data });
    assert.ok(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const cmd = (action, data) => request("POST", `${inv}/commands`, { operationId: crypto.randomUUID(), action, data });
  try {
    await request("POST", "/api/auth/local/login", fixture);
    const role = (await request("GET", "/api/subroles")).find(r => r.key === "field_technician");
    assert.ok(role);
    const existingPermissions = await request("GET", `/api/subroles/${role.id}/permissions`);
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: [...new Set([...existingPermissions,
      "workOrders.view", "workOrders.meterChangeout", "inventory.view", "inventory.assign", "nav.projects"])] });
    const groups = [];
    const users = [];
    for (let i = 0; i < 2; i++) {
      const group = await request("POST", "/api/user-groups", { name: `Dispatch ${i} ${crypto.randomUUID().slice(0,8)}`, projectIds: [fixture.projectId] });
      groups.push(group);
      const login = { username: `dispatch-${crypto.randomUUID().slice(0,8)}`, password: `Aa1!${crypto.randomUUID()}` };
      users.push(await request("POST", "/api/users", { ...login, firstName: "Dispatch", lastName: `Tech ${i}`,
        role: "user", subroleId: role.id, projectIds: [fixture.projectId], groupIds: [group.id] }));
      await request("POST", "/api/auth/local/login", login, contexts[i]);
    }
    const services = await request("GET", "/api/service-types");
    const create = (name, group = groups[0]) => request("POST", `${root}/work-orders`, {
      customerWoId: name, customerName: "Dispatch customer", serviceType: services[0].code,
      status: "Open", assignedGroupId: group.name, oldSystemId: `OLD-${name}`, route: "644",
    });
    const first = await create("DISPATCH-FIRST");
    const second = await create("DISPATCH-SECOND");
    const free = await create("DISPATCH-NO-MATERIAL");
    await cmd("warehouse", { id: "ds-source", code: "DS-SOURCE", name: "Dispatch source", type: "physical", address: "100 Test Road" });
    await cmd("warehouse", { id: "ds-stage", code: "DS-STAGE", name: "Dispatch staging", type: "physical",
      locationTypeId: "57e15eca-f991-4328-a091-000000000003", address: "100 Test Road" });
    const van = { id: "ds-van", code: "DS-VAN", name: "Dispatch vehicle", type: "vehicle",
      vin: "1HGCM82633A004352", plate: "TEST", plateState: "CO", userIds: [users[0].id] };
    await cmd("warehouse", van);
    await cmd("item", { id: "ds-meter", sku: "DS-METER", name: "Dispatch meter", tracking: "serialized", equipment: "system" });
    await cmd("vendor", { id: "ds-vendor", name: "Dispatch vendor" });
    await cmd("order", { id: "ds-po", type: "purchase", vendorId: "ds-vendor", destinationId: "ds-source",
      lines: [{ itemId: "ds-meter", quantity: 3 }] });
    await cmd("release", { orderId: "ds-po" });
    await cmd("receive", { orderId: "ds-po", lines: [{ itemId: "ds-meter", quantity: 3, serials: ["DS-1", "DS-2", "DS-3"] }] });
    for (const work of [first, second]) await cmd("plan", { workOrderId: work.id, revision: 0,
      lines: [{ id: crypto.randomUUID(), itemId: "ds-meter", kind: "addition", quantity: 1, reason: "Dispatch test material" }] });
    const list = context => request("GET", `${root}/work-orders`, undefined, context);
    assert.ok(!(await list(contexts[0])).some(w => w.id === first.id), "bulk group cannot bypass unstaged dispatch");
    assert.ok((await list(contexts[0])).some(w => w.id === free.id), "no-material exception retains group behavior");
    const discovery = await request("GET", `${inv}/fulfillment`);
    const id = crypto.randomUUID();
    await cmd("fulfillmentCreate", { id, name: "Route 644", mode: "crew", sourceId: "ds-source",
      stagingId: "ds-stage", vehicleId: "ds-van", workOrders: [first, second].map(w => ({
        workOrderId: w.id, assignmentVersion: discovery.orders.find(o => o.workOrderId === w.id).assignmentVersion })) });
    const getBatch = async () => (await request("GET", `${inv}/fulfillment`)).batches.find(b => b.id === id);
    const plan = async (workOrderId, quantity) => {
      const details = await request("GET", `${root}/work-orders/${workOrderId}/inventory`);
      return cmd("plan", { workOrderId, revision: details.plan.revision,
        lines: [{ id: crypto.randomUUID(), itemId: "ds-meter", kind: "addition", quantity, reason: "Reviewed dispatch quantity" }] });
    };
    await plan(first.id, 2);
    assert.equal((await getBatch()).lines.find(l => l.workOrderId === first.id).quantity, 2, "never-posted plans rebase without repicking");
    await plan(first.id, 1);
    await cmd("fulfillmentMove", { id, revision: (await getBatch()).revision, phase: "stage",
      reason: "Picked and verified at staging", physicallyConfirmed: true,
      lines: [{ itemId: "ds-meter", quantity: 2, serials: ["DS-1", "DS-2"] }] });
    let shown = (await list(contexts[0])).find(w => w.id === first.id);
    assert.equal(shown.inventoryDispatch.stage, "awaiting_pickup");
    assert.equal(shown.inventoryDispatch.canStart, false);
    assert.match(shown.inventoryDispatch.receiptNumber, /^PICK-/);
    const currentPlan = (await request("GET", `${root}/work-orders/${first.id}/inventory`)).plan;
    const changed = await admin.request.post(`${inv}/commands`, { data: { action: "plan", operationId: crypto.randomUUID(),
      data: { workOrderId: first.id, revision: currentPlan.revision, lines: [{ id: crypto.randomUUID(),
        itemId: "ds-meter", kind: "addition", quantity: 2, reason: "Unsafe material change after staging" }] } } });
    assert.equal(changed.status(), 409, await changed.text());
    assert.match((await changed.json()).message, /Stock has already moved/);
    assert.equal((await getBatch()).lines.find(l => l.workOrderId === first.id).quantity, 1);
    await request("PATCH", `${root}/work-orders/${first.id}`, { notes: "Safe metadata edit after staging" });
    const premature = await contexts[0].request.post(`${root}/work-orders/${first.id}/claim`);
    assert.equal(premature.status(), 409, await premature.text());
    assert.ok(!(await list(contexts[1])).some(w => w.id === first.id), "unrelated group cannot see vehicle batch");
    const page = await contexts[0].newPage();
    await page.goto(`/projects/${fixture.projectId}/work-orders`);
    await expect(page.getByTestId(`row-work-order-${first.id}`)).toBeVisible();
    await expect(page.getByTestId(`row-work-order-${first.id}`)).toContainText("Awaiting pickup");
    await page.screenshot({ path: "generated-artifacts/project-workspace/dispatch-awaiting-pickup.jpg" });
    await cmd("fulfillmentMove", { id, revision: (await getBatch()).revision, phase: "vehicle",
      reason: "Crew verified loading their vehicle", physicallyConfirmed: true,
      lines: [{ itemId: "ds-meter", quantity: 2, serials: ["DS-1", "DS-2"] }] });
    await expect(page.getByTestId(`row-work-order-${first.id}`)).toContainText("Ready for field");
    // Authorized help is an additional vehicle membership, not a work-order/group rewrite.
    await cmd("warehouse", { ...van, userIds: users.map(u => u.id) });
    shown = (await list(contexts[1])).find(w => w.id === first.id);
    assert.equal(shown.inventoryDispatch.canStart, true);
    const detail = await request("GET", `${root}/work-orders/${first.id}`, undefined, contexts[1]);
    assert.equal(detail.inventoryDispatch.vehicleId, "ds-van");
    const stock = await request("GET", `${root}/work-orders/${first.id}/inventory`, undefined, contexts[1]);
    assert.equal(stock.inventoryDispatch.vehicleId, "ds-van");
    const claims = await Promise.all(contexts.map(c => c.request.post(`${root}/work-orders/${first.id}/claim`)));
    assert.equal(claims.filter(r => r.ok()).length, 1, "one helper/crew claimant only");
    const winner = claims.findIndex(r => r.ok());
    assert.equal((await list(contexts[winner])).find(w => w.id === first.id).inventoryDispatch.canStart, true);
    const scheduled = await request("POST", `${root}/work-orders`, { customerWoId: "DISPATCH-SCHEDULED",
      serviceType: services[0].code, customerName: "Scheduled crew", status: "Scheduled", assignedUserId: users[0].id,
      scheduledAt: new Date(Date.now()+86400000).toISOString() });
    await cmd("plan", { workOrderId: scheduled.id, revision: 0, lines: [{ id: crypto.randomUUID(),
      itemId: "ds-meter", kind: "addition", quantity: 1, reason: "Scheduled dispatch" }] });
    const scheduledCandidate = (await request("GET", `${inv}/fulfillment`)).orders.find(o => o.workOrderId === scheduled.id);
    const scheduledBatchId = crypto.randomUUID();
    await cmd("fulfillmentCreate", { id: scheduledBatchId, name: "Scheduled dispatch", mode: "scheduled",
      sourceId: "ds-source", stagingId: "ds-stage", vehicleId: "ds-van",
      workOrders: [{ workOrderId: scheduled.id, assignmentVersion: scheduledCandidate.assignmentVersion }] });
    const scheduledBatch = async () => (await request("GET", `${inv}/fulfillment`)).batches.find(b => b.id === scheduledBatchId);
    for (const phase of ["stage", "vehicle"]) await cmd("fulfillmentMove", { id: scheduledBatchId,
      revision: (await scheduledBatch()).revision, phase, reason: "Verified scheduled vehicle stock", physicallyConfirmed: true,
      lines: [{ itemId: "ds-meter", quantity: 1, serials: ["DS-3"] }] });
    assert.equal((await list(contexts[1])).find(w => w.id === scheduled.id).inventoryDispatch.canStart, false);
    assert.equal((await contexts[1].request.post(`${root}/work-orders/${scheduled.id}/claim`)).status(), 409);
    await request("PATCH", `${root}/work-orders/${scheduled.id}`, { assignedUserId: users[1].id });
    assert.equal((await list(contexts[1])).find(w => w.id === scheduled.id).inventoryDispatch.canStart, true,
      "explicit scheduled reassignment within the holding vehicle does not require repicking");
    assert.ok((await contexts[1].request.post(`${root}/work-orders/${scheduled.id}/claim`)).ok());
    // Removing helper membership revokes unclaimed shared work without moving stock.
    await cmd("warehouse", van);
    assert.ok(!(await list(contexts[1])).some(w => w.id === second.id));
    // Inventory-off regression: restore the original shared group pool.
    await request("PATCH", root, { inventoryEnabled: false });
    assert.ok((await list(contexts[0])).some(w => w.id === second.id));
    console.log("PASS: ordinary role management, unstaged hiding, no-material exception, staging visibility, blocked early claim, SSE handoff refresh, cross-group vehicle help, detail/inventory scope, competing claims, access revocation, inventory-disabled group pool.");
  } finally {
    await Promise.all([admin, ...contexts].map(c => c.close()));
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
