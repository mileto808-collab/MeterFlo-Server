import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { User } from "../shared/schema";
import type { InventoryState } from "../shared/inventory";
import { deleteUnusedReplacementSchema, replacementRecoverySchema, includesEquipment } from "../shared/defective-replacement";
import { pool } from "./db";
import { storage } from "./storage";
import { canStart, ChangeoutError } from "./changeoutService";
import { inventoryState, lockInventory } from "./inventoryService";
import { replacementContext, replacementLabel } from "./replacementService";
import { insertAuditEvent } from "./auditService";
import { locationTypeFor, warehouseAccessible } from "../shared/inventory-location-types";
import { fieldStockSettingsSchema } from "../shared/inventory-field-stock";

export function recoveryOwner(row: any, userId: string, admin: boolean) {
  return admin || row.replacement_cancelled_by === userId || row.replacement_cancelled_assignee === userId;
}

/** The absence of a current balance does not establish the absence of posting. */
export function unusedReplacementBlock(row: any, state: InventoryState | null, accepted: boolean) {
  if (!row.replacement_root_id || !row.replacement_cancelled_at || row.replacement_active)
    return "Cancel the unused replacement before restoring or deleting it.";
  if (accepted || ["completed", "closed"].includes(String(row.status).toLowerCase()))
    return "This visit has accepted completion evidence and cannot be restored or deleted.";
  if (!state) return null;
  const allocation = state.allocations.find(a => a.workOrderId === row.id);
  if (allocation && (allocation.lines.length || allocation.used.length || allocation.dispositions.length || allocation.status === "consumed") ||
      state.returns.some(r => r.workOrderId === row.id))
    return "This visit has inventory reservations, consumption or returns. Resolve its inventory without deleting its evidence.";
  const batches = (state.fulfillmentBatches ?? []).filter(b => b.workOrders.some(w => w.workOrderId === row.id));
  if (batches.some(b => b.status !== "cancelled"))
    return "Resolve this visit's fulfillment batch before recovery.";
  const batchIds = new Set(batches.map(b => b.id));
  if (state.receipts.some(r => r.lines.some(line => line.quantity > 0) &&
      (r.workOrderIds?.includes(row.id) || batchIds.has(r.reference) ||
       r.fulfillmentDeletion?.batch.workOrders.some(w => w.workOrderId === row.id) ||
       ["assign", "prepareUse", "reconcileWorkOrder"].includes(r.action) && r.reference === String(row.id))))
    return "This visit has inventory posting history. Keep that evidence and use inventory corrections instead.";
  return null;
}

async function lockedRecovery(db: PoolClient, schema: string, project: any, id: number) {
  await lockInventory(db, project.id);
  const { rows: [row] } = await db.query(`SELECT * FROM "${schema}".work_orders WHERE id=$1 FOR UPDATE`, [id]);
  if (!row?.replacement_root_id) throw new ChangeoutError("Replacement visit not found.", 404, "REPLACEMENT_NOT_FOUND");
  // Existing completion first locks its child, then validates under the root
  // lock. Follow that order rather than creating a root/child deadlock.
  await db.query(`SELECT id FROM "${schema}".work_orders WHERE id=$1 FOR UPDATE`, [row.replacement_root_id]);
  return row;
}

async function assertUnused(db: PoolClient, row: any, project: any) {
  const accepted = !!(await db.query("SELECT 1 FROM public.changeout_completions WHERE project_id=$1 AND work_order_id=$2 LIMIT 1",
    [project.id, row.id])).rowCount;
  // Retained inventory must still be checked when the project is now disabled.
  const state = await inventoryState(project.id, db);
  const blocked = unusedReplacementBlock(row, state, accepted);
  if (blocked) throw new ChangeoutError(blocked, 409, "REPLACEMENT_RECOVERY_BLOCKED");
  return state;
}

export async function restoreReplacement(schema: string, project: any, user: User, id: number, raw: unknown) {
  const input = replacementRecoverySchema.parse(raw), admin = await storage.isAdminUser(user);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const row = await lockedRecovery(db, schema, project, id);
    if (!recoveryOwner(row, user.id, admin)) throw new ChangeoutError("This visit is outside your recovery authority.", 403, "REPLACEMENT_FORBIDDEN");
    if (row.replacement_deleted_at) throw new ChangeoutError("This unused visit was deleted. Start a new request.", 410, "REPLACEMENT_DELETED");
    if (row.replacement_active && !row.replacement_cancelled_at) {
      await db.query("COMMIT"); return true;
    }
    const state = await assertUnused(db, row, project);
    const context = await replacementContext(db, schema, project, user, row.replacement_root_id);
    if (!context.canCreate || context.predecessorFingerprint !== row.replacement_predecessor_fingerprint ||
        (["system", "module"] as const).some(kind => includesEquipment(row.replacement_equipment, kind) && !context.availableEquipment.includes(kind)))
      throw new ChangeoutError("The installed equipment, active visit or project eligibility changed. Keep this visit cancelled and start from the current installation.",
        409, "REPLACEMENT_STALE_PREDECESSOR");
    const assigneeId = row.replacement_cancelled_assignee || row.replacement_actor_id;
    const assignee = await storage.getUser(assigneeId);
    const assigneeAdmin = assignee ? await storage.isAdminUser(assignee) : false;
    if (!assignee || !await canStart(assignee) ||
        !assigneeAdmin && !await storage.isUserAssignedToProject(assignee.id, project.id) ||
        project.inventory_enabled && (!await storage.hasPermission(assignee, "inventory.view") || !await storage.hasPermission(assignee, "inventory.assign")))
      throw new ChangeoutError("The previous technician no longer has the required project access. An administrator must resolve access first.", 409, "REPLACEMENT_ASSIGNEE");
    if (row.replacement_vehicle_id) {
      const vehicle = state.warehouses.find(w => w.id === row.replacement_vehicle_id && w.active);
      if (!project.inventory_enabled || !vehicle || locationTypeFor(state, vehicle)?.kind !== "vehicle" ||
          !warehouseAccessible(state, vehicle, assignee.id, assigneeAdmin) ||
          fieldStockSettingsSchema.parse(state.fieldSettings ?? {}).sourceMode !== "assigned_vehicle" &&
          !assigneeAdmin && !await storage.hasPermission(assignee, "inventory.maintain") && !await storage.hasPermission(assignee, "inventory.configure"))
        throw new ChangeoutError("The original vehicle or stock policy is no longer available to the technician. Start a new request with the correct source.",
          409, "REPLACEMENT_VEHICLE");
    }
    const version = Number(row.assignment_version ?? 0) + 1;
    await db.query(`UPDATE "${schema}".work_orders SET replacement_active=true,replacement_cancelled_at=NULL,
      assigned_user_id=$2,assigned_group_id=NULL,assignment_version=$3,status=$4,updated_at=now(),updated_by=$5 WHERE id=$1`,
    [id, assigneeId, version, project.inventory_enabled && !row.replacement_vehicle_id ? "Scheduled" : "Open", user.username || user.id]);
    // Retain the old attempt read-only and copy only captures into a new fenced
    // submission. An in-flight pre-cancellation completion can never post it.
    const { rows: [draft] } = await db.query(`SELECT * FROM public.changeout_drafts WHERE project_id=$1 AND work_order_id=$2
      AND user_id=$3 ORDER BY updated_at DESC LIMIT 1`, [project.id, id, assigneeId]);
    if (draft) await db.query(`INSERT INTO public.changeout_drafts
      (project_id,work_order_id,user_id,submission_id,assignment_version,revision,step,capture)
      VALUES($1,$2,$3,$4,$5,1,$6,$7::jsonb)`,
    [project.id, id, assigneeId, randomUUID(), version, draft.step, JSON.stringify({ ...draft.capture, basisAccepted: false })]);
    await insertAuditEvent(db, { projectId: project.id, action: "workOrder.replacementRestored", entityType: "workOrder", entityId: String(id),
      metadata: { rootWorkOrderId: row.replacement_root_id, label: replacementLabel(row), reason: input.reason,
        cancelledAt: row.replacement_cancelled_at, restoredAssignee: assigneeId } });
    await db.query("INSERT INTO public.changeout_events(project_id,work_order_id,type,actor_id) VALUES($1,$2,'workorder_updated',$3)", [project.id, id, user.id]);
    await db.query("COMMIT");
    return false;
  } catch (error: any) {
    await db.query("ROLLBACK");
    if (error.code === "23505") throw new ChangeoutError("This equipment identity is now used by another work order. Review that order before restoring this visit.",
      409, "REPLACEMENT_IDENTITY_CONFLICT");
    throw error;
  }
  finally { db.release(); }
}

export async function deleteUnusedReplacement(schema: string, project: any, user: User, id: number, raw: unknown) {
  const input = deleteUnusedReplacementSchema.parse(raw), admin = await storage.isAdminUser(user);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const row = await lockedRecovery(db, schema, project, id);
    if (row.replacement_deleted_at) {
      if (!admin && row.replacement_deleted_by !== user.id) throw new ChangeoutError("This deleted visit belongs to another user.", 403, "REPLACEMENT_FORBIDDEN");
      await db.query("COMMIT"); return true;
    }
    if (!recoveryOwner(row, user.id, admin)) throw new ChangeoutError("This visit is outside your recovery authority.", 403, "REPLACEMENT_FORBIDDEN");
    await assertUnused(db, row, project);
    if ((await db.query(`SELECT 1 FROM "${schema}".work_orders WHERE replacement_parent_id=$1 LIMIT 1`, [id])).rowCount)
      throw new ChangeoutError("A linked successor depends on this visit. Keep its history.", 409, "REPLACEMENT_HISTORY");
    // A tombstone retains the operation identity and audit/backup references;
    // it is not an active order or an item in operational replacement history.
    await db.query(`UPDATE "${schema}".work_orders SET replacement_deleted_at=now(),replacement_deleted_by=$2,
      assignment_version=coalesce(assignment_version,0)+1,updated_at=now(),updated_by=$3 WHERE id=$1`, [id, user.id, user.username || user.id]);
    await db.query("DELETE FROM public.changeout_drafts WHERE project_id=$1 AND work_order_id=$2", [project.id, id]);
    await insertAuditEvent(db, { projectId: project.id, action: "workOrder.unusedReplacementDeleted", entityType: "workOrder", entityId: String(id),
      metadata: { rootWorkOrderId: row.replacement_root_id, label: replacementLabel(row), reason: input.reason, noPhysicalReplacement: true } });
    await db.query("INSERT INTO public.changeout_events(project_id,work_order_id,type,actor_id) VALUES($1,$2,'workorder_updated',$3)", [project.id, id, user.id]);
    await db.query("COMMIT"); return false;
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}
