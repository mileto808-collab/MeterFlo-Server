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

test("project times skip the spring gap and distinguish the repeated autumn hour regardless of host timezone", () => {
  const previous = process.env.TZ;
  try {
    for (const browserZone of ["Asia/Tokyo", "Pacific/Honolulu", "UTC"]) {
      process.env.TZ = browserZone;
      for (const [timestamp, expected] of [
        ["2026-03-08T06:59:59.000Z", "Mar 8, 2026, 1:59:59 AM EST"],
        ["2026-03-08T07:00:00.000Z", "Mar 8, 2026, 3:00:00 AM EDT"],
        ["2026-11-01T05:30:00.000Z", "Nov 1, 2026, 1:30:00 AM EDT"],
        ["2026-11-01T06:30:00.000Z", "Nov 1, 2026, 1:30:00 AM EST"],
      ]) {
        assert.equal(inventoryDateTime(timestamp, "America/New_York"), expected);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
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
