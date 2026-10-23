import type { InventoryState } from "./inventory";

/** Same authority as the work-order inventory panel; view/assign/plan alone do not grant pricing. */
export function canViewInventoryPricing(permissions: readonly string[], admin = false) {
  return admin || ["inventory.maintain", "inventory.configure", "inventory.purchase"]
    .some(permission => permissions.includes(permission));
}

/** Allowlist rather than deleting known secrets: future fields must be reviewed before exposure. */
export function inventoryCatalogItems(items: InventoryState["items"], pricing: boolean) {
  return items.map(item => ({
    id: item.id, sku: item.sku, name: item.name, description: item.description,
    category: item.category, categoryId: item.categoryId, unit: item.unit,
    tracking: item.tracking, equipment: item.equipment, kind: item.kind,
    barcode: item.barcode, manufacturer: item.manufacturer, model: item.model,
    reorderPoint: item.reorderPoint, active: item.active,
    images: [...(item.images ?? [])],
    components: (item.components ?? []).map(({ itemId, quantity }) => ({ itemId, quantity })),
    ...(pricing ? { cost: item.cost, billingRate: item.billingRate, vendorId: item.vendorId } : {}),
  }));
}
