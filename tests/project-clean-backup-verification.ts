import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { pool } from "../server/db";
import { enableAuditing } from "../server/auditContext";
import { createCleanPgBackup, restorePgBackup } from "../server/pgBackup";
import { requireFreshCleanDestination } from "../server/cleanBackupConfiguration";

// This integration test must never use the developer/production database.
assert.ok(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "Run through the owned project-workspace sandbox.");
const { rows: [fixture] } = await pool.query("SELECT id FROM public.projects ORDER BY id LIMIT 1");
assert.ok(fixture, "The owned workspace fixture must exist.");
enableAuditing();
const id = fixture.id, token = randomUUID(), journalKey = `project_deletion_${id}-${token}`;
const targetName = "clean_verify_" + token.replaceAll("-", ""), targetUrl = new URL(process.env.DATABASE_URL!);
targetUrl.pathname = "/" + targetName;
let target: Pool | undefined, backupFile: string | undefined;
try {
  await pool.query(`INSERT INTO public.system_settings(key,value) VALUES($1,'synthetic stale cleanup record')`, [journalKey]);
  // Core choices are lazily persisted in normal operation; this owned fixture
  // must explicitly include one rather than assume startup has written them.
  const core = "CORE-" + randomUUID();
  await pool.query("INSERT INTO public.trouble_codes(code,label) VALUES($1,'Retained core configuration fixture')", [core]);
  // A project-specific trouble code must not make a configuration-only restore fail its project FK.
  const custom = "CLEAN-" + randomUUID();
  const inserted = await pool.query(`INSERT INTO public.trouble_codes(code,project_id,label)
    VALUES($1,$2,'Clean verification project code')`, [custom, id]);
  assert.equal(inserted.rowCount, 1);
  const sourceCount = (await pool.query("SELECT count(*)::int n FROM meterflo_audit.events WHERE project_id=$1", [id])).rows[0].n;
  assert.ok(sourceCount);
  const backup = await createCleanPgBackup();
  assert.equal(backup.success, true, "Clean archive generation must succeed");
  backupFile = backup.backupFile;
  const sql = await fs.readFile(backupFile, "utf8");
  assert.ok(!sql.includes(journalKey), "Do not copy stale project cleanup journals to a new installation");
  assert.ok(!sql.includes(custom), "Do not copy project-specific trouble codes");
  assert.ok((await pool.query("SELECT 1 FROM public.projects WHERE id=$1", [id])).rowCount, "Backup generation must not delete live projects");
  assert.ok((await pool.query("SELECT 1 FROM public.system_settings WHERE key=$1", [journalKey])).rowCount, "Backup generation must not delete source files/journals");
  assert.equal((await pool.query("SELECT count(*)::int n FROM meterflo_audit.events WHERE project_id=$1", [id])).rows[0].n, sourceCount);
  const refused = await restorePgBackup(backupFile, { isCleanBackup: true });
  assert.equal(refused.success, false);
  assert.match(refused.error || "", /fresh installations/);
  assert.ok((await pool.query("SELECT 1 FROM public.projects WHERE id=$1", [id])).rowCount, "A clean restore must not implicitly wipe occupied destinations");
  await pool.query(`CREATE DATABASE "${targetName}"`);
  target = new Pool({ connectionString: targetUrl.toString() });
  await requireFreshCleanDestination(target);
  execFileSync("psql", ["--no-psqlrc", "--dbname", targetUrl.toString(), "--set", "ON_ERROR_STOP=1", "--single-transaction", "--file", backupFile],
    { stdio: ["ignore", "ignore", "pipe"] });
  await requireFreshCleanDestination(target);
  const scoped = await target.query(`SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='project_id'`);
  for (const { table_name } of scoped.rows)
    assert.equal((await target.query(`SELECT count(*)::int n FROM public."${table_name}" WHERE project_id IS NOT NULL`)).rows[0].n, 0, table_name);
  assert.equal((await target.query("SELECT count(*)::int n FROM public.projects")).rows[0].n, 0);
  assert.equal((await target.query("SELECT 1 FROM pg_namespace WHERE nspname='meterflo_audit' OR nspname ~ '^project_'")).rowCount, 0);
  assert.equal((await target.query("SELECT 1 FROM public.system_settings WHERE starts_with(key,'project_deletion_')")).rowCount, 0);
  for (const table of ["import_history", "file_import_history", "customer_api_logs", "https_transfer_files", "sftp_server_events"])
    assert.equal((await target.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0].n, 0, table);
  assert.ok((await target.query("SELECT 1 FROM public.trouble_codes WHERE project_id IS NULL")).rowCount, "Keep shared/core trouble codes");
  assert.equal((await target.query("SELECT 1 FROM public.trouble_codes WHERE code=$1 AND project_id IS NULL", [core])).rowCount, 1);
  await target.query("INSERT INTO public.trouble_codes(code,label) VALUES($1,'Fresh-install identity verification')", ["FRESH-" + randomUUID()]);
  await target.query("INSERT INTO public.system_settings(key,value) VALUES('clean_verify_after_restore','true')");
  await fs.mkdir("generated-artifacts/project-deletion", { recursive: true });
  await fs.writeFile("generated-artifacts/project-deletion/clean-backup-verification.json", JSON.stringify({
    configurationArchiveRestoredIntoFreshDatabase: true, projectScopedTablesChecked: scoped.rowCount,
    projectDataAndLogsEmpty: true, noProjectSchemasOrAuditHistoryIncluded: true,
    sourceProjectAndAuditPreserved: true, occupiedDestinationRefusedWithoutChanges: true,
  }, null, 2));
  console.log("PASS: Clean archive restored into a fresh database; project data/logs excluded; source unchanged; occupied destination protected.");
} finally {
  await pool.query("DELETE FROM public.system_settings WHERE key=$1", [journalKey]);
  await target?.end();
  await pool.query(`DROP DATABASE IF EXISTS "${targetName}"`);
  if (backupFile) await fs.rm(backupFile, { force: true });
  await pool.end();
}
