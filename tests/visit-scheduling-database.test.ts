// Only run against the owned disposable inventory UI fixture.
import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import express from "express";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { initializeVisitScheduling, installVisitScheduling } from "../server/visitScheduling";
import { mapSqlImportRow } from "../shared/visitScheduling";
import { insertProjectWorkOrderSchema } from "../shared/schema";
import { randomUUID } from "node:crypto";
import { getProjectWorkOrderStorage, backupProjectDatabase, restoreProjectDatabase } from "../server/projectDb";
import { enableAuditing, serviceAuditContext, withAuditContext } from "../server/auditContext";
import { registerRoutingRoutes } from "../server/routing/routes";
import { buildCustomerPayload } from "../server/customerApiPayload";

test("relational visit persistence, default inheritance, stale detection, atomic restore and audit evidence",async(t)=>{
  t.after(()=>pool.end());
  const fixture=JSON.parse(await readFile("/tmp/meterflo-inventory-ui-fixture.json","utf8"));
  enableAuditing();
  await withAuditContext(serviceAuditContext("visit-scheduling-acceptance"),async()=>{
    await initializeVisitScheduling();
    // Simulate schema tooling having created all columns without constraints.
    const firstSchema=`project_visit_schemafirst_${randomUUID().replaceAll("-","")}`;
    await pool.query(`CREATE SCHEMA "${firstSchema}";
      CREATE TABLE "${firstSchema}".work_orders(id integer PRIMARY KEY,service_duration_minutes integer,
      appointment_window_start timestamptz,appointment_window_end timestamptz);
      INSERT INTO "${firstSchema}".work_orders(id) VALUES(1);`);
    try {
      await installVisitScheduling(pool,firstSchema);await installVisitScheduling(pool,firstSchema);
      for (const invalid of [0,481,-1]) await assert.rejects(pool.query(`UPDATE "${firstSchema}".work_orders SET service_duration_minutes=$1 WHERE id=1`,[invalid]),(e:any)=>e.code==="23514");
      await pool.query(`UPDATE "${firstSchema}".work_orders SET service_duration_minutes=480 WHERE id=1`);
      const constraints=await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid='public.projects'::regclass
        AND conname IN ('visit_default_duration_range','visit_default_tolerance_range')`);
      assert.equal(constraints.rowCount,2,"Existing project columns receive independently installed named checks");
      for (const [column,value] of [["default_service_minutes",0],["default_service_minutes",481],["default_appointment_tolerance_minutes",-1],["default_appointment_tolerance_minutes",241]]) {
        await assert.rejects(pool.query(`UPDATE public.projects SET ${column}=$1 WHERE id=$2`,[value,fixture.projectId]),(e:any)=>e.code==="23514");
      }
    } finally {await pool.query(`DROP SCHEMA "${firstSchema}" CASCADE`);}
    const newProject=await storage.createProjectWithFullData({name:"Visit default acceptance"});
    try {
      assert.equal(newProject.defaultServiceMinutes,30);assert.equal(newProject.defaultAppointmentToleranceMinutes,60);
    } finally {await storage.deleteProject(newProject.id);}
    const columnDefaults=await pool.query(`SELECT column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='projects'
      AND column_name IN ('default_service_minutes','default_appointment_tolerance_minutes')`);
    assert.ok(columnDefaults.rows.every(r=>r.column_default===null),"Schema-tool-first upgrades cannot backfill legacy projects");
    await pool.query("UPDATE public.projects SET inventory_enabled=false,default_service_minutes=30,default_appointment_tolerance_minutes=60 WHERE id=$1",[fixture.projectId]);
    const wo=getProjectWorkOrderStorage(fixture.schema);
    await pool.query(`DELETE FROM "${fixture.schema}".work_orders WHERE customer_wo_id IN ('VISIT-SCHEDULING','VISIT-INHERITED')`);
    const service=(await pool.query("SELECT code FROM public.service_types LIMIT 1")).rows[0].code;
    const sqlMapping={duration:"serviceDurationMinutes",start:"appointmentWindowStart",end:"appointmentWindowEnd"};
    const sqlFields=mapSqlImportRow({duration:"35",start:"2026-10-17T08:00:00-06:00",end:"2026-10-17T09:00:00-06:00"},sqlMapping);
    const sqlInput=insertProjectWorkOrderSchema.parse({customerWoId:`SQL-VISIT-${randomUUID()}`,customerId:"fixture",customerName:"fixture",address:"fixture",serviceType:service,status:"Open",...sqlFields});
    const sqlCreated=await wo.createWorkOrder(sqlInput as any,fixture.username,true);
    assert.equal(sqlCreated.serviceDurationMinutes,35);
    const sqlUpdated=await wo.updateWorkOrder(sqlCreated.id,mapSqlImportRow({duration:"55"},sqlMapping),fixture.username,true);
    assert.equal(sqlUpdated!.serviceDurationMinutes,55);
    assert.equal(new Date(sqlUpdated!.appointmentWindowStart!).toISOString(),"2026-10-17T14:00:00.000Z","Omitted SQL window mapping preserves existing window");
    const start=new Date(Date.now()+10*60000).toISOString(), end=new Date(Date.now()+20*60000).toISOString();
    const order=await wo.createWorkOrder({customerWoId:"VISIT-SCHEDULING",serviceType:service,status:"Scheduled",
      scheduledAt:new Date(Date.now()+30*60000),oldGps:"40,-105",
      serviceDurationMinutes:75,appointmentWindowStart:start,appointmentWindowEnd:end} as any,fixture.username);
    assert.equal(order.serviceDurationMinutes,75);
    assert.equal(new Date(order.appointmentWindowStart!).toISOString(),start);
    await assert.rejects(wo.updateWorkOrder(order.id,{appointmentWindowEnd:null} as any,fixture.username));
    assert.equal((await wo.getWorkOrder(order.id))!.serviceDurationMinutes,75);
    await assert.rejects(pool.query(`UPDATE "${fixture.schema}".work_orders SET service_duration_minutes=0 WHERE id=$1`,[order.id]),(e:any)=>e.code==="23514");
    await assert.rejects(pool.query(`UPDATE "${fixture.schema}".work_orders SET appointment_window_end=NULL WHERE id=$1`,[order.id]),(e:any)=>e.code==="23514");
    const payload=buildCustomerPayload(order as any,{id:fixture.projectId,name:"fixture"},"fixture-delivery");
    assert.equal(payload.serviceDurationMinutes,75);
    assert.equal(payload.appointmentWindowStart,start);
    const inherited=await wo.createWorkOrder({customerWoId:"VISIT-INHERITED",serviceType:service,status:"Scheduled",oldGps:"40.1,-105.1"} as any,fixture.username);
    const before=await wo.getWorkOrder(order.id);
    const app=express();app.use(express.json());
    app.use((req:any,_res,next)=>{req.isAuthenticated=()=>true;req.user={claims:{sub:fixture.id},expires_at:Math.floor(Date.now()/1000)+1000};next();});
    const ready={configuration:{mode:"override",provider:"geoapify",serverKeyEnv:"",browserKeyEnv:"",maxStops:24,dailyPlans:10},
      effective:{provider:"geoapify",source:"project",maxStops:24,dailyPlans:10},ready:true,mapReady:false,disabled:false,canManage:true,revision:"d".repeat(64),message:"fixture"};
    registerRoutingRoutes(app,{
      effectiveRouting:async()=>({result:ready,effective:ready.effective,serverKey:"fixture",browserKey:""}) as any,
      consumeRoutingQuota:async()=>{},
      routingService:()=>({geocode:async()=>({lat:40,lng:-105}),matrix:async(points:any[])=>points.map((_,i)=>points.map((_,j)=>({seconds:i===j?0:60,meters:100}))),geometry:async(points:any[])=>points}) as any,
    });
    const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
    const base=`http://127.0.0.1:${(server.address() as any).port}/api/projects/${fixture.projectId}/routing`;
    const post=async(path:string,body:any)=>{const res=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});assert.equal(res.status,200,await res.clone().text());return res.json();};
    try {
      const plan=await post("/plan",{ids:[order.id,inherited.id],origin:{lat:40,lng:-105},departureAt:new Date().toISOString()});
      assert.equal(plan.serviceMinutes,30);assert.equal(plan.toleranceMinutes,60);
      assert.equal(plan.stops.find((s:any)=>s.id===order.id).durationSource,"work-order");
      assert.equal(plan.stops.find((s:any)=>s.id===inherited.id).durationSource,"project");
      assert.deepEqual(await wo.getWorkOrder(order.id),before,"Planning never writes business state");
      const validation={ids:[order.id,inherited.id],fingerprint:plan.fingerprint,configurationRevision:plan.configurationRevision};
      assert.equal((await post("/validate",validation)).stale,false);
      await storage.updateProject(fixture.projectId,{defaultServiceMinutes:40});
      assert.equal((await post("/validate",validation)).stale,true,"Changing defaults invalidates recovered routes");
      await storage.updateProject(fixture.projectId,{defaultServiceMinutes:30});
      await wo.updateWorkOrder(order.id,{serviceDurationMinutes:80} as any,fixture.username);
      assert.equal((await post("/validate",validation)).stale,true,"Changing a visit invalidates the route");
    } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));}
    const backup=JSON.parse(JSON.stringify(await backupProjectDatabase(fixture.schema)));
    assert.deepEqual(backup.schedulingDefaults,{defaultServiceMinutes:30,defaultAppointmentToleranceMinutes:60});
    await storage.updateProject(fixture.projectId,{defaultServiceMinutes:90});
    await restoreProjectDatabase(fixture.schema,backup,{clearExisting:true});
    const restored=await wo.getWorkOrderByCustomerWoId("VISIT-SCHEDULING");
    assert.equal(restored!.serviceDurationMinutes,80);
    assert.equal(new Date(restored!.appointmentWindowEnd!).toISOString(),end);
    assert.equal((await storage.getProject(fixture.projectId))!.defaultServiceMinutes,30);
    const invalid=structuredClone(backup);invalid.workOrders.find((row:any)=>row.customerWoId==="VISIT-SCHEDULING").appointmentWindowEnd=null;
    const snapshot=await wo.getWorkOrders();
    await assert.rejects(restoreProjectDatabase(fixture.schema,invalid,{clearExisting:true}));
    assert.deepEqual(await wo.getWorkOrders(),snapshot,"Invalid restore does not clear existing work");
    const legacy=structuredClone(backup);delete legacy.schedulingDefaults;
    for(const row of legacy.workOrders){delete row.serviceDurationMinutes;delete row.appointmentWindowStart;delete row.appointmentWindowEnd;}
    await restoreProjectDatabase(fixture.schema,legacy,{clearExisting:true});
    assert.ok((await wo.getWorkOrders()).every(row=>row.serviceDurationMinutes===null&&row.appointmentWindowStart===null&&row.appointmentWindowEnd===null));
    assert.equal((await storage.getProject(fixture.projectId))!.defaultServiceMinutes,30);
    await storage.updateProject(fixture.projectId,{defaultServiceMinutes:null,defaultAppointmentToleranceMinutes:null});
    assert.equal((await storage.getProject(fixture.projectId))!.defaultServiceMinutes,null);
    // Generic row audit includes the new relational business facts.
    const audit=await pool.query(`SELECT to_jsonb(e)::text AS evidence FROM meterflo_audit.events e WHERE project_id=$1`,[fixture.projectId]);
    assert.ok(audit.rows.some(r=>r.evidence.includes("service_duration_minutes")&&r.evidence.includes("appointment_window_start")));
    const exact=await pool.query(`SELECT meterflo_audit.safe_value('service_duration_minutes','75'::jsonb) AS duration,
      meterflo_audit.safe_value('default_appointment_tolerance_minutes','60'::jsonb) AS tolerance`);
    assert.equal(exact.rows[0].duration,75);assert.equal(exact.rows[0].tolerance,60);
  });
});
