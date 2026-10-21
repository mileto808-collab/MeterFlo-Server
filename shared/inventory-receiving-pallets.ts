import { z } from "zod";
import type { StockLine } from "./inventory";

export const receivingPalletSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(100),
  expectedQuantity: z.number().int().min(1).max(10000),
  serials: z.array(z.string().trim().min(1).max(100)).max(10000),
  exceptionReason: z.string().max(1000).default(""),
}).strict();
export type ReceivingPallet = z.infer<typeof receivingPalletSchema>;
export const receiptPalletSchema = receivingPalletSchema.extend({ itemId: z.string().min(1).max(100) });
export type ReceiptPallet = z.infer<typeof receiptPalletSchema>;

/** Receiving evidence, not a stock container or another source of quantity. */
export function receivingPalletIssue(pallets: ReceiptPallet[], lines: StockLine[], requireComplete = true): string {
  const identities = new Set<string>(), labels = new Set<string>(), members = new Set<string>();
  const actual = new Map<string, Set<string>>();
  for (const line of lines) {
    const serials = actual.get(line.itemId) ?? new Set<string>();
    line.serials.forEach(serial => serials.add(serial));
    actual.set(line.itemId, serials);
  }
  for (const pallet of pallets) {
    if (identities.has(pallet.id)) return "Pallet group identities must be unique in this receipt.";
    identities.add(pallet.id);
    const label = JSON.stringify([pallet.itemId, pallet.label.trim().toLowerCase()]);
    if (labels.has(label)) return `Pallet ${pallet.label}: use a different pallet label for this item.`;
    labels.add(label);
    for (const serial of pallet.serials) {
      if (!actual.get(pallet.itemId)?.has(serial)) return `Pallet ${pallet.label}: a member is not among this item's captured good or damaged serials.`;
      if (members.has(serial)) return `Serial ${serial} belongs to more than one pallet group.`;
      members.add(serial);
    }
    if (requireComplete && pallet.serials.length !== pallet.expectedQuantity && pallet.exceptionReason.trim().length < 10)
      return `Pallet ${pallet.label}: ${pallet.serials.length} / ${pallet.expectedQuantity} scanned. Find the missing/extra scan or record a count-discrepancy reason (at least 10 characters).`;
  }
  return "";
}
