import test from "node:test";
import assert from "node:assert/strict";
import { emptyInventory, type EquipmentReturn } from "../shared/inventory";
import { defaultRemovalRules, removalChoices } from "../shared/inventory-removal-policy";
import { removalDispositionDisplay, removalFilterKey, removalHistoryLabel } from "../shared/inventory-removal-display";
import { buildOperationsDataset, filterOperationsRows } from "../client/src/lib/inventory-operations-data";
import { operationsCsv, operationsPrintHtml } from "../client/src/lib/inventory-operations-export";
import { inventoryPrint } from "../server/inventoryPrint";

function fixture() {
  const state = emptyInventory();
  state.removalRules = defaultRemovalRules();
  state.removalRules[0].name = "Customer depot return";
  state.removalRules[2].name = "Customer approved recycling";
  state.removalRules.push({ ...state.removalRules[0], id: "ea936000-0000-4000-8000-000000000004", name: "Contract exception return" });
  const field = state.removalRules[0], warehouse = state.removalRules[2];
  const returned: EquipmentReturn = {
    id: "returned-1", equipment: "system", serial: "OLD-1", workOrderId: 10,
    disposition: "returned", ruleId: field.id, ruleName: field.name, ruleRevision: 1,
    warehouseId: "w", status: "scrapped", history: [
      { operationId: "field-1", actor: "actor", occurredAt: "2026-10-19T01:00:00Z", outcome: "returned", ruleId: field.id, ruleName: field.name, reason: "Field capture" },
      { operationId: "accept-1", actor: "actor", occurredAt: "2026-10-19T02:00:00Z", outcome: "quarantine", reason: "Arrival" },
      { operationId: "decide-1", actor: "actor", occurredAt: "2026-10-19T03:00:00Z", outcome: "scrapped", ruleId: warehouse.id, ruleName: warehouse.name, reason: "Inspection" },
    ],
  };
  state.returns = [returned, { ...returned, id: "returned-2", serial: "OLD-2", status: "pending", history: [],
    ruleId: state.removalRules[3].id, ruleName: state.removalRules[3].name }];
  state.receipts = returned.history!.map(event => ({
    id: event.operationId, action: event.outcome === "returned" ? "complete" : event.outcome === "quarantine" ? "returnAccept" : "returnDecide",
    reference: returned.id, warehouseId: "w", lines: [], actor: event.actor, occurredAt: event.occurredAt,
  }));
  return state;
}

test("project names and stable identities distinguish dispositions sharing the same physical outcome", () => {
  const state = fixture(), before = structuredClone(state);
  const dataset = buildOperationsDataset("returns", state);
  const field = dataset.filters.find(filter => filter.key === "fieldDisposition")!;
  assert.ok(field.options.some(option => option.label === "Customer depot return"));
  assert.ok(field.options.some(option => option.label === "Contract exception return"));
  assert.ok(!field.options.some(option => option.value === "returned" || option.label === "returned"));
  for (const [index, label] of [[0, "Customer depot return"], [3, "Contract exception return"]] as const) {
    const rule = state.removalRules![index];
    const matches = filterOperationsRows(dataset, "", { fieldDisposition: removalFilterKey(rule.id, rule.outcome) }, dataset.defaultSort);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].cells.fieldDisposition, label);
  }
  const warehouse = state.removalRules![2];
  assert.equal(filterOperationsRows(dataset, "", { warehouseDisposition: removalFilterKey(warehouse.id, warehouse.outcome) }, dataset.defaultSort)[0].id, "returned-1");
  assert.equal(filterOperationsRows(dataset, "", { warehouseDisposition: "none" }, dataset.defaultSort)[0].id, "returned-2");
  assert.ok(dataset.filters.find(filter => filter.key === "warehouseDisposition")!.options.some(option => option.label === state.removalRules![1].name),
    "Unused configured decisions remain filterable without changing the export scope");
  assert.deepEqual(state, before);
});

test("renaming and disabling preserve filter identity, original history and stage authority", () => {
  const state = fixture(), field = state.removalRules![0], returned = state.returns[0];
  const key = removalDispositionDisplay(state, returned, "field").key;
  field.name = "Renamed contract return"; field.active = false;
  assert.equal(removalDispositionDisplay(state, returned, "field").key, key);
  assert.equal(buildOperationsDataset("returns", state).rows[0].cells.fieldDisposition, field.name);
  assert.equal(removalHistoryLabel(state, returned, returned.history![0]), "Customer depot return");
  assert.ok(!removalChoices(state, "system", "field").some(rule => rule.id === field.id));
  assert.ok(removalChoices(state, "system", "warehouse").every(rule => rule.stage === "warehouse"));
  assert.equal(removalHistoryLabel(state, returned, returned.history![1]), "Accepted into quarantine");
});

test("activity and receipt printing match the exact recorded event, not a later warehouse decision", () => {
  const state = fixture();
  const activity = buildOperationsDataset("activity", state);
  assert.equal(activity.rows[0].cells.fieldDisposition, "Customer depot return");
  assert.equal(activity.rows[0].cells.warehouseDisposition, "");
  assert.equal(activity.rows[1].cells.custodyEvent, "Accepted into quarantine");
  assert.equal(activity.rows[1].cells.warehouseDisposition, "");
  assert.equal(activity.rows[2].cells.warehouseDisposition, "Customer approved recycling");
  const key = removalFilterKey(state.removalRules![2].id, "scrapped");
  assert.deepEqual(filterOperationsRows(activity, "", { warehouseDisposition: key }, activity.defaultSort).map(row => row.id), ["decide-1"]);
  assert.ok(!inventoryPrint("receipt", state.receipts[0], state, "Project").includes("Warehouse decision: Customer approved recycling"));
  assert.ok(inventoryPrint("receipt", state.receipts[2], state, "Project").includes("Warehouse decision: Customer approved recycling"));
  state.removalRules![2].name = "Renamed warehouse decision";
  const html = inventoryPrint("return", state.returns[0], state, "Project");
  assert.ok(html.includes("<dd>Renamed warehouse decision</dd>"));
  assert.ok(html.includes("<td>Customer approved recycling</td>"), "Historical printed event keeps its original name");
  const csv = operationsCsv(activity, activity.rows);
  assert.ok(csv.includes("Field disposition") && csv.includes("Warehouse decision") && csv.includes("Customer approved recycling"));
  assert.ok(operationsPrintHtml({ project: "Project", timezone: "UTC" }, "activity", activity, activity.rows).includes("Customer approved recycling"));
});

test("filters are project-scoped and never infer a custom rule for a missing identity", () => {
  const first = fixture(), other = fixture();
  other.removalRules![0].name = "Other project's depot";
  assert.ok(!buildOperationsDataset("returns", first).filters.flatMap(filter => filter.options).some(option => option.label === "Other project's depot"));
  const unknown = { disposition: "returned" };
  assert.notEqual(removalDispositionDisplay(first, unknown, "field").key, removalFilterKey(first.removalRules![0].id, "returned"));
  assert.equal(removalDispositionDisplay(first, unknown, "field").label, "Returned to warehouse");
});

test("one completion containing system and module dispositions matches either stable rule identity", () => {
  const state = fixture();
  const second = state.returns[1];
  second.equipment = "module";
  second.history = [{ ...state.returns[0].history![0], ruleId: second.ruleId, ruleName: second.ruleName }];
  const activity = buildOperationsDataset("activity", state);
  for (const rule of [state.removalRules![0], state.removalRules![3]])
    assert.ok(filterOperationsRows(activity, "", { fieldDisposition: removalFilterKey(rule.id, rule.outcome) }, activity.defaultSort)
      .some(row => row.id === "field-1"));
});
