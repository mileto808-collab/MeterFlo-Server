import type { Express } from "express";
import { z } from "zod";
import { pool } from "./db";
import { storage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { accessLockCapabilities } from "./accessLocks";
import { subscribeInventoryEvents } from "./inventoryEvents";
import { fulfillmentTicketNumber, type InventoryPickupResponse, type InventoryPickupNotice } from "../shared/inventory-pickups";
import type { User, Project } from "../shared/schema";

async function pickupAccess(userId: string): Promise<{ user: User; projects: Project[] }> {
  const user = await storage.getUser(userId);
  if (!user || user.isLocked || user.role === "customer" ||
      !await storage.hasPermission(user, "workOrders.view") && !await storage.hasPermission(user, "inventory.view"))
    throw Object.assign(new Error("Pickup access required."), { status: 403 });
  const admin = await storage.isAdminUser(user);
  const caps = await accessLockCapabilities(user);
  const { rows: locks } = await pool.query("SELECT project_id FROM public.access_locks WHERE locked=true");
  if (!caps.site && locks.some(lock => lock.project_id === null))
    throw Object.assign(new Error("Access is temporarily locked."), { status: 423 });
  const blocked = new Set(locks.filter(lock => lock.project_id !== null).map(lock => Number(lock.project_id)));
  const { rows } = admin ? { rows: [] } : await pool.query(`SELECT project_id FROM public.user_projects WHERE user_id=$1
    UNION SELECT gp.project_id FROM public.user_group_members gm
    JOIN public.user_group_projects gp ON gp.group_id=gm.group_id WHERE gm.user_id=$1`, [user.id]);
  const member = new Set(rows.map(row => Number(row.project_id)));
  const projects = (await storage.getProjects()).filter(project => project.inventoryEnabled &&
    project.wizardMode !== "reading_only" && (admin || member.has(project.id)) && (caps.project || !blocked.has(project.id)));
  const inactive = projects.some(project => project.isActive === false)
    ? await storage.hasPermission(user, "projects.viewInactive") : false;
  return { user, projects: projects.filter(project => project.isActive !== false || inactive) };
}

/** Reads only relational batch/item/custody rows, never a project's full inventory aggregate. */
export async function inventoryPickups(userId: string): Promise<InventoryPickupResponse> {
  const { projects } = await pickupAccess(userId);
  if (!projects.length) return { pickups: [], unreadCount: 0 };
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: batches } = await connection.query(`SELECT b.*,v.name vehicle_name,s.name staging_name,
      concat_ws(' · ',nullif(s.code,''),nullif(s.location,''),nullif(s.address,'')) staging_location,
      coalesce(seen.revision,0) seen_revision,
      (SELECT max(r.occurred_at) FROM public.inventory_receipts r WHERE r.project_id=b.project_id
        AND r.reference=b.id AND r.action IN ('fulfillmentMove','fulfillmentReady') AND r.warehouse_id=b.staging_id) ready_at,
      (SELECT r.reason FROM public.inventory_receipts r WHERE r.project_id=b.project_id AND r.reference=b.id
        AND r.action IN ('fulfillmentMove','fulfillmentReady') AND r.warehouse_id=b.staging_id
        ORDER BY r._position DESC LIMIT 1) notes
      FROM public.inventory_fulfillment_batches b
      JOIN public.inventory_warehouses v ON v.project_id=b.project_id AND v.id=b.vehicle_id AND v.active AND v.type='vehicle'
      JOIN public.inventory_warehouses s ON s.project_id=b.project_id AND s.id=b.staging_id AND s.active
      LEFT JOIN public.inventory_pickup_views seen ON seen.project_id=b.project_id AND seen.batch_id=b._key AND seen.user_id=$2
      WHERE b.project_id=ANY($1::int[]) AND b.status='active'
        AND (v.assigned_user_id=$2 OR EXISTS(SELECT 1 FROM public.inventory_warehouses_values vu
          WHERE vu.project_id=v.project_id AND vu.parent_id=v._key AND vu.field='userIds' AND vu.value=$2))
        AND EXISTS(SELECT 1 FROM public.inventory_fulfillment_lines l WHERE l.project_id=b.project_id
          AND l.parent_id=b._key AND l.staged_quantity>l.delivered_quantity)
        AND (coalesce(b.pickup_ready,false) OR NOT EXISTS(SELECT 1 FROM public.inventory_fulfillment_lines l
          WHERE l.project_id=b.project_id AND l.parent_id=b._key AND l.staged_quantity<l.quantity))
      ORDER BY b.created_at DESC,b._position DESC`, [projects.map(project => project.id), userId]);
    if (!batches.length) { await connection.query("COMMIT"); return { pickups: [], unreadCount: 0 }; }
    // A reassigned scheduled batch cannot invite its former vehicle to collect it.
    const stale = new Set<string>();
    for (const project of projects) {
      const scheduled = batches.filter(batch => batch.project_id === project.id && batch.mode === "scheduled");
      if (!scheduled.length) continue;
      if (!project.databaseName || !/^[a-z0-9_]+$/.test(project.databaseName)) throw new Error("Project storage unavailable.");
      const { rows } = await connection.query(`SELECT DISTINCT saved.parent_id
        FROM public.inventory_fulfillment_work_orders saved
        LEFT JOIN "${project.databaseName}".work_orders w ON w.id=saved.work_order_id
        WHERE saved.project_id=$1 AND saved.parent_id=ANY($2::text[]) AND
          (w.id IS NULL OR coalesce(w.assignment_version,0)<>saved.assignment_version OR NOT
            (lower(w.status)='scheduled' OR EXISTS(SELECT 1 FROM public.work_order_statuses status
              WHERE lower(status.code)='scheduled' AND lower(status.label)=lower(w.status))))`,
      [project.id, scheduled.map(batch => batch._key)]);
      for (const row of rows) stale.add(`${project.id}:${row.parent_id}`);
    }
    const { rows: lines } = await connection.query(`SELECT l.*,i.sku,i.name,i.unit,
      coalesce((SELECT array_agg(value ORDER BY value_no) FROM public.inventory_fulfillment_lines_values sv
        WHERE sv.project_id=l.project_id AND sv.parent_id=l.parent_id AND sv.path=l.path
          AND sv.line_no=l.line_no AND sv.field='stagedSerials'),'{}') staged_serials,
      coalesce((SELECT array_agg(value ORDER BY value_no) FROM public.inventory_fulfillment_lines_values dv
        WHERE dv.project_id=l.project_id AND dv.parent_id=l.parent_id AND dv.path=l.path
          AND dv.line_no=l.line_no AND dv.field='deliveredSerials'),'{}') delivered_serials
      FROM public.inventory_fulfillment_lines l LEFT JOIN public.inventory_items i
        ON i.project_id=l.project_id AND i.id=l.item_id
      WHERE (l.project_id,l.parent_id) IN (SELECT * FROM unnest($1::int[],$2::text[]))
      ORDER BY l.line_no`, [batches.map(batch => batch.project_id), batches.map(batch => batch._key)]);
    const pickups: InventoryPickupNotice[] = batches.filter(batch => !stale.has(`${batch.project_id}:${batch._key}`)).map(batch => {
      const project = projects.find(project => project.id === batch.project_id)!;
      const items = new Map<string, InventoryPickupNotice["items"][number]>();
      for (const line of lines.filter(line => line.project_id === batch.project_id && line.parent_id === batch._key)) {
        const item: InventoryPickupNotice["items"][number] = items.get(line.item_id) ?? { itemId: line.item_id, sku: line.sku ?? "", name: line.name ?? "Unavailable item",
          unit: line.unit ?? "each", plannedQuantity: 0, stagedQuantity: 0, deliveredQuantity: 0,
          readyQuantity: 0, remainingToStage: 0, serials: [] };
        item.plannedQuantity += line.quantity; item.stagedQuantity += line.staged_quantity;
        item.deliveredQuantity += line.delivered_quantity;
        item.readyQuantity += line.staged_quantity - line.delivered_quantity;
        item.remainingToStage += line.quantity - line.staged_quantity;
        item.serials.push(...line.staged_serials.filter((serial: string) => !line.delivered_serials.includes(serial)));
        items.set(line.item_id, item);
      }
      return { projectId: project.id, projectName: project.name, timezone: project.timezone ?? "UTC",
        batchId: batch.id, batchName: batch.name, ticketNumber: fulfillmentTicketNumber(batch.created_at, batch._position),
        revision: batch.revision, createdAt: batch.created_at, readyAt: batch.ready_at ?? batch.created_at,
        status: [...items.values()].some(item => item.remainingToStage > 0) ? "partial" : "ready",
        vehicleId: batch.vehicle_id, vehicleName: batch.vehicle_name, stagingName: batch.staging_name,
        stagingLocation: batch.staging_location, notes: batch.notes ?? "", unread: batch.seen_revision < batch.revision,
        items: [...items.values()].map(item => ({ ...item, serials: [...new Set(item.serials)] })) };
    });
    await connection.query("COMMIT");
    return { pickups, unreadCount: pickups.filter(pickup => pickup.unread).length };
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
}

export function registerInventoryPickupRoutes(app: Express) {
  const error = (res: any, failure: any) => {
    if (!failure?.status) console.error("[InventoryPickup] Request failed", {
      code: failure?.code, routine: failure?.routine, constraint: failure?.constraint,
      parameter: String(failure?.message ?? "").match(/parameter \$\d+/)?.[0],
    });
    return res.status(failure?.status ?? 503)
      .json({ message: failure?.status ? failure.message : "Pickup information could not be loaded." });
  };
  app.get("/api/inventory/pickups", isAuthenticated, async (req: any, res) => {
    res.set("Cache-Control", "no-store");
    try { res.json(await inventoryPickups(req.user.claims.sub)); } catch (failure) { error(res, failure); }
  });
  app.post("/api/inventory/pickups/:projectId/:batchId/view", isAuthenticated, async (req: any, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const projectId = z.coerce.number().int().positive().parse(req.params.projectId);
      const batchId = z.string().uuid().parse(req.params.batchId);
      const { revision } = z.object({ revision: z.number().int().positive() }).strict().parse(req.body);
      const userId = req.user.claims.sub;
      const pickup = (await inventoryPickups(userId)).pickups.find(row => row.projectId === projectId && row.batchId === batchId);
      if (!pickup) return res.status(404).json({ message: "This pickup is no longer available to your vehicle." });
      if (pickup.revision !== revision) return res.status(409).json({ message: "Pickup changed. Review its current contents." });
      const result = await pool.query(`INSERT INTO public.inventory_pickup_views(project_id,batch_id,user_id,revision)
        SELECT b.project_id,b._key,$3::text,b.revision FROM public.inventory_fulfillment_batches b
        JOIN public.inventory_warehouses v ON v.project_id=b.project_id AND v.id=b.vehicle_id AND v.active
        WHERE b.project_id=$1::integer AND b.id=$2::text AND b.revision=$4::integer AND b.status='active' AND
          (v.assigned_user_id::text=$3::text OR EXISTS(SELECT 1 FROM public.inventory_warehouses_values vu
            WHERE vu.project_id=v.project_id AND vu.parent_id=v._key AND vu.field='userIds' AND vu.value=$3::text))
        ON CONFLICT(project_id,batch_id,user_id) DO UPDATE SET revision=greatest(inventory_pickup_views.revision,excluded.revision),viewed_at=now()`,
      [projectId, batchId, userId, revision]);
      if (!result.rowCount) return res.status(409).json({ message: "Pickup changed. Reload before acknowledging it." });
      res.json({ viewed: true });
    } catch (failure) {
      if (failure instanceof z.ZodError) return res.status(400).json({ message: "Invalid pickup acknowledgment." });
      error(res, failure);
    }
  });
  app.get("/api/inventory/pickups/events", isAuthenticated, async (req: any, res) => {
    let closed = false, checking = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const subscriptions = new Map<number, () => void>();
    const close = () => {
      closed = true; if (timer) clearInterval(timer);
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear(); if (!res.writableEnded) res.end();
    };
    req.on("close", close);
    const refresh = async () => {
      if (closed || checking) return;
      checking = true;
      try {
        const { projects } = await pickupAccess(req.user.claims.sub);
        const ids = new Set(projects.map(project => project.id));
        for (const [id, unsubscribe] of subscriptions) if (!ids.has(id)) { unsubscribe(); subscriptions.delete(id); }
        for (const id of ids) if (!subscriptions.has(id)) {
          const unsubscribe = await subscribeInventoryEvents(id, () => {
            // Never send private data or trust a previously authorized subscription.
            if (!closed) void refresh();
          });
          if (closed) { unsubscribe(); return; }
          subscriptions.set(id, unsubscribe);
        }
        if (!closed) res.write(`data: ${JSON.stringify({ type: "resync" })}\n\n`);
      } catch {
        if (!closed) res.write(`data: ${JSON.stringify({ type: "access_lost" })}\n\n`);
        close();
      } finally { checking = false; }
    };
    try {
      await pickupAccess(req.user.claims.sub);
      res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.flushHeaders();
      await refresh();
      if (!closed) { timer = setInterval(() => { void refresh(); }, 15000); timer.unref(); }
    } catch (failure) { if (!res.headersSent) error(res, failure); close(); }
  });
}
