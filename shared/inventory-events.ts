// Notifications carry invalidation metadata only, never stock or private captures.
export const INVENTORY_EVENT_CHANNEL = "meterflo_inventory";
export type InventoryLiveEvent = {
  type: "inventory_updated" | "resync";
  projectId: number;
  revision?: number;
};

export function isInventoryQueryForProject(key: readonly unknown[], projectId: number): boolean {
  const base = `/api/projects/${projectId}/inventory`;
  const first = key[0];
  if (typeof first === "string") {
    if (first === base || first.startsWith(`${base}/`)) return true;
    if (first.startsWith(`/api/projects/${projectId}/work-orders/`) && first.endsWith("/inventory")) return true;
  }
  if (Array.isArray(first) && isInventoryQueryForProject(first, projectId)) return true;
  return first === "/api/projects" && String(key[1]) === String(projectId) &&
    (key[2] === "inventory" || (key[2] === "work-orders" && key[4] === "inventory"));
}
