import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inventoryToRelational, inventoryFromRelational, writeRelationalInventory } from "../server/inventoryRelationalCodec";
import { storedCategoryState } from "../server/inventoryCategories";
import { volumeState } from "./helpers/inventory-volume";

test("relational codec preserves live data, optional fields, empty lists and historical snapshots", () => {
  const state = storedCategoryState(volumeState(20));
  state.items[3].components = [{ itemId: "i1", quantity: 2 }];
  state.orders = [{
    id: "order", type: "purchase", vendorId: "vendor", sourceId: null, destinationId: "w0",
    lines: [{ itemId: "i0", quantity: 1, serials: ["serial"] }], received: [], dispatched: [],
    status: "closed", notes: "", createdAt: "2026-01-01T00:00:00.000Z",
    closure: { operationId: randomUUID(), actor: "fixture", reason: "Short", occurredAt: "2026-01-02T00:00:00.000Z", unfulfilled: [] },
  }];
  state.counts = [{ id: "count", warehouseId: "w0", status: "open", snapshot: state.stock.slice(0, 2),
    draft: { revision: 0, rows: [{ itemId: "i1", quantity: "", serials: "unfinished" }], reason: "", savedBy: "fixture", savedAt: "2026-01-01T00:00:00.000Z" } }];
  state.shipmentDrafts = [{ id: randomUUID(), orderId: "order", stage: "receive", ownerId: "fixture",
    savedAt: "2026-01-01T00:00:00.000Z", revision: 1, pending: null,
    capture: { entries: {}, scanBuffers: {}, reason: "", closeRemainder: false } }];
  const tables = inventoryToRelational(state, 1);
  const restored = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, structuredClone(table.rows)])), state.revision, Object.keys(state));
  assert.deepEqual(storedCategoryState(restored), state);
  assert.equal(tables.get("inventory_orders")!.rows[0].closure.unfulfilled, undefined, "Order lines are not retained in a JSON column");
  assert.equal(tables.get("inventory_counts")!.rows[0].draft.rows, undefined, "Count editing rows have item foreign keys");
  assert.equal(tables.get("inventory_items")!.rows[3].data.components, undefined);
  assert.equal(tables.get("inventory_kit_recipe_lines")!.rows[0].item_id, "i1");
  assert.equal(tables.get("inventory_stock_serials")!.rows.length, 12000);
});

test("codec refuses unmodelled fields instead of silently losing future data", () => {
  const state = volumeState(0);
  (state.items[0] as any).newRelationship = "unmapped";
  assert.throws(() => inventoryToRelational(state, 1), /mapping missing items.newRelationship/);
});

test("delta persistence updates changed relations only and never writes the shared JSON snapshot", async () => {
  const before = volumeState(1), after = structuredClone(before);
  after.revision++;
  after.items[0].name = "Changed";
  const queries: string[] = [];
  await writeRelationalInventory({ query: async (query: string) => { queries.push(query); return { rows: [] }; } } as any, 1, after, before);
  assert.equal(queries.filter(query => query.startsWith("INSERT INTO public.inventory_items ")).length, 1);
  assert.equal(queries.some(query => query.includes("INSERT INTO public.inventory_quantities ")), false);
  assert.equal(queries.some(query => /UPDATE public.inventory_state/.test(query)), false);
});

test("releasing an early occupied serial deletes shifted identities before unique-key upserts", async () => {
  const before = volumeState(1);
  before.serialOccupancy = ["P1", "P2", "P3"].map(serial => ({ itemId: "i1", serial, workOrderId: null }));
  const after = structuredClone(before);
  after.serialOccupancy!.shift();
  const queries: Array<{ sql: string; values: any[] }> = [];
  await writeRelationalInventory({ query: async (sql: string, values: any[]) => { queries.push({ sql, values }); return { rows: [] }; } } as any, 1, after, before);
  const remove = queries.findIndex(q => q.sql.startsWith("DELETE FROM public.inventory_serial_occupancy "));
  const insert = queries.findIndex(q => q.sql.startsWith("INSERT INTO public.inventory_serial_occupancy "));
  assert.ok(remove >= 0 && insert > remove);
  assert.equal(JSON.parse(queries[remove].values[1]).length, 3, "all conflicting positional keys are removed first");
});
