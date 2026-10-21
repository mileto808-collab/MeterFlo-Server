import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptFulfillmentScans } from "../client/src/lib/fulfillment-scans";

test("rejects repeated Enter and Tab scans without changing serial identity", () => {
  for (const delimiter of ["\n", "\t", "\r\n"]) {
    assert.deepEqual(acceptFulfillmentScans(`00021${delimiter}00021${delimiter}`), {
      text: "00021\n", rejected: ["00021"],
    });
  }
});
test("deduplicates pasted lists including the last entry", () => {
  assert.deepEqual(acceptFulfillmentScans("A, B; A\nB", [], true), { text: "A\nB\n", rejected: ["A", "B"] });
});
test("does not reject an unfinished serial that shares an existing prefix", () => {
  assert.deepEqual(acceptFulfillmentScans("A\nA"), { text: "A\nA", rejected: [] });
  assert.deepEqual(acceptFulfillmentScans("A\nA1", [], true), { text: "A\nA1\n", rejected: [] });
});
test("rejects serials in other lines or already physically moved in this phase", () => {
  assert.deepEqual(acceptFulfillmentScans("A\nB\nC", ["A", "B"], true), { text: "C\n", rejected: ["A", "B"] });
});
test("does not discard valid scans when rejecting a duplicate at commit", () => {
  assert.deepEqual(acceptFulfillmentScans("A\nB\nA", [], true), { text: "A\nB\n", rejected: ["A"] });
});
