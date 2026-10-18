import type { InventoryItem } from "./inventory";

export type LaborCharge = { itemId: string; sku: string; name: string; unit: string; quantity: number; cost: number; billingRate: number };
export const isLaborItem = (item: Pick<InventoryItem, "kind"> | undefined) => item?.kind === "labor";
export function kitLaborCharges(kit: InventoryItem, items: InventoryItem[], quantity = 1): LaborCharge[] {
  return kit.components.flatMap(component => {
    const item = items.find(item => item.id === component.itemId);
    return isLaborItem(item) && item ? [{ itemId: item.id, sku: item.sku, name: item.name, unit: item.unit,
      quantity: Math.round(component.quantity * quantity * 1000) / 1000, cost: item.cost, billingRate: item.billingRate ?? 0 }] : [];
  });
}
export function kitRecipeRates(kit: InventoryItem, items: InventoryItem[]) {
  return kit.components.reduce((sum, component) => {
    const item = items.find(item => item.id === component.itemId);
    return { cost: sum.cost + component.quantity * (item?.cost ?? 0),
      billingRate: sum.billingRate + component.quantity * (item?.billingRate ?? 0) };
  }, { cost: 0, billingRate: 0 });
}
