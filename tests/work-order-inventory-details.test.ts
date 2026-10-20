import test from "node:test";
import assert from "node:assert/strict";
import { emptyInventory, type InventoryItem } from "../shared/inventory";
import { inventoryComponentDetails, workKitComponentTrace } from "../shared/inventory-component-details";
import { requirementsSatisfied } from "../shared/inventory-requirements";
import { buildWorkOrderInventoryHtml, type WorkOrderPrintInventory } from "../client/src/components/work-order-pdf-inventory";
import { applyInventoryCommand, completeInventoryWorkOrder } from "../shared/inventory-engine";
import { randomUUID } from "node:crypto";

const item = (id: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({
  id, sku: id.toUpperCase(), name: id, tracking: "regular", equipment: "none", active: true,
  unit: "each", cost: 0, billingRate: 0, reorderPoint: 0, images: [], components: [], ...extra,
});
const items = [item("meter", { equipment: "system" }), item("seal"), item("labor", { kind: "labor", unit: "hours" }),
  item("nested", { components: [{ itemId: "seal", quantity: 2 }] }),
  item("kit", { components: [{ itemId: "labor", quantity: 1.5 }, { itemId: "nested", quantity: 1 }, { itemId: "meter", quantity: 1 }] })];
const snapshot = (): WorkOrderPrintInventory => ({
  enabled: true, items, warehouses: [{ id: "van", code: "V", name: "Vehicle" }],
  requirements: { workOrderId: 1, lines: [{ itemId: "kit", quantity: 2 }], missing: [] }, allocation: null,
});

test("component details expand nested quantities and fractional non-stock labor, without cycles", () => {
  const rows = inventoryComponentDetails("kit", 2, items);
  assert.equal(rows.find(row => row.itemId === "seal")?.quantity, 4);
  assert.equal(rows.find(row => row.itemId === "labor")?.quantity, 3);
  assert.equal(rows.find(row => row.itemId === "labor")?.labor, true);
  assert.equal(inventoryComponentDetails("missing", 1, items).length, 0);
  assert.ok(inventoryComponentDetails("kit", 1, items.map(i => i.id === "seal" ? { ...i, components: [{ itemId: "kit", quantity: 1 }] } : i)).length < 10);
});

test("unreserved planned kit, nested components and labor are included in PDF; disabled projects omit inventory", () => {
  const html = buildWorkOrderInventoryHtml(true, snapshot());
  for (const text of ["Planned items & labor", "METER", "SEAL", "LABOR", "3 hours"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/<table/g) || []).length, 1);
  assert.doesNotMatch(html, /Reserved stock|Reservation record|Consumed inventory|Review:|background:/);
  assert.equal(buildWorkOrderInventoryHtml(false, snapshot()), "");
  assert.throws(() => buildWorkOrderInventoryHtml(true), /could not load/);
  assert.equal(buildWorkOrderInventoryHtml(true, { ...snapshot(), enabled: false }), "");
});

test("PDF prints actual usage with empty reservation lines and escapes inventory data", () => {
  const s = snapshot();
  s.allocation = { workOrderId: 1, revision: 1, mode: "changeout", status: "consumed", lines: [], dispositions: [],
    used: [{ itemId: "meter", warehouseId: "van", quantity: 1, serials: ["<SERIAL>"] }] };
  s.items = items.map(i => i.id === "meter" ? { ...i, name: "<img onerror=bad>" } : i);
  const html = buildWorkOrderInventoryHtml(true, s);
  assert.ok(html.includes("Recorded items & labor"));
  assert.ok(html.includes("METER"));
  assert.ok(!html.includes("Vehicle"), "custody locations do not clutter the line-item summary");
  assert.ok(!html.includes("&lt;SERIAL&gt;"), "device serials remain in equipment details, not a second inventory report");
  assert.ok(!html.includes("<img onerror=bad>"));
});

test("billing is conditional, supports explicit zero, and never prints internal cost", () => {
  const s = snapshot();
  s.items = s.items.map(({ billingRate, ...value }) => ({ ...value, cost: 987654.32 }));
  let html = buildWorkOrderInventoryHtml(true, s);
  assert.doesNotMatch(html, /Billing rate|987654|[Cc]ost/);
  s.items = s.items.map(value => ({ ...value, ...(value.id === "labor" ? { billingRate: 42.5 } : value.id === "meter" ? { billingRate: 0 } : {}) }));
  html = buildWorkOrderInventoryHtml(true, s);
  assert.match(html, /Billing rate/);
  assert.match(html, /42\.50/);
  assert.match(html, />0\.00</);
  assert.doesNotMatch(html, /987654|[Cc]ost/);
  assert.equal((html.match(/<table/g) || []).length, 1);
  const redacted = { ...s, items: s.items.map(({ billingRate, ...value }) => value) };
  assert.doesNotMatch(buildWorkOrderInventoryHtml(true, redacted), /Billing rate|42\.50/);
});

test("completed/reading-only/released orders never substitute planned stock for actual usage", () => {
  const s = snapshot();
  s.allocation = { workOrderId: 1, revision: 1, mode: "reading_only", status: "consumed", lines: [],
    used: [], dispositions: [] };
  assert.match(buildWorkOrderInventoryHtml(true, s), /No inventory line items recorded/);
  assert.doesNotMatch(buildWorkOrderInventoryHtml(true, s), /LABOR|KIT|METER/);
  s.allocation.status = "released";
  assert.doesNotMatch(buildWorkOrderInventoryHtml(true, s), /LABOR|KIT|METER/);
});

test("original component trace survives recipe edits and excludes unrelated custody", () => {
  const state = emptyInventory();
  state.kitAssemblies = [{ id: "batch", itemId: "kit", quantity: 2, serials: [], warehouseId: "van", occurredAt: "2026-01-01",
    components: [{ itemId: "original", quantity: 4, serials: ["S1", "S2", "S3", "S4"] }],
    positions: [{ kind: "work", id: "1", quantity: 1, serials: [] }, { kind: "work", id: "2", quantity: 1, serials: [] }],
    disassembledQuantity: 0, disassembledSerials: [] }];
  const traces = workKitComponentTrace(state, 1);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].components[0].quantity, 2);
  assert.deepEqual(traces[0].components[0].serials, []);
  const s = snapshot(); s.componentTrace = traces;
  s.allocation = { workOrderId: 1, revision: 1, mode: "changeout", status: "consumed", lines: [],
    used: [{ itemId: "kit", warehouseId: "van", quantity: 1, serials: [] }], dispositions: [] };
  assert.ok(buildWorkOrderInventoryHtml(true, s).includes("original"));
  assert.ok(!buildWorkOrderInventoryHtml(true, s).includes("Partial quantity batch"), "print omits custody-report diagnostics");
});

test("loose physical parts satisfy kit requirements without requiring labor stock", () => {
  const state = { ...emptyInventory(), items };
  const req = { workOrderId: 1, lines: [{ itemId: "kit", quantity: 1 }], missing: [] };
  assert.ok(requirementsSatisfied(state, req, [
    { itemId: "meter", quantity: 1, warehouseId: "van", serials: [] },
    { itemId: "seal", quantity: 2, warehouseId: "van", serials: [] }]));
  assert.equal(requirementsSatisfied(state, req, [{ itemId: "meter", quantity: 1, warehouseId: "van", serials: [] }]), false);
});

test("completion consumes actual physical parts once without reservations or labor stock", () => {
  let s = emptyInventory();
  const post = (action: any, data: any) => { s = applyInventoryCommand(s, { action, operationId: randomUUID(), data }, "tech", true).state; };
  post("warehouse", { id: "van", code: "VAN", name: "Vehicle", type: "physical", address: "Test" });
  post("vendor", { id: "vendor", name: "Supplier" });
  for (const i of items) post("item", i);
  post("typeLink", { equipment: "system", typeId: 53, itemId: "kit" });
  post("order", { id: "po", type: "purchase", vendorId: "vendor", destinationId: "van",
    lines: [{ itemId: "meter", quantity: 2 }, { itemId: "seal", quantity: 4 }] });
  post("release", { orderId: "po" });
  post("receive", { orderId: "po", lines: [{ itemId: "meter", quantity: 2, serials: [] }, { itemId: "seal", quantity: 4, serials: [] }] });
  s.workRequirements = [{ workOrderId: 1, lines: [{ itemId: "kit", quantity: 1 }], missing: [] }];
  post("prepareUse", { workOrderId: 1, revision: 0, mode: "changeout", dispositions: [],
    used: [{ itemId: "meter", quantity: 1, warehouseId: "van", serials: [] }, { itemId: "seal", quantity: 2, warehouseId: "van", serials: [] }] });
  assert.deepEqual(s.allocations[0].lines, []);
  s = completeInventoryWorkOrder(s, 1, false);
  assert.equal(s.allocations[0].status, "consumed");
  assert.equal(s.stock.find(line => line.itemId === "meter")?.quantity, 1);
  assert.equal(s.stock.find(line => line.itemId === "seal")?.quantity, 2);
  assert.ok(!s.stock.some(line => line.itemId === "labor"));
  assert.deepEqual(completeInventoryWorkOrder(s, 1, false), s);
});
