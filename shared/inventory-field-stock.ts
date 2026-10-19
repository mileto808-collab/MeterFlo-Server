import { z } from "zod";
import type { InventoryState, Warehouse, Allocation } from "./inventory";
import { warehouseAccessible, locationTypeFor } from "./inventory-location-types";
import { requirementLeaves } from "./inventory-requirements";

export const fieldStockSettingsSchema = z.object({
  id: z.literal("field-defaults").default("field-defaults"),
  sourceMode: z.enum(["assigned_vehicle", "project_warehouse"]).default("assigned_vehicle"),
  warehouseId: z.string().min(1).max(100).nullable().default(null),
  fulfillment: z.enum(["components", "kits"]).default("components"),
}).strict();
export type FieldStockSettings = z.infer<typeof fieldStockSettingsSchema>;
export type FieldStockState = Pick<InventoryState, "warehouses" | "locationTypes" | "fieldSettings">;
export const fieldStockSettings = (state: Pick<InventoryState, "fieldSettings">): FieldStockSettings =>
  fieldStockSettingsSchema.parse(state.fieldSettings?.[0] ?? {});

export function resolveFieldStock(state: FieldStockState, actor: string, admin: boolean, preferred = "", override = "") {
  const settings = fieldStockSettings(state);
  const accessible = state.warehouses.filter(w => warehouseAccessible(state, w, actor, admin));
  const vehicles = accessible.filter(w => locationTypeFor(state, w)?.kind === "vehicle" &&
    (w.assignedUserId === actor || w.userIds.includes(actor)));
  const selectedOverride = override && accessible.find(w => w.id === override);
  let source: Warehouse | undefined = selectedOverride || undefined;
  if (!source) source = settings.sourceMode === "project_warehouse"
    ? accessible.find(w => w.id === settings.warehouseId && locationTypeFor(state, w)?.kind === "physical")
    : vehicles.find(w => w.id === preferred) ?? (vehicles.length === 1 ? vehicles[0] : undefined);
  return { source, vehicles, accessible, settings, reason: source ? "" : settings.sourceMode === "project_warehouse"
    ? "An active, accessible project warehouse must be configured in Project settings."
    : vehicles.length ? "Choose the vehicle you are working from." : "You have no assigned vehicle. Ask a manager to assign one or configure project warehouse stock." };
}

/** Reservations retain their source; no automatic fallback when vehicle stock is short. */
export function fieldStockSourceAllowed(state: FieldStockState, actor: string, admin: boolean,
  canOverride: boolean, line: Allocation, reserved: Allocation[] = []) {
  if (!warehouseAccessible(state, state.warehouses.find(w => w.id === line.warehouseId), actor, admin)) return false;
  if (canOverride || reserved.some(r => r.itemId === line.itemId && r.warehouseId === line.warehouseId &&
    r.quantity >= line.quantity && line.serials.every(serial => r.serials.includes(serial)))) return true;
  const result = resolveFieldStock(state, actor, admin);
  return result.settings.sourceMode === "assigned_vehicle"
    ? result.vehicles.some(w => w.id === line.warehouseId) : result.source?.id === line.warehouseId;
}

export function fieldFulfillmentAllowed(state: Pick<InventoryState, "fieldSettings" | "items" | "workRequirements">,
  workOrderId: number, used: Allocation[], reserved: Allocation[], canOverride: boolean) {
  if (canOverride || !used.length) return true;
  const isReserved = (line: Allocation) => reserved.some(r => r.itemId === line.itemId && r.warehouseId === line.warehouseId &&
    r.quantity >= line.quantity && line.serials.every(serial => r.serials.includes(serial)));
  if (fieldStockSettings(state).fulfillment === "components")
    return used.every(line => !state.items.find(item => item.id === line.itemId)?.components.length || isReserved(line));
  return (state.workRequirements?.find(r => r.workOrderId === workOrderId)?.lines ?? []).every(requirement => {
    if (!state.items.find(item => item.id === requirement.itemId)?.components.length ||
      used.some(line => line.itemId === requirement.itemId)) return true;
    return requirementLeaves(state, [requirement]).every(leaf =>
      used.filter(line => line.itemId === leaf.itemId && isReserved(line)).reduce((sum, line) => sum + line.quantity, 0) >= leaf.quantity);
  });
}
