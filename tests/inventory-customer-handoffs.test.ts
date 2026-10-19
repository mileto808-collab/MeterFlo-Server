import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, warehouseSchema, commandPermission, inventoryPermissions, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { normalizeRemovalPolicy, customerReturnRuleId } from "../shared/inventory-removal-policy";
import { validateCustomerHandoffs } from "../shared/inventory-customer-handoffs";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { inventoryCustomerHandoffPrint } from "../server/inventoryCustomerHandoffPrint";

function fixture() {
  const state = normalizeRemovalPolicy(emptyInventory());
  state.warehouses.push(warehouseSchema.parse({ id: "w", code: "W", name: "Warehouse", type: "physical", address: "Fixture" }));
  state.returns = ["OLD-A", "OLD-B"].map((serial, index) => ({
    id: `return-${index}`, serial, workOrderId: index + 1, equipment: index ? "module" : "system", disposition: "returned",
    warehouseId: "w", status: "customer_pending", ruleId: state.removalRules![0].id, ruleRevision: 1, ruleName: state.removalRules![0].name, policyRevision: 1,
    history: [{ operationId: `decision-${index}`, actor: "receiver", occurredAt: "2026-10-18T12:00:00.000Z", outcome: "customer_return", reason: "Inspected",
      ruleId: customerReturnRuleId, ruleRevision: 1, ruleName: "Return to customer" }],
  }));
  return state;
}
const payload = (mode: "visual" | "scan" = "visual") => ({
  warehouseId: "w", recipient: "Customer depot", reference: "COLLECT-1", reason: "Physically collected",
  verification: mode, visuallyVerified: mode === "visual", scannedSerials: mode === "scan" ? ["OLD-B", "OLD-A"] : [],
  entries: [{ id: "return-0", expectedOperationId: "decision-0" }, { id: "return-1", expectedOperationId: "decision-1" }],
});
const post = (state: InventoryState, data: Record<string, unknown>, operationId = randomUUID(), admin = true) =>
  applyInventoryCommand(state, { action: "returnCustomerBatch", data, operationId }, "warehouse-manager", admin, "2026-10-19T01:00:00.000Z");

for (const mode of ["visual", "scan"] as const) test(`${mode}: atomic bulk handoff, immutable serial evidence, replay and relational/backup round trips`, () => {
  const original = fixture(), before = structuredClone(original), operationId = randomUUID();
  const result = post(original, payload(mode), operationId);
  assert.deepEqual(original, before);
  assert.deepEqual(result.state.stock, original.stock);
  assert.equal(result.state.customerHandoffs!.length, 1);
  assert.equal(result.state.receipts.length, 1);
  assert.ok(result.state.returns.every(record => record.status === "customer_returned" && record.customerHandoffId === operationId));
  assert.deepEqual(result.state.customerHandoffs![0].lines.map(line => line.verifiedSerial), mode === "scan" ? ["OLD-B", "OLD-A"] : ["OLD-A", "OLD-B"]);
  validateCustomerHandoffs(result.state);
  validateInventoryBackup({ state: result.state, movements: [], enabled: true }, [1, 2]);
  const relational = inventoryToRelational(result.state);
  const restored = inventoryFromRelational(new Map([...relational].map(([name, table]) => [name, table.rows])), result.state.revision, Object.keys(result.state));
  assert.deepEqual(restored.customerHandoffs, result.state.customerHandoffs);
  validateCustomerHandoffs(restored);
  assert.ok(post(result.state, payload(mode), operationId).replay);
  assert.throws(() => post(result.state, { ...payload(mode), recipient: "Other" }, operationId), /identifier/);
  assert.throws(() => post(result.state, payload(mode)), /no longer awaiting/);
});

test("missing, extra, repeated, ambiguous and partial scans never change custody", () => {
  const state = fixture(), before = structuredClone(state);
  for (const scannedSerials of [[], ["OLD-A"], ["OLD-A", "OLD-A"], ["OLD-A", "WRONG"], ["OLD-A", "OLD-B", "EXTRA"]])
    assert.throws(() => post(state, { ...payload("scan"), scannedSerials }), /Scan each/);
  const ambiguous = fixture(); ambiguous.returns[1].serial = "OLD-A";
  assert.throws(() => post(ambiguous, { ...payload("scan"), scannedSerials: ["OLD-A", "OLD-A"] }), /distinct/);
  assert.deepEqual(state, before);
});

test("visual attestation, source, serial, current custody and selection are required server-side", () => {
  const state = fixture();
  assert.throws(() => post(state, { ...payload(), visuallyVerified: false }), /visual inspection/);
  assert.throws(() => post(state, { ...payload(), scannedSerials: ["OLD-A"] }), /visual/);
  assert.throws(() => post(state, { ...payload(), entries: [payload().entries[0], payload().entries[0]] }), /only once/);
  assert.throws(() => post(state, { ...payload(), entries: [{ id: "return-0", expectedOperationId: "stale" }] }), /custody changed/);
  const moved = fixture(); moved.returns[1].warehouseId = "other";
  assert.throws(() => post(moved, payload()), /location/);
  const missing = fixture(); missing.returns[0].serial = " ";
  assert.throws(() => post(missing, payload()), /recorded serial/);
  const restricted = fixture(); restricted.warehouses[0].userIds = ["another-user"];
  const typeId = randomUUID();
  restricted.locationTypes = [{ id: typeId, name: "Restricted depot", kind: "physical", accessPolicy: "assigned", revision: 1 }];
  restricted.warehouses[0].locationTypeId = typeId;
  assert.throws(() => post(restricted, payload(), randomUUID(), false), /access|assigned/i);
  assert.equal(commandPermission("returnCustomerBatch" as InventoryCommand["action"]), inventoryPermissions.resolveReturns);
});

test("backup validation rejects missing manifests, altered scans, duplicate returns and mismatched custody", () => {
  const saved = post(fixture(), payload("scan")).state;
  const changed = structuredClone(saved); changed.customerHandoffs![0].lines[0].verifiedSerial = "FORGED";
  assert.throws(() => validateCustomerHandoffs(changed), /inconsistent/);
  const missing = structuredClone(saved); missing.customerHandoffs = [];
  assert.throws(() => validateCustomerHandoffs(missing), /missing customer/);
  const repeated = structuredClone(saved); repeated.customerHandoffs!.push(structuredClone(repeated.customerHandoffs![0]));
  assert.throws(() => validateCustomerHandoffs(repeated), /duplicate/);
  const tampered = structuredClone(saved); tampered.returns[0].customerRecipient = "Someone else";
  assert.throws(() => validateCustomerHandoffs(tampered), /inconsistent/);
});

test("manifest has a separate printable serial appendix, verification source, timezone and customer work orders", () => {
  for (const mode of ["visual", "scan"] as const) {
    const state = post(fixture(), { ...payload(mode), recipient: "<Customer>" }).state;
    const html = inventoryCustomerHandoffPrint(state.customerHandoffs![0], state, "Demo", [{ id: "warehouse-manager", username: "Warehouse User" }], "America/New_York", { "1": "CUST-100", "2": "CUST-200" });
    assert.match(html, /break-before:page/); assert.match(html, /class="serials"/);
    assert.match(html, mode === "scan" ? /in scan order/ : /previously collected/);
    assert.match(html, /CUST-100/); assert.match(html, /CUST-200/);
    assert.match(html, /&lt;Customer&gt;/); assert.match(html, /Warehouse User/);
    assert.match(html, /EDT/);
    const appendix = html.slice(html.indexOf('<section class="serials">'));
    assert.ok(mode === "scan" ? appendix.indexOf("OLD-B") < appendix.indexOf("OLD-A") : appendix.indexOf("OLD-A") < appendix.indexOf("OLD-B"));
  }
});
