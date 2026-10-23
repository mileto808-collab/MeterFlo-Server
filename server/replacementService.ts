import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { storage } from "./storage";
import { ChangeoutError, canonicalStatus } from "./changeoutService";
import { technicianAssignmentScope } from "./workOrderVisibility";
import { inventoryState, lockInventory } from "./inventoryService";
import { locationTypeFor, warehouseAccessible } from "../shared/inventory-location-types";
import { createReplacementSchema, includesEquipment, type CreateReplacement, type ReplacementEligibility } from "../shared/defective-replacement";
import { insertAuditEvent } from "./auditService";
import type { User } from "../shared/schema";
import { allocationSchema, dispositionSchema } from "../shared/inventory";
import { z } from "zod";
import { warehouseAccess } from "../shared/inventory-engine";
import { actualEquipmentLines, requirementsSatisfied } from "../shared/inventory-requirements";
import { fieldStockSourceAllowed, fieldFulfillmentAllowed, fieldStockSettingsSchema } from "../shared/inventory-field-stock";
import { validateRemovalWorkflow } from "../shared/inventory-removal-policy";
import { workRequirements } from "./inventoryRequirements";

type Query = Pick<PoolClient, "query">;
const terminal = async (db: Query, value: unknown) => ["completed", "closed"].includes(await canonicalStatus(db, value));
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const replacementLabel = (row: any) => row.customer_wo_id || `Work order ${row.id}`;

export async function replacementContext(db: Query, schema: string, project: any, user: User, id: number): Promise<ReplacementEligibility> {
  const { rows: [selected] } = await db.query(`SELECT * FROM "${schema}".work_orders WHERE id=$1`, [id]);
  if (!selected) throw new ChangeoutError("Work order not found.", 404, "REPLACEMENT_NOT_FOUND");
  const rootId = selected.replacement_root_id ?? selected.id;
  const { rows } = await db.query(`SELECT w.*,c.status accounting_status FROM "${schema}".work_orders w
    LEFT JOIN LATERAL (SELECT status FROM public.changeout_completions WHERE project_id=$1 AND work_order_id=w.id
      ORDER BY created_at DESC,id DESC LIMIT 1) c ON true
    WHERE w.id=$2 OR w.replacement_root_id=$2 ORDER BY w.id`, [project.id, rootId]);
  const root = rows.find(row => row.id === rootId);
  if (!root) throw new ChangeoutError("Replacement history is incomplete. Authorized review is required.", 409, "REPLACEMENT_HISTORY");
  const admin = await storage.isAdminUser(user);
  const fieldScope = await technicianAssignmentScope(user);
  const inventory = project.inventory_enabled ? await inventoryState(project.id, db) : null;
  const canOverride = admin || await storage.hasPermission(user, "inventory.maintain") || await storage.hasPermission(user, "inventory.configure");
  const vehicleMode = !inventory || canOverride || fieldStockSettingsSchema.parse(inventory.fieldSettings ?? {}).sourceMode === "assigned_vehicle";
  const vehicles = inventory?.warehouses.filter(w => vehicleMode && w.active && locationTypeFor(inventory, w)?.kind === "vehicle" &&
    warehouseAccessible(inventory, w, user.id, admin)) ?? [];
  if (fieldScope && !rows.some(row => row.completed_by === user.id || row.assigned_user_id === user.id)) {
    const { rows: custody } = await db.query(`SELECT 1 FROM public.inventory_fulfillment_work_orders saved
      JOIN public.inventory_fulfillment_batches b ON b.project_id=saved.project_id AND b._key=saved.parent_id
      WHERE saved.project_id=$1 AND saved.work_order_id=ANY($2::int[])
        AND coalesce(saved.vehicle_id,b.vehicle_id)=ANY($3::text[]) AND b.status<>'cancelled' LIMIT 1`,
    [project.id, rows.map(row => row.id), vehicles.map(w => w.id)]);
    if (!custody.length) throw new ChangeoutError("This work order is outside your completed work or authorized vehicle history.", 403, "REPLACEMENT_FORBIDDEN");
  }
  const completed: any[] = [];
  for (const row of rows) if (await terminal(db, row.status)) completed.push(row);
  const latest = (equipment: "system" | "module") => completed.filter(row =>
    (!row.replacement_equipment || includesEquipment(row.replacement_equipment, equipment)) &&
    row[`new_${equipment}_id`]).at(-1);
  const system = latest("system"), module = latest("module");
  const baseline = {
    systemId: system?.new_system_id ?? null, systemType: system?.new_system_type ?? null,
    moduleId: module?.new_module_id ?? null, moduleType: module?.new_module_type ?? null,
  };
  const availableEquipment: ReplacementEligibility["availableEquipment"] = [];
  if (baseline.systemId && project.changeout_equipment_type !== "module") availableEquipment.push("system");
  if (baseline.moduleId && project.changeout_equipment_type !== "system") availableEquipment.push("module");
  const active = rows.find(row => row.replacement_active);
  let reason: string | null = null;
  if (project.is_active === false) reason = "This project is inactive.";
  else if (project.wizard_mode === "reading_only") reason = "Reading-only projects cannot replace equipment.";
  else if (!await terminal(db, selected.status)) reason = "Complete this work order before starting a defective-equipment replacement.";
  else if (!availableEquipment.length) reason = "No completed installed equipment can be identified. Authorized review is required.";
  else if (active) reason = "A replacement visit is already in progress. Resume it instead of creating another.";
  else if (inventory && (!await storage.hasPermission(user, "inventory.view") || !await storage.hasPermission(user, "inventory.assign")))
    reason = "Inventory view and use permissions are required for an inventory-enabled replacement.";
  return {
    contractVersion: 1, timezone: project.timezone || "UTC", canCreate: !reason, reason, rootWorkOrderId: rootId,
    predecessorFingerprint: digest({ rootId, system: system ? [system.id, system.new_system_id, system.new_system_type] : null,
      module: module ? [module.id, module.new_module_id, module.new_module_type] : null }),
    inventoryEnabled: !!project.inventory_enabled, availableEquipment, baseline,
    vehicles: vehicles.map(w => ({ id: w.id, code: w.code, name: w.name })),
    activeVisit: active ? { workOrderId: active.id, label: replacementLabel(active),
      canResume: admin || active.assigned_user_id === user.id } : null,
    history: rows.map(row => ({ workOrderId: row.id, label: replacementLabel(row), status: row.replacement_cancelled_at ? "Cancelled" : row.status,
      equipment: row.replacement_equipment ?? null, reason: row.replacement_reason ?? null,
      oldSystemId: row.old_system_id, newSystemId: row.new_system_id, oldModuleId: row.old_module_id,
      newModuleId: row.new_module_id, completedAt: row.completed_at, accountingStatus: row.accounting_status ?? null })),
  };
}

export async function createReplacement(schema: string, project: any, user: User, id: number, raw: unknown) {
  const input = createReplacementSchema.parse(raw);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Non-blocking try-lock prevents duplicate request waiters from exhausting the pool.
    const { rows: [lock] } = await db.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) acquired",
      [`replacement:${project.id}`]);
    if (!lock.acquired) throw new ChangeoutError("Another replacement request is being saved. Retry the same operation.", 409, "REPLACEMENT_BUSY");
    const { rows: [old] } = await db.query(`SELECT * FROM "${schema}".work_orders WHERE replacement_operation_id=$1`, [input.operationId]);
    if (old) {
      if (old.replacement_actor_id !== user.id || old.replacement_parent_id !== id ||
          old.replacement_equipment !== input.equipment || old.replacement_reason !== input.reason ||
          old.replacement_vehicle_id !== input.vehicleId || old.replacement_predecessor_fingerprint !== input.predecessorFingerprint)
        throw new ChangeoutError("This operation was already used with different replacement inputs.", 409, "REPLACEMENT_PAYLOAD_MISMATCH");
      await db.query("COMMIT");
      return { id: old.id, replay: true };
    }
    const { rows: [selected] } = await db.query(`SELECT coalesce(replacement_root_id,id) root_id FROM "${schema}".work_orders WHERE id=$1`, [id]);
    if (!selected) throw new ChangeoutError("Work order not found.", 404, "REPLACEMENT_NOT_FOUND");
    await db.query(`SELECT id FROM "${schema}".work_orders WHERE id=$1 FOR UPDATE`, [selected.root_id]);
    const context = await replacementContext(db, schema, project, user, id);
    if (!context.canCreate) throw new ChangeoutError(context.reason!, 409, "REPLACEMENT_NOT_ELIGIBLE");
    if (input.predecessorFingerprint !== context.predecessorFingerprint)
      throw new ChangeoutError("The installed equipment changed. Refresh the replacement baseline before starting.", 409, "REPLACEMENT_STALE_PREDECESSOR");
    for (const equipment of ["system", "module"] as const) if (includesEquipment(input.equipment, equipment) && !context.availableEquipment.includes(equipment))
      throw new ChangeoutError(`No eligible installed ${equipment} is available.`, 400, "REPLACEMENT_SCOPE");
    if (input.vehicleId && (!project.inventory_enabled || !context.vehicles.some(v => v.id === input.vehicleId)))
      throw new ChangeoutError("Choose one of your authorized active vehicles.", 403, "REPLACEMENT_VEHICLE");
    const { rows: [root] } = await db.query(`SELECT * FROM "${schema}".work_orders WHERE id=$1`, [context.rootWorkOrderId]);
    const keys = ["customer_id", "customer_name", "address", "city", "state", "zip", "phone", "email", "route", "zone", "service_type"];
    const values: any[] = keys.map(key => root[key]);
    const useSystem = includesEquipment(input.equipment, "system"), useModule = includesEquipment(input.equipment, "module");
    const metadata = {
      // Individually assigned warehouse work must enter the existing scheduled
      // fulfillment path; an assigned Open order is intentionally not eligible
      // for either ordinary crew or scheduled picking.
      status: project.inventory_enabled && input.vehicleId === null ? "Scheduled" : "Open",
      created_by: user.username, assigned_user_id: user.id,
      old_system_id: useSystem ? context.baseline.systemId : null,
      old_system_type: useSystem ? context.baseline.systemType : null,
      new_system_type: useSystem ? context.baseline.systemType : null,
      old_module_id: useModule ? context.baseline.moduleId : null,
      old_module_type: useModule ? context.baseline.moduleType : null,
      new_module_type: useModule ? context.baseline.moduleType : null,
      old_gps: root.new_gps || root.old_gps,
      replacement_root_id: context.rootWorkOrderId, replacement_parent_id: id, replacement_equipment: input.equipment,
      replacement_reason: input.reason, replacement_vehicle_id: input.vehicleId,
      replacement_operation_id: input.operationId, replacement_actor_id: user.id,
      replacement_predecessor_fingerprint: input.predecessorFingerprint, replacement_active: true,
      notes: `Defective-equipment replacement linked to ${replacementLabel(root)}. Reason: ${input.reason}`,
    };
    keys.push(...Object.keys(metadata)); values.push(...Object.values(metadata));
    const { rows: [created] } = await db.query(`INSERT INTO "${schema}".work_orders
      (${keys.join(",")}) VALUES(${values.map((_, i) => `$${i + 1}`).join(",")}) RETURNING id`, values);
    await db.query(`UPDATE "${schema}".work_orders SET customer_wo_id=$2 WHERE id=$1`, [created.id, `RPL-${root.id}-${created.id}`]);
    await insertAuditEvent(db, { action: "workOrder.replacementCreated", entityType: "work_orders",
      entityId: String(created.id), projectId: project.id, metadata: {
        rootWorkOrderId: root.id, parentWorkOrderId: id, equipment: input.equipment, reason: input.reason, operationId: input.operationId,
      } });
    await db.query("INSERT INTO public.changeout_events(project_id,work_order_id,type,actor_id,operation_id) VALUES($1,$2,'workorder_created',$3,$4)",
      [project.id, created.id, user.id, input.operationId]);
    await db.query("COMMIT");
    return { id: created.id, replay: false };
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

/** Called on all write paths, not just the new wizard. */
export async function assertReplacementChange(db: Query, schema: string, before: any, after: any) {
  if (!before) return;
  if (before.replacement_cancelled_at) throw new ChangeoutError("This unused replacement was cancelled. Keep it in history and start a new authorized visit.", 409, "REPLACEMENT_HISTORY");
  if (before.replacement_root_id) {
    if (!after) throw new ChangeoutError("Keep replacement visits for installation history; cancel an unposted visit instead.", 409, "REPLACEMENT_HISTORY");
    for (const equipment of ["system", "module"] as const) {
      if (["id", "type"].some(key => before[`old_${equipment}_${key}`] !== after[`old_${equipment}_${key}`]))
        throw new ChangeoutError("The defective-equipment baseline cannot be edited. Resolve its history before proceeding.", 409, "REPLACEMENT_BASELINE");
      if (!includesEquipment(before.replacement_equipment, equipment) &&
          ["id", "type"].some(key => after[`new_${equipment}_${key}`]))
        throw new ChangeoutError("This replacement visit cannot change equipment outside its selected scope.", 409, "REPLACEMENT_SCOPE");
    }
  }
  const { rowCount } = await db.query(`SELECT 1 FROM "${schema}".work_orders WHERE replacement_root_id=$1 AND id<>$2 LIMIT 1`,
    [before.replacement_root_id ?? before.id, before.id]);
  if (rowCount && (!after || await terminal(db, before.status) && (
      !await terminal(db, after.status) ||
      ["old_system_id", "new_system_id", "old_module_id", "new_module_id", "new_system_type", "new_module_type"]
        .some(key => before[key] !== after[key]))))
    throw new ChangeoutError("This installation has linked replacement history. Record a new replacement instead of resetting or rewriting it.", 409, "REPLACEMENT_HISTORY");
}

export async function cancelReplacement(schema: string, project: any, user: User, id: number) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await lockInventory(db, project.id);
    const { rows: [row] } = await db.query(`SELECT * FROM "${schema}".work_orders WHERE id=$1 FOR UPDATE`, [id]);
    if (!row?.replacement_root_id) throw new ChangeoutError("This is not a replacement visit.", 400, "REPLACEMENT_SCOPE");
    const admin = await storage.isAdminUser(user);
    if (row.replacement_cancelled_at) {
      if (!admin && row.replacement_cancelled_by !== user.id)
        throw new ChangeoutError("This cancelled visit belongs to another technician.", 403, "REPLACEMENT_FORBIDDEN");
      await db.query("COMMIT"); return true;
    }
    if (!admin && row.assigned_user_id !== user.id)
      throw new ChangeoutError("Only the assigned technician or an administrator can cancel this unused visit.", 403, "REPLACEMENT_FORBIDDEN");
    if (!row.replacement_active ||
        (await db.query("SELECT 1 FROM public.changeout_completions WHERE project_id=$1 AND work_order_id=$2 LIMIT 1", [project.id, id])).rowCount)
      throw new ChangeoutError("Accepted replacements cannot be cancelled.", 409, "REPLACEMENT_NOT_ELIGIBLE");
    const state = await inventoryState(project.id, db);
    const allocation = state.allocations.find(a => a.workOrderId === id);
    if (allocation && (allocation.lines.length || allocation.status === "consumed") ||
        state.fulfillmentBatches?.some(b => b.status !== "cancelled" && b.workOrders.some(w => w.workOrderId === id)))
      throw new ChangeoutError("Resolve the fulfillment batch and release unposted reservations before cancelling this visit. Inventory is unchanged.", 409, "REPLACEMENT_NOT_ELIGIBLE");
    await db.query(`UPDATE "${schema}".work_orders SET replacement_active=false,replacement_cancelled_at=now(),replacement_cancelled_by=$3,
      assigned_user_id=NULL,assigned_group_id=NULL,updated_at=now(),updated_by=$2 WHERE id=$1`, [id, user.username || user.id, user.id]);
    await insertAuditEvent(db, { projectId: project.id,
      action: "workOrder.replacementCancelled", entityType: "workOrder", entityId: String(id),
      metadata: { rootWorkOrderId: row.replacement_root_id } });
    await db.query("INSERT INTO public.changeout_events(project_id,work_order_id,type,actor_id) VALUES($1,$2,'workorder_updated',$3)", [project.id, id, user.id]);
    await db.query("COMMIT");
    return false;
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { db.release(); }
}

export async function validateReplacementCompletion(db: Query, schema: string, prior: any, next: any, updates: any, user: User, projectId: number) {
  if (!prior.replacement_root_id) return;
  await db.query(`SELECT id FROM "${schema}".work_orders WHERE id=$1 FOR UPDATE`, [prior.replacement_root_id]);
  if (!prior.replacement_active) throw new ChangeoutError("This replacement visit is no longer active.", 409, "REPLACEMENT_INACTIVE");
  await assertReplacementChange(db, schema, prior, next);
  for (const equipment of ["system", "module"] as const) if (includesEquipment(prior.replacement_equipment, equipment)) {
    if (!next[`new_${equipment}_id`] || next[`new_${equipment}_id`] === prior[`old_${equipment}_id`])
      throw new ChangeoutError(`Capture a different installed ${equipment} ID.`, 400, "REPLACEMENT_REQUIRED");
    const reading = equipment === "system" ? "system_reading" : "module_read";
    if ([`old_${reading}`, `new_${reading}`].some(key => next[key] === null || next[key] === undefined || next[key] === ""))
      throw new ChangeoutError(`Capture the old and new ${equipment} readings.`, 400, "REPLACEMENT_REQUIRED");
  }
  const { rows: [project] } = await db.query("SELECT * FROM public.projects WHERE id=$1", [projectId]);
  if (!project?.inventory_enabled) return;
  if (!await storage.hasPermission(user, "inventory.view") || !await storage.hasPermission(user, "inventory.assign"))
    throw new ChangeoutError("Inventory view and use permissions are required.", 403, "REPLACEMENT_FORBIDDEN");
  const usage = z.object({ mode: z.literal("changeout"), used: z.array(allocationSchema).min(1),
    dispositions: z.array(dispositionSchema) }).passthrough().parse(updates.inventoryUsage);
  const state = await inventoryState(projectId, db), admin = await storage.isAdminUser(user);
  const canOverride = admin || await storage.hasPermission(user, "inventory.maintain") || await storage.hasPermission(user, "inventory.configure");
  const reservations = state.allocations.find(a => a.workOrderId === prior.id)?.lines ?? [];
  const requirements = await workRequirements(db, projectId, state, next);
  if (!requirementsSatisfied(state, requirements, usage.used, !!requirements.manualLines?.some(line => line.kind === "addition")))
    throw new ChangeoutError("Complete the replacement inventory quantities and type-to-item mappings.", 400, "REPLACEMENT_REQUIRED");
  for (const line of usage.used) {
    warehouseAccess(state, line.warehouseId, user.id, admin);
    const item = state.items.find(item => item.id === line.itemId);
    if (!item?.active || line.quantity < 1 || item.tracking === "serialized" &&
        (new Set(line.serials).size !== line.quantity || line.serials.length !== line.quantity))
      throw new ChangeoutError("Every serialized replacement unit needs exactly one unique serial.", 400, "REPLACEMENT_SERIALS");
    if (!fieldStockSourceAllowed(state, user.id, admin, canOverride, line, reservations) ||
        prior.replacement_vehicle_id && line.warehouseId !== prior.replacement_vehicle_id)
      throw new ChangeoutError("Use stock from the authorized replacement source. Resolve dispatch before changing vehicles.", 403, "REPLACEMENT_VEHICLE");
  }
  if (!fieldFulfillmentAllowed(state, prior.id, usage.used, reservations, canOverride))
    throw new ChangeoutError("Use the configured kit handling or resolve the component source with the warehouse.", 400, "REPLACEMENT_KIT");
  for (const line of actualEquipmentLines(state, usage.used)) {
    const item = state.items.find(item => item.id === line.itemId);
    if (!item || item.equipment === "none") continue;
    if (!includesEquipment(prior.replacement_equipment, item.equipment))
      throw new ChangeoutError("Do not consume unchanged equipment for this replacement.", 400, "REPLACEMENT_SCOPE");
    if (line.quantity !== 1 || item.tracking === "serialized" &&
        (line.serials.length !== 1 || line.serials[0] !== next[`new_${item.equipment}_id`]))
      throw new ChangeoutError("Inventory serials must match the installed replacement IDs.", 400, "REPLACEMENT_SERIALS");
  }
  validateRemovalWorkflow("changeout", usage.used, usage.dispositions, state,
    { wizardMode: "changeout", equipment: prior.replacement_equipment });
  for (const disposition of usage.dispositions) {
    if (!includesEquipment(prior.replacement_equipment, disposition.equipment) ||
        disposition.serial !== prior[`old_${disposition.equipment}_id`])
      throw new ChangeoutError("Removed equipment must match the defective installed asset.", 400, "REPLACEMENT_BASELINE");
    if (disposition.warehouseId) warehouseAccess(state, disposition.warehouseId, user.id, admin);
  }
}
