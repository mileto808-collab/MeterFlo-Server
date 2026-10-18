import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { emptyInventory, type InventoryCommand, type InventoryState } from "../shared/inventory";
import { kitLaborCharges, kitRecipeRates } from "../shared/inventory-pricing";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { inventoryPrint } from "../server/inventoryPrint";
import { kitDisassemblyContents } from "../shared/inventory-kits";
import { matchesCountProduct, resolveCountProductScan } from "../client/src/lib/inventory-count-recovery";

function fixture() {
  let state: InventoryState = emptyInventory();
  const command = (action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) => {
    state = applyInventoryCommand(state, { action, data, operationId }, "fixture", true).state;
    return state;
  };
  command("warehouse", { id: "w", code: "W", name: "Pricing warehouse", type: "physical", address: "Fixture only" });
  command("vendor", { id: "v", name: "Pricing supplier" });
  command("item", { id: "part", sku: "PART", name: "Material", tracking: "regular", cost: 12, billingRate: 24 });
  command("item", { id: "labor", sku: "LAB", name: "Installation labor", kind: "labor", tracking: "regular", unit: "hour", cost: 22.5, billingRate: 65 });
  command("item", { id: "kit", sku: "KIT", name: "Installed kit", tracking: "regular",
    components: [{ itemId: "part", quantity: 2 }, { itemId: "labor", quantity: 1.5 }] });
  return { get state() { return state; }, command };
}

test("separate item cost and billing; fractional labor kit assembly never creates labor stock or recoverable contents", () => {
  const f = fixture();
  assert.deepEqual(kitRecipeRates(f.state.items.find(i => i.id === "kit")!, f.state.items), { cost: 57.75, billingRate: 145.5 });
  f.command("order", { id: "po", type: "purchase", destinationId: "w", vendorId: "v", lines: [{ itemId: "part", quantity: 6 }] });
  f.command("release", { orderId: "po" });
  f.command("receive", { orderId: "po", lines: [{ itemId: "part", quantity: 6 }] });
  const operationId = randomUUID(), payload = { warehouseId: "w", itemId: "kit", quantity: 2,
    components: [{ itemId: "part", quantity: 4, serials: [] }] };
  f.command("assemble", payload, operationId);
  assert.equal(f.state.stock.find(s => s.itemId === "part")!.quantity, 2);
  assert.equal(f.state.stock.find(s => s.itemId === "kit")!.quantity, 2);
  assert.ok(!f.state.stock.some(s => s.itemId === "labor"));
  const receipt = f.state.receipts.find(r => r.id === operationId)!;
  assert.deepEqual(receipt.labor, kitLaborCharges(f.state.items.find(i => i.id === "kit")!, f.state.items, 2));
  assert.equal(receipt.labor![0].quantity, 3);
  assert.equal(receipt.labor![0].billingRate, 65);
  assert.deepEqual(kitDisassemblyContents(f.state, operationId, 2, []), [{ itemId: "part", quantity: 4, serials: [] }]);
  f.command("item", { ...f.state.items.find(i => i.id === "labor")!, cost: 30, billingRate: 90 });
  f.command("assemble", payload, operationId);
  assert.equal(f.state.receipts.find(r => r.id === operationId)!.labor![0].billingRate, 65, "Replay preserves the historical rates");
  assert.equal(f.state.stock.find(s => s.itemId === "kit")!.quantity, 2);
  const html = inventoryPrint("receipt", receipt, f.state, "Fixture");
  assert.match(html, /Labor pricing snapshot/);
  assert.match(html, /65\.00/);
  assert.match(html, /not an invoice/);
});

test("labor is rejected by physical commands/count scanning and physical recipe quantities stay integral", () => {
  const f = fixture();
  assert.throws(() => f.command("order", { id: "bad", type: "purchase", destinationId: "w", vendorId: "v", lines: [{ itemId: "labor", quantity: 1 }] }), /non-stock/);
  assert.throws(() => f.command("countStart", { id: "bad-count", warehouseId: "w", scope: "selected", itemIds: ["labor"] }), /count products/);
  f.command("countStart", { id: "count", warehouseId: "w", scope: "selected" });
  assert.throws(() => f.command("countSaveDraft", { id: "count", revision: 0, reason: "", rows: [{ itemId: "labor", quantity: "1", serials: "" }] }), /physical stock/);
  assert.throws(() => f.command("item", { id: "bad-kit", sku: "BAD", name: "Bad kit", tracking: "regular", components: [{ itemId: "part", quantity: 1.5 }] }), /whole-number/);
  assert.throws(() => f.command("item", { id: "negative", sku: "NEG", name: "Bad price", tracking: "regular", billingRate: -1 }));
  assert.throws(() => f.command("item", { ...f.state.items.find(i => i.id === "labor"), tracking: "serialized" }), /Labor cannot/);
  const labor = f.state.items.find(i => i.id === "labor")!;
  assert.equal(matchesCountProduct(labor, ""), false);
  assert.ok("error" in resolveCountProductScan(f.state.items, "LAB", []));
});

test("numeric relational fields and immutable labor evidence round-trip; older editors preserve new fields", () => {
  const f = fixture(), labor = f.state.items.find(i => i.id === "labor")!;
  const { kind, billingRate, ...olderEditor } = labor;
  f.command("item", { ...olderEditor, name: "Updated labor label" });
  assert.equal(f.state.items.find(i => i.id === "labor")!.kind, kind);
  assert.equal(f.state.items.find(i => i.id === "labor")!.billingRate, billingRate);
  assert.throws(() => f.command("item", { ...labor, kind: "stock" }), /historical references/);
  const tables = inventoryToRelational(f.state, 1);
  // node-postgres returns NUMERIC as text; simulate it in this pure codec test.
  for (const table of tables.values()) for (const row of table.rows)
    for (const [column, type] of Object.entries(table.columns)) if (type === "numeric" && row[column] != null) row[column] = String(row[column]);
  const rows = new Map([...tables].map(([name, table]) => [name, table.rows]));
  const restored = inventoryFromRelational(rows, f.state.revision, Object.keys(f.state).filter(key => Array.isArray((f.state as any)[key])));
  assert.equal(restored.items.find(i => i.id === "labor")!.billingRate, 65);
  assert.equal(restored.items.find(i => i.id === "kit")!.components[1].quantity, 1.5);
});
