import assert from "node:assert/strict";
import test from "node:test";
import { watchPageActivity } from "../client/src/lib/page-stream-lifecycle";

function fixture(initial = "visible") {
  const page = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: initial });
  const calls: string[] = [];
  const stop = watchPageActivity(
    () => calls.push("resume"), () => calls.push("pause"),
    page as unknown as Window, doc as unknown as Document,
  );
  return { page, doc, calls, stop, visibility(value: string) {
    doc.visibilityState = value;
    doc.dispatchEvent(new Event("visibilitychange"));
  } };
}

test("only active pages retain streams, and returning tabs reconnect once", () => {
  const f = fixture();
  assert.deepEqual(f.calls, ["resume"]);
  f.visibility("hidden");
  f.visibility("hidden");
  assert.deepEqual(f.calls, ["resume", "pause"]);
  f.visibility("visible");
  f.page.dispatchEvent(new Event("pageshow"));
  assert.deepEqual(f.calls, ["resume", "pause", "resume"]);
  f.stop();
  f.visibility("visible");
  assert.deepEqual(f.calls, ["resume", "pause", "resume", "pause"]);
});

test("background initialization does not open streams", () => {
  const f = fixture("hidden");
  assert.deepEqual(f.calls, []);
  f.visibility("visible");
  assert.deepEqual(f.calls, ["resume"]);
  f.stop();
});

test("navigation releases connections before pagehide; a cancelled navigation recovers", async () => {
  const f = fixture();
  f.page.dispatchEvent(new Event("beforeunload"));
  assert.deepEqual(f.calls, ["resume", "pause"]);
  await new Promise(resolve => setTimeout(resolve, 2100));
  assert.deepEqual(f.calls, ["resume", "pause", "resume"]);
  f.page.dispatchEvent(new Event("beforeunload"));
  f.page.dispatchEvent(new Event("pagehide"));
  f.stop();
  assert.deepEqual(f.calls, ["resume", "pause", "resume", "pause"]);
});
