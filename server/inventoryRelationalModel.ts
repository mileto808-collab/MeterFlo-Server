/**
 * Explicit relational mapping for the existing inventory command model.
 * JSON columns here are editing captures or historical evidence, never stock,
 * order lines, recipes, count lines, or other live item relationships.
 */
type Columns = Record<string, string>;
export type ChildModel = { name: string; paths: string[]; columns: Columns; arrays?: string[] };
export type EntityModel = {
  name: string; field: string; key?: string; columns: Columns; json?: string[];
  arrays?: string[]; children?: ChildModel[];
};
const text = (...keys: string[]): Columns => Object.fromEntries(keys.map(key => [key, "text"]));
const line = { itemId: "text", quantity: "integer" };
export const relationalEntities: EntityModel[] = [
  { name: "inventory_warehouses", field: "warehouses",
    columns: { ...text("id", "code", "name", "type", "address", "city", "state", "zip", "contact", "phone", "location", "vin", "plate", "plateState", "make", "model", "assignedUserId"), year: "integer", active: "boolean" },
    arrays: ["userIds"] },
  { name: "inventory_vendors", field: "vendors", columns: { ...text("id", "name", "contact", "address", "phone", "email", "reference"), active: "boolean" } },
  { name: "inventory_items", field: "items", columns: { ...text("id", "sku", "name", "description", "unit", "tracking", "equipment", "barcode", "manufacturer", "model", "vendorId"), categoryId: "uuid", cost: "double precision", reorderPoint: "double precision", active: "boolean" },
    arrays: ["images"], children: [{ name: "inventory_kit_recipe_lines", paths: ["components"], columns: line }] },
  { name: "inventory_type_links", field: "typeLinks",
    columns: { ...text("id", "equipment", "itemId"), typeId: "integer", systemTypeId: "integer", moduleTypeId: "integer" } },
  { name: "inventory_work_requirements", field: "workRequirements", key: "workOrderId",
    columns: { workOrderId: "integer" }, children: [
      { name: "inventory_work_requirement_lines", paths: ["lines"], columns: line },
      { name: "inventory_work_requirement_missing", paths: ["missing"], columns: text("equipment", "typeId") },
    ] },
  { name: "inventory_orders", field: "orders", columns: { ...text("id", "type", "vendorId", "sourceId", "destinationId", "orderNumber", "reference", "status", "notes", "createdAt", "archivedAt", "replacementFor") },
    json: ["closure"], children: [{ name: "inventory_order_lines", paths: ["lines", "received", "dispatched", "losses", "closure.unfulfilled"], columns: line, arrays: ["serials"] }] },
  { name: "inventory_counts", field: "counts", columns: text("id", "warehouseId", "status", "reason"), json: ["draft"],
    children: [
      { name: "inventory_count_lines", paths: ["snapshot", "lines"], columns: { ...line, warehouseId: "text", revision: "integer" }, arrays: ["serials"] },
      { name: "inventory_count_draft_lines", paths: ["draft.rows"], columns: text("itemId", "quantity", "serials") },
    ] },
  { name: "inventory_allocations", field: "allocations", key: "workOrderId",
    columns: { workOrderId: "integer", ...text("mode", "status"), revision: "integer" }, json: ["dispositions"],
    children: [{ name: "inventory_allocation_lines", paths: ["lines", "used"], columns: { ...line, warehouseId: "text" }, arrays: ["serials"] }] },
  { name: "inventory_receipts", field: "receipts", columns: text("id", "action", "reference", "warehouseId", "actor", "occurredAt", "reason", "holdId", "resolution", "externalReference", "kitHoldId", "sourceReceiptId"),
    json: ["holdDisposition", "kitConversion", "kitInspection"],
    children: [{ name: "inventory_receipt_lines", paths: ["lines", "components", "damaged", "closedShort"], columns: { ...line, warehouseId: "text", unidentifiedQuantity: "integer", reason: "text" }, arrays: ["serials", "expectedSerials"] }] },
  { name: "inventory_returns", field: "returns", columns: { ...text("id", "equipment", "serial", "disposition", "warehouseId", "status", "itemId"), workOrderId: "integer" } },
  { name: "inventory_shipment_holds", field: "shipmentHolds", columns: { ...text("id", "itemId", "orderId", "receiptId", "warehouseId", "actor", "occurredAt", "status", "reason"), quantity: "integer", unidentifiedQuantity: "integer" },
    arrays: ["serials", "expectedSerials"], json: ["resolution", "dispositions"] },
  { name: "inventory_shipment_drafts", field: "shipmentDrafts", columns: { ...text("id", "orderId", "stage", "ownerId", "savedAt"), revision: "integer" }, json: ["capture", "pending"] },
  { name: "inventory_kit_assemblies", field: "kitAssemblies", columns: { ...text("id", "itemId", "warehouseId", "occurredAt", "source", "sourceReceiptId"), quantity: "integer", disassembledQuantity: "integer" },
    arrays: ["serials", "disassembledSerials"],
    children: [
      { name: "inventory_kit_contents", paths: ["components"], columns: line, arrays: ["serials"] },
      { name: "inventory_kit_positions", paths: ["positions"], columns: { ...text("kind", "id"), quantity: "integer" }, arrays: ["serials"] },
    ] },
  { name: "inventory_kit_holds", field: "kitHolds", columns: { ...text("id", "assemblyId", "receiptId", "itemId", "warehouseId", "reason", "status", "actor", "occurredAt"), quantity: "integer" }, arrays: ["serials"], json: ["resolution", "dispositions"] },
  { name: "inventory_serial_occupancy", field: "serialOccupancy", key: "_position", columns: { itemId: "text", serial: "text", workOrderId: "integer" } },
];
export const columnName = (field: string) => field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
export const arrayTable = (name: string) => `${name}_values`;
export const relationalTableNames = [
  "inventory_relational_projects", "inventory_order_counters", "inventory_operations",
  ...relationalEntities.map(model => model.name).filter(name => name !== "inventory_items"),
  "inventory_stock_serials",
  ...relationalEntities.flatMap(model => [
    ...(model.arrays?.length ? [arrayTable(model.name)] : []),
    ...(model.children ?? []).flatMap(child => [child.name, ...(child.arrays?.length ? [arrayTable(child.name)] : [])]),
  ]),
  "inventory_capture_item_refs",
];
