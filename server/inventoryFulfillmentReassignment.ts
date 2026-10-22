import type { PoolClient } from "pg";
import type { InventoryState } from "../shared/inventory";
import type { FulfillmentBatch, FulfillmentCandidate } from "../shared/inventory-fulfillment";
import type { FulfillmentReassignmentReview } from "../shared/inventory-fulfillment-reassignment";
import type { User } from "../shared/schema";
import { warehouseAccess } from "../shared/inventory-engine";
import { isStagingType } from "../shared/inventory-location-types";
import { storage } from "./storage";
export { reassignmentDemandState } from "../shared/inventory-fulfillment-reassignment";

export async function fulfillmentReassignmentReview(client: Pick<PoolClient, "query">,
  projectId: number, state: InventoryState, batch: FulfillmentBatch, orders: FulfillmentCandidate[],
  user: User, admin: boolean): Promise<FulfillmentReassignmentReview> {
  const blockers: string[] = [], warnings: string[] = [];
  const vehicle = state.warehouses.find(location => location.id === batch.vehicleId);
  const staging = state.warehouses.find(location => location.id === batch.stagingId);
  const installerIds = [...new Set(orders.map(order => order.installerId).filter((id): id is string => !!id))];
  const userIds = [...new Set([...installerIds, ...(vehicle?.userIds ?? []),
    ...(vehicle?.assignedUserId ? [vehicle.assignedUserId] : [])])];
  const { rows: names } = await client.query("SELECT id,username,coalesce(is_locked,false) AS is_locked FROM public.users WHERE id=ANY($1::text[])", [userIds]);
  const nameMap = new Map<string, string>(names.map(value => [value.id, value.username]));
  const installer = installerIds.length === 1
    ? { id: installerIds[0], name: nameMap.get(installerIds[0]) ?? "Installer unavailable" } : null;
  if (batch.mode !== "scheduled") blockers.push("This review is for individually scheduled work. For a crew batch, review or release its unfinished remainder.");
  if (batch.status !== "active") blockers.push("This batch is no longer active. Open its history instead of changing it.");
  if (batch.lines.some(line => line.deliveredQuantity > 0))
    blockers.push("Stock has already been handed to the original vehicle. Do not relabel that delivery. Review its physical transfer or return, release the unfinished remainder, and prepare a new batch for the new installer.");
  if (!batch.lines.some(line => line.quantity > line.deliveredQuantity))
    blockers.push("There is no unfinished demand to reassign.");
  if (orders.length !== batch.workOrders.length)
    blockers.push("Some work orders are unavailable. Restore work-order access or ask an authorized warehouse manager to review this batch.");
  if (orders.some(order => !order.eligible || order.status.toLowerCase() !== "scheduled"))
    blockers.push("Every order must still be individually Scheduled. Review completed, cancelled, Open, or unassigned work orders before continuing; release the remainder if this batch is no longer needed.");
  if (!installer || orders.some(order => order.installerId !== installer.id))
    blockers.push("These orders no longer share one installer. Schedule them for one installer, or release the unfinished remainder and prepare separate installer batches.");
  if (installer && (names.find(value => value.id === installer.id)?.is_locked !== false ||
    !await storage.isUserAssignedToProject(installer.id, projectId)))
    blockers.push("The current installer must have an active account and project access. Correct that user's access before continuing.");
  const canPrepareOthers = admin || await storage.hasPermission(user, "inventory.maintain") ||
    await storage.hasPermission(user, "inventory.configure");
  if (!canPrepareOthers && installer?.id !== user.id)
    blockers.push("Inventory maintenance or configuration authority is required to review another installer's stock. Ask an authorized warehouse manager.");
  for (const locationId of [batch.sourceId, batch.stagingId]) {
    try { warehouseAccess(state, locationId, user.id, admin); }
    catch { blockers.push("The source warehouse or Staging location is inactive or inaccessible. Correct its location access before continuing."); break; }
  }
  if (state.warehouses.find(location => location.id === batch.sourceId)?.type !== "physical" ||
    !isStagingType(state.locationTypes?.find(type => type.id === staging?.locationTypeId)))
    blockers.push("The original source must remain a warehouse and the staged stock must remain at a Staging location. Correct the location setup before continuing.");

  for (const order of orders) {
    const expected = new Map(order.lines.map(line => [line.itemId, line.quantity]));
    const planned = new Map<string, number>();
    for (const line of batch.lines.filter(line => line.workOrderId === order.workOrderId))
      planned.set(line.itemId, (planned.get(line.itemId) ?? 0) + line.quantity);
    if (order.missing.length || expected.size !== planned.size ||
      [...planned].some(([itemId, quantity]) => expected.get(itemId) !== quantity))
      blockers.push(`Work order ${order.label}: required items, quantities, or other reservations changed. Review its Inventory requirements and reservations before reusing stock; otherwise release this batch's remainder.`);
    const allocation = state.allocations.find(value => value.workOrderId === order.workOrderId && value.status === "reserved");
    if (allocation?.lines.some(line => line.warehouseId !== batch.sourceId && line.warehouseId !== batch.stagingId))
      blockers.push(`Work order ${order.label} has reservations at another location or vehicle. Review those reservations in Work Order Details before continuing.`);
  }
  const vehicles = state.warehouses.filter(location => {
    if (!installer || location.type !== "vehicle" ||
      ![...(location.userIds ?? []), location.assignedUserId].includes(installer.id)) return false;
    try { warehouseAccess(state, location.id, user.id, admin); return true; } catch { return false; }
  }).map(location => ({ id: location.id, name: location.name }));
  if (!vehicles.length) blockers.push("No accessible active vehicle is assigned to the current installer. In Inventory → Locations, assign the installer to the correct vehicle, then refresh this review.");
  if (batch.workOrders.some(work => work.installer === undefined))
    warnings.push("The previous installer was not saved in this older batch. Check the original vehicle crew below; no historical installer has been guessed.");
  if (batch.lines.some(line => line.stagedQuantity > 0))
    warnings.push("Reuse the listed staged units and serials. Do not pull them again. Only the outstanding quantity still needs picking.");
  const items = new Map<string, FulfillmentReassignmentReview["items"][number]>();
  const itemMap = new Map(state.items.map(item => [item.id, item]));
  for (const line of batch.lines) {
    const item = itemMap.get(line.itemId);
    if (!item?.active || item.kind === "labor")
      blockers.push("A required item is inactive or unavailable. Review the item setup before continuing.");
    const row = items.get(line.itemId) ?? { itemId: line.itemId, sku: item?.sku ?? "",
      name: item?.name ?? "Unavailable item", unit: item?.unit ?? "units",
      required: 0, staged: 0, delivered: 0, remaining: 0, serials: [] };
    row.required += line.quantity; row.staged += line.stagedQuantity; row.delivered += line.deliveredQuantity;
    row.remaining += line.quantity - line.stagedQuantity;
    row.serials.push(...line.stagedSerials.filter(serial => !line.deliveredSerials.includes(serial)));
    items.set(line.itemId, row);
  }
  for (const row of items.values()) {
    const stock = state.stock.filter(line => line.warehouseId === batch.stagingId && line.itemId === row.itemId);
    const serials = new Set(stock.flatMap(line => line.serials));
    if (stock.reduce((sum, line) => sum + line.quantity, 0) < row.staged - row.delivered ||
      row.serials.some(serial => !serials.has(serial)))
      blockers.push(`${row.name}: Staging no longer contains all recorded batch stock. Review custody and reconcile the shortage before reusing it.`);
  }
  const { rows: [project] } = await client.query("SELECT timezone,is_active,wizard_mode FROM public.projects WHERE id=$1", [projectId]);
  if (project?.is_active === false) blockers.push("This project is inactive. Reactivate it before confirming reassignment.");
  if (project?.wizard_mode === "reading_only") blockers.push("This project is reading-only. Replacement inventory cannot be reassigned here.");
  return { batchId: batch.id, revision: batch.revision, batchName: batch.name, timezone: project?.timezone ?? "UTC",
    canApply: blockers.length === 0, blockers: [...new Set(blockers)], warnings,
    previousVehicle: { id: batch.vehicleId, name: vehicle?.name ?? "Original vehicle unavailable",
      crew: [...new Set([...(vehicle?.userIds ?? []), ...(vehicle?.assignedUserId ? [vehicle.assignedUserId] : [])])]
        .map(id => nameMap.get(id) ?? "Former crew member") },
    staging: { id: batch.stagingId, name: staging?.name ?? "Staging unavailable" }, installer, vehicles,
    orders: orders.map(order => { const previous = batch.workOrders.find(work => work.workOrderId === order.workOrderId);
      return { workOrderId: order.workOrderId, label: order.label, assignmentVersion: order.assignmentVersion,
        status: order.status, previousInstaller: previous?.installer ?? null,
        currentInstaller: order.installerId ? nameMap.get(order.installerId) ?? "Installer unavailable" : "Unassigned",
        previousScheduledDate: previous?.scheduledDate ?? null, currentScheduledDate: order.scheduledDate }; }),
    items: [...items.values()] };
}
