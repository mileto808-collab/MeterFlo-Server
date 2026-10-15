import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  stockSerialFilename, stockSerialPrintHtml, stockSerialText, stockSerialWorkbook,
} from "../client/src/lib/inventory-stock-serial-export";

const context = { project: "Test <Project>", sku: "MTR-01", item: "Meter & module", location: "Main warehouse", locationCode: "MAIN" };
const serials = ["00000001", "0001.2300", "AbC-009", "=1+2", "+009", "@serial", '0000<Id&"01">', "电表-00001"];

test("stock serial TXT preserves exact identity strings including leading zeros", () => {
  assert.equal(stockSerialText(serials), serials.join("\r\n") + "\r\n");
  assert.equal(stockSerialText([]), "");
  assert.equal(stockSerialFilename({ ...context, sku: "../../meter" }, "txt"), ".._.._meter-MAIN-serials.txt");
});

test("Excel export round-trips serials as text without formulas or numeric coercion", async () => {
  const before = structuredClone(serials);
  const workbook = await stockSerialWorkbook(context, serials);
  const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const restored = XLSX.read(bytes, { type: "buffer", cellNF: true });
  const sheet = restored.Sheets["Stock serials"];
  for (const [index, serial] of serials.entries()) {
    const cell = sheet[`A${index + 10}`];
    assert.equal(cell.v, serial);
    assert.equal(cell.t, "s");
    assert.equal(cell.z, "@");
    assert.equal(cell.f, undefined);
  }
  assert.deepEqual(serials, before);
});

test("PDF print view safely escapes text, repeats scoped headings and avoids external resources", () => {
  const html = stockSerialPrintHtml(context, serials);
  assert.ok(html.includes("Test &lt;Project&gt;"));
  assert.ok(html.includes("0000&lt;Id&amp;&quot;01&quot;&gt;"));
  assert.ok(html.includes("display:table-header-group"));
  assert.ok(html.includes("break-inside:avoid"));
  assert.ok(html.includes("including reserved units"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("https://"));
  assert.equal((html.match(/class="serial"/g) || []).length, serials.length);
});
