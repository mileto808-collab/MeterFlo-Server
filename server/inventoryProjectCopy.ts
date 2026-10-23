import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { emptyInventory, type InventoryState } from "../shared/inventory";
import { initialLocationTypes, normalizeInventoryLocations } from "../shared/inventory-location-types";
import { storedCategoryState } from "./inventoryCategories";
import { readRelationalInventory, writeRelationalInventory } from "./inventoryRelational";
import { insertAuditEvent } from "./auditService";
import type { PoolClient } from "pg";
import { isCoreRemovalRule } from "../shared/inventory-removal-policy";

/** Copy definitions, never physical custody, assignments, work or source history. */
export function cleanInventoryCatalog(original: InventoryState, copyAccess = false): InventoryState {
  const source = storedCategoryState(normalizeInventoryLocations(structuredClone(original)));
  const identities = (rows: { id: string }[]) => new Map(rows.map(row => [row.id, randomUUID()]));
  const categories = identities(source.categoryCatalog ?? []);
  const vendors = identities(source.vendors), items = identities(source.items);
  const locations = identities(source.warehouses);
  const rules = new Map((source.removalRules ?? []).map(rule => [rule.id, isCoreRemovalRule(rule.id) ? rule.id : randomUUID()]));
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
      ...location, id: locations.get(location.id)!,
      locationTypeId: reference(types, location.locationTypeId!, "location type"),
      assignedUserId: copyAccess ? location.assignedUserId : null, userIds: copyAccess ? [...location.userIds] : [],
    })),
    categoryCatalog: (source.categoryCatalog ?? []).map(category => ({ ...category, id: categories.get(category.id)! })),
    vendors: source.vendors.map(vendor => ({ ...vendor, id: vendors.get(vendor.id)! })),
    items: source.items.map(item => ({
      ...item, id: items.get(item.id)!,
      categoryId: item.categoryId ? reference(categories, item.categoryId, "item category") : null,
      vendorId: item.vendorId ? reference(vendors, item.vendorId, "item vendor") : null,
      components: item.components.map(component => ({ ...component, itemId: reference(items, component.itemId, "kit component") })),
    })),
    typeLinks: (source.typeLinks ?? []).map(link => ({
      ...link, id: `${link.equipment}-${link.typeId}`, itemId: reference(items, link.itemId, "type-linked item"),
    })),
    fieldSettings: source.fieldSettings?.map(settings => ({ ...settings,
      warehouseId: settings.warehouseId ? reference(locations, settings.warehouseId, "field stock location") : null })),
    removalRules: source.removalRules?.map(rule => ({ ...rule, id: rules.get(rule.id)!, revision: 1 })),
    removalPolicies: source.removalPolicies?.map(policy => ({ ...policy, revision: 1 })),
    fieldRemovalChoices: source.fieldRemovalChoices?.map(choice => {
      const ruleId = reference(rules, choice.ruleId, "removal rule");
      return { ...choice, id: `${choice.equipment}:${ruleId}`, ruleId };
    }),
  });
}

export async function copyCleanProjectInventory(sourceId: number, destinationId: number, copyAccess = false, transaction?: PoolClient) {
  const client = transaction ?? await pool.connect();
  try {
    if (!transaction) await client.query("BEGIN");
    // Inventory commands and project deletion take these locks in the same order.
    const sourceProject = await client.query("SELECT id FROM public.projects WHERE id=$1 FOR SHARE", [sourceId]);
    if (!sourceProject.rowCount) throw new Error("Source project was removed before its inventory could be copied.");
    await client.query("SELECT project_id FROM public.inventory_state WHERE project_id=$1 FOR UPDATE", [sourceId]);
    const source = await readRelationalInventory(client, sourceId, { readOnly: true });
    const clean = cleanInventoryCatalog(source, copyAccess);
    await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2)", [destinationId, JSON.stringify(emptyInventory())]);
    await writeRelationalInventory(client, destinationId, clean);
    await insertAuditEvent(client, {
      action: "inventory.catalogCopied", entityType: "inventory", entityId: String(destinationId),
      projectId: destinationId, metadata: { sourceProjectId: sourceId, locations: clean.warehouses.length,
        items: clean.items.length, categories: clean.categoryCatalog?.length ?? 0, vendors: clean.vendors.length },
    });
    if (!transaction) await client.query("COMMIT");
    return { locations: clean.warehouses.length, items: clean.items.length, categories: clean.categoryCatalog?.length ?? 0,
      vendors: clean.vendors.length, typeLinks: clean.typeLinks?.length ?? 0,
      locationAssignments: clean.warehouses.reduce((total, row) => total + new Set([row.assignedUserId, ...row.userIds].filter(Boolean)).size, 0) };
  } catch (error) { if (!transaction) await client.query("ROLLBACK"); throw error; }
  finally { if (!transaction) client.release(); }
}
