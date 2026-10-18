import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import bcrypt from "bcryptjs";
import { chromium, expect } from "@playwright/test";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { Readable } from "node:stream";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { registerCustomerExtensions } from "../server/customerExtensions";
import { loadCustomerRelease } from "../shared/customer-release";

// Optional native acceptance: uses real local authentication, role-management APIs,
// project scope and the existing development DB. No extension is enabled in the live app.
test("composed report screen honors normal role grants and preserves customer DB objects and audit history",async()=>{
  assert.ok(process.env.REPLIT_DEV_DOMAIN,"Run with the development application available");
  assert.ok(fs.existsSync("dist/public/index.html"),"Build the application before integration acceptance");
  const live=`https://${process.env.REPLIT_DEV_DOMAIN}`,suffix=randomUUID().slice(0,8);
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),"meterflo-extension-acceptance-"));
  const users:string[]=[],sessions:string[]=[],projects:any[]=[];
  const password=randomBytes(24).toString("hex")+"!Aa1";
  let roleId:number|undefined,server:any,browser:any;
  const request=async(cookie:string,route:string,method="GET",body?:unknown)=>{
    const response=await fetch(live+route,{method,headers:{Cookie:cookie,"Content-Type":"application/json"},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  const makeUser=async(role:string)=>{
    const id=randomUUID(),username=`extension-${role}-${suffix}`;
    const {rows:[admin]}=await pool.query("SELECT id FROM public.subroles WHERE base_role='admin' ORDER BY id LIMIT 1");
    await pool.query("INSERT INTO public.users(id,username,password_hash,role,subrole_id) VALUES($1,$2,$3,$4,$5)",
      [id,username,await bcrypt.hash(password,10),role,role==="admin"?admin?.id:null]);
    users.push(id);
    const response=await fetch(live+"/api/auth/local/login",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({username,password})});
    assert.equal(response.status,200);
    const cookie=response.headers.get("set-cookie")!.split(";")[0];
    sessions.push(decodeURIComponent(cookie.split("=").slice(1).join("=")).split(".")[0].slice(2));
    return {id,cookie};
  };
  // A random, isolated customer-owned schema/table/column exercises ownership.
  const schema=`ext_acceptance_${suffix}`;
  try {
    const admin=await makeUser("admin"),viewer=await makeUser("user");
    const role=await request(admin.cookie,"/api/subroles","POST",{key:`extension_${suffix}`,
      label:`Customer report ${suffix}`,baseRole:"user",permissions:[]});
    assert.equal(role.status,201);roleId=role.data.id;
    assert.equal((await request(admin.cookie,`/api/users/${viewer.id}/subrole`,"PATCH",{subroleId:roleId})).status,200);
    for(let i=0;i<2;i++){
      const result=await request(admin.cookie,"/api/projects","POST",{name:`Extension acceptance ${suffix} ${i}`});
      assert.equal(result.status,201);projects.push(result.data);
    }
    assert.equal((await request(admin.cookie,`/api/users/${viewer.id}/projects`,"POST",{projectId:projects[0].id})).status,201);
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TABLE "${schema}".customer_records (id integer PRIMARY KEY, custom_column text)`);
    await pool.query(`INSERT INTO "${schema}".customer_records VALUES (1, 'preserve customer column')`);
    const auditBefore=(await pool.query("SELECT id FROM meterflo_audit.events WHERE actor_id=ANY($1::text[]) ORDER BY id",[users])).rows;
    const app=express();
    const auth:express.RequestHandler=async(req:any,res,next)=>{
      try{
        const result=await request(req.headers.cookie??"","/api/auth/user");
        if(result.status!==200 || !result.data?.id)return res.status(401).end();
        req.user={claims:{sub:result.data.id}};next();
      }catch{res.status(401).end();}
    };
    fs.copyFileSync("package.json",path.join(temporary,"package.json"));
    fs.copyFileSync("meterflo.release.json",path.join(temporary,"meterflo.release.json"));
    // The isolated composed-app fixture must include today's declared core SQL,
    // not just the old pre-inventory manifest. No migration SQL is run here.
    const coreMetadata=JSON.parse(fs.readFileSync("meterflo.release.json","utf8"));
    for(const migration of coreMetadata.migrations){
      const destination=path.join(temporary,migration.file);
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      fs.copyFileSync(migration.file,destination);
    }
    const packageDir=path.join(temporary,"customer-packages/project-report");
    fs.cpSync("examples/customer-report",packageDir,{recursive:true});
    fs.writeFileSync(path.join(temporary,"meterflo.instance.json"),JSON.stringify({
      installedSchemaVersion:coreMetadata.schemaVersion,
      approvedMigrations:coreMetadata.migrations.map(({id,sha256}:any)=>({id,sha256})),
      extensions:[{directory:"customer-packages/project-report"}]}));
    await build({entryPoints:[path.join(packageDir,"server.mjs")],bundle:true,platform:"node",format:"cjs",
      outfile:path.join(temporary,"report.cjs")});
    const require=createRequire(path.join(temporary,"package.json"));
    await registerCustomerExtensions(app,{auth,storage},loadCustomerRelease(temporary),async()=>require(path.join(temporary,"report.cjs")));
    // The built UI talks to the real app, while only this test server exposes the example.
    app.use("/api",async(req,res)=>{
      const abort=new AbortController();
      res.on("close",()=>abort.abort());
      try {
        const upstream=await fetch(live+"/api"+req.url,{headers:{Cookie:req.headers.cookie??""},signal:abort.signal});
        res.status(upstream.status).type(upstream.headers.get("content-type")??"application/json");
        if(upstream.body)Readable.fromWeb(upstream.body as any).on("error",()=>res.end()).pipe(res);
        else res.end();
      }catch{res.end();}
    });
    app.use(express.static(path.resolve("dist/public")));
    app.get("*",(_req,res)=>res.sendFile(path.resolve("dist/public/index.html")));
    server=app.listen(0);await new Promise<void>(resolve=>server.once("listening",resolve));
    const local=`http://127.0.0.1:${server.address().port}`,headers={Cookie:viewer.cookie};
    assert.deepEqual(await (await fetch(local+"/api/customer-extensions",{headers})).json(),[]);
    assert.equal((await fetch(local+"/api/customer-extensions/project-report/reports/projects",{headers})).status,403);
    assert.equal((await request(admin.cookie,`/api/subroles/${roleId}/permissions`,"PUT",{permissions:["projects.view"]})).status,200);
    const report=await (await fetch(local+"/api/customer-extensions/project-report/reports/projects",{headers})).json();
    assert.deepEqual(report.rows,[[projects[0].id,projects[0].name,"Yes"]]);
    browser=await chromium.launch({executablePath:"/repl/tools/bin/chromium",args:["--no-sandbox"]});
    const context=await browser.newContext();
    const [name,...value]=viewer.cookie.split("=");
    await context.addCookies([{name,value:value.join("="),url:local}]);
    const page=await context.newPage();
    await page.goto(local+"/extensions/project-report/projects");
    await expect(page.locator("main").getByText("Customer Project Report",{exact:true})).toBeVisible();
    await expect(page.getByRole("cell",{name:projects[0].name,exact:true})).toBeVisible();
    assert.equal(await page.getByRole("cell",{name:projects[1].name,exact:true}).count(),0);
    fs.mkdirSync("generated-artifacts/customer-updates",{recursive:true});
    await page.screenshot({path:"generated-artifacts/customer-updates/authenticated-report.png"});
    assert.equal((await request(admin.cookie,`/api/subroles/${roleId}/permissions`,"PUT",{permissions:[]})).status,200);
    assert.equal((await fetch(local+"/api/customer-extensions/project-report/reports/projects",{headers})).status,403);
    assert.equal((await pool.query(`SELECT custom_column FROM "${schema}".customer_records WHERE id=1`)).rows[0].custom_column,"preserve customer column");
    const auditAfter=(await pool.query("SELECT id FROM meterflo_audit.events WHERE id=ANY($1::uuid[]) ORDER BY id",
      [auditBefore.map(row=>row.id)])).rows;
    assert.deepEqual(auditAfter,auditBefore);
  }finally{
    if(browser)await browser.close();
    if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    for(const p of projects){
      if(p.databaseName)await pool.query(`DROP SCHEMA IF EXISTS "${p.databaseName.replaceAll('"','""')}" CASCADE`);
      await pool.query("DELETE FROM public.projects WHERE id=$1",[p.id]);
    }
    await pool.query("DELETE FROM public.users WHERE id=ANY($1::varchar[])",[users]);
    if(roleId){
      await pool.query("DELETE FROM public.subrole_permissions WHERE subrole_id=$1",[roleId]);
      await pool.query("DELETE FROM public.subroles WHERE id=$1",[roleId]);
    }
    await pool.query("DELETE FROM public.sessions WHERE sid=ANY($1::varchar[])",[sessions]);
    fs.rmSync(temporary,{recursive:true,force:true});
    await pool.end();
  }
});
