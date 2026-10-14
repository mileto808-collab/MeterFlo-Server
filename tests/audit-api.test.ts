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

test("real role grants, scoped audit API, verified identity, retention access and responsive UI",{skip:!process.env.REPLIT_DEV_DOMAIN},async()=>{
  const base=`https://${process.env.REPLIT_DEV_DOMAIN}`,suffix=randomUUID().slice(0,8);
  const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
  const password=randomBytes(24).toString("hex")+"!Aa1",ids:string[]=[],projects:any[]=[],sessions:string[]=[];
  let subroleId:number|undefined;
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
        await expect(page.getByText("Stored audit history",{exact:true})).toBeVisible();
        await expect(page.getByText("Retention controls",{exact:true})).toBeVisible();
        await page.screenshot({path:"generated-artifacts/audit/admin-retention.jpg",fullPage:true});
        await addCookie(viewer.cookie);await page.goto(origin+"/audit-logs");
        await expect(page.getByTestId("text-audit-title")).toBeVisible();
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
    assert.equal((await request(admin.cookie,`/api/subroles/${subroleId}/permissions`,"PUT",{permissions:[]})).status,200);
    assert.equal((await request(viewer.cookie,"/api/audit")).status,403);
    assert.equal((await request(viewer.cookie,"/api/audit/options")).status,403);
    // Deleted-project events keep their original project ID, never global.
    await request(admin.cookie,`/api/projects/${projects[1].id}`,"DELETE");
    const deleted=await request(admin.cookie,`/api/audit?projectId=${projects[1].id}&entityType=projects`);
    assert.ok(deleted.data.events.some((e:any)=>e.action==="deleted"&&e.projectId===projects[1].id));
  }finally{
    for(const p of projects) {
      await db.query(`DROP SCHEMA IF EXISTS "${p.databaseName.replace(/"/g,'""')}" CASCADE`);
      await db.query("DELETE FROM public.projects WHERE id=$1",[p.id]);
    }
    await db.query("DELETE FROM public.users WHERE id=ANY($1::varchar[])",[ids]);
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
