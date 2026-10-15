import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { emptyInventory, itemSchema, type InventoryReceipt, type InventoryOrder } from "../../shared/inventory";
import { inventoryPrint } from "../../server/inventoryPrint";

export function serialPrintFixture(name: string) {
  const state = emptyInventory();
  const actor = randomUUID();
  state.items = ["meter", "module", "seal"].map(id => itemSchema.parse({
    id, sku: id.toUpperCase(), name: `${id} fixture product`,
    tracking: id === "seal" ? "regular" : "serialized",
  }));
  const order: InventoryOrder = {
    id: randomUUID(), orderNumber: "TR-2026-000099", reference: "Serial print test",
    type: "transfer", sourceId: "source", destinationId: "destination", vendorId: null,
    lines: [], dispatched: [], received: [], notes: "", status: "partial", createdAt: "2026-10-15T12:00:00Z",
  };
  const record: InventoryReceipt = {
    id: randomUUID(), action: "accept", reference: order.id, warehouseId: "destination",
    actor, occurredAt: "2026-10-15T12:30:00Z", lines: [],
  };
  const serials = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, i) => `${prefix}${String(i).padStart(6, "0")}`);
  const expected: string[] = [];
  if (name === "none") record.lines = [{ itemId: "seal", quantity: 200, serials: [] }];
  if (name === "one") {
    record.action = "dispatch";
    record.lines = [{ itemId: "meter", quantity: 1, serials: ["0000Ab-10.00"] }];
    expected.push("0000Ab-10.00");
  }
  if (name === "hundreds" || name === "thousands") {
    record.action = "receive";
    order.type = "purchase"; order.orderNumber = "PO-2026-000099";
    const meters = serials("MTR-", name === "thousands" ? 1200 : 230);
    const modules = serials("MOD-", name === "thousands" ? 310 : 17);
    record.lines = [{ itemId: "meter", quantity: meters.length, serials: meters },
      { itemId: "module", quantity: modules.length, serials: modules }];
    expected.push(...meters, ...modules);
    // Evidence belonging to another partial shipment must never leak into this receipt.
    order.received = [{ itemId: "meter", quantity: 1, serials: ["OTHER-PARTIAL-NOT-PRINTED"] }];
  }
  if (name === "exceptions" || name === "unknown-only") {
    record.lines = name === "exceptions" ? [{ itemId: "meter", quantity: 1, serials: ["Good-0001"] }] : [];
    record.damaged = [{ itemId: "meter", quantity: 3, serials: name === "exceptions" ? ["Bad-0002"] : [],
      unidentifiedQuantity: name === "exceptions" ? 2 : 3,
      expectedSerials: name === "exceptions" ? ["Unverified-0003", "Unverified-0004"] : [],
      reason: "Crushed labels; dispatch references are not confirmed readings." }];
    if (name === "exceptions") expected.push("Good-0001", "Bad-0002", "Unverified-0003", "Unverified-0004");
  }
  if (name === "disposition") {
    record.action = "resolveHold";
    record.holdId = randomUUID();
    record.lines = [{ itemId: "meter", quantity: 2, serials: ["Selected-0001", "Verified-0002"] }];
    record.holdDisposition = {
      operationId: record.id, actor, occurredAt: record.occurredAt, reason: "Inspected subset only",
      reference: "Inspection sheet", outcome: "released", quantity: 2, serials: ["Selected-0001"],
      unidentifiedQuantity: 1, expectedSerials: ["Expected-0002"], verifiedSerials: ["Verified-0002"],
    };
    state.shipmentHolds = [{
      id: record.holdId, orderId: order.id, receiptId: randomUUID(), warehouseId: "destination",
      itemId: "meter", actor, occurredAt: record.occurredAt, reason: "Original hold",
      quantity: 10, serials: ["OTHER-HOLD-NOT-PRINTED"], unidentifiedQuantity: 9, expectedSerials: [],
      status: "held",
    }];
    expected.push("Selected-0001", "Verified-0002", "Selected-0001", "Expected-0002", "Verified-0002");
  }
  if (name === "long") {
    const value = "0000-" + "Ab_".repeat(29) + "-00.End";
    record.lines = [{ itemId: "meter", quantity: 1, serials: [value] }];
    expected.push(value);
  }
  if (name === "components") {
    record.action = "assemble"; record.reference = "meter";
    record.lines = [{ itemId: "meter", quantity: 1, serials: ["KIT-0001"] }];
    record.components = [{ itemId: "module", quantity: 1, serials: ["COMP-0002"] }];
    expected.push("KIT-0001", "COMP-0002");
  }
  if (name === "transit-loss") {
    record.action = "resolveTransit";
    record.resolution = "confirmed transit loss";
    record.lines = [{ itemId: "meter", quantity: 1, serials: ["LOST-000007"] }];
    expected.push("LOST-000007");
  }
  if (name === "escaping") {
    record.lines = [{ itemId: "module", quantity: 1, serials: ['0000<aBc&"10.00">'] }];
    expected.push('0000<aBc&"10.00">');
    state.items[1].name = 'Module <test> & "label"';
  }
  order.lines = structuredClone(record.lines);
  state.orders.push(order);
  state.receipts.push(record);
  return { state, record, expected, actor, project: "Serial Appendix Test Project" };
}

if (process.argv.includes("--write")) {
  const dir = "generated-artifacts/inventory-serial-print";
  await fs.mkdir(dir, { recursive: true });
  const manifest = [];
  for (const name of ["none", "one", "hundreds", "thousands", "exceptions", "unknown-only", "disposition", "long", "components", "transit-loss", "escaping"]) {
    const fixture = serialPrintFixture(name);
    const html = inventoryPrint("receipt", fixture.record, fixture.state, fixture.project,
      [{ id: fixture.actor, username: "warehouse.operator" }]);
    const file = `${dir}/${name}.html`;
    await fs.writeFile(file, html);
    manifest.push({ name, file, expected: fixture.expected, orderNumber: fixture.state.orders[0].orderNumber });
  }
  await fs.writeFile(`${dir}/manifest.json`, JSON.stringify(manifest));
  console.log("Wrote isolated receipt print fixtures.");
}
