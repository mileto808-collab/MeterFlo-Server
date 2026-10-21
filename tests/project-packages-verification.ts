import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { createProjectSchema, migrateProjectSchema } from "../server/projectDb";
import { initializeAudit } from "../server/auditMigration";
import { enableAuditing } from "../server/auditContext";
import { createProjectPackage, openProjectPackage, packageRows } from "../server/project-packages/archive";
import { restoreProjectPackage } from "../server/project-packages/restore";
import { getProjectDirectoryName } from "../server/fileStorage";
import { postInventory } from "../server/inventoryService";
import archiver from "archiver";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { defaultExchangeRef, exchangeStore } from "../server/file-transfers/https-storage";
import { deleteProjectCompletely } from "../server/projectDeletion";

assert.ok(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "Never run on a real database.");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-package-test-"));
const source = (await pool.query("SELECT * FROM public.projects ORDER BY id LIMIT 1")).rows[0];
const other = await storage.createProject({ name: "Unrelated PRIVATE Canary " + randomUUID().slice(0, 8) });
const destination = await storage.createProject({ name: "Dedicated Restored " + randomUUID().slice(0, 8) });
const schema = await createProjectSchema(destination.name, destination.id);
await migrateProjectSchema(schema);
await storage.updateProject(destination.id, { databaseName: schema } as any);
await pool.query("INSERT INTO public.system_settings(key,value) VALUES('project_files_path',$1),('ftp_files_path',$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
  [path.join(root, "documents"), path.join(root, "ftp")]);
await initializeAudit(pool); enableAuditing();
const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
const actor = (await storage.getUserByUsername(fixture.username))!;
const warehouse = (await pool.query("SELECT id FROM public.inventory_warehouses WHERE project_id=$1 LIMIT 1", [source.id])).rows[0].id;
const command = (action: string, data: any) => postInventory(source.id, { operationId: randomUUID(), action, data } as any, actor.id, true);
await command("vendor", { id: "portable-vendor", name: "Portable stock supplier" });
await command("item", { id: "portable-meter", sku: "PORTABLE-METER", name: "Portable serialized meter", tracking: "serialized", unit: "each" });
await command("order", { id: "portable-po", type: "purchase", vendorId: "portable-vendor", destinationId: warehouse,
  lines: [{ itemId: "portable-meter", quantity: 3 }] });
await command("release", { orderId: "portable-po" });
await command("receive", { orderId: "portable-po", lines: [{ itemId: "portable-meter", quantity: 3, serials: ["PKG-001", "PKG-002", "PKG-003"] }] });
const historical = await storage.createLocalUser("Historical_package_operator", "DO_NOT_EXPORT_PASSWORD_CANARY", "user", "Historical", "Operator");
await pool.query(`INSERT INTO "${source.database_name}".work_orders(customer_wo_id,customer_name,created_by,updated_by,new_system_reading)
  VALUES('CUST-PRIVATE-301','Owned project customer',$1,$1,123.4500)`, [historical.username]);
const folder = getProjectDirectoryName(source.name, source.id);
const documents = path.join(root, "documents", folder), ftp = path.join(root, "ftp", folder, "Project FTP Files");
await fs.mkdir(path.join(documents, "Project Documents"), { recursive: true });
await fs.writeFile(path.join(documents, "Project Documents", "evidence.txt"), "project document canary");
await fs.mkdir(path.join(documents, "Project FTP Files"), { recursive: true });
await fs.writeFile(path.join(documents, "Project FTP Files", "retained-old-ftp.csv"), "Retained original project-owned FTP file");
await fs.mkdir(path.join(ftp, "incoming"), { recursive: true });
await fs.writeFile(path.join(ftp, "incoming", "orders.csv"), "Customer WO,Status\nCUST-PRIVATE-301,Open");
await fs.mkdir(path.join(root, "documents", `inventory-${source.id}`), { recursive: true });
await fs.writeFile(path.join(root, "documents", `inventory-${source.id}`, "inspection.jpg"), "owned inspection evidence");
const ref = await defaultExchangeRef(source.id), credentialId = randomUUID(), fileId = randomUUID();
const objectKey = `meterflo-exchange/${source.id}/${randomUUID()}.bin`, exchangeBytes = Buffer.from("Owned secure exchange project bytes");
await exchangeStore.put(ref, objectKey, exchangeBytes);
await pool.query(`INSERT INTO public.https_transfer_settings(project_id,enabled,provider,location) VALUES($1,true,$2,$3)`, [source.id, ref.provider, ref.location]);
await pool.query(`INSERT INTO public.https_transfer_credentials(id,project_id,name,token_hash,token_prefix,can_upload,can_download,expires_at)
  VALUES($1,$2,'Historical customer token','DO_NOT_EXPORT_PASSWORD_CANARY','fixture',true,true,now()+interval '1 day')`, [credentialId, source.id]);
await pool.query(`INSERT INTO public.https_transfer_files(id,project_id,direction,credential_id,file_name,size,sha256,provider,location,storage_key,status)
  VALUES($1,$2,'incoming',$3,'utility-orders.csv',$4,$5,$6,$7,$8,'ready')`,
  [fileId, source.id, credentialId, exchangeBytes.length, createHash("sha256").update(exchangeBytes).digest("hex"), ref.provider, ref.location, objectKey]);
await pool.query(`INSERT INTO public.sftp_server_accounts(id,project_id,username,label,auth_type,password_hash,can_upload,can_download,expires_at)
  VALUES($1,$2,'fixture_project_sftp','Historical transfer account','password','DO_NOT_EXPORT_PASSWORD_CANARY',true,true,now()+interval '1 day')`,
  [randomUUID(), source.id]);
await pool.query(`INSERT INTO public.api_import_configs(project_id,settings) VALUES($1,$2)`, [source.id,
  JSON.stringify({ name: "Restored polling configuration", endpoint: "https://example.invalid", isEnabled: true, intervalMinutes: 15, filter: { isEnabled: true } })]);
// Preserve inventory even after it is switched off. The fixture contains posted stock.
await pool.query("UPDATE public.projects SET inventory_enabled=false WHERE id=$1", [source.id]);
const beforeInventory = await pool.query("SELECT count(*) FROM public.inventory_items WHERE project_id=$1", [source.id]);
assert.ok(Number(beforeInventory.rows[0].count) > 0, "Test must contain actual inventory");
const beforeAudit = Number((await pool.query("SELECT count(*) FROM meterflo_audit.events WHERE project_id=$1", [source.id])).rows[0].count);
let output: Awaited<ReturnType<typeof createProjectPackage>> | undefined, analytical: Pool | undefined;
const database = `project_analysis_${randomUUID().replaceAll("-", "")}`, url = new URL(process.env.DATABASE_URL!);
try {
  output = await createProjectPackage(source.id);
  assert.equal((await fs.readFile(path.join(output.directory, "project.backup"))).subarray(0, 5).toString(), "PGDMP");
  assert.equal(output.manifest.snapshot.counts["public.projects"], 1);
  const opened = await openProjectPackage(output.zip);
  try {
    for (const table of opened.manifest.snapshot.tables)
      for await (const row of packageRows(opened.directory, opened.manifest, table)) {
        if (row.project_id != null) assert.equal(Number(row.project_id), source.id, "No other project's data");
        if (table.schema === "public" && table.name === "projects") assert.equal(row.id, source.id);
        if (table.name === "users") { assert.equal(row.is_locked, true); assert.equal(row.subrole_id, null); }
        assert.ok(!JSON.stringify(row).includes("DO_NOT_EXPORT_PASSWORD_CANARY"), "Credentials must not escape into package data");
      }
  } finally { await fs.rm(opened.directory, { recursive: true, force: true }); }
  await pool.query(`CREATE DATABASE "${database}"`); url.pathname = "/" + database;
  execFileSync("pg_restore", ["--no-owner", "--no-acl", "--exit-on-error", "--single-transaction", "--dbname", url.toString(), path.join(output.directory, "project.backup")],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 60000 });
  analytical = new Pool({ connectionString: url.toString() });
  const dataSchema = output.manifest.snapshot.schemas.public;
  assert.equal(Number((await analytical.query(`SELECT count(*) FROM "${dataSchema}".projects`)).rows[0].count), 1);
  assert.equal(Number((await analytical.query(`SELECT count(*) FROM "${dataSchema}".inventory_items`)).rows[0].count), Number(beforeInventory.rows[0].count));
  await analytical.query(`INSERT INTO "${dataSchema}".system_settings(key,value) VALUES('post_restore_sequence','ok')`);
  assert.equal((await analytical.query(`SELECT new_system_reading::text AS reading FROM "${output.manifest.snapshot.schemas[source.database_name]}".work_orders WHERE customer_wo_id='CUST-PRIVATE-301'`)).rows[0].reading, "123.4500");
  // Checksummed inventories must reject damaged files before changing a destination.
  const corrupt = path.join(root, "corrupt.zip"), stream = createWriteStream(corrupt), archive = archiver("zip");
  const done = finished(stream); archive.pipe(stream);
  archive.file(path.join(output.directory, "manifest.json"), { name: "manifest.json" });
  for (const file of output.manifest.files) {
    if (file.path === "README.txt") archive.append("corrupted README", { name: file.path });
    else archive.file(path.join(output.directory, file.path), { name: file.path });
  }
  await Promise.all([archive.finalize(), done]);
  await assert.rejects(restoreProjectPackage(corrupt, destination.id), /size|checksum/);
  const original = (await pool.query("SELECT password_hash FROM public.users WHERE username='admin'")).rows[0]?.password_hash;
  const config = JSON.parse(await fs.readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG!, "utf8"));
  const login = await fetch(config.baseURL + "/api/auth/local/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fixture) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const form = new FormData();
  form.append("backup", new Blob([await fs.readFile(output.zip)]), "complete-project.zip");
  const restoredResponse = await fetch(`${config.baseURL}/api/projects/${destination.id}/package/restore`, {
    method: "POST", headers: { Cookie: cookie }, body: form });
  const result = await restoredResponse.json();
  assert.equal(restoredResponse.status, 200, result.message);
  assert.equal(result.databaseCommitted, true);
  assert.equal((await pool.query("SELECT actor_id FROM meterflo_audit.events WHERE project_id=$1 AND action='projectPackageRestore.started' AND source<>'backup_import' ORDER BY sequence DESC LIMIT 1", [destination.id])).rows[0]?.actor_id, actor.id);
  assert.equal((await fs.readFile(path.join(root, "documents", getProjectDirectoryName(destination.name, destination.id), "Project Documents", "evidence.txt"), "utf8")), "project document canary");
  assert.equal((await fs.readFile(path.join(root, "ftp", getProjectDirectoryName(destination.name, destination.id), "Project FTP Files", "incoming", "orders.csv"), "utf8")).includes("CUST-PRIVATE-301"), true);
  assert.equal(await fs.readFile(path.join(root, "documents", getProjectDirectoryName(destination.name, destination.id), "Project FTP Files", "retained-old-ftp.csv"), "utf8"), "Retained original project-owned FTP file");
  assert.equal(Number((await pool.query("SELECT count(*) FROM public.inventory_items WHERE project_id=$1", [destination.id])).rows[0].count), Number(beforeInventory.rows[0].count));
  assert.equal((await pool.query(`SELECT new_system_reading::text AS reading FROM "${schema}".work_orders WHERE customer_wo_id='CUST-PRIVATE-301'`)).rows[0].reading, "123.4500");
  const provenance = await pool.query("SELECT metadata FROM meterflo_audit.events WHERE project_id=$1 AND source='backup_import' LIMIT 1", [destination.id]);
  assert.equal(provenance.rows[0].metadata.importedHistory.packageId, output.manifest.packageId);
  const exchangeRow = (await pool.query("SELECT * FROM public.https_transfer_files WHERE project_id=$1", [destination.id])).rows[0];
  assert.deepEqual(await exchangeStore.read({ provider: exchangeRow.provider, location: exchangeRow.location }, exchangeRow.storage_key), exchangeBytes);
  assert.notEqual(exchangeRow.id, fileId, "Global network identities cannot collide with the source project");
  assert.equal((await pool.query("SELECT enabled FROM public.https_transfer_settings WHERE project_id=$1", [destination.id])).rows[0].enabled, false);
  for (const table of ["https_transfer_credentials", "sftp_server_accounts"])
    assert.ok((await pool.query(`SELECT revoked_at FROM public.${table} WHERE project_id=$1`, [destination.id])).rows[0].revoked_at);
  const polling = (await pool.query("SELECT settings,next_run_at FROM public.api_import_configs WHERE project_id=$1", [destination.id])).rows[0];
  assert.equal(polling.settings.isEnabled, false);
  assert.equal(polling.settings.filter.isEnabled, true);
  assert.equal(polling.next_run_at, null);
  assert.equal((await pool.query("SELECT password_hash FROM public.users WHERE username='admin'")).rows[0]?.password_hash, original);
  assert.ok(Number((await pool.query("SELECT count(*) FROM meterflo_audit.events WHERE project_id=$1", [source.id])).rows[0].count) >= beforeAudit);
  assert.ok((await pool.query("SELECT id FROM public.projects WHERE id=$1", [other.id])).rowCount);
  await assert.rejects(restoreProjectPackage(output.zip, destination.id), /empty project|already has/);
  assert.equal((await pool.query("SELECT count(*) FROM pg_namespace WHERE nspname ~ '^mf_pkg_[0-9a-f]{16}_'")).rows[0].count, "0");
  execFileSync(process.execPath, ["tests/project-packages-ui.cjs"], { stdio: "inherit", timeout: 90000 });
  await fs.mkdir("generated-artifacts/project-packages", { recursive: true });
  await fs.writeFile("generated-artifacts/project-packages/verification.json", JSON.stringify({ passed: true,
    nativePgAdminRestore: true, sourcePreserved: true, unrelatedProjectExcluded: true, historicalInventoryIncluded: true,
    meterFloRestore: true, projectFilesRestored: true, occupiedTargetRejected: true }, null, 2));
  console.log("PASS: Complete project ZIP: native pg_restore, isolated relational data, disabled inventory, files, MeterFlo restore and occupied-target protection.");
} finally {
  if (output) await fs.rm(output.directory, { recursive: true, force: true });
  await analytical?.end();
  await pool.query(`DROP DATABASE IF EXISTS "${database}" WITH(FORCE)`);
  await deleteProjectCompletely(destination.id, path.join(root, "documents"));
  await deleteProjectCompletely(other.id, path.join(root, "documents"));
  await fs.rm(root, { recursive: true, force: true });
  await pool.end();
}
