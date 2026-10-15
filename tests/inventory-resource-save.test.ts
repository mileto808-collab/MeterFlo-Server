import test from "node:test";
import assert from "node:assert/strict";
import { inventoryResourceFailure, validateInventoryResource } from "../client/src/lib/inventory-resource-save";

test("resource forms use the existing schemas and keep recognizable field names", () => {
  assert.throws(() => validateInventoryResource("item", { id: "test", sku: "", name: "", tracking: "regular" }), /Product ID \(SKU\).*Name/);
  assert.throws(() => validateInventoryResource("warehouse", { id: "test", code: "VAN", name: "Van", type: "vehicle", vin: "wrong" }), /VIN.*Plate/);
  assert.throws(() => validateInventoryResource("vendor", { id: "test", name: "Supplier", email: "bad" }), /Email/);
  const item = validateInventoryResource("item", { id: "test", sku: " 0001 ", name: " Product ", tracking: "regular" });
  assert.equal("sku" in item && item.sku, "0001");
  assert.equal(item.name, "Product");
});

test("known business conflicts remain useful while raw diagnostics never reach the form", () => {
  assert.equal(inventoryResourceFailure(409, { message: "SKU already exists." }), "SKU already exists.");
  assert.match(inventoryResourceFailure(409, { message: "Cannot change tracking or kit definition for stock/assigned items." }), /Cannot change tracking/);
  for (const status of [0, 400, 409, 500, 502])
    assert.doesNotMatch(inventoryResourceFailure(status, { message: "do-not-display-private-diagnostics" }), /private-diagnostics/);
  assert.match(inventoryResourceFailure(401, null), /session has expired/);
  assert.match(inventoryResourceFailure(403, null), /permission/);
});
