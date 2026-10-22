export function workOrderInventoryCapabilities(permissions: readonly string[], options: {
  enabled: boolean; editable: boolean; readingOnly: boolean; consumed: boolean; stockEditable?: boolean;
}) {
  const can = (key: string) => permissions.includes(key);
  const editable = options.enabled && options.editable && !options.readingOnly;
  const stockEditable = editable && options.stockEditable !== false;
  return {
    canPlan: editable && can("workOrders.view") && can("inventory.plan"),
    canOverridePlan: editable && can("workOrders.view") && can("inventory.plan") && can("inventory.overridePlan"),
    canReserve: stockEditable && can("workOrders.view") && can("inventory.view") && can("inventory.reserve"),
    canStage: stockEditable && ["workOrders.view", "inventory.view", "inventory.assign", "inventory.receive", "inventory.transfer"].every(can),
    // Managers may clear an old prepared changeout review on a reading-only
    // visit; the panel still hides replacement-use entry in that workflow.
    canReviewUse: options.enabled && options.editable && options.stockEditable !== false &&
      can("workOrders.view") && can("inventory.assign") && can("inventory.view") &&
      (can("inventory.maintain") || can("inventory.configure")),
    canReconcile: options.enabled && options.consumed && can("workOrders.view") && can("inventory.view") && can("inventory.count"),
  };
}
