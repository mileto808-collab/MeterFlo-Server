import { test } from "node:test";
import assert from "node:assert/strict";
import { createRestoreStore } from "../client/src/lib/system-restore-state";

function memoryStorage() {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
    removeItem: (key: string) => { entries.delete(key); } };
}
test("restore cannot be started twice and completion cannot be overwritten by delayed progress", () => {
  const store = createRestoreStore();
  assert.equal(store.begin(), true);
  assert.equal(store.begin(), false);
  store.progress({ stage: "processing", message: "Working", percent: 95 });
  assert.equal(store.getSnapshot()?.phase, "processing");
  store.finish("complete", "Confirmed by server");
  store.progress({ stage: "uploading", message: "Late progress", percent: 50 });
  assert.deepEqual(store.getSnapshot(), { phase: "complete", message: "Confirmed by server" });
});
test("reload never invents success or restarts a server operation", () => {
  const storage = memoryStorage();
  const original = createRestoreStore(storage);
  original.begin();
  const restored = createRestoreStore(storage);
  assert.equal(restored.getSnapshot()?.phase, "unconfirmed");
  assert.equal(restored.begin(), false);
  restored.clearMarkerForNavigation();
  assert.equal(restored.getSnapshot()?.phase, "unconfirmed", "Keep content hidden until navigation");
  assert.equal(createRestoreStore(storage).getSnapshot(), null);
});
test("partial failures, lost responses and unavailable browser storage remain explicit", () => {
  const store = createRestoreStore({ getItem() { throw Error(); }, setItem() { throw Error(); }, removeItem() { throw Error(); } });
  store.begin();
  store.finish("incomplete", "Database restored; files incomplete");
  assert.equal(store.getSnapshot()?.phase, "incomplete");
  store.finish("unconfirmed", "Outcome unknown");
  assert.equal(store.getSnapshot()?.phase, "unconfirmed");
  store.clearMarkerForNavigation();
});
