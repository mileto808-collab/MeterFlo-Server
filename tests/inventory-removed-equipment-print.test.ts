import test from "node:test";
import assert from "node:assert/strict";
import { emptyInventory, type EquipmentReturn } from "../shared/inventory";
import { inventoryPrint } from "../server/inventoryPrint";
import { inventoryWorkOrderLabel } from "../shared/inventory-work-order-labels";
import { buildOperationsDataset, filterOperationsRows } from "../client/src/lib/inventory-operations-data";
import { operationsCsv, operationsPrintHtml, operationsWorkbook } from "../client/src/lib/inventory-operations-export";

const returned: EquipmentReturn = {
  id: "internal-return-reference", workOrderId: 195, equipment: "system", serial: '<Serial & "01">',
  disposition: "returned", ruleName: "Return to warehouse", warehouseId: "warehouse", status: "scrapped",
  history: [{ operationId: "operation", actor: "actor-id", occurredAt: "2026-10-19T03:01:17.028Z",
    outcome: "scrapped", ruleName: "Scrap after inspection", reason: "<script>unsafe</script>" }],
};

test("customer work-order identifiers preserve leading zeros; only empty/missing labels fall back", () => {
  assert.equal(inventoryWorkOrderLabel(195, { "195": "0002048-A" }), "0002048-A");
  assert.equal(inventoryWorkOrderLabel(195, { "195": "0" }), "0");
  assert.equal(inventoryWorkOrderLabel(195, { "195": "   " }), "195");
  assert.equal(inventoryWorkOrderLabel(195), "195");
});

test("individual removed-equipment print includes readable customer identity and complete escaped custody history", () => {
  const state = emptyInventory();
  state.returns.push(structuredClone(returned));
  const before = structuredClone(state);
  const html = inventoryPrint("return", returned, state, "<Project>", [{ id: "actor-id", username: "<operator>" }],
    "America/New_York", { "195": "0002048-A" });
  assert.ok(html.includes("<dt>Work order</dt><dd>0002048-A</dd>"));
  assert.ok(!html.includes("<dd>195</dd>"));
  assert.ok(html.includes("Oct 18, 2026, 11:01:17 PM EDT"));
  assert.ok(!html.includes(returned.history![0].occurredAt));
  assert.ok(html.includes("Scrap after inspection"));
  assert.ok(html.includes("&lt;script&gt;unsafe&lt;/script&gt;"));
  assert.ok(html.includes("&lt;operator&gt;"));
  assert.ok(!html.includes("<script>") && !html.includes("actor-id"));
  assert.ok(html.includes("Print / Save PDF") && html.includes("window.print()"));
  assert.ok(html.includes("&lt;Project&gt;") && html.includes("&lt;Serial &amp; &quot;01&quot;&gt;"));
  assert.deepEqual(state, before);
});

test("entry printing handles missing history and missing customer ID without fabricating evidence", () => {
  const record = { ...returned, history: [] };
  const html = inventoryPrint("return", record, emptyInventory(), "Test", [], "UTC", { "195": "" });
  assert.ok(html.includes("<dt>Work order</dt><dd>195</dd>"));
  assert.ok(html.includes("No custody or decision history was recorded."));
});

test("removed-equipment search, CSV, Excel and list printing use the customer work-order identifier", async () => {
  const state = emptyInventory();
  state.returns.push(structuredClone(returned));
  state.returns.push({ ...structuredClone(returned), id: "second-return", workOrderId: 196, serial: "Other" });
  const dataset = buildOperationsDataset("returns", state, [], [], "America/New_York", { "195": "0002048-A", "196": "99" });
  assert.equal(dataset.rows[0].cells.workOrder, "0002048-A");
  assert.equal(filterOperationsRows(dataset, "0002048-A", {}, dataset.defaultSort).length, 1);
  assert.deepEqual(filterOperationsRows(dataset, "", {}, "workOrder:desc").map(row => row.cells.workOrder), ["0002048-A", "99"]);
  assert.ok(operationsCsv(dataset, dataset.rows).includes('"0002048-A"'));
  assert.ok(operationsPrintHtml({ project: "Test", timezone: "America/New_York" }, "returns", dataset, dataset.rows).includes("0002048-A"));
  const book = await operationsWorkbook({ project: "Test", timezone: "America/New_York" }, "returns", dataset, dataset.rows);
  const { utils } = await import("xlsx");
  const rows = utils.sheet_to_json<Array<string | number>>(book.Sheets[book.SheetNames[0]], { header: 1 });
  assert.equal(rows[1][dataset.columns.findIndex(column => column.key === "workOrder")], "0002048-A");
});
