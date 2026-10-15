import { itemSchema, vendorSchema, warehouseSchema } from "@shared/inventory";

export type InventoryResourceKind = "warehouse" | "vendor" | "item";
const fieldNames: Record<string, string> = {
  sku: "Product ID (SKU)", name: "Name", code: "Code", vin: "VIN", plate: "Plate",
  plateState: "Plate jurisdiction", address: "Street address", unit: "Unit",
  email: "Email", year: "Year", components: "Kit components",
};
export function validateInventoryResource(kind: InventoryResourceKind, data: unknown) {
  const result = ({ warehouse: warehouseSchema, vendor: vendorSchema, item: itemSchema }[kind]).safeParse(data);
  if (!result.success) throw new Error(result.error.issues.map(issue =>
    `${fieldNames[String(issue.path[0])] ?? String(issue.path[0])}: ${issue.message}`).join(" "));
  return result.data;
}

// Only known business errors are displayed. Never render proxy HTML, SQL errors,
// arbitrary server messages or fetch exception text in a customer-facing form.
const businessErrors = new Set([
  "SKU already exists.", "Warehouse code already exists.",
  "Vendor is not active in this project.", "Warehouse has stock or unresolved operations.",
  "Item has stock, reservations or open orders.",
  "Cannot change tracking or kit definition for stock/assigned items.",
  "Kit components cannot contain a cycle.", "Choose an active warehouse in this project.",
  "Warehouse access required.",
]);
export function inventoryResourceFailure(status: number, body: unknown) {
  if (status === 401) return "Your session has expired. Sign in again before saving.";
  if (status === 403) return "You no longer have permission to save these details. Contact an administrator.";
  const message = body && typeof body === "object" && "message" in body ? body.message : undefined;
  if (status === 409 && typeof message === "string" && businessErrors.has(message)) return message;
  if (status === 400 || status === 409) return "These details could not be accepted. Check the fields and current project stock rules, then retry.";
  return "The server could not confirm the save. Your entries are still here. Retry when the connection is available.";
}
