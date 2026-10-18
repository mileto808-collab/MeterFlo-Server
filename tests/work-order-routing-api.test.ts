// Uses only the disposable inventory UI fixture. Real provider requests are
// replaced at server construction; the running application's auth is untouched.
import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { getProjectWorkOrderStorage, backupProjectDatabase, restoreProjectDatabase } from "../server/projectDb";
import { enableAuditing, serviceAuditContext, withAuditContext } from "../server/auditContext";
import { registerRoutingRoutes, routeFingerprint, parseGps } from "../server/routing/routes";
import { assertProjectCredentialReferences, initializeRouting, effectiveRouting, routingConfigurationSchema, consumeRoutingQuota } from "../server/routing/configuration";
import type { RoutingService } from "../server/routing/providers";

test("protected planning, stale state, configuration isolation and quota boundaries",async(t)=>{
  t.after(()=>pool.end());
  const fixture=JSON.parse(await readFile("/tmp/meterflo-inventory-ui-fixture.json","utf8"));
  enableAuditing();
  await withAuditContext(serviceAuditContext("routing-acceptance"),async()=>{
    await initializeRouting();
    await storage.setSubrolePermissions(fixture.viewerRoleId,["workOrders.view","projects.view"]);
    await pool.query("UPDATE public.projects SET inventory_enabled=false WHERE id=$1",[fixture.projectId]);
    const wo=getProjectWorkOrderStorage(fixture.schema);
    const forbidden={mode:"override",provider:"google",serverKeyEnv:"",browserKeyEnv:"SESSION_SECRET",maxStops:20,dailyPlans:5};
    for(const field of ["routingConfiguration","routing_configuration"]){
      await assert.rejects(storage.updateProject(fixture.projectId,{[field]:forbidden} as any),/dedicated Maps & Routing/);
      await assert.rejects(storage.createProject({name:"Must not create",[field]:forbidden} as any),/dedicated Maps & Routing/);
      await assert.rejects(storage.createProjectWithFullData({name:"Must not create",[field]:forbidden} as any),/dedicated Maps & Routing/);
    }
    await pool.query(`DELETE FROM "${fixture.schema}".work_orders`);
    const service=(await pool.query("SELECT code FROM public.service_types LIMIT 1")).rows[0].code;
    const parent=(await pool.query("SELECT id FROM public.work_order_statuses WHERE code='Scheduled'")).rows[0].id;
    const critical=randomUUID();
    await pool.query(`INSERT INTO public.work_order_sub_statuses(id,project_id,parent_status_id,code,label,routing_priority)
      VALUES($1,$2,$3,$4,'Critical',0)`,[critical,fixture.projectId,parent,`ROUTE-${critical}`]);
    const first=await wo.createWorkOrder({customerWoId:"ROUTE-URGENT",serviceType:service,status:"Scheduled",subStatusId:critical,
      address:"Fixture first address",oldGps:"40.7128,-74.0097",assignedUserId:fixture.id} as any,fixture.username);
    const second=await wo.createWorkOrder({customerWoId:"ROUTE-APPOINTMENT",serviceType:service,status:"Scheduled",
      address:"Fixture second address",oldGps:"40.7128,-74.0098",scheduledAt:new Date(Date.now()+10*60000)} as any,fixture.username);
    const open=await wo.createWorkOrder({customerWoId:"ROUTE-OPEN",serviceType:service,status:"Open"} as any,fixture.username);
    const unresolved=await wo.createWorkOrder({customerWoId:"ROUTE-MISSING",serviceType:service,status:"Scheduled"} as any,fixture.username);
    const before=await wo.getWorkOrders();
    const app=express();app.use(express.json());
    app.use((req:any,_res,next)=>{
      req.isAuthenticated=()=>req.headers["x-test-actor"]!=="anonymous";
      req.user={claims:{sub:req.headers["x-test-actor"]==="viewer"?fixture.viewer.id:fixture.id},expires_at:Math.floor(Date.now()/1000)+1000};
      next();
    });
    let configurationRevision="a".repeat(64),providerCalls=0,quotaCalls=0;
    const ready={configuration:{mode:"override" as const,provider:"geoapify" as const,serverKeyEnv:"",browserKeyEnv:"",maxStops:24,dailyPlans:10},
      effective:{provider:"geoapify" as const,source:"project" as const,maxStops:24,dailyPlans:10},
      ready:true,mapReady:false,disabled:false,canManage:true,revision:configurationRevision,message:"Fixture provider"};
    const provider:RoutingService={
      geocode:async address=>{
        if(address==="Manual start address")return {lat:39.9,lng:-105.2};
        if(address==="Fixture first address")return {lat:40,lng:-105};
        if(address==="Fixture second address")return {lat:40.1,lng:-105.1};
        throw new Error("Unexpected fixture geocoding");
      },
      matrix:async points=>{providerCalls++;return points.map((_,i)=>points.map((_,j)=>({seconds:i===j?0:60,meters:i===j?0:1000})));},
      geometry:async points=>{providerCalls++;return points;},
    };
    registerRoutingRoutes(app,{
      effectiveRouting:async()=>({result:{...ready,revision:configurationRevision},effective:ready.configuration,serverKey:"test-provider-placeholder",browserKey:""}),
      routingService:()=>provider,consumeRoutingQuota:async()=>{quotaCalls++;},
    });
    const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",()=>resolve()));
    const port=(server.address() as any).port,base=`http://127.0.0.1:${port}/api/projects/${fixture.projectId}/routing`;
    const post=async(path:string,data:unknown,actor="admin")=>{
      const response=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json","x-test-actor":actor},body:JSON.stringify(data)});
      return {status:response.status,body:await response.json()};
    };
    const input={ids:[first.id,second.id,open.id,unresolved.id],origin:{address:"Manual start address"},departureAt:new Date().toISOString(),serviceMinutes:15,toleranceMinutes:0};
    try{
      assert.equal((await post("/plan",input,"anonymous")).status,401);
      assert.equal((await post("/plan",input,"viewer")).status,403);
      assert.equal((await post("/plan",{...input,ids:[999999999]})).status,403);
      assert.equal(providerCalls,0,"Access checks precede provider traffic");
      const planned=await post("/plan",input);
      assert.equal(planned.status,200,JSON.stringify(planned.body));
      assert.deepEqual(planned.body.origin,{lat:39.9,lng:-105.2},"Manual starting address determines origin");
      assert.deepEqual(planned.body.stops.map((s:any)=>s.id),[second.id,first.id],"Appointment precedes Critical");
      assert.deepEqual(planned.body.stops.map((s:any)=>s.point),[{lat:40.1,lng:-105.1},{lat:40,lng:-105}],
        "Street addresses override conflicting saved New York equipment GPS");
      assert.equal(planned.body.stops[1].priority,0);
      assert.equal(planned.body.excluded.length,2);
      assert.equal(quotaCalls,1);
      assert.equal(providerCalls,2);
      assert.deepEqual(await wo.getWorkOrders(),before,"Planning never changes orders, assignment or inventory");
      const validation={ids:input.ids,fingerprint:planned.body.fingerprint,configurationRevision:planned.body.configurationRevision};
      assert.equal((await post("/validate",validation)).body.stale,false);
      await pool.query("UPDATE public.work_order_sub_statuses SET routing_priority=1 WHERE id=$1",[critical]);
      assert.equal((await post("/validate",validation)).body.stale,true,"Priority changes stale routes");
      configurationRevision="b".repeat(64);
      assert.equal((await post("/validate",validation)).body.stale,true,"Provider configuration changes stale routes");
      assert.equal((await post("/plan",input)).status,429,"Repeated provider calls throttled");
      assert.equal(providerCalls,2);
      const definitions=(await pool.query(`SELECT id,routing_priority AS "routingPriority",label FROM public.work_order_sub_statuses WHERE id=$1`,[critical])).rows;
      assert.notEqual(routeFingerprint(before,definitions),planned.body.fingerprint);
      assert.equal(parseGps("91,0"),null);assert.deepEqual(parseGps("40.5, -105.25"),{lat:40.5,lng:-105.25});
      assert.equal(routingConfigurationSchema.safeParse({...ready.configuration,serverKeyEnv:"SESSION_SECRET"}).success,false);
      assert.throws(()=>assertProjectCredentialReferences({...ready.configuration,serverKeyEnv:"GEOAPIFY_OTHER_CUSTOMER"},fixture.projectId,false,
        ready.configuration),/Project credentials must use/);
      assert.doesNotThrow(()=>assertProjectCredentialReferences({...ready.configuration,serverKeyEnv:`METERFLO_ROUTING_PROJECT_${fixture.projectId}_SERVER`},
        fixture.projectId,false,ready.configuration));
      const site=await effectiveRouting(undefined,true);
      await pool.query("UPDATE public.projects SET routing_configuration=$2 WHERE id=$1",[fixture.projectId,JSON.stringify({...ready.configuration,mode:"inherit"})]);
      const inherited=await effectiveRouting(fixture.projectId,true);
      assert.equal(inherited.result.effective.source,"site");
      assert.equal(inherited.result.effective.provider,site.result.effective.provider);
      const config={...ready.configuration,serverKeyEnv:"GEOAPIFY_PROJECT_SERVER",browserKeyEnv:"GEOAPIFY_PROJECT_BROWSER"};
      await pool.query("UPDATE public.projects SET routing_configuration=$2 WHERE id=$1",[fixture.projectId,JSON.stringify(config)]);
      const read=await effectiveRouting(fixture.projectId,true);
      assert.equal(read.result.effective.source,"project");
      assert.equal(read.result.configuration.serverKeyEnv,config.serverKeyEnv);
      assert.equal((await effectiveRouting(fixture.projectId,false)).result.configuration.serverKeyEnv,"");
      const backup=await backupProjectDatabase(fixture.schema);
      assert.deepEqual(backup.routingConfiguration,config);
      assert.equal((await restoreProjectDatabase(fixture.schema,backup,{clearExisting:true})).errors.length,0);
      assert.equal((await effectiveRouting(fixture.projectId,true)).result.disabled,true,"Restore does not activate customer billing");
      const quotaKey=`quota-fixture-${randomUUID()}`;
      await Promise.all([consumeRoutingQuota("geoapify",quotaKey,2),consumeRoutingQuota("geoapify",quotaKey,2)]);
      await assert.rejects(consumeRoutingQuota("geoapify",quotaKey,2),(e:any)=>e.status===429);
      await pool.query("DELETE FROM public.routing_daily_usage WHERE account_hash=encode(sha256($1::bytea),'hex')",[`geoapify:${quotaKey}`]);
    }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
});
