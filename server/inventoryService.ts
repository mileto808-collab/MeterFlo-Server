import type { PoolClient } from "pg";
import { pool } from "./db";
import { auditContext, auditingEnabled } from "./auditContext";
import { insertAuditEvent } from "./auditService";
import { inventoryAuditEntity } from "./auditReadModel";
import { applyInventoryCommand, canonicalInventoryJson, completeInventoryWorkOrder, InventoryError, warehouseAccess } from "../shared/inventory-engine";
import { emptyInventory, allocationSchema, dispositionSchema, inventoryImportSchema, inventoryPermissions, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { storage } from "./storage";
import { z } from "zod";
import type { SavedShipmentDraft } from "../shared/inventory-shipment-draft-model";
import { readInventoryCategories, storedCategoryState, writeInventoryCategories, writeInventoryCategoryItem } from "./inventoryCategories";
import { kitSerialContents } from "../shared/inventory-kits";
import { readRelationalInventory, writeRelationalInventory } from "./inventoryRelational";
import { setWorkRequirements, workRequirements } from "./inventoryRequirements";
import { actualEquipmentLines } from "../shared/inventory-requirements";
import { workPlanInputSchema } from "../shared/inventory-planning";
import { fieldStockSourceAllowed, fieldFulfillmentAllowed } from "../shared/inventory-field-stock";
import { resolveWarehouseInput } from "../shared/inventory-location-types";
import { validateRemovalWorkflow, sameRemovalCapture, hasInventoryReplacement } from "../shared/inventory-removal-policy";
import { guardPendingInstallationUse } from "./changeoutService";

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
  if (client !== pool) {
    return readRelationalInventory(client, projectId);
  }
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    const state = await inventoryState(projectId, connection);
    await connection.query("COMMIT");
    return state;
  } catch (error) { await connection.query("ROLLBACK"); throw error; }
  finally { connection.release(); }
}
export async function lockInventory(client: PoolClient, projectId: number) {
  await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2) ON CONFLICT DO NOTHING", [projectId, JSON.stringify(emptyInventory())]);
  return readRelationalInventory(client, projectId);
}
export async function saveInventory(client: PoolClient, projectId: number, before: InventoryState, after: InventoryState, operationId: string, action: string) {
  // Display labels never participate in item persistence or item-change audits.
  before = storedCategoryState(before);
  after = storedCategoryState(after);
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
  const entityChanges: Array<{ field: string; before: unknown; after: unknown }> = (["warehouses", "vendors", "items", "orders", "allocations", "counts", "returns", "shipmentHolds", "shipmentDrafts", "kitAssemblies", "kitHolds", "typeLinks", "workRequirements", "workPlans", "stockDiscrepancies"] as const).flatMap(kind => {
    const previous = new Map((before[kind] ?? []).map(value => [((value as any).id ?? (value as any).workOrderId), value]));
    const updates = (after[kind] ?? []).flatMap(value => {
      const id = (value as any).id ?? (value as any).workOrderId;
      const prior = previous.get(id);
      return JSON.stringify(value) === JSON.stringify(prior) ? [] : [{ field: `${kind}/${id}`,
        before: kind === "shipmentDrafts" ? shipmentDraftAudit(prior as SavedShipmentDraft | undefined) : prior || null,
        after: kind === "shipmentDrafts" ? shipmentDraftAudit(value as SavedShipmentDraft) : value }];
    });
    if (["shipmentDrafts", "items", "typeLinks", "workRequirements"].includes(kind)) for (const [id, prior] of previous) {
      if (!(after[kind] ?? []).some(d => ((d as any).id ?? (d as any).workOrderId) === id))
        updates.push({ field: `${kind}/${id}`, before: kind === "shipmentDrafts" ? shipmentDraftAudit(prior as SavedShipmentDraft) : prior, after: null as any });
    }
    return updates;
  });
  if (JSON.stringify(before.categoryCatalog ?? []) !== JSON.stringify(after.categoryCatalog ?? []))
    entityChanges.push({ field: "categoryCatalog", before: before.categoryCatalog ?? [], after: after.categoryCatalog ?? [] });
  if (JSON.stringify(before.locationTypes ?? []) !== JSON.stringify(after.locationTypes ?? []))
    entityChanges.push({ field: "locationTypes", before: before.locationTypes ?? [], after: after.locationTypes ?? [] });
  for (const field of ["removalRules", "removalPolicies", "fieldRemovalChoices", "fieldSettings"] as const)
    if (JSON.stringify(before[field] ?? []) !== JSON.stringify(after[field] ?? []))
      entityChanges.push({ field, before: before[field] ?? [], after: after[field] ?? [] });
  await writeRelationalInventory(client, projectId, after, before);
  await client.query("INSERT INTO public.inventory_movements(project_id,operation_id,action,actor_id,changes) VALUES($1,$2,$3,$4,$5)",
    [projectId, operationId, action, actor, JSON.stringify({ stock: changes, entities: entityChanges })]);
  if (auditingEnabled) {
    const { rows: [project] } = await client.query("SELECT name FROM public.projects WHERE id=$1", [projectId]);
    await insertAuditEvent(client, { action: `inventory.${action}`, entityType: "inventory", entityId: operationId,
    entityLabel: inventoryAuditEntity(after, entityChanges, operationId), projectLabel: project?.name,
    projectId, changes: changes.map(c => ({ field: `${c.warehouseId}/${c.itemId}`, before: { quantity: c.before, reserved: c.reservedBefore, serials: c.serialsBefore },
      after: { quantity: c.after, reserved: c.reservedAfter, serials: c.serialsAfter } })).concat(entityChanges as any),
    metadata: { revision: after.revision, reference: after.receipts.find(r => r.id === operationId)?.reference || null } });
  }
}
export async function postInventory(projectId: number, command: InventoryCommand, actor: string, admin: boolean) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [p] } = await client.query("SELECT inventory_enabled,is_active,wizard_mode,changeout_equipment_type FROM public.projects WHERE id=$1 FOR SHARE", [projectId]);
    if (!p?.inventory_enabled) throw new InventoryError("Inventory is disabled for this project.");
    if (p.is_active === false) throw new InventoryError("Reactivate this project before posting inventory.");
    const before = await lockInventory(client, projectId);
    if (command.action === "fieldSettings") {
      const user = await storage.getUser(actor);
      if (!user || user.isLocked || !await storage.hasPermission(user, inventoryPermissions.configure) ||
          !admin && !await storage.isUserAssignedToProject(actor, projectId))
        throw Object.assign(new InventoryError("Configure project inventory permission required."), { status: 403 });
    }
    const removalPermission = ["removalRule", "removalRuleDelete", "removalPolicy", "removalFieldChoices"].includes(command.action)
      ? inventoryPermissions.manageRemovalRules : ["returnDecide", "returnRelease", "returnCustomerHandoff", "returnCorrectDecision"].includes(command.action) ? inventoryPermissions.resolveReturns : null;
    if (removalPermission) {
      const user = await storage.getUser(actor);
      if (!user || user.isLocked || !await storage.hasPermission(user, removalPermission) ||
          !admin && !await storage.isUserAssignedToProject(actor, projectId))
        throw Object.assign(new InventoryError("Equipment removal action permission required."), { status: 403 });
    }
    const isTypeCommand = ["locationType", "locationTypeDelete"].includes(command.action);
    let canManageLocations = admin;
    if (isTypeCommand || command.action === "warehouse") {
      const user = await storage.getUser(actor);
      if (!user || user.isLocked || !admin && !await storage.isUserAssignedToProject(actor, projectId))
        throw Object.assign(new InventoryError("Active project membership required."), { status: 403 });
      canManageLocations = await storage.hasPermission(user, inventoryPermissions.manageLocationTypes);
      if (isTypeCommand && !canManageLocations)
        throw Object.assign(new InventoryError("Manage inventory location types and access permission required."), { status: 403 });
    }
    if (["plan", "stageWorkOrder", "assign", "prepareUse"].includes(command.action)) {
      if (["plan", "stageWorkOrder", "assign"].includes(command.action) && p.wizard_mode === "reading_only")
        throw new InventoryError("Reading-only projects cannot reserve replacement inventory.");
      const user = await storage.getUser(actor);
      if (command.action === "stageWorkOrder" && (!user ||
        !await storage.hasPermission(user, inventoryPermissions.assign) ||
        !await storage.hasPermission(user, inventoryPermissions.receive)))
        throw Object.assign(new InventoryError("Staging requires transfer, receive and assign-inventory permissions."), { status: 403 });
      if (command.action === "prepareUse") {
        const parsed = z.object({ mode: z.string(), used: z.array(allocationSchema), dispositions: z.array(dispositionSchema) }).parse(command.data);
        const user = await storage.getUser(actor);
        const canOverride = admin || !!user && (await storage.hasPermission(user, inventoryPermissions.maintain) ||
          await storage.hasPermission(user, inventoryPermissions.configure));
        const reserved = before.allocations.find(a => a.workOrderId === command.data.workOrderId)?.lines ?? [];
        if (parsed.used.some(line => !fieldStockSourceAllowed(before, actor, admin, canOverride, line, reserved)))
          throw Object.assign(new InventoryError("Use your assigned vehicle or the configured project warehouse. Changing the stock source requires inventory maintenance or configuration permission."), { status: 403 });
        if (!fieldFulfillmentAllowed(before, Number(command.data.workOrderId), parsed.used, reserved, canOverride))
          throw Object.assign(new InventoryError("Use the project's configured kit handling. A fulfillment exception requires inventory maintenance or configuration permission."), { status: 403 });
        validateRemovalWorkflow(parsed.mode, parsed.used, parsed.dispositions, before,
          { wizardMode: p.wizard_mode ?? "changeout", equipment: p.changeout_equipment_type ?? "both" });
      }
      const { rows: [project] } = await client.query("SELECT database_name FROM public.projects WHERE id=$1", [projectId]);
      if (!project?.database_name || !/^[a-z0-9_]+$/.test(project.database_name)) throw new InventoryError("Project work-order storage unavailable.");
      const id = z.number().int().positive().parse(command.data.workOrderId);
      const { rows: [wo] } = await client.query(`SELECT * FROM "${project.database_name}".work_orders WHERE id=$1 FOR UPDATE`, [id]);
      if (!wo) throw new InventoryError("Work order not found in this project.");
      if (!admin && wo.assigned_user_id && wo.assigned_user_id !== actor &&
        (!user || !await storage.hasPermission(user, inventoryPermissions.maintain) && !await storage.hasPermission(user, inventoryPermissions.configure)))
        throw new InventoryError("Work order assigned to another user. Inventory maintenance or configuration authority is required to prepare another installer's stock.");
      const { rows: labels } = await client.query("SELECT code,label FROM public.work_order_statuses WHERE lower(code)=lower($1) OR lower(label)=lower($1)", [wo.status]);
      if (["completed", "closed", "cancelled"].includes(String(wo.status).toLowerCase()) ||
          labels.some(l => [l.code, l.label].some(value => ["completed", "closed", "cancelled"].includes(String(value).toLowerCase()))))
        throw new InventoryError("Only unfinished, non-closed work orders can change inventory selections.");
      if (command.action === "plan") {
        const automatic = (await workRequirements(client, projectId, before, wo)).automaticLines ?? [];
        const { lines } = workPlanInputSchema.parse(command.data);
        if (lines.some(line => line.kind === "override" && !automatic.some(item => item.itemId === line.itemId)))
          throw new InventoryError("Overrides must refer to an automatically planned item. Use an addition for other items.");
      }
    }
    if (command.action === "typeLink") {
      const { equipment, typeId } = z.object({ equipment: z.enum(["system", "module"]), typeId: z.number().int() }).parse(command.data);
      const { rows } = await client.query(`SELECT 1 FROM public.${equipment}_type_projects WHERE project_id=$1 AND ${equipment}_type_id=$2`, [projectId, typeId]);
      if (!rows.length) throw new InventoryError("Choose an equipment type assigned to this project.");
    }
    if (command.action === "warehouse" && !before.operations[command.operationId]) {
      const input = resolveWarehouseInput(before, command.data);
      const previousGrants = before.warehouses.find(warehouse => warehouse.id === input.id);
      const retainedIds = new Set([...(previousGrants?.userIds ?? []), ...(previousGrants?.assignedUserId ? [previousGrants.assignedUserId] : [])]);
      // Retain historical hidden grants on shared locations, even if a former
      // member has since been disabled. Only newly granted access needs validation.
      const ids = [...(Array.isArray(input.userIds) ? input.userIds : []), ...(input.assignedUserId ? [input.assignedUserId] : [])]
        .filter(id => !retainedIds.has(id));
      for (const userId of ids) {
        const { rows: [user] } = await client.query(`SELECT u.id FROM public.users u WHERE id=$1 AND NOT coalesce(is_locked,false)
          AND (role='admin' OR EXISTS(SELECT 1 FROM public.user_projects WHERE user_id=u.id AND project_id=$2)
          OR EXISTS(SELECT 1 FROM public.user_group_members gm JOIN public.user_group_projects gp ON gp.group_id=gm.group_id WHERE gm.user_id=u.id AND gp.project_id=$2))`, [userId, projectId]);
        if (!user) throw new InventoryError("Warehouse users must be active members of this project.");
      }
      // A maintainer may update an accessible warehouse, but cannot grant access
      // to new users or create an unrestricted warehouse without admin review.
      if (!canManageLocations) {
        const previous = before.warehouses.find(w => w.id === input.id);
        if (!previous || JSON.stringify(previous.userIds) !== JSON.stringify(input.userIds || []) ||
          previous.assignedUserId !== (input.assignedUserId || null) || previous.locationTypeId !== input.locationTypeId)
          throw Object.assign(new InventoryError("Manage inventory location types and access permission required to create locations or change their type or user assignments."), { status: 403 });
      }
    }
    const result = applyInventoryCommand(before, command, actor, admin, undefined, { manageLocations: canManageLocations });
    if (!result.replay && ["assign", "stageWorkOrder"].includes(command.action)) {
      const { rows: [project] } = await client.query("SELECT database_name FROM public.projects WHERE id=$1", [projectId]);
      const { rows: [work] } = await client.query(`SELECT assignment_version FROM "${project.database_name}".work_orders WHERE id=$1`, [command.data.workOrderId]);
      const allocation = result.state.allocations.find(allocation => allocation.workOrderId === command.data.workOrderId);
      if (allocation) allocation.assignmentVersion = work.assignment_version;
    }
    if (!result.replay && command.action === "plan") {
      const { rows: [project] } = await client.query("SELECT database_name FROM public.projects WHERE id=$1", [projectId]);
      const { rows: [work] } = await client.query(`SELECT * FROM "${project.database_name}".work_orders WHERE id=$1`, [command.data.workOrderId]);
      setWorkRequirements(result.state, await workRequirements(client, projectId, result.state, work));
    }
    if (!result.replay && command.action === "typeLink") {
      const { rows: [project] } = await client.query("SELECT database_name FROM public.projects WHERE id=$1", [projectId]);
      if (project?.database_name && /^[a-z0-9_]+$/.test(project.database_name)) {
        const { rows: work } = await client.query(`SELECT * FROM "${project.database_name}".work_orders
          WHERE lower(status) NOT IN ('completed','closed','cancelled') AND NOT EXISTS (
            SELECT 1 FROM public.work_order_statuses s WHERE lower(s.code)=lower(status) AND lower(s.label) IN ('completed','closed','cancelled'))`);
        for (const row of work) setWorkRequirements(result.state, await workRequirements(client, projectId, result.state, row));
      }
    }
    if (!result.replay) {
      await guardPendingInstallationUse(client, projectId, before, result.state);
      await saveInventory(client, projectId, before, result.state, command.operationId, command.action);
    }
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    if (auditingEnabled) {
      try { await insertAuditEvent(client, { action: `inventory.${command.action}`, entityType: "inventory", entityId: command.operationId, projectId, outcome: "failed",
        metadata: { reason: e instanceof InventoryError ? e.message : "Validation or database failure" } }); } catch { /* original failure remains explicit */ }
    }
    if (["itemDelete", "categoryDelete", "locationTypeDelete"].includes(command.action) && (e as { code?: string })?.code === "23503")
      throw new InventoryError("This record is still referenced by inventory data and cannot be deleted. Refresh the list to check its current usage.");
    throw e;
  } finally { client.release(); }
}
export async function inventoryWorkOrderChange(client: PoolClient, schema: string, prior: any, next: any, usage?: unknown, importedItems?: unknown, ordinaryImport = false, deferred = false) {
  const { rows: [p] } = await client.query("SELECT id,inventory_enabled,wizard_mode,changeout_equipment_type,reading_equipment_type FROM public.projects WHERE database_name=$1", [schema]);
  if (!p?.inventory_enabled) {
    if (!ordinaryImport && importedItems !== undefined && inventoryImportSchema.parse(importedItems).length) throw new InventoryError("Enable inventory before importing inventory items.");
    if (p && !next && (await client.query("SELECT 1 FROM public.inventory_state WHERE project_id=$1", [p.id])).rowCount) {
      const state = await lockInventory(client, p.id);
      if (state.workPlans?.some(plan => plan.workOrderId === prior?.id))
        throw new InventoryError("Enable inventory before deleting a work order with saved inventory planning. Clear its plan and reconcile any reservations first.");
    }
    return;
  }
  const { rows: statuses } = await client.query("SELECT code,label FROM public.work_order_statuses");
  const completedStatus = (status: unknown) => String(status).toLowerCase() === "completed" ||
    statuses.some(s => String(s.code).toLowerCase() === String(status).toLowerCase() && String(s.label).toLowerCase() === "completed");
  const completed = completedStatus(next?.status), previouslyCompleted = completedStatus(prior?.status);
  if (!deferred && previouslyCompleted) {
    const pending = await client.query(`SELECT 1 FROM public.changeout_completions WHERE project_id=$1 AND work_order_id=$2
      AND status IN ('pending','failed') LIMIT 1`, [p.id, prior.id]);
    if (pending.rowCount) {
      if (String(next?.status).toLowerCase() === "closed") return;
      if (!next || !completed) throw new InventoryError("Resolve pending completion reconciliation before reopening or deleting this work order.");
      if (["old_system_id", "new_system_id", "old_module_id", "new_module_id"].some(key => next[key] !== prior[key]))
        throw new InventoryError("Accepted installation identities cannot change while inventory reconciliation is pending.");
      if (usage || importedItems) throw new InventoryError("Accepted usage is awaiting background reconciliation. Use warehouse review for inventory corrections.");
      return; // Metadata edits must not account for the queued installation synchronously.
    }
  }
  // Serialize state before checking assignments; callers lock inventory before the work order too.
  let before = await lockInventory(client, p.id), state = before;
  if (!next && prior && state.returns.some(r => r.workOrderId === prior.id))
    throw new InventoryError("Work orders with recorded equipment removals cannot be deleted. Keep their custody and decision history.");
  if (previouslyCompleted && completed && before.allocations.find(a => a.workOrderId === prior.id)?.status === "consumed" &&
      ["old_system_id", "new_system_id", "old_module_id", "new_module_id"].some(key => next[key] !== prior[key]))
    throw new InventoryError("Reconcile inventory before changing completed equipment IDs.");
  // File/API imports describe requirements, never physical assignments. Ignore
  // legacy inventoryItems mappings, including any warehouse or serial selections.
  if (importedItems !== undefined && !ordinaryImport) {
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
  if (next && !previouslyCompleted) {
    const requirements = await workRequirements(client, p.id, state, next);
    const saved = state.workRequirements?.find(r => r.workOrderId === next.id);
    if ((saved || requirements.lines.length || requirements.missing.length) &&
        canonicalInventoryJson(saved) !== canonicalInventoryJson({ workOrderId: requirements.workOrderId, lines: requirements.lines,
          missing: requirements.missing, automaticLines: requirements.automaticLines })) {
      if (state === before) state = structuredClone(before);
      setWorkRequirements(state, requirements);
      state.revision++;
    }
  } else if (!next && state.workRequirements?.some(r => r.workOrderId === prior?.id)) {
    if (state === before) state = structuredClone(before);
    state.workRequirements = state.workRequirements?.filter(r => r.workOrderId !== prior.id);
    state.revision++;
  }
  if (!next && state.workPlans?.some(plan => plan.workOrderId === prior?.id)) {
    if (state === before) state = structuredClone(before);
    state.workPlans = state.workPlans?.filter(plan => plan.workOrderId !== prior.id);
    state.revision++;
  }
  if (usage && !ordinaryImport) {
    const command = z.object({ operationId: z.string().uuid(), revision: z.number().int(), mode: z.enum(["changeout", "reading_only"]),
      used: z.array(allocationSchema), dispositions: z.array(dispositionSchema) }).strict().parse(usage);
    validateRemovalWorkflow(command.mode, command.used, command.dispositions, state,
      { wizardMode: p.wizard_mode ?? "changeout", equipment: p.changeout_equipment_type ?? "both" });
    const actor = auditContext.getStore()?.actorId;
    if (!actor) throw new InventoryError("Authenticated inventory identity required.");
    const u = await storage.getUser(actor);
    if (!deferred && (!u || u.isLocked || !await storage.hasPermission(u, inventoryPermissions.assign))) throw new InventoryError("Inventory usage permission required.");
    const admin = deferred || await storage.isAdminUser(u!);
    if (!admin && (next.assigned_user_id && next.assigned_user_id !== actor || !await storage.isUserAssignedToProject(actor, p.id)))
      throw new InventoryError("Inventory work order is not assigned to this user.");
    const existing = state.allocations.find(a => a.workOrderId === next.id);
    if (previouslyCompleted && existing) {
      if (existing.revision !== command.revision + 1 || existing.mode !== command.mode ||
         canonicalInventoryJson(existing.used) !== canonicalInventoryJson(command.used) || !sameRemovalCapture(existing.dispositions, command.dispositions))
        throw new InventoryError("Completed inventory use cannot be changed by another upload; reconcile it first.");
    } else state = applyInventoryCommand(state, { operationId: command.operationId, action: "prepareUse",
      data: { workOrderId: next.id, revision: command.revision, mode: command.mode, used: command.used, dispositions: command.dispositions } }, actor, admin).state;
  }
  // Only trusted import callers opt in. Existing stock assignments, explicit item
  // imports and usage uploads must still go through the full completion checks.
  if (ordinaryImport && completed && !previouslyCompleted) {
    const allocation = state.allocations.find(a => a.workOrderId === next?.id);
    if (allocation?.status === "reserved" && (allocation.lines.length || allocation.used.length))
      throw new InventoryError("Imports cannot complete work with selected inventory. Complete the changeout or release its selections manually.");
  }
  const importedWithoutStock = ordinaryImport;
  if (completed && !previouslyCompleted && !importedWithoutStock) {
    let prepared = state.allocations.find(a => a.workOrderId === next.id);
    const capture = (row: any) => row ? {
      system: { old: row.old_system_id, new: row.new_system_id },
      module: { old: row.old_module_id, new: row.new_module_id },
    } : null;
    const changedEquipment = hasInventoryReplacement(capture(prior), capture(next)!, {
      wizardMode: p.wizard_mode ?? "changeout", equipment: p.changeout_equipment_type ?? "both",
      readingEquipment: p.reading_equipment_type ?? "both",
    });
    const readingVisit = p.wizard_mode === "reading_only" || prepared?.mode === "reading_only" ||
      p.wizard_mode === "user_choice" && !prepared?.mode && !changedEquipment;
    if (readingVisit) {
      if (changedEquipment) throw new InventoryError("Reading-only visits cannot replace equipment or bypass removed-equipment rules.");
      if (prepared?.used.length || prepared?.dispositions.length)
        throw new InventoryError("Clear prepared changeout use before completing a reading-only visit.");
      if (prepared?.mode !== "reading_only") {
        state = applyInventoryCommand(state, {
          operationId: `${auditContext.getStore()?.operationId || "reading"}-${next.id}-${state.revision}`,
          action: "prepareUse", data: { workOrderId: next.id, revision: prepared?.revision ?? 0, mode: "reading_only", used: [], dispositions: [] },
        }, auditContext.getStore()?.actorId ?? "unavailable", true).state;
        prepared = state.allocations.find(a => a.workOrderId === next.id);
      }
    }
    const actorId = auditContext.getStore()?.actorId;
    if (!actorId) throw new InventoryError("Authenticated inventory identity required to complete inventory work.");
    const completionUser = await storage.getUser(actorId) ?? (deferred ? { id: actorId } as any : null);
    if (!deferred && (!completionUser || completionUser.isLocked || !readingVisit && !await storage.hasPermission(completionUser, inventoryPermissions.assign)))
      throw new InventoryError("Inventory usage permission required to complete inventory work.");
    const completionAdmin = deferred || await storage.isAdminUser(completionUser);
    if (!completionAdmin && (next.assigned_user_id && next.assigned_user_id !== completionUser.id || !await storage.isUserAssignedToProject(completionUser.id, p.id)))
      throw new InventoryError("Inventory work order is not assigned to this user.");
    const fieldAllocation = state.allocations.find(a => a.workOrderId === next.id);
    const canOverrideFieldStock = completionAdmin || await storage.hasPermission(completionUser, inventoryPermissions.maintain) ||
      await storage.hasPermission(completionUser, inventoryPermissions.configure);
    if (fieldAllocation && !fieldFulfillmentAllowed(state, next.id, fieldAllocation.used, fieldAllocation.lines, canOverrideFieldStock))
      throw new InventoryError("Project kit handling changed. Review inventory before completing.");
    for (const l of fieldAllocation?.used || []) {
      warehouseAccess(state, l.warehouseId, completionUser.id, completionAdmin);
      if (!fieldStockSourceAllowed(state, completionUser.id, completionAdmin, canOverrideFieldStock, l, fieldAllocation?.lines))
        throw new InventoryError("Field stock settings or vehicle assignments changed. Review the stock source before completing.");
    }
    if (prepared?.mode) validateRemovalWorkflow(prepared.mode, prepared.used, prepared.dispositions, state,
      { wizardMode: p.wizard_mode ?? "changeout", equipment: p.changeout_equipment_type ?? "both" });
    state = completeInventoryWorkOrder(state, next.id, p.wizard_mode === "reading_only", completionUser.id);
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
        const equipmentLines = actualEquipmentLines(state, allocation.used)
          .filter(l => state.items.find(i => i.id === l.itemId)?.equipment === equipment);
        const serialized = equipmentLines.filter(l => state.items.find(i => i.id === l.itemId)?.tracking === "serialized").flatMap(l => l.serials);
        const quantityTracked = equipmentLines.some(l => state.items.find(i => i.id === l.itemId)?.tracking === "regular");
        if (fresh && !quantityTracked && !serialized.includes(fresh)) throw new InventoryError(`New ${equipment} ID must match a used serialized inventory item.`);
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
