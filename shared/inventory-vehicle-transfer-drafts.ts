import { z } from "zod";
import { vehicleTransferSchema } from "./inventory-vehicle-transfer";
import { InventoryError } from "./inventory-errors";
import type { InventoryCommand, InventoryState } from "./inventory";

const text = z.string().max(100).default("");
const record = (limit: number) => z.record(z.string().max(limit)).superRefine((value, ctx) => {
  if (Object.keys(value).length > 500 || Object.keys(value).some(key => key.length > 100) ||
      Object.values(value).reduce((sum, item) => sum + item.length, 0) > 1_010_000)
    ctx.addIssue({ code: "custom", message: "The handover draft exceeds the capture limit." });
});
export const vehicleTransferDraftCaptureSchema = z.object({
  mode: z.enum(["stock", "work"]), sourceId: text, destinationId: text, batchId: text,
  selectedOrders: z.array(z.string().regex(/^[1-9]\d*$/)).max(500).default([]),
  installerId: text, quantities: record(30).default({}), scans: record(1_010_000).default({}),
  reason: z.string().max(1000).default(""),
  batchRevision: z.number().int().positive().optional(),
  workOrders: z.array(z.object({ workOrderId: z.number().int().positive(),
    assignmentVersion: z.number().int().nonnegative() }).strict()).max(500).optional(),
}).strict().refine(value => new Set(value.selectedOrders).size === value.selectedOrders.length, "Choose each order once.");
export type VehicleTransferDraftCapture = z.infer<typeof vehicleTransferDraftCaptureSchema>;
export const vehicleTransferDraftCommandSchema = z.object({
  operationId: z.string().uuid(), action: z.literal("vehicleTransfer"), data: vehicleTransferSchema,
}).strict();
export const savedVehicleTransferDraftSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(),
  status: z.enum(["editing", "submitting", "posted", "deleted"]),
  createdBy: z.string().min(1).max(200), updatedBy: z.string().min(1).max(200),
  savedAt: z.string().datetime(), saveId: z.string().uuid(), capture: vehicleTransferDraftCaptureSchema,
  command: vehicleTransferDraftCommandSchema.optional(), receiptId: z.string().uuid().optional(),
}).strict();
export type SavedVehicleTransferDraft = z.infer<typeof savedVehicleTransferDraftSchema>;
export function meaningfulVehicleTransferDraft(capture: VehicleTransferDraftCapture) {
  return !!(capture.sourceId || capture.destinationId || capture.batchId || capture.selectedOrders.length ||
    capture.installerId || capture.reason.trim() || Object.values(capture.quantities).some(value => value.trim()) ||
    Object.values(capture.scans).some(value => value.trim()));
}
export const vehicleDraftConflict = (message: string) => Object.assign(new InventoryError(message), { status: 409 });

/** Shared draft identity, not browser identity, fences every late or duplicate submission. */
export function assertVehicleTransferDraftCommand(state: InventoryState, command: InventoryCommand,
  canonical: (value: unknown) => string) {
  if (!command.data.draftId) return;
  const draft = state.vehicleTransferDrafts?.find(value => value.id === command.data.draftId);
  if (!draft || !["submitting", "posted"].includes(draft.status) || !draft.command ||
      draft.command.data.draftRevision !== command.data.draftRevision ||
      canonical(draft.command) !== canonical(command))
    throw vehicleDraftConflict("This draft was changed, resolved, deleted or submitted with another request. Reopen its saved handover; the late request cannot move stock.");
}
export function completeVehicleTransferDraft(state: InventoryState, command: InventoryCommand, actor: string, now: string) {
  if (!command.data.draftId) return;
  const draft = state.vehicleTransferDrafts?.find(value => value.id === command.data.draftId);
  if (!draft) throw vehicleDraftConflict("The saved handover is no longer available.");
  draft.status = "posted";
  draft.receiptId = command.operationId;
  draft.revision++;
  draft.updatedBy = actor;
  draft.savedAt = now;
}
