import { z } from "zod";
import { COUNT_MAX_LINES } from "./inventory-count-limits";
import type { DamageLine, OrderClosure, ShipmentHold, HoldDisposition } from "./inventory-shipment-model";
import type { SavedShipmentDraft } from "./inventory-shipment-draft-model";
import type { InventoryCategory } from "./inventory-categories";
import type { KitAssembly, KitHold } from "./inventory-kits";
import type { InventoryLocationType } from "./inventory-location-types";
import type { RemovalRule, RemovalPolicy, FieldRemovalChoice } from "./inventory-removal-policy";
import type { FieldStockSettings } from "./inventory-field-stock";
import type { StockDiscrepancy } from "./inventory-stock-discrepancies";
import type { PlannedLine, WorkPlan } from "./inventory-planning";
import type { ReceiptPallet } from "./inventory-receiving-pallets";
import type { SavedFulfillmentDraft } from "./inventory-fulfillment-drafts";
import type { SavedVehicleTransferDraft } from "./inventory-vehicle-transfer-drafts";

export const inventoryPermissions = {
  configure: "inventory.configure", view: "inventory.view", maintain: "inventory.maintain",
  receive: "inventory.receive", purchase: "inventory.purchase", transfer: "inventory.transfer",
  count: "inventory.count", assign: "inventory.assign", assemble: "inventory.assemble",
  plan: "inventory.plan", overridePlan: "inventory.overridePlan", reserve: "inventory.reserve",
  closeOrders: "inventory.closeOrders", resolveExceptions: "inventory.resolveExceptions",
  manageLocationTypes: "inventory.manageLocationTypes",
  manageRemovalRules: "inventory.manageRemovalRules", resolveReturns: "inventory.resolveReturns",
};
const id = z.string().min(1).max(100);
const label = z.string().trim().min(1).max(200);
const optional = z.string().max(500).default("");
export const warehouseSchema = z.object({
  id, code: label, name: label, type: z.enum(["physical", "vehicle", "mobile"]),
  locationTypeId: z.string().uuid().optional(), active: z.boolean().default(true),
  address: optional, city: optional, state: optional, zip: optional, contact: optional,
  phone: optional, location: optional, vin: optional, plate: optional, plateState: optional,
  make: optional, model: optional, year: z.number().int().min(1900).max(2200).nullable().default(null),
  assignedUserId: id.nullable().default(null), userIds: z.array(id).default([]),
}).superRefine((w, ctx) => {
  if (w.type === "vehicle") {
    if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(w.vin)) ctx.addIssue({ code: "custom", path: ["vin"], message: "Enter a valid 17-character VIN." });
    if (!w.plate || !w.plateState) ctx.addIssue({ code: "custom", path: ["plate"], message: "Plate and jurisdiction are required." });
  } else if (w.type === "physical" && !w.address.trim()) ctx.addIssue({ code: "custom", path: ["address"], message: "Warehouse address is required." });
});
export const vendorSchema = z.object({ id, name: label, contact: optional, address: optional, phone: optional,
  email: z.string().email().or(z.literal("")).default(""), reference: optional, active: z.boolean().default(true) });
export const categoryNameSchema = z.string().trim().min(1, "Enter a category name.").max(500);
export const categoryKey = (name: string) => name.trim().toLowerCase();
export const itemSchema = z.object({
  id, sku: label, name: label, description: optional, category: optional, categoryId: z.string().uuid().nullable().optional(), unit: label.default("each"),
  tracking: z.enum(["regular", "serialized"]), equipment: z.enum(["none", "system", "module"]).default("none"),
  barcode: optional, manufacturer: optional, model: optional, vendorId: id.nullable().default(null),
  kind: z.enum(["stock", "labor"]).optional(),
  cost: z.number().finite().nonnegative().default(0), billingRate: z.number().finite().nonnegative().optional(),
  reorderPoint: z.number().finite().nonnegative().default(0),
  active: z.boolean().default(true), images: z.array(z.string().max(2000)).max(8).default([]),
  components: z.array(z.object({ itemId: id, quantity: z.number().finite().positive().max(1000000).multipleOf(0.001) })).max(100).default([]),
});
export const stockLineSchema = z.object({ itemId: id, quantity: z.number().int().positive().max(1000000),
  serials: z.array(z.string().trim().min(1).max(100)).max(10000).default([]) }).strict();
export const allocationSchema = stockLineSchema.extend({ warehouseId: id });
export const reservationSchema = allocationSchema.extend({ reservationMode: z.enum(["quantity", "serial"]).optional() });
export const inventoryImportSchema = z.preprocess(value => {
  if (typeof value === "string") {
    if (!value.trim()) return [];
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}, z.array(allocationSchema).max(500));
export const dispositionSchema = z.object({ equipment: z.enum(["system", "module"]), serial: id,
  disposition: z.enum(["returned", "scrapped", "left_onsite"]), warehouseId: id.nullable().default(null),
  ruleId: z.string().uuid().optional(), ruleRevision: z.number().int().positive().optional(),
  ruleName: z.string().max(200).optional(), policyRevision: z.number().int().positive().optional(),
}).strict();
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
  operationId: z.string().uuid(), action: z.enum(["fieldSettings", "warehouse", "locationType", "locationTypeDelete", "vendor", "item", "itemDelete", "category", "categoryRename", "categoryDelete", "order", "release",
    "cancel", "unrelease", "archiveOrder", "restoreOrder", "numberOrders", "receive", "dispatch", "accept", "assemble", "verifyVendorKit", "disassemble", "resolveKitHold", "countStart", "countPost", "countCancel", "countSaveDraft",
    "fulfillmentCreate", "fulfillmentMove", "fulfillmentClose", "fulfillmentReady", "fulfillmentReassign", "fulfillmentIssue", "fulfillmentCorrect", "fulfillmentInvestigate", "plan", "stageWorkOrder", "assign", "prepareUse", "returnAccept", "returnRelease", "returnDecide", "returnCustomerHandoff", "returnCustomerBatch", "returnCorrectDecision", "removalRule", "removalRuleDelete", "removalPolicy", "removalFieldChoices", "reconcileWorkOrder", "closeOrder", "resolveTransit", "resolveHold",
    "shipmentDraftSave", "shipmentDraftPrepare", "shipmentDraftUnlock", "shipmentDraftDelete", "shipmentDraftClaim", "typeLink", "resolveStockDiscrepancy", "vehicleTransfer"]),
  data: z.record(z.unknown()),
}).strict();
export type Warehouse = z.infer<typeof warehouseSchema>;
export type InventoryItem = z.infer<typeof itemSchema>;
export type Vendor = z.infer<typeof vendorSchema>;
export type StockLine = z.infer<typeof stockLineSchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type Reservation = z.infer<typeof reservationSchema>;
export type Disposition = z.infer<typeof dispositionSchema>;
export type InventoryCommand = z.infer<typeof inventoryCommandSchema>;
export type Stock = { warehouseId: string; itemId: string; quantity: number; serials: string[]; revision: number };
export type InventoryOrder = { id: string; type: "purchase" | "transfer"; vendorId: string | null; sourceId: string | null;
  orderNumber?: string; reference?: string;
  destinationId: string; lines: StockLine[]; received: StockLine[]; dispatched: StockLine[]; status: "draft" | "released" | "partial" | "completed" | "cancelled" | "closed"; notes: string; createdAt: string; archivedAt?: string;
  replacementFor?: string; losses?: StockLine[]; closure?: OrderClosure };
export type WorkAllocation = { workOrderId: number; lines: Reservation[]; used: Allocation[]; dispositions: Disposition[];
  mode: "changeout" | "reading_only" | null; status: "reserved" | "consumed" | "released"; revision: number; assignmentVersion?: number };
export type InventoryTypeLink = { id: string; equipment: "system" | "module"; typeId: number; itemId: string;
  systemTypeId?: number | null; moduleTypeId?: number | null };
export type WorkRequirements = { workOrderId: number; lines: { itemId: string; quantity: number }[];
  missing: { equipment: "system" | "module"; typeId: string }[];
  automaticLines?: { itemId: string; quantity: number }[]; manualLines?: PlannedLine[]; planRevision?: number };
export type InventoryCount = { id: string; warehouseId: string; scope?: "selected" | "warehouse"; snapshot: Stock[]; status: "open" | "posted" | "cancelled"; reason?: string; lines?: StockLine[]; draft?: z.infer<typeof savedCountDraftSchema> };
export type InventoryReceipt = { id: string; action: string; reference: string; warehouseId: string | null;
  fulfillmentDeletion?: { batch: import("./inventory-fulfillment").FulfillmentBatch; deletedBy: string; deletedAt: string };
  stagingCorrection?: import("./inventory-staging-corrections").StagingCorrectionEvidence;
  pallets?: ReceiptPallet[];
  lines: StockLine[]; actor: string; occurredAt: string; reason?: string; components?: StockLine[];
  labor?: import("./inventory-pricing").LaborCharge[];
  sourceId?: string;
  workOrderIds?: number[];
  damaged?: DamageLine[]; holdId?: string; resolution?: string; externalReference?: string; closedShort?: StockLine[]; sourceReceiptId?: string;
  holdDisposition?: HoldDisposition; kitHoldId?: string; kitInspection?: StockLine;
  kitConversion?: { assemblyId: string; recovered: Array<import("./inventory-kits").KitRecovery> } };
export type EquipmentReturn = Disposition & { id: string; workOrderId: number; status: "pending" | "quarantine" | "released" | "scrapped" | "left_onsite" | "customer_pending" | "customer_returned"; itemId?: string;
  customerRecipient?: string; customerReference?: string; customerHandoffAt?: string; customerHandoffBy?: string; customerHandoffId?: string;
  history?: Array<{ operationId: string; actor: string; occurredAt: string; outcome: string; reason: string; ruleId?: string; ruleRevision?: number; ruleName?: string;
    recipient?: string; reference?: string; previousStatus?: string; physicallyPresent?: boolean; handoffId?: string }> };
export type InventoryState = { warehouses: Warehouse[]; vendors: Vendor[]; items: InventoryItem[]; stock: Stock[];
  fulfillmentBatches?: import("./inventory-fulfillment").FulfillmentBatch[];
  customerHandoffs?: import("./inventory-customer-handoffs").CustomerHandoff[];
  fieldSettings?: FieldStockSettings[];
  locationTypes?: InventoryLocationType[];
  removalRules?: RemovalRule[]; removalPolicies?: RemovalPolicy[];
  fieldRemovalChoices?: FieldRemovalChoice[];
  stockDiscrepancies?: StockDiscrepancy[];
  typeLinks?: InventoryTypeLink[]; workRequirements?: WorkRequirements[]; workPlans?: WorkPlan[];
  categories?: string[];
  categoryCatalog?: InventoryCategory[];
  orderNumberCounters?: Record<string, number>;
  orders: InventoryOrder[]; counts: InventoryCount[]; allocations: WorkAllocation[];
  receipts: InventoryReceipt[]; returns: EquipmentReturn[]; operations: Record<string, string>; revision: number;
  serialOccupancy?: { itemId: string; serial: string; workOrderId: number | null }[];
  shipmentHolds?: ShipmentHold[]; shipmentDrafts?: SavedShipmentDraft[]; fulfillmentDrafts?: SavedFulfillmentDraft[];
  vehicleTransferDrafts?: SavedVehicleTransferDraft[];
  kitAssemblies?: KitAssembly[]; kitHolds?: KitHold[] };
export const emptyInventory = (): InventoryState => ({ warehouses: [], vendors: [], categories: [], items: [], stock: [], orders: [],
  counts: [], allocations: [], receipts: [], returns: [], operations: {}, revision: 0, serialOccupancy: [], shipmentHolds: [] });
export const commandPermission = (action: InventoryCommand["action"]) =>
  action === "vehicleTransfer" ? inventoryPermissions.transfer :
  action === "plan" ? inventoryPermissions.plan :
  action === "assign" ? inventoryPermissions.reserve :
  action === "fieldSettings" ? inventoryPermissions.configure :
  ["removalRule", "removalRuleDelete", "removalPolicy", "removalFieldChoices"].includes(action) ? inventoryPermissions.manageRemovalRules :
  ["returnRelease", "returnDecide", "returnCustomerHandoff", "returnCustomerBatch", "returnCorrectDecision"].includes(action) ? inventoryPermissions.resolveReturns :
  ["locationType", "locationTypeDelete"].includes(action) ? inventoryPermissions.manageLocationTypes :
  action === "closeOrder" ? inventoryPermissions.closeOrders :
  ["resolveTransit", "resolveHold", "resolveKitHold"].includes(action) ? inventoryPermissions.resolveExceptions :
  ["archiveOrder", "restoreOrder"].includes(action) ? inventoryPermissions.purchase :
  ["warehouse", "vendor", "item", "itemDelete", "category", "categoryRename", "categoryDelete", "numberOrders", "typeLink"].includes(action) ? inventoryPermissions.maintain :
   ["receive", "accept", "returnAccept", "verifyVendorKit"].includes(action) ? inventoryPermissions.receive :
  ["assemble", "disassemble"].includes(action) ? inventoryPermissions.assemble : action.startsWith("count") ? inventoryPermissions.count :
  action === "reconcileWorkOrder" ? inventoryPermissions.count :
  action === "resolveStockDiscrepancy" ? inventoryPermissions.resolveExceptions :
  action === "stageWorkOrder" || action.startsWith("fulfillment") ? inventoryPermissions.transfer :
  ["plan", "assign", "prepareUse"].includes(action) ? inventoryPermissions.assign : null;

// Legacy free-text category values remain selectable without a destructive migration.
export function inventoryCategoryNames(state: Pick<InventoryState, "categories" | "categoryCatalog" | "items">): string[] {
  if (state.categoryCatalog !== undefined) return state.categoryCatalog.map(c => c.name).sort((a, b) => a.localeCompare(b));
  const names = new Map<string, string>();
  for (const name of [...(state.categories ?? []), ...state.items.map(item => item.category)]) {
    const key = categoryKey(name);
    if (key && !names.has(key)) names.set(key, name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}
