import assert from "node:assert/strict";
import { test } from "node:test";
import { movementCaptureComplete } from "../client/src/lib/inventory-wizard-validation";

const line = (quantityText = "2", serials: string[] = [], serialized = true, limit = 3) =>
  movementCaptureComplete({ quantityText, serials, serialized, limit });

test("serialized movements cannot advance without exactly one unique scan per unit", () => {
  assert.equal(line(), false);
  assert.equal(line("2", ["A"]), false);
  assert.equal(line("2", ["A", "A"]), false);
  assert.equal(line("2", ["A", "B", "C"]), false);
  assert.equal(line("2", ["A", "B"]), true);
});
test("all quantity boundaries apply before movement confirmation", () => {
  for (const quantity of ["-1", "1.5", "NaN", "bad", "Infinity", "9007199254740992", "4"]) {
    assert.equal(line(quantity, [], false), false, quantity);
  }
  assert.equal(line("1", ["A"], true, 0), false);
  assert.equal(line("3", [], false), true);
});
test("unselected lines may stay empty but retained scans cannot be silently skipped", () => {
  assert.equal(line(""), true);
  assert.equal(line("0"), true);
  assert.equal(line("", ["A"]), false);
  assert.equal(line("0", ["A"]), false);
  assert.equal(line("1", ["A"], false), false);
});
