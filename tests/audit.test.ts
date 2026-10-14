import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { initializeAudit } from "../server/auditMigration";
import { withAuditContext, type AuditContext } from "../server/auditContext";
import { auditedOperation, auditInventory, saveAuditPolicy } from "../server/auditService";
import { createProjectSchema,getProjectWorkOrderStorage,deleteProjectSchema } from "../server/projectDb";

test("audit commits exact business diffs, redacts, identifies actors, and rolls back on audit failure",async()=>{
  await initializeAudit(pool);
  const suffix=randomUUID(),actorId=`audit-${suffix}`,operationId=randomUUID();
  const ctx:AuditContext={actorId,actorLabel:"Audit fixture operator",actorKind:"user",source:"web",operationId};
  let projectId:number|undefined,schema:string|undefined;
  const rawPool=new pg.Pool({connectionString:process.env.DATABASE_URL});
  try {
    await rawPool.query("INSERT INTO public.users(id,username,password_hash,role) VALUES($1,$2,$3,'admin')",
      [actorId,`audit-${suffix}`,`private-password-${suffix}`]);
    await withAuditContext(ctx,async()=>{
      const project=await storage.createProject({name:`Audit fixture ${suffix}`} as any);
      projectId=project.id;schema=await createProjectSchema(project.name,project.id);
      await storage.updateProject(project.id,{databaseName:schema,systemReadingDecimalPlaces:4});
      const store=getProjectWorkOrderStorage(schema);
      const wo=await store.createWorkOrder({customerWoId:"audit-exact",status:"Open",newSystemReading:"00001.2300",
        newModuleRead:"00002.3400",notes:`private-freeform-${suffix}`} as any);
      const count=async()=>Number((await pool.query("SELECT count(*) FROM meterflo_audit.events WHERE operation_id=$1",[operationId])).rows[0].count);
      const before=await count();
      await store.updateWorkOrder(wo.id,{newSystemReading:"00001.2300",newModuleRead:"00002.3400"} as any);
      assert.equal(await count(),before,"no-op saves produce no false events");
      await store.updateWorkOrder(wo.id,{newSystemReading:"00001.2301",newModuleRead:"00002.3401",assignedUserId:actorId} as any);
      const {rows}=await pool.query(`SELECT * FROM meterflo_audit.events WHERE operation_id=$1 AND entity_type='work_orders' ORDER BY sequence`,[operationId]);
      assert.equal(rows.at(-1).actor_id,actorId);
      assert.equal(rows.at(-1).project_id,project.id);
      assert.deepEqual(rows.at(-1).changes.find((c:any)=>c.field==="new_system_reading"),
        {field:"new_system_reading",before:"00001.2300",after:"00001.2301"});
      assert.deepEqual(rows.at(-1).changes.find((c:any)=>c.field==="new_module_read"),
        {field:"new_module_read",before:"00002.3400",after:"00002.3401"});
      assert.ok(!JSON.stringify(rows).includes(`private-freeform-${suffix}`));
      await storage.updateUser(actorId,{passwordHash:`rotated-password-${suffix}`} as any);
      await storage.updateProject(project.id,{customerApiUrl:`https://example.invalid/?token=private-${suffix}`} as any);
      const events=await pool.query("SELECT * FROM meterflo_audit.events WHERE operation_id=$1",[operationId]);
      assert.ok(!JSON.stringify(events.rows).includes(`rotated-password-${suffix}`));
      assert.ok(!JSON.stringify(events.rows).includes(`token=private-${suffix}`));
      // Simulate an audit-store failure; standalone and explicit transactions
      // must not leave successfully changed business data.
      await pool.query("ALTER TABLE meterflo_audit.events ADD CONSTRAINT audit_fixture_failure CHECK(actor_label<>'AUDIT_FIXTURE_FAIL')");
      const failCtx={...ctx,actorLabel:"AUDIT_FIXTURE_FAIL"};
      await assert.rejects(()=>withAuditContext(failCtx,()=>store.updateWorkOrder(wo.id,{status:"Completed"} as any)));
      assert.equal((await store.getWorkOrder(wo.id))?.status,"Open");
      const client=await pool.connect();
      try {
        await client.query("BEGIN");
        await assert.rejects(()=>withAuditContext(failCtx,()=>client.query(`UPDATE "${schema}".work_orders SET status='Completed' WHERE id=$1`,[wo.id])));
        await client.query("ROLLBACK");
      } finally {client.release();}
      assert.equal((await store.getWorkOrder(wo.id))?.status,"Open");
      await pool.query("ALTER TABLE meterflo_audit.events DROP CONSTRAINT audit_fixture_failure");
      const prior=await count();
      await rawPool.query(`UPDATE "${schema}".work_orders SET route='external fixture' WHERE id=$1`,[wo.id]);
      assert.equal(await count(),prior,"external SQL is not attributed to a fictitious app user");
      await auditedOperation("fixtureBackup","database",async()=>({success:true}),project.id,project.name);
      await assert.rejects(()=>auditedOperation("fixtureRestore","database",async()=>{throw new Error(`private-error-${suffix}`);},project.id,project.name));
      const lifecycles=await pool.query("SELECT action,outcome,actor_id,metadata FROM meterflo_audit.events WHERE project_id=$1 AND entity_type LIKE 'fixture%' ORDER BY sequence",[project.id]);
      assert.deepEqual(lifecycles.rows.map(r=>r.outcome),["started","success","started","failed"]);
      assert.ok(lifecycles.rows.every(r=>r.actor_id===actorId));
      assert.ok(!JSON.stringify(lifecycles.rows).includes("private-error"));
      await assert.rejects(()=>pool.query("UPDATE meterflo_audit.events SET outcome='success' WHERE operation_id=$1",[operationId]));
      await assert.rejects(()=>pool.query("DELETE FROM meterflo_audit.events WHERE operation_id=$1",[operationId]));
      await deleteProjectSchema(schema!);schema=undefined;
      await storage.deleteProject(project.id);
      const history=await pool.query("SELECT project_id,project_label FROM meterflo_audit.events WHERE operation_id=$1 AND entity_type='projects' ORDER BY sequence DESC LIMIT 1",[operationId]);
      assert.equal(history.rows[0].project_id,project.id);
      assert.equal(history.rows[0].project_label,project.name);
    });
    const inventory=await auditInventory();
    assert.equal(typeof inventory.count,"number");
    assert.equal(inventory.policy.automatic,false,"automatic audit expiration defaults off");
  } finally {
    await pool.query("ALTER TABLE meterflo_audit.events DROP CONSTRAINT IF EXISTS audit_fixture_failure");
    if(schema) await deleteProjectSchema(schema);
    if(projectId) await rawPool.query("DELETE FROM public.projects WHERE id=$1",[projectId]);
    await rawPool.query("DELETE FROM public.users WHERE id=$1",[actorId]);
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('meterflo.audit_retention','authorized',true)");
      await client.query("DELETE FROM meterflo_audit.events WHERE actor_id=$1 OR project_id=$2 OR operation_id=$3",[actorId,projectId ?? -1,operationId]);
      await client.query("DELETE FROM meterflo_audit.operations WHERE actor_id=$1 OR project_id=$2",[actorId,projectId ?? -1]);
      await client.query("COMMIT");
    } finally {client.release();}
    await rawPool.end();await pool.end();
  }
});
