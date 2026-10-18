import { test } from "node:test";
import assert from "node:assert/strict";
import { accessLockUpdate, type AccessLock } from "../shared/access-locks";
import { accessLockContext, projectAccessVisible } from "../server/accessLockContext";

test("access-lock inputs require a bounded message, explicit action and concurrency version", () => {
  const input = { locked: true, message: " Maintenance ", expectedUpdatedAt: null };
  assert.equal(accessLockUpdate.parse(input).message, "Maintenance");
  for (const invalid of [
    { ...input, message: " " }, { ...input, message: "x".repeat(1001) },
    { ...input, expectedUpdatedAt: "yesterday" }, { ...input, locked: "true" },
    { ...input, bypass: true }, { locked: true, message: "Maintenance" },
  ]) assert.equal(accessLockUpdate.safeParse(invalid).success, false);
  assert.equal(accessLockUpdate.safeParse({ ...input, locked: false, message: "" }).success, true);
});

test("project locks cannot leak between concurrent request contexts or into background services", async () => {
  const lock: AccessLock = { scope: "project", projectId: 7, locked: true, message: "Maintenance", updatedAt: null, updatedBy: null };
  assert.equal(projectAccessVisible(7), true);
  await Promise.all([
    accessLockContext.run(new Map([[7, lock]]), async () => {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(projectAccessVisible(7), false);
      assert.equal(projectAccessVisible(8), true);
    }),
    accessLockContext.run(new Map(), async () => {
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(projectAccessVisible(7), true);
    }),
  ]);
  assert.equal(projectAccessVisible(7), true);
});
