import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inventoryCountReference } from "../shared/inventory-count-reference";
import { emptyInventory } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";

test("existing UUID-only counts have readable project-scoped references without mutating identities", () => {
  const counts = [
    { id: randomUUID(), status: "cancelled" },
    { id: randomUUID(), status: "open" },
    { id: randomUUID(), status: "posted" },
  ];
  const before = structuredClone(counts);
  for (const count of [...counts].reverse().filter(c => c.status !== "cancelled"))
    assert.equal(inventoryCountReference(counts, count.id), `Count #${counts.indexOf(count) + 1}`);
  assert.equal(inventoryCountReference(counts, counts[0].id), "Count #1");
  assert.deepEqual(counts, before);
  const restored = JSON.parse(JSON.stringify(counts));
  assert.equal(inventoryCountReference(restored, counts[2].id), "Count #3");
  assert.match(inventoryCountReference(counts, "missing"), /unavailable/);
});

test("new, cancelled and posted counts retain the same reference and command IDs", () => {
  let state = emptyInventory();
  const post = (action: "warehouse" | "countStart" | "countCancel" | "countPost", data: Record<string, unknown>) => {
    state = applyInventoryCommand(state, { operationId: randomUUID(), action, data }, "fixture", true).state;
  };
  post("warehouse", { id: "main", code: "MAIN", name: "Main warehouse", type: "physical", address: "Test only" });
  const first = randomUUID(), second = randomUUID();
  post("countStart", { id: first, warehouseId: "main" });
  assert.equal(inventoryCountReference(state.counts, first), "Count #1");
  post("countCancel", { id: first, reason: "Fixture cancellation" });
  post("countStart", { id: second, warehouseId: "main" });
  post("countPost", { id: second, lines: [], reason: "Empty warehouse verified" });
  assert.equal(inventoryCountReference(state.counts, first), "Count #1");
  assert.equal(inventoryCountReference(state.counts, second), "Count #2");
  assert.equal(state.counts[0].status, "cancelled");
  assert.equal(state.counts[1].status, "posted");
  assert.equal(state.receipts[0].reference, second);
});
