import { z } from "zod";
import type { Allocation, InventoryState } from "./inventory";
import { InventoryError } from "./inventory-errors";

export type StockDiscrepancy = {
  id: string; workOrderId: number; warehouseId: string; itemId: string; sourceReceiptId: string;
  quantity: number; serials: string[]; usedQuantity: number; recordedAvailable: number;
  actor: string; occurredAt: string; status: "open" | "resolved";
  itemSku: string; itemName: string; locationName: string;
  resolvedBy?: string; resolvedAt?: string; method?: "apply_stock" | "documented_adjustment";
  reason?: string; evidence?: string; receiptIds?: string[];
};

export const stockDiscrepancySchema = z.object({
  id: z.string().min(1), workOrderId: z.number().int().positive(), warehouseId: z.string().min(1), itemId: z.string().min(1), sourceReceiptId: z.string().min(1),
  quantity: z.number().int().positive(), serials: z.array(z.string().min(1)),
  usedQuantity: z.number().int().positive(), recordedAvailable: z.number().int().nonnegative(),
  actor: z.string().min(1), occurredAt: z.string().datetime(), status: z.enum(["open", "resolved"]),
  itemSku: z.string(), itemName: z.string(), locationName: z.string(),
  resolvedBy: z.string().optional(), resolvedAt: z.string().datetime().optional(),
  method: z.enum(["apply_stock", "documented_adjustment"]).optional(),
  reason: z.string().optional(), evidence: z.string().optional(), receiptIds: z.array(z.string()).optional(),
}).strict();

export const resolveStockDiscrepancySchema = z.object({
  id: z.string().min(1), method: z.enum(["apply_stock", "documented_adjustment"]),
  reason: z.string().trim().min(10, "Explain the correction (at least 10 characters).").max(2000),
  evidence: z.string().trim().min(3, "Enter a supporting document or investigation reference.").max(1000),
  receiptIds: z.array(z.string().min(1)).max(50).default([]),
}).strict();

export function stockDiscrepancyLabel(state: Pick<InventoryState, "stockDiscrepancies">, id: string) {
  const index = (state.stockDiscrepancies ?? []).findIndex(value => value.id === id);
  return index < 0 ? "Stock discrepancy (reference unavailable)" : `Stock discrepancy #${index + 1}`;
}

/** A physical-use declaration is not permission to consume another owner's serial. */
export function fieldUseSplit(state: InventoryState, used: Allocation[], workOrderId: number) {
  const debit: Allocation[] = [], missing: Array<{ line: Allocation; recordedAvailable: number }> = [];
  const selectedSerials = new Set<string>();
  for (const line of used) {
    const balance = state.stock.find(value => value.warehouseId === line.warehouseId && value.itemId === line.itemId);
    const reservations = state.allocations.filter(value => value.status === "reserved" && value.workOrderId !== workOrderId)
      .flatMap(value => value.lines).filter(value => value.warehouseId === line.warehouseId && value.itemId === line.itemId);
    const available = Math.max(0, (balance?.quantity ?? 0) - reservations.reduce((sum, value) => sum + value.quantity, 0));
    for (const serial of line.serials) {
      const key = JSON.stringify([line.itemId, serial]);
      if (selectedSerials.has(key)) throw new InventoryError("The same serial cannot be used more than once.");
      selectedSerials.add(key);
      const occupied = state.serialOccupancy?.some(value => value.itemId === line.itemId && value.serial === serial);
      const elsewhere = state.stock.some(value => value.itemId === line.itemId && value.warehouseId !== line.warehouseId && value.serials.includes(serial));
      const held = state.shipmentHolds?.some(value => value.itemId === line.itemId && value.status === "held" && value.serials.includes(serial));
      const kitHeld = state.kitHolds?.some(value => value.itemId === line.itemId && value.status === "held" && value.serials.includes(serial));
      const reservedElsewhere = state.allocations.filter(value => value.status === "reserved" && value.workOrderId !== workOrderId)
        .flatMap(value => value.lines).some(value => value.itemId === line.itemId && value.serials.includes(serial));
      const transit = state.orders.some(value => value.type === "transfer" && value.dispatched.some(entry => entry.itemId === line.itemId && entry.serials.includes(serial)) &&
        ![...value.received, ...(value.losses ?? [])].some(entry => entry.itemId === line.itemId && entry.serials.includes(serial)));
      const returned = state.returns.some(value => value.serial === serial && value.status !== "released");
      if (occupied || elsewhere || held || kitHeld || reservedElsewhere || transit || returned)
        throw new InventoryError("Scanned serial is installed, reserved, held, in transit, or recorded at another location. Correct its custody before completion.");
    }
    const availableSerials = line.serials.filter(serial => balance?.serials.includes(serial) &&
      !reservations.some(value => value.serials.includes(serial)));
    const quantity = line.serials.length ? Math.min(available, availableSerials.length) : Math.min(available, line.quantity);
    if (quantity) debit.push({ ...line, quantity, serials: availableSerials.slice(0, quantity) });
    if (quantity < line.quantity) missing.push({ recordedAvailable: available,
      line: { ...line, quantity: line.quantity - quantity, serials: line.serials.filter(serial => !availableSerials.slice(0, quantity).includes(serial)) } });
  }
  return { debit, missing };
}
