import test, { after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pool } from "../server/db";
import { fixture, seedTransferHistory } from "./log-maintenance-fixture";
import { defaultLogPolicy, databaseLogCategories, logPolicySchema } from "../shared/log-maintenance";
import { LogFiles } from "../server/logMaintenanceFiles";
import { LogMaintenanceService } from "../server/logMaintenanceService";

after(() => pool.end());
const before = "2001-01-01T00:00:00.000Z";
test("completed failures require an explicit manual preview; latest, active and interrupted imports stay protected",async () => {
  const f = await fixture();
  try {
    await pool.query(`
      INSERT INTO ${f.n}api_import_runs VALUES
        ('c-new',1,2,'succeeded','2000-03-01','2000-03-01'),
        ('d-new',1,3,'succeeded','2000-03-01','2000-03-01'),
        ('manual-failed',1,NULL,'failed','2000-01-01','2000-01-01');
      INSERT INTO ${f.n}file_import_history VALUES
        (5,1,NULL,'failed',1,'2000-01-01','2000-01-01'),
        (6,1,NULL,'failed',1,'2000-01-01',NULL),
        (7,1,NULL,'running',1,'2000-01-01','2000-01-01'),
        (8,1,1,'failed',1,'2000-04-01','2000-04-01'),
        (9,1,1,'running',0,'2000-05-01',NULL);
    `);
    const filter = { categories:["apiImports","databaseImports","fileImports"],projectId:1,before };
    const normal = await f.service.preview(filter,"operator");
    const manual = await f.service.preview({ ...filter,includeFailedImports:true },"operator");
    assert.equal(manual.count-normal.count,4);
    const inventory = (await f.service.summary()).inventory;
    assert.equal(inventory.find(item => item.category === "fileImports")?.manualOnlyCount,2);
    const changed = await f.service.preview({categories:["fileImports"],before,includeFailedImports:true},"operator");
    await pool.query(`UPDATE ${f.n}file_import_history SET status='retrying' WHERE id=5`);
    const result = await f.service.cleanup(manual.token,"operator");
    assert.equal(result.skipped,1,"Manual eligibility is rechecked when a completed failure becomes retryable");
    assert.equal(result.includeFailedImports,true);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}api_import_runs WHERE id='manual-failed'`)).rows[0].c,0);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}api_import_runs WHERE id IN ('c','d')`)).rows[0].c,2,"Configured failures/partials retain their manual-retry checkpoints even when newer runs exist");
    assert.deepEqual((await pool.query(`SELECT id FROM ${f.n}file_import_history ORDER BY id`)).rows.map(row => row.id),[5,6,7,8,9]);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}api_import_runs WHERE id IN ('e','f','g','h','i')`)).rows[0].c,5);
    assert.ok(changed.token);
  } finally { await f.dispose(); }
});
test("transfer cleanup respects project/cutoff, rechecks export parents and never removes files, payloads or replay state",async () => {
  const f = await fixture();
  try {
    await seedTransferHistory(f);
    const filter = {categories:["fileExports","sftpActivity","httpsActivity"],projectId:1,before};
    const preview = await f.service.preview(filter,"operator");
    assert.equal(preview.count,4);
    await pool.query(`UPDATE ${f.n}file_export_runs SET status='failed' WHERE id='old'`);
    const changed = await f.service.cleanup(preview.token,"operator");
    assert.equal(changed.removed,2); assert.equal(changed.skipped,2);
    await pool.query(`UPDATE ${f.n}file_export_runs SET status='success' WHERE id='old'`);
    const next = await f.service.preview(filter,"operator");
    assert.equal((await f.service.cleanup(next.token,"operator")).removed,2);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}file_export_runs`)).rows[0].c,4);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}file_export_attempts`)).rows[0].c,3);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}file_export_run_items`)).rows[0].c,2);
    for (const table of ["file_export_checkpoints","file_import_receipts","https_transfer_files"]) {
      assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}${table}`)).rows[0].c,1);
    }
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}sftp_server_events`)).rows[0].c,3);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}https_transfer_events`)).rows[0].c,2);
  } finally { await f.dispose(); }
});
test("legacy policies do not expand retention; explicit new-category retention is fair and never removes failed imports",async () => {
  const f = await fixture();
  try {
    await seedTransferHistory(f);
    const { historyCategories: _categories,...legacy } = defaultLogPolicy;
    await pool.query(`INSERT INTO ${f.n}system_settings(key,value) VALUES('logMaintenance.policy',$1)`,[JSON.stringify({...legacy,automatic:true})]);
    assert.deepEqual((await f.service.policy()).historyCategories,defaultLogPolicy.historyCategories);
    await f.service.automatic();
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}sftp_server_events`)).rows[0].c,4);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}https_transfer_events`)).rows[0].c,3);
    await pool.query(`INSERT INTO ${f.n}customer_api_logs SELECT i,1,NULL,true,'2000-01-01' FROM generate_series(100,1000) i`);
    const archive = path.join(f.dir,"error-2000-02-01T00-00-00-000Z.log");
    await fs.writeFile(archive,"fixture archive"); await fs.utimes(archive,new Date("2000-01-01"),new Date("2000-01-01"));
    await f.service.savePolicy({...defaultLogPolicy,automatic:true,historyCategories:[...databaseLogCategories]},"operator");
    await f.service.automatic();
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}sftp_server_events`)).rows[0].c,1);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}https_transfer_events`)).rows[0].c,1);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}file_export_attempts`)).rows[0].c,3);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}file_import_history WHERE id=3`)).rows[0].c,1);
    await assert.rejects(fs.stat(archive),{code:"ENOENT"});
    assert.ok((await pool.query(`SELECT count(*)::int c FROM ${f.n}customer_api_logs WHERE id>=100`)).rows[0].c>0,"Other categories and archives progress while API history exceeds the batch");
    assert.equal((await fs.readFile(path.join(f.dir,"error.log"),"utf8")),"fixture-only log\n");
    assert.equal(logPolicySchema.safeParse({...defaultLogPolicy,includeFailedImports:true}).success,false,"Failed imports cannot be enabled in automatic policy");
    await f.service.savePolicy({...defaultLogPolicy,automatic:true,historyCategories:[]},"operator");
    await f.service.automatic();
  } finally { await f.dispose(); }
});
test("disabled defaults, non-destructive previews, confirmation ownership and protected recovery history",async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.service.policy(),defaultLogPolicy);
    const summary = await f.service.summary();
    assert.equal(summary.inventory.find(c => c.category === "customerApi")?.protectedCount,7);
    assert.ok(summary.protectedBytes > 0);
    await f.service.automatic();
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}system_settings`)).rows[0].c,0);
    const preview = await f.service.preview({ categories:["customerApi","apiImports","databaseImports","fileImports"],before,projectId:1 },"operator");
    assert.equal(preview.count,6);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}customer_api_logs`)).rows[0].c,11,"Preview/cancel do not remove records");
    await assert.rejects(f.service.cleanup(preview.token,"different-operator"),/another operator/);
    const result = await f.service.cleanup(preview.token,"operator");
    assert.equal(result.removed,6); assert.equal(result.skipped,0); assert.deepEqual(result.errors,[]);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}customer_api_deliveries`)).rows[0].c,6);
    assert.deepEqual((await pool.query(`SELECT id FROM ${f.n}api_import_runs ORDER BY id`)).rows.map(r => r.id),["b","c","d","e","f","g","h","i"]);
    assert.equal((await f.service.history())[0].actor,"operator");
    await assert.rejects(f.service.cleanup(preview.token,"operator"),/expired/);
  } finally { await f.dispose(); }
});
test("file allowlist, inode changes, symlinks, active truncation and unrelated files",async () => {
  const f = await fixture();
  try {
    await fs.symlink(path.join(f.dir,"unrelated.log"),path.join(f.dir,"error-2000-01-02T00-00-00-000Z.log"));
    assert.equal(f.files.list().length,2);
    await assert.rejects(f.service.preview({categories:["activeError"],projectId:1,before},"admin"),/global/);
    const p = await f.service.preview({categories:["errorArchives","activeError"],before},"admin");
    await fs.appendFile(path.join(f.dir,"error.log"),"new log since preview");
    const r = await f.service.cleanup(p.token,"admin");
    assert.equal(r.removed,1); assert.equal(r.skipped,1);
    const p2 = await f.service.preview({categories:["activeError"],before:new Date().toISOString()},"admin");
    const active = f.files.list().find(r => r.category === "activeError")!;
    assert.equal(f.files.remove(active),true);
    assert.equal((await fs.stat(path.join(f.dir,"error.log"))).ino,active.ino,"Truncation keeps writer's inode");
    assert.equal((await fs.readFile(path.join(f.dir,"unrelated.log"),"utf8")),"fixture-only log\n");
    assert.equal((await fs.readFile(path.join(f.dir,".env"),"utf8")),"fixture-only log\n");
    const linkedRoot = path.join(f.dir,"linked"); await fs.symlink(f.dir,linkedRoot);
    assert.throws(() => new LogFiles(linkedRoot).list(),/symbolic link/);
    assert.throws(() => f.files.remove({...active,name:"../unrelated.log"}),/Unmanaged/);
    assert.ok(p2.token);
  } finally { await f.dispose(); }
});
test("saved policy persists, saving does not clean, scheduled cleanup excludes active log",async () => {
  const f = await fixture();
  try {
    const preview = await f.service.preview({categories:["customerApi"],before},"admin");
    await f.service.savePolicy({...defaultLogPolicy,automatic:true,historyDays:90},"admin");
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}customer_api_logs`)).rows[0].c,11);
    const restarted = new LogMaintenanceService(f.repository,f.files);
    assert.equal((await restarted.policy()).automatic,true);
    await assert.rejects(f.service.cleanup(preview.token,"admin"),/expired/);
    await restarted.automatic();
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}customer_api_logs`)).rows[0].c,8);
    assert.equal((await fs.readFile(path.join(f.dir,"error.log"),"utf8")),"fixture-only log\n");
    assert.ok(!(await fs.readdir(f.dir)).includes("error-2000-01-01T00-00-00-000Z.log"));
    await assert.rejects(f.service.savePolicy({...defaultLogPolicy,historyDays:0},"admin"));
  } finally { await f.dispose(); }
});
test("eligibility is rechecked, locked rows skipped and cleanup serialized",async () => {
  const f = await fixture();
  const client = await pool.connect();
  try {
    const p = await f.service.preview({categories:["customerApi"],before},"admin");
    await pool.query(`UPDATE ${f.n}customer_api_deliveries SET status='retrying' WHERE id='done'`);
    await client.query("BEGIN");
    await client.query(`SELECT id FROM ${f.n}customer_api_logs WHERE id=5 FOR UPDATE`);
    const r = await f.service.cleanup(p.token,"admin");
    assert.equal(r.removed,0); assert.equal(r.skipped,3);
    await client.query("ROLLBACK");
    await client.query("SELECT pg_advisory_lock(715294)");
    const p2 = await f.service.preview({categories:["customerApi"],before},"admin");
    await assert.rejects(f.service.cleanup(p2.token,"admin"),/Another/);
    await client.query("SELECT pg_advisory_unlock(715294)");
  } finally { await client.query("ROLLBACK").catch(() => {}); await client.query("SELECT pg_advisory_unlock(715294)"); client.release(); await f.dispose(); }
});
test("500-item batches, strict boundary cutoff, expiration, capped audit and file error reporting",async () => {
  const f = await fixture();
  try {
    await pool.query(`INSERT INTO ${f.n}customer_api_logs SELECT i,1,NULL,true,'2000-01-01' FROM generate_series(100,700) i`);
    await pool.query(`INSERT INTO ${f.n}customer_api_logs VALUES(99,1,NULL,true,$1)`,[before]);
    const p = await f.service.preview({categories:["customerApi"],before},"admin");
    assert.equal(p.count,500); assert.equal(p.limited,true);
    const r = await f.service.cleanup(p.token,"admin"); assert.equal(r.removed,500);
    assert.equal((await pool.query(`SELECT id FROM ${f.n}customer_api_logs WHERE id=99`)).rows.length,1);
    const p2 = await f.service.preview({categories:["errorArchives"],before},"admin");
    (f.service as any).previews.get(p2.token).expires = 0;
    await assert.rejects(f.service.cleanup(p2.token,"admin"),/expired/);
    const p3 = await f.service.preview({categories:["errorArchives"],before},"admin");
    const remove = f.files.remove.bind(f.files);
    f.files.remove = () => { throw new Error("fixture filesystem denial"); };
    const failed = await f.service.cleanup(p3.token,"admin");
    assert.equal(failed.removed,0); assert.equal(failed.errors.length,1);
    f.files.remove = remove;
    for (let i=0;i<21;i++) await f.service.savePolicy(defaultLogPolicy,"admin");
    assert.equal((await f.service.history()).length,20);
  } finally { await f.dispose(); }
});

test("archive budget trims young archives oldest-first; error writer uses configured rotation size",async () => {
  const f = await fixture();
  try {
    await fs.unlink(path.join(f.dir,"error-2000-01-01T00-00-00-000Z.log"));
    const older="error-2026-10-11T00-00-00-000Z.log";
    const newer="error-2026-10-11T00-01-00-000Z.log";
    for (const name of [older,newer]) {
      await fs.writeFile(path.join(f.dir,name),"");
      const handle=await fs.open(path.join(f.dir,name),"r+");
      await handle.truncate(6*1048576); await handle.close(); // sparse fixture, not a retained asset
    }
    await fs.utimes(path.join(f.dir,older),new Date(Date.now()-2000),new Date(Date.now()-2000));
    await f.service.savePolicy({...defaultLogPolicy,automatic:true,archiveBudgetMiB:10},"admin");
    await f.service.automatic();
    assert.equal((await fs.readdir(f.dir)).includes(older),false);
    assert.equal((await fs.readdir(f.dir)).includes(newer),true);
    const childDir=path.join(f.dir,"writer"); await fs.mkdir(childDir);
    const code=`import {logger,setLogRotationMiB} from './server/logger.ts'; setLogRotationMiB(1); logger.error('x'.repeat(1048577)); logger.error('fixture after rotation');`;
    await promisify(execFile)(process.execPath,["--import","tsx","--input-type=module","-e",code],{
      cwd:process.cwd(),env:{...process.env,LOG_DIR:childDir},maxBuffer:4*1048576,
    });
    const managed=new LogFiles(childDir).list();
    assert.equal(managed.filter(f => f.category === "errorArchives").length,1);
    assert.ok(managed.find(f => f.category === "activeError")!.bytes < 1000);
    assert.ok((await fs.readFile(path.join(childDir,"error.log"),"utf8")).includes("fixture after rotation"));
  } finally { await f.dispose(); }
});
