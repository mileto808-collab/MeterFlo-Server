// Run after work-order-routing-api.test.ts, sequentially against its disposable fixture.
import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { getProjectWorkOrderStorage } from "../server/projectDb";
import { enableAuditing, serviceAuditContext, withAuditContext } from "../server/auditContext";
import { registerRoutingRoutes } from "../server/routing/routes";
import type { RoutingService } from "../server/routing/providers";

test("dispatch produces separate per-assignee routes; technician authorization cannot be bypassed", async t => {
  t.after(() => pool.end());
  const fixture = JSON.parse(await readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  enableAuditing();
  await withAuditContext(serviceAuditContext("technician-routing-acceptance"), async () => {
    const wo = getProjectWorkOrderStorage(fixture.schema);
    const existing = await wo.getWorkOrders();
    const first = existing.find(order => order.customerWoId === "ROUTE-URGENT")!;
    const second = existing.find(order => order.customerWoId === "ROUTE-APPOINTMENT")!;
    const open = existing.find(order => order.customerWoId === "ROUTE-OPEN")!;
    assert.ok(first && second && open);
    await pool.query(`UPDATE "${fixture.schema}".work_orders SET assigned_user_id=$1 WHERE id=$2`, [fixture.viewer.id, second.id]);
    const unassigned = await wo.createWorkOrder({ customerWoId: "ROUTE-UNASSIGNED", serviceType: first.serviceType,
      status: "Scheduled", address: "Fixture unassigned address" } as any, fixture.username);
    const before = await wo.getWorkOrders();
    const originalNow = Date.now.bind(Date);
    let offset = 0, quotaCalls = 0, revision = "c".repeat(64);
    t.mock.method(Date, "now", () => originalNow() + offset);
    const matrices: any[] = [];
    const provider: RoutingService = {
      geocode: async address => ({ lat: address.includes("first") ? 40 : 40.1, lng: -105,
        addressMatch: { formatted: address, street: address } }),
      matrix: async points => {
        matrices.push(points);
        return points.map(() => points.map(() => ({ seconds: 60, meters: 1000 })));
      },
      geometry: async points => points,
    };
    const configuration = { mode: "override" as const, provider: "geoapify" as const,
      serverKeyEnv: "", browserKeyEnv: "", maxStops: 1, dailyPlans: 50 };
    const app = express(); app.use(express.json());
    app.use((req: any, _res, next) => {
      req.isAuthenticated = () => true;
      req.user = { claims: { sub: req.headers["x-test-actor"] === "viewer" ? fixture.viewer.id : fixture.id },
        expires_at: Math.floor(Date.now() / 1000) + 1000 };
      next();
    });
    registerRoutingRoutes(app, {
      effectiveRouting: async () => ({ result: { configuration, effective: { ...configuration, source: "project" as const },
        ready: true, mapReady: false, disabled: false, canManage: true, revision, message: "Fixture" },
        effective: configuration, serverKey: "synthetic-provider-placeholder", browserKey: "" }),
      routingService: () => provider, consumeRoutingQuota: async () => { quotaCalls++; },
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/projects/${fixture.projectId}/routing`;
    const input = { ids: [first.id, second.id, open.id, unassigned.id], origin: { lat: 39.9, lng: -105.2 },
      departureAt: new Date().toISOString(), serviceMinutes: 30, toleranceMinutes: 60 };
    const post = async (path: string, body: unknown, actor = "admin") => {
      offset += 11000;
      const response = await fetch(base + path, { method: "POST",
        headers: { "Content-Type": "application/json", "x-test-actor": actor }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    const received = async (actor = "viewer", url = base) => {
      const response = await fetch(url + "/dispatched", { headers: { "x-test-actor": actor } });
      return { status: response.status, body: await response.json() };
    };
    try {
      const planned = await post("/plan", input);
      assert.equal(planned.status, 200, JSON.stringify(planned.body));
      assert.equal(planned.body.assignmentRoutingVersion, 1);
      assert.equal(planned.body.routes.length, 2);
      assert.deepEqual(new Set(planned.body.routes.map((route: any) => route.assigneeId)), new Set([fixture.id, fixture.viewer.id]));
      for (const route of planned.body.routes) {
        assert.equal(route.stops.length, 1, "The per-technician maxStops is not a global combined-route limit");
        const expected = route.assigneeId === fixture.id ? first : second;
        assert.equal(route.stops[0].id, expected.id);
        assert.deepEqual(route.origin, input.origin, "Each technician departs the common warehouse independently");
        assert.ok(route.assigneeName);
      }
      assert.equal(matrices.length, 2);
      assert.equal(quotaCalls, 2, "Each route is counted against provider quota");
      assert.ok(matrices.every(points => points.length === 2 && points[0].lat === input.origin.lat));
      assert.ok(planned.body.excluded.some((entry: any) => entry.id === unassigned.id && /Unassigned/.test(entry.reason)));
      assert.ok(planned.body.excluded.some((entry: any) => entry.id === open.id && /Not Scheduled/.test(entry.reason)));
      assert.deepEqual(planned.body.scopeIds, input.ids);
      assert.deepEqual(await wo.getWorkOrders(), before, "Optimization does not change assignments or business records");
      await storage.setSubrolePermissions(fixture.viewerRoleId, ["workOrders.view", "projects.view", "workOrders.optimizeRoute"]);
      assert.equal((await post("/dispatch", { planId: planned.body.routes[0].dispatchPlanId })).status, 422,
        "A manager's device coordinates must never be shared");
      const manual = await post("/plan", { ...input, origin: { address: "Manual warehouse address" } });
      assert.equal(manual.status, 200, JSON.stringify(manual.body));
      const ownPlan = manual.body.routes.find((route: any) => route.assigneeId === fixture.viewer.id);
      const otherPlan = manual.body.routes.find((route: any) => route.assigneeId === fixture.id);
      const send = (planId: string, actor = "admin") => post("/dispatch", { planId }, actor);
      const openRoute = (id: string, actor = "viewer") => post(`/dispatched/${id}/open`, {}, actor);
      assert.deepEqual((await received()).body, [], "Planning alone does not share anything");
      assert.equal((await openRoute(ownPlan.dispatchPlanId)).status, 404);
      assert.equal((await send(ownPlan.dispatchPlanId, "viewer")).status, 404, "Support cannot send another planner's cached plan");
      assert.equal((await send(ownPlan.dispatchPlanId)).status, 200);
      assert.equal((await send(otherPlan.dispatchPlanId)).status, 200);
      const inbox = await received();
      assert.equal(inbox.status, 200);
      assert.equal(inbox.body.length, 1);
      assert.equal(inbox.body[0].id, ownPlan.dispatchPlanId);
      assert.equal(inbox.body[0].geometry, undefined, "Inbox is metadata only");
      assert.equal((await openRoute(otherPlan.dispatchPlanId)).status, 404, "Guessing an ID cannot cross assignees");
      assert.equal((await openRoute(ownPlan.dispatchPlanId, "admin")).status, 404);
      const opened = await openRoute(ownPlan.dispatchPlanId);
      assert.equal(opened.status, 200, JSON.stringify(opened.body));
      assert.equal(opened.body.routes.length, 1);
      assert.deepEqual(opened.body.scopeIds, [second.id]);
      assert.deepEqual(opened.body.stops.map((stop: any) => stop.id), [second.id]);
      assert.deepEqual(opened.body.excluded, []);
      assert.equal(opened.body.routes[0].assigneeId, fixture.viewer.id);
      assert.equal(opened.body.routes[0].routes, undefined);
      assert.equal(opened.body.expiresAt, manual.body.expiresAt, "Dispatch does not extend provider expiry");
      const sharedValidation = { ids: opened.body.scopeIds, fingerprint: opened.body.fingerprint,
        configurationRevision: opened.body.configurationRevision, receivedDispatchId: opened.body.receivedDispatchId };
      assert.equal((await post("/validate", sharedValidation, "viewer")).body.stale, false);
      assert.equal((await post("/validate", { ...sharedValidation, ids: [first.id] }, "viewer")).body.stale, true);
      assert.equal((await post("/dispatch", { planId: ownPlan.dispatchPlanId, route: opened.body })).status, 400, "Clients cannot supply route content");
      const wrongProject = await fetch(base.replace(`/projects/${fixture.projectId}/`, "/projects/999999999/") +
        `/dispatched/${ownPlan.dispatchPlanId}/open`, { method: "POST", headers: { "x-test-actor": "viewer" } });
      assert.equal(wrongProject.status, 404);
      revision = "d".repeat(64);
      assert.equal((await openRoute(ownPlan.dispatchPlanId)).status, 409, "Provider changes invalidate address-reviewed plans");
      revision = "c".repeat(64);
      await storage.setSubrolePermissions(fixture.viewerRoleId, ["workOrders.view", "projects.view"]);
      assert.equal((await openRoute(ownPlan.dispatchPlanId)).status, 403);
      await storage.setSubrolePermissions(fixture.viewerRoleId, ["workOrders.view", "projects.view", "workOrders.optimizeRoute"]);
      await pool.query(`UPDATE "${fixture.schema}".work_orders SET status='Open' WHERE id=$1`, [second.id]);
      assert.equal((await openRoute(ownPlan.dispatchPlanId)).status, 409);
      await pool.query(`UPDATE "${fixture.schema}".work_orders SET status='Scheduled' WHERE id=$1`, [second.id]);
      await pool.query(`UPDATE "${fixture.schema}".work_orders SET address='Changed address' WHERE id=$1`, [second.id]);
      assert.equal((await openRoute(ownPlan.dispatchPlanId)).status, 409, "Old address approval cannot authorize a changed destination");
      await pool.query(`UPDATE "${fixture.schema}".work_orders SET address=$1 WHERE id=$2`, [second.address, second.id]);
      const membership = storage.isUserAssignedToProject.bind(storage);
      t.mock.method(storage, "isUserAssignedToProject", async (userId, projectId) =>
        userId === fixture.viewer.id ? false : membership(userId, projectId));
      assert.equal((await openRoute(ownPlan.dispatchPlanId)).status, 403, "Global project viewing is not an assignee's project assignment");
      t.mock.restoreAll();
      t.mock.method(Date, "now", () => originalNow() + offset);
      const permission = storage.hasPermission.bind(storage);
      const dispatchPermissionMock = t.mock.method(storage, "hasPermission", async (user, key) =>
        user.id === fixture.id && key === "workOrders.optimizeRoute" ? false : permission(user, key));
      assert.equal((await openRoute(ownPlan.dispatchPlanId)).status, 403, "Revoking the sender's permission invalidates the dispatch");
      dispatchPermissionMock.mock.restore();
      const getProject = storage.getProject.bind(storage);
      const inactiveMock = t.mock.method(storage, "getProject", async id => {
        const project = await getProject(id);
        return project ? { ...project, isActive: false } : project;
      });
      assert.equal((await openRoute(ownPlan.dispatchPlanId)).status, 403, "Inactive project access is rechecked");
      inactiveMock.mock.restore();
      const savedOffset = offset;
      offset += 20 * 60000;
      assert.equal((await openRoute(ownPlan.dispatchPlanId)).status, 200, "An activated route can continue beyond fifteen minutes within its original expiry");
      assert.equal((await post(`/dispatched/${otherPlan.dispatchPlanId}/open`, {})).status, 409,
        "A route not yet activated requires a current departure assumption");
      offset = savedOffset;
      assert.equal((await post("/plan", input, "viewer")).body.routes.length, 2, "Authorized non-admin support can dispatch all assignees");
      const getRole = storage.getSubrole.bind(storage);
      t.mock.method(storage, "getSubrole", async id => {
        const role = await getRole(id);
        return id === fixture.viewerRoleId && role ? { ...role, key: "field_technician" } : role;
      });
      assert.equal((await post("/plan", input, "viewer")).status, 403, "Technician cannot submit other users' orders directly");
      assert.equal((await send(ownPlan.dispatchPlanId, "viewer")).status, 403, "Technicians cannot dispatch routes");
      assert.equal((await openRoute(ownPlan.dispatchPlanId)).status, 200, "Technician can open only the route sent for their own assignment");
      const own = await post("/plan", { ...input, ids: [second.id] }, "viewer");
      assert.equal(own.status, 200, JSON.stringify(own.body));
      assert.equal(own.body.routes.length, 1);
      assert.equal(own.body.routes[0].assigneeId, fixture.viewer.id);
      assert.equal((await post("/plan", { ...input, ids: [unassigned.id] }, "viewer")).status, 403);
      assert.equal((await post("/plan", { ...input, ids: [unassigned.id] })).status, 422);
      const validation = { ids: input.ids, fingerprint: planned.body.fingerprint, configurationRevision: planned.body.configurationRevision };
      assert.equal((await post("/validate", validation)).body.stale, false);
      await pool.query(`UPDATE "${fixture.schema}".work_orders SET assigned_user_id=$1 WHERE id=$2`, [fixture.id, second.id]);
      assert.equal((await post("/validate", validation)).body.stale, true, "Reassignment invalidates the complete saved dispatch");
      assert.equal((await openRoute(ownPlan.dispatchPlanId)).status, 403, "Reassignment revokes shared route access");
      assert.deepEqual((await received()).body, []);
      offset += 5 * 3600000;
      assert.equal((await openRoute(ownPlan.dispatchPlanId)).status, 404, "Expired content is evicted");
      assert.equal((await send(ownPlan.dispatchPlanId)).status, 404);
    } finally {
      await storage.setSubrolePermissions(fixture.viewerRoleId, ["workOrders.view", "projects.view"]);
      await pool.query(`UPDATE "${fixture.schema}".work_orders SET assigned_user_id=$1 WHERE id=$2`, [second.assignedUserId, second.id]);
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
});
