import { z } from "zod";
import { receivingPalletSchema, receivingPalletIssue } from "./inventory-receiving-pallets";

const id = z.string().min(1).max(100);
export const shipmentStageSchema = z.enum(["receive", "dispatch", "accept"]);
export const shipmentCaptureSchema = z.object({
  entries: z.record(id, z.object({
    itemId: id, goodQuantity: z.string().max(30), damagedQuantity: z.string().max(30),
    unreadableQuantity: z.string().max(30), damageReason: z.string().max(1000),
    goodSerials: z.array(id).max(10000), damagedSerials: z.array(id).max(10000),
    expectedSerials: z.array(id).max(10000),
    pallets: z.array(receivingPalletSchema).max(200).optional(),
    activePalletId: z.string().uuid().nullable().optional(),
  }).strict().refine(row => !receivingPalletIssue((row.pallets ?? []).map(pallet => ({ ...pallet, itemId: row.itemId })),
    [{ itemId: row.itemId, quantity: row.goodSerials.length + row.damagedSerials.length, serials: [...row.goodSerials, ...row.damagedSerials] }], false) &&
      (!row.activePalletId || row.pallets?.some(pallet => pallet.id === row.activePalletId)), "Invalid pallet membership or active pallet."))
    .refine(rows => Object.keys(rows).length <= 500 &&
    Object.entries(rows).every(([key, row]) => key === row.itemId &&
      row.goodSerials.length + row.damagedSerials.length + row.expectedSerials.length <= 10000),
  "At most 500 matching product rows and 10,000 combined identities per product."),
  scanBuffers: z.record(z.string().min(1).max(130), z.string().max(1000))
    .refine(rows => Object.keys(rows).length <= 1000 &&
      Object.keys(rows).every(key => /^.{1,100}-(goodSerials|damagedSerials)$/.test(key)), "Invalid scanner buffer keys or too many buffers."),
  reason: z.string().max(1000), closeRemainder: z.boolean(),
}).strict();
export const savedShipmentDraftSchema = z.object({
  id: z.string().uuid(), orderId: id, stage: shipmentStageSchema,
  ownerId: id, savedAt: z.string().datetime(), revision: z.number().int().positive(),
  capture: shipmentCaptureSchema,
  pending: z.object({
    operationId: z.string().uuid(), payload: z.record(z.unknown()),
  }).strict().nullable(),
}).strict();
export type ShipmentCapture = z.infer<typeof shipmentCaptureSchema>;
export type SavedShipmentDraft = z.infer<typeof savedShipmentDraftSchema>;
export const blankShipmentCapture = (): ShipmentCapture => ({ entries: {}, scanBuffers: {}, reason: "", closeRemainder: false });
