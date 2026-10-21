import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { emptyInventory, type InventoryState } from "../shared/inventory";
import { initialLocationTypes, normalizeInventoryLocations } from "../shared/inventory-location-types";
import { storedCategoryState } from "./inventoryCategories";
import { readRelationalInventory, writeRelationalInventory } from "./inventoryRelational";
import { insertAuditEvent } from "./auditService";

/** Copy definitions, never physical custody, assignments, work or source history. */
export function cleanInventoryCatalog(original: InventoryState): InventoryState {
  const source = storedCategoryState(normalizeInventoryLocations(structuredClone(original)));
  const identities = (rows: { id: string }[]) => new Map(rows.map(row => [row.id, randomUUID()]));
  const categories = identities(source.categoryCatalog ?? []);
  const vendors = identities(source.vendors), items = identities(source.items);
  const standardTypes = new Set(initialLocationTypes().map(type => type.id));
  const types = new Map(source.locationTypes!.map(type => [type.id, standardTypes.has(type.id) ? type.id : randomUUID()]));
  const reference = (mapping: Map<string, string>, id: string, kind: string) => {
    const value = mapping.get(id);
    if (!value) throw new Error(`Cannot copy inventory: an ${kind} reference is missing.`);
    return value;
  };
  return storedCategoryState({
    ...emptyInventory(),
    locationTypes: source.locationTypes!.map(type => ({ ...type, id: types.get(type.id)!, revision: 1 })),
    warehouses: source.warehouses.map(location => ({
      ...location, id: randomUUID(),
      locationTypeId: reference(types, location.locationTypeId!, "location type"),
      assignedUserId: null, userIds: [],
    })),
    categoryCatalog: (source.categoryCatalog ?? []).map(category => ({ ...category, id: categories.get(category.id)! })),
    vendors: source.vendors.map(vendor => ({ ...vendor, id: vendors.get(vendor.id)! })),
    items: source.items.map(item => ({
      ...item, id: items.get(item.id)!,
      categoryId: item.categoryId ? reference(categories, item.categoryId, "item category") : null,
      vendorId: item.vendorId ? reference(vendors, item.vendorId, "item vendor") : null,
      components: item.components.map(component => ({ ...component, itemId: reference(items, component.itemId, "kit component") })),
    })),
  });
}

export async function copyCleanProjectInventory(sourceId: number, destinationId: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Inventory commands and project deletion take these locks in the same order.
    const sourceProject = await client.query("SELECT id FROM public.projects WHERE id=$1 FOR SHARE", [sourceId]);
    if (!sourceProject.rowCount) throw new Error("Source project was removed before its inventory could be copied.");
    await client.query("SELECT project_id FROM public.inventory_state WHERE project_id=$1 FOR UPDATE", [sourceId]);
    const source = await readRelationalInventory(client, sourceId, { readOnly: true });
    const clean = cleanInventoryCatalog(source);
    await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2)", [destinationId, JSON.stringify(emptyInventory())]);
    await writeRelationalInventory(client, destinationId, clean);
    await insertAuditEvent(client, {
      action: "inventory.catalogCopied", entityType: "inventory", entityId: String(destinationId),
      projectId: destinationId, metadata: { sourceProjectId: sourceId, locations: clean.warehouses.length,
        items: clean.items.length, categories: clean.categoryCatalog?.length ?? 0, vendors: clean.vendors.length },
    });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
