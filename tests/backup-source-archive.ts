// Only invoked by the owned database sandbox; no inherited production target.
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import unzipper from "unzipper";
import { createPgBackupFile } from "../server/pgBackup";
import { pool } from "../server/db";
import { backupFiles, probeDestination } from "../server/backups/files";
if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-source-backup-test-"));
const previous = process.cwd();
try {
  const source = path.join(root, "source");
  await fs.mkdir(path.join(source, "meterflo-scheduled-backups"), { recursive: true });
  await fs.writeFile(path.join(source, "hello.ts"), "export const hello = true;");
  await fs.writeFile(path.join(source, ".env"), "SAFE_TEST_FIXTURE_ONLY=true");
  await fs.writeFile(path.join(source, "meterflo-scheduled-backups", "not-source.zip"), "fixture");
  process.chdir(source);
  const zip = path.join(root, "source.zip");
  await createPgBackupFile(zip, "files");
  const archive = await unzipper.Open.file(zip);
  assert.ok(archive.files.some(file => file.path === "webapp_files/hello.ts"));
  assert.ok(!archive.files.some(file => /not-source|\.env$/.test(file.path)));
  const metadata = JSON.parse((await archive.files.find(file => file.path === "backup_metadata.json")!.buffer()).toString());
  assert.equal(metadata.backupType, "files");
  const destination = await probeDestination({ kind: "local", path: path.join(root, "destination"), bucketId: "" });
  const link = fs.link;
  const id = "00000000-0000-4000-8000-000000000001";
  try {
    fs.link = async () => { throw Object.assign(new Error("Fixture: no hard-link support"), { code: "ENOTSUP" }); };
    await backupFiles.put(destination, id, zip);
    const saved = path.join(destination.path, "meterflo-scheduled-backups", id + ".zip");
    assert.deepEqual(await fs.readFile(saved), await fs.readFile(zip));
    await assert.rejects(backupFiles.put(destination, id, zip), /exist/i);
    assert.deepEqual(await fs.readFile(saved), await fs.readFile(zip));
  } finally { fs.link = link; }
  console.log("Source backup archive excludes credentials and managed backups.");
} finally {
  process.chdir(previous); await fs.rm(root, { recursive: true, force: true }); await pool.end();
}
