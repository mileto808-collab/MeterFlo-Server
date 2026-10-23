const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const pg = require("pg");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const admin = await browser.newContext({ baseURL }), tech = await browser.newContext({ baseURL }), outsider = await browser.newContext({ baseURL });
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const root = `/api/projects/${fixture.projectId}`;
  async function api(method, url, data, context = admin) {
    const r = await context.request.fetch(url, { method, data });
    assert.ok(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  }
  const command = async (action, data) => (await api("POST", `${root}/inventory/commands`, { action, data, operationId: randomUUID() })).state;
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
  await db.connect();
  try {
    await api("POST", "/api/auth/local/login", fixture);
    await api("PATCH", root, { inventoryEnabled: false, wizardMode: "changeout", changeoutEquipmentType: "both",
      wizardShowBeforePhotosStep: false, wizardShowAfterPhotosStep: false, wizardShowSignatureStep: false,
      wizardShowNotesStep: false, wizardGpsMode: "disabled" });
    const roles = await api("GET", "/api/subroles");
    const role = roles.find(r => r.key === "field_technician");
    const existingPermissions = await api("GET", `/api/subroles/${role.id}/permissions`);
    const keys = (Array.isArray(existingPermissions) ? existingPermissions : existingPermissions.permissions).map(p => typeof p === "string" ? p : p.key ?? p.permissionKey);
    await api("PUT", `/api/subroles/${role.id}/permissions`, { permissions: [...new Set([...keys,
      "workOrders.view", "workOrders.meterChangeout", "inventory.view", "inventory.assign"])] });
    const users = [];
    for (const [context, suffix] of [[tech, "owner"], [outsider, "outside"]]) {
      const credentials = { username: `replace-${suffix}-${randomUUID().slice(0, 7)}`, password: `Aa1!${randomUUID()}` };
      users.push(await api("POST", "/api/users", { ...credentials, role: "user", subroleId: role.id,
        firstName: "Synthetic", lastName: suffix, projectIds: [fixture.projectId] }));
      await api("POST", "/api/auth/local/login", credentials, context);
    }
    const project = await api("GET", root);
    const schema = project.databaseName;
    assert.match(schema, /^project_[a-z0-9_]+$/);
    const services = await api("GET", "/api/service-types");
    const systemType = (await api("GET", "/api/system-types"))[0];
    await db.query("INSERT INTO public.system_type_projects(system_type_id,project_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [systemType.id, fixture.projectId]);
    const makeOriginal = async (suffix, type = null) => {
      const w = await api("POST", `${root}/work-orders`, { customerWoId: `ORIGINAL-${suffix}`, status: "Open",
        serviceType: services[0].code, customerName: "Synthetic replacement site", oldSystemId: `OLD-${suffix}`,
        newSystemType: type, assignedUserId: users[0].id });
      return api("PATCH", `${root}/work-orders/${w.id}`, { status: "Completed", oldSystemReading: "0001",
        newSystemReading: "0000", newSystemId: `INITIAL-${suffix}`, signatureData: png, signatureName: "Synthetic",
        changeoutSubmissionId: randomUUID(), changeoutAssignmentVersion: w.assignmentVersion ?? 0 });
    };
    const disabledOriginal = await makeOriginal("disabled");
    let path = `${root}/work-orders/${disabledOriginal.id}/replacement`;
    let eligibility = await api("GET", path, undefined, tech);
    assert.ok(eligibility.canCreate);
    assert.equal(eligibility.inventoryEnabled, false);
    assert.equal((await outsider.request.get(path)).status(), 403);
    const disabledInput = { operationId: randomUUID(), predecessorFingerprint: eligibility.predecessorFingerprint,
      equipment: "system", reason: "Defective system after installation", vehicleId: null };
    const created = await api("POST", path, disabledInput, tech);
    assert.equal(created.workOrder.oldSystemId, "INITIAL-disabled");
    assert.equal(created.workOrder.oldModuleId, null);
    assert.equal(created.replacementVisit.equipment, "system");
    const replay = await api("POST", path, disabledInput, tech);
    assert.equal(replay.workOrder.id, created.workOrder.id);
    assert.equal(replay.replay, true);
    assert.equal((await tech.request.post(path, { data: { ...disabledInput, reason: "A different defective reason" } })).status(), 409);
    assert.equal((await tech.request.post(path, { data: { ...disabledInput, operationId: randomUUID() } })).status(), 409);
    const page = await tech.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    // Exercise the real detail panel, then its independently captured child wizard.
    await page.goto(`/projects/${fixture.projectId}/work-orders?edit=${disabledOriginal.id}`);
    const panel = page.getByTestId("defective-replacement-panel");
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel).toContainText("Defective");
    const resume = page.getByTestId("button-resume-replacement");
    if (await resume.isVisible()) await resume.click();
    else await page.getByTestId("button-system-changeout").click();
    await expect(page.getByTestId("replacement-progress")).toBeVisible();
    await expect.poll(() => page.evaluate(() => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName))).toBe(false);
    await page.screenshot({ path: "generated-artifacts/project-workspace/replacement-desktop.jpg" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "generated-artifacts/project-workspace/replacement-phone.jpg" });
    await page.close();
    assert.deepEqual(errors, []);
    const child = created.workOrder;
    const completed = await api("PATCH", `${root}/work-orders/${child.id}`, { status: "Completed", oldSystemReading: "0000",
      newSystemReading: "0000", newSystemId: "DISABLED-SECOND", changeoutSubmissionId: randomUUID(),
      changeoutAssignmentVersion: child.assignmentVersion ?? 0 }, tech);
    eligibility = await api("GET", path, undefined, tech);
    assert.equal(eligibility.baseline.systemId, "DISABLED-SECOND");
    assert.equal(eligibility.activeVisit, null);
    assert.ok(eligibility.canCreate);
    assert.equal((await api("GET", `${root}/work-orders/${disabledOriginal.id}`, undefined, tech)).new_system_id, "INITIAL-disabled");
    assert.equal((await admin.request.patch(`${root}/work-orders/${disabledOriginal.id}`, { data: { newSystemId: "REWRITE" } })).status(), 409);
    const unused = await api("POST", path, { ...disabledInput, operationId: randomUUID(), predecessorFingerprint: eligibility.predecessorFingerprint }, tech);
    await api("PATCH", `${root}/work-orders/${unused.workOrder.id}`, { assignedUserId: users[1].id });
    assert.equal((await tech.request.post(`${root}/work-orders/${unused.workOrder.id}/replacement/cancel`, { data: {} })).status(), 403);
    const cancelled = await api("POST", `${root}/work-orders/${unused.workOrder.id}/replacement/cancel`, {}, outsider);
    assert.equal(cancelled.workOrder.replacementVisit.active, false);
    assert.equal((await api("POST", `${root}/work-orders/${unused.workOrder.id}/replacement/cancel`, {}, outsider)).replay, true);
    const receipt = await tech.request.get(`${path}/receipt`);
    assert.equal(receipt.status(), 200);
    assert.match(await receipt.text(), /DISABLED-SECOND/);
    const multi = await api("POST", `${root}/work-orders`, { customerWoId: "ORIGINAL-BOTH", status: "Open",
      serviceType: services[0].code, oldSystemId: "BOTH-OLD-S", oldModuleId: "BOTH-OLD-M", assignedUserId: users[0].id });
    await api("PATCH", `${root}/work-orders/${multi.id}`, { status: "Completed", oldSystemReading: "1", newSystemReading: "0",
      oldModuleRead: "1", newModuleRead: "0", newSystemId: "BOTH-NEW-S", newModuleId: "BOTH-NEW-M",
      changeoutSubmissionId: randomUUID(), changeoutAssignmentVersion: multi.assignmentVersion ?? 0 });
    const multiPath = `${root}/work-orders/${multi.id}/replacement`;
    let multiEligibility = await api("GET", multiPath, undefined, tech);
    const moduleVisit = await api("POST", multiPath, { operationId: randomUUID(), predecessorFingerprint: multiEligibility.predecessorFingerprint,
      equipment: "module", reason: "Module cannot transmit readings", vehicleId: null }, tech);
    assert.equal(moduleVisit.workOrder.oldSystemId, null);
    assert.equal(moduleVisit.workOrder.oldModuleId, "BOTH-NEW-M");
    await api("PATCH", `${root}/work-orders/${moduleVisit.workOrder.id}`, { status: "Completed", oldModuleRead: "0",
      newModuleRead: "0", newModuleId: "MODULE-SECOND", changeoutSubmissionId: randomUUID(),
      changeoutAssignmentVersion: moduleVisit.workOrder.assignmentVersion ?? 0 }, tech);
    multiEligibility = await api("GET", multiPath, undefined, tech);
    const bothVisit = await api("POST", multiPath, { operationId: randomUUID(), predecessorFingerprint: multiEligibility.predecessorFingerprint,
      equipment: "both", reason: "Both devices failed commissioning", vehicleId: null }, tech);
    assert.equal(bothVisit.workOrder.oldSystemId, "BOTH-NEW-S");
    assert.equal(bothVisit.workOrder.oldModuleId, "MODULE-SECOND");
    await api("POST", `${root}/work-orders/${bothVisit.workOrder.id}/replacement/cancel`, {}, tech);
    await api("PATCH", root, { inventoryEnabled: true, changeoutEquipmentType: "system" });
    for (const [id, type] of [["replacement-warehouse", "physical"], ["replacement-vehicle", "vehicle"]]) {
      await command("warehouse", { id, code: id, name: id, type, address: "Synthetic test warehouse",
        ...(type === "vehicle" ? { userIds: [users[0].id], vin: "1HGCM82633A004352", plate: "REPLACE", plateState: "CO" } : {}) });
    }
    await command("item", { id: "replacement-system", sku: "REPLACE-SYSTEM", name: "Synthetic serialized system",
      tracking: "serialized", equipment: "system" });
    await command("typeLink", { equipment: "system", typeId: systemType.id, itemId: "replacement-system" });
    await command("vendor", { id: "replacement-vendor", name: "Synthetic vendor" });
    await command("order", { id: "replacement-po", type: "purchase", vendorId: "replacement-vendor",
      destinationId: "replacement-vehicle", lines: [{ itemId: "replacement-system", quantity: 3 }] });
    await command("release", { orderId: "replacement-po" });
    await command("receive", { orderId: "replacement-po", lines: [{ itemId: "replacement-system",
      quantity: 3, serials: ["ONBOARD-B", "ONBOARD-C", "ONBOARD-D"] }] });
    // First installation is a genuine independently accounted stock consumption.
    const original = await api("POST", `${root}/work-orders`, { customerWoId: "ORIGINAL-ENABLED", status: "Open",
      serviceType: services[0].code, oldSystemId: "ENABLED-OLD", newSystemType: systemType.productId, assignedUserId: users[0].id });
    const ruleId = "ea936000-0000-4000-8000-000000000001";
    const usage = (serial, old) => ({ operationId: randomUUID(), revision: 0, mode: "changeout",
      used: [{ itemId: "replacement-system", warehouseId: "replacement-vehicle", quantity: 1, serials: [serial] }],
      dispositions: [{ equipment: "system", serial: old, disposition: "returned", warehouseId: "replacement-warehouse",
        ruleId, ruleRevision: 1, policyRevision: 1 }] });
    await api("PATCH", `${root}/work-orders/${original.id}`, { status: "Completed", oldSystemReading: "1",
      newSystemReading: "0", newSystemId: "ONBOARD-B", inventoryUsage: usage("ONBOARD-B", "ENABLED-OLD"),
      changeoutSubmissionId: randomUUID(), changeoutAssignmentVersion: original.assignmentVersion ?? 0 });
    let enabledPath = `${root}/work-orders/${original.id}/replacement`;
    let previous = "ONBOARD-B";
    let examples;
    for (const next of ["ONBOARD-C", "ONBOARD-D"]) {
      eligibility = await api("GET", enabledPath, undefined, tech);
      assert.equal(eligibility.baseline.systemId, previous);
      assert.ok(eligibility.vehicles.some(v => v.id === "replacement-vehicle"));
      const input = { operationId: randomUUID(), predecessorFingerprint: eligibility.predecessorFingerprint,
        equipment: "system", reason: "System failed its commissioning test", vehicleId: "replacement-vehicle" };
      const visit = await api("POST", enabledPath, input, tech);
      const id = visit.workOrder.id;
      const downloaded = await api("GET", `${root}/mobile/sync/download?includeCompleted=false`, undefined, tech);
      const orders = downloaded.workOrders ?? downloaded.data?.workOrders;
      const visible = orders.find(w => w.id === id);
      assert.ok(visible, "Onboard replacement is dispatched to its authorized technician");
      assert.equal(visible.replacementVisit.equipment, "system");
      assert.equal(visible.inventoryDispatch.vehicleId, "replacement-vehicle");
      assert.equal(visible.inventoryDispatch.canStart, true);
      examples = { eligibility, createRequest: input, createResponse: visit, downloadWorkOrder: visible,
        workOrderInventory: await api("GET", `${root}/work-orders/${id}/inventory`, undefined, tech) };
      const delta = await api("GET", `${root}/mobile/sync/download?lastSyncTimestamp=2026-01-01T00:00:00.000Z&includeCompleted=false`, undefined, tech);
      assert.ok(delta.workOrders.find(w => w.id === id));
      const bad = { status: "Completed", oldSystemReading: "0", newSystemReading: "0", newSystemId: next,
        inventoryUsage: { ...usage(next, previous), used: [{ itemId: "replacement-system",
          warehouseId: "replacement-vehicle", quantity: 1, serials: [] }] },
        changeoutSubmissionId: randomUUID(), changeoutAssignmentVersion: visit.workOrder.assignmentVersion ?? 0 };
      assert.equal((await tech.request.patch(`${root}/work-orders/${id}`, { data: bad })).status(), 400);
      await api("PATCH", `${root}/work-orders/${id}`, { ...bad, inventoryUsage: usage(next, previous) }, tech);
      previous = next;
    }
    await expect.poll(async () => {
      const { state } = await api("GET", `${root}/inventory`);
      return state.allocations?.filter(a => a.status === "consumed" && a.used.some(l => l.itemId === "replacement-system")).length;
    }, { timeout: 45000 }).toBe(3).catch(async error => {
      const jobs = await api("GET", `${root}/changeout-reconciliation`);
      console.error("Owned fixture accounting:", jobs.jobs.map(j => ({ workOrderId: j.workOrderId, status: j.status, error: j.error })));
      throw error;
    });
    const { state } = await api("GET", `${root}/inventory`);
    assert.equal(state.allocations.find(a => a.workOrderId === original.id).used[0].serials[0], "ONBOARD-B");
    assert.ok(state.returns.some(r => r.serial === "ONBOARD-B" && r.status === "pending"));
    assert.ok(state.returns.some(r => r.serial === "ONBOARD-C" && r.status === "pending"));
    assert.ok(!state.stock.some(s => s.serials.includes("ONBOARD-B") || s.serials.includes("ONBOARD-C")));
    assert.equal(state.serialOccupancy.filter(o => o.serial === "ONBOARD-D").length, 1);
    assert.ok(!state.serialOccupancy.some(o => o.serial === "ONBOARD-B" || o.serial === "ONBOARD-C"));
    await fs.writeFile("generated-artifacts/project-workspace/replacement-mobile-examples.json", JSON.stringify(examples, null, 2));
    const backup = await api("GET", `${root}/database/backup`);
    assert.ok(backup.workOrders.some(w => w.replacementRecovery?.rootWorkOrderId === original.id));
    const restored = await admin.request.post(`${root}/database/restore`, { multipart: {
      backup: { name: "owned-replacement.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) },
      clearExisting: "true",
    } });
    assert.ok(restored.ok(), await restored.text());
    eligibility = await api("GET", enabledPath, undefined, tech);
    assert.equal(eligibility.baseline.systemId, "ONBOARD-D");
    assert.equal(eligibility.history.filter(row => row.equipment === "system").length, 2);
    // A normal technician can request warehouse fulfillment, then use only the
    // new child's real vehicle handoff/reservations, never the parent's stock.
    await command("warehouse", { id: "replacement-staging", code: "REPLACE-STAGE", name: "Replacement staging",
      type: "physical", locationTypeId: "57e15eca-f991-4328-a091-000000000003", address: "Synthetic staging shelf" });
    await command("order", { id: "replacement-warehouse-po", type: "purchase", vendorId: "replacement-vendor",
      destinationId: "replacement-warehouse", lines: [{ itemId: "replacement-system", quantity: 1 }] });
    await command("release", { orderId: "replacement-warehouse-po" });
    await command("receive", { orderId: "replacement-warehouse-po",
      lines: [{ itemId: "replacement-system", quantity: 1, serials: ["WAREHOUSE-E"] }] });
    const warehouseInput = { operationId: randomUUID(), predecessorFingerprint: eligibility.predecessorFingerprint,
      equipment: "system", reason: "Replacement needs warehouse supplied stock", vehicleId: null };
    const warehouseCreated = await api("POST", enabledPath, warehouseInput, tech);
    const warehouseVisit = warehouseCreated.workOrder, warehouseId = warehouseVisit.id;
    assert.equal(warehouseVisit.status, "Scheduled", "Assigned warehouse replacement enters normal scheduled fulfillment.");
    const completion = { status: "Completed", oldSystemReading: "1", newSystemReading: "0", newSystemId: "WAREHOUSE-E",
      changeoutSubmissionId: randomUUID(), changeoutAssignmentVersion: warehouseVisit.assignmentVersion ?? 0,
      inventoryUsage: usage("WAREHOUSE-E", "ONBOARD-D") };
    const premature = await tech.request.patch(`${root}/work-orders/${warehouseId}`, { data: completion });
    assert.ok(!premature.ok(), "Technician cannot install warehouse stock before vehicle handoff.");
    const candidate = (await api("GET", `${root}/inventory/fulfillment`)).orders.find(order => order.workOrderId === warehouseId);
    assert.equal(candidate?.eligible, true, "Warehouse can find and pick the new replacement.");
    const batchId = randomUUID();
    await command("fulfillmentCreate", { id: batchId, name: "Replacement warehouse fulfillment", mode: "scheduled",
      sourceId: "replacement-warehouse", stagingId: "replacement-staging", vehicleId: "replacement-vehicle",
      workOrders: [{ workOrderId: warehouseId, assignmentVersion: candidate.assignmentVersion }] });
    await command("fulfillmentMove", { id: batchId, revision: 1, phase: "stage", physicallyConfirmed: true,
      reason: "Replacement unit physically pulled into staging",
      lines: [{ itemId: "replacement-system", quantity: 1, serials: ["WAREHOUSE-E"] }] });
    const staged = await api("GET", `${root}/work-orders/${warehouseId}/inventory`, undefined, tech);
    assert.equal(staged.inventoryDispatch.canStart, false, "Staged is not onboard.");
    await command("fulfillmentMove", { id: batchId, revision: 2, phase: "vehicle", physicallyConfirmed: true,
      reason: "Technician physically received the replacement unit",
      lines: [{ itemId: "replacement-system", quantity: 1, serials: ["WAREHOUSE-E"] }] });
    const handedOff = await api("GET", `${root}/work-orders/${warehouseId}/inventory`, undefined, tech);
    assert.equal(handedOff.canChangeFieldStock, false, "This test must not rely on stock-maintenance privileges.");
    assert.equal(handedOff.inventoryDispatch.canStart, true);
    assert.equal(handedOff.inventoryDispatch.vehicleId, "replacement-vehicle");
    assert.equal(handedOff.allocation.lines[0].warehouseId, "replacement-vehicle");
    assert.equal(handedOff.allocation.lines[0].quantity, 1);
    assert.equal(handedOff.allocation.lines[0].reservationMode, "quantity");
    assert.deepEqual(handedOff.allocation.lines[0].serials, [], "Pick custody does not preassign the installed serial.");
    const warehouseDownload = await api("GET", `${root}/mobile/sync/download?includeCompleted=false`, undefined, tech);
    const downloadedVisit = warehouseDownload.workOrders.find(order => order.id === warehouseId);
    assert.equal(downloadedVisit?.inventoryDispatch.batchId, batchId, "Real fulfillment identity, not virtual onboard identity.");
    assert.equal(downloadedVisit.inventoryDispatch.canStart, true);
    const warehousePage = await tech.newPage();
    await warehousePage.goto(`/projects/${fixture.projectId}/work-orders?edit=${warehouseId}`);
    await warehousePage.getByTestId("button-resume-replacement").click();
    await expect(warehousePage.getByTestId("replacement-progress")).toBeVisible();
    await warehousePage.getByTestId("button-system-can-change").click();
    await expect(warehousePage.getByText("Stock source:", { exact: true }).locator("..")).toContainText("replacement-vehicle");
    await expect(warehousePage.getByText(/Reserved · max 1 · quantity hold/).first()).toBeVisible();
    await warehousePage.screenshot({ path: "generated-artifacts/project-workspace/replacement-warehouse-handoff.jpg" });
    await warehousePage.close();
    // Completion uses the ordinary technician permission set, not admin or an
    // inventory-maintenance override. Poll the actual immutable accounting job.
    await api("PATCH", `${root}/work-orders/${warehouseId}`, completion, tech);
    await expect.poll(async () => {
      const snapshot = (await api("GET", `${root}/inventory`)).state;
      return snapshot.allocations.find(a => a.workOrderId === warehouseId)?.status;
    }, { timeout: 45000 }).toBe("consumed");
    const finalState = (await api("GET", `${root}/inventory`)).state;
    assert.ok(finalState.returns.some(row => row.serial === "ONBOARD-D" && row.status === "pending"));
    assert.ok(!finalState.stock.some(row => row.serials.includes("ONBOARD-D") || row.serials.includes("WAREHOUSE-E")));
    assert.equal(finalState.serialOccupancy.filter(row => row.serial === "WAREHOUSE-E").length, 1);
    assert.equal(finalState.allocations.filter(row => row.status === "consumed" &&
      row.used.some(line => line.itemId === "replacement-system")).length, 4);
    console.log("Replacement: disabled preservation, authorization, idempotency, UI scope/focus, repeated baseline, full/delta dispatch and independent stock/return history passed.");
  } finally {
    await db.end(); await admin.close(); await tech.close(); await outsider.close(); await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
