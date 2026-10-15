import assert from "node:assert/strict";
import { test } from "node:test";
import { ShipmentCheckpointWriter } from "../client/src/lib/inventory-shipment-checkpoint-writer";
import { blankShipmentCapture, type SavedShipmentDraft } from "../shared/inventory-shipment-draft-model";

const capture = (text: string) => ({ ...blankShipmentCapture(), scanBuffers: { "meter-goodSerials": text } });
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};
function fixture() {
  let stored: SavedShipmentDraft | undefined;
  const requests: any[] = [], confirmed: SavedShipmentDraft[] = [];
  let mode: "normal" | "offline" | "lost-and-offline" | "lost" = "normal";
  let gate: ReturnType<typeof deferred> | undefined;
  const operations = new Map<string, SavedShipmentDraft>();
  const writer = new ShipmentCheckpointWriter({
    orderId: "PO-test", stage: "receive", ownerId: "inspector",
    send: async attempt => {
      requests.push(structuredClone(attempt));
      if (gate) await gate.promise;
      if (mode === "offline") throw new Error("offline");
      if (!operations.has(attempt.operationId)) {
        assert.equal(attempt.data.revision, stored?.revision ?? 0);
        stored = { id: attempt.data.id, revision: attempt.data.revision + 1, orderId: "PO-test", stage: "receive",
          capture: structuredClone(attempt.data.capture), ownerId: "inspector", pending: null, savedAt: "2026-10-15T00:00:00Z" };
        operations.set(attempt.operationId, structuredClone(stored));
      }
      if (mode === "lost-and-offline" || mode === "lost") throw new Error("lost response");
      return structuredClone(stored!);
    },
    find: async () => {
      if (mode === "offline" || mode === "lost-and-offline") throw new Error("offline");
      return structuredClone(stored);
    },
    confirmed: draft => confirmed.push(structuredClone(draft)),
  });
  return { writer, requests, confirmed, mode: (value: typeof mode) => { mode = value; },
    gate: () => (gate = deferred()), stored: () => stored,
    change: (draft: SavedShipmentDraft) => { stored = draft; } };
}

test("checkpoints serialize writes and keep exact newer scanner buffers", async () => {
  const f = fixture(), gate = f.gate(), first = capture("0000 ");
  const one = f.writer.save(first);
  first.scanBuffers["meter-goodSerials"] = "must not mutate pending snapshot";
  const two = f.writer.save(capture("0000004\n"));
  await Promise.resolve();
  assert.equal(f.requests.length, 1);
  gate.release();
  await Promise.all([one, two]);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].data.capture.scanBuffers["meter-goodSerials"], "0000 ");
  assert.equal(f.requests[1].data.revision, 1);
  assert.equal(f.stored()!.capture.scanBuffers["meter-goodSerials"], "0000004\n");
  assert.equal(f.stored()!.revision, 2);
});

test("unconfirmed saves replay exact identity before later local edits can save", async () => {
  const f = fixture();
  f.mode("lost-and-offline");
  await assert.rejects(f.writer.save(capture("0001")), /retained/);
  assert.equal(f.stored()!.revision, 1);
  assert.equal(f.writer.current, undefined);
  f.mode("normal");
  await f.writer.save(capture("0001 trailing raw "));
  assert.deepEqual(f.requests[1], f.requests[0]);
  assert.notEqual(f.requests[2].operationId, f.requests[0].operationId);
  assert.equal(f.requests[2].data.revision, 1);
  assert.equal(f.stored()!.revision, 2);
  assert.equal(f.stored()!.capture.scanBuffers["meter-goodSerials"], "0001 trailing raw ");
});

test("lost responses are confirmed by exact revision and capture without duplicate save", async () => {
  const f = fixture(); f.mode("lost");
  const result = await f.writer.save(capture("0000007"));
  assert.equal(result.revision, 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.confirmed.length, 1);
});

test("invalid local capture can be corrected without replaying a rejected body", async () => {
  const f = fixture();
  await assert.rejects(f.writer.save(capture("x".repeat(1001))), /Correct it/);
  assert.equal(f.requests.length, 0);
  await f.writer.save(capture("000004"));
  assert.equal(f.stored()!.revision, 1);
});

test("conflicting, owned elsewhere, or prepared server captures never replace local capture", async () => {
  for (const kind of ["capture", "owner", "pending", "revision"]) {
    const f = fixture();
    await f.writer.save(capture("baseline"));
    f.mode("lost-and-offline");
    await assert.rejects(f.writer.save(capture("local capture")), /retained/);
    const remote = structuredClone(f.stored()!);
    if (kind === "capture") remote.capture = capture("other tab");
    if (kind === "owner") remote.ownerId = "other inspector";
    if (kind === "pending") remote.pending = { operationId: crypto.randomUUID(), payload: { orderId: "PO-test" } };
    if (kind === "revision") remote.revision++;
    f.change(remote); f.mode("normal");
    await assert.rejects(f.writer.save(capture("newer local capture")), /changed in another session/);
    assert.equal(f.writer.current!.capture.scanBuffers["meter-goodSerials"], "baseline");
    assert.deepEqual(f.stored(), remote);
    assert.equal(f.requests.length, 3, "only the exact unknown attempt was retried");
  }
});
