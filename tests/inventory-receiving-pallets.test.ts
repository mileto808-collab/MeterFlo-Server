import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { readSerialFile } from "../client/src/lib/inventory-serial-file";
import { receivingPalletIssue, type ReceiptPallet } from "../shared/inventory-receiving-pallets";
import { shipmentCaptureSchema } from "../shared/inventory-shipment-draft-model";
import { blankShipmentEntry, buildShipmentPayload, validateShipmentEntry, type ShipmentEntry } from "../client/src/lib/inventory-shipment-guidance";
import { inventoryPalletPrint } from "../server/inventoryPalletPrint";
import { emptyInventory } from "../shared/inventory";

const serials = Array.from({ length: 50 }, (_, i) => `MF26${String(i + 1).padStart(8, "0")}`);
const csv = (text: string) => new TextEncoder().encode(text).buffer;
const file = (sheets: [string, XLSX.WorkSheet][]) => {
  const book = XLSX.utils.book_new();
  sheets.forEach(([name, sheet]) => XLSX.utils.book_append_sheet(book, sheet, name));
  return XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
};
test("CSV headers, no header, leading zeros and all 50 sample serials", async () => {
  const [sheet] = await readSerialFile(csv("Serial\n" + serials.join("\n")));
  assert.equal(sheet.hasHeader, true); assert.equal(sheet.suggestedColumn, 0);
  assert.deepEqual(sheet.readColumn(0, true).serials.map(row => row.serial), serials);
  const [plain] = await readSerialFile(csv("000123\n000124\n"));
  assert.equal(plain.hasHeader, false);
  assert.deepEqual(plain.readColumn(0, false).serials.map(row => row.serial), ["000123", "000124"]);
});
test("Excel worksheets and explicit column selection preserve exact serial text", async () => {
  const sheets = await readSerialFile(file([
    ["Notes", XLSX.utils.aoa_to_sheet([["Info", "Other"], ["not serials", "notes"]])],
    ["Meters", XLSX.utils.aoa_to_sheet([["SKU", "Serial number"], ...serials.map(serial => ["E460", serial])])],
  ]));
  assert.equal(sheets[0].suggestedColumn, null);
  assert.equal(sheets[1].suggestedColumn, 1);
  assert.deepEqual(sheets[1].readColumn(1, true).serials.map(row => row.serial), serials);
});
test("Reject imprecise numeric IDs, formulas, dates, control characters and oversize files", async () => {
  const sheet = XLSX.utils.aoa_to_sheet([["Serial"], [12], [1e16], ["X".repeat(101)], ["A\nB"], [2], [46000], [-12]]);
  sheet.A2.z = "000000";
  sheet.A6.f = "1+1"; sheet.A6.v = 2;
  sheet.A7.z = "m/d/yy";
  sheet.A8.z = "000000";
  const [read] = await readSerialFile(file([["Serials", sheet]]));
  const parsed = read.readColumn(0, true);
  assert.deepEqual(parsed.serials.map(row => row.serial), ["000012", "-000012"]);
  assert.equal(parsed.errors.length, 5);
  await assert.rejects(readSerialFile(new ArrayBuffer(5 * 1024 * 1024 + 1)), /5 MiB/);
  const [large] = await readSerialFile(csv("Serial\n" + Array.from({ length: 10001 }, (_, i) => `S${i}`).join("\n")));
  assert.equal(large.readColumn(0, true).serials.length, 0);
  assert.match(large.readColumn(0, true).errors[0].reason, /10,000/);
});
const pallet = (overrides: Partial<ReceiptPallet> = {}): ReceiptPallet => ({
  id: randomUUID(), itemId: "meter", label: "Pallet A", expectedQuantity: 50, serials: [...serials], exceptionReason: "", ...overrides,
});
const lines = [{ itemId: "meter", quantity: 50, serials }];
test("Pallet counts, membership, duplicate labels, duplicates and documented shortages", () => {
  assert.equal(receivingPalletIssue([pallet()], lines), "");
  const missing = pallet({ serials: serials.slice(0, 49) });
  assert.match(receivingPalletIssue([missing], lines), /49 \/ 50/);
  assert.equal(receivingPalletIssue([missing], lines, false), "");
  assert.equal(receivingPalletIssue([{ ...missing, exceptionReason: "Physically short one meter after recount." }], lines), "");
  assert.match(receivingPalletIssue([pallet({ serials: ["OTHER"] })], lines), /not among/);
  assert.match(receivingPalletIssue([pallet(), pallet({ label: "pallet a" })], lines), /different pallet label/);
  assert.match(receivingPalletIssue([pallet(), pallet({ label: "Pallet B" })], lines), /more than one/);
});
test("Incomplete pallet drafts save, payloads carry groups, and review blocks unexplained discrepancies", () => {
  const group = pallet({ expectedQuantity: 2, serials: [serials[0]] });
  const entry: ShipmentEntry = { ...blankShipmentEntry("meter"), goodQuantity: "1", goodSerials: [serials[0]], pallets: [group], activePalletId: group.id };
  const capture = { entries: { meter: entry }, scanBuffers: {}, reason: "", closeRemainder: false };
  assert.equal(shipmentCaptureSchema.safeParse(capture).success, false, "Draft palettes do not accept itemId; it comes from the containing item");
  const { itemId: _, ...draftGroup } = group;
  entry.pallets = [draftGroup];
  assert.equal(shipmentCaptureSchema.safeParse(capture).success, true);
  assert.match(validateShipmentEntry(entry, true, "receive", []), /1 \/ 2/);
  entry.pallets[0].exceptionReason = "Pallet physically contained only one meter.";
  assert.equal(validateShipmentEntry(entry, true, "receive", []), null);
  assert.equal(buildShipmentPayload([entry], "receive").pallets![0].itemId, "meter");
  const bad = structuredClone(capture);
  bad.entries.meter.pallets[0].serials.push("UNRELATED");
  assert.equal(shipmentCaptureSchema.safeParse(bad).success, false);
});
test("Receipt pallet printing escapes text and includes all 50 serials", () => {
  const receipt = { id: "receipt", action: "receive", reference: "PO", warehouseId: "wh", actor: "actor",
    occurredAt: new Date().toISOString(), reason: "", lines, pallets: [pallet({ label: "<script>Pallet</script>" })] };
  const html = inventoryPalletPrint(receipt, emptyInventory());
  assert.ok(!html.includes("<script>")); assert.match(html, /&lt;script&gt;/);
  for (const serial of serials) assert.ok(html.includes(serial));
});
