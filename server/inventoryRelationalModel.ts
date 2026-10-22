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
  { name: "inventory_fulfillment_drafts", field: "fulfillmentDrafts",
    columns: { ...text("id", "name", "mode", "createdBy", "updatedBy", "savedAt"), revision: "integer" },
    json: ["capture"] },
  { name: "inventory_fulfillment_batches", field: "fulfillmentBatches",
    columns: { ...text("id", "name", "mode", "sourceId", "stagingId", "vehicleId", "status", "createdBy", "createdAt"), revision: "integer", pickupReady: "boolean" },
    children: [
      { name: "inventory_fulfillment_issues", paths: ["issues"],
        columns: { ...text("id", "itemId", "category", "description", "status", "reportedBy", "reportedAt", "resolvedBy", "resolvedAt", "resolution"),
          quantity: "integer" }, arrays: ["serials"] },
      { name: "inventory_fulfillment_work_orders", paths: ["workOrders"],
        columns: { workOrderId: "integer", assignmentVersion: "integer", label: "text",
          ...text("installerId", "installer", "scheduledDate") } },
      { name: "inventory_fulfillment_lines", paths: ["lines"],
        columns: { ...line, workOrderId: "integer", stagedQuantity: "integer", deliveredQuantity: "integer" },
        arrays: ["stagedSerials", "deliveredSerials"] },
    ] },
  { name: "inventory_work_plans", field: "workPlans", key: "workOrderId",
    columns: { workOrderId: "integer", revision: "integer", ...text("updatedBy", "updatedAt") },
    children: [{ name: "inventory_work_plan_lines", paths: ["lines"],
      columns: { ...text("id", "itemId", "kind", "reason"), quantity: "integer" } }] },
  { name: "inventory_stock_discrepancies", field: "stockDiscrepancies",
    columns: { ...text("id", "warehouseId", "itemId", "sourceReceiptId", "actor", "occurredAt", "status", "itemSku", "itemName", "locationName", "resolvedBy", "resolvedAt", "method", "reason", "evidence"),
      workOrderId: "integer", quantity: "integer", usedQuantity: "integer", recordedAvailable: "integer" },
    arrays: ["serials", "receiptIds"] },
  { name: "inventory_removal_rules", field: "removalRules",
    columns: { id: "uuid", ...text("name", "equipment", "stage", "outcome"), active: "boolean", revision: "integer" } },
  { name: "inventory_removal_policies", field: "removalPolicies",
    columns: { ...text("id"), revision: "integer", requireSystemReturn: "boolean", requireModuleReturn: "boolean" } },
  { name: "inventory_field_removal_choices", field: "fieldRemovalChoices", columns: { ...text("id", "equipment"), ruleId: "uuid" } },
  { name: "inventory_location_types", field: "locationTypes",
    columns: { id: "uuid", ...text("name", "kind", "accessPolicy"), revision: "integer" } },
  { name: "inventory_warehouses", field: "warehouses",
    columns: { ...text("id", "code", "name", "type", "address", "city", "state", "zip", "contact", "phone", "location", "vin", "plate", "plateState", "make", "model", "assignedUserId"), locationTypeId: "uuid", year: "integer", active: "boolean" },
    arrays: ["userIds"] },
  { name: "inventory_field_settings", field: "fieldSettings",
    columns: text("id", "sourceMode", "warehouseId", "fulfillment") },
  { name: "inventory_vendors", field: "vendors", columns: { ...text("id", "name", "contact", "address", "phone", "email", "reference"), active: "boolean" } },
  { name: "inventory_items", field: "items", columns: { ...text("id", "sku", "name", "description", "unit", "tracking", "equipment", "barcode", "manufacturer", "model", "vendorId", "kind"), categoryId: "uuid", cost: "double precision", billingRate: "numeric", reorderPoint: "double precision", active: "boolean" },
    arrays: ["images"], children: [{ name: "inventory_kit_recipe_lines", paths: ["components"], columns: { ...line, quantity: "numeric" } }] },
  { name: "inventory_type_links", field: "typeLinks",
    columns: { ...text("id", "equipment", "itemId"), typeId: "integer", systemTypeId: "integer", moduleTypeId: "integer" } },
  { name: "inventory_work_requirements", field: "workRequirements", key: "workOrderId",
    columns: { workOrderId: "integer" }, children: [
      { name: "inventory_work_requirement_lines", paths: ["lines", "automaticLines"], columns: line },
      { name: "inventory_work_requirement_missing", paths: ["missing"], columns: text("equipment", "typeId") },
    ] },
  { name: "inventory_orders", field: "orders", columns: { ...text("id", "type", "vendorId", "sourceId", "destinationId", "orderNumber", "reference", "status", "notes", "createdAt", "archivedAt", "replacementFor") },
    json: ["closure"], children: [{ name: "inventory_order_lines", paths: ["lines", "received", "dispatched", "losses", "closure.unfulfilled"], columns: line, arrays: ["serials"] }] },
  { name: "inventory_counts", field: "counts", columns: text("id", "warehouseId", "scope", "status", "reason"), json: ["draft"],
    children: [
      { name: "inventory_count_lines", paths: ["snapshot", "lines"], columns: { ...line, warehouseId: "text", revision: "integer" }, arrays: ["serials"] },
      { name: "inventory_count_draft_lines", paths: ["draft.rows"], columns: text("itemId", "quantity", "serials") },
    ] },
  { name: "inventory_allocations", field: "allocations", key: "workOrderId",
    columns: { workOrderId: "integer", ...text("mode", "status"), revision: "integer", assignmentVersion: "integer" }, json: ["dispositions"],
    children: [{ name: "inventory_allocation_lines", paths: ["lines", "used"], columns: { ...line, warehouseId: "text", reservationMode: "text" }, arrays: ["serials"] }] },
  { name: "inventory_receipts", field: "receipts", columns: text("id", "action", "reference", "warehouseId", "actor", "occurredAt", "reason", "holdId", "resolution", "externalReference", "kitHoldId", "sourceReceiptId"),
    json: ["holdDisposition", "kitConversion", "kitInspection", "stagingCorrection"],
    children: [{ name: "inventory_receipt_lines", paths: ["lines", "components", "damaged", "closedShort"], columns: { ...line, warehouseId: "text", unidentifiedQuantity: "integer", reason: "text" }, arrays: ["serials", "expectedSerials"] },
      { name: "inventory_receipt_pallets", paths: ["pallets"], columns: { ...text("id", "itemId", "label", "exceptionReason"), expectedQuantity: "integer" }, arrays: ["serials"] },
      { name: "inventory_receipt_labor", paths: ["labor"], columns: { ...text("itemId", "sku", "name", "unit"), quantity: "numeric", cost: "numeric", billingRate: "numeric" } }] },
  { name: "inventory_customer_handoffs", field: "customerHandoffs",
    columns: text("id", "warehouseId", "recipient", "reference", "reason", "verification", "actor", "occurredAt"),
    children: [{ name: "inventory_customer_handoff_lines", paths: ["lines"],
      columns: { ...text("returnId", "equipment", "serial", "verifiedSerial", "expectedOperationId"), workOrderId: "integer" } }] },
  { name: "inventory_returns", field: "returns", columns: { ...text("id", "equipment", "serial", "disposition", "warehouseId", "status", "itemId", "ruleName"),
    ...text("customerRecipient", "customerReference", "customerHandoffAt", "customerHandoffBy", "customerHandoffId"),
    ruleId: "uuid", ruleRevision: "integer", policyRevision: "integer", workOrderId: "integer" }, json: ["history"] },
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
