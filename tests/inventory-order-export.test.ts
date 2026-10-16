import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { emptyInventory, itemSchema, warehouseSchema, type InventoryOrder } from "../shared/inventory";
import {
  downloadInventoryOrders, inventoryOrderCsv, inventoryOrderCsvCell, inventoryOrderExportRows,
  inventoryOrderPrintHtml, inventoryOrderWorkbook,
} from "../client/src/lib/inventory-order-export";

function fixture() {
  const state = emptyInventory();
  state.items = ["meter", "module"].map(id => itemSchema.parse({ id, sku: id === "meter" ? "000100" : "MOD-001",
    name: id === "meter" ? 'Meter <test> & "name"' : "Module", tracking: "regular" }));
  state.warehouses = ["main", "vehicle"].map(id => warehouseSchema.parse({
    id, code: id.toUpperCase(), name: `${id} location`, type: "physical", address: "Test only",
  }));
  const purchase: InventoryOrder = {
    id: "0000123", type: "purchase", orderNumber: "PO-2026-000001", reference: "=SUM(1,2)",
    sourceId: null, destinationId: "main", vendorId: null, status: "partial", notes: "",
    createdAt: "2026-10-15T12:00:00Z", dispatched: [],
    received: [{ itemId: "meter", quantity: 2, serials: [] }],
    lines: [{ itemId: "meter", quantity: 10, serials: [] }, { itemId: "module", quantity: 3, serials: [] }],
  };
  const transfer: InventoryOrder = {
    ...purchase, id: "transfer", orderNumber: "TR-2026-000001", reference: "", type: "transfer",
    sourceId: "main", destinationId: "vehicle",
    lines: [{ itemId: "meter", quantity: 10, serials: [] }],
    dispatched: [{ itemId: "meter", quantity: 6, serials: [] }],
    received: [{ itemId: "meter", quantity: 3, serials: [] }],
    losses: [{ itemId: "meter", quantity: 1, serials: [] }],
  };
  state.orders = [purchase, transfer, { ...purchase, id: "HIDDEN", orderNumber: "HIDDEN-ORDER" }];
  const context = { project: "Export <Project>", timezone: "America/Denver" };
  return { state, purchase, transfer, context };
}

test("order exports include all passed orders and product lines, not unrelated state orders", () => {
  const { state, purchase, transfer, context } = fixture(), before = structuredClone(state);
  const rows = inventoryOrderExportRows(context, [purchase, transfer], state);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].slice(9, 14), ["000100", 'Meter <test> & "name"', 10, 0, 2]);
  assert.equal(rows[0][17], 8);
  assert.equal(rows[2][16], 2, "In transit excludes arrivals and confirmed losses");
  assert.equal(rows[2][17], 6);
  assert.ok(String(rows[0][5]).includes("06:00"), "Dates use configured timezone");
  assert.ok(!JSON.stringify(rows).includes("HIDDEN"));
  assert.deepEqual(state, before);
});

test("CSV quotes delimiters/newlines and neutralizes spreadsheet formula injection", () => {
  const { state, purchase, context } = fixture();
  const csv = inventoryOrderCsv(context, [purchase], state);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes(`"'=SUM(1,2)"`));
  assert.ok(csv.includes(`"Meter <test> & ""name"""`));
  assert.equal(inventoryOrderCsvCell("a,\nb"), '"a,\nb"');
  assert.equal(inventoryOrderCsvCell(" \t=CMD()"), `"' \t=CMD()"`);
  assert.equal(inventoryOrderCsvCell(-3), '"-3"', "Real numeric quantities remain numeric, not formula text");
});

test("Excel export preserves text identities and keeps quantities numeric", async () => {
  const { state, purchase, context } = fixture();
  const workbook = await inventoryOrderWorkbook(context, [purchase], state);
  const restored = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer", cellNF: true });
  const sheet = restored.Sheets.Orders;
  assert.equal(sheet.C2.v, "0000123");
  assert.equal(sheet.C2.t, "s");
  assert.equal(sheet.J2.v, "000100");
  assert.equal(sheet.B2.v, "=SUM(1,2)");
  assert.equal(sheet.B2.f, undefined);
  assert.equal(sheet.L2.v, 10);
  assert.equal(sheet.L2.t, "n");
  assert.equal(restored.Sheets["Export details"].B1.v, context.project);
});

test("PDF view repeats readable identifiers, escapes content and omits raw technical IDs", () => {
  const { state, purchase, context } = fixture();
  const html = inventoryOrderPrintHtml(context, [purchase], state);
  assert.ok(html.includes("Export &lt;Project&gt;"));
  assert.ok(html.includes("Meter &lt;test&gt; &amp; &quot;name&quot;"));
  assert.ok(html.includes("PO-2026-000001"));
  assert.ok(!html.includes("0000123"));
  assert.ok(!html.includes("HIDDEN-ORDER"));
  assert.ok(html.includes("display:table-header-group"));
});

test("empty filtered export fails explicitly instead of falling back to every order", async () => {
  const { state, context } = fixture();
  for (const format of ["csv", "xlsx", "pdf"] as const)
    await assert.rejects(downloadInventoryOrders(format, context, [], state), /no matching orders/i);
});
