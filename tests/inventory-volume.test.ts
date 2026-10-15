import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { assertInventoryInvariants, volume, volumeState } from "./helpers/inventory-volume";
import type { InventoryCommand } from "../shared/inventory";

test("large serialized shipment and long retry history preserve atomic identity and count invariants", () => {
  let s = volumeState();
  const post = (action: InventoryCommand["action"], data: Record<string, unknown>) => {
    const command = { action, data, operationId: randomUUID() };
    const started = performance.now();
    s = applyInventoryCommand(s, command, "fixture", true).state;
    const ms = performance.now() - started;
    console.log(JSON.stringify({ metric: `engine.${action}`, ms: Math.round(ms) }));
    assert.ok(ms < 5000, `${action} under 5s`);
    return command;
  };
  post("order", { id: "shipment", type: "purchase", destinationId: "w0", vendorId: "vendor",
    lines: [{ itemId: "i0", quantity: volume.shipment }] });
  post("release", { orderId: "shipment" });
  const serials = Array.from({ length: volume.shipment }, (_, n) => `SHIP-${String(n).padStart(8, "0")}`);
  const receive = post("receive", { orderId: "shipment", lines: [{ itemId: "i0", quantity: serials.length, serials }] });
  const before = s;
  for (let n = 0; n < 20; n++) {
    const replay = applyInventoryCommand(s, receive, "fixture", true);
    assert.equal(replay.replay, true); assert.equal(replay.state, s);
  }
  assert.throws(() => applyInventoryCommand(s, { ...receive, data: { ...receive.data, reason: "different" } }, "fixture", true), /different operation/);
  assert.equal(s, before);
  post("assign", { workOrderId: 1, lines: [{ warehouseId: "w0", itemId: "i0", quantity: 1, serials: [serials.at(-1)] }] });
  assert.throws(() => applyInventoryCommand(s, { action: "assign", operationId: randomUUID(),
    data: { workOrderId: 2, lines: [{ warehouseId: "w0", itemId: "i0", quantity: 1, serials: [serials.at(-1)] }] } }, "fixture", true), /reserved/);
  post("countStart", { id: "count", warehouseId: "w0" });
  const countLines = s.stock.filter(b => b.warehouseId === "w0").map(({ itemId, quantity, serials }) => ({ itemId, quantity, serials }));
  // A count of a bin above the scan limit must explicitly reject rather than truncate.
  assert.throws(() => applyInventoryCommand(s, { action: "countPost", operationId: randomUUID(),
    data: { id: "count", reason: "Physical count", lines: countLines } }, "fixture", true), /10000/);
  assertInventoryInvariants(s);
  post("order", { id: "duplicate", type: "purchase", destinationId: "w39", vendorId: "vendor",
    lines: [{ itemId: "i0", quantity: 1 }] });
  post("release", { orderId: "duplicate" });
  const unchanged = structuredClone(s);
  assert.throws(() => applyInventoryCommand(s, { action: "receive", operationId: randomUUID(),
    data: { orderId: "duplicate", lines: [{ itemId: "i0", quantity: 1, serials: [serials.at(-1)] }] } }, "fixture", true), /already in inventory/);
  assert.deepEqual(s, unchanged, "failed large-state posts are atomic");
});

test("10,000-serial physical count and 500-line boundary reject excess without partial writes", () => {
  let s = volumeState();
  const b = s.stock.find(b => b.warehouseId === "w0" && b.itemId === "i0")!;
  b.serials = Array.from({ length: 10_000 }, (_, n) => `COUNT-${n}`);
  b.quantity = b.serials.length;
  const apply = (action: InventoryCommand["action"], data: Record<string, unknown>) =>
    applyInventoryCommand(s, { action, data, operationId: randomUUID() }, "fixture", true).state;
  s = apply("countStart", { id: "large-count", warehouseId: "w0" });
  const start = performance.now();
  s = apply("countPost", { id: "large-count", reason: "Verified synthetic stock",
    lines: s.stock.filter(b => b.warehouseId === "w0").map(({ itemId, quantity, serials }) => ({ itemId, quantity, serials })) });
  const ms = performance.now() - start;
  console.log(JSON.stringify({ metric: "engine.countPost10000", ms: Math.round(ms) }));
  assert.ok(ms < 5000);
  assert.equal(s.counts[0].status, "posted");
  s = apply("countStart", { id: "stale", warehouseId: "w0" });
  s = apply("order", { id: "stock-change", type: "purchase", vendorId: "vendor", destinationId: "w0", lines: [{ itemId: "i1", quantity: 1 }] });
  s = apply("release", { orderId: "stock-change" });
  s = apply("receive", { orderId: "stock-change", lines: [{ itemId: "i1", quantity: 1 }] });
  assert.throws(() => apply("countPost", { id: "stale", reason: "Stale fixture",
    lines: s.stock.filter(b => b.warehouseId === "w0").map(({ itemId, quantity, serials }) => ({ itemId, quantity, serials })) }), /Stock moved/);
  assert.throws(() => apply("order", { id: "too-many", type: "purchase", vendorId: "vendor", destinationId: "w0",
    lines: Array.from({ length: 501 }, () => ({ itemId: "i1", quantity: 1 })) }), /500/);
  for (let n = s.items.length; n < 500; n++) s.items.push({ ...s.items[1], id: `i${n}`, sku: `SKU-${n}` });
  s = apply("order", { id: "maximum-lines", type: "purchase", vendorId: "vendor", destinationId: "w0",
    lines: s.items.map(i => ({ itemId: i.id, quantity: 1 })) });
  assert.equal(s.orders.at(-1)!.lines.length, 500);
  assertInventoryInvariants(s);
});
