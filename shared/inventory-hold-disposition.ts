import { z } from "zod";
import { InventoryError } from "./inventory-errors";
import { remainingHold, holdDispositions, type ShipmentHold } from "./inventory-shipment-model";

const id = z.string().trim().min(1).max(100);
export const holdDispositionCommandSchema = z.object({
  id, outcome: z.enum(["released", "returned", "scrapped"]),
  reason: z.string().trim().min(1).max(1000), reference: z.string().trim().max(500).default(""),
  verifiedSerials: z.array(id).max(10000).default([]),
  quantity: z.number().int().positive().max(1000000).optional(),
  serials: z.array(id).max(10000).optional(),
  unidentifiedQuantity: z.number().int().nonnegative().max(1000000).optional(),
  expectedSerials: z.array(id).max(10000).optional(),
}).strict();
export type HoldDispositionCommand = z.infer<typeof holdDispositionCommandSchema>;
const check = (value: unknown, message: string) => { if (!value) throw new InventoryError(message); };

export function selectHoldDisposition(hold: ShipmentHold, serialized: boolean, d: HoldDispositionCommand) {
  const remaining = remainingHold(hold);
  const partial = d.quantity !== undefined;
  const quantity = d.quantity ?? remaining.quantity;
  const serials = partial ? d.serials ?? [] : remaining.serials;
  const unidentifiedQuantity = partial ? d.unidentifiedQuantity ?? 0 : remaining.unidentifiedQuantity;
  const expectedSerials = partial ? d.expectedSerials ?? [] : remaining.expectedSerials;
  check(partial || (d.serials === undefined && d.unidentifiedQuantity === undefined && d.expectedSerials === undefined),
    "Specify a quantity when selecting part of a hold.");
  check(quantity > 0 && quantity <= remaining.quantity, "Disposition quantity exceeds remaining held custody.");
  check(new Set([...serials, ...expectedSerials]).size === serials.length + expectedSerials.length,
    "Disposition identities must be unique.");
  check(serials.every(serial => remaining.serials.includes(serial)) &&
    expectedSerials.every(serial => remaining.expectedSerials.includes(serial)),
    "Select only identities still in this hold.");
  check(unidentifiedQuantity <= remaining.unidentifiedQuantity, "Unidentified quantity exceeds remaining held units.");
  check(serialized ? serials.length + unidentifiedQuantity === quantity :
    !serials.length && !unidentifiedQuantity && !expectedSerials.length,
    "Selected known serials plus unidentified units must equal disposition quantity.");
  check(hold.expectedSerials.length ? expectedSerials.length === unidentifiedQuantity : !expectedSerials.length,
    "Select one unverified dispatch reference for every unidentified transfer unit.");
  check(d.outcome !== "returned" || d.reference, "Return destination and shipment/reference are required.");
  if (d.outcome === "released") {
    check(serialized ? d.verifiedSerials.length === quantity && new Set(d.verifiedSerials).size === quantity :
      !d.verifiedSerials.length, "Quantity must match scanned serials: enter exactly one unique verified identity per released serialized unit.");
    check(serials.every(serial => d.verifiedSerials.includes(serial)), "Keep every selected already verified serial.");
    check(expectedSerials.every(serial => d.verifiedSerials.includes(serial)),
      "Verified identities must match the selected unverified dispatched identities.");
    check(d.verifiedSerials.every(serial => !hold.serials.includes(serial) || serials.includes(serial)) &&
      d.verifiedSerials.every(serial => !hold.expectedSerials.includes(serial) || expectedSerials.includes(serial)) &&
      !holdDispositions(hold).some(event => event.verifiedSerials.some(serial => d.verifiedSerials.includes(serial))),
      "An identity left quarantined or already disposed cannot be released for another selected unit.");
  } else check(!d.verifiedSerials.length, "Verified serials are supplied only when releasing to usable stock.");
  return { quantity, serials: [...serials], unidentifiedQuantity, expectedSerials: [...expectedSerials] };
}
