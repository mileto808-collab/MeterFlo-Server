export { acceptSerialScans as acceptFulfillmentScans } from "./serial-scans";
import { acceptSerialScans } from "./serial-scans";
import { checkFulfillmentSerials } from "@shared/inventory-fulfillment-scans";
import type { InventoryState } from "@shared/inventory";
import type { FulfillmentBatch } from "@shared/inventory-fulfillment";

/** Reject ineligible committed scans before applying the quantity cap; keep unfinished typing. */
export function acceptAvailableFulfillmentScans(state: InventoryState, batch: FulfillmentBatch,
  phase: "stage" | "vehicle", itemId: string, text: string, blocked: string[],
  commitLast: boolean, limit: number) {
  const parsed = acceptSerialScans(text, blocked, commitLast);
  const parts = parsed.text.split(/[\r\n,;\t]/);
  const trailing = parts.pop() ?? "";
  const serials = parts.map(part => part.trim()).filter(Boolean);
  const problems = checkFulfillmentSerials(state, batch, phase, [{ itemId, serials }]);
  const unavailable = new Set(problems.map(problem => problem.serial));
  const valid = serials.filter(serial => !unavailable.has(serial));
  const bounded = acceptSerialScans(valid.map(serial => `${serial}\n`).join("") + trailing, [], false, limit);
  return { ...bounded, rejected: parsed.rejected, problems };
}
