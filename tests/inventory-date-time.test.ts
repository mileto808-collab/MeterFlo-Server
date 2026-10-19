import { test } from "node:test";
import assert from "node:assert/strict";
import { inventoryDateTime } from "../shared/inventory-date-time";
import { inventoryPrint } from "../server/inventoryPrint";
import { emptyInventory } from "../shared/inventory";

test("inventory timestamps are readable in the project timezone, including prior-day conversion", () => {
  const timestamp = "2026-10-19T03:01:17.028Z";
  assert.equal(inventoryDateTime(timestamp, "America/New_York"), "Oct 18, 2026, 11:01:17 PM EDT");
  assert.equal(inventoryDateTime(timestamp, "America/Denver"), "Oct 18, 2026, 9:01:17 PM MDT");
  assert.equal(inventoryDateTime("2026-01-19T03:01:17Z", "America/New_York"), "Jan 18, 2026, 10:01:17 PM EST");
});

test("missing, invalid and unconfigured timestamps are explicit without crashing", () => {
  assert.equal(inventoryDateTime(null), "Not recorded");
  assert.equal(inventoryDateTime("bad date"), "Invalid date");
  assert.match(inventoryDateTime("2026-10-19T03:01:17Z", "bad/timezone"), /UTC \(project timezone unavailable\)$/);
});

test("receipt, order and count print headers format dates without changing stored evidence", () => {
  const state = emptyInventory();
  const timestamp = "2026-10-19T03:01:17.028Z";
  const record = { id: "test-date", occurredAt: timestamp, createdAt: timestamp, actor: "test-user", lines: [], status: "draft", type: "purchase" };
  const original = structuredClone(record);
  for (const kind of ["receipt", "order", "count"]) {
    const html = inventoryPrint(kind, record, state, "Test", [], "America/Denver");
    assert.ok(html.includes("Date: Oct 18, 2026, 9:01:17 PM MDT"));
    assert.ok(!html.includes(timestamp));
  }
  assert.deepEqual(record, original);
});
