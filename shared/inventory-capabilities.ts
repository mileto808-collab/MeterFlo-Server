/** Existing action permissions control management surfaces; view/assign alone are field capabilities. */
export function inventoryCapabilities(can: (permission: string) => boolean) {
  const any = (...actions: string[]) => actions.some(action => can(`inventory.${action}`));
  const warehouse = any("configure", "maintain", "receive", "purchase", "transfer", "count", "assemble",
    "closeOrders", "resolveExceptions", "manageLocationTypes", "manageRemovalRules", "resolveReturns");
  const tabs = {
    stock: can("inventory.view"),
    locations: any("maintain", "manageLocationTypes"),
    items: any("maintain", "assemble", "resolveExceptions", "receive"),
    categories: can("inventory.maintain"),
    vendors: any("maintain", "purchase"),
    orders: any("purchase", "receive", "transfer", "closeOrders"),
    exceptions: can("inventory.resolveExceptions"),
    counts: can("inventory.count"),
    returns: any("receive", "resolveReturns", "manageRemovalRules"),
    activity: warehouse,
    "stock-discrepancies": can("inventory.resolveExceptions"),
  };
  return { tabs, warehouse, stats: warehouse,
    fulfillment: ["inventory.view", "workOrders.view", "inventory.assign", "inventory.receive", "inventory.transfer"].every(can) };
}
