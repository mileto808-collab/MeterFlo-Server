import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, type InventoryOrder, type InventoryReceipt } from "../shared/inventory";
import { inventoryActorLabel, inventoryReceiptLabel, inventoryHoldLabel } from "../shared/inventory-display-labels";
import { inventoryPrint } from "../server/inventoryPrint";
import { inventoryBarcode } from "../server/inventoryBarcode";
import { extractReceiptSerialEvidence } from "../server/inventoryReceiptSerials";
import { serialPrintFixture } from "./support/inventory-serial-print-fixtures";

test("actor and ledger labels remain readable without inventing historical identities", () => {
  const id = randomUUID();
  assert.equal(inventoryActorLabel(id, [{ id, username: "warehouse-admin" }]), "warehouse-admin");
  assert.equal(inventoryActorLabel(id), "Unknown or deleted user");
  assert.equal(inventoryActorLabel("system"), "system");
  assert.equal(inventoryActorLabel(undefined), "Not recorded");
  assert.equal(inventoryReceiptLabel([{ id }], id), "Receipt #1");
  assert.equal(inventoryReceiptLabel([], id), "Receipt (reference unavailable)");
  assert.equal(inventoryHoldLabel([{ id }], id), "Inspection hold #1");
});

test("receipt and order printing uses readable labels and inline barcodes without changing evidence", () => {
  const state = emptyInventory(), actor = randomUUID();
  const order: InventoryOrder = {
    id: randomUUID(), type: "transfer", orderNumber: "TR-2026-000001", reference: "Crew van",
    sourceId: "main", destinationId: "van", vendorId: null,
    lines: [], dispatched: [], received: [], status: "completed", notes: "",
    createdAt: "2026-10-15T12:00:00Z", createdBy: actor,
  };
  state.orders.push(order);
  const receipt: InventoryReceipt = {
    id: randomUUID(), reference: order.id, action: "accept", warehouseId: "van",
    actor, occurredAt: "2026-10-15T12:00:00Z", lines: [],
  };
  state.receipts.push(receipt);
  const before = structuredClone(state);
  for (const [kind, record] of [["order", order], ["receipt", receipt]] as const) {
    const html = inventoryPrint(kind, record, state, "<Project>", [{ id: actor, username: "<operator>" }]);
    assert.ok(html.includes(order.orderNumber!));
    assert.ok(html.includes("Internal order ID barcode"));
    assert.ok(html.includes(`<figcaption>${order.orderNumber}</figcaption>`));
    assert.ok(html.includes("<svg"));
    assert.ok(!html.includes(order.id));
    assert.ok(!html.includes(receipt.id));
    assert.ok(!html.includes(actor));
    assert.ok(html.includes("&lt;Project&gt;"));
    assert.ok(!html.includes("<operator>"));
    if (kind === "receipt") {
      assert.ok(html.includes("Receipt #1"));
      assert.ok(html.includes("Internal receipt ID barcode"));
      assert.ok(html.includes("<figcaption>Receipt #1</figcaption>"));
      const figures = [...html.matchAll(/<figure class="internal-barcode"[^>]*>[\s\S]*?<\/figure>/g)].map(match => match[0]);
      assert.equal(figures.length, 2);
      const svg = (figure: string) => figure.match(/<svg[\s\S]*?<\/svg>/)![0];
      assert.equal(svg(figures[0]), svg(inventoryBarcode(receipt.id, "Expected receipt")));
      assert.equal(svg(figures[1]), svg(inventoryBarcode(order.id, "Expected order")));
      assert.notEqual(svg(figures[0]), svg(figures[1]), "receipt and order encode different persisted identities");
      assert.ok(html.includes("&lt;operator&gt;"));
    }
  }
  assert.deepEqual(state, before);
});

test("barcode captions escape readable identifiers without changing encoded tracking IDs", () => {
  const id = randomUUID();
  const barcode = inventoryBarcode(id, "Internal order ID", '<Order & "customer">');
  assert.ok(barcode.includes("<figcaption>&lt;Order &amp; &quot;customer&quot;&gt;</figcaption>"));
  assert.ok(!barcode.includes(id));
  assert.equal(barcode.match(/<svg[\s\S]*?<\/svg>/)![0],
    inventoryBarcode(id, "Internal order ID").match(/<svg[\s\S]*?<\/svg>/)![0]);
});

for (const name of ["none", "one", "hundreds", "thousands", "exceptions", "unknown-only", "disposition", "long", "components", "transit-loss", "escaping"]) {
  test(`receipt serial appendix retains exact movement evidence: ${name}`, () => {
    const { state, record, expected, actor, project } = serialPrintFixture(name);
    const before = structuredClone({ state, record });
    const evidence = extractReceiptSerialEvidence(record, state);
    assert.deepEqual(evidence.flatMap(group => group.serials), expected);
    if (name === "disposition") {
      assert.ok(evidence.every(group => group.itemId === "meter"), "Disposition uses original hold's product, not its serials");
      assert.ok(evidence.some(group => group.category === "verified-release"));
    }
    if (name === "transit-loss") assert.equal(evidence[0].category, "transit-loss");
    const html = inventoryPrint("receipt", record, state, project, [{ id: actor, username: "operator" }]);
    assert.equal(html.includes('id="serial-details"'), expected.length > 0);
    const summary = html.split('<section id="serial-details"')[0];
    for (const serial of expected) assert.ok(!summary.includes(serial), "Summary contains counts, not raw serial evidence");
    assert.ok(!html.includes("OTHER-PARTIAL-NOT-PRINTED"));
    assert.ok(!html.includes("OTHER-HOLD-NOT-PRINTED"));
    assert.deepEqual({ state, record }, before, "Printing is read-only");
  });
}
