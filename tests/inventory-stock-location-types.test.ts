import test from "node:test";
import assert from "node:assert/strict";
import { stockQuerySchema } from "../shared/inventory-stock-query";
import { stockOptions, stockPredicate } from "../server/inventoryStockQueries";
import { filterInventoryStockRows, initialStockFilters } from "../client/src/lib/inventory-stock-search";
import { stockBalanceExportRows, type StockBalanceRow } from "../client/src/lib/inventory-stock-export";
import { itemSchema } from "../shared/inventory";

const depotType = "50000000-0000-4000-8000-000000000001";
const vehicleType = "50000000-0000-4000-8000-000000000002";
const rows: StockBalanceRow[] = [depotType, vehicleType].map((locationTypeId, index) => ({
  itemId: "item", warehouseId: `w${index}`, quantity: 5, reserved: 1, revision: 1, serials: [],
  item: itemSchema.parse({ id: "item", name: "Meter", sku: "METER", tracking: "regular" }),
  warehouse: { id: `w${index}`, code: `W${index}`, name: `Location ${index}`,
    type: "physical", locationTypeId, locationTypeName: index ? "Secondary depot" : "Custom depot" },
}));

test("stock queries validate and parameterize stable project location-type IDs", () => {
  assert.equal(stockQuerySchema.parse({}).locationType, "all");
  assert.throws(() => stockQuerySchema.parse({ locationType: "warehouse" }));
  const { where, args } = stockPredicate(42, stockQuerySchema.parse({ locationType: depotType, warehouse: "w0" }));
  assert.match(where, /b.project_id=\$1/);
  assert.match(where, /w.location_type_id=\$3/);
  assert.deepEqual(args, [42, "w0", depotType]);
  assert.ok(!where.includes(depotType));
});

test("location type combines with individual location and clearing restores all balances", () => {
  const filtered = filterInventoryStockRows(rows, "", { ...initialStockFilters, locationType: depotType });
  assert.deepEqual(filtered.map(row => row.warehouseId), ["w0"]);
  assert.equal(filterInventoryStockRows(rows, "", { ...initialStockFilters, locationType: depotType, warehouse: "w1" }).length, 0);
  assert.equal(filterInventoryStockRows(rows, "", initialStockFilters).length, 2);
  assert.equal(stockBalanceExportRows(filtered)[0][7], "Custom depot");
});

test("type options are project-scoped, searchable relational choices, including empty types", async () => {
  const queries: Array<{ sql: string; args: unknown[] }> = [];
  const client = { query: async (sql: string, args: unknown[]) => {
    queries.push({ sql, args });
    return { rows: sql.includes("SELECT id,name FROM public.inventory_location_types") ? [{ id: depotType, name: "Empty custom depot" }] : [] };
  } };
  const result = await stockOptions(client as any, 42, "custom");
  assert.deepEqual(result.locationTypes, [{ id: depotType, name: "Empty custom depot" }]);
  const query = queries.find(query => query.sql.includes("inventory_location_types"))!;
  assert.match(query.sql, /project_id=\$1/); assert.match(query.sql, /LIMIT 200/);
  assert.deepEqual(query.args, [42, "%custom%"]);
  assert.ok(!query.sql.includes("EXISTS"), "Zero-stock project types remain selectable");
});
