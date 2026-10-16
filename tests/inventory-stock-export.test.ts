import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { itemSchema, warehouseSchema } from "../shared/inventory";
import { downloadInventoryStock, stockBalanceCsv, stockBalanceExportRows, stockBalancePrintHtml,
  stockBalanceWorkbook, type StockBalanceRow } from "../client/src/lib/inventory-stock-export";
import { filterInventoryStockRows, initialStockFilters } from "../client/src/lib/inventory-stock-search";

const context = { project: "Stock <Project>", timezone: "America/Denver" };
const row: StockBalanceRow = {
  itemId: "item", warehouseId: "main", quantity: 10, reserved: 3, serials: ["00001", "PRIVATE-SERIAL"], revision: 1,
  item: itemSchema.parse({ id: "item", sku: "0000123", name: '=HYPERLINK("bad")', tracking: "serialized", category: "Meters" }),
  warehouse: warehouseSchema.parse({ id: "main", code: "00045", name: '<img src=x onerror="bad">', type: "physical", address: "Fixture" }),
};

test("balance export includes exactly the provided sorted scope, with reservation math and serial counts only", () => {
  const other = { ...row, warehouseId: "other", warehouse: { ...row.warehouse, code: "OTHER" }, quantity: 0, reserved: 0, serials: [] };
  const before = structuredClone([row, other]);
  const rows = stockBalanceExportRows([other, row]);
  assert.deepEqual(rows.map(value => value[5]), ["OTHER", "00045"]);
  assert.deepEqual(rows[1].slice(8), [10, 3, 7, 2]);
  assert.ok(!JSON.stringify(rows).includes("PRIVATE-SERIAL"));
  assert.deepEqual([row, other], before);
  assert.deepEqual(stockBalanceExportRows([]), []);
});

test("CSV quotes text, neutralizes formulas and keeps numeric quantities numeric", () => {
  const csv = stockBalanceCsv([{ ...row, quantity: -2 }]);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes(`"'=HYPERLINK(""bad"")"`));
  assert.ok(csv.includes('"-2","3","-5","2"'));
  assert.ok(csv.includes('"0000123"'));
  assert.ok(!csv.includes("PRIVATE-SERIAL"));
});

test("Excel round-trips leading-zero codes and formula-like values as exact text", async () => {
  const book = await stockBalanceWorkbook(context, [row]);
  const restored = XLSX.read(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellNF: true });
  const sheet = restored.Sheets["Stock balances"];
  assert.equal(sheet.A2.v, "0000123");
  assert.equal(sheet.F2.v, "00045");
  assert.equal(sheet.B2.v, row.item.name);
  assert.equal(sheet.B2.t, "s");
  assert.equal(sheet.B2.f, undefined);
  assert.equal(sheet.I2.t, "n");
  assert.equal(sheet.K2.v, 7);
  assert.ok(JSON.stringify(restored.Sheets["Export details"]).includes(context.timezone));
});

test("print HTML escapes user content, repeats project headings and never embeds serial lists", () => {
  const html = stockBalancePrintHtml(context, [row]);
  assert.ok(html.includes("Stock &lt;Project&gt;"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes("table-header-group"));
  assert.ok(html.includes(context.timezone));
  assert.ok(html.includes("Serial count"));
  assert.ok(!html.includes("PRIVATE-SERIAL"));
});

test("all zero-result downloads fail explicitly instead of exporting a different scope", async () => {
  for (const format of ["csv", "xlsx", "pdf"] as const) {
    await assert.rejects(downloadInventoryStock(format, context, []), /No matching stock/);
  }
});

test("stock search composes serial/location/category/tracking filters without changing the original scope", () => {
  const rows = [row, { ...row, warehouseId: "other", quantity: 0, reserved: 0,
    serials: [], warehouse: { ...row.warehouse, id: "other", name: "Other warehouse" },
    item: { ...row.item, tracking: "regular" as const, category: " Supplies " } }];
  const before = structuredClone(rows);
  assert.equal(filterInventoryStockRows(rows, "PRIVATE-serial", initialStockFilters).length, 1);
  assert.equal(filterInventoryStockRows(rows, "missing", initialStockFilters).length, 0);
  assert.equal(filterInventoryStockRows(rows, "Other warehouse", { ...initialStockFilters, warehouse: "main" }).length, 0);
  assert.equal(filterInventoryStockRows(rows, "", { ...initialStockFilters, category: "Supplies", tracking: "regular" }).length, 1);
  assert.deepEqual(filterInventoryStockRows(rows, "", { ...initialStockFilters, availability: "reserved" }), [row]);
  assert.equal(filterInventoryStockRows(rows, "", { ...initialStockFilters, availability: "out-of-stock" })[0].quantity, 0);
  assert.equal(filterInventoryStockRows(rows, "", { ...initialStockFilters, sort: "available-asc" })[0].quantity, 0);
  assert.equal(filterInventoryStockRows(rows, "", { ...initialStockFilters, availability: "available", sort: "available-desc" })[0].quantity, 10);
  assert.deepEqual(rows, before);
});
