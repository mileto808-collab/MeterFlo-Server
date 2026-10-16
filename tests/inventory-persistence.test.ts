import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import type { PoolClient } from "pg";
import { pool } from "../server/db";
import { saveInventory } from "../server/inventoryService";
import { volumeState } from "./helpers/inventory-volume";

test("metadata posts write no balance mirrors; reservations, serial swaps and new zero rows still persist", async () => {
  const before = volumeState(0), after = structuredClone(before);
  const queries: { sql: string; values: any[] }[] = [];
  const client = { query: async (sql: string, values: any[]) => { queries.push({ sql, values }); return { rows: [] }; } } as unknown as PoolClient;
  const writes = (table: string) => queries.filter(q => q.sql.startsWith(`INSERT INTO public.${table}(`) || q.sql.startsWith(`INSERT INTO public.${table} (`));
  const balanceRows = () => writes("inventory_quantities").flatMap(query => JSON.parse(query.values[0]));
  try {
    after.revision++;
    await saveInventory(client, 1, before, after, "metadata", "countStart");
    assert.equal(writes("inventory_quantities").length, 0);
    assert.equal(writes("inventory_items").length, 0);
    assert.equal(writes("inventory_movements").length, 1);
    queries.length = 0;
    after.allocations.push({ workOrderId: 1, lines: [{ warehouseId: "w0", itemId: "i0", quantity: 1, serials: ["w0-i0-000000"] }],
      used: [], dispositions: [], status: "reserved", revision: 1, mode: null });
    after.stock.find(b => b.warehouseId === "w1" && b.itemId === "i0")!.serials[0] = "replacement-serial";
    after.stock.push({ warehouseId: "w0", itemId: "i99", quantity: 0, serials: [], revision: 1 });
    after.items[0].name = "Changed catalog label";
    await saveInventory(client, 1, before, after, "changed", "assign");
    assert.equal(balanceRows().length, 2, "reservation change and new zero row; same-quantity serial changes use serial relations");
    assert.equal(writes("inventory_items").length, 1);
    assert.equal(balanceRows().find(row => row.warehouse_id === "w0" && row.item_id === "i0")!.reserved, 1);
    const stockChanges = JSON.parse(writes("inventory_movements")[0].values[4]).stock;
    assert.equal(stockChanges.length, 2, "same audit semantics exclude unchanged zero quantity");
    assert.equal(stockChanges.find((c: any) => c.warehouseId === "w0").reservedAfter, 1);
    queries.length = 0;
    const released = structuredClone(after); released.allocations[0].status = "released";
    await saveInventory(client, 1, after, released, "released", "assign");
    assert.equal(writes("inventory_quantities").length, 1);
    assert.equal(balanceRows()[0].reserved, 0);
  } finally { await pool.end(); }
});
