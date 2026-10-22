import type { PoolClient } from "pg";
import type { User } from "../shared/schema";
import type { InventoryState } from "../shared/inventory";
import { reserved } from "../shared/inventory-engine";
import { InventoryError } from "../shared/inventory-errors";
import { warehouseAccessible } from "../shared/inventory-location-types";
import { fulfillmentTicketNumber } from "../shared/inventory-pickups";
import { vehicleTransferDemand, vehicleTransferSchema, type VehicleTransfer } from "../shared/inventory-vehicle-transfer";
import { storage } from "./storage";
import { visibleAssignedOrders } from "./workOrderVisibility";

export async function vehicleTransferPermissions(user: User) {
  const has = async (keys: string[]) => (await Promise.all(keys.map(key => storage.hasPermission(user, key)))).every(Boolean);
  const canStockTransfer = !user.isLocked && await has(["inventory.view", "inventory.transfer", "inventory.receive"]);
  return { canStockTransfer, canWorkTransfer: canStockTransfer &&
    await has(["inventory.assign", "workOrders.view", "workOrders.edit", "workOrders.assign"]) };
}
async function receivingMembers(projectId: number, ids: string[]) {
  const members = new Map<string, { id: string; name: string }>();
  for (const id of new Set(ids)) {
    const user = await storage.getUser(id);
    if (!user || user.isLocked || !await storage.isUserAssignedToProject(id, projectId)) continue;
    const canWork = (await Promise.all(["workOrders.view", "workOrders.meterChangeout", "inventory.assign"]
      .map(permission => storage.hasPermission(user, permission)))).every(Boolean);
    if (canWork) members.set(id, { id, name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || id });
  }
  return members;
}
async function workTable(client: PoolClient, projectId: number) {
  const { rows: [project] } = await client.query("SELECT database_name FROM public.projects WHERE id=$1", [projectId]);
  if (!project?.database_name || !/^[a-z0-9_]+$/.test(project.database_name))
    throw new InventoryError("Project work-order storage is unavailable.");
  return `"${project.database_name}".work_orders`;
}
async function workRows(client: PoolClient, projectId: number, ids: number[], lock = false) {
  if (!ids.length) return [];
  const table = await workTable(client, projectId);
  return (await client.query(`SELECT * FROM ${table} WHERE id=ANY($1::int[]) ORDER BY id ${lock ? "FOR UPDATE" : ""}`, [ids])).rows;
}
async function transferBlockers(client: PoolClient, projectId: number, rows: any[]) {
  const { rows: statuses } = await client.query("SELECT code,label FROM public.work_order_statuses");
  const { rows: drafts } = await client.query("SELECT work_order_id FROM public.changeout_drafts WHERE project_id=$1 AND work_order_id=ANY($2::int[])",
    [projectId, rows.map(row => row.id)]);
  return new Map(rows.map(row => {
    const configured = statuses.find(status => [status.code, status.label].some(value =>
      String(value).toLowerCase() === String(row.status).toLowerCase()));
    const status = String(configured?.code ?? row.status).toLowerCase();
    return [row.id, !["open", "scheduled"].includes(status)
      ? "Only outstanding Open or Scheduled work can move. Completed installations are never transferred."
      : drafts.some(draft => draft.work_order_id === row.id)
        ? "A field changeout draft is in progress. Have the technician finish or explicitly discard that draft before transferring this work."
        : null];
  }));
}
export async function prepareVehicleTransfer(client: PoolClient, projectId: number, state: InventoryState,
  data: unknown, user: User, admin: boolean) {
  const input = vehicleTransferSchema.parse(data);
  const permissions = await vehicleTransferPermissions(user);
  if (!permissions.canStockTransfer || input.mode === "work" && !permissions.canWorkTransfer ||
      !admin && !await storage.isUserAssignedToProject(user.id, projectId))
    throw Object.assign(new InventoryError("Vehicle handovers require inventory view, transfer and receive permissions. Moving work also requires inventory assign and work-order view, edit and assign permissions."), { status: 403 });
  for (const id of [input.sourceId, input.destinationId]) {
    const vehicle = state.warehouses.find(vehicle => vehicle.id === id);
    if (!vehicle?.active || vehicle.type !== "vehicle" || !warehouseAccessible(state, vehicle, user.id, admin))
      throw Object.assign(new InventoryError("Access to both active vehicle locations is required."), { status: 403 });
  }
  if (input.mode === "stock") return input;
  vehicleTransferDemand(state, input);
  const rows = await workRows(client, projectId, input.workOrders.map(row => row.workOrderId), true);
  const visible = await visibleAssignedOrders(user, rows.map(row => ({ id: row.id, status: row.status,
    assignedUserId: row.assigned_user_id, assignedGroupId: row.assigned_group_id,
    newSystemType: row.new_system_type, newModuleType: row.new_module_type, assignmentVersion: row.assignment_version })), projectId);
  if (rows.length !== input.workOrders.length || visible.length !== rows.length)
    throw Object.assign(new InventoryError("You no longer have access to every selected work order."), { status: 403 });
  const blockers = await transferBlockers(client, projectId, rows);
  for (const row of rows) {
    if (row.assignment_version !== input.workOrders.find(work => work.workOrderId === row.id)!.assignmentVersion)
      throw Object.assign(new InventoryError("A selected work order changed. Refresh the review; nothing was transferred."), { status: 409 });
    if (blockers.get(row.id)) throw new InventoryError(blockers.get(row.id)!);
  }
  const destination = state.warehouses.find(vehicle => vehicle.id === input.destinationId)!;
  const crew = await receivingMembers(projectId, [destination.assignedUserId, ...destination.userIds].filter(Boolean) as string[]);
  if (!crew.size)
    throw new InventoryError("The receiving vehicle has no active project technician who can capture work and use inventory. Assign an authorized technician in Inventory > Locations first.");
  if (input.installerId && !crew.has(input.installerId))
    throw new InventoryError("Select an active technician assigned to the receiving vehicle, with work capture and inventory assignment permissions.");
  return input;
}
export async function finishVehicleTransferAssignments(client: PoolClient, projectId: number, state: InventoryState, input: VehicleTransfer) {
  if (input.mode !== "work") return;
  const table = await workTable(client, projectId);
  const installer = input.installerId ? await storage.getUser(input.installerId) : undefined;
  const batch = state.fulfillmentBatches!.find(batch => batch.id === input.batchId)!;
  for (const selected of input.workOrders) {
    const { rows: [row] } = await client.query(`UPDATE ${table} SET assigned_user_id=$2,updated_at=now()
      WHERE id=$1 AND assignment_version=$3 RETURNING assignment_version`,
    [selected.workOrderId, input.installerId ?? null, selected.assignmentVersion]);
    if (!row) throw Object.assign(new InventoryError("Work assignment changed during the transfer. No changes were committed."), { status: 409 });
    const saved = batch.workOrders.find(work => work.workOrderId === selected.workOrderId)!;
    saved.assignmentVersion = row.assignment_version;
    saved.installerId = input.installerId ?? null;
    saved.installer = installer ? [installer.firstName, installer.lastName].filter(Boolean).join(" ") || installer.username || installer.id : "";
    const allocation = state.allocations.find(allocation => allocation.workOrderId === selected.workOrderId && allocation.status === "reserved");
    if (allocation) allocation.assignmentVersion = row.assignment_version;
  }
}
export async function vehicleTransferOptions(client: PoolClient, projectId: number, state: InventoryState,
  user: User, admin: boolean, sourceId?: string, batchId?: string, selectedIds: number[] = []) {
  const permissions = await vehicleTransferPermissions(user);
  if (!permissions.canStockTransfer) throw Object.assign(new InventoryError("Inventory transfer and receive permissions are required."), { status: 403 });
  const accessible = state.warehouses.filter(vehicle => vehicle.active && vehicle.type === "vehicle" &&
    warehouseAccessible(state, vehicle, user.id, admin));
  if (sourceId && !accessible.some(vehicle => vehicle.id === sourceId))
    throw Object.assign(new InventoryError("Source vehicle access required."), { status: 403 });
  const memberIds = [...new Set(accessible.flatMap(vehicle => [vehicle.assignedUserId, ...vehicle.userIds]).filter(Boolean))] as string[];
  const members = await receivingMembers(projectId, memberIds);
  const possible = permissions.canWorkTransfer && sourceId ? (state.fulfillmentBatches ?? []).filter(batch =>
    batch.status !== "cancelled" && batch.workOrders.some(work => (work.vehicleId ?? batch.vehicleId) === sourceId)) : [];
  const ids = [...new Set(possible.flatMap(batch => batch.workOrders.map(work => work.workOrderId)))];
  const rows = await workRows(client, projectId, ids);
  const visible = await visibleAssignedOrders(user, rows.map(row => ({ id: row.id, status: row.status,
    assignedUserId: row.assigned_user_id, assignedGroupId: row.assigned_group_id,
    newSystemType: row.new_system_type, newModuleType: row.new_module_type, assignmentVersion: row.assignment_version })), projectId);
  const blockers = await transferBlockers(client, projectId, rows);
  const batches = possible.map(batch => ({
    id: batch.id, name: batch.name, mode: batch.mode,
    receiptNumber: fulfillmentTicketNumber(batch.createdAt, (state.fulfillmentBatches ?? []).findIndex(value => value.id === batch.id)),
    revision: batch.revision,
    workOrders: batch.workOrders.filter(work => (work.vehicleId ?? batch.vehicleId) === sourceId &&
      visible.some(row => row.id === work.workOrderId)).map(work => {
      const row = rows.find(row => row.id === work.workOrderId)!;
      let reason = blockers.get(row.id) ?? "";
      const input = { mode: "work", revision: state.revision, sourceId, destinationId: "_preview",
        batchId: batch.id, batchRevision: batch.revision, workOrders: [{ workOrderId: row.id, assignmentVersion: row.assignment_version }],
        lines: [], reason: "Preview vehicle handover", physicallyConfirmed: true } as VehicleTransfer;
      if (!reason) try { vehicleTransferDemand(state, input); } catch (error) { reason = (error as Error).message; }
      return { workOrderId: row.id, label: work.label, assignmentVersion: row.assignment_version, status: row.status,
        installerId: row.assigned_user_id, eligible: !reason, reason,
        lines: batch.lines.filter(line => line.workOrderId === row.id).map(line => ({ itemId: line.itemId, quantity: line.quantity })) };
    }),
  })).filter(batch => batch.workOrders.length);
  // Selected work can bring its own reservations. Other jobs' stock remains unavailable.
  const selected = permissions.canWorkTransfer ? new Set(batches.find(batch => batch.id === batchId)?.workOrders
    .filter(work => work.eligible && selectedIds.includes(work.workOrderId)).map(work => work.workOrderId) ?? []) : new Set<number>();
  const stock = state.stock.filter(stock => stock.warehouseId === sourceId).map(stock => {
    const holds = state.allocations.filter(allocation => allocation.status === "reserved");
    const own = holds.filter(allocation => selected.has(allocation.workOrderId)).flatMap(allocation =>
      allocation.lines.filter(line => line.warehouseId === sourceId && line.itemId === stock.itemId));
    const otherSerials = new Set(holds.filter(allocation => !selected.has(allocation.workOrderId)).flatMap(allocation =>
      allocation.lines.filter(line => line.warehouseId === sourceId && line.itemId === stock.itemId).flatMap(line => line.serials)));
    return { itemId: stock.itemId, quantity: stock.quantity,
      available: Math.max(0, stock.quantity - reserved(state, sourceId!, stock.itemId) + own.reduce((sum, line) => sum + line.quantity, 0)),
      serials: stock.serials.filter(serial => !otherSerials.has(serial)) };
  });
  return { revision: state.revision, ...permissions,
    vehicles: accessible.map(vehicle => ({ id: vehicle.id, name: vehicle.name, code: vehicle.code,
      members: [vehicle.assignedUserId, ...vehicle.userIds].map(id => members.get(id!)).filter(Boolean) })),
    items: state.items.filter(item => item.active && item.kind !== "labor").map(({ id, name, sku, tracking, unit }) => ({ id, name, sku, tracking, unit })),
    stock, batches };
}
