import assert from "node:assert/strict";
import { emptyInventory, itemSchema, vendorSchema, warehouseSchema, type InventoryState } from "../../shared/inventory";
import { reserved } from "../../shared/inventory-engine";

// Synthetic historical data, never copied from a customer project.
export const volume = { warehouses: 40, items: 100, balancesPerWarehouse: 30, history: 10_000, shipment: 10_000,
  workers: 8, countRounds: 6, transferRounds: 4 };
export function volumeState(history = volume.history): InventoryState {
  const s = emptyInventory();
  s.vendors = [vendorSchema.parse({ id: "vendor", name: "Synthetic supplier" })];
  s.items = Array.from({ length: volume.items }, (_, n) => itemSchema.parse({
    id: `i${n}`, sku: `SKU-${String(n).padStart(4, "0")}`, name: `Synthetic item ${n}`,
    tracking: n % 10 === 0 ? "serialized" : "regular",
  }));
  s.warehouses = Array.from({ length: volume.warehouses }, (_, n) => warehouseSchema.parse({
    id: `w${n}`, code: `W-${n}`, name: `Synthetic warehouse ${n}`, type: "physical", address: "Test fixture only",
  }));
  for (const w of s.warehouses) for (const i of s.items.slice(0, volume.balancesPerWarehouse)) {
    const serials = i.tracking === "serialized" ? Array.from({ length: 100 }, (_, n) => `${w.id}-${i.id}-${String(n).padStart(6, "0")}`) : [];
    s.stock.push({ warehouseId: w.id, itemId: i.id, quantity: serials.length || 1000, serials, revision: 1 });
  }
  for (let n = 0; n < history; n++) {
    const id = `historical-${n}`;
    s.operations[id] = `synthetic-fingerprint-${n}`;
    s.receipts.push({ id, action: "receive", reference: `historical-order-${n}`, warehouseId: `w${n % volume.warehouses}`,
      lines: [{ itemId: "i1", quantity: 1, serials: [] }], actor: "synthetic-history", occurredAt: "2026-01-01T00:00:00.000Z" });
  }
  s.revision = history;
  return s;
}

export function assertInventoryInvariants(s: InventoryState) {
  const serials = new Set<string>(), balances = new Set<string>(), held = new Set<string>();
  for (const b of s.stock) {
    const key = `${b.warehouseId}/${b.itemId}`;
    assert.ok(!balances.has(key), `unique balance ${key}`); balances.add(key);
    assert.ok(Number.isSafeInteger(b.quantity) && b.quantity >= 0);
    assert.ok(reserved(s, b.warehouseId, b.itemId) <= b.quantity, `reservation fits ${key}`);
    if (s.items.find(i => i.id === b.itemId)?.tracking === "serialized") assert.equal(b.quantity, b.serials.length);
    for (const serial of b.serials) {
      const key = `${b.itemId}/${serial}`;
      assert.ok(!serials.has(key), `unique serial ${key}`); serials.add(key);
    }
  }
  for (const a of s.allocations.filter(a => a.status === "reserved")) for (const l of a.lines) {
    const b = s.stock.find(b => b.warehouseId === l.warehouseId && b.itemId === l.itemId);
    assert.ok(b);
    for (const serial of l.serials) {
      assert.ok(b.serials.includes(serial));
      const key = `${l.itemId}/${serial}`;
      assert.ok(!held.has(key), "serial reserved only once"); held.add(key);
    }
  }
  for (const o of s.serialOccupancy || []) assert.ok(!serials.has(`${o.itemId}/${o.serial}`), "installed serial not in stock");
}
