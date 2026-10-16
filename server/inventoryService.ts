import type { PoolClient } from "pg";
import { pool } from "./db";
import { auditContext, auditingEnabled } from "./auditContext";
import { insertAuditEvent } from "./auditService";
import { applyInventoryCommand, canonicalInventoryJson, completeInventoryWorkOrder, InventoryError, warehouseAccess } from "../shared/inventory-engine";
import { emptyInventory, allocationSchema, dispositionSchema, inventoryImportSchema, inventoryPermissions, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { storage } from "./storage";
import { z } from "zod";
import type { SavedShipmentDraft } from "../shared/inventory-shipment-draft-model";

// Saved captures are temporary editing state, not another physical-stock
// ledger. Record useful changes without duplicating every scan on every save.
function shipmentDraftAudit(value: SavedShipmentDraft | undefined) {
  if (!value) return null;
  return { id: value.id, orderId: value.orderId, stage: value.stage, ownerId: value.ownerId,
    savedAt: value.savedAt, revision: value.revision, pendingOperationId: value.pending?.operationId ?? null,
    reason: value.capture.reason, closeRemainder: value.capture.closeRemainder,
    lines: Object.values(value.capture.entries).map(row => ({ itemId: row.itemId,
      goodQuantity: row.goodQuantity, damagedQuantity: row.damagedQuantity, unreadableQuantity: row.unreadableQuantity,
      damageReason: row.damageReason, goodSerialCount: row.goodSerials.length,
      damagedSerialCount: row.damagedSerials.length, expectedReferenceCount: row.expectedSerials.length })),
    unfinishedBuffers: Object.entries(value.capture.scanBuffers).filter(([, text]) => !!text).map(([field, text]) => ({ field, characters: text.length })),
  };
}

export async function inventoryState(projectId: number, client: Pick<PoolClient, "query"> = pool): Promise<InventoryState> {
  const { rows: [r] } = await client.query("SELECT state FROM public.inventory_state WHERE project_id=$1", [projectId]);
  return r?.state || emptyInventory();
}
export async function lockInventory(client: PoolClient, projectId: number) {
  await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2) ON CONFLICT DO NOTHING", [projectId, JSON.stringify(emptyInventory())]);
  const { rows: [r] } = await client.query("SELECT state FROM public.inventory_state WHERE project_id=$1 FOR UPDATE", [projectId]);
  return r.state as InventoryState;
}
export async function saveInventory(client: PoolClient, projectId: number, before: InventoryState, after: InventoryState, operationId: string, action: string) {
  const actor = auditContext.getStore()?.actorId || null;
  const stockKey = (b: { warehouseId: string; itemId: string }) => JSON.stringify([b.warehouseId, b.itemId]);
  const priorStock = new Map(before.stock.map(b => [stockKey(b), b]));
  const reservations = (s: InventoryState) => {
    const totals = new Map<string, number>();
    for (const a of s.allocations) if (a.status === "reserved") for (const l of a.lines) {
      const key = stockKey(l); totals.set(key, (totals.get(key) || 0) + l.quantity);
    }
    return totals;
  };
  const reservedBefore = reservations(before), reservedAfter = reservations(after);
  const changes = [
    ...after.stock.map(b => {
      const key = stockKey(b), prior = priorStock.get(key);
      return { warehouseId: b.warehouseId, itemId: b.itemId, before: prior?.quantity || 0, after: b.quantity,
        reservedBefore: reservedBefore.get(key) || 0, reservedAfter: reservedAfter.get(key) || 0,
        serialsBefore: prior?.serials || [], serialsAfter: b.serials };
    }).filter(b => b.before !== b.after || b.reservedBefore !== b.reservedAfter || JSON.stringify(b.serialsBefore) !== JSON.stringify(b.serialsAfter)),
  ];
  const entityChanges: Array<{ field: string; before: unknown; after: unknown }> = (["warehouses", "vendors", "items", "orders", "allocations", "counts", "returns", "shipmentHolds", "shipmentDrafts"] as const).flatMap(kind => {
    const previous = new Map((before[kind] ?? []).map(value => [((value as any).id ?? (value as any).workOrderId), value]));
    const updates = (after[kind] ?? []).flatMap(value => {
      const id = (value as any).id ?? (value as any).workOrderId;
      const prior = previous.get(id);
      return JSON.stringify(value) === JSON.stringify(prior) ? [] : [{ field: `${kind}/${id}`,
        before: kind === "shipmentDrafts" ? shipmentDraftAudit(prior as SavedShipmentDraft | undefined) : prior || null,
        after: kind === "shipmentDrafts" ? shipmentDraftAudit(value as SavedShipmentDraft) : value }];
    });
    if (kind === "shipmentDrafts") for (const [id, prior] of previous) {
      if (!(after.shipmentDrafts ?? []).some(d => d.id === id))
        updates.push({ field: `${kind}/${id}`, before: shipmentDraftAudit(prior as SavedShipmentDraft), after: null as any });
    }
    return updates;
  });
  if (JSON.stringify(before.categories ?? []) !== JSON.stringify(after.categories ?? []))
    entityChanges.push({ field: "categories", before: before.categories ?? [], after: after.categories ?? [] });
  await client.query("UPDATE public.inventory_state SET state=$2,updated_at=now() WHERE project_id=$1", [projectId, JSON.stringify(after)]);
  // These tables mirror the locked JSON state. Only changed rows need writes;
  // count/order metadata changes must not rewrite every warehouse's balances.
  const previousItems = new Map(before.items.map(i => [i.id, JSON.stringify(i)]));
  for (const i of after.items.filter(i => previousItems.get(i.id) !== JSON.stringify(i))) await client.query(`INSERT INTO public.inventory_items(project_id,id,sku,data) VALUES($1,$2,$3,$4)
    ON CONFLICT(project_id,id) DO UPDATE SET sku=EXCLUDED.sku,data=EXCLUDED.data`, [projectId, i.id, i.sku, JSON.stringify(i)]);
  const changedStock = new Set(changes.map(stockKey));
  for (const b of after.stock.filter(b => !priorStock.has(stockKey(b)) || changedStock.has(stockKey(b)))) await client.query(`INSERT INTO public.inventory_quantities(project_id,warehouse_id,item_id,quantity,reserved,serials)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,warehouse_id,item_id) DO UPDATE SET quantity=EXCLUDED.quantity,reserved=EXCLUDED.reserved,serials=EXCLUDED.serials`,
    [projectId, b.warehouseId, b.itemId, b.quantity, reservedAfter.get(stockKey(b)) || 0, JSON.stringify(b.serials)]);
  await client.query("INSERT INTO public.inventory_movements(project_id,operation_id,action,actor_id,changes) VALUES($1,$2,$3,$4,$5)",
    [projectId, operationId, action, actor, JSON.stringify({ stock: changes, entities: entityChanges })]);
  if (auditingEnabled) await insertAuditEvent(client, { action: `inventory.${action}`, entityType: "inventory", entityId: operationId,
    projectId, changes: changes.map(c => ({ field: `${c.warehouseId}/${c.itemId}`, before: { quantity: c.before, reserved: c.reservedBefore, serials: c.serialsBefore },
      after: { quantity: c.after, reserved: c.reservedAfter, serials: c.serialsAfter } })).concat(entityChanges as any),
    metadata: { revision: after.revision, reference: after.receipts.find(r => r.id === operationId)?.reference || null } });
}
export async function postInventory(projectId: number, command: InventoryCommand, actor: string, admin: boolean) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [p] } = await client.query("SELECT inventory_enabled,is_active FROM public.projects WHERE id=$1 FOR SHARE", [projectId]);
    if (!p?.inventory_enabled) throw new InventoryError("Inventory is disabled for this project.");
    if (p.is_active === false) throw new InventoryError("Reactivate this project before posting inventory.");
    const before = await lockInventory(client, projectId);
    if (["assign", "prepareUse"].includes(command.action)) {
      const { rows: [project] } = await client.query("SELECT database_name FROM public.projects WHERE id=$1", [projectId]);
      if (!project?.database_name || !/^[a-z0-9_]+$/.test(project.database_name)) throw new InventoryError("Project work-order storage unavailable.");
      const id = z.number().int().positive().parse(command.data.workOrderId);
      const { rows: [wo] } = await client.query(`SELECT status,assigned_user_id FROM "${project.database_name}".work_orders WHERE id=$1`, [id]);
      if (!wo) throw new InventoryError("Work order not found in this project.");
      if (!admin && wo.assigned_user_id && wo.assigned_user_id !== actor) throw new InventoryError("Work order assigned to another user.");
      const { rows: labels } = await client.query("SELECT label FROM public.work_order_statuses WHERE lower(code)=lower($1)", [wo.status]);
      if (String(wo.status).toLowerCase() === "completed" || labels.some(l => String(l.label).toLowerCase() === "completed")) throw new InventoryError("Reconcile completed work before changing inventory.");
    }
    if (command.action === "warehouse") {
      const input = command.data;
      const ids = [...(Array.isArray(input.userIds) ? input.userIds : []), ...(input.assignedUserId ? [input.assignedUserId] : [])];
      for (const userId of ids) {
        const { rows: [user] } = await client.query(`SELECT u.id FROM public.users u WHERE id=$1 AND NOT coalesce(is_locked,false)
          AND (role='admin' OR EXISTS(SELECT 1 FROM public.user_projects WHERE user_id=u.id AND project_id=$2)
          OR EXISTS(SELECT 1 FROM public.user_group_members gm JOIN public.user_group_projects gp ON gp.group_id=gm.group_id WHERE gm.user_id=u.id AND gp.project_id=$2))`, [userId, projectId]);
        if (!user) throw new InventoryError("Warehouse users must be active members of this project.");
      }
      // A maintainer may update an accessible warehouse, but cannot grant access
      // to new users or create an unrestricted warehouse without admin review.
      if (!admin) {
        const previous = before.warehouses.find(w => w.id === input.id);
        if (!previous || JSON.stringify(previous.userIds) !== JSON.stringify(input.userIds || []) ||
          previous.assignedUserId !== (input.assignedUserId || null))
          throw new InventoryError("Administrator required to create warehouses or change warehouse access grants.");
      }
    }
    const result = applyInventoryCommand(before, command, actor, admin);
    if (!result.replay) await saveInventory(client, projectId, before, result.state, command.operationId, command.action);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    if (auditingEnabled) {
      try { await insertAuditEvent(client, { action: `inventory.${command.action}`, entityType: "inventory", entityId: command.operationId, projectId, outcome: "failed",
        metadata: { reason: e instanceof InventoryError ? e.message : "Validation or database failure" } }); } catch { /* original failure remains explicit */ }
    }
    throw e;
  } finally { client.release(); }
}
export async function inventoryWorkOrderChange(client: PoolClient, schema: string, prior: any, next: any, usage?: unknown, importedItems?: unknown) {
  const { rows: [p] } = await client.query("SELECT id,inventory_enabled,wizard_mode,changeout_equipment_type FROM public.projects WHERE database_name=$1", [schema]);
  if (!p?.inventory_enabled) {
    if (importedItems !== undefined && inventoryImportSchema.parse(importedItems).length) throw new InventoryError("Enable inventory before importing inventory items.");
    return;
  }
  const { rows: statuses } = await client.query("SELECT code,label FROM public.work_order_statuses");
  const completedStatus = (status: unknown) => String(status).toLowerCase() === "completed" ||
    statuses.some(s => String(s.code).toLowerCase() === String(status).toLowerCase() && String(s.label).toLowerCase() === "completed");
  const completed = completedStatus(next?.status), previouslyCompleted = completedStatus(prior?.status);
  // Serialize state before checking assignments; callers lock inventory before the work order too.
  let before = await lockInventory(client, p.id), state = before;
  if (previouslyCompleted && completed && before.allocations.find(a => a.workOrderId === prior.id)?.status === "consumed" &&
      ["old_system_id", "new_system_id", "old_module_id", "new_module_id"].some(key => next[key] !== prior[key]))
    throw new InventoryError("Reconcile inventory before changing completed equipment IDs.");
  for (const field of ["old_system_type", "new_system_type", "old_module_type", "new_module_type"])
    if (prior?.[field] !== next?.[field] && next && next[field] != null)
      throw new InventoryError("System and module types are managed by inventory for this project.");
  if (importedItems !== undefined) {
    const input = inventoryImportSchema.parse(importedItems);
    const actorId = auditContext.getStore()?.actorId;
    const user = actorId ? await storage.getUser(actorId) : await storage.getUserByUsername("file_import");
    if (!user || user.isLocked || !await storage.hasPermission(user, inventoryPermissions.assign))
      throw new InventoryError("Inventory assignment permission required for imported item lines.");
    const admin = await storage.isAdminUser(user);
    if (!admin && !await storage.isUserAssignedToProject(user.id, p.id)) throw new InventoryError("Import actor is not assigned to this project.");
    if (previouslyCompleted) throw new InventoryError("Imports cannot change completed inventory assignments.");
    state = applyInventoryCommand(state, { operationId: `${auditContext.getStore()?.operationId || "import"}-${next.id}-${state.revision}`,
      action: "assign", data: { workOrderId: next.id, lines: input } }, user.id, admin).state;
  }
  if (previouslyCompleted && (!next || !completed) && before.allocations.find(a => a.workOrderId === prior.id)?.status === "consumed")
    throw new InventoryError("Inventory-completed work cannot be reset/deleted/reopened until an authorized stock correction is reconciled.");
  if (usage) {
    const command = z.object({ operationId: z.string().uuid(), revision: z.number().int(), mode: z.enum(["changeout", "reading_only"]),
      used: z.array(allocationSchema), dispositions: z.array(dispositionSchema) }).strict().parse(usage);
    const actor = auditContext.getStore()?.actorId;
    if (!actor) throw new InventoryError("Authenticated inventory identity required.");
    const u = await storage.getUser(actor);
    if (!u || u.isLocked || !await storage.hasPermission(u, inventoryPermissions.assign)) throw new InventoryError("Inventory usage permission required.");
    const admin = await storage.isAdminUser(u);
    if (!admin && (next.assigned_user_id && next.assigned_user_id !== actor || !await storage.isUserAssignedToProject(actor, p.id)))
      throw new InventoryError("Inventory work order is not assigned to this user.");
    const existing = state.allocations.find(a => a.workOrderId === next.id);
    if (previouslyCompleted && existing) {
      if (existing.revision !== command.revision || existing.mode !== command.mode ||
         canonicalInventoryJson(existing.used) !== canonicalInventoryJson(command.used) || canonicalInventoryJson(existing.dispositions) !== canonicalInventoryJson(command.dispositions))
        throw new InventoryError("Completed inventory use cannot be changed by another upload; reconcile it first.");
    } else state = applyInventoryCommand(state, { operationId: command.operationId, action: "prepareUse",
      data: { workOrderId: next.id, revision: command.revision, mode: command.mode, used: command.used, dispositions: command.dispositions } }, actor, admin).state;
  }
  if (completed && !previouslyCompleted) {
    const actorId = auditContext.getStore()?.actorId;
    const completionUser = actorId ? await storage.getUser(actorId) : await storage.getUserByUsername("file_import");
    if (!completionUser || completionUser.isLocked || !await storage.hasPermission(completionUser, inventoryPermissions.assign))
      throw new InventoryError("Inventory usage permission required to complete inventory work.");
    const completionAdmin = await storage.isAdminUser(completionUser);
    if (!completionAdmin && (next.assigned_user_id && next.assigned_user_id !== completionUser.id || !await storage.isUserAssignedToProject(completionUser.id, p.id)))
      throw new InventoryError("Inventory work order is not assigned to this user.");
    for (const l of state.allocations.find(a => a.workOrderId === next.id)?.used || []) warehouseAccess(state, l.warehouseId, completionUser.id, completionAdmin);
    state = completeInventoryWorkOrder(state, next.id, p.wizard_mode === "reading_only");
    const allocation = state.allocations.find(a => a.workOrderId === next.id);
    if (allocation?.mode === "changeout") {
      for (const disposition of allocation.dispositions) {
        if (!next[`old_${disposition.equipment}_id`] || next[`old_${disposition.equipment}_id`] !== disposition.serial ||
            next[`old_${disposition.equipment}_id`] === next[`new_${disposition.equipment}_id`])
          throw new InventoryError("Removed-equipment dispositions must match equipment actually removed on this work order.");
      }
      for (const equipment of ["system", "module"]) {
        if (p.changeout_equipment_type === "system" && equipment === "module" ||
            p.changeout_equipment_type === "module" && equipment === "system") continue;
        const old = next[`old_${equipment}_id`], fresh = next[`new_${equipment}_id`];
        if (old && fresh && old !== fresh && !allocation.dispositions.some(d => d.equipment === equipment && d.serial === old))
          throw new InventoryError(`Record the removed ${equipment} disposition.`);
        const expandedUse = (input: any[], ancestors: string[] = []): any[] => input.flatMap(l => {
          if (ancestors.includes(l.itemId)) return [];
          const kit = state.items.find(i => i.id === l.itemId);
          const contents = kit?.components.length ? l.serials.flatMap((serial: string) =>
            [...state.receipts].reverse().find(r => r.action === "assemble" &&
              r.lines.some(b => b.itemId === l.itemId && b.serials.includes(serial)))?.components || []) : [];
          return [l, ...expandedUse(contents, [...ancestors, l.itemId])];
        });
        const serialized = expandedUse(allocation.used).filter(l => state.items.find(i => i.id === l.itemId)?.equipment === equipment).flatMap(l => l.serials);
        if (fresh && !serialized.includes(fresh)) throw new InventoryError(`New ${equipment} ID must match a used serialized inventory item.`);
        if (serialized.length > 1) throw new InventoryError(`Use one serialized ${equipment} per changeout.`);
      }
      if (allocation.used.some(l => {
        const equipment = state.items.find(i => i.id === l.itemId)?.equipment;
        return equipment && equipment !== "none" && p.changeout_equipment_type !== "both" && p.changeout_equipment_type !== "user_choice" && equipment !== p.changeout_equipment_type;
      })) throw new InventoryError("Used equipment must match this project's changeout equipment scope.");
    }
  } else if (!next || ["cancelled", "closed"].includes(String(next.status).toLowerCase())) {
    state = structuredClone(state);
    const a = state.allocations.find(a => a.workOrderId === (next?.id || prior?.id));
    if (a?.status === "reserved") { a.status = "released"; a.lines = []; a.used = []; a.mode = null; state.revision++; }
  }
  if (state !== before) await saveInventory(client, p.id, before, state, `${auditContext.getStore()?.operationId || "completion"}-${next?.id || prior?.id}-${state.revision}`, completed ? "workOrderCompleted" : "workOrderChanged");
}
export async function lockInventoryForSchema(client: PoolClient, schema: string) {
  const { rows: [p] } = await client.query("SELECT id FROM public.projects WHERE database_name=$1 AND inventory_enabled", [schema]);
  if (p) await lockInventory(client, p.id);
}
