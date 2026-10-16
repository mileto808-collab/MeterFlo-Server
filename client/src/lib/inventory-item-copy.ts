import { itemSchema, type InventoryItem } from "@shared/inventory";

// Copy the catalog definition only. Barcode is deliberately cleared: reusing a
// product scan identifier for a different SKU would make item lookup ambiguous.
export function copyInventoryItem(source: InventoryItem): InventoryItem {
  const definition = itemSchema.parse(source);
  return { ...definition, id: "", sku: "", barcode: "" };
}
