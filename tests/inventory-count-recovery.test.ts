import test from "node:test";
import assert from "node:assert/strict";
import { itemSchema, type InventoryCount } from "../shared/inventory";
import { COUNT_MAX_LINES } from "../shared/inventory-count-limits";
import {
  countRecoveryBaseline, countRecoveryPrefix, countRecoveryKey, parseCountRecovery,
  readCountRecoveries, removeCountRecovery, resolveCountProductScan, matchesCountProduct, type CountRecovery,
} from "../client/src/lib/inventory-count-recovery";

const product = (id: string, sku: string, barcode = "", active = true) =>
  itemSchema.parse({ id, sku, name: sku, barcode, active, tracking: "regular" });
const items = [product("meter", "METER", "000123"), product("seal", "SEAL"), product("old", "OLD", "999", false)];
test("master product search supports name, SKU and description without guessing ambiguous results", () => {
  const catalog = [
    itemSchema.parse({ id: "one", sku: "M-100", name: "Residential meter", description: "Brass housing", barcode: "001234", tracking: "regular" }),
    itemSchema.parse({ id: "two", sku: "M-200", name: "Commercial meter", description: "Steel housing", tracking: "regular" }),
  ];
  for (const query of ["m-100", "Residential", "brass", "001234"]) {
    assert.equal(resolveCountProductScan(catalog, query, []).item?.id, "one");
  }
  assert.match(resolveCountProductScan(catalog, "meter", []).error!, /More than one/);
  assert.match(resolveCountProductScan(catalog, "Residential", ["one"]).error!, /already included/);
  assert.match(resolveCountProductScan(catalog, "1234", []).error!, /No catalog/);
  assert.equal(matchesCountProduct(catalog[0], " brass "), true);
  assert.equal(matchesCountProduct(catalog[0], "001"), true);
  assert.equal(matchesCountProduct(catalog[0], "commercial"), false);
});
const count: InventoryCount = {
  id: "count", scope: "selected", warehouseId: "main", status: "open",
  snapshot: [{ itemId: "meter", warehouseId: "main", quantity: 2, revision: 4, serials: ["002", "001"] }],
};
const capture = (writer = "tab-one", updatedAt = 100): CountRecovery => ({
  version: 1, writer, countId: count.id, baseline: countRecoveryBaseline(count), revision: 3,
  reason: "Partial scan\nstill in progress", updatedAt,
  rows: [{ itemId: "meter", quantity: "", serials: "00001\n00002\n" }, { itemId: "seal", quantity: "0", serials: "" }],
});
function store() {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key(index: number) { return [...values.keys()][index] ?? null; },
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    removeItem(key: string) { values.delete(key); },
    clear() { values.clear(); },
  } satisfies Storage;
}

test("product HID scans match exact barcodes and SKU without converting leading zeros", () => {
  assert.equal(resolveCountProductScan(items, " 000123\r\n", []).item?.id, "meter");
  assert.equal(resolveCountProductScan(items, "SEAL", []).item?.id, "seal");
  assert.match(resolveCountProductScan(items, "123", []).error!, /No catalog item/);
  assert.match(resolveCountProductScan(items, "", []).error!, /Scan a barcode/);
});
test("duplicate, unknown, inactive and ambiguous scans do not add products or change quantities", () => {
  assert.match(resolveCountProductScan(items, "METER", ["meter"]).error!, /already included/);
  assert.match(resolveCountProductScan(items, "unknown", []).error!, /Nothing was added/);
  assert.match(resolveCountProductScan(items, "999", []).error!, /inactive/);
  assert.match(resolveCountProductScan([...items, product("another", "OTHER", "000123")], "000123", []).error!, /More than one/);
  assert.match(resolveCountProductScan([...items, product("same-sku", "SEAL")], "SEAL", []).error!, /More than one/);
});
test("barcode identity wins over a different product's SKU; count limits are enforced", () => {
  assert.equal(resolveCountProductScan([...items, product("other", "000123")], "000123", []).item?.id, "meter");
  assert.match(resolveCountProductScan(items, "METER", Array.from({ length: COUNT_MAX_LINES }, (_, i) => `id-${i}`)).error!, /maximum/);
});
test("recovery preserves blank versus zero, serial text, leading zeros and revision verbatim", () => {
  assert.deepEqual(parseCountRecovery(JSON.stringify(capture())), capture());
  assert.equal(parseCountRecovery("{broken"), null);
  for (const change of [{ version: 2 }, { revision: -1 }, { reason: null }, { rows: "bad" }, { updatedAt: 0 },
    { rows: [{ itemId: "meter", quantity: 0, serials: "" }] },
    { rows: [capture().rows[0], capture().rows[0]] }]) {
    assert.equal(parseCountRecovery(JSON.stringify({ ...capture(), ...change })), null);
  }
});
test("count baseline ignores hydration order but detects snapshot, location and scope changes", () => {
  const reordered = structuredClone(count);
  reordered.snapshot[0].serials.reverse();
  assert.equal(countRecoveryBaseline(count), countRecoveryBaseline(reordered));
  for (const other of [
    { ...count, warehouseId: "vehicle" }, { ...count, scope: "warehouse" as const },
    { ...count, snapshot: [] }, { ...count, snapshot: [{ ...count.snapshot[0], revision: 5 }] },
    { ...count, snapshot: [{ ...count.snapshot[0], serials: ["003", "001"] }] },
  ]) assert.notEqual(countRecoveryBaseline(count), countRecoveryBaseline(other));
});
test("captures are isolated by user and project, survive a fresh reader, and order newest first", () => {
  const storage = store(), prefix = countRecoveryPrefix("user-a", "project-a");
  const records = [capture(), capture("other-tab", 200)];
  for (const record of records) storage.setItem(countRecoveryKey(prefix, record), JSON.stringify(record));
  storage.setItem(`${prefix}bad`, "{broken");
  storage.setItem("unrelated", "keep");
  assert.deepEqual(readCountRecoveries(storage, prefix), [...records].reverse());
  assert.deepEqual(readCountRecoveries(storage, countRecoveryPrefix("user-b", "project-a")), []);
  assert.deepEqual(readCountRecoveries(storage, countRecoveryPrefix("user-a", "project-b")), []);
  assert.notEqual(countRecoveryPrefix("a:b", "c"), countRecoveryPrefix("a", "b:c"));
});
test("cleanup removes only the captured writer and never a later update from another tab", () => {
  const storage = store(), prefix = countRecoveryPrefix("user", "project"), first = capture(), second = capture("tab-two", 200);
  storage.setItem(countRecoveryKey(prefix, first), JSON.stringify(first));
  storage.setItem(countRecoveryKey(prefix, second), JSON.stringify(second));
  const newer = { ...first, reason: "New input", updatedAt: 300 };
  storage.setItem(countRecoveryKey(prefix, first), JSON.stringify(newer));
  removeCountRecovery(storage, prefix, first);
  assert.equal(readCountRecoveries(storage, prefix).length, 2);
  removeCountRecovery(storage, prefix, newer);
  assert.deepEqual(readCountRecoveries(storage, prefix), [second]);
});
