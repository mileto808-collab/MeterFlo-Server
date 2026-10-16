import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID,randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";
import express from "express";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium,expect } from "@playwright/test";
import { supportedAuditActions } from "../shared/audit";

test("real role grants, scoped audit API, verified identity, retention access and responsive UI",{skip:!process.env.REPLIT_DEV_DOMAIN},async()=>{
  const base=`https://${process.env.REPLIT_DEV_DOMAIN}`,suffix=randomUUID().slice(0,8);
  const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const password=randomBytes(24).toString("hex")+"!Aa1",ids:string[]=[],projects:any[]=[],sessions:string[]=[];
   let subroleId:number|undefined,groupId:number|undefined;
  const request=async(cookie:string,route:string,method="GET",body?:unknown)=>{
    const res=await fetch(base+route,{method,headers:{Cookie:cookie,"Content-Type":"application/json"},
      body:body===undefined?undefined:JSON.stringify(body)});
    const text=await res.text();return {status:res.status,data:text?JSON.parse(text):undefined};
  };
  const makeUser=async(role:string)=>{
    const id=randomUUID(),username=`audit-api-${role}-${suffix}`;
    const {rows:[adminRole]}=await db.query("SELECT id FROM public.subroles WHERE base_role='admin' ORDER BY id LIMIT 1");
    await db.query("INSERT INTO public.users(id,username,password_hash,role,subrole_id) VALUES($1,$2,$3,$4,$5)",
      [id,username,await bcrypt.hash(password,10),role,role==="admin"?adminRole?.id:null]);
    ids.push(id);
    const res=await fetch(base+"/api/auth/local/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username,password})});
    assert.equal(res.status,200);
    const cookie=res.headers.get("set-cookie")?.split(";")[0];assert.ok(cookie);
    sessions.push(decodeURIComponent(cookie.split("=").slice(1).join("=")).split(".")[0].slice(2));
    return {id,cookie};
  };
  // External fixture preparation represents projects that predate auditing.
  // It intentionally creates no application audit events.
  const makeEmptyProject=async(name:string)=>{
    const {rows:[project]}=await db.query("INSERT INTO public.projects(name) VALUES($1) RETURNING *",[name]);
    projects.push(project);return project;
  };
  try {
    const admin=await makeUser("admin"),viewer=await makeUser("user");
    assert.equal((await request(viewer.cookie,"/api/audit")).status,403);
    const permissions=await request(admin.cookie,"/api/permissions");
    for(const key of ["audit.view","audit.viewAllProjects","audit.manageRetention"]) assert.ok(permissions.data.some((p:any)=>p.key===key));
    const role=await request(admin.cookie,"/api/subroles","POST",{key:`audit_fixture_${suffix}`,label:`Audit viewer ${suffix}`,baseRole:"user",permissions:["audit.view"]});
    assert.equal(role.status,201);subroleId=role.data.id;
    assert.equal((await request(admin.cookie,`/api/users/${viewer.id}/subrole`,"PATCH",{subroleId})).status,200);
    for(let n=0;n<2;n++){
      const p=await request(admin.cookie,"/api/projects","POST",{name:`Audit API ${suffix} ${n}`,systemReadingDecimalPlaces:4,moduleReadingDecimalPlaces:4});
      assert.equal(p.status,201);projects.push(p.data);
    }
    assert.equal((await request(admin.cookie,`/api/users/${viewer.id}/projects`,"POST",{projectId:projects[0].id})).status,201);
    const scoped=await request(viewer.cookie,"/api/audit");assert.equal(scoped.status,200);
    assert.ok(scoped.data.events.length>0);
    assert.ok(scoped.data.events.every((e:any)=>e.projectId===projects[0].id));
    const options=await request(viewer.cookie,"/api/audit/options");
    assert.deepEqual(options.data.projects.map((p:any)=>p.id),[projects[0].id]);
    assert.equal(options.data.canManage,false);
    assert.deepEqual(options.data.actions.slice(0,3),["created","updated","deleted"],"common actions listed first");
    for(const action of supportedAuditActions) assert.ok(options.data.actions.includes(action),`supported ${action} available before activity`);
    assert.equal((await request(viewer.cookie,`/api/audit?projectId=${projects[0].id}&action=updated`)).data.total,0);
    const emptyDirect=await makeEmptyProject(`Audit empty direct ${suffix}`);
    const emptyGroup=await makeEmptyProject(`Audit empty group ${suffix}`);
    await db.query("INSERT INTO public.user_projects(user_id,project_id) VALUES($1,$2)",[viewer.id,emptyDirect.id]);
    const group=await request(admin.cookie,"/api/user-groups","POST",{
      name:`Audit group ${suffix}`,projectIds:[projects[0].id,emptyGroup.id],
    });
    assert.equal(group.status,201);groupId=group.data.id;
    assert.equal((await request(admin.cookie,`/api/users/${viewer.id}/groups`,"POST",{groupId})).status,201);
    // Remove only this disposable project's association events to exercise
    // group-authorized choices with genuinely zero historical events.
    const fixtureClient=await db.connect();
    try {
      await fixtureClient.query("BEGIN");
      await fixtureClient.query("SELECT set_config('meterflo.audit_retention','authorized',true)");
      await fixtureClient.query("DELETE FROM meterflo_audit.events WHERE project_id=$1",[emptyGroup.id]);
      await fixtureClient.query("COMMIT");
    } finally {fixtureClient.release();}
    const emptyOptions=await request(viewer.cookie,"/api/audit/options");
    assert.deepEqual(emptyOptions.data.projects.map((p:any)=>p.id).sort((a:number,b:number)=>a-b),
      [projects[0].id,emptyDirect.id,emptyGroup.id].sort((a,b)=>a-b),"direct/group empty projects visible; overlaps deduplicated");
    const allOptions=await request(admin.cookie,"/api/audit/options");
    for(const project of projects) assert.ok(allOptions.data.projects.some((p:any)=>p.id===project.id));
    for(const project of [emptyDirect,emptyGroup]){
      const empty=await request(viewer.cookie,`/api/audit?projectId=${project.id}&action=updated`);
      assert.equal(empty.status,200);assert.equal(empty.data.total,0);assert.deepEqual(empty.data.events,[]);
      assert.equal(Number((await db.query("SELECT count(*) FROM meterflo_audit.events WHERE project_id=$1",[project.id])).rows[0].count),0,
        "options do not manufacture historical events");
    }
    const visibleLegacy=`legacy.visible.${suffix}`,hiddenLegacy=`legacy.hidden.${suffix}`;
    for(const [project,action] of [[projects[0],visibleLegacy],[projects[1],hiddenLegacy]] as const){
      await db.query(`INSERT INTO meterflo_audit.events(actor_id,actor_label,actor_kind,source,action,entity_type,
        entity_id,entity_label,project_id,project_label,operation_id,outcome)
        VALUES($1,'Audit fixture','user','fixture',$2,'projects',$3,$3,$4,$5,$6,'success')`,
        [admin.id,action,String(project.id),project.id,project.name,randomUUID()]);
    }
    const legacyOptions=await request(viewer.cookie,"/api/audit/options");
    assert.ok(legacyOptions.data.actions.includes(visibleLegacy),"authorized historical action retained");
    assert.ok(!legacyOptions.data.actions.includes(hiddenLegacy),"unknown hidden activity does not leak through options");
    const hidden=await request(viewer.cookie,`/api/audit?projectId=${projects[1].id}`);
    assert.equal(hidden.data.total,0);assert.equal(hidden.data.events.length,0);
    const hiddenAdmin=await request(admin.cookie,`/api/audit?projectId=${projects[1].id}`);
    assert.ok(hiddenAdmin.data.events.length>0);
    assert.equal((await request(viewer.cookie,`/api/audit/${hiddenAdmin.data.events[0].id}`)).status,404);
    assert.equal((await request(viewer.cookie,"/api/audit/retention")).status,403);
    assert.equal((await request(viewer.cookie,"/api/audit/retention","PUT",{automatic:true,days:365})).status,403);
    assert.equal((await request(viewer.cookie,"/api/audit/retention/cleanup","POST",{token:randomUUID(),confirm:true})).status,403);
    assert.equal((await request(admin.cookie,"/api/audit?limit=1001")).status,400);
    assert.equal((await request(admin.cookie,"/api/audit?from=bad")).status,400);
    const edit=await request(admin.cookie,`/api/projects/${projects[0].id}`,"PATCH",{description:"Audit fixture changed",updatedBy:viewer.id});
    assert.equal(edit.status,200);
    const latest=await request(viewer.cookie,`/api/audit?projectId=${projects[0].id}&entityType=projects&entityId=${projects[0].id}`);
    assert.equal(latest.data.events[0].actorId,admin.id,"posted identity does not override verified session actor");
    assert.ok(latest.data.events[0].changes.some((c:any)=>c.field==="description"));
    assert.equal(latest.data.events[0].action,"updated","real edit records updated with verified actor and project scope");
    assert.equal(latest.data.events[0].projectId,projects[0].id);
    assert.equal((await request(admin.cookie,`/api/projects/${projects[0].id}`,"PATCH",{description:"Audit fixture changed"})).status,200);
    assert.equal((await request(viewer.cookie,`/api/audit?projectId=${projects[0].id}&entityType=projects&entityId=${projects[0].id}`)).data.total,
      latest.data.total,"unchanged saves do not generate updates");
    projects[0].name=`Audit renamed ${suffix}`;
    assert.equal((await request(admin.cookie,`/api/projects/${projects[0].id}`,"PATCH",{name:projects[0].name})).status,200);
    const renamedOptions=await request(viewer.cookie,"/api/audit/options");
    assert.deepEqual(renamedOptions.data.projects.filter((p:any)=>p.id===projects[0].id),
      [{id:projects[0].id,name:projects[0].name}],"one current label overrides older snapshots");
    const inventory=await request(admin.cookie,"/api/audit/retention");
    assert.equal(inventory.status,200);assert.equal(typeof inventory.data.bytes,"number");
    const maintenance=await request(admin.cookie,"/api/maintenance/logs");
    assert.equal(maintenance.status,200);assert.equal(typeof maintenance.data.auditInventory.count,"number");
    const docs=await request(admin.cookie,"/api/documentation/audit");
    assert.equal(docs.status,200);assert.ok(docs.data.includes("meterflo_audit"));
    const future=await request(admin.cookie,"/api/audit/retention/preview","POST",{before:new Date(Date.now()+86400000).toISOString()});
    assert.equal(future.status,400);
    // A cutoff before deployment previews zero entries and safely exercises
    // confirmation, actor binding and single-use without deleting user history.
    const preview=await request(admin.cookie,"/api/audit/retention/preview","POST",{before:"1970-01-01T00:00:00.000Z"});
    assert.equal(preview.status,200);assert.equal(preview.data.count,0);
    assert.equal((await request(admin.cookie,"/api/audit/retention/cleanup","POST",{token:preview.data.token,confirm:true})).data.removed,0);
    assert.equal((await request(admin.cookie,"/api/audit/retention/cleanup","POST",{token:preview.data.token,confirm:true})).status,409);
    const grantAll=()=>request(admin.cookie,`/api/subroles/${subroleId}/permissions`,"PUT",{permissions:["audit.view","audit.viewAllProjects"]});
    assert.equal((await grantAll()).status,200);
    assert.ok((await request(viewer.cookie,`/api/audit?projectId=${projects[1].id}`)).data.events.length>0);
    assert.ok((await request(viewer.cookie,"/api/audit/options")).data.actions.includes(hiddenLegacy),"normal all-project grant expands historical actions");
    assert.equal((await request(viewer.cookie,"/api/audit/retention")).status,403,"all-project read does not grant cleanup");
    await request(admin.cookie,`/api/subroles/${subroleId}/permissions`,"PUT",{permissions:["audit.view"]});
    if(process.argv.includes("--browser")){
      // Built UI + real authenticated API. This test transport is closed below;
      // no production authentication bypass or development route is introduced.
      const web=express();web.use(express.raw({type:()=>true,limit:"5mb"}));
      web.use("/api",async(req,res)=>{
        const abort=new AbortController();res.on("close",()=>abort.abort());
        try {
          const upstream=await fetch(base+req.originalUrl,{method:req.method,headers:{
            Cookie:req.headers.cookie||"","Content-Type":req.headers["content-type"]||"application/json"},
            body:["GET","HEAD"].includes(req.method)?undefined:req.body,redirect:"manual",signal:abort.signal});
          res.status(upstream.status);res.set("Content-Type",upstream.headers.get("content-type")||"application/json");
          if(upstream.body) Readable.fromWeb(upstream.body as any).on("error",()=>res.end()).pipe(res);
          else res.end();
        }catch{if(!res.headersSent&&!res.destroyed) res.status(502).json({message:"Test transport unavailable"});}
      });
      web.use(express.static(path.resolve("dist/public")));web.use((_req,res)=>res.sendFile(path.resolve("dist/public/index.html")));
      const server=createServer(web);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
      const origin=`http://127.0.0.1:${(server.address() as any).port}`;
      const browser=await chromium.launch({executablePath:"/repl/tools/bin/chromium",args:["--no-sandbox"]});
      await mkdir("generated-artifacts/audit",{recursive:true});
      try{
        const context=await browser.newContext({viewport:{width:1440,height:1000}});
        const addCookie=async(cookie:string)=>{
          const [name,...value]=cookie.split("=");await context.addCookies([{name,value:value.join("="),url:origin,httpOnly:true}]);
        };
        await addCookie(admin.cookie);
        const page=await context.newPage();const errors:string[]=[];
        page.on("pageerror",e=>errors.push(e.message));
        await page.goto(origin+"/settings");
        await page.getByTestId("settings-tab-access").click();
        await page.getByTestId("settings-section-nav-access-levels").click();
        await page.getByTestId(`button-edit-access-level-${subroleId}`).click();
        for(const key of ["audit.view","audit.viewAllProjects","audit.manageRetention"]) await expect(page.getByTestId(`checkbox-perm-${key}`)).toBeVisible();
        await page.getByTestId("checkbox-perm-audit.view").uncheck();
        await page.getByTestId("button-save-subrole").click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        assert.equal((await request(viewer.cookie,"/api/audit")).status,403,"actual role UI revoke enforced by API");
        await page.getByTestId(`button-edit-access-level-${subroleId}`).click();
        await page.getByTestId("checkbox-perm-audit.view").check();
        await page.getByTestId("button-save-subrole").click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        assert.equal((await request(viewer.cookie,"/api/audit")).status,200,"actual role UI grant enforced by API");
        await page.goto(origin+"/audit-logs");
        await page.getByRole("button",{name:"Audit retention settings",exact:true}).click();
        await expect(page.getByText("Stored audit history",{exact:true})).toBeVisible();
        await expect(page.getByText("Retention controls",{exact:true})).toBeVisible();
        await page.screenshot({path:"generated-artifacts/audit/admin-retention.jpg",fullPage:true});
        await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
        await addCookie(viewer.cookie);await page.goto(origin+"/audit-logs");
        await expect(page.getByTestId("text-audit-title")).toBeVisible();
        await expect(page.getByRole("button",{name:/updated.*web/i}).first()).toBeVisible();
        await page.getByRole("button",{name:"Filter audit events",exact:true}).click();
        await expect(page.locator(`#audit-project option[value="${emptyDirect.id}"]`)).toHaveCount(1);
        await expect(page.locator(`#audit-project option[value="${emptyGroup.id}"]`)).toHaveCount(1);
        await expect(page.locator(`#audit-project option[value="${projects[1].id}"]`)).toHaveCount(0);
        await expect(page.locator('#audit-action option[value="updated"]')).toHaveCount(1);
        await page.getByLabel("Project",{exact:true}).selectOption(String(emptyDirect.id));
        await page.getByLabel("Action",{exact:true}).selectOption("updated");
        await page.getByRole("button",{name:"Apply filters",exact:true}).click();
        await expect(page.getByRole("heading",{name:"No matching audit events"})).toBeVisible();
        await expect(page.getByText(/^0 matching events/)).toBeVisible();
        await page.screenshot({path:"generated-artifacts/audit/filter-empty.jpg",fullPage:true});
        const refreshed=await makeEmptyProject(`Audit refreshed ${suffix}`);
        await db.query("INSERT INTO public.user_projects(user_id,project_id) VALUES($1,$2)",[viewer.id,refreshed.id]);
        await expect(page.locator(`#audit-project option[value="${refreshed.id}"]`)).toHaveCount(0);
        await page.getByRole("button",{name:"Refresh audit events",exact:true}).click();
        await page.getByRole("button",{name:"Filter audit events",exact:true}).click();
        await expect(page.locator(`#audit-project option[value="${refreshed.id}"]`)).toHaveCount(1);
        await expect(page.getByText(/^0 matching events/)).toBeVisible();
        await page.getByRole("button",{name:"Clear filters",exact:true}).click();
        await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
        await expect(page.getByRole("button",{name:/updated.*web/i}).first()).toBeVisible();
        await page.screenshot({path:"generated-artifacts/audit/desktop.jpg",fullPage:true});
        await page.getByRole("button",{name:/updated.*web/i}).first().click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.screenshot({path:"generated-artifacts/audit/detail.jpg"});
        await page.keyboard.press("Escape");
        await page.setViewportSize({width:390,height:844});
        await page.screenshot({path:"generated-artifacts/audit/mobile.jpg",fullPage:true});
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),"mobile page fits viewport");
        assert.deepEqual(errors,[]);
        await context.close();
      }finally{await browser.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    }
    // Deleted-project events keep their original project ID, never global.
    await request(admin.cookie,`/api/projects/${projects[1].id}`,"DELETE");
    const deleted=await request(admin.cookie,`/api/audit?projectId=${projects[1].id}&entityType=projects`);
    assert.ok(deleted.data.events.some((e:any)=>e.action==="deleted"&&e.projectId===projects[1].id));
    const deletedOptions=await request(admin.cookie,"/api/audit/options");
    assert.deepEqual(deletedOptions.data.projects.filter((p:any)=>p.id===projects[1].id),
      [{id:projects[1].id,name:projects[1].name}],"deleted history remains selectable once, under its latest label");
    const scopedAfterDelete=await request(viewer.cookie,"/api/audit/options");
    assert.ok(!scopedAfterDelete.data.projects.some((p:any)=>p.id===projects[1].id));
    assert.ok(!scopedAfterDelete.data.actions.includes(hiddenLegacy));
    assert.equal((await request(viewer.cookie,`/api/audit?projectId=${projects[1].id}`)).data.total,0);
    assert.equal((await request(admin.cookie,`/api/subroles/${subroleId}/permissions`,"PUT",{permissions:[]})).status,200);
    assert.equal((await request(viewer.cookie,"/api/audit")).status,403);
    assert.equal((await request(viewer.cookie,"/api/audit/options")).status,403);
  }finally{
    for(const p of projects) {
      if(p.databaseName) await db.query(`DROP SCHEMA IF EXISTS "${p.databaseName.replace(/"/g,'""')}" CASCADE`);
      await db.query("DELETE FROM public.projects WHERE id=$1",[p.id]);
    }
    await db.query("DELETE FROM public.users WHERE id=ANY($1::varchar[])",[ids]);
    if(groupId) await db.query("DELETE FROM public.user_groups WHERE id=$1",[groupId]);
    if(subroleId){await db.query("DELETE FROM public.subrole_permissions WHERE subrole_id=$1",[subroleId]);await db.query("DELETE FROM public.subroles WHERE id=$1",[subroleId]);}
    await db.query("DELETE FROM public.sessions WHERE sid=ANY($1::varchar[])",[sessions]);
    const c=await db.connect();
    try{await c.query("BEGIN");await c.query("SELECT set_config('meterflo.audit_retention','authorized',true)");
      await c.query("DELETE FROM meterflo_audit.events WHERE actor_id=ANY($1::text[]) OR project_id=ANY($2::int[])",[ids,projects.map(p=>p.id)]);
      await c.query("DELETE FROM meterflo_audit.operations WHERE actor_id=ANY($1::text[]) OR project_id=ANY($2::int[])",[ids,projects.map(p=>p.id)]);
      await c.query("COMMIT");
    }finally{c.release();}
    await db.end();
  }
});
