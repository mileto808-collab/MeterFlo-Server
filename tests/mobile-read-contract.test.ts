import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { randomUUID } from "node:crypto";
import { mobileDownloadQuerySchema, mobileVisibilitySnapshot, mobileWorkOrderDto } from "../shared/mobile-read-contract";
import { canViewInventoryPricing, inventoryCatalogItems } from "../shared/inventory-catalog-projection";
import { itemSchema } from "../shared/inventory";

const timestamp = "2026-10-22T18:00:00.000Z";
const scope = { projectId: 7, userId: "tech", fieldTechnician: true };
const snapshot = (query: object) =>
  mobileVisibilitySnapshot(mobileDownloadQuerySchema.parse(query), scope, "snapshot", timestamp);
const plain = (value: any) => JSON.parse(JSON.stringify(value));

test("only an unpaged full response is a complete authorized snapshot", () => {
  assert.equal(snapshot({}).complete, true);
  assert.equal(snapshot({ offset: "0" }).complete, true);
  assert.equal(snapshot({ limit: "25" }).complete, false);
  assert.equal(snapshot({ offset: "25" }).complete, false);
  assert.equal(snapshot({ lastSyncTimestamp: timestamp }).complete, false);
  assert.equal(snapshot({ lastSyncTimestamp: timestamp }).mode, "delta");
  assert.equal(snapshot({ includeCompleted: "true" }).scope.activeOnly, true);
});

test("scope identifies effective filters, owner and project, never a pagination lease", () => {
  const result = snapshot({ assignedUserId: "ignored", status: "Open" });
  assert.equal(result.scope.assignedUserId, null);
  assert.equal(result.scope.status, "Open");
  assert.equal(result.scope.userId, "tech");
  assert.equal(result.scope.projectId, 7);
  assert.equal(result.consistency, "request");
  const manager = mobileVisibilitySnapshot(
    mobileDownloadQuerySchema.parse({ assignedUserId: "chosen" }),
    { ...scope, fieldTechnician: false }, "request", timestamp);
  assert.equal(manager.scope.assignedUserId, "chosen");
});

test("invalid dates, numeric prefixes, repeated values and excessive pages fail closed", () => {
  for (const query of [
    { lastSyncTimestamp: "not-a-date" }, { lastSyncTimestamp: ["2026-01-01"] },
    { limit: "10junk" }, { limit: "-1" }, { limit: "0" }, { limit: "10001" },
    { limit: ["5"] }, { offset: "1.2" }, { offset: "9007199254740992" },
  ]) assert.equal(mobileDownloadQuerySchema.safeParse(query).success, false, JSON.stringify(query));
});

test("catalog allowlist removes restricted and unknown fields, including nested component extras", () => {
  const item = { ...itemSchema.parse({ id: "meter", name: "Meter", sku: "M", tracking: "serialized",
    cost: 99, billingRate: 125, vendorId: "vendor", components: [{ itemId: "part", quantity: 1 }] }),
    futurePrivateField: "private" } as any;
  item.components[0].cost = 88;
  const before = JSON.stringify(item);
  const result = inventoryCatalogItems([item], false)[0];
  for (const field of ["cost", "billingRate", "vendorId", "futurePrivateField"])
    assert.equal(Object.hasOwn(result, field), false, field);
  assert.deepEqual(result.components, [{ itemId: "part", quantity: 1 }]);
  assert.equal(inventoryCatalogItems([item], true)[0].cost, 99);
  assert.equal(JSON.stringify(item), before);
  assert.equal(canViewInventoryPricing(["inventory.view", "inventory.assign", "inventory.plan"]), false);
  for (const permission of ["inventory.maintain", "inventory.configure", "inventory.purchase"])
    assert.equal(canViewInventoryPricing([permission]), true);
  assert.equal(canViewInventoryPricing([], true), true);
});

test("DTO preserves dispatch, exact text, snake fields and camel-case scheduling/GPS", () => {
  const dispatch = { stage: "awaiting_pickup", canStart: false, receiptNumber: "PICK-2026-000001" };
  const raw = mobileWorkOrderDto({
    id: 1, assignment_version: 3, new_system_reading: 1.23,
    new_system_reading_text: "00001.230000", inventoryDispatch: dispatch,
    service_duration_minutes: 30, appointment_window_start: timestamp,
  });
  assert.equal(raw.new_system_reading, "00001.230000");
  assert.equal(raw.assignment_version, 3);
  assert.equal(raw.assignmentVersion, 3);
  assert.deepEqual(raw.inventoryDispatch, dispatch);
  assert.equal(raw.appointmentWindowStart, timestamp);
  const camel = mobileWorkOrderDto({ id: 1, assignmentVersion: 4,
    serviceDurationMinutes: 30, appointmentWindowStart: timestamp, gpsCapture: { source: "native" } });
  assert.equal(camel.serviceDurationMinutes, 30);
  assert.equal(camel.appointmentWindowStart, timestamp);
  assert.deepEqual(camel.gpsCapture, { source: "native" });
});

// Execute actual route handlers, not a rewritten copy. Dependencies are synthetic:
// no database, account, permission, stock or project is created in the workspace.
const source = readFileSync("server/routes.ts", "utf8");
const ast = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function route(path: string, dependencies: Record<string, any>, method = "get") {
  let handler: ts.Node | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(ast) === "app" && node.expression.name.text === method &&
      ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path)
      handler = node.arguments[node.arguments.length - 1];
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(handler, `Actual route not found: ${path}`);
  const compiled = ts.transpileModule(`module.exports = ${handler.getText(ast)}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const context = { ...dependencies, module: { exports: null }, console };
  vm.runInNewContext(compiled, context);
  return context.module.exports as unknown as (req: any, res: any) => Promise<any>;
}

function fixture(options: { enabled?: boolean; view?: boolean; manager?: boolean } = {}) {
  const enabled = options.enabled ?? true;
  const rows = [{ id: 1, status: "Open", assigned_group_id: "group", assignment_version: 3,
    updated_at: timestamp, new_system_reading: 1.23, new_system_reading_text: "00001.230000" }];
  const state = { rows, visible: true, stage: "awaiting_pickup", inventoryRead: false };
  const queries: string[] = [];
  const user = { id: "tech", role: "user", subroleId: "field" };
  const client = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("SELECT inventory_enabled")) return { rows: [{ inventory_enabled: enabled,
        wizard_mode: "changeout", changeout_equipment_type: "both", reading_equipment_type: "both" }] };
      if (sql.includes("SELECT id,status")) return { rows: state.rows };
      if (sql.includes("SELECT w.*")) return { rows: state.rows };
      return { rows: [] };
    },
    release() { queries.push("RELEASE"); },
  };
  const storage: Record<string, any> = {
    getUser: async () => user, isUserAssignedToProject: async () => true,
    getProject: async () => ({ id: 7, name: "Synthetic", databaseName: "project_test", inventoryEnabled: enabled }),
    getSubrole: async () => ({ key: "field_technician" }), isAdminUser: async () => false,
    hasPermission: async (_user: any, permission: string) => permission !== "inventory.view" || options.view !== false,
    getUserEffectivePermissions: async () => options.manager ? ["inventory.maintain"] : ["inventory.view"],
    getSetting: async () => "UTC",
  };
  for (const method of ["getWorkOrderStatuses", "getTroubleCodes", "getSystemTypes", "getModuleTypes",
    "getServiceTypes", "getProjectUsers", "getAllUserGroupsWithProjects"])
    storage[method] = async () => [];
  const deps = {
    storage, pool: { connect: async () => client }, getProjectWorkOrderStorage: () => ({}),
    technicianAssignmentScope: async () => ({ groupNames: ["group"] }),
    visibleAssignedOrders: async (_user: any, work: any[], _project: number, connection: any) => {
      assert.equal(connection, client, "projection shares the download/search read client");
      return state.visible ? work.map(row => ({ ...row, ...(enabled ? { inventoryDispatch: {
        stage: state.stage, canStart: state.stage === "ready_for_field",
        vehicleId: "van", receiptNumber: "PICK-2026-000001",
      } } : {}) })) : [];
    },
    inventoryState: async (_id: number, connection: any) => {
      assert.equal(connection, client);
      state.inventoryRead = true;
      return { items: [itemSchema.parse({ id: "meter", name: "Meter", sku: "M", tracking: "serialized",
        cost: 99, vendorId: "vendor" })], warehouses: [], allocations: [], locationTypes: [] };
    },
    randomUUID, mobileDownloadQuerySchema, mobileVisibilitySnapshot, mobileWorkOrderDto,
    canViewInventoryPricing, inventoryCatalogItems, listSubStatuses: async () => [],
    removalConfig: () => ({ rules: [], policy: {} }), warehouseAccessible: () => true,
  };
  async function invoke(path: string, query: object = {}, method = "get") {
    let body: any, status = 200;
    const headers: Record<string, string> = {};
    const res = {
      status(code: number) { status = code; return this; },
      set(key: string, value: string) { headers[key] = value; return this; },
      json(value: any) { body = plain(value); return this; },
    };
    await route(path, deps, method)({ user: { claims: { sub: "tech" } },
      params: { projectId: "7", workOrderId: "1" }, query }, res);
    return { status, body, headers };
  }
  return { state, queries, invoke, deps };
}
const download = "/api/projects/:projectId/mobile/sync/download";
const search = "/api/projects/:projectId/work-orders/search";

test("actual download provides complete metadata, dispatch, exact readings and field-safe catalog", async () => {
  const f = fixture();
  const result = await f.invoke(download);
  assert.equal(result.status, 200);
  assert.equal(result.body.meta.visibility.complete, true);
  assert.equal(result.body.meta.visibility.scope.userId, "tech");
  assert.equal(result.body.workOrders[0].inventoryDispatch.canStart, false);
  assert.equal(result.body.workOrders[0].new_system_reading, "00001.230000");
  assert.equal(Object.hasOwn(result.body.inventory.items[0], "cost"), false);
  assert.equal(result.headers["Cache-Control"], "no-store");
  assert.equal(f.queries[0], "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  assert.equal(f.queries.at(-2), "COMMIT");
  assert.equal(f.queries.at(-1), "RELEASE");
});

test("actual download reconciles inventory-only handoff and removal without a work-order edit", async () => {
  const f = fixture();
  const first = await f.invoke(download);
  f.state.stage = "ready_for_field";
  const handoff = await f.invoke(download);
  assert.equal(handoff.body.workOrders[0].inventoryDispatch.canStart, true);
  assert.equal(handoff.body.workOrders[0].updated_at, first.body.workOrders[0].updated_at);
  f.state.visible = false;
  const removed = await f.invoke(download);
  assert.deepEqual(removed.body.workOrders, []);
  assert.equal(removed.body.meta.visibility.complete, true);
  const delta = await f.invoke(download, { lastSyncTimestamp: timestamp });
  assert.equal(delta.body.meta.visibility.complete, false);
});

test("disabled download keeps legacy rows, requires no inventory grant and does not load stock", async () => {
  const f = fixture({ enabled: false, view: false });
  const result = await f.invoke(download, { includeCompleted: "true" });
  assert.equal(result.status, 200);
  assert.equal(result.body.workOrders[0].id, 1);
  assert.equal(result.body.inventory.enabled, false);
  assert.equal(f.state.inventoryRead, false);
  assert.equal(result.body.meta.reconciliation.inventoryEvents, null);
  assert.ok(f.queries.some(sql => sql.includes("assigned_group_id = ANY")));
  assert.ok(f.queries.some(sql => sql.includes("NOT IN ('completed', 'closed')")));
});

test("actual download rejects invalid queries and denied access without success snapshots", async () => {
  const invalid = fixture();
  const bad = await invalid.invoke(download, { limit: "20oops" });
  assert.equal(bad.status, 400);
  assert.equal(invalid.queries.length, 0);
  const denied = fixture({ view: false });
  const result = await denied.invoke(download);
  assert.equal(result.status, 403);
  assert.equal(result.body.meta, undefined);
  assert.equal(denied.queries.at(-2), "ROLLBACK");
  assert.equal(denied.queries.at(-1), "RELEASE");
});

test("actual limited download never declares a complete set; manager projection preserves permitted pricing", async () => {
  const f = fixture({ manager: true });
  const result = await f.invoke(download, { limit: "1" });
  assert.equal(result.body.meta.visibility.complete, false);
  assert.equal(result.body.inventory.items[0].cost, 99);
  assert.ok(f.queries.some(sql => sql.includes("ORDER BY w.updated_at DESC, w.id DESC")));
});

test("actual search enforces visibility and keeps its legacy array with dispatch metadata", async () => {
  const f = fixture();
  const found = await f.invoke(search, { meterId: "synthetic" });
  assert.equal(found.status, 200);
  assert.ok(Array.isArray(found.body));
  assert.equal(found.body[0].inventoryDispatch.canStart, false);
  f.state.visible = false;
  const hidden = await f.invoke(search, { meterId: "synthetic" });
  assert.deepEqual(hidden.body, []);
});

test("actual download never returns a snapshot on unauthenticated, unassigned or failed reads", async () => {
  const unauthenticated = fixture();
  unauthenticated.deps.storage.getUser = async () => null;
  assert.equal((await unauthenticated.invoke(download)).status, 401);
  assert.equal(unauthenticated.queries.length, 0);
  const unassigned = fixture();
  unassigned.deps.storage.isUserAssignedToProject = async () => false;
  assert.equal((await unassigned.invoke(download)).status, 403);
  const failed = fixture();
  failed.deps.inventoryState = async () => { throw new Error("Synthetic read failure"); };
  const result = await failed.invoke(download);
  assert.equal(result.status, 500);
  assert.equal(result.body.meta, undefined);
  assert.equal(failed.queries.at(-2), "ROLLBACK");
  assert.equal(failed.queries.at(-1), "RELEASE");
});

test("actual detail and claim keep their envelopes and expose the same dispatch/assignment metadata", async () => {
  const f = fixture();
  f.deps.visibleAssignedOrders = async (_user: any, work: any[]) => work.map(row => ({
    ...row, inventoryDispatch: { stage: "ready_for_field", canStart: true, vehicleId: "van" },
  }));
  const detail = await f.invoke("/api/projects/:projectId/work-orders/:workOrderId");
  assert.equal(detail.status, 200);
  assert.equal(detail.body.assignmentVersion, 3);
  assert.equal(detail.body.inventoryDispatch.canStart, true);
  f.deps.getProjectWorkOrderStorage = () => ({
    getWorkOrder: async () => ({ id: 1 }),
    claimWorkOrder: async () => ({ id: 1, assignedUserId: "tech", assignmentVersion: 4,
      serviceDurationMinutes: 30, appointmentWindowStart: timestamp }),
  });
  Object.assign(f.deps, { emitWorkOrderUpdated() {}, ChangeoutError: class extends Error {} });
  const claim = await f.invoke("/api/projects/:projectId/work-orders/:workOrderId/claim", {}, "post");
  assert.equal(claim.status, 200);
  assert.equal(claim.body.claimed, true);
  assert.equal(claim.body.workOrder.assignmentVersion, 4);
  assert.equal(claim.body.workOrder.inventoryDispatch.canStart, true);
  assert.equal(claim.body.workOrder.serviceDurationMinutes, 30);
});
