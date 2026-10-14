import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs, createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { registerRoutes } from "../server/routes";
import { MobileReleaseRepository } from "../server/mobileReleaseRepository";
import { MobileReleaseService } from "../server/mobileReleaseService";
import { apkFileStore, assertPrivateApkDirectory, apkStorageProvider, configuredApkStorage } from "../server/mobileReleaseStorage";
import { registerMobileReleaseRoutes } from "../server/mobileReleaseRoutes";
import { validateApk } from "../server/apkValidation";
import { APK_CHUNK_SIZE } from "../shared/mobile-releases";

export async function validApkFixture() {
  const file = path.join(os.tmpdir(), "meterflo-apidemos-v6.0.18.apk");
  const expected = "a9eecf37b26cd084855c530db81c2bb1b91f4c1b095a04f47aa7c20e2791f686";
  let bytes: Buffer;
  try { bytes = await fs.readFile(file); }
  catch {
    const response = await fetch("https://github.com/appium/android-apidemos/releases/download/v6.0.18/ApiDemos-debug.apk");
    if (!response.ok) throw new Error("Cannot obtain pinned valid APK fixture; no fake APK fallback is permitted.");
    bytes = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(file, bytes);
  }
  assert.equal(createHash("sha256").update(bytes).digest("hex"), expected, "APK fixture integrity");
  await validateApk(file);
  return { file, bytes };
}

export async function releaseFixture() {
  const schema = `apk_fixture_${randomUUID().replace(/-/g,"")}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-apk-test-"));
  const repo = new MobileReleaseRepository(pool, schema);
  await repo.initialize();
  const ref = { provider: "local" as const, location: root };
  const files = { ...apkFileStore };
  const service = new MobileReleaseService(repo, files, async () => ref);
  const suffix = randomUUID().slice(0,8);
  const admin = await storage.createLocalUser(`apk_admin_${suffix}`, "fixture-not-a-valid-password-hash", "admin");
  const tech = await storage.createLocalUser(`apk_tech_${suffix}`, "fixture-not-a-valid-password-hash", "user");
  const other = await storage.createLocalUser(`apk_other_${suffix}`, "fixture-not-a-valid-password-hash", "user");
  const customer = await storage.createLocalUser(`apk_customer_${suffix}`, "fixture-not-a-valid-password-hash", "customer");
  const actors = [admin, tech, other, customer];
  const roleIds: number[] = [];
  const app = express();
  app.use(express.json());
  // Test-server-only principal injection; real application's auth is not changed.
  app.use((req: any,_res,next) => {
    const id = req.headers["x-apk-fixture-actor"] || req.headers.cookie?.match(/(?:^|;\s*)apk_fixture_actor=([^;]+)/)?.[1];
    const actor = actors.find(a => a.id === id);
    req.user = actor ? { claims: { sub: actor.id }, expires_at: Math.floor(Date.now()/1000)+3600 } : undefined;
    req.isAuthenticated = () => !!actor;
    next();
  });
  const canManage = async (id: string) => {
    const user = await storage.getUser(id);
    return !!user && await storage.hasPermission(user,"settings.mobileConfig");
  };
  registerMobileReleaseRoutes(app, service, {
    authenticated: (req,res,next) => req.user ? next() : res.status(401).json({message:"Unauthorized"}),
    userId: async (req: any) => req.user?.claims?.sub || null,
    canManage,
  }, async () => ({provider:"local",available:true,message:"Isolated persistent test storage",maxSizeMB:512}));
  // Avoid loading real project/person/contact/security data into browser fixtures.
  app.get("/api/projects", (_req,res) => res.json([]));
  app.get("/api/users", (_req,res) => res.json(actors.map(a => ({id:a.id,username:a.username,role:a.role}))));
  app.get("/api/auth/user", (req: any,res) => {
    const actor = actors.find(a => a.id === req.user?.claims?.sub);
    res.status(actor ? 200 : 401).json(actor ? {id:actor.id,username:actor.username,firstName:"APK",lastName:"Fixture",role:actor.role} : {message:"Unauthorized"});
  });
  app.get("/api/settings/security", (_req,res) => res.json({turnstileEnabled:false,turnstileSiteKey:"",turnstileSecretKey:""}));
  app.get("/api/settings/contact-support", (_req,res) => res.json({}));
  app.get("/api/settings/mobile-config", (_req,res) => res.json({mobileUpdateUrl:null,iosUpdateSource:null,iosAppStoreId:null}));
  const server = createServer(app);
  // Use the REAL existing access-level/user management routes for permission grants,
  // not directly seeded raw permission keys in a test user.
  await registerRoutes(server, app);
  app.use(express.static(path.resolve("dist/public")));
  app.get(/.*/, (_req,res) => res.sendFile(path.resolve("dist/public/index.html")));
  await new Promise<void>(resolve => server.listen(0,"127.0.0.1",resolve));
  const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const request = (url: string, actor = admin.id, method = "GET", data?: unknown) => fetch(base+url, {
    method, headers: { "x-apk-fixture-actor": actor, ...(data === undefined ? {} : {"Content-Type":"application/json"}) },
    ...(data === undefined ? {} : {body:JSON.stringify(data)}),
  });
  const grant = async (actorId: string, permissions: string[]) => {
    const response = await request("/api/subroles",admin.id,"POST", {
      key:`apk_role_${randomUUID().slice(0,8)}`,label:"APK fixture delegated role",baseRole:"user",
    });
    assert.equal(response.status,201);
    const role = await response.json(); roleIds.push(role.id);
    const assigned = await request(`/api/users/${actorId}/subrole`,admin.id,"PATCH",{subroleId:role.id});
    assert.equal(assigned.status,200);
    const granted = await request(`/api/subroles/${role.id}/permissions`,admin.id,"PUT",{permissions});
    assert.equal(granted.status,200);
    return role.id;
  };
  const upload = async (actor: string, bytes: Buffer, version = "2.4.0") => {
    const init = await request("/api/mobile-releases/uploads/init",actor,"POST", {
      fileName:"meterflo-test.apk",totalSize:bytes.length,totalChunks:Math.ceil(bytes.length/APK_CHUNK_SIZE),
      metadata:{version,buildCode:240,notes:"Fixture release notes"},
    });
    assert.equal(init.status,201,await init.clone().text());
    const { uploadId } = await init.json();
    for (let i=0; i<Math.ceil(bytes.length/APK_CHUNK_SIZE); i++) {
      const form = new FormData();
      form.append("uploadId",uploadId); form.append("chunkIndex",String(i));
      form.append("chunk",new Blob([new Uint8Array(bytes.subarray(i*APK_CHUNK_SIZE,(i+1)*APK_CHUNK_SIZE))]),"chunk.part");
      const response = await fetch(base+"/api/mobile-releases/uploads/chunk", {
        method:"POST",headers:{"x-apk-fixture-actor":actor},body:form,
      });
      assert.equal(response.status,200,await response.clone().text());
    }
    return {uploadId, finalize: () => request("/api/mobile-releases/uploads/finalize",actor,"POST",{uploadId})};
  };
  return { app, repo, service, files, ref, base, request, grant, upload, admin,tech,other,customer, async close() {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    for (const actor of actors) await storage.deleteUser(actor.id);
    for (const id of roleIds) await storage.deleteSubrole(id);
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await fs.rm(root,{recursive:true,force:true});
  }};
}

async function checkReleaseBrowser(fixture: Awaited<ReturnType<typeof releaseFixture>>, fixtureFile: string, bytes: Buffer, delegatedRole: number) {
  const { chromium, expect } = await import("@playwright/test");
  let executablePath: string | undefined;
  if (process.platform === "linux") {
    try { await fs.access("/repl/tools/bin/chromium"); executablePath = "/repl/tools/bin/chromium"; } catch {}
  }
  const browser = await chromium.launch({executablePath,args:["--no-sandbox"]});
  const output = path.resolve("generated-artifacts/mobile-releases");
  await fs.mkdir(output,{recursive:true});
  try {
    const context = await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
    await context.addCookies([{name:"apk_fixture_actor",value:fixture.admin.id,url:fixture.base}]);
    const page = await context.newPage();
    await page.goto(fixture.base);
    const dashboardCard = page.getByTestId("card-latest-android-release");
    await expect(dashboardCard).toContainText("Version 2.4.0");
    const downloadEvent = page.waitForEvent("download");
    await dashboardCard.getByTestId("button-download-latest-apk").click();
    const download = await downloadEvent;
    assert.equal(download.suggestedFilename(),"meterflo-test.apk");
    const downloaded = path.join(output,"downloaded.apk");
    await download.saveAs(downloaded);
    assert.deepEqual(await fs.readFile(downloaded),bytes,"browser attachment bytes");
    await fs.rm(downloaded);
    await page.goto(fixture.base+"/settings");
    const manager = page.getByTestId("card-android-apk-releases");
    await expect(manager).toBeVisible();
    await expect(manager).toContainText("Local file storage");
    await expect(manager).toContainText("without a Replit account or bucket");
    await manager.getByTestId("input-apk-file").setInputFiles(fixtureFile);
    await page.locator("#apk-version").fill("2.6.0");
    await page.locator("#apk-build-code").fill("260");
    await page.locator("#apk-notes").fill("Browser-tested release");
    await manager.getByTestId("button-upload-apk").click();
    await expect(manager).toContainText("Version 2.6.0 uploaded.",{timeout:30000});
    const row = manager.locator("article").filter({hasText:"Version 2.6.0"});
    await expect(row).toContainText("Uploaded · unpublished");
    await row.getByRole("button",{name:"Set as latest"}).click();
    await expect(row).toContainText("Latest");
    await manager.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(output,"settings-desktop.jpg")});
    await row.getByRole("button",{name:"Delete",exact:true}).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Withdraw and delete this release?");
    await expect(dialog).toContainText("There is no automatic fallback");
    await dialog.getByRole("button",{name:/delete/i}).click();
    await expect(row).toHaveCount(0);
    await page.goto(fixture.base);
    await expect(dashboardCard).toContainText("No Android release is currently published");
    await expect(dashboardCard.getByTestId("button-download-latest-apk")).toHaveCount(0);
    const existing = (await fixture.repo.list()).releases[0];
    await fixture.service.publish(existing.id,async () => {});
    // Desktop and phone dashboards for every signed-in base role.
    for (const actor of [fixture.admin,fixture.tech,fixture.customer]) {
      const roleContext = await browser.newContext({viewport:{width:402,height:874},acceptDownloads:true});
      await roleContext.addCookies([{name:"apk_fixture_actor",value:actor.id,url:fixture.base}]);
      const rolePage = await roleContext.newPage();
      await rolePage.goto(fixture.base);
      const card = rolePage.getByTestId("card-latest-android-release");
      await expect(card).toContainText("Version 2.4.0");
      await expect(card.getByTestId("button-download-latest-apk")).toBeVisible();
      const dimensions = await card.evaluate(el => ({content:el.scrollWidth,width:el.clientWidth}));
      assert.ok(dimensions.content<=dimensions.width+1,`${actor.role} mobile card must not clip content`);
      await rolePage.screenshot({path:path.join(output,`dashboard-${actor.role}-phone.jpg`)});
      if (actor.id === fixture.tech.id) {
        await fixture.request(`/api/subroles/${delegatedRole}/permissions`,fixture.admin.id,"PUT",
          {permissions:["nav.dashboard","nav.settings"]});
        await rolePage.goto(fixture.base+"/settings");
        await expect(rolePage.getByTestId("card-android-apk-releases")).toHaveCount(0);
        await fixture.request(`/api/subroles/${delegatedRole}/permissions`,fixture.admin.id,"PUT",
          {permissions:["nav.dashboard","nav.settings","settings.mobileConfig"]});
        await rolePage.reload();
        const mobileManager = rolePage.getByTestId("card-android-apk-releases");
        await expect(mobileManager).toBeVisible();
        await mobileManager.scrollIntoViewIfNeeded();
        const box = await mobileManager.evaluate(el => ({content:el.scrollWidth,width:el.clientWidth}));
        assert.ok(box.content<=box.width+1,"mobile management card must not clip content");
        await rolePage.screenshot({path:path.join(output,"settings-delegated-phone.jpg")});
      }
      await roleContext.close();
    }
    // Transient metadata failure must not appear as "no published release".
    await page.route("**/api/mobile-releases/latest", route => route.fulfill({
      status:503,contentType:"application/json",body:JSON.stringify({message:"Fixture temporary storage failure"}),
    }));
    await page.goto(fixture.base);
    await expect(dashboardCard).toContainText("Fixture temporary storage failure",{timeout:30000});
    await expect(dashboardCard).not.toContainText("No Android release is currently published");
    await page.unroute("**/api/mobile-releases/latest");
    await dashboardCard.getByRole("button",{name:"Retry",exact:true}).click();
    await expect(dashboardCard).toContainText("Version 2.4.0");
    await context.close();
  } finally { await browser.close(); }
}

test("Android release workflow, real role grants, bounded ownership, persistence and recovery", async t => {
  const fixture = await releaseFixture();
  const { request, repo, service, files, admin,tech,other,customer } = fixture;
  try {
    const { file, bytes } = await validApkFixture();
    assert.equal(apkStorageProvider({}),"local","standalone has no Replit dependency");
    assert.equal(apkStorageProvider({REPLIT_DEPLOYMENT:"1"}),"app_storage","deployment without REPL_ID still selects durable App Storage");
    assert.deepEqual(await configuredApkStorage({MOBILE_APK_LOCAL_DIR:fixture.ref.location}),fixture.ref);
    await assert.rejects(configuredApkStorage({REPLIT_DEPLOYMENT:"1",MOBILE_APK_STORAGE:"local",MOBILE_APK_LOCAL_DIR:fixture.ref.location}));
    for (const folder of ["dist/apks","public/apks","client/public/apks","server/public/apks","node_modules/apks","generated-artifacts/apks"]) {
      assert.throws(() => assertPrivateApkDirectory(path.resolve(folder)));
    }
    assert.doesNotThrow(() => assertPrivateApkDirectory(fixture.ref.location));
    assert.ok(bytes.length > APK_CHUNK_SIZE,"real large-file chunk path");
    assert.equal((await request("/api/mobile-releases/latest","")).status,401);
    assert.equal((await request("/api/mobile-releases",tech.id)).status,403);
    assert.deepEqual(await (await request("/api/mobile-releases/latest",tech.id)).json(),{release:null});
    const permissions = await (await request("/api/permissions")).json();
    assert.ok(permissions.some((p:any) => p.key === "settings.mobileConfig"));
    const nativeConfig = await (await request(`/api/users/${admin.id}/projects`)).json();
    assert.deepEqual(Object.keys(nativeConfig.mobileConfig).sort(),["appStoreId","iosUpdateSource","updateUrl"]);
    const role = await fixture.grant(tech.id,["nav.settings","nav.dashboard","settings.mobileConfig"]);
    const effective = await (await request(`/api/users/${tech.id}/permissions`,tech.id)).json();
    assert.ok(effective.includes("settings.mobileConfig"));
    assert.equal((await request("/api/mobile-releases",tech.id)).status,200);
    const firstUpload = await fixture.upload(tech.id,bytes);
    await fixture.grant(other.id,["settings.mobileConfig"]);
    assert.equal((await request("/api/mobile-releases/uploads/finalize",other.id,"POST",{uploadId:firstUpload.uploadId})).status,403);
    assert.equal((await request(`/api/mobile-releases/uploads/${firstUpload.uploadId}`,other.id,"DELETE")).status,403);
    const wrongOwnerChunk = new FormData();
    wrongOwnerChunk.append("uploadId",firstUpload.uploadId); wrongOwnerChunk.append("chunkIndex","0");
    wrongOwnerChunk.append("chunk",new Blob(["wrong owner's data"]),"part");
    assert.equal((await fetch(fixture.base+"/api/mobile-releases/uploads/chunk",{
      method:"POST",headers:{"x-apk-fixture-actor":other.id},body:wrongOwnerChunk,
    })).status,403);
    const firstResponse = await firstUpload.finalize();
    assert.equal(firstResponse.status,201,await firstResponse.clone().text());
    const first = await firstResponse.json();
    assert.equal(first.size,bytes.length);
    assert.equal(first.sha256,createHash("sha256").update(bytes).digest("hex"));
    assert.equal(first.ref,undefined,"internal storage locations must never appear in DTOs");
    assert.equal((await repo.latest()),null,"upload does not publish");
    assert.equal((await request(`/api/mobile-releases/${first.id}/publish`,customer.id,"POST")).status,403);
    assert.equal((await request(`/api/mobile-releases/${first.id}/publish`,tech.id,"POST")).status,200);
    for (const actor of [admin,tech,customer]) {
      const latest = await (await request("/api/mobile-releases/latest",actor.id)).json();
      assert.equal(latest.release.id,first.id);
      const response = await request(`/api/mobile-releases/${first.id}/download`,actor.id);
      assert.equal(response.headers.get("content-type"),"application/vnd.android.package-archive");
      assert.equal(response.headers.get("content-disposition"),'attachment; filename="meterflo-test.apk"');
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
    }
    const restarted = new MobileReleaseRepository(pool,repo.schema);
    await restarted.initialize();
    assert.equal((await restarted.latest())?.id,first.id);
    const reloadedService = new MobileReleaseService(restarted,files,async () => fixture.ref);
    assert.equal((await reloadedService.downloadable(first.id,false)).sha256,first.sha256);
    const secondUpload = await fixture.upload(admin.id,bytes,"2.5.0");
    const second = await (await secondUpload.finalize()).json();
    await Promise.all([first.id,second.id].map(id => service.publish(id,async () => {})));
    assert.ok([first.id,second.id].includes((await repo.latest())!.id),"one consistent publication");
    await Promise.all(Array.from({length:20},(_,i) => service.publish(i%2 ? first.id : second.id,async () => {
      assert.ok(await storage.getUser(admin.id));
    })));
    await service.publish(second.id,async () => {});
    assert.equal((await request(`/api/mobile-releases/${first.id}/download`,customer.id)).status,410);
    assert.equal((await request(`/api/mobile-releases/${second.id}`,admin.id,"DELETE")).status,409);
    assert.equal((await repo.latest())?.id,second.id);
    // Failed physical cleanup must withdraw atomically and persist a retryable tombstone.
    const remove = files.remove;
    files.remove = async () => { throw new Error("fixture storage denial"); };
    const removed = await (await request(`/api/mobile-releases/${second.id}`,admin.id,"DELETE",{withdrawLatest:true})).json();
    assert.equal(removed.pendingCleanup,1);
    assert.equal(await repo.latest(),null);
    assert.equal((await request(`/api/mobile-releases/${second.id}/download`,customer.id)).status,404);
    files.remove = remove;
    assert.equal((await (await request("/api/mobile-releases/cleanup",admin.id,"POST")).json()).pendingCleanup,0);
    assert.equal(await repo.get(second.id),null);
    // Invalid APK bytes and metadata cannot replace the existing good release.
    await service.publish(first.id,async () => {});
    const malformed = await fixture.upload(admin.id,Buffer.from("not an APK"),"bad");
    assert.equal((await malformed.finalize()).status,400);
    assert.equal((await repo.latest())?.id,first.id);
    for (const patch of [{fileName:"../x.apk"},{totalSize:0},{totalSize:536870913},{metadata:{version:"",buildCode:1}},
      {metadata:{version:"ok",buildCode:-1}},{metadata:{version:"ok",notes:"null\u0000character"}},{totalChunks:10000}]) {
      const response = await request("/api/mobile-releases/uploads/init",admin.id,"POST",{
        fileName:"test.apk",totalSize:1,totalChunks:1,metadata:{version:"ok"},...patch,
      });
      assert.equal(response.status,400);
    }
    const corrupt = Buffer.from(bytes); corrupt[200] ^= 0xff;
    const corrupted = await fixture.upload(admin.id,corrupt);
    assert.equal((await corrupted.finalize()).status,400);
    const renamedZip = path.join(fixture.ref.location,"renamed-zip.apk");
    const archiver = (await import("archiver")).default;
    await new Promise<void>((resolve,reject) => {
      const out = createWriteStream(renamedZip);
      const archive = archiver("zip");
      out.on("close",resolve).on("error",reject); archive.on("error",reject);
      archive.pipe(out); archive.append("just an ordinary ZIP file",{name:"readme.txt"});
      void archive.finalize();
    });
    const zipUpload = await fixture.upload(admin.id,await fs.readFile(renamedZip));
    assert.equal((await zipUpload.finalize()).status,400,"renamed valid ZIP is not an APK");
    const truncated = await fixture.upload(admin.id,bytes.subarray(0,bytes.length-100));
    assert.equal((await truncated.finalize()).status,400);
    // Permission revoked after initialization: chunks/finalize must be denied too.
    const revoked = await fixture.upload(tech.id,bytes);
    await request(`/api/subroles/${role}/permissions`,admin.id,"PUT",{permissions:["nav.dashboard"]});
    assert.equal((await revoked.finalize()).status,403);
    assert.equal((await fetch(fixture.base+"/api/mobile-releases/uploads/chunk",{
      method:"POST",headers:{"x-apk-fixture-actor":tech.id},body:new FormData(),
    })).status,403,"revocation is checked before multipart data is accepted");
    await pool.query(`UPDATE ${repo.table("uploads")} SET expires_at=now()-interval '1 minute' WHERE id=$1`,[revoked.uploadId]);
    await service.cleanup();
    assert.equal((await pool.query(`SELECT * FROM ${repo.table("uploads")} WHERE id=$1`,[revoked.uploadId])).rowCount,0);
    const incomplete = await service.init(admin.id,{fileName:"incomplete.apk",totalSize:10,totalChunks:1,metadata:{version:"incomplete"}});
    assert.equal((await request("/api/mobile-releases/uploads/finalize",admin.id,"POST",incomplete)).status,400);
    const expired = await service.init(admin.id,{fileName:"expired.apk",totalSize:1,totalChunks:1,metadata:{version:"expired"}});
    await pool.query(`UPDATE ${repo.table("uploads")} SET expires_at=now()-interval '1 minute' WHERE id=$1`,[expired.uploadId]);
    assert.equal((await request("/api/mobile-releases/uploads/finalize",admin.id,"POST",expired)).status,410);
    const cancelled = await fixture.upload(admin.id,bytes);
    assert.equal((await request(`/api/mobile-releases/uploads/${cancelled.uploadId}`,admin.id,"DELETE")).status,204);
    assert.equal(await files.exists(fixture.ref,`uploads/${cancelled.uploadId}/0.part`),false);
    const pendingUpload = await fixture.upload(admin.id,bytes);
    files.remove = async () => { throw new Error("fixture cleanup permission denial"); };
    assert.equal((await request(`/api/mobile-releases/uploads/${pendingUpload.uploadId}`,admin.id,"DELETE")).status,503);
    assert.equal((await repo.list()).pendingUploadCleanup,1,"failed cancellation remains visible and retryable");
    files.remove = remove;
    assert.equal((await (await request("/api/mobile-releases/cleanup",admin.id,"POST")).json()).pendingCleanup,0);
    const put = files.put;
    files.put = async () => { throw new Error("fixture storage full"); };
    const failedInit = await request("/api/mobile-releases/uploads/init",admin.id,"POST", {
      fileName:"full.apk",totalSize:1,totalChunks:1,metadata:{version:"full"},
    });
    const {uploadId} = await failedInit.json();
    await assert.rejects(service.chunk(uploadId,admin.id,0,Buffer.from("a")));
    files.put = put;
    await service.cancel(uploadId,admin.id);
    assert.equal((await repo.latest())?.id,first.id);
    const exists = files.exists;
    files.exists = async () => { throw new Error("fixture unavailable provider"); };
    assert.equal((await request(`/api/mobile-releases/${first.id}/publish`,admin.id,"POST")).status,503);
    assert.equal((await repo.latest())?.id,first.id);
    files.exists = exists;
    if (process.argv.includes("--browser")) {
      await checkReleaseBrowser(fixture,file,bytes,role);
      t.diagnostic("Production-built browser UI verified: admin upload/publish/withdraw, streamed attachment, empty/error/retry, role gating, and phone dashboards.");
    }
    t.diagnostic("Verified actual role-management grants, two-chunk valid APK, byte equality, corrupt packages, withdrawal cleanup, and recreated repository/service persistence.");
  } finally { await fixture.close(); await pool.end(); }
});
