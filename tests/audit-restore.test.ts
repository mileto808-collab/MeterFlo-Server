import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { initializeAudit } from "../server/auditMigration";
import { withAuditContext,type AuditContext } from "../server/auditContext";
import { beginAuditOperation,reconcileAuditOperations } from "../server/auditService";
import { createProjectSchema,getProjectWorkOrderStorage,deleteProjectSchema } from "../server/projectDb";
import { pgDump,restorePgBackup } from "../server/pgBackup";
import { writeAuditedFile,deleteAuditedFile } from "../server/auditFiles";

test("SQL restore preserves audit history and hooks; file staging and unknown operations are truthful",async()=>{
  await initializeAudit(pool);
  const dir=await mkdtemp(path.join(os.tmpdir(),"meterflo-audit-test-")),id=randomUUID(),operationId=randomUUID();
  const ctx:AuditContext={actorId:id,actorLabel:"Audit restore fixture",actorKind:"user",source:"restore",operationId};
  let project:any,schema:string|undefined;
  try{
    await pool.query("INSERT INTO public.users(id,username,role) VALUES($1,$2,'admin')",[id,`audit-restore-${id}`]);
    await withAuditContext(ctx,async()=>{
      project=await storage.createProject({name:`Audit restore ${id}`} as any);
      schema=await createProjectSchema(project.name,project.id);
      await storage.updateProject(project.id,{databaseName:schema});
      const store=getProjectWorkOrderStorage(schema!);
      const wo=await store.createWorkOrder({customerWoId:"RESTORE-AUDIT",status:"Open",newSystemReading:"00001.2300"} as any);
      const {rows:before}=await pool.query("SELECT id FROM meterflo_audit.events WHERE project_id=$1",[project.id]);
      const sqlFile=path.join(dir,"fixture.sql");
      const backup=await pgDump(process.env.DATABASE_URL!,sqlFile,[schema!]);
      assert.equal(backup.success,true,"isolated schema pg_dump");
      await store.updateWorkOrder(wo.id,{newSystemReading:"00009.9900"} as any);
      const restored=await restorePgBackup(sqlFile,{disableForeignKeys:true});
      assert.equal(restored.success,true,"isolated SQL restore");
      const saved=await pool.query(`SELECT new_system_reading_text FROM "${schema}".work_orders WHERE id=$1`,[wo.id]);
      assert.equal(saved.rows[0].new_system_reading_text,"00001.2300");
      const {rows:after}=await pool.query("SELECT id FROM meterflo_audit.events WHERE project_id=$1",[project.id]);
      assert.ok(before.every(e=>after.some(a=>a.id===e.id)),"restore does not replace newer history");
      await store.updateWorkOrder(wo.id,{newSystemReading:"00008.8800"} as any);
      const hook=await pool.query("SELECT changes FROM meterflo_audit.events WHERE operation_id=$1 AND entity_type='work_orders' ORDER BY sequence DESC LIMIT 1",[operationId]);
      assert.ok(hook.rows[0].changes.some((c:any)=>c.field==="new_system_reading"&&c.after==="00008.8800"),"hooks reinstalled after restore");
      const unsafe=path.join(dir,"unsafe.sql");await writeFile(unsafe,"DROP SCHEMA meterflo_audit CASCADE;");
      assert.equal((await restorePgBackup(unsafe)).success,false,"audit replacement refused before execution");
      await writeFile(unsafe,"DROP TABLE meterflo_audit.events CASCADE;");
      assert.equal((await restorePgBackup(unsafe)).success,false,"audit table replacement refused before execution");
      const f=path.join(dir,"file.bin");
      await writeAuditedFile(f,Buffer.from("original"),"fixtureFileUpload",project.id,project.name,"safe-file-id");
      const fail={...ctx,actorLabel:"AUDIT_RESTORE_FAIL"};
      await pool.query("ALTER TABLE meterflo_audit.events ADD CONSTRAINT audit_restore_failure CHECK(NOT(actor_label='AUDIT_RESTORE_FAIL' AND outcome='success'))");
      await assert.rejects(()=>withAuditContext(fail,()=>writeAuditedFile(f,Buffer.from("replacement"),"fixtureFileUpload",project.id,project.name,"safe-file-id")));
      assert.equal(await readFile(f,"utf8"),"original","file replacement rolled back on terminal audit failure");
      await assert.rejects(()=>withAuditContext(fail,()=>deleteAuditedFile(f,"fixtureFileDelete",project.id,project.name,"safe-file-id")));
      assert.equal(await readFile(f,"utf8"),"original","file deletion rolled back on terminal audit failure");
      await pool.query("ALTER TABLE meterflo_audit.events DROP CONSTRAINT audit_restore_failure");
      assert.equal(await deleteAuditedFile(f,"fixtureFileDelete",project.id,project.name,"safe-file-id"),true);
      assert.equal(await deleteAuditedFile(f,"fixtureFileDelete",project.id,project.name,"safe-file-id"),false);
      const unknown=await beginAuditOperation("fixtureInterrupted","safe-archive-id",project.id,project.name);
      await pool.query("UPDATE meterflo_audit.operations SET instance_id='previous-instance' WHERE id=$1",[unknown]);
      await reconcileAuditOperations();
      const status=await pool.query("SELECT outcome FROM meterflo_audit.events WHERE operation_id=$1 ORDER BY sequence",[unknown]);
      assert.deepEqual(status.rows.map(r=>r.outcome),["started","unknown"]);
    });
  }finally{
    await pool.query("ALTER TABLE meterflo_audit.events DROP CONSTRAINT IF EXISTS audit_restore_failure");
    if(schema) await deleteProjectSchema(schema);
    if(project) await pool.query("DELETE FROM public.projects WHERE id=$1",[project.id]);
    await pool.query("DELETE FROM public.users WHERE id=$1",[id]);
    const c=await pool.connect();
    try{await c.query("BEGIN");await c.query("SELECT set_config('meterflo.audit_retention','authorized',true)");
      await c.query("DELETE FROM meterflo_audit.events WHERE actor_id=$1 OR project_id=$2 OR operation_id=$3",[id,project?.id ?? -1,operationId]);
      await c.query("DELETE FROM meterflo_audit.operations WHERE actor_id=$1 OR project_id=$2",[id,project?.id ?? -1]);
      await c.query("COMMIT");
    }finally{c.release();}
    await rm(dir,{recursive:true,force:true});await pool.end();
  }
});
