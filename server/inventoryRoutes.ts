import type { Express } from "express";
import { z, ZodError } from "zod";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { inventoryCommandSchema, inventoryPermissions, commandPermission, type InventoryState } from "../shared/inventory";
import { InventoryError } from "../shared/inventory-engine";
import { inventoryState, postInventory } from "./inventoryService";
import { inventoryWorkOrderLabels } from "./inventoryWorkOrderLabels";
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
import { serialQuerySchema, stockQuerySchema } from "../shared/inventory-stock-query";
import { prepareStockQueries, queryStock, queryStockSerials, stockOptions, stockSummary } from "./inventoryStockQueries";
import { workRequirements } from "./inventoryRequirements";
import { workKitComponentTrace } from "../shared/inventory-component-details";
import { warehouseAccessible } from "../shared/inventory-location-types";
import { removalConfig } from "../shared/inventory-removal-policy";

export function inventoryVisibleState(state: InventoryState, actor: string, admin: boolean, canCount = true, permissions?: string[]) {
  // Project-level view permits finding stock at other locations and requesting
  // transfers. Posting still requires the acting warehouse's access grant.
  return { ...state, operations: {}, shipmentDrafts: (state.shipmentDrafts ?? []).filter(draft => {
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
      if (!canViewInventory && !(workOrderRead && await storage.hasPermission(user, "workOrders.view")))
        return res.status(403).json({ message: "Inventory view permission required." });
      const permissions = (await storage.getUserEffectivePermissions(user)).filter(p => p.startsWith("inventory."));
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
    const c = res.locals.inventory, state = inventoryVisibleState(await inventoryState(c.project.id), c.user.id, c.admin, c.permissions.includes(inventoryPermissions.count), c.permissions);
    const { rows: users } = await pool.query(`SELECT u.id,u.username FROM public.users u
      WHERE NOT coalesce(u.is_locked,false) AND
      (EXISTS(SELECT 1 FROM public.user_projects up WHERE up.user_id=u.id AND up.project_id=$1)
       OR EXISTS(SELECT 1 FROM public.user_group_members gm JOIN public.user_group_projects gp ON gp.group_id=gm.group_id
         WHERE gm.user_id=u.id AND gp.project_id=$1)) ORDER BY u.username`, [c.project.id]);
    const { rows: actors } = await pool.query(`SELECT id, username FROM public.users WHERE id = ANY($1::text[])`,
      [[...new Set([...state.receipts.map(receipt => receipt.actor), ...state.returns.flatMap(r => (r.history ?? []).map(h => h.actor))])]]);
    const workOrderLabels = await inventoryWorkOrderLabels(c.project.databaseName, state.returns.map(record => record.workOrderId));
    return { enabled: !!c.project.inventoryEnabled, projectName: c.project.name, timezone: c.project.timezone ?? "UTC", workOrderLabels,
      state, permissions: c.permissions, users: users.map(u => ({ id: u.id, username: u.username || u.id })), actors };
  };
  app.use(base, isAuthenticated, auth());
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
    await postInventory(c.project.id, command, c.user.id, c.admin);
    return { ...await snapshot(res), operationId: command.operationId };
  }));
  app.get(`${base}/print/:kind/:id`, handler(async (req, res) => {
    const c = res.locals.inventory, state = inventoryVisibleState(await inventoryState(c.project.id), c.user.id, c.admin);
    const record: any = (req.params.kind === "order" ? state.orders : req.params.kind === "receipt" ? state.receipts : req.params.kind === "count" ? state.counts : req.params.kind === "return" ? state.returns : []).find((r: any) => r.id === req.params.id);
    if (!record) throw Object.assign(new InventoryError("Document not found."), { status: 404 });
    const { rows: actors } = await pool.query(`SELECT id, username FROM public.users WHERE id = ANY($1::text[])`,
      [[...new Set([...state.receipts.map(receipt => receipt.actor), ...state.returns.flatMap(record => (record.history ?? []).map(event => event.actor))])]]);
    const workOrderLabels = req.params.kind === "return"
      ? await inventoryWorkOrderLabels(c.project.databaseName, [record.workOrderId]) : {};
    res.type("html").send(inventoryPrint(req.params.kind, record, state, c.project.name, actors, c.project.timezone ?? "UTC", workOrderLabels));
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
    const id = z.coerce.number().int().positive().parse(req.params.workOrderId);
    if (!c.project.databaseName || !/^[a-z0-9_]+$/.test(c.project.databaseName)) throw new InventoryError("Work-order storage unavailable.");
    const { rows: [wo] } = await pool.query(`SELECT * FROM "${c.project.databaseName}".work_orders WHERE id=$1`, [id]);
    if (!wo) throw new InventoryError("Work order not found.");
    if (!(await visibleAssignedOrders(c.user, [{ assignedUserId: wo.assigned_user_id, assignedGroupId: wo.assigned_group_id }])).length)
      throw Object.assign(new InventoryError("This work order is not assigned to you or your field group."), { status: 403 });
    const s = inventoryVisibleState(await inventoryState(c.project.id), c.user.id, c.admin);
    const allocation = s.allocations.find(a => a.workOrderId === id) || null;
    const { rows: labels } = await pool.query("SELECT label FROM public.work_order_statuses WHERE lower(code)=lower($1)", [wo.status]);
    const canSelect = c.canViewInventory && ![String(wo.status).toLowerCase(), ...labels.map(l => String(l.label).toLowerCase())]
      .some(status => ["completed", "closed", "cancelled"].includes(status));
    const requirements = allocation?.status === "consumed"
      ? s.workRequirements?.find(r => r.workOrderId === id)
      : await workRequirements(pool as any, c.project.id, s, wo);
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
    return { enabled: !!c.project.inventoryEnabled, canSelect, canManageInventory: c.canViewInventory,
      allocation, requirements: requirements ?? { workOrderId: id, lines: [], missing: [] },
      items: c.canViewInventory ? s.items : s.items.filter(item => referencedItems.has(item.id))
        .map(({ cost, billingRate, vendorId, ...item }) => item),
      warehouses: c.canViewInventory ? s.warehouses : s.warehouses.filter(w => referencedWarehouses.has(w.id))
        .map(({ id, code, name, type, locationTypeId, active }) => ({ id, code, name, type, locationTypeId, active })),
      locationTypes: s.locationTypes, fieldSettings: c.canViewInventory ? s.fieldSettings : undefined, revision: s.revision,
      canChangeFieldStock: c.canViewInventory && (c.admin || c.permissions.includes(inventoryPermissions.maintain) || c.permissions.includes(inventoryPermissions.configure)),
      componentTrace,
      removalRules: removalConfig(s).rules, removalPolicies: [removalConfig(s).policy],
      workflow: { wizardMode: c.project.wizardMode ?? "changeout", equipment: c.project.changeoutEquipmentType ?? "both", readingEquipment: c.project.readingEquipmentType ?? "both" } };
  }));
}
// insertAuditEvent only needs a query-capable connection for this single event.
function awaitClient() { return pool as unknown as import("pg").PoolClient; }
