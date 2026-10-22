import type { Express } from "express";
import { z, ZodError } from "zod";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { inventoryCommandSchema, inventoryPermissions, commandPermission, type InventoryState } from "../shared/inventory";
import { InventoryError } from "../shared/inventory-engine";
import { inventoryState, postInventory } from "./inventoryService";
import { fulfillmentReassignmentReview, reassignmentDemandState } from "./inventoryFulfillmentReassignment";
import { inventoryWorkOrderLabels, inventoryWorkOrderContext } from "./inventoryWorkOrderLabels";
import { inventoryActivityGroups } from "../shared/inventory-activity-groups";
import { inventoryActivityPrint } from "./inventoryActivityPrint";
import { inventoryReceiptContexts } from "../shared/inventory-receipt-context";
import { inventoryStreamAllowed, inventoryStreamPermissions, subscribeInventoryEvents } from "./inventoryEvents";
import { storage } from "./storage";
import { visibleAssignedOrders } from "./workOrderVisibility";
import { pool } from "./db";
import { isAuthenticated } from "./replitAuth";
import { getProjectFilesPath } from "./fileStorage";
import { insertAuditEvent } from "./auditService";
import { auditingEnabled } from "./auditContext";
import { inventoryPrint } from "./inventoryPrint";
export { inventoryPrint } from "./inventoryPrint";
import { draftWarehouse, isShipmentDraftAction } from "../shared/inventory-shipment-drafts";
import { inventoryCapabilities } from "../shared/inventory-capabilities";
import { serialQuerySchema, stockQuerySchema } from "../shared/inventory-stock-query";
import { prepareStockQueries, queryStock, queryStockSerials, stockOptions, stockSummary } from "./inventoryStockQueries";
import { workRequirements } from "./inventoryRequirements";
import { workKitComponentTrace } from "../shared/inventory-component-details";
import { warehouseAccessible } from "../shared/inventory-location-types";
import { removalConfig } from "../shared/inventory-removal-policy";
import { fulfillmentOrders } from "./inventoryFulfillment";
import { fulfillmentResumeStatus } from "../shared/inventory-fulfillment";
import { fulfillmentDeletionStatus } from "../shared/inventory-fulfillment-deletion";
import { checkFulfillmentSerials } from "../shared/inventory-fulfillment-scans";
import { normalizeInventoryLocations } from "../shared/inventory-location-types";
import { readRelationalInventory } from "./inventoryRelational";
import { registerInventoryPickupRoutes } from "./inventoryPickups";
import { inventoryPickTicket } from "./inventoryPickTicket";
import { registerFulfillmentDraftRoutes } from "./inventoryFulfillmentDrafts";
import { workOrderInventoryCapabilities } from "../shared/work-order-inventory-capabilities";
import { vehicleTransferOptions } from "./inventoryVehicleTransfer";

export function inventoryVisibleState(state: InventoryState, actor: string, admin: boolean, canCount = true, permissions?: string[]) {
  // Project-level view permits finding stock at other locations and requesting
  // transfers. Posting still requires the acting warehouse's access grant.
  return { ...state, operations: {}, fulfillmentDrafts: [], shipmentDrafts: (state.shipmentDrafts ?? []).filter(draft => {
    if (!admin && draft.ownerId !== actor) return false;
    if (permissions && !permissions.includes(draft.stage === "dispatch" ? inventoryPermissions.transfer : inventoryPermissions.receive)) return false;
    const warehouse = state.warehouses.find(w => w.id === draftWarehouse(state, draft.orderId, draft.stage));
    return warehouseAccessible(state, warehouse, actor, admin);
  }), counts: state.counts.map(count => {
    const warehouse = state.warehouses.find(w => w.id === count.warehouseId);
    if (canCount && warehouseAccessible(state, warehouse, actor, admin)) return count;
    const { draft, ...visible } = count;
    return visible;
  }) };
}
export function registerInventoryRoutes(app: Express) {
  registerInventoryPickupRoutes(app);
  const base = "/api/projects/:projectId/inventory";
  const auth = (workOrderRead = false) => async (req: any, res: any, next: any) => {
    try {
      const projectId = z.coerce.number().int().positive().parse(req.params.projectId);
      const user = await storage.getUser(req.user.claims.sub);
      if (!user || user.isLocked) return res.status(401).json({ message: "Sign in required." });
      const admin = await storage.isAdminUser(user), project = await storage.getProject(projectId);
      if (!project || !admin && !await storage.isUserAssignedToProject(user.id, projectId)) return res.status(403).json({ message: "Project access required." });
      if (project.isActive === false && !await storage.hasPermission(user, "projects.viewInactive")) return res.status(403).json({ message: "Inactive project access required." });
      const canViewInventory = await storage.hasPermission(user, inventoryPermissions.view);
      const planningCommand = req.method === "POST" && req.path === "/commands" && req.body?.action === "plan" &&
        await storage.hasPermission(user, inventoryPermissions.plan) && await storage.hasPermission(user, "workOrders.view");
      if (!canViewInventory && !planningCommand && !(workOrderRead && await storage.hasPermission(user, "workOrders.view")))
        return res.status(403).json({ message: "Inventory view permission required." });
      const permissions = (await storage.getUserEffectivePermissions(user)).filter(p => p.startsWith("inventory.") || p === "workOrders.view");
      res.locals.inventory = { user, admin, project, permissions, canViewInventory };
      res.set("Cache-Control", "no-store"); next();
    } catch { res.status(503).json({ message: "Inventory access could not be verified." }); }
  };
  const handler = (fn: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    try { const result = await fn(req, res); if (!res.headersSent) res.json(result); }
    catch (e) {
      res.status(e instanceof ZodError ? 400 : e instanceof InventoryError ? e.status : 500)
        .json({ message: e instanceof ZodError ? e.errors.map(x => `${x.path.join(".")}: ${x.message}`).join("; ") :
          e instanceof InventoryError ? e.message : "Inventory operation failed; no success is assumed." });
    }
  };
  const snapshot = async (res: any) => {
    const c = res.locals.inventory, state = inventoryVisibleState(normalizeInventoryLocations(await inventoryState(c.project.id)), c.user.id, c.admin, c.permissions.includes(inventoryPermissions.count), c.permissions);
    const { rows: users } = await pool.query(`SELECT u.id,u.username FROM public.users u
      WHERE NOT coalesce(u.is_locked,false) AND
      (EXISTS(SELECT 1 FROM public.user_projects up WHERE up.user_id=u.id AND up.project_id=$1)
       OR EXISTS(SELECT 1 FROM public.user_group_members gm JOIN public.user_group_projects gp ON gp.group_id=gm.group_id
         WHERE gm.user_id=u.id AND gp.project_id=$1)) ORDER BY u.username`, [c.project.id]);
    const { rows: actors } = await pool.query(`SELECT id, username FROM public.users WHERE id = ANY($1::text[])`,
      [[...new Set([...state.receipts.map(receipt => receipt.actor), ...state.returns.flatMap(r => (r.history ?? []).map(h => h.actor))])]]);
    const receiptContexts = inventoryReceiptContexts(state);
    const workOrders = await inventoryWorkOrderContext(c.project.databaseName,
      [...state.returns.map(record => record.workOrderId), ...[...receiptContexts.values()].flatMap(context => context.workOrderIds)]);
    const workOrderLabels = workOrders.labels;
    return { enabled: !!c.project.inventoryEnabled, projectName: c.project.name, timezone: c.project.timezone ?? "UTC", workOrderLabels, workOrderIdentifiers: workOrders.identifiers,
      state, permissions: c.permissions, users: users.map(u => ({ id: u.id, username: u.username || u.id })), actors };
  };
  app.use(base, isAuthenticated, auth());
  const requireFulfillment = (context: any) => {
    if (!inventoryCapabilities(permission => context.admin || context.permissions.includes(permission)).fulfillment)
      throw Object.assign(new InventoryError("Fulfillment requires inventory view, work-order view, assign, receive and transfer permissions."), { status: 403 });
  };
  registerFulfillmentDraftRoutes(app, base, handler, requireFulfillment);
  app.post(`${base}/fulfillment/:id/check-serials`, handler(async (req, res) => {
    const c = res.locals.inventory;
    requireFulfillment(c);
    if (!c.project.inventoryEnabled) throw new InventoryError("Project inventory is disabled.");
    const id = z.string().uuid().parse(req.params.id);
    const input = z.object({
      phase: z.enum(["stage", "vehicle"]),
      lines: z.array(z.object({
        itemId: z.string().trim().min(1).max(100),
        serials: z.array(z.string().trim().min(1).max(100)).max(10000),
      }).strict()).max(500),
    }).strict().parse(req.body);
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const state = normalizeInventoryLocations(await readRelationalInventory(connection, c.project.id, { readOnly: true }));
      const batch = state.fulfillmentBatches?.find(value => value.id === id);
      if (!batch) throw Object.assign(new InventoryError("Batch not found in this project."), { status: 404 });
      const ids = [...new Set(batch.workOrders.map(work => work.workOrderId))];
      const orders = await fulfillmentOrders(connection, c.project.id, state, c.user, ids);
      if (orders.length !== ids.length)
        throw Object.assign(new InventoryError("Work-order access changed. Ask an authorized warehouse manager to review this batch."), { status: 403 });
      const resume = fulfillmentResumeStatus(state, batch, orders, c.user.id, c.admin);
      if (!resume.resumable) throw new InventoryError(resume.reason ?? "This batch must be reviewed before scanning.");
      const problems = checkFulfillmentSerials(state, batch, input.phase, input.lines);
      await connection.query("COMMIT");
      return { problems, revision: state.revision };
    } catch (error) { await connection.query("ROLLBACK"); throw error; }
    finally { connection.release(); }
  }));
  app.get(`${base}/fulfillment/:id/ticket`, handler(async (req, res) => {
    const c = res.locals.inventory;
    requireFulfillment(c);
    if (!c.project.inventoryEnabled) throw new InventoryError("Project inventory is disabled.");
    const id = z.string().uuid().parse(req.params.id);
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const state = normalizeInventoryLocations(await readRelationalInventory(connection, c.project.id, { readOnly: true }));
      const batch = state.fulfillmentBatches?.find(value => value.id === id);
      if (!batch) throw Object.assign(new InventoryError("This pick ticket's batch was not found in the current project."), { status: 404 });
      const ids = [...new Set(batch.workOrders.map(work => work.workOrderId))];
      const orders = await fulfillmentOrders(connection, c.project.id, state, c.user, ids);
      if (orders.length !== ids.length)
        throw Object.assign(new InventoryError("Work-order access changed. An authorized warehouse manager must review this ticket."), { status: 403 });
      const resume = fulfillmentResumeStatus(state, batch, orders, c.user.id, c.admin);
      // A crew can collect a verified partial pull without waiting for all outstanding demand.
      if (resume.resumable && batch.lines.some(line => line.stagedQuantity > line.deliveredQuantity))
        resume.nextStep = "vehicle";
      await connection.query("COMMIT");
      return { batch, resume };
    } catch (error) { await connection.query("ROLLBACK"); throw error; }
    finally { connection.release(); }
  }));
  app.get(`${base}/fulfillment/:id/pick-ticket`, handler(async (req, res) => {
    const c = res.locals.inventory;
    requireFulfillment(c);
    if (!c.project.inventoryEnabled || !await storage.hasPermission(c.user, "workOrders.view"))
      throw Object.assign(new InventoryError("Project inventory and work-order access required."), { status: 403 });
    const id = z.string().uuid().parse(req.params.id);
    const state = await inventoryState(c.project.id);
    const batch = state.fulfillmentBatches?.find(batch => batch.id === id);
    if (!batch) throw Object.assign(new InventoryError("Batch not found."), { status: 404 });
    const connection = await pool.connect();
    try {
      const visible = await fulfillmentOrders(connection, c.project.id, state, c.user, batch.workOrders.map(work => work.workOrderId));
      if (visible.length !== batch.workOrders.length)
        throw Object.assign(new InventoryError("Work-order access required for this ticket."), { status: 403 });
    } finally { connection.release(); }
    const vehicle = state.warehouses.find(location => location.id === batch.vehicleId);
    const { rows: users } = await pool.query("SELECT id,username FROM public.users WHERE id=ANY($1::text[]) AND NOT coalesce(is_locked,false)",
      [[...(vehicle?.userIds ?? []), ...(vehicle?.assignedUserId ? [vehicle.assignedUserId] : [])]]);
    const labels = await inventoryWorkOrderLabels(c.project.databaseName, batch.workOrders.map(work => work.workOrderId));
    res.type("html").send(await inventoryPickTicket(batch, state, c.project, users, `${req.protocol}://${req.get("host")}`, labels));
  }));
  app.get(`${base}/fulfillment/:id/reassignment`, handler(async (req, res) => {
    const c = res.locals.inventory;
    if (!c.project.inventoryEnabled) throw new InventoryError("Project inventory is disabled.");
    for (const permission of ["inventory.assign", "inventory.receive", "inventory.transfer", "workOrders.view"])
      if (!await storage.hasPermission(c.user, permission))
        throw Object.assign(new InventoryError("Fulfillment viewing, assign, receive and transfer permissions are required."), { status: 403 });
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const state = normalizeInventoryLocations(await readRelationalInventory(connection, c.project.id, { readOnly: true }));
      const batch = state.fulfillmentBatches?.find(value => value.id === req.params.id);
      if (!batch) throw Object.assign(new InventoryError("Batch not found in this project."), { status: 404 });
      const orders = await fulfillmentOrders(connection, c.project.id, reassignmentDemandState(state, batch),
        c.user, batch.workOrders.map(work => work.workOrderId));
      if (orders.length !== batch.workOrders.length)
        throw Object.assign(new InventoryError("Work-order access changed. An authorized warehouse manager must review this batch."), { status: 403 });
      const review = await fulfillmentReassignmentReview(connection, c.project.id, state, batch, orders, c.user, c.admin);
      await connection.query("COMMIT");
      res.set("Cache-Control", "no-store");
      return review;
    } catch (error) { await connection.query("ROLLBACK"); throw error; }
    finally { connection.release(); }
  }));
  app.get(`${base}/fulfillment`, handler(async (_req, res) => {
    const c = res.locals.inventory;
    requireFulfillment(c);
    if (!c.project.inventoryEnabled) throw new InventoryError("Project inventory is disabled.");
    if (!await storage.hasPermission(c.user, "workOrders.view"))
      throw Object.assign(new InventoryError("Work-order view permission required."), { status: 403 });
    const connection = await pool.connect();
    try {
      await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const state = normalizeInventoryLocations(await readRelationalInventory(connection, c.project.id, { readOnly: true }));
      const orders = await fulfillmentOrders(connection, c.project.id, state, c.user);
      // Batch history contains customer work identities: apply the same work visibility.
      const allIds = [...new Set((state.fulfillmentBatches ?? []).flatMap(b => b.workOrders.map(w => w.workOrderId)))];
      const batchOrders = allIds.length ? await fulfillmentOrders(connection, c.project.id, state, c.user, allIds) : [];
      const visible = new Set(batchOrders.map(w => w.workOrderId));
      const batches = (state.fulfillmentBatches ?? []).filter(b => b.workOrders.every(w => visible.has(w.workOrderId)));
      const resumeStatus = Object.fromEntries(batches.map(batch => [batch.id,
        fulfillmentResumeStatus(state, batch, batchOrders, c.user.id, c.admin)]));
      await connection.query("COMMIT");
      const batchDeletionStatus = Object.fromEntries(batches.map(batch => [batch.id, fulfillmentDeletionStatus(state, batch)]));
      return { orders, batches, resumeStatus, batchDeletionStatus,
        deletableBatchIds: batches.filter(batch => batchDeletionStatus[batch.id].allowed).map(batch => batch.id),
        timezone: c.project.timezone ?? "UTC" };
    } catch (error) { await connection.query("ROLLBACK"); throw error; }
    finally { connection.release(); }
  }));
  app.get(`${base}/type-links`, handler(async (_req, res) => {
    const c = res.locals.inventory;
    const [state, systemTypes, moduleTypes] = await Promise.all([
      inventoryState(c.project.id), storage.getSystemTypes(c.project.id), storage.getModuleTypes(c.project.id),
    ]);
    return { links: state.typeLinks ?? [], items: state.items, systemTypes, moduleTypes };
  }));
  app.get(`${base}/events`, async (req: any, res) => {
    const { project, user } = res.locals.inventory;
    if (!project.inventoryEnabled) return res.status(403).json({ message: "Project inventory is disabled." });
    if (req.query.probe === "1") return res.json({ enabled: true });
    let closed = false;
    let unsubscribe: (() => void) | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let checking = false;
    const close = () => {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    };
    req.on("close", close);
    let permissionSignature = JSON.stringify([...res.locals.inventory.permissions].sort());
    const deliver = async (event?: import("../shared/inventory-events").InventoryLiveEvent) => {
      // Never forward cached authorization after membership/role/warehouse changes.
      // Events contain metadata only; all data is fetched through its usual API.
      if (closed) return;
      try {
        const permissions = await inventoryStreamPermissions(project.id, user.id);
        if (!permissions) {
          if (!closed) res.write(`data: ${JSON.stringify({ type: "access_lost", projectId: project.id })}\n\n`);
          close();
          return;
        }
        if (closed) return;
        const nextSignature = JSON.stringify(permissions);
        if (event) res.write(`data: ${JSON.stringify(event)}\n\n`);
        else if (nextSignature !== permissionSignature)
          res.write(`data: ${JSON.stringify({ type: "resync", projectId: project.id })}\n\n`);
        else res.write(":heartbeat\n\n");
        permissionSignature = nextSignature;
      } catch {
        // Fail closed on unverifiable permissions, but let EventSource reconnect
        // after a transient database failure rather than leaking cached data.
        close();
      }
    };
    try {
      res.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders();
      let subscribed = false;
      const remove = await subscribeInventoryEvents(project.id, event => { if (subscribed) void deliver(event); });
      if (closed) { remove(); return; }
      unsubscribe = remove;
      subscribed = true;
      await deliver({ type: "resync", projectId: project.id });
      if (closed) return;
      heartbeat = setInterval(() => {
        if (checking || closed) return;
        checking = true;
        void deliver().finally(() => { checking = false; });
      }, 15000);
      heartbeat.unref();
    } catch { close(); }
  });
  app.get(base, handler((_req, res) => snapshot(res)));
  // Query-only reads never load the aggregate after cutover. Migration, when
  // needed, retains the existing project lock; page/count reads share one MVCC snapshot.
  const stockRead = (fn: (client: import("pg").PoolClient, req: any, res: any) => Promise<any>) =>
    handler(async (req, res) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await prepareStockQueries(client, res.locals.inventory.project.id);
        await client.query("COMMIT");
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const result = await fn(client, req, res);
        await client.query("COMMIT");
        return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    });
  app.get(`${base}/stock`, stockRead((client, req, res) =>
    queryStock(client, res.locals.inventory.project.id, stockQuerySchema.parse(req.query))));
  app.get(`${base}/vehicle-transfers/options`, handler(async (req, res) => {
    const c = res.locals.inventory;
    const query = z.object({ sourceId: z.string().min(1).max(100).optional(), batchId: z.string().uuid().optional(),
      workOrderIds: z.string().max(6000).optional() }).parse(req.query);
    const ids = query.workOrderIds ? query.workOrderIds.split(",").map(id => z.coerce.number().int().positive().parse(id)) : [];
    if (ids.length > 500) throw new InventoryError("Choose no more than 500 outstanding work orders per handover.");
    const client = await pool.connect();
    try {
      return await vehicleTransferOptions(client, c.project.id, await inventoryState(c.project.id), c.user, c.admin,
        query.sourceId, query.batchId, ids);
    } finally { client.release(); }
  }));
  app.get(`${base}/stock/serials`, stockRead((client, req, res) =>
    queryStockSerials(client, res.locals.inventory.project.id, serialQuerySchema.parse(req.query))));
  app.get(`${base}/stock/options`, stockRead((client, req, res) =>
    stockOptions(client, res.locals.inventory.project.id, z.string().max(300).default("").parse(req.query.q))));
  app.get(`${base}/stock/context`, stockRead(async (client, _req, res) => {
    const c = res.locals.inventory;
    const summary = await stockSummary(client, c.project.id);
    return { enabled: !!c.project.inventoryEnabled, projectName: c.project.name,
      timezone: c.project.timezone ?? "UTC", permissions: c.permissions, summary };
  }));
  app.post(`${base}/commands`, handler(async (req, res) => {
    const c = res.locals.inventory, command = inventoryCommandSchema.parse(req.body);
    let permission = commandPermission(command.action);
    if (isShipmentDraftAction(command.action)) {
      const state = await inventoryState(c.project.id);
      const stage = command.action === "shipmentDraftSave" ? command.data.stage :
        state.shipmentDrafts?.find(d => d.id === command.data.id)?.stage;
      if (!stage) throw new InventoryError("Saved shipment draft not found or invalid stage.");
      permission = stage === "dispatch" ? inventoryPermissions.transfer : inventoryPermissions.receive;
      if (command.action === "shipmentDraftClaim" && !c.admin)
        throw Object.assign(new InventoryError("Administrator access required to take ownership."), { status: 403 });
      const pendingPayload = command.data.payload as Record<string, unknown> | undefined;
      if ((command.data.capture as any)?.closeRemainder || pendingPayload?.closeRemainder) {
        if (!c.permissions.includes(inventoryPermissions.closeOrders))
          throw Object.assign(new InventoryError("Close short orders permission required."), { status: 403 });
      }
    } else if (!permission) {
      const state = await inventoryState(c.project.id);
      const type = command.action === "order" ? command.data.type : state.orders.find(o => o.id === command.data.orderId)?.type;
      permission = type === "purchase" ? inventoryPermissions.purchase : inventoryPermissions.transfer;
    }
    if (!c.permissions.includes(permission)) throw Object.assign(new InventoryError("Inventory action permission required."), { status: 403 });
    if (command.data.closeRemainder === true && !c.permissions.includes(inventoryPermissions.closeOrders))
      throw Object.assign(new InventoryError("Close short orders permission required."), { status: 403 });
    if (["receive", "accept", "dispatch"].includes(command.action)) {
      const required = command.action === "dispatch" ? inventoryPermissions.transfer : inventoryPermissions.receive;
      if (!c.permissions.includes(required)) throw Object.assign(new InventoryError("Posting permission required."), { status: 403 });
    }
    if (command.action === "item") {
      const images = command.data.images;
      if (Array.isArray(images) && images.some(url => typeof url !== "string" || !url.startsWith(`/api/projects/${c.project.id}/inventory/images/`)))
        throw new InventoryError("Use images uploaded to this project.");
    }
    const posted = await postInventory(c.project.id, command, c.user.id, c.admin);
    if (command.action === "plan") {
      return { operationId: command.operationId, plan: posted.state.workPlans?.find(value => value.workOrderId === command.data.workOrderId) };
    }
    return { ...await snapshot(res), operationId: command.operationId };
  }));
  app.get(`${base}/print/:kind/:id`, handler(async (req, res) => {
    const c = res.locals.inventory, state = inventoryVisibleState(await inventoryState(c.project.id), c.user.id, c.admin);
    if (req.params.kind === "fulfillment") requireFulfillment(c);
    let record: any = req.params.kind === "activity"
      ? inventoryActivityGroups(state).find(group => group.receipts.some(receipt => receipt.id === req.params.id))
      : (req.params.kind === "fulfillment" ? state.fulfillmentBatches ?? [] : req.params.kind === "order" ? state.orders : req.params.kind === "receipt" ? state.receipts : req.params.kind === "count" ? state.counts : req.params.kind === "return" ? state.returns : req.params.kind === "customer-handoff" ? state.customerHandoffs ?? [] : []).find((r: any) => r.id === req.params.id);
    if (!record && req.params.kind === "fulfillment")
      record = state.receipts.find(receipt => receipt.reference === req.params.id && receipt.fulfillmentDeletion)?.fulfillmentDeletion?.batch;
    if (!record) throw Object.assign(new InventoryError("Document not found."), { status: 404 });
    const { rows: actors } = await pool.query(`SELECT id, username FROM public.users WHERE id = ANY($1::text[])`,
      [[...new Set([...state.receipts.map(receipt => receipt.actor), ...state.returns.flatMap(record => (record.history ?? []).map(event => event.actor)),
        ...(req.params.kind === "fulfillment" ? [record.createdBy] : [])])]]);
    const handoff = req.params.kind === "customer-handoff" ? record :
      req.params.kind === "receipt" && record.action === "returnCustomerBatch" ? state.customerHandoffs?.find(handoff => handoff.id === record.reference) : undefined;
    const workOrderLabels = req.params.kind === "fulfillment" ? await inventoryWorkOrderLabels(c.project.databaseName, record.workOrders.map((work: { workOrderId: number }) => work.workOrderId)) :
      req.params.kind === "activity" ? await inventoryWorkOrderLabels(c.project.databaseName, record.workOrderIds) : req.params.kind === "return"
      ? await inventoryWorkOrderLabels(c.project.databaseName, [record.workOrderId]) :
      handoff ? await inventoryWorkOrderLabels(c.project.databaseName, handoff.lines.map((line: { workOrderId: number }) => line.workOrderId)) :
      req.params.kind === "receipt" ? await inventoryWorkOrderLabels(c.project.databaseName, inventoryReceiptContexts(state).get(record.id)?.workOrderIds ?? []) : {};
    res.type("html").send(req.params.kind === "activity"
      ? inventoryActivityPrint(inventoryActivityGroups(state, workOrderLabels).find(group => group.id === record.id)!, state,
        c.project.name, actors, c.project.timezone ?? "UTC", workOrderLabels)
      : inventoryPrint(req.params.kind, record, state, c.project.name, actors, c.project.timezone ?? "UTC", workOrderLabels));
  }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  app.post(`${base}/images`, upload.single("image"), handler(async (req, res) => {
    const c = res.locals.inventory;
    if (!c.project.inventoryEnabled || !c.permissions.includes(inventoryPermissions.maintain)) throw Object.assign(new InventoryError("Item maintenance permission required."), { status: 403 });
    const b = req.file?.buffer as Buffer | undefined;
    const ext = b?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png" :
      b && b[0] === 255 && b[1] === 216 && b[2] === 255 ? "jpg" : null;
    if (!ext) throw new InventoryError("Upload a PNG or JPEG image.");
    const name = `${randomUUID()}.${ext}`, dir = path.join(await getProjectFilesPath(), `inventory-${c.project.id}`);
    await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, name), b!);
    if (auditingEnabled) await insertAuditEvent(awaitClient(), { action: "inventory.imageUploaded", entityType: "inventoryItemImage", entityId: name, projectId: c.project.id });
    return { url: `/api/projects/${c.project.id}/inventory/images/${name}` };
  }));
  app.get(`${base}/images/:name`, handler(async (req, res) => {
    if (!/^[0-9a-f-]{36}\.(png|jpg)$/.test(req.params.name)) throw new InventoryError("Invalid image identifier.");
    res.set("X-Content-Type-Options", "nosniff");
    const file = path.join(await getProjectFilesPath(), `inventory-${res.locals.inventory.project.id}`, req.params.name);
    await fs.access(file); res.sendFile(file);
  }));
  app.get("/api/projects/:projectId/work-orders/:workOrderId/inventory", isAuthenticated, auth(true), handler(async (req, res) => {
    const c = res.locals.inventory;
    if (!c.permissions.includes("workOrders.view"))
      throw Object.assign(new InventoryError("Work-order view permission required."), { status: 403 });
    const id = z.coerce.number().int().positive().parse(req.params.workOrderId);
    if (!c.project.databaseName || !/^[a-z0-9_]+$/.test(c.project.databaseName)) throw new InventoryError("Work-order storage unavailable.");
    const { rows: [wo] } = await pool.query(`SELECT * FROM "${c.project.databaseName}".work_orders WHERE id=$1`, [id]);
    if (!wo) throw new InventoryError("Work order not found.");
    const visible = await visibleAssignedOrders(c.user, [{ id: wo.id,
      assignedUserId: wo.assigned_user_id, assignedGroupId: wo.assigned_group_id,
      newSystemType: wo.new_system_type, newModuleType: wo.new_module_type,
      assignmentVersion: wo.assignment_version, status: wo.status }], c.project.id);
    if (!visible.length)
      throw Object.assign(new InventoryError("This work order is not dispatched to your authorized vehicle or assigned work."), { status: 403 });
    const s = inventoryVisibleState(await inventoryState(c.project.id), c.user.id, c.admin);
    const allocation = s.allocations.find(a => a.workOrderId === id) || null;
    const { rows: labels } = await pool.query("SELECT code,label FROM public.work_order_statuses WHERE lower(code)=lower($1) OR lower(label)=lower($1)", [wo.status]);
    const workOrderEditable = ![String(wo.status).toLowerCase(), ...labels.flatMap(l => [String(l.label).toLowerCase(), String(l.code).toLowerCase()])]
      .some(status => ["completed", "closed", "cancelled"].includes(status));
    const canSelect = c.canViewInventory && workOrderEditable;
    const requirements = allocation?.status === "consumed"
      ? s.workRequirements?.find(r => r.workOrderId === id)
      : await workRequirements(pool as any, c.project.id, s, wo);
    const capabilities = workOrderInventoryCapabilities(c.permissions, {
      enabled: !!c.project.inventoryEnabled, editable: workOrderEditable,
      readingOnly: c.project.wizardMode === "reading_only",
      consumed: allocation?.status === "consumed",
      stockEditable: !wo.assigned_user_id || wo.assigned_user_id === c.user.id || c.admin ||
        c.permissions.some((permission: string) => [inventoryPermissions.maintain, inventoryPermissions.configure].includes(permission)),
    });
    const canViewPricing = c.admin || c.permissions.some((permission: string) =>
      [inventoryPermissions.maintain, inventoryPermissions.configure, inventoryPermissions.purchase].includes(permission));
    const componentTrace = workKitComponentTrace(s, id);
    const referencedItems = new Set([
      ...(requirements?.lines ?? []), ...(allocation?.lines ?? []), ...(allocation?.used ?? []),
      ...componentTrace.flatMap(trace => trace.components),
    ].map(line => line.itemId));
    const includeComponents = (id: string, visited = new Set<string>()) => {
      if (visited.has(id)) return;
      visited.add(id);
      for (const child of s.items.find(item => item.id === id)?.components ?? []) {
        referencedItems.add(child.itemId);
        includeComponents(child.itemId, visited);
      }
    };
    [...referencedItems].forEach(id => includeComponents(id));
    const referencedWarehouses = new Set([...(allocation?.lines ?? []), ...(allocation?.used ?? []),
      ...(allocation?.dispositions ?? [])].map(line => line.warehouseId));
    return { enabled: !!c.project.inventoryEnabled, canSelect, canManageInventory: c.canViewInventory, capabilities,
      allocation, inventoryDispatch: (visible[0] as any).inventoryDispatch,
      editable: workOrderEditable, workOrderStatus: wo.status, timezone: c.project.timezone ?? "UTC",
      plan: s.workPlans?.find(plan => plan.workOrderId === id) ?? { workOrderId: id, revision: 0, lines: [] },
      stagingReceipts: s.receipts.filter(receipt => receipt.action === "stageWorkOrder" && receipt.reference === `wo-${id}`),
      reservationNeedsReview: allocation?.status === "reserved" && allocation.assignmentVersion !== undefined &&
        allocation.assignmentVersion !== wo.assignment_version,
      requirements: requirements ?? { workOrderId: id, lines: [], missing: [] },
      items: s.items.filter(item => c.canViewInventory || capabilities.canPlan && item.active || referencedItems.has(item.id))
        .map(item => { if (canViewPricing) return item; const { cost, billingRate, vendorId, ...visible } = item; return visible; }),
      warehouses: c.canViewInventory ? s.warehouses : s.warehouses.filter(w => referencedWarehouses.has(w.id))
        .map(({ id, code, name, type, locationTypeId, active }) => ({ id, code, name, type, locationTypeId, active })),
      locationTypes: s.locationTypes, fieldSettings: c.canViewInventory ? s.fieldSettings : undefined, revision: s.revision,
      canChangeFieldStock: c.canViewInventory && (c.admin || c.permissions.includes(inventoryPermissions.maintain) || c.permissions.includes(inventoryPermissions.configure)),
      componentTrace,
      stockDiscrepancies: (s.stockDiscrepancies ?? []).filter(value => value.workOrderId === id)
        .map(({ id, status, quantity, itemSku }) => ({ id, status, quantity, itemSku })),
      removalRules: removalConfig(s).rules, removalPolicies: [removalConfig(s).policy], fieldRemovalChoices: s.fieldRemovalChoices,
      workflow: { wizardMode: c.project.wizardMode ?? "changeout", equipment: c.project.changeoutEquipmentType ?? "both", readingEquipment: c.project.readingEquipmentType ?? "both" } };
  }));
}
// insertAuditEvent only needs a query-capable connection for this single event.
function awaitClient() { return pool as unknown as import("pg").PoolClient; }
