import type { InventoryState } from "./inventory";

function referencesItem(value: unknown, itemId: string): boolean {
  if (Array.isArray(value)) return value.some(entry => referencesItem(entry, itemId));
  return !!value && typeof value === "object" && Object.entries(value).some(([key, entry]) =>
    key === "itemId" ? entry === itemId : referencesItem(entry, itemId));
}
export function categoryDeletionBlockers(state: InventoryState, id: string): string[] {
  if (!state.categoryCatalog?.some(category => category.id === id)) return ["Category no longer exists. Refresh the list."];
  const count = state.items.filter(item => item.categoryId === id).length;
  return count ? [`Assigned to ${count} item${count === 1 ? "" : "s"}, including inactive items. Reassign those items first.`] : [];
}
export function itemDeletionBlockers(state: InventoryState, id: string): string[] {
  if (!state.items.some(item => item.id === id)) return ["Item no longer exists. Refresh the list."];
  const reasons: string[] = [];
  if (state.stock.some(stock => stock.itemId === id && (stock.quantity !== 0 || stock.serials.length)))
    reasons.push("Has stock or serials at a location.");
  if (state.items.some(item => item.id !== id && item.components.some(component => component.itemId === id)))
    reasons.push("Used in another item's kit recipe.");
  const collections: Array<[unknown, string]> = [
    [state.orders, "Linked to an order, including cancelled, completed, or cleared orders."],
    [state.counts, "Referenced by a cycle count or its saved draft."],
    [state.allocations, "Referenced by work-order reservations or usage history."],
    [state.receipts, "Referenced by inventory receipt or movement history."],
    [state.returns, "Linked to removed equipment."],
    [state.serialOccupancy, "Has recorded serial custody."],
    [state.shipmentHolds, "Linked to a shipment inspection hold."],
    [state.shipmentDrafts, "Referenced by a saved shipment capture."],
    [state.kitAssemblies, "Referenced by a kit assembly or its contents."],
    [state.kitHolds, "Linked to a kit inspection hold."],
  ];
  for (const [collection, reason] of collections) if (referencesItem(collection, id)) reasons.push(reason);
  return reasons;
}
