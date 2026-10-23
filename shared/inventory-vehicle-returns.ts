import { z } from "zod";
import type { InventoryState, Stock, StockLine } from "./inventory";
import { InventoryError } from "./inventory-errors";
import { isLaborItem } from "./inventory-pricing";
import { countStockScopeMatches } from "./inventory-count-stock";
import { isStagingType } from "./inventory-location-types";

export const vehicleReturnKinds = ["equipment", "count", "stock"] as const;
export const vehicleReturnKindSchema = z.enum(vehicleReturnKinds);
export type VehicleReturnKind = z.infer<typeof vehicleReturnKindSchema>;
const text = z.string().max(100).default("");
const record = z.record(z.string().max(200000)).superRefine((value, ctx) => {
  if (Object.keys(value).length > 500 || Object.keys(value).some(key => key.length > 100) ||
      Object.values(value).reduce((sum, row) => sum + row.length, 0) > 1000000)
    ctx.addIssue({ code: "custom", message: "This capture exceeds the supported scan limit." });
});
export const vehicleReturnCaptureSchema = z.object({
  kind: vehicleReturnKindSchema, sourceId: text, destinationId: text,
  itemIds: z.array(z.string().min(1).max(100)).max(500).default([]),
  returnIds: z.array(z.string().min(1).max(200)).max(500).default([]),
  quantities: z.record(z.string().max(30)).default({}), scans: record.default({}),
  reason: z.string().max(1000).default(""),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.itemIds).size !== v.itemIds.length || new Set(v.returnIds).size !== v.returnIds.length ||
      Object.keys(v.quantities).length > 500)
    ctx.addIssue({ code: "custom", message: "Choose each item or return only once." });
});
export type VehicleReturnCapture = z.infer<typeof vehicleReturnCaptureSchema>;
export const vehicleReturnCommandSchema = z.object({
  draftId: z.string().uuid(), draftRevision: z.number().int().positive(),
  physicallyConfirmed: z.literal(true),
}).strict();
export const savedVehicleReturnDraftSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(),
  status: z.enum(["editing", "submitting", "posted", "deleted"]),
  capture: vehicleReturnCaptureSchema,
  baseline: z.array(z.object({ warehouseId: z.string(), itemId: z.string(),
    quantity: z.number().int().nonnegative(), serials: z.array(z.string()), revision: z.number().int().nonnegative() })).default([]),
  createdBy: z.string(), updatedBy: z.string(), savedAt: z.string().datetime(), saveId: z.string().uuid(),
  command: z.object({ operationId: z.string().uuid(), action: z.literal("vehicleReturn"),
    data: vehicleReturnCommandSchema }).strict().optional(),
  receiptId: z.string().optional(),
}).strict();
export type SavedVehicleReturnDraft = z.infer<typeof savedVehicleReturnDraftSchema>;
export type VehicleReturnEvidence = {
  kind: VehicleReturnKind; sourceId: string; destinationId: string; countId?: string; needsReview?: boolean;
  equipment?: Array<{ id: string; serial: string; equipment: string; workOrderId: number }>;
  counts?: Array<{ itemId: string; expected: number; actual: number; missing: string[]; unexpected: string[] }>;
};
export const meaningfulVehicleReturn = (v: VehicleReturnCapture) => !!(v.sourceId || v.destinationId ||
  v.itemIds.length || v.returnIds.length || v.reason.trim() ||
  Object.values(v.quantities).some(x => x.trim()) || Object.values(v.scans).some(x => x.trim()));
export const scanTokens = (text: string) => text.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean);
export function vehicleReturnLines(state: InventoryState, capture: VehicleReturnCapture): StockLine[] {
  if (!capture.itemIds.length) throw new InventoryError("Choose at least one product.");
  return capture.itemIds.map(itemId => {
    const item = state.items.find(item => item.id === itemId && item.active && !isLaborItem(item));
    if (!item) throw new InventoryError("Select an active physical inventory item.");
    const raw = capture.quantities[itemId] ?? "";
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 1000000 ||
        capture.kind === "stock" && Number(raw) === 0)
      throw new InventoryError("Enter a whole physical quantity for every selected item.");
    const serials = scanTokens(capture.scans[itemId] ?? "");
    if (new Set(serials).size !== serials.length || serials.some(x => x.length > 100))
      throw new InventoryError("Duplicate or invalid serials must be corrected.");
    if (item.tracking === "serialized" && serials.length !== Number(raw))
      throw new InventoryError("Scan exactly one unique serial for each counted or returned unit.");
    if (item.tracking !== "serialized" && serials.length) throw new InventoryError("Bulk items do not accept serials.");
    return { itemId, quantity: Number(raw), serials };
  });
}
export function countDifferences(baseline: Stock[], lines: StockLine[]): NonNullable<VehicleReturnEvidence["counts"]> {
  return lines.map(line => {
    const prior = baseline.find(row => row.itemId === line.itemId);
    return { itemId: line.itemId, expected: prior?.quantity ?? 0, actual: line.quantity,
      missing: (prior?.serials ?? []).filter(x => !line.serials.includes(x)),
      unexpected: line.serials.filter(x => !prior?.serials.includes(x)) };
  });
}

export function assertVehicleReturnDraft(state: InventoryState, command: { operationId: string; action: string; data: any },
  canonical: (value: unknown) => string) {
  const input = vehicleReturnCommandSchema.parse(command.data);
  const draft = state.vehicleReturnDrafts?.find(row => row.id === input.draftId);
  if (!draft || !["submitting", "posted"].includes(draft.status) || !draft.command ||
      draft.command.data.draftRevision !== input.draftRevision || canonical(draft.command) !== canonical(command))
    throw new InventoryError("This return was changed, deleted or resolved. Reopen its saved draft; a late request cannot post.");
  return draft;
}

export function applyVehicleWarehouseReturn(state: InventoryState, command: { operationId: string; action: string; data: any },
  actor: string, now: string, tools: {
    canonical: (value: unknown) => string; access: (id: string) => void;
    move: (id: string, lines: StockLine[], sign: 1 | -1) => void;
  }) {
  const draft = assertVehicleReturnDraft(state, command, tools.canonical), capture = draft.capture;
  const vehicle = state.warehouses.find(row => row.id === capture.sourceId && row.active && row.type === "vehicle");
  if (!vehicle) throw new InventoryError("Choose an active source vehicle.");
  tools.access(vehicle.id);
  if (capture.reason.trim().length < 10) throw new InventoryError("Enter a reason or condition note of at least 10 characters.");
  const evidence: VehicleReturnEvidence = { kind: capture.kind, sourceId: vehicle.id, destinationId: capture.destinationId };
  let lines: StockLine[] = [];
  if (capture.kind !== "count") {
    const target = state.warehouses.find(row => row.id === capture.destinationId && row.active && row.type === "physical" &&
      (capture.kind === "stock" || !isStagingType(state.locationTypes?.find(type => type.id === row.locationTypeId))));
    if (!target) throw new InventoryError("Choose an active receiving warehouse or an eligible staging location.");
    tools.access(target.id);
  }
  if (capture.kind === "equipment") {
    if (!capture.returnIds.length) throw new InventoryError("Choose removed equipment to receive.");
    const records = capture.returnIds.map(id => {
      const row = state.returns.find(row => row.id === id);
      if (!row || row.status !== "pending" || row.disposition !== "returned")
        throw new InventoryError("Selected equipment is no longer pending warehouse return. Refresh before receiving.");
      if (row.warehouseId) tools.access(row.warehouseId);
      return row;
    });
    for (const equipment of ["system", "module"]) {
      const selected = records.filter(row => row.equipment === equipment).map(row => row.serial);
      const scanned = scanTokens(capture.scans[equipment] ?? "");
      if (new Set(selected).size !== selected.length)
        throw new InventoryError("Two selected returns share a serial and equipment type. Resolve their identities before receiving.");
      if (new Set(scanned).size !== scanned.length || selected.length !== scanned.length ||
          scanned.some(serial => !selected.includes(serial)))
        throw new InventoryError("Scan every selected removed item exactly once; unexpected equipment must be resolved first.");
    }
    evidence.equipment = records.map(row => ({ id: row.id, serial: row.serial, equipment: row.equipment, workOrderId: row.workOrderId }));
    for (const row of records) {
      const previousWarehouse = row.warehouseId;
      if (previousWarehouse && !row.fieldWarehouseId) row.fieldWarehouseId = previousWarehouse;
      row.status = "quarantine"; row.warehouseId = capture.destinationId;
      (row.history ??= []).push({ operationId: command.operationId, actor, occurredAt: now,
        outcome: "quarantine", reason: `${capture.reason.trim()} (Received from ${vehicle.name}; previous return location: ${previousWarehouse ?? "unspecified"})` });
    }
  } else {
    lines = vehicleReturnLines(state, capture);
    const serials = lines.flatMap(line => line.serials);
    if (new Set(serials).size !== serials.length) throw new InventoryError("A serial cannot be entered under more than one product.");
    if (capture.kind === "stock") {
      for (const line of lines) {
        tools.move(vehicle.id, [line], -1);
        tools.move(capture.destinationId, [line], 1);
      }
    } else {
      const baseline = draft.baseline.map(row => ({ ...row, revision: row.revision ?? 0 }));
      const counts = countDifferences(baseline, lines);
      if (!countStockScopeMatches({ id: draft.id, warehouseId: vehicle.id, status: "open", scope: "selected", snapshot: baseline },
        state.stock.filter(row => row.warehouseId === vehicle.id), capture.itemIds))
        throw new InventoryError("Vehicle stock changed after counting began. Keep these observations, start a fresh count and recount before submitting.");
      const needsReview = counts.some(row => row.expected !== row.actual || row.missing.length || row.unexpected.length);
      evidence.counts = counts; evidence.needsReview = needsReview; evidence.countId = command.operationId;
      state.counts.push({ id: command.operationId, warehouseId: vehicle.id, scope: "selected",
        snapshot: structuredClone(baseline), status: needsReview ? "open" : "posted",
        reason: capture.reason.trim(), ...(needsReview ? { draft: { revision: 1, savedBy: actor, savedAt: now,
          reason: capture.reason, rows: capture.itemIds.map(itemId => ({ itemId, quantity: capture.quantities[itemId],
            serials: capture.scans[itemId] ?? "" })) } } : { lines: structuredClone(lines) }) });
    }
  }
  state.receipts.push({ id: command.operationId, action: "vehicleReturn",
    reference: capture.kind === "equipment" ? "Removed equipment return" : capture.kind === "count" ? "Vehicle inventory verification" : "Vehicle stock return",
    sourceId: vehicle.id, warehouseId: capture.kind === "count" ? vehicle.id : capture.destinationId,
    lines, actor, occurredAt: now, reason: capture.reason.trim(), vehicleReturn: evidence });
  draft.status = "posted"; draft.receiptId = command.operationId; draft.updatedBy = actor;
  draft.savedAt = now; draft.revision++;
}
