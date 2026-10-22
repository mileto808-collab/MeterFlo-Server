import { z } from "zod";
import type { InventoryState } from "./inventory";
import type { FulfillmentBatch } from "./inventory-fulfillment";

/** Exclude this batch's own coverage, not other demand or physical custody. */
export function reassignmentDemandState(state: InventoryState, batch: FulfillmentBatch): InventoryState {
  const held = new Map<string, number>();
  for (const line of batch.lines) {
    const key = `${line.workOrderId}:${line.itemId}`;
    held.set(key, (held.get(key) ?? 0) + line.stagedQuantity - line.deliveredQuantity);
  }
  return { ...state, fulfillmentBatches: state.fulfillmentBatches?.filter(value => value.id !== batch.id),
    allocations: state.allocations.map(allocation => allocation.status !== "reserved" ? allocation : {
      ...allocation, lines: allocation.lines.map(line => {
        const key = `${allocation.workOrderId}:${line.itemId}`;
        if (line.warehouseId !== batch.stagingId) return line;
        const remove = Math.min(line.quantity, held.get(key) ?? 0);
        held.set(key, (held.get(key) ?? 0) - remove);
        return { ...line, quantity: line.quantity - remove };
      }).filter(line => line.quantity > 0),
    }) };
}

export const fulfillmentReassignSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  vehicleId: z.string().min(1).max(100),
  workOrders: z.array(z.object({
    workOrderId: z.number().int().positive(),
    assignmentVersion: z.number().int().nonnegative(),
  }).strict()).min(1).max(500),
  reason: z.string().trim().min(10).max(1000),
  confirmed: z.literal(true),
}).strict();

export type FulfillmentReassignmentReview = {
  batchId: string;
  revision: number;
  batchName: string;
  timezone: string;
  canApply: boolean;
  blockers: string[];
  warnings: string[];
  previousVehicle: { id: string; name: string; crew: string[] };
  staging: { id: string; name: string };
  installer: { id: string; name: string } | null;
  vehicles: { id: string; name: string }[];
  orders: {
    workOrderId: number; label: string; assignmentVersion: number; status: string;
    previousInstaller: string | null; currentInstaller: string;
    previousScheduledDate: string | null; currentScheduledDate: string;
  }[];
  items: {
    itemId: string; sku: string; name: string; unit: string;
    required: number; staged: number; delivered: number; remaining: number; serials: string[];
  }[];
};
