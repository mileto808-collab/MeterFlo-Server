import type { InventoryState } from "../shared/inventory";
import { normalizeInventoryLocations } from "../shared/inventory-location-types";
import { inventoryFromRelational, inventoryToRelational } from "./inventoryRelationalCodec";

/**
 * Upgrade only the new location relationships before public-table restoration.
 * Older dumps otherwise insert NULL type IDs before project restore gets a chance
 * to apply its supported compatibility adapter. Never seed shared access here.
 */
export function prepareLocationTypeRestore(backup: {
  mainDatabase: Record<string, any[]>;
  projectDatabases: Array<{ projectId: number; inventory?: { state: InventoryState } }>;
}) {
  for (const root of backup.mainDatabase.inventory_state ?? []) {
    const marker = backup.mainDatabase.inventory_relational_projects?.find(row => row.project_id === root.project_id);
    const project = backup.projectDatabases.find(project => project.projectId === root.project_id);
    const original = project?.inventory?.state ?? (marker
      ? inventoryFromRelational(new Map(Object.entries(backup.mainDatabase).map(([table, rows]) =>
        [table, rows.filter(row => row.project_id === root.project_id)])), marker.revision, marker.collections)
      : root.state);
    const state = normalizeInventoryLocations(original, "assigned");
    if (project?.inventory) project.inventory.state = state;
    const tables = inventoryToRelational(state, root.project_id);
    for (const table of ["inventory_location_types", "inventory_warehouses"]) {
      backup.mainDatabase[table] = [
        ...(backup.mainDatabase[table] ?? []).filter(row => row.project_id !== root.project_id),
        ...tables.get(table)!.rows,
      ];
    }
    if (marker) marker.collections = [...new Set([...marker.collections, "locationTypes"])];
  }
}
