import test from "node:test";
import assert from "node:assert/strict";
import { stockQuerySchema, serialQuerySchema } from "../shared/inventory-stock-query";
import { stockPredicate } from "../server/inventoryStockQueries";
import { stockBalanceExportRows } from "../client/src/lib/inventory-stock-export";
import { itemSchema, warehouseSchema } from "../shared/inventory";
import { collectStockExport } from "../client/src/lib/inventory-stock-api";

test("bounded queries reject invalid paging, sorts and repeated parameters", () => {
  for (const input of [{ limit: 101 }, { limit: 0 }, { offset: -1 }, { offset: 1.5 },
    { sort: "i.name;DROP TABLE" }, { q: ["one", "two"] }, { q: "x".repeat(301) }])
    assert.equal(stockQuerySchema.safeParse(input).success, false);
  assert.equal(serialQuerySchema.safeParse({ item: "x", warehouse: "w", limit: 1000 }).success, false);
  assert.equal(stockQuerySchema.parse({}).limit, 25);
});

test("all stock filters are project-scoped, parameterized and search wildcards are literal", () => {
  const query = stockQuerySchema.parse({ q: "  00%_\\';--  ", warehouse: "w' OR true--", category: "Meters",
    tracking: "serialized", availability: "available" });
  const { args, where } = stockPredicate(123, query);
  assert.deepEqual(args, [123, "%00\\%\\_\\\\';--%", "w' OR true--", "Meters", "serialized"]);
  assert.ok(where.includes("b.project_id=$1"));
  assert.ok(where.includes("s.project_id=b.project_id"));
  assert.ok(where.includes("b.quantity-b.reserved>0"));
  assert.ok(!where.includes(query.warehouse));
});

test("balance exports use the bounded serial count without requiring serial identities", () => {
  const cells = stockBalanceExportRows([{ itemId: "i", warehouseId: "w", quantity: 20000, reserved: 1, revision: 1,
    serials: [], serialCount: 20000, item: itemSchema.parse({ id: "i", sku: "0001", name: "Meter", tracking: "serialized" }),
    warehouse: warehouseSchema.parse({ id: "w", code: "W", name: "Warehouse", type: "physical", address: "Fixture" }) }]);
  assert.equal(cells[0].at(-1), 20000);
  assert.equal(cells[0].at(-2), 19999);
});

test("chunked exports preserve scope, exact serials, empty results and abort revision drift", async () => {
  const originalFetch = globalThis.fetch;
  const calls: URL[] = [];
  const serials = Array.from({ length: 201 }, (_, n) => String(n).padStart(12, "0"));
  let drift = false, empty = false;
  globalThis.fetch = async input => {
    const url = new URL(String(input), "https://fixture.invalid");
    calls.push(url);
    const offset = Number(url.searchParams.get("offset"));
    return new Response(JSON.stringify({ serials: empty ? [] : serials.slice(offset, offset + 100),
      total: 20000, filtered: empty ? 0 : serials.length, offset, revision: drift && offset ? 43 : 42 }));
  };
  try {
    const params = { warehouse: "w", item: "i", q: "00%_\\" };
    assert.deepEqual(await collectStockExport("/inventory", "/serials", params, "serials"), serials);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(url => url.searchParams.get("q") === params.q && url.searchParams.get("limit") === "100"));
    drift = true;
    await assert.rejects(collectStockExport("/inventory", "/serials", params, "serials"), /Stock changed/);
    empty = true;
    const before = calls.length;
    assert.deepEqual(await collectStockExport("/inventory", "/serials", params, "serials"), []);
    assert.equal(calls.length, before + 1, "An empty filtered export never retries as all");
  } finally { globalThis.fetch = originalFetch; }
});
