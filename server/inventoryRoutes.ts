import type { Express } from "express";
import { z, ZodError } from "zod";
import multer from "multer";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promises as fs } from "node:fs";
import { inventoryCommandSchema, inventoryPermissions, commandPermission, type InventoryState } from "../shared/inventory";
import { InventoryError } from "../shared/inventory-engine";
import { inventoryState, postInventory } from "./inventoryService";
import { storage } from "./storage";
import { pool } from "./db";
import { isAuthenticated } from "./replitAuth";
import { getProjectFilesPath } from "./fileStorage";
import { insertAuditEvent } from "./auditService";
import { auditingEnabled } from "./auditContext";
import { inventoryCountReference } from "../shared/inventory-count-reference";
import { shipmentPrint } from "./inventoryShipmentPrint";
import { draftWarehouse, isShipmentDraftAction } from "../shared/inventory-shipment-drafts";

export function inventoryVisibleState(state: InventoryState, actor: string, admin: boolean, canCount = true, permissions?: string[]) {
  // Project-level view permits finding stock at other locations and requesting
  // transfers. Posting still requires the acting warehouse's access grant.
  return { ...state, operations: {}, shipmentDrafts: (state.shipmentDrafts ?? []).filter(draft => {
    if (!admin && draft.ownerId !== actor) return false;
    if (permissions && !permissions.includes(draft.stage === "dispatch" ? inventoryPermissions.transfer : inventoryPermissions.receive)) return false;
    const warehouse = state.warehouses.find(w => w.id === draftWarehouse(state, draft.orderId, draft.stage));
    return !!warehouse?.active && (admin || warehouse.assignedUserId === actor || warehouse.userIds.includes(actor));
  }), counts: state.counts.map(count => {
    const warehouse = state.warehouses.find(w => w.id === count.warehouseId);
    if (canCount && (admin || warehouse?.assignedUserId === actor || warehouse?.userIds.includes(actor))) return count;
    const { draft, ...visible } = count;
    return visible;
  }) };
}
const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function inventoryPrint(kind: string, record: any, state: InventoryState, project: string) {
  const lineList = record.lines || record.snapshot?.map((b: any) => ({ ...b, quantity: b.quantity })) || [];
  const warehouse = (id: string) => state.warehouses.find(w => w.id === id)?.name || id || "";
  const reference = kind === "count" ? inventoryCountReference(state.counts, record.id) : record.id;
  const orderReference = kind === "order" ? record.id :
    kind === "receipt" ? state.orders.find(order => order.id === record.reference)?.id : undefined;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(kind)} ${escape(reference)}</title><style>
    body{font:14px Arial;margin:30px;color:#111}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #bbb;padding:8px;text-align:left}button{padding:10px}@media print{button{display:none}}</style></head>
    <body><button onclick="window.print()">Print / Save PDF</button><h1>${escape(project)} — ${escape(kind)}</h1>
    <p>${kind === "receipt" ? "Receipt ID" : "Reference"}: ${escape(reference)} · Status: ${escape(record.status || record.action)}</p>
    ${orderReference ? `<p><strong>Order ID / reference: ${escape(orderReference)}</strong></p>` :
      kind === "receipt" && record.reference ? `<p>Operation reference: ${escape(record.reference)}</p>` : ""}
    <p>Date: ${escape(record.createdAt || record.occurredAt)} · Actor: ${escape(record.actor)}</p>
    <p>From: ${escape(warehouse(record.sourceId))} · To: ${escape(warehouse(record.destinationId || record.warehouseId))}</p>
    <p>Vendor: ${escape(state.vendors.find(v => v.id === record.vendorId)?.name)} · ${escape(record.reason || record.notes)}</p>
    <table><thead><tr><th>SKU</th><th>Item</th><th>Quantity</th><th>Serials</th><th>Dispatched</th><th>Received</th></tr></thead><tbody>
    ${lineList.map((l: any) => `<tr><td>${escape(state.items.find(i => i.id === l.itemId)?.sku)}</td><td>${escape(state.items.find(i => i.id === l.itemId)?.name)}</td>
    <td>${escape(l.quantity)}</td><td>${escape((l.serials || []).join(", "))}</td><td>${escape((record.dispatched || []).filter((x: any) => x.itemId === l.itemId).reduce((n: number, x: any) => n + x.quantity, 0))}</td>
    <td>${escape((record.received || []).filter((x: any) => x.itemId === l.itemId).reduce((n: number, x: any) => n + x.quantity, 0))}</td></tr>`).join("")}</tbody></table>
    ${shipmentPrint(kind, record, state)}
    ${record.components ? `<h2>Components</h2><p>${escape(record.components.map((l: any) => `${l.itemId}: ${l.quantity} (${l.serials.join(", ")})`).join("; "))}</p>` : ""}</body></html>`;
}
export function registerInventoryRoutes(app: Express) {
  const base = "/api/projects/:projectId/inventory";
  const auth = async (req: any, res: any, next: any) => {
    try {
      const projectId = z.coerce.number().int().positive().parse(req.params.projectId);
      const user = await storage.getUser(req.user.claims.sub);
      if (!user || user.isLocked) return res.status(401).json({ message: "Sign in required." });
      const admin = await storage.isAdminUser(user), project = await storage.getProject(projectId);
      if (!project || !admin && !await storage.isUserAssignedToProject(user.id, projectId)) return res.status(403).json({ message: "Project access required." });
      if (project.isActive === false && !await storage.hasPermission(user, "projects.viewInactive")) return res.status(403).json({ message: "Inactive project access required." });
      if (!await storage.hasPermission(user, inventoryPermissions.view)) return res.status(403).json({ message: "Inventory view permission required." });
      const permissions = (await storage.getUserEffectivePermissions(user)).filter(p => p.startsWith("inventory."));
      res.locals.inventory = { user, admin, project, permissions };
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
    return { enabled: !!c.project.inventoryEnabled, state, permissions: c.permissions, users: users.map(u => ({ id: u.id, username: u.username || u.id })) };
  };
  app.use(base, isAuthenticated, auth);
  app.get(base, handler((_req, res) => snapshot(res)));
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
    const record = (req.params.kind === "order" ? state.orders : req.params.kind === "receipt" ? state.receipts : req.params.kind === "count" ? state.counts : []).find((r: any) => r.id === req.params.id);
    if (!record) throw Object.assign(new InventoryError("Document not found."), { status: 404 });
    res.type("html").send(inventoryPrint(req.params.kind, record, state, c.project.name));
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
  app.get("/api/projects/:projectId/work-orders/:workOrderId/inventory", isAuthenticated, auth, handler(async (req, res) => {
    const c = res.locals.inventory, s = inventoryVisibleState(await inventoryState(c.project.id), c.user.id, c.admin);
    const id = z.coerce.number().int().positive().parse(req.params.workOrderId);
    return { enabled: !!c.project.inventoryEnabled, allocation: s.allocations.find(a => a.workOrderId === id) || null, items: s.items, warehouses: s.warehouses };
  }));
}
// insertAuditEvent only needs a query-capable connection for this single event.
function awaitClient() { return pool as unknown as import("pg").PoolClient; }
