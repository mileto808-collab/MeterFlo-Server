const { request: playwrightRequest } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

// Real HTTP, authentication, visibility projections and PostgreSQL transactions.
// Only the owned sandbox is accepted; never impersonates an existing live account.
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const admin = await playwrightRequest.newContext({ baseURL });
  const tech = await playwrightRequest.newContext({ baseURL });
  const inventory = `/api/projects/${fixture.projectId}/inventory`;
  const endpoint = `/api/projects/${fixture.projectId}/mobile/sync/download`;
  async function api(context, method, path, data, expected = method === "GET" ? 200 : null) {
    const response = await context.fetch(path, { method, data });
    assert.ok(expected === null ? response.ok() : response.status() === expected,
      `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  }
  const command = (action, data) => api(admin, "POST", `${inventory}/commands`,
    { action, data, operationId: randomUUID() });
  try {
    await api(admin, "POST", "/api/auth/local/login", fixture);
    const roles = await api(admin, "GET", "/api/subroles");
    const fieldRole = roles.find(role => role.key === "field_technician");
    assert.ok(fieldRole, "Use the real field-technician authorization path.");
    const permissions = ["workOrders.view", "nav.projects", "inventory.view", "inventory.assign", "inventory.plan"];
    await api(admin, "PUT", `/api/subroles/${fieldRole.id}/permissions`, { permissions });
    const credentials = { username: "demotech", password: `Aa1!${randomUUID()}` };
    const user = await api(admin, "POST", "/api/users", { ...credentials, firstName: "Sync", lastName: "Technician",
      role: "user", subroleId: fieldRole.id, projectIds: [fixture.projectId] });
    await api(tech, "POST", "/api/auth/local/login", credentials);
    const group = await api(admin, "POST", "/api/user-groups",
      { name: "Mobile sync crew", projectIds: [fixture.projectId] });
    await api(admin, "POST", `/api/user-groups/${group.id}/members`, { userId: user.id });
    for (const [id, type] of [["sync-source", "physical"], ["sync-stage", "physical"], ["sync-vehicle", "vehicle"]]) {
      await command("warehouse", { id, name: id, code: id, type, address: "Owned sync fixture",
        ...(id === "sync-stage" ? { locationTypeId: "57e15eca-f991-4328-a091-000000000003" } : {}),
        ...(type === "vehicle" ? { vin: "1HGCM82633A004352", plate: "SYNC", plateState: "CO", userIds: [user.id] } : {}) });
    }
    await command("item", { id: "sync-meter", sku: "SYNC", name: "Sync meter", tracking: "serialized", equipment: "system" });
    await command("vendor", { id: "sync-vendor", name: "Sync vendor" });
    await command("order", { id: "sync-po", type: "purchase", vendorId: "sync-vendor", destinationId: "sync-source",
      lines: [{ itemId: "sync-meter", quantity: 1 }] });
    await command("release", { orderId: "sync-po" });
    await command("receive", { orderId: "sync-po", lines: [{ itemId: "sync-meter", quantity: 1, serials: ["SYNC-001"] }] });
    const services = await api(admin, "GET", "/api/service-types");
    async function work(label, groupName = group.name) {
      const created = await api(admin, "POST", `/api/projects/${fixture.projectId}/work-orders`, {
        customerWoId: label, customerName: "Owned sync fixture", serviceType: services[0].code,
        status: "Open", assignedGroupId: groupName,
      });
      await command("plan", { workOrderId: created.id, revision: 0,
        lines: [{ id: randomUUID(), itemId: "sync-meter", kind: "addition", quantity: 1, reason: "Sync authorization fixture" }] });
      return created;
    }
    const stagedWork = await work("SYNC-STAGED");
    const unpickedWork = await work("SYNC-UNPICKED");
    const otherGroup = await api(admin, "POST", "/api/user-groups",
      { name: "Other mobile crew", projectIds: [fixture.projectId] });
    const unrelatedWork = await work("SYNC-OTHER", otherGroup.name);
    const candidate = (await api(admin, "GET", `${inventory}/fulfillment`)).orders
      .find(order => order.workOrderId === stagedWork.id);
    const batchId = randomUUID();
    await command("fulfillmentCreate", { id: batchId, name: "Mobile sync batch", mode: "crew",
      sourceId: "sync-source", stagingId: "sync-stage", vehicleId: "sync-vehicle",
      workOrders: [{ workOrderId: stagedWork.id, assignmentVersion: candidate.assignmentVersion }] });
    await command("fulfillmentMove", { id: batchId, revision: 1, phase: "stage", physicallyConfirmed: true,
      reason: "Meter physically placed on the staging shelf",
      lines: [{ itemId: "sync-meter", quantity: 1, serials: ["SYNC-001"] }] });
    const before = (await api(admin, "GET", inventory)).state.revision;
    const full = await api(tech, "GET", `${endpoint}?includeCompleted=false`);
    assert.deepEqual(full.workOrders.map(order => order.id), [stagedWork.id]);
    assert.equal(full.workOrders[0].inventoryDispatch.stage, "awaiting_pickup");
    assert.equal(full.workOrders[0].inventoryDispatch.canStart, false);
    assert.equal(full.inventory.enabled, true);
    assert.equal(full.meta.visibility.complete, true);
    assert.equal(full.meta.visibility.scope.userId, user.id);
    assert.equal(full.meta.visibility.scope.projectId, fixture.projectId);
    assert.equal(full.meta.count, 1);
    assert.ok(full.inventory.warehouses.some(warehouse => warehouse.id === "sync-vehicle"));
    const delta = await api(tech, "GET", `${endpoint}?includeCompleted=false&lastSyncTimestamp=2000-01-01T00%3A00%3A00.000Z`);
    assert.deepEqual(delta.workOrders.map(order => order.id), [stagedWork.id]);
    assert.equal(delta.meta.visibility.complete, false);
    assert.equal(delta.meta.visibility.mode, "delta");
    const watermarkDelta = await api(tech, "GET", `${endpoint}?includeCompleted=false&lastSyncTimestamp=${encodeURIComponent(full.serverTimestamp)}`);
    assert.equal(watermarkDelta.meta.visibility.complete, false);
    assert.ok(watermarkDelta.workOrders.every(order => order.id === stagedWork.id));
    assert.equal((await api(admin, "GET", inventory)).state.revision, before, "Downloads must not mutate inventory.");
    console.log("PASS full and timestamp downloads authenticate demotech, return only vehicle-authorized staged work, and preserve read-only snapshots and visibility metadata.");

    await command("fulfillmentMove", { id: batchId, revision: 2, phase: "vehicle", physicallyConfirmed: true,
      reason: "Meter physically verified and loaded into vehicle",
      lines: [{ itemId: "sync-meter", quantity: 1, serials: ["SYNC-001"] }] });
    const handedOff = await api(tech, "GET", `${endpoint}?includeCompleted=false`);
    assert.equal(handedOff.workOrders[0].inventoryDispatch.stage, "ready_for_field");
    assert.equal(handedOff.workOrders[0].inventoryDispatch.canStart, true);
    await api(admin, "PUT", `/api/subroles/${fieldRole.id}/permissions`,
      { permissions: permissions.filter(permission => !permission.startsWith("inventory.")) });
    await api(tech, "GET", endpoint, undefined, 403);
    await api(admin, "PATCH", `/api/projects/${fixture.projectId}`, { inventoryEnabled: false });
    for (const query of ["includeCompleted=false", "includeCompleted=true", "includeCompleted=false&lastSyncTimestamp=2000-01-01T00%3A00%3A00.000Z"]) {
      const disabled = await api(tech, "GET", `${endpoint}?${query}`);
      assert.deepEqual(disabled.workOrders.map(order => order.id).sort(), [stagedWork.id, unpickedWork.id].sort());
      assert.ok(!disabled.workOrders.some(order => order.id === unrelatedWork.id));
      assert.equal(disabled.inventory.enabled, false);
      assert.equal(disabled.meta.visibility.scope.activeOnly, true);
    }
    console.log("PASS handoff updates dispatch, missing inventory permission is denied, and disabled inventory retains group scope without requiring inventory grants.");
  } finally {
    await tech.dispose();
    await admin.dispose();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
