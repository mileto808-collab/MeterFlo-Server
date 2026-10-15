import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, type InventoryOrder, type InventoryReceipt } from "../shared/inventory";
import { inventoryActorLabel, inventoryReceiptLabel, inventoryHoldLabel } from "../shared/inventory-display-labels";
import { inventoryPrint } from "../server/inventoryPrint";

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
    assert.ok(html.includes("<svg"));
    assert.ok(!html.includes(order.id));
    assert.ok(!html.includes(receipt.id));
    assert.ok(!html.includes(actor));
    assert.ok(html.includes("&lt;Project&gt;"));
    assert.ok(!html.includes("<operator>"));
    if (kind === "receipt") {
      assert.ok(html.includes("Receipt #1"));
      assert.ok(html.includes("Internal receipt ID barcode"));
      assert.ok(html.includes("&lt;operator&gt;"));
    }
  }
  assert.deepEqual(state, before);
});
