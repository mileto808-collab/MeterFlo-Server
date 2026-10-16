import test from "node:test";
import assert from "node:assert/strict";
import { inventoryResourceFailure, validateInventoryResource } from "../client/src/lib/inventory-resource-save";
import { copyInventoryItem } from "../client/src/lib/inventory-item-copy";
import { itemSchema } from "../shared/inventory";

test("copying an item preserves its definition but not its product identity or runtime extras", () => {
  const source = itemSchema.parse({id:"source",sku:"OLD",name:"Meter kit",tracking:"serialized",
    categoryId:"10000000-0000-4000-8000-000000000001",category:"Meters",vendorId:"vendor",
    barcode:"SCAN-OLD",description:"Details",manufacturer:"Maker",model:"Model",unit:"box",
    equipment:"system",cost:25,reorderPoint:4,active:false,images:["/item.png"],
    components:[{itemId:"component",quantity:2}]});
  const before = structuredClone(source);
  const copied = copyInventoryItem({...source,stock:[{quantity:50}],serials:["SERIAL"]} as any);
  assert.deepEqual(copied,{...source,id:"",sku:"",barcode:""});
  copied.components[0].quantity=3;
  copied.images.push("/other.png");
  assert.deepEqual(source,before,"editing the new draft cannot mutate its source");
  assert.equal("stock" in copied,false);
  assert.equal("serials" in copied,false);
});

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
