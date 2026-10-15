import { uuidOrderId } from "./inventory-order-labels";

export type InventoryActorLabel = { id: string; username: string | null };

export function inventoryActorLabel(id: string | null | undefined, actors: readonly InventoryActorLabel[] = []) {
  if (!id) return "Not recorded";
  const username = actors.find(actor => actor.id === id)?.username?.trim();
  return username || (uuidOrderId(id) ? "Unknown or deleted user" : id);
}

// The ledger is append-only. Use its persisted position, never a sorted or paged list.
export function inventoryReceiptLabel(receipts: readonly { id: string }[], id: string) {
  const index = receipts.findIndex(receipt => receipt.id === id);
  return index < 0 ? "Receipt (reference unavailable)" : `Receipt #${index + 1}`;
}

export function inventoryHoldLabel(holds: readonly { id: string }[], id: string) {
  const index = holds.findIndex(hold => hold.id === id);
  return index < 0 ? "Inspection hold (reference unavailable)" : `Inspection hold #${index + 1}`;
}
