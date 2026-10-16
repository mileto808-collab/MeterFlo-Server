import assert from "node:assert/strict";
import test from "node:test";
import { itemSchema, vendorSchema } from "../shared/inventory";
import { catalogCsv, catalogExportRows, catalogPrintHtml, catalogWorkbook, downloadInventoryCatalog } from "../client/src/lib/inventory-catalog-export";

const vendor = vendorSchema.parse({ id: "v", name: "=Supplier", phone: "000123", reference: "00004" });
const item = itemSchema.parse({ id: "i", sku: "000123", name: "<Meter>", tracking: "regular", barcode: "00000001", vendorId: "v", cost: 2.5 });
const context = { project: "<Project>", timezone: "America/Denver" };

test("catalog exports preserve supplied order, exact identifiers, quantities and resolved vendor names", () => {
  const before = structuredClone(item);
  const rows = catalogExportRows("items", [item], [vendor]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][0], "000123");
  assert.equal(rows[0][7], "00000001");
  assert.equal(rows[0][10], "=Supplier");
  assert.equal(rows[0][11], 2.5);
  assert.deepEqual(item, before);
  assert.equal(catalogExportRows("vendors", [vendor], [vendor])[0][3], "000123");
});

test("CSV protects formula-like text and quotes values for both catalogs", () => {
  assert.match(catalogCsv("items", [item], [vendor]), /"'=Supplier"/);
  assert.match(catalogCsv("vendors", [vendor], [vendor]), /"'=Supplier"/);
  assert.match(catalogCsv("items", [item], [vendor]), /"000123"/);
});

test("Excel round trip keeps leading zeros and untrusted text as strings", async () => {
  const XLSX = await import("xlsx");
  for (const kind of ["items", "vendors"] as const) {
    const book = await catalogWorkbook(context, kind, kind === "items" ? [item] : [vendor], [vendor]);
    const restored = XLSX.read(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
    const sheet = restored.Sheets[restored.SheetNames[0]];
    if (kind === "items") {
      assert.equal(sheet.A2.v, "000123"); assert.equal(sheet.H2.v, "00000001");
      assert.equal(sheet.L2.v, 2.5); assert.equal(sheet.K2.f, undefined);
    } else {
      assert.equal(sheet.D2.v, "000123"); assert.equal(sheet.F2.v, "00004");
      assert.equal(sheet.A2.f, undefined);
    }
  }
});

test("print documents escape user content and repeat project/column headings", () => {
  const html = catalogPrintHtml(context, "items", [item], [vendor]);
  assert.ok(html.includes("&lt;Project&gt;"));
  assert.ok(html.includes("&lt;Meter&gt;"));
  assert.ok(html.includes("table-header-group"));
  assert.ok(!html.includes("<Meter>"));
  assert.ok(catalogPrintHtml(context, "vendors", [vendor], [vendor]).includes("Reference"));
});

test("all export formats explicitly reject zero matches", async () => {
  for (const kind of ["items", "vendors"] as const)
    for (const format of ["csv", "xlsx", "pdf"] as const)
      await assert.rejects(downloadInventoryCatalog(format, context, kind, [], [vendor]), /No matching/);
});
