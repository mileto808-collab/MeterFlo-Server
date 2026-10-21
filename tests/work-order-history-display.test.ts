import assert from "node:assert/strict";
import test from "node:test";
import { historyActionLabel, historyDisplayText } from "../shared/work-order-history-display";
import { historyPrint, historyCsv } from "../server/work-order-lifecycle/history";

test("lifecycle inventory values are readable text with dates in the project timezone", () => {
  const value = historyDisplayText({ used: [{ itemId: "MTR · Meter", warehouseId: "VAN · Vehicle",
    quantity: 1, serials: ["00001234"] }], completed_at: "2026-10-21T12:00:00.000Z" }, "", "America/New_York");
  assert.match(value, /Installed items:\s*Item: MTR/);
  assert.match(value, /Location: VAN/);
  assert.match(value, /Serials: 00001234/);
  assert.doesNotMatch(value, /[{}"]/);
  assert.equal(historyActionLabel("inventory.WorkOrderCompleted"), "Work order completed · Inventory recorded");
  assert.equal(historyDisplayText(false), "No");
});

test("history print and CSV use readable evidence without changing the raw audit event", () => {
  const uuid = "353b1f3d-8db2-4a40-9a1f-646aa91ab072";
  const data: any = { projectName: "Customer <project>", timezone: "America/New_York", total: 1,
    groups: [{ operationId: uuid, operationReference: "Operation #101", workOrderReference: "Work order 0002048",
      occurredAt: "2026-10-21T12:00:00Z", actorLabel: "Warehouse worker", source: "web", outcome: "success",
      events: [{ id: "102", entityLabel: "Work order #195", entityReference: "Work order 0002048",
        occurredAt: "2026-10-21T12:00:00Z", actorLabel: "Warehouse worker", source: "web", outcome: "success",
        action: "inventory.WorkOrderCompleted",
        changes: [{ field: `allocations/195`, before: null, after: { warehouseId: uuid, workOrderId: 195 } }],
        metadata: { workOrderIds: [195] },
        displayChanges: [{ field: "Work order 0002048", before: null,
          after: { warehouseId: "VAN1 · Service vehicle", workOrderId: "Work order 0002048", quantity: 1 } }],
        displayMetadata: { workOrderIds: ["Work order 0002048"] } }] }] };
  const original = JSON.stringify(data);
  const html = historyPrint(data), csv = historyCsv(data);
  for (const result of [html, csv]) {
    assert.match(result, /Work order 0002048/);
    assert.match(result, /Work order completed/);
    assert.match(result, /VAN1 · Service vehicle/);
    assert.doesNotMatch(result, /Work order #195|inventory\.WorkOrderCompleted|353b1f3d|allocations\/195|"changes"/);
  }
  assert.match(html, /Customer &lt;project&gt;/);
  assert.doesNotMatch(html, /<pre>/);
  assert.equal(JSON.stringify(data), original);
});
