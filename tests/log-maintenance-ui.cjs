// Signed-in acceptance checks with normal session auth/role-management APIs.
// Only the isolated schema and temporary log directory are ever cleaned.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createServer } = require("node:http");
const path = require("node:path");
const fs = require("node:fs/promises");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");

(async () => {
  await import("dotenv/config");
  const { default: express } = await import("express");
  const { default: bcrypt } = await import("bcryptjs");
  const { pool } = await import("../server/db.ts");
  const { storage } = await import("../server/storage.ts");
  const { setupAuth } = await import("../server/replitAuth.ts");
  const { registerLogMaintenanceRoutes } = await import("../server/logMaintenanceRoutes.ts");
  const { fixture } = await import("./log-maintenance-fixture.ts");
  const { LogMaintenanceService } = await import("../server/logMaintenanceService.ts");
  const realURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const tag = randomUUID().slice(0,8);
  const users = [], roles = [];
  let browser, server, sessionStore, f;
  try {
    f = await fixture();
    browser = await chromium.launch({ executablePath:process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",headless:true,args:["--no-sandbox","--disable-dev-shm-usage"] });
    const adminRole = await storage.getAdministratorSubrole();
    const password = `Fixture-${randomUUID()}!`;
    const hash = await bcrypt.hash(password,10);
    const admin = await storage.createLocalUser(`logs-admin-${tag}`,hash,"admin","Log","Fixture",null,adminRole.id);
    users.push(admin.id);
    const adminReal = await browser.newContext({baseURL:realURL});
    assert.equal((await adminReal.request.post("/api/auth/local/login",{data:{username:admin.username,password}})).status(),200);
    const discovered = await (await adminReal.request.get("/api/permissions")).json();
    assert.ok(discovered.some(p => p.key === "maintenance.logManagement" && p.category === "Maintenance"),"New permission appears in normal role management");
    const roleResponse = await adminReal.request.post("/api/subroles",{data:{key:`logs_fixture_${tag}`,label:`Log fixture ${tag}`,baseRole:"user"}});
    assert.equal(roleResponse.status(),201);
    const role = await roleResponse.json(); roles.push(role.id);
    const grant = permissions => adminReal.request.put(`/api/subroles/${role.id}/permissions`,{data:{permissions}});
    assert.equal((await grant(["nav.maintenance","nav.dashboard"])).status(),200);
    const user = await storage.createLocalUser(`logs-user-${tag}`,hash,"user","Log","Operator",null,role.id);
    users.push(user.id);
    const userReal = await browser.newContext({baseURL:realURL});
    assert.equal((await userReal.request.post("/api/auth/local/login",{data:{username:user.username,password}})).status(),200);
    const app = express();
    app.use(express.json());
    await setupAuth(app);
    app.use((req,_res,next) => { sessionStore=req.sessionStore; next(); });
    registerLogMaintenanceRoutes(app,f.service);
    app.use("/api",async (req,res) => {
      try {
        const upstream = await fetch(realURL+req.originalUrl,{method:req.method,headers:{
          ...(req.headers.cookie ? {cookie:req.headers.cookie} : {}),
          ...(req.method !== "GET" ? {"content-type":"application/json"} : {}),
        },...(req.method !== "GET" && req.method !== "HEAD" ? {body:JSON.stringify(req.body || {})}:{}),redirect:"manual"});
        res.status(upstream.status);
        if (upstream.headers.get("content-type")) res.setHeader("content-type",upstream.headers.get("content-type"));
        res.send(Buffer.from(await upstream.arrayBuffer()));
      } catch { res.status(502).send("Fixture proxy failed"); }
    });
    app.use(express.static(path.resolve("dist/public")));
    app.get("*",(_req,res) => res.sendFile(path.resolve("dist/public/index.html")));
    server=createServer(app); await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
    const baseURL=`http://127.0.0.1:${server.address().port}`;
    const authenticated = async real => {
      const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000}});
      await context.addCookies((await real.cookies(realURL)).map(c => ({name:c.name,value:c.value,domain:"127.0.0.1",path:"/",httpOnly:true,secure:false,sameSite:"Lax"})));
      return context;
    };
    const anonymous=await browser.newContext({baseURL});
    for (const [method,url,data] of [
      ["get","/api/maintenance/logs"],["put","/api/maintenance/logs/policy",{}],
      ["post","/api/maintenance/logs/preview",{}],["post","/api/maintenance/logs/cleanup",{}],
    ]) assert.equal((await anonymous.request[method](url,{data})).status(),401);
    const operator=await authenticated(userReal);
    for (const [method,url,data] of [
      ["get","/api/maintenance/logs"],["put","/api/maintenance/logs/policy",{}],
      ["post","/api/maintenance/logs/preview",{}],["post","/api/maintenance/logs/cleanup",{}],
    ]) assert.equal((await operator.request[method](url,{data})).status(),403);
    const denied=await operator.newPage();
    await denied.goto("/maintenance");
    await denied.getByTestId("text-page-title").waitFor();
    assert.equal(await denied.getByRole("heading",{name:"Log maintenance",exact:true}).count(),0);
    assert.equal((await grant(["nav.maintenance","nav.dashboard","maintenance.logManagement"])).status(),200);
    await denied.reload();
    await denied.getByRole("heading",{name:"Log maintenance",exact:true}).waitFor();
    const adminContext=await authenticated(adminReal);
    assert.equal((await adminContext.request.get("/api/maintenance/logs")).status(),200);
    const page=await operator.newPage(), errors=[], failed=[];
    page.on("pageerror",e => errors.push(e.message));
    page.on("response",r => { if (r.status()>=400 && r.url().includes("/api/")) failed.push([r.status(),r.url()]); });
    await page.goto("/maintenance");
    await page.getByRole("button",{name:"Save policy",exact:true}).waitFor();
    assert.equal(await page.getByRole("switch").isChecked(),false);
    await page.getByLabel("Database history retention (days)",{exact:true}).fill("180");
    const saveResponse=page.waitForResponse(r => r.url().endsWith("/api/maintenance/logs/policy") && r.request().method()==="PUT");
    await page.getByRole("button",{name:"Save policy",exact:true}).click();
    assert.equal((await saveResponse).status(),200);
    await page.reload();
    await page.getByRole("button",{name:"Save policy",exact:true}).waitFor();
    assert.equal(await page.getByLabel("Database history retention (days)",{exact:true}).inputValue(),"180");
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}customer_api_logs`)).rows[0].c,11,"Save/reload is non-destructive");
    await page.getByText("Customer API attempt history",{exact:true}).last().click();
    await page.getByLabel("Delete records older than",{exact:true}).fill("2001-01-01T00:00");
    await page.getByRole("button",{name:"Preview cleanup",exact:true}).click();
    await page.getByRole("button",{name:"Review irreversible cleanup",exact:true}).waitFor();
    await page.getByRole("button",{name:"Review irreversible cleanup",exact:true}).click();
    await page.getByRole("button",{name:"Cancel",exact:true}).click();
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}customer_api_logs`)).rows[0].c,11);
    await page.getByRole("button",{name:"Review irreversible cleanup",exact:true}).click();
    const cleanupResponse=page.waitForResponse(r => r.url().endsWith("/api/maintenance/logs/cleanup"));
    await page.getByRole("button",{name:"Permanently clean selected logs",exact:true}).click();
    const response=await cleanupResponse; assert.equal(response.status(),200);
    const result=await response.json(); assert.equal(result.removed,3); assert.deepEqual(result.errors,[]);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}customer_api_logs`)).rows[0].c,8);
    assert.equal((await pool.query(`SELECT count(*)::int c FROM ${f.n}customer_api_deliveries`)).rows[0].c,6);
    const restarted=new LogMaintenanceService(f.repository,f.files);
    assert.equal((await restarted.policy()).historyDays,180);
    assert.equal((await restarted.policy()).automatic,false);
    assert.equal((await restarted.history())[0].actor,user.id);
    await fs.mkdir("/tmp/log-maintenance-checks",{recursive:true});
    await page.locator("#log-maintenance").scrollIntoViewIfNeeded();
    await page.screenshot({path:"/tmp/log-maintenance-checks/desktop.png"});
    await page.setViewportSize({width:402,height:874});
    await page.locator("#log-maintenance").scrollIntoViewIfNeeded();
    assert.ok(await page.locator("#log-maintenance").evaluate(el => el.scrollWidth <= el.clientWidth+1));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
    await page.screenshot({path:"/tmp/log-maintenance-checks/mobile.png"});
    assert.deepEqual(errors,[]);
    // The existing global timezone hook fetches an admin-only setting for all
    // accounts. Keep that known unrelated 403 visible, but require clean log and
    // backup APIs for the delegated log-only role.
    assert.deepEqual(failed.filter(([,url]) => !url.endsWith("/api/settings/timezone")),[]);
    assert.equal((await operator.request.post("/api/maintenance/logs/cleanup",{data:{token:randomUUID(),confirm:false}})).status(),400);
    assert.equal((await operator.request.post("/api/maintenance/logs/cleanup",{data:{token:randomUUID(),confirm:true}})).status(),409);
    assert.equal((await operator.request.put("/api/maintenance/logs/policy",{data:{automatic:false,rotationMiB:0,archiveDays:30,archiveBudgetMiB:200,historyDays:90}})).status(),400);
    console.log("PASS normal role discovery/grant; unauthenticated and forbidden on every route; log-only UI; save/reload/cancel/confirm; protected queue; restart persistence; desktop/phone and browser console.");
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    if (sessionStore?.close) await sessionStore.close();
    for (const id of users) {
      await pool.query("DELETE FROM public.sessions WHERE sess->'passport'->>'user'=$1 OR sess->'passport'->'user'->'claims'->>'sub'=$1",[id]);
      await pool.query("DELETE FROM public.users WHERE id=$1",[id]);
    }
    for (const id of roles) await pool.query("DELETE FROM public.subroles WHERE id=$1",[id]);
    if (f) await f.dispose();
    await pool.end();
  }
})().then(() => process.exit(0),error => { console.error(error);process.exit(1); });
