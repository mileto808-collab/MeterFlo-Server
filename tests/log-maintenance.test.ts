import test, { after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pool } from "../server/db";
import { fixture } from "./log-maintenance-fixture";
import { defaultLogPolicy } from "../shared/log-maintenance";
import { LogFiles } from "../server/logMaintenanceFiles";
import { LogMaintenanceService } from "../server/logMaintenanceService";

after(() => pool.end());
const before = "2001-01-01T00:00:00.000Z";
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
