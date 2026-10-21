import type { InventoryOrder, InventoryState, StockLine } from "@shared/inventory";
import type { DamageLine } from "@shared/inventory-shipment-model";
import { orderLineProgress, settledLines } from "@shared/inventory-shipment-model";
import { canonicalInventoryJson } from "@shared/inventory-engine";
import type { ShipmentCapture } from "@shared/inventory-shipment-draft-model";
import { receivingPalletIssue, type ReceivingPallet, type ReceiptPallet } from "@shared/inventory-receiving-pallets";

export type ShipmentAction = "receive" | "dispatch" | "accept";
export type ShipmentEntry = {
  itemId: string;
  goodQuantity: string;
  damagedQuantity: string;
  unreadableQuantity: string;
  goodSerials: string[];
  damagedSerials: string[];
  expectedSerials: string[];
  damageReason: string;
  pallets?: ReceivingPallet[];
  activePalletId?: string | null;
};

export const blankShipmentEntry = (itemId: string): ShipmentEntry => ({
  itemId, goodQuantity: "0", damagedQuantity: "0", unreadableQuantity: "0",
  goodSerials: [], damagedSerials: [], expectedSerials: [], damageReason: "",
});

// Dirty checks ignore empty UI slots, not actual captured text. Keep durable
// save/replay equality exact: this normalization is only for dismissal warnings.
export function shipmentCaptureEditFingerprint(capture: ShipmentCapture) {
  return canonicalInventoryJson({
    ...capture,
    entries: Object.fromEntries(Object.entries(capture.entries).filter(([id, row]) =>
      canonicalInventoryJson(row) !== canonicalInventoryJson(blankShipmentEntry(id)))),
    scanBuffers: Object.fromEntries(Object.entries(capture.scanBuffers).filter(([, value]) => value !== "")),
  });
}

export function shipmentCapacity(state: InventoryState, order: InventoryOrder, action: ShipmentAction, itemId: string) {
  const progress = orderLineProgress(state, order, itemId);
  if (action === "dispatch") return Math.max(0, progress.ordered - progress.dispatched);
  if (action === "accept") return Math.max(0, progress.inTransit);
  return Math.max(0, progress.remaining);
}

export function unresolvedTransferSerials(state: InventoryState, order: InventoryOrder, itemId: string) {
  const dispatched = order.dispatched.filter(line => line.itemId === itemId).flatMap(line => line.serials);
  const received = order.received.filter(line => line.itemId === itemId).flatMap(line => line.serials);
  const settled = settledLines(order).filter(line => line.itemId === itemId).flatMap(line => line.serials);
  const heldExpected = (state.shipmentHolds ?? []).filter(hold => hold.orderId === order.id && hold.itemId === itemId)
    .flatMap(hold => hold.expectedSerials);
  return dispatched.filter(serial => !received.includes(serial) && !settled.includes(serial) && !heldExpected.includes(serial));
}

export function validateShipmentEntry(entry: ShipmentEntry, serialized: boolean, action: ShipmentAction, availableSerials: string[]) {
  const good = Number(entry.goodQuantity), damaged = Number(entry.damagedQuantity), unreadable = Number(entry.unreadableQuantity);
  if (action !== "receive" && entry.pallets?.length) return "Pallet groups apply to purchase receiving only.";
  if (entry.pallets?.length) {
    if (!serialized) return "Pallet scan groups require a serialized item.";
    const issue = receivingPalletIssue(entry.pallets.map(pallet => ({ ...pallet, itemId: entry.itemId })),
      [{ itemId: entry.itemId, quantity: good + damaged, serials: [...entry.goodSerials, ...entry.damagedSerials] }]);
    if (issue) return issue;
  }
  for (const [label, quantity] of [["good", good], ["damaged", damaged], ["unreadable", unreadable]] as const) {
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000) return `Enter a whole ${label} quantity from 0 to 1,000,000.`;
  }
  if (action === "dispatch" && (damaged || unreadable || entry.damagedSerials.length || entry.expectedSerials.length))
    return "Transfer dispatches must contain good stock only.";
  if (good + damaged + unreadable > 1_000_000) return "The row total cannot exceed 1,000,000 units.";
  if (!serialized && unreadable !== 0) return "Unreadable identity applies only to serialized products.";
  if (damaged + unreadable > 0 && !entry.damageReason.trim()) return "Add a condition reason for damaged or unreadable units.";
  if (serialized) {
    if (entry.goodSerials.length !== good) return `Scan ${good} good serial${good === 1 ? "" : "s"}.`;
    if (entry.damagedSerials.length !== damaged) return `Scan ${damaged} known damaged serial${damaged === 1 ? "" : "s"}.`;
    if (action === "accept" && entry.expectedSerials.length !== unreadable)
      return `Select exactly ${unreadable} dispatched identity${unreadable === 1 ? "" : "ies"} for unreadable damage.`;
    if (action !== "accept" && entry.expectedSerials.length) return "Expected dispatched identities apply only to transfer arrivals.";
    const all = [...entry.goodSerials, ...entry.damagedSerials];
    if (all.some(serial => !serial.trim() || serial.length > 100)) return "Serials must be 1–100 characters.";
    if (new Set(all).size !== all.length) return "A serial may appear only once in this movement.";
    if (action === "accept" && all.some(serial => !availableSerials.includes(serial)))
      return "A scanned serial must be an unresolved identity from this transfer.";
    if (new Set(entry.expectedSerials).size !== entry.expectedSerials.length ||
        entry.expectedSerials.some(serial => !availableSerials.includes(serial)) ||
        entry.expectedSerials.some(serial => all.includes(serial)))
      return "Unreadable identities must be distinct unresolved dispatched serials and cannot also be scanned as good or damaged.";
  } else if (entry.goodSerials.length || entry.damagedSerials.length || entry.expectedSerials.length) {
    return "Quantity-tracked products do not accept serial scans.";
  }
  return null;
}

export function buildShipmentPayload(entries: ShipmentEntry[], action: ShipmentAction) {
  const lines: StockLine[] = [];
  const damaged: DamageLine[] = [];
  const pallets: ReceiptPallet[] = [];
  for (const entry of entries) {
    const good = Number(entry.goodQuantity), damagedKnown = Number(entry.damagedQuantity), unreadable = Number(entry.unreadableQuantity);
    if (action === "receive") pallets.push(...(entry.pallets ?? []).map(pallet => ({ ...pallet, itemId: entry.itemId })));
    if (good > 0) lines.push({ itemId: entry.itemId, quantity: good, serials: entry.goodSerials });
    if (damagedKnown + unreadable > 0) damaged.push({
      itemId: entry.itemId, quantity: damagedKnown + unreadable,
      serials: entry.damagedSerials, unidentifiedQuantity: unreadable,
      expectedSerials: action === "accept" ? entry.expectedSerials : [],
      reason: entry.damageReason.trim(),
    });
  }
  return { lines, damaged, ...(pallets.length ? { pallets } : {}) };
}

export function shipmentFingerprint(action: string, data: Record<string, unknown>) {
  return JSON.stringify([action, data]);
}

