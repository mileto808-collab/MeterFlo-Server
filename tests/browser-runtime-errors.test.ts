import test from "node:test";
import assert from "node:assert/strict";
import { isResizeDeliveryNotice, runtimeError } from "../client/src/lib/browser-runtime-errors";

test("only exact native resize delivery notices are classified as non-fatal", () => {
  for (const message of ["ResizeObserver loop completed with undelivered notifications.", "ResizeObserver loop limit exceeded"]) {
    assert.equal(isResizeDeliveryNotice({ message, error: null }), true);
    assert.equal(isResizeDeliveryNotice({ message, error: new Error(message) }), false);
  }
  assert.equal(isResizeDeliveryNotice({ message: "ResizeObserver failed to render", error: null }), false);
  assert.equal(isResizeDeliveryNotice({ message: "Uncaught TypeError", error: null }), false);
});

test("real exceptions keep their identity and original stack", () => {
  const error = new TypeError("Actual exception");
  assert.equal(runtimeError(error, "fallback"), error);
});

test("non-Error diagnostics keep their messages without serializing private payloads", () => {
  assert.equal(runtimeError("String rejection", "fallback").message, "String rejection");
  const object = { message: "Object rejection", stack: "original stack", token: "not-to-be-serialized" };
  const error = runtimeError(object, "fallback");
  assert.equal(error.message, object.message);
  assert.equal(error.stack, object.stack);
  assert.equal(runtimeError({ token: "not-to-be-serialized" }, "safe fallback").message, "safe fallback");
  const opaque = Object.defineProperty({}, "message", { get() { throw new Error("opaque"); } });
  assert.equal(runtimeError(opaque, "safe fallback").message, "safe fallback");
});
