import { z } from "zod";

const text = z.string().max(200).default("");
/** Editable setup only: saving a draft never reserves stock or submits a movement. */
export const fulfillmentDraftCaptureSchema = z.object({
  mode: z.enum(["crew", "scheduled"]),
  step: z.enum(["orders", "review"]),
  name: text,
  selectedIds: z.array(z.number().int().positive()).max(500).default([]),
  search: text, route: text, group: text, zone: text, installer: text, date: text,
  sourceId: text, stagingId: text, vehicleId: text,
}).strict();
export type FulfillmentDraftCapture = z.infer<typeof fulfillmentDraftCaptureSchema>;
export function emptyFulfillmentDraftCapture(mode: FulfillmentDraftCapture["mode"]): FulfillmentDraftCapture {
  return fulfillmentDraftCaptureSchema.parse({ mode, step: "orders" });
}
export const savedFulfillmentDraftSchema = z.object({
  id: z.string().uuid(),
  revision: z.number().int().positive(),
  name: z.string().max(200),
  mode: z.enum(["crew", "scheduled"]),
  createdBy: z.string().min(1).max(200),
  updatedBy: z.string().min(1).max(200),
  savedAt: z.string().datetime(),
  capture: fulfillmentDraftCaptureSchema,
}).strict();
export type SavedFulfillmentDraft = z.infer<typeof savedFulfillmentDraftSchema>;
export function meaningfulFulfillmentDraft(capture: FulfillmentDraftCapture) {
  return Boolean(capture.selectedIds.length || capture.name.trim() ||
    capture.sourceId || capture.stagingId || capture.vehicleId);
}
