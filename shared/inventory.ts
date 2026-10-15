import { z } from "zod";
import { COUNT_MAX_LINES } from "./inventory-count-limits";

export const inventoryPermissions = {
  configure: "inventory.configure", view: "inventory.view", maintain: "inventory.maintain",
  receive: "inventory.receive", purchase: "inventory.purchase", transfer: "inventory.transfer",
  count: "inventory.count", assign: "inventory.assign", assemble: "inventory.assemble",
};
const id = z.string().min(1).max(100);
const label = z.string().trim().min(1).max(200);
const optional = z.string().max(500).default("");
export const warehouseSchema = z.object({
  id, code: label, name: label, type: z.enum(["physical", "vehicle"]), active: z.boolean().default(true),
  address: optional, city: optional, state: optional, zip: optional, contact: optional,
  phone: optional, location: optional, vin: optional, plate: optional, plateState: optional,
  make: optional, model: optional, year: z.number().int().min(1900).max(2200).nullable().default(null),
  assignedUserId: id.nullable().default(null), userIds: z.array(id).default([]),
}).superRefine((w, ctx) => {
  if (w.type === "vehicle") {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(w.vin)) ctx.addIssue({ code: "custom", path: ["vin"], message: "Enter a valid 17-character VIN." });
    if (!w.plate || !w.plateState) ctx.addIssue({ code: "custom", path: ["plate"], message: "Plate and jurisdiction are required." });
  } else if (!w.address.trim()) ctx.addIssue({ code: "custom", path: ["address"], message: "Warehouse address is required." });
});
export const vendorSchema = z.object({ id, name: label, contact: optional, address: optional, phone: optional,
  email: z.string().email().or(z.literal("")).default(""), reference: optional, active: z.boolean().default(true) });
export const itemSchema = z.object({
  id, sku: label, name: label, description: optional, category: optional, unit: label.default("each"),
  tracking: z.enum(["regular", "serialized"]), equipment: z.enum(["none", "system", "module"]).default("none"),
  barcode: optional, manufacturer: optional, model: optional, vendorId: id.nullable().default(null),
  cost: z.number().finite().nonnegative().default(0), reorderPoint: z.number().finite().nonnegative().default(0),
  active: z.boolean().default(true), images: z.array(z.string().max(2000)).max(8).default([]),
  components: z.array(z.object({ itemId: id, quantity: z.number().int().positive().max(1000000) })).max(100).default([]),
});
export const stockLineSchema = z.object({ itemId: id, quantity: z.number().int().positive().max(1000000),
  serials: z.array(z.string().trim().min(1).max(100)).max(10000).default([]) }).strict();
export const allocationSchema = stockLineSchema.extend({ warehouseId: id });
export const inventoryImportSchema = z.preprocess(value => {
  if (typeof value === "string") {
    if (!value.trim()) return [];
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}, z.array(allocationSchema).max(500));
export const dispositionSchema = z.object({ equipment: z.enum(["system", "module"]), serial: id,
  disposition: z.enum(["returned", "scrapped", "left_onsite"]), warehouseId: id.nullable().default(null) }).strict();
// Preserve unfinished input verbatim; stock validation happens only when posting.
export const countDraftSchema = z.object({
  revision: z.number().int().nonnegative(),
  rows: z.array(z.object({ itemId: id, quantity: z.string().max(30), serials: z.string().max(1010000) }).strict()).max(COUNT_MAX_LINES),
  reason: z.string().max(1000),
}).strict();
export const savedCountDraftSchema = countDraftSchema.extend({
  savedBy: id, savedAt: z.string().datetime(),
});
export const inventoryCommandSchema = z.object({
  operationId: z.string().uuid(), action: z.enum(["warehouse", "vendor", "item", "order", "release",
    "cancel", "receive", "dispatch", "accept", "assemble", "countStart", "countPost", "countCancel", "countSaveDraft",
    "assign", "prepareUse", "returnAccept", "returnRelease", "reconcileWorkOrder"]),
  data: z.record(z.unknown()),
}).strict();
export type Warehouse = z.infer<typeof warehouseSchema>;
export type InventoryItem = z.infer<typeof itemSchema>;
export type Vendor = z.infer<typeof vendorSchema>;
export type StockLine = z.infer<typeof stockLineSchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type Disposition = z.infer<typeof dispositionSchema>;
export type InventoryCommand = z.infer<typeof inventoryCommandSchema>;
export type Stock = { warehouseId: string; itemId: string; quantity: number; serials: string[]; revision: number };
export type InventoryOrder = { id: string; type: "purchase" | "transfer"; vendorId: string | null; sourceId: string | null;
  destinationId: string; lines: StockLine[]; received: StockLine[]; dispatched: StockLine[]; status: "draft" | "released" | "partial" | "completed" | "cancelled"; notes: string; createdAt: string };
export type WorkAllocation = { workOrderId: number; lines: Allocation[]; used: Allocation[]; dispositions: Disposition[];
  mode: "changeout" | "reading_only" | null; status: "reserved" | "consumed" | "released"; revision: number };
export type InventoryCount = { id: string; warehouseId: string; snapshot: Stock[]; status: "open" | "posted" | "cancelled"; reason?: string; lines?: StockLine[]; draft?: z.infer<typeof savedCountDraftSchema> };
export type InventoryReceipt = { id: string; action: string; reference: string; warehouseId: string | null;
  lines: StockLine[]; actor: string; occurredAt: string; reason?: string; components?: StockLine[] };
export type EquipmentReturn = Disposition & { id: string; workOrderId: number; status: "pending" | "quarantine" | "released"; itemId?: string };
export type InventoryState = { warehouses: Warehouse[]; vendors: Vendor[]; items: InventoryItem[]; stock: Stock[];
  orders: InventoryOrder[]; counts: InventoryCount[]; allocations: WorkAllocation[];
  receipts: InventoryReceipt[]; returns: EquipmentReturn[]; operations: Record<string, string>; revision: number;
  serialOccupancy?: { itemId: string; serial: string; workOrderId: number | null }[] };
export const emptyInventory = (): InventoryState => ({ warehouses: [], vendors: [], items: [], stock: [], orders: [],
  counts: [], allocations: [], receipts: [], returns: [], operations: {}, revision: 0, serialOccupancy: [] });
export const commandPermission = (action: InventoryCommand["action"]) =>
  ["warehouse", "vendor", "item"].includes(action) ? inventoryPermissions.maintain :
  ["receive", "accept", "returnAccept", "returnRelease"].includes(action) ? inventoryPermissions.receive :
  action === "assemble" ? inventoryPermissions.assemble : action.startsWith("count") ? inventoryPermissions.count :
  action === "reconcileWorkOrder" ? inventoryPermissions.count :
  ["assign", "prepareUse"].includes(action) ? inventoryPermissions.assign : null;
