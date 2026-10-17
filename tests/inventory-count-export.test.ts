import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { countEntriesCsv, countEntriesWorkbook, countEntriesPrintHtml, type CountExportRow, type CountExportContext } from "../client/src/lib/inventory-count-export";

const context: CountExportContext = { project: "Electric demo", location: "Main warehouse", countReference: "Count #7", scope: "selected", exportScope: "Filtered entries" };
const rows: CountExportRow[] = [
  { sku: "00012", name: 'Meter, "test" <script>alert(1)</script>', tracking: "serialized", expected: 3, actual: "", serials: "000001\n000002\nincomplete" },
  { sku: "=CMD()", name: "+unsafe", tracking: "regular", expected: 8, actual: "0004", serials: "" },
];

test("count CSV retains unsaved blanks and exact serial captures while escaping CSV and formula text", () => {
  const csv = countEntriesCsv(rows);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.ok(csv.includes('"00012"'));
  assert.ok(csv.includes('"3","","000001\n000002\nincomplete"'));
  assert.ok(csv.includes('"Meter, ""test"" <script>alert(1)</script>"'));
  assert.ok(csv.includes(`"'=CMD()"`));
  assert.ok(csv.includes('"0004"'));
  assert.equal(countEntriesCsv([]).split("\r\n").length, 1);
});

test("count workbook keeps text identifiers and uses a full serial appendix beyond Excel cell limits", async () => {
  const manySerials = Array.from({ length: 5000 }, (_, index) => String(index).padStart(12, "0")).join("\n");
  const data = [...rows, { ...rows[0], sku: "LARGE", serials: manySerials }];
  const book = await countEntriesWorkbook(context, data);
  const restored = XLSX.read(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  assert.equal(restored.Sheets["Count entries"].A2.v, "00012");
  assert.equal(restored.Sheets["Count entries"].E2.v, "");
  assert.equal(restored.Sheets["Count entries"].E3.v, "0004");
  assert.equal(restored.Sheets["Count entries"].A3.v, "=CMD()");
  assert.equal(restored.Sheets["Count entries"].A3.t, "s");
  assert.equal(restored.Sheets["Count entries"].A3.f, undefined);
  const serials = XLSX.utils.sheet_to_json(restored.Sheets["Entered serials"], { header: 1 }) as unknown[][];
  assert.equal(serials.length, 5004);
  assert.equal(serials[1][3], "000001");
  assert.equal(serials.at(-1)![3], "000000004999");
  const details = XLSX.utils.sheet_to_json(restored.Sheets["Export details"], { header: 1 }) as unknown[][];
  assert.ok(details.some(row => row[1] === "Filtered entries"));
});

test("print export escapes captures, includes scope and serials, and never treats a blank as zero", () => {
  const html = countEntriesPrintHtml(context, rows);
  assert.ok(html.includes("Filtered entries"));
  assert.ok(html.includes("Selected items"));
  assert.ok(html.includes("Includes current unsaved entries"));
  assert.ok(html.includes("000001\n000002\nincomplete"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("<td>3</td><td></td>"));
});
