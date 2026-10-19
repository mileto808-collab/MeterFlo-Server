import test from "node:test";
import assert from "node:assert/strict";
import { backupDestinationSchema, backupScheduleSchema } from "../shared/backup-schedules";
import { nextBackupTime, expiredBackups } from "../server/backups/service";
import { cloudKey, backupFiles, probeDestination } from "../server/backups/files";
import { pool } from "../server/db";
test.after(() => pool.end());
const input = { name: "Nightly", backupType: "database", cron: "0 2 * * *", timezone: "America/New_York", enabled: true, retentionDays: 30, minimumCopies: 2 };
test("backup policy validates types, timezone and deletion safety minimums", () => {
  assert.equal(backupScheduleSchema.parse(input).minimumCopies, 2);
  for (const invalid of [{ retentionDays: 0 }, { minimumCopies: 0 }, { backupType: "unknown" }, { timezone: "bad/timezone" }])
    assert.equal(backupScheduleSchema.safeParse({ ...input, ...invalid }).success, false);
  assert.equal(backupDestinationSchema.safeParse({ kind: "app_storage", path: "backups", bucketId: "" }).success, false);
});
test("cron is timezone aware, validates five fields, and returns a future time", () => {
  const next = nextBackupTime("0 2 * * *", "America/New_York");
  assert.ok(next.getTime() > Date.now());
  assert.equal(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: "America/New_York" }).format(next), "02");
  assert.throws(() => nextBackupTime("* * * * * *", "UTC"));
  assert.throws(() => nextBackupTime("invalid", "UTC"));
});
test("retention preserves newest successful copies even after a long outage", () => {
  const now = Date.now(), rows = [1, 2, 3].map(id => ({ id: String(id), completed_at: new Date(now - (40 + id) * 86400000) }));
  assert.deepEqual(expiredBackups(rows, 30, 2, now).map(row => row.id), ["3"]);
  assert.deepEqual(expiredBackups(rows, 30, 3, now), []);
  assert.deepEqual(expiredBackups([{ id: "1", completed_at: new Date(now) }], 30, 1, now), []);
});
test("cloud backup keys cannot address unrelated objects or escape their prefix", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  assert.equal(cloudKey({ kind: "app_storage", path: "meterflo/backups", bucketId: "private-bucket" }, id),
    `meterflo/backups/meterflo-scheduled-backups/${id}.zip`);
  assert.throws(() => cloudKey({ kind: "app_storage", path: "../outside", bucketId: "bucket" }, id));
  assert.throws(() => cloudKey({ kind: "app_storage", path: "backups", bucketId: "bucket" }, "../../secret"));
});
test("App Storage verifies upload/read/delete and never overwrites an existing backup", async t => {
  const { Client } = await import("@replit/object-storage");
  const calls: string[] = [];
  t.mock.method(Client.prototype, "uploadFromFilename", async (key: string) => { calls.push(key); return { ok: true, value: null }; });
  t.mock.method(Client.prototype, "downloadAsText", async () => ({ ok: true, value: "MeterFlo backup destination check" }));
  t.mock.method(Client.prototype, "delete", async (key: string) => { calls.push(key); return { ok: true, value: null }; });
  const destination = { kind: "app_storage" as const, path: "tests/backups", bucketId: "private-fixture-bucket" };
  assert.deepEqual(await probeDestination(destination), destination);
  assert.equal(calls.length, 2); assert.equal(calls[0], calls[1]);
  t.mock.method(Client.prototype, "exists", async () => ({ ok: true, value: true }));
  await assert.rejects(backupFiles.put(destination, "00000000-0000-4000-8000-000000000001", "fixture.zip"), /not be overwritten/);
  assert.equal(calls.length, 2);
  t.mock.method(Client.prototype, "delete", async () => ({ ok: false, error: { message: "fixture failure" } }));
  await assert.rejects(backupFiles.remove(destination, "00000000-0000-4000-8000-000000000001"), /cleanup failed/);
});
