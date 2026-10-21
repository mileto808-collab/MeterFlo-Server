import type { PoolClient } from "pg";
import { storage } from "./storage";
import { visibleAssignedOrders } from "./workOrderVisibility";
import { workRequirements } from "./inventoryRequirements";
import type { InventoryState } from "../shared/inventory";
import { InventoryError, warehouseAccess } from "../shared/inventory-engine";
import { fulfillmentCreateSchema, fulfillmentMoveSchema, fulfillmentCloseSchema, fulfillmentOutstanding,
  type FulfillmentBatch, type FulfillmentCandidate } from "../shared/inventory-fulfillment";
import type { User } from "../shared/schema";
import { isStagingType } from "../shared/inventory-location-types";

export async function fulfillmentOrders(client: Pick<PoolClient, "query">, projectId: number, state: InventoryState,
  user: User, ids?: number[], lock = false): Promise<FulfillmentCandidate[]> {
  const { rows: [project] } = await client.query("SELECT database_name,wizard_mode FROM public.projects WHERE id=$1", [projectId]);
  if (!project?.database_name || !/^[a-z0-9_]+$/.test(project.database_name)) throw new InventoryError("Project storage unavailable.");
  const { rows } = await client.query(`SELECT w.*,u.username AS installer_name FROM "${project.database_name}".work_orders w
    LEFT JOIN public.users u ON u.id=w.assigned_user_id
    ${ids ? "WHERE w.id=ANY($1::int[])" : "WHERE lower(w.status) IN ('open','scheduled') OR EXISTS (SELECT 1 FROM public.work_order_statuses s WHERE (lower(s.code)=lower(w.status) OR lower(s.label)=lower(w.status)) AND lower(s.code) IN ('open','scheduled'))"}
    ORDER BY w.id ${lock ? "FOR UPDATE OF w" : ""}`, ids ? [ids] : []);
  const visible = new Set((await visibleAssignedOrders(user, rows.map(w => ({
    id: w.id, assignedUserId: w.assigned_user_id, assignedGroupId: w.assigned_group_id,
  })))).map(w => w.id));
  const { rows: statuses } = await client.query("SELECT code,label FROM public.work_order_statuses");
  const result: FulfillmentCandidate[] = [];
  for (const row of rows.filter(row => visible.has(row.id))) {
    const status = statuses.find(s => [s.code, s.label].some(v => String(v).toLowerCase() === String(row.status).toLowerCase()))?.code ?? row.status;
    const demand = await workRequirements(client, projectId, state, row);
    result.push({ workOrderId: row.id, label: String(row.customer_wo_id || row.id), status,
      group: String(row.assigned_group_id || ""), installerId: row.assigned_user_id || null,
      installer: row.installer_name || row.assigned_user_id || "",
      scheduledDate: row.scheduled_at ? new Date(row.scheduled_at).toISOString() : "",
      route: String(row.route ?? ""), zone: String(row.zone ?? ""),
      assignmentVersion: Number(row.assignment_version ?? 0), lines: fulfillmentOutstanding(state, row.id, demand.lines),
      missing: demand.missing, eligible: project.wizard_mode !== "reading_only" &&
        (String(status).toLowerCase() === "open" && !!row.assigned_group_id && !row.assigned_user_id ||
          String(status).toLowerCase() === "scheduled" && !!row.assigned_user_id) });
  }
  return result;
}
export async function prepareFulfillment(client: PoolClient, projectId: number, state: InventoryState,
  action: string, data: Record<string, unknown>, user: User, admin: boolean): Promise<FulfillmentBatch | undefined> {
  const required = ["inventory.assign", "inventory.receive", "inventory.transfer", "workOrders.view"];
  for (const permission of required) if (!await storage.hasPermission(user, permission))
    throw Object.assign(new InventoryError("Fulfillment requires work-order viewing and inventory assign, receive and transfer permissions."), { status: 403 });
  if (action !== "fulfillmentCreate") {
    const input = action === "fulfillmentMove" ? fulfillmentMoveSchema.parse(data) : fulfillmentCloseSchema.parse(data);
    const batch = state.fulfillmentBatches?.find(b => b.id === input.id);
    if (!batch) throw new InventoryError("Fulfillment batch not found.");
    // Allow warehouse staff to finish custody handoff after an order is reassigned/completed:
    // crew stock is pooled, and scheduled allocations remain reviewable rather than rebased.
    // Existing visibility and location permissions are still checked on every action.
    const visible = await fulfillmentOrders(client, projectId, state, user, batch.workOrders.map(w => w.workOrderId), true);
    if (visible.length !== batch.workOrders.length)
      throw Object.assign(new InventoryError("Work-order access changed. An authorized warehouse manager must review this batch."), { status: 403 });
    if (action === "fulfillmentMove" && fulfillmentMoveSchema.parse(data).phase === "stage" &&
        visible.some(w => batch.workOrders.find(saved => saved.workOrderId === w.workOrderId)?.assignmentVersion !== w.assignmentVersion ||
          !["open", "scheduled"].includes(String(w.status).toLowerCase())))
      throw Object.assign(new InventoryError("Work or assignments changed since this batch was planned. Release its remaining demand and review current orders before pulling more stock. Already-staged crew stock can still be handed to its vehicle."), { status: 409 });
    if (batch.mode === "scheduled" && action === "fulfillmentMove") {
      const stale = visible.some(w => batch.workOrders.find(saved => saved.workOrderId === w.workOrderId)?.assignmentVersion !== w.assignmentVersion ||
        !w.eligible || String(w.status).toLowerCase() !== "scheduled");
      if (stale) throw Object.assign(new InventoryError("A scheduled order was reassigned or its status changed. Review its reservations in Work Order Details; do not hand this batch to the former installer."), { status: 409 });
    }
    return;
  }
  const input = fulfillmentCreateSchema.parse(data);
  if (new Set(input.workOrders.map(w => w.workOrderId)).size !== input.workOrders.length)
    throw new InventoryError("Select each work order only once.");
  if (new Set([input.sourceId, input.stagingId, input.vehicleId]).size !== 3)
    throw new InventoryError("Warehouse, staging and vehicle must be different locations.");
  const source = warehouseAccess(state, input.sourceId, user.id, admin);
  const staging = warehouseAccess(state, input.stagingId, user.id, admin);
  const vehicle = warehouseAccess(state, input.vehicleId, user.id, admin);
  const type = state.locationTypes?.find(type => type.id === staging.locationTypeId);
  if (source.type !== "physical" || !isStagingType(type) || vehicle.type !== "vehicle")
    throw new InventoryError("Choose a warehouse source, a Staging location and a vehicle destination.");
  const orders = await fulfillmentOrders(client, projectId, state, user, input.workOrders.map(w => w.workOrderId), true);
  if (orders.length !== input.workOrders.length) throw new InventoryError("Some selected work orders are unavailable.");
  const canPrepareOthers = admin || await storage.hasPermission(user, "inventory.maintain") || await storage.hasPermission(user, "inventory.configure");
  if (!canPrepareOthers && orders.some(w => w.installerId && w.installerId !== user.id))
    throw Object.assign(new InventoryError("Inventory maintenance authority is required to prepare another installer's work."), { status: 403 });
  for (const order of orders) {
    if (!order.eligible || (input.mode === "crew" ? String(order.status).toLowerCase() !== "open" : String(order.status).toLowerCase() !== "scheduled"))
      throw new InventoryError("Crew batches require group-assigned Open orders; individual work requires Scheduled orders.");
    if (order.assignmentVersion !== input.workOrders.find(w => w.workOrderId === order.workOrderId)?.assignmentVersion)
      throw Object.assign(new InventoryError("An assignment changed. Reload and review selected work before creating the batch."), { status: 409 });
    if (order.missing.length) throw new InventoryError(`Work order ${order.label} has unmapped equipment types. Configure inventory links first.`);
    if (!order.lines.length) throw Object.assign(new InventoryError(`Work order ${order.label} has no uncovered physical demand. Reload to see existing staging.`), { status: 409 });
  }
  if (input.mode === "scheduled" && new Set(orders.map(w => w.installerId)).size !== 1)
    throw new InventoryError("Choose scheduled work for one installer per vehicle batch.");
  if (input.mode === "crew" && new Set(orders.map(w => w.group)).size !== 1)
    throw new InventoryError("Choose one crew/group per batch; routes and zones may be combined.");
  return { ...input, status: "active", revision: 1, createdBy: user.id, createdAt: new Date().toISOString(),
    workOrders: orders.map(w => ({ workOrderId: w.workOrderId, assignmentVersion: w.assignmentVersion, label: w.label })),
    lines: orders.flatMap(w => w.lines.map(line => ({ ...line, workOrderId: w.workOrderId,
      stagedQuantity: 0, deliveredQuantity: 0, stagedSerials: [], deliveredSerials: [] }))) };
}
