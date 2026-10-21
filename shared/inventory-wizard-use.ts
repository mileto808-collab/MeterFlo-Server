import type { Allocation, Reservation, InventoryItem } from "./inventory";
import { inventoryComponentDetails } from "./inventory-component-details";
import { requirementLeaves } from "./inventory-requirements";
import { removalConfig, type RemovalWorkflow } from "./inventory-removal-policy";
import type { InventoryState, WorkAllocation, WorkRequirements } from "./inventory";

export type ActualUseDraft = {
  key: string; itemId: string; warehouseId: string; quantity: string; serials: string;
  reserved: boolean; maxQuantity?: number; allowedSerials?: string[];
};
export type PlannedStockMode = "components" | "kits";
type Requirement = { itemId: string; quantity: number };

type WizardBasis = Pick<InventoryState, "fieldSettings" | "removalRules" | "removalPolicies"> & {
  workflow?: RemovalWorkflow; revision?: number; allocation?: WorkAllocation | null; requirements?: WorkRequirements;
};

/** Initialization, review and submission must compare exactly the same basis. */
export function inventoryWizardBasis(snapshot: WizardBasis | undefined): string {
  return JSON.stringify({
    // Project-wide receipts/assemblies/other technicians do not change this
    // work order's approved basis. Current stock is checked atomically at posting.
    allocation: snapshot?.allocation ?? null,
    requirements: snapshot?.requirements ?? null,
    fieldSettings: snapshot?.fieldSettings ?? [],
    removal: snapshot ? removalConfig(snapshot) : null,
    workflow: snapshot?.workflow,
  });
}

/** Explicitly replace actual use, never a reserved plan or wizard captures.
 * Without a plan, kit lineage cannot be inferred from loose rows: the reviewed
 * refresh clears manual use for re-selection under the approved defaults.
 */
export function refreshApprovedUse(current: ActualUseDraft[], requirements: Requirement[], items: InventoryItem[],
  warehouseId: string, mode: PlannedStockMode, reservations: Allocation[] = []): ActualUseDraft[] {
  if (reservations.length || current.some(line => line.reserved))
    throw new Error("Existing reservations keep their locations and stock handling. Change reservations in the work-order Inventory section.");
  if (!warehouseId) throw new Error("The approved stock source is unavailable or inaccessible. Your entries have been kept.");
  return plannedUseDrafts(requirements, items, warehouseId, mode).map(line => {
    const prior = current.find(row => row.itemId === line.itemId && row.warehouseId === line.warehouseId &&
      row.quantity === line.quantity);
    return prior ? { ...line, serials: prior.serials } : line;
  });
}

/** The stock representation is explicit: never debit both a finished kit and its parts. */
export function plannedUseDrafts(requirements: Requirement[], items: InventoryItem[], warehouseId: string,
  mode: PlannedStockMode, reservations: Reservation[] = []): ActualUseDraft[] {
  const rows = mode === "components" ? requirementLeaves({ items }, requirements) : requirements;
  const quantities = new Map<string, number>();
  rows.forEach(row => {
    if (items.find(item => item.id === row.itemId)?.kind !== "labor")
      quantities.set(row.itemId, (quantities.get(row.itemId) ?? 0) + row.quantity);
  });
  return [...quantities].flatMap(([itemId, quantity]) => {
    const result: ActualUseDraft[] = [];
    for (const reserved of reservations.filter(line => line.itemId === itemId && (!warehouseId || line.warehouseId === warehouseId))) {
      if (quantity <= 0) break;
      const used = Math.min(quantity, reserved.quantity);
      result.push({ key: `planned-${reserved.warehouseId}-${itemId}`, itemId, warehouseId: reserved.warehouseId,
        quantity: String(used), serials: "", reserved: true, maxQuantity: reserved.quantity,
        allowedSerials: reserved.reservationMode === "quantity" ? undefined : reserved.serials });
      quantity -= used;
    }
    if (quantity > 0) {
      const sameLocation = warehouseId && result.find(line => line.warehouseId === warehouseId);
      // One command row per item/location. Keep an insufficient reservation's
      // limit visible instead of fabricating a second unreserved row beside it.
      if (sameLocation) sameLocation.quantity = String(Number(sameLocation.quantity) + quantity);
      else result.push({ key: `planned-${warehouseId}-${itemId}`, itemId, warehouseId,
        quantity: String(quantity), serials: "", reserved: false });
    }
    return result;
  });
}

export function plannedInventoryLabels(requirements: Requirement[], items: InventoryItem[]) {
  const rows = requirements.flatMap(row => {
    const item = items.find(item => item.id === row.itemId);
    return item?.components.length ? inventoryComponentDetails(row.itemId, row.quantity, items)
      .filter(component => !items.find(item => item.id === component.itemId)?.components.length)
      : [{ itemId: row.itemId, label: item?.name ?? row.itemId, quantity: row.quantity,
        unit: item?.unit ?? "units", labor: item?.kind === "labor" }];
  });
  const labels = new Map<string, typeof rows[number]>();
  rows.forEach(row => {
    const prior = labels.get(row.itemId);
    labels.set(row.itemId, { ...row, quantity: Math.round(((prior?.quantity ?? 0) + row.quantity) * 1e6) / 1e6 });
  });
  return [...labels.values()];
}

export function initialActualUse(allocation: { lines: Reservation[] } | null | undefined,
  requirements: Requirement[] = [], items: InventoryItem[] = []): ActualUseDraft[] {
  if (requirements.length) {
    const mode = requirements.some(row => items.find(item => item.id === row.itemId)?.components.length &&
      allocation?.lines.some(line => line.itemId === row.itemId)) ? "kits" : "components";
    return plannedUseDrafts(requirements, items, "", mode, allocation?.lines);
  }
  return (allocation?.lines ?? []).map((line, index) => ({
    key: `reserved-${line.warehouseId}-${line.itemId}-${index}`, itemId: line.itemId,
    warehouseId: line.warehouseId, quantity: "0", serials: "", reserved: true,
    maxQuantity: line.quantity, allowedSerials: line.reservationMode === "quantity" ? undefined : line.serials,
  }));
}

/** New device IDs come from the wizard's scan, not a second inventory serial entry. */
export function bindWizardEquipmentSerials(lines: ActualUseDraft[], items: InventoryItem[],
  ids: { system: string; module: string }): ActualUseDraft[] {
  let changed = false;
  const next = lines.map(line => {
    const item = items.find(item => item.id === line.itemId);
    if (item?.tracking !== "serialized" || item.components.length ||
      !["system", "module"].includes(item.equipment) || Number(line.quantity) !== 1) return line;
    const serials = ids[item.equipment as "system" | "module"].trim();
    if (line.serials === serials) return line;
    changed = true;
    return { ...line, serials };
  });
  return changed ? next : lines;
}

export function actualUseLinesAreValid(lines: ActualUseDraft[], items: InventoryItem[], deferEquipmentSerials = false): boolean {
  return lines.every(line => {
    const quantity = Number(line.quantity), item = items.find(item => item.id === line.itemId);
    if (!Number.isInteger(quantity) || quantity < 0 || (line.reserved && quantity > (line.maxQuantity ?? 0))) return false;
    if (!quantity) return true;
    if (!item || item.kind === "labor" || !line.warehouseId) return false;
    if (item.tracking !== "serialized") return true;
    const equipmentScan = !item.components.length && ["system", "module"].includes(item.equipment);
    if (equipmentScan && quantity !== 1) return false;
    if (deferEquipmentSerials && equipmentScan) return true;
    const serials = line.serials.split(/[\n,;]/).map(value => value.trim()).filter(Boolean);
    if (serials.length !== quantity || new Set(serials).size !== serials.length) return false;
    return !line.reserved || line.allowedSerials === undefined || serials.every(serial => line.allowedSerials!.includes(serial));
  });
}
