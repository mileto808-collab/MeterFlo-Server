// Actual scheduled archive -> native PostgreSQL and MeterFlo restore.
// Runs only against the owned, disposable project-workspace sandbox.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { request } = require("@playwright/test");
const { Client } = require("pg");
const unzipper = require("unzipper");

(async () => {
  assert.ok(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "Owned sandbox required");
  const config = JSON.parse(await fs.readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "utf8"));
  assert.equal(config.ownedWorkspaceSandbox, true);
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const api = await request.newContext({ baseURL, timeout: 180000 });
  const root = path.dirname(process.env.WORKSPACE_UI_SANDBOX_CONFIG);
  const documents = path.join(root, "files");
  const source = new Client({ connectionString: process.env.DATABASE_URL });
  const restoredName = `backup_recovery_${randomUUID().replaceAll("-", "")}`;
  const restoredUrl = new URL(process.env.DATABASE_URL);
  assert.equal(restoredUrl.hostname, "127.0.0.1", "Disposable local PostgreSQL only");
  restoredUrl.pathname = `/${restoredName}`;
  let created = false;
  async function json(method, url, data, expected = 200) {
    const response = await api.fetch(url, { method, data });
    const text = await response.text();
    assert.equal(response.status(), expected, `${method} ${url}: ${text.slice(0, 1000)}`);
    return JSON.parse(text);
  }
  try {
    await source.connect();
    await json("POST", "/api/auth/local/login", fixture);
    await fs.mkdir(documents, { recursive: true });
    const marker = `recovery-file-${randomUUID()}`;
    const documentPath = path.join(documents, "recovery-proof.txt");
    await fs.writeFile(documentPath, marker);
    const projectBefore = (await source.query("SELECT id,name FROM public.projects ORDER BY id")).rows;
    assert.ok(projectBefore.length > 0);
    const base = "/api/maintenance/backups";
    await json("PUT", base + "/destination", { kind: "local", path: path.join(root, "recovery-backups"), bucketId: "" });
    const schedule = await json("POST", base + "/schedules", {
      name: "Complete recovery proof", backupType: "recovery", cron: "0 2 * * *", timezone: "UTC",
      enabled: false, retentionDays: 7, minimumCopies: 2,
    }, 201);
    const run = await json("POST", base + `/schedules/${schedule.id}/run`, {}, 202);
    let finished;
    for (let attempt = 0; attempt < 120; attempt++) {
      finished = (await json("GET", base + `/runs?scheduleId=${schedule.id}`)).rows.find(row => row.id === run.id);
      if (finished && !["queued", "running"].includes(finished.status)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(finished?.status, "succeeded", JSON.stringify(finished));
    const download = await api.get(base + `/runs/${run.id}/download`);
    assert.equal(download.status(), 200);
    const bytes = await download.body();
    const archive = await unzipper.Open.buffer(bytes);
    const entry = name => {
      const value = archive.files.find(file => file.path === name);
      assert.ok(value, `Missing ${name}`);
      return value;
    };
    const metadata = JSON.parse((await entry("backup_metadata.json").buffer()).toString());
    assert.equal(metadata.backupType, "recovery");
    assert.equal(metadata.format, "pg_dump_full");
    assert.equal(metadata.includesDatabase, true);
    assert.equal(metadata.includesProjectFiles, true);
    assert.equal((await entry("project_files/recovery-proof.txt").buffer()).toString(), marker);
    assert.match((await entry("RESTORE_INSTRUCTIONS.txt").buffer()).toString(), /PSQL Tool/);

    const sqlPath = path.join(root, "recovery-proof.sql");
    await fs.writeFile(sqlPath, await entry("database_backup.sql").buffer());
    await source.query(`CREATE DATABASE "${restoredName}"`);
    created = true;
    const native = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-d", restoredUrl.toString(), "-f", sqlPath],
      { encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    assert.equal(native.status, 0, native.stderr?.slice(-5000));
    const target = new Client({ connectionString: restoredUrl.toString() });
    await target.connect();
    try {
      assert.deepEqual((await target.query("SELECT id,name FROM public.projects ORDER BY id")).rows, projectBefore);
      assert.equal((await target.query("SELECT backup_type FROM public.backup_schedules WHERE id=$1", [schedule.id])).rows[0].backup_type, "recovery");
    } finally { await target.end(); }
    console.log("PASS scheduled recovery SQL restores through native PostgreSQL psql (the pgAdmin PSQL Tool format).");

    // Deliberately change a harmless destination row/file, then restore this
    // owned installation via the actual MeterFlo upload route.
    await source.query("UPDATE public.projects SET name=$1 WHERE id=$2", ["Changed after backup", projectBefore[0].id]);
    await fs.writeFile(documentPath, "Changed after backup");
    const restored = await api.post("/api/system/restore", {
      multipart: {
        backup: { name: "complete-recovery.zip", mimeType: "application/zip", buffer: bytes },
        restoreFiles: "true", clearExisting: "false",
      },
      timeout: 180000,
    });
    const outcome = await restored.json();
    assert.equal(restored.status(), 200, JSON.stringify(outcome));
    assert.equal(outcome.success, true, JSON.stringify(outcome));
    assert.equal(outcome.databaseCommitted, true);
    assert.ok(outcome.filesRestored > 0);
    assert.deepEqual((await source.query("SELECT id,name FROM public.projects ORDER BY id")).rows, projectBefore);
    assert.equal(await fs.readFile(documentPath, "utf8"), marker);
    console.log("PASS the same scheduled ZIP restores database data and project attachments through MeterFlo.");
  } finally {
    if (created) await source.query(`DROP DATABASE "${restoredName}" WITH (FORCE)`).catch(() => {});
    await source.end();
    await api.dispose();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
