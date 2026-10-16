import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, itemSchema, commandPermission, inventoryPermissions } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { categoryDeletionBlockers, itemDeletionBlockers } from "../shared/inventory-deletion";

test("only empty catalog records can be deleted; replay and prior evidence remain safe", () => {
  const state = emptyInventory(), categoryId = randomUUID();
  state.categoryCatalog = [{ id: categoryId, name: "Unused category" }];
  state.items = [itemSchema.parse({ id: "empty", sku: "EMPTY", name: "Empty", tracking: "regular", categoryId, active: false })];
  state.stock = [{ warehouseId: "unused-location", itemId: "empty", quantity: 0, serials: [], revision: 0 }];
  const command = (action: "itemDelete" | "categoryDelete", id: string) => ({ operationId: randomUUID(), action, data: { id } });
  assert.equal(categoryDeletionBlockers(state, categoryId).length, 1, "inactive assignment still blocks");
  assert.throws(() => applyInventoryCommand(state, command("categoryDelete", categoryId)), /Assigned to 1 item/);
  const deletion = command("itemDelete", "empty");
  const deleted = applyInventoryCommand(state, deletion).state;
  assert.equal(deleted.items.length, 0);
  assert.equal(deleted.stock.length, 0);
  assert.equal(state.items.length, 1, "original state remains available as evidence");
  assert.equal(applyInventoryCommand(deleted, deletion).replay, true);
  assert.equal(applyInventoryCommand(deleted, command("categoryDelete", categoryId)).state.categoryCatalog!.length, 0);
  assert.throws(() => applyInventoryCommand(deleted, command("itemDelete", "missing")), /no longer exists/);
  assert.equal(commandPermission("itemDelete"), inventoryPermissions.maintain);
  assert.equal(commandPermission("categoryDelete"), inventoryPermissions.maintain);
});

test("all live and historical item references block deletion, including nested capture data", () => {
  const base = emptyInventory();
  base.items = [itemSchema.parse({ id: "used", sku: "USED", name: "Used", tracking: "regular" })];
  const fields = ["orders", "counts", "allocations", "receipts", "returns", "serialOccupancy",
    "shipmentHolds", "shipmentDrafts", "kitAssemblies", "kitHolds"] as const;
  for (const field of fields) {
    const state = structuredClone(base);
    (state as any)[field] = [{ nested: { rows: [{ itemId: "used" }] } }];
    assert.ok(itemDeletionBlockers(state, "used").length, field);
  }
  const stock = structuredClone(base);
  stock.stock = [{ warehouseId: "w", itemId: "used", quantity: 1, serials: [], revision: 0 }];
  assert.match(itemDeletionBlockers(stock, "used")[0], /stock/);
  const recipe = structuredClone(base);
  recipe.items.push(itemSchema.parse({ id: "kit", sku: "KIT", name: "Kit", tracking: "regular", components: [{ itemId: "used", quantity: 1 }] }));
  assert.match(itemDeletionBlockers(recipe, "used")[0], /kit recipe/);
});
