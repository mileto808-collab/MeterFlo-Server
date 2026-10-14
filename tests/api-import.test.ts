import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pool } from "../server/db";
import { initializeAudit } from "../server/auditMigration";
import { storage } from "../server/storage";
import { createProjectSchema } from "../server/projectDb";
import { apiImportConfigSchema } from "../shared/customer-api-import";
import { mapImportRecord, firstImportUrl, trustedImportUrl } from "../server/apiImportFetch";
import {
  initializeApiImports, saveApiImportConfig, previewApiImport, enqueueApiImport,
  runApiImportWorker, listApiImportRuns, deleteApiImportConfig, capturedWorkOrder, scheduleDueApiImports,
} from "../server/apiImportService";
import { registerApiImportRoutes } from "../server/apiImportRoutes";
import { getProjectFilesPath, getProjectDirectoryName } from "../server/fileStorage";
import { getPermissionByKey } from "../shared/permissionRegistry";

const mapping = { id: "customerWoId", customer: "customerId", name: "customerName", address: "address", service: "serviceType", reading: "oldSystemReading" } as const;
test("customer API pull importer: durable runs, safe merges, pagination, and access controls", async t => {
  await initializeApiImports();
  await initializeAudit(pool);
  const suffix = randomUUID().slice(0, 8);
  const { rows: [project] } = await pool.query(`INSERT INTO public.projects(name,customer_api_enabled) VALUES($1,true) RETURNING *`, [`API pull test ${suffix}`]);
  const { rows: [otherProject] } = await pool.query(`INSERT INTO public.projects(name) VALUES($1) RETURNING *`, [`Other API test ${suffix}`]);
  const schema = await createProjectSchema(project.name, project.id);
  const filesRoot = path.join(await getProjectFilesPath(), getProjectDirectoryName(project.name, project.id));
  await pool.query(`UPDATE public.projects SET database_name=$2 WHERE id=$1`, [project.id, schema]);
  const service = (await storage.getServiceTypes())[0].code;
  const record = (id: string, reading = "12345678901234567890.000100") => ({ id, customer: "C1", name: "Fixture Customer", address: "123 Test Street", service, reading });
  let sourceRecords: any[] = [record("0001"), record("0002")];
  let mode = "normal", hitCount = 0, delay = 0, observedAuth: string | undefined;
  const source = createServer(async (req, res) => {
    hitCount++;
    observedAuth = (req.headers.authorization || req.headers["x-fixture-key"]) as string | undefined;
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    res.setHeader("Content-Type", "application/json");
    if (mode === "503" || mode === "401") { res.writeHead(Number(mode), { "Retry-After": "180" }); return res.end('{"secret":"not logged"}'); }
    if (mode === "invalid") return res.end('{"wrong":"shape"}');
    const url = new URL(req.url!, "http://fixture.invalid");
    const limit = Number(url.searchParams.get("limit") || 1000), page = Number(url.searchParams.get("page") || 1);
    const cursor = Number(url.searchParams.get("cursor") || 0);
    const data = mode === "cursor" ? sourceRecords.slice(cursor, cursor + 1) : sourceRecords.slice((page - 1) * limit, page * limit);
    res.end(JSON.stringify({ data, next: mode === "loop" ? new URL(req.url!, endpoint).toString() : mode === "cursor" && cursor + 1 < sourceRecords.length ? String(cursor + 1) : null }));
  });
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${(source.address() as any).port}/orders`;
  const settings = apiImportConfigSchema.parse({ name: "Customer REST feed", endpoint, recordsPath: "data", fieldMapping: mapping });
  const configs: number[] = [];
  const makeConfig = async (overrides: any = {}) => { const config = await saveApiImportConfig(project.id, { ...settings, ...overrides }); configs.push(config.id); return config; };
  const drain = async (id: string) => {
    for (let i = 0; i < 12; i++) {
      await runApiImportWorker(project.id);
      const run = (await listApiImportRuns(project.id, 100)).find(run => run.id === id)!;
      if (!["queued", "running"].includes(run.status)) return run;
    }
    throw new Error("Import did not finish");
  };
  const runConfig = async (id: number) => drain((await enqueueApiImport(project.id, id, "test")).id);
  let adminId: string | undefined, viewerId: string | undefined, subroleId: number | undefined;
  let apiServer: ReturnType<typeof createServer> | undefined;
  try {
    await t.test("strict configuration and exact decimal mapping", () => {
      const permission = getPermissionByKey("project.apiImport");
      assert.equal(permission?.label, "Customer API Import");
      assert.deepEqual(permission?.defaultAccess, { administrator: true, projectManager: false, fieldTechnician: false, viewer: false, customer: false });
      assert.throws(() => apiImportConfigSchema.parse({ ...settings, endpoint: "https://user:password@example.invalid" }));
      assert.throws(() => apiImportConfigSchema.parse({ ...settings, endpoint: "https://example.invalid?api_key=x" }));
      assert.throws(() => apiImportConfigSchema.parse({ ...settings, queryParams: { token: "fixture_invalid_token" } }));
      assert.throws(() => apiImportConfigSchema.parse({ ...settings, fieldMapping: { id: "customerWoId" } }));
      assert.throws(() => apiImportConfigSchema.parse({ ...settings, authType: "api_key", secretEnvVar: "MISSING_TEST", keyHeader: "Host" }));
      const rules = { services: [service], statuses: ["Open"], systems: [], modules: [], openStatus: "Open" };
      const mapped = mapImportRecord(record("0007"), settings, rules);
      assert.deepEqual(mapped.errors, []);
      assert.equal(mapped.mapped.customerWoId, "0007");
      assert.equal(mapped.mapped.oldSystemReading, "12345678901234567890.000100");
      assert.ok(mapImportRecord({ ...record("x"), id: 9007199254740992 }, settings, rules).errors.length);
      assert.ok(mapImportRecord({ ...record("x"), service: "Unknown" }, settings, rules).errors.length);
      assert.throws(() => trustedImportUrl("https://untrusted.example/orders", settings));
      assert.match(firstImportUrl({ ...settings, watermarkParam: "since" }, { watermark: "2026-01-01" }), /since=2026-01-01/);
    });
    await t.test("previews never write work orders and surface validation errors", async () => {
      const preview = await previewApiImport(project.id, settings);
      assert.equal(preview.records.length, 2);
      assert.ok(preview.records.every(record => record.valid));
      const { rows: [count] } = await pool.query(`SELECT count(*) FROM "${schema}".work_orders`);
      assert.equal(count.count, "0");
      mode = "invalid";
      await assert.rejects(previewApiImport(project.id, settings), /JSON array/);
      mode = "normal";
    });
    const paginated = await makeConfig({ pagination: "page", pageSize: 1 });
    await t.test("imports every page, retains decimals/leading zeros, and deduplicates", async () => {
      const run = await runConfig(paginated.id);
      assert.equal(run.status, "succeeded");
      assert.equal(run.created, 2);
      assert.equal(run.pages, 3);
      const { rows } = await pool.query(`SELECT * FROM "${schema}".work_orders ORDER BY customer_wo_id`);
      assert.equal(rows[0].customer_wo_id, "0001");
      assert.equal(rows[0].old_system_reading, "12345678901234567890.000100");
      const repeated = await runConfig(paginated.id);
      assert.equal(repeated.created, 0); assert.equal(repeated.skipped, 2);
      const delivery = await pool.query(`SELECT count(*) FROM public.customer_api_deliveries WHERE project_id=$1`, [project.id]);
      assert.equal(delivery.rows[0].count, "0");
    });
    await t.test("opt-in baseline updates are repeatable but outside edits remain protected", async () => {
      await saveApiImportConfig(project.id, { updateMode: "safe_update", updateFields: ["address", "oldSystemReading"] }, paginated.id);
      sourceRecords = [record("0001", "0.005")]; sourceRecords[0].address = "456 Changed Street";
      let run = await runConfig(paginated.id);
      assert.equal(run.updated, 1);
      sourceRecords[0].address = "789 New Baseline";
      run = await runConfig(paginated.id); assert.equal(run.updated, 1);
      await pool.query(`UPDATE "${schema}".work_orders SET old_system_reading=55.99,updated_at=now() WHERE customer_wo_id='0001'`);
      sourceRecords[0].address = "Must not overwrite";
      run = await runConfig(paginated.id); assert.equal(run.skipped, 1);
      const { rows: [wo] } = await pool.query(`SELECT * FROM "${schema}".work_orders WHERE customer_wo_id='0001'`);
      assert.equal(wo.address, "789 New Baseline"); assert.equal(wo.old_system_reading, "55.99");
    });
    await t.test("capture guard includes completion, notes/reset history, assignment, new GPS, signature, and zero readings", () => {
      for (const patch of [{ status: "Completed" }, { notes: "[Previous captured data]" }, { new_gps: "1,2" }, { assigned_user_id: "tech" }, { new_system_reading: "0" }, { signature_data: "captured" }, { attachments: ["photo.jpg"] }]) {
        assert.equal(capturedWorkOrder({ status: "Open", ...patch }, "Open"), true);
      }
      assert.equal(capturedWorkOrder({ status: "Open", old_system_reading: "0.001" }, "Open"), false);
    });
    await t.test("real time-tracking and photo files protect otherwise untouched API-created rows", async () => {
      sourceRecords = [record("protected-time"), record("protected-photo")];
      const config = await makeConfig();
      assert.equal((await runConfig(config.id)).created, 2);
      const { rows: [timed] } = await pool.query(`SELECT id FROM "${schema}".work_orders WHERE customer_wo_id='protected-time'`);
      await pool.query(`INSERT INTO public.work_order_time_tracking(project_id,system_work_order_id,start_time,end_time)
        VALUES($1,$2,now(),now())`, [project.id, String(timed.id)]);
      await fs.mkdir(path.join(filesRoot, "Work Orders", "protected-photo"), { recursive: true });
      await fs.writeFile(path.join(filesRoot, "Work Orders", "protected-photo", "test-photo.txt"), "Test-only captured-file marker");
      await saveApiImportConfig(project.id, { updateMode: "safe_update", updateFields: ["address"] }, config.id);
      sourceRecords.forEach(record => { record.address = "Do not overwrite"; });
      const run = await runConfig(config.id); assert.equal(run.skipped, 2); assert.equal(run.updated, 0);
      assert.ok(run.messages.every(message => /field work, notes, assignment, files, scheduling, timing/.test(message.message)));
    });
    await t.test("partial validation failures do not advance incremental watermarks; retry uses original checkpoint", async () => {
      sourceRecords = [record("partial-good"), { ...record("bad"), id: null }];
      const config = await makeConfig({ watermarkParam: "updated_since" });
      const run = await runConfig(config.id);
      assert.equal(run.status, "partial"); assert.equal(run.created, 1); assert.equal(run.failed, 1);
      assert.match(run.messages.find(message => message.action === "failed")!.message, /customerWoId/);
      const row = await pool.query(`SELECT watermark FROM public.api_import_configs WHERE id=$1`, [config.id]);
      assert.equal(row.rows[0].watermark, null);
      sourceRecords[1].id = "partial-fixed";
      const retry = await drain((await enqueueApiImport(project.id, config.id, "test-retry", run.id)).id);
      assert.equal(retry.status, "succeeded"); assert.equal(retry.created, 1); assert.equal(retry.skipped, 1);
      assert.ok((await pool.query(`SELECT watermark FROM public.api_import_configs WHERE id=$1`, [config.id])).rows[0].watermark);
    });
    await t.test("transient HTTP errors retry persistently and respect Retry-After", async () => {
      mode = "503"; const config = await makeConfig();
      const run = await runConfig(config.id);
      assert.equal(run.status, "retrying");
      assert.ok(new Date(run.nextAttemptAt!).getTime() > Date.now() + 170000);
      const hits = hitCount;
      await runApiImportWorker(project.id); assert.equal(hitCount, hits);
      for (let i = 0; i < 3; i++) {
        await pool.query(`UPDATE public.api_import_runs SET next_attempt_at=now() WHERE id=$1`, [run.id]);
        await runApiImportWorker(project.id);
      }
      assert.equal((await listApiImportRuns(project.id, 100)).find(row => row.id === run.id)!.status, "failed");
      mode = "normal"; sourceRecords = [record("retry-good")];
      assert.equal((await drain((await enqueueApiImport(project.id, config.id, "manual-retry", run.id)).id)).status, "succeeded");
    });
    await t.test("auth failures do not retry and missing credentials never send anonymous requests", async () => {
      mode = "401"; const config = await makeConfig();
      assert.equal((await runConfig(config.id)).status, "failed");
      mode = "normal"; const authConfig = await makeConfig({ authType: "bearer_token", secretEnvVar: `TEST_MISSING_${suffix.toUpperCase()}` });
      const hits = hitCount;
      assert.equal((await runConfig(authConfig.id)).status, "failed"); assert.equal(hitCount, hits);
    });
    await t.test("configured API key, bearer, and Basic credentials are sent only through headers and redacted in preview", async () => {
      const secretEnvVar = `TEST_API_IMPORT_${suffix.toUpperCase()}`;
      const secret = "fixture-user:fixture-password";
      process.env[secretEnvVar] = secret;
      try {
        sourceRecords = [record("auth-fixture")]; sourceRecords[0].name = secret;
        for (const authType of ["api_key", "bearer_token", "basic_auth"] as const) {
          const preview = await previewApiImport(project.id, { ...settings, authType, secretEnvVar, keyHeader: "X-Fixture-Key" });
          const expected = authType === "api_key" ? secret : authType === "bearer_token" ? `Bearer ${secret}` : `Basic ${Buffer.from(secret).toString("base64")}`;
          assert.equal(observedAuth, expected);
          assert.equal(preview.records[0].mapped.customerName, "[redacted]");
          assert.ok(!JSON.stringify(preview).includes("fixture-password"));
        }
      } finally { delete process.env[secretEnvVar]; }
    });
    await t.test("pagination loops fail before committing records", async () => {
      mode = "loop"; sourceRecords = [record("loop-record")];
      const config = await makeConfig({ pagination: "next_url", nextPath: "next" });
      const run = await runConfig(config.id);
      assert.equal(run.status, "failed"); assert.equal(run.created, 0);
      assert.match(run.messages.at(-1)!.message, /loop/);
      mode = "normal";
    });
    await t.test("saved cursors advance only on successful runs and safely replay the final page", async () => {
      mode = "cursor"; sourceRecords = [record("cursor-1"), record("cursor-2")];
      const config = await makeConfig({ pagination: "cursor", pageSize: 1, nextPath: "next", resumeCursor: true });
      const run = await runConfig(config.id); assert.equal(run.created, 2); assert.equal(run.pages, 2);
      assert.equal((await pool.query(`SELECT cursor FROM public.api_import_configs WHERE id=$1`, [config.id])).rows[0].cursor, "1");
      const repeated = await runConfig(config.id); assert.equal(repeated.created, 0); assert.equal(repeated.skipped, 1);
      mode = "normal";
    });
    await t.test("interrupted runs recover visibly and reject overlapping queues", async () => {
      const config = await makeConfig();
      const queued = await enqueueApiImport(project.id, config.id, "test");
      await assert.rejects(enqueueApiImport(project.id, config.id, "overlap"), /already queued/);
      await pool.query(`UPDATE public.api_import_runs SET status='running',heartbeat_at=now()-interval '3 minutes' WHERE id=$1`, [queued.id]);
      await runApiImportWorker(project.id);
      assert.equal((await listApiImportRuns(project.id, 100)).find(row => row.id === queued.id)!.status, "interrupted");
      const retry = await enqueueApiImport(project.id, config.id, "retry", queued.id);
      assert.equal((await drain(retry.id)).status, "succeeded");
    });
    await t.test("simultaneous workers cannot fetch/write one page twice", async () => {
      sourceRecords = [record("concurrent-record")]; delay = 80;
      const config = await makeConfig(); const queued = await enqueueApiImport(project.id, config.id, "test");
      const before = hitCount;
      await Promise.all([runApiImportWorker(project.id), runApiImportWorker(project.id)]);
      const run = await drain(queued.id);
      assert.equal(run.created, 1); assert.equal(hitCount - before, 1);
      delay = 0;
    });
    await t.test("disabled/inactive sources stop imports; opt-in schedules persist and do not overlap", async () => {
      const config = await makeConfig({ intervalMinutes: 15 });
      await pool.query(`UPDATE public.api_import_configs SET next_run_at=now() WHERE id=$1`, [config.id]);
      await scheduleDueApiImports();
      await assert.rejects(enqueueApiImport(project.id, config.id, "overlap"), /already queued/);
      await saveApiImportConfig(project.id, { isEnabled: false }, config.id);
      await assert.rejects(enqueueApiImport(project.id, config.id, "test"), /Enable/);
      assert.equal((await listApiImportRuns(project.id, 100)).find(row => row.configId === config.id)!.status, "cancelled");
      await saveApiImportConfig(project.id, { isEnabled: true }, config.id);
      await pool.query(`UPDATE public.projects SET is_active=false WHERE id=$1`, [project.id]);
      await assert.rejects(enqueueApiImport(project.id, config.id, "test"), /activate/);
      await pool.query(`UPDATE public.projects SET is_active=true WHERE id=$1`, [project.id]);
    });
    await t.test("all endpoint permission/project checks and administrator-only unsaved previews", async () => {
      const admin = await storage.createLocalUser(`api-test-admin-${suffix}`, "unused-test-hash", "admin");
      adminId = admin.id;
      const subrole = await storage.createSubrole({ key: `api-test-${suffix}`, label: "API test viewer", baseRole: "user" });
      subroleId = subrole.id;
      await storage.setSubrolePermissions(subrole.id, ["project.apiImport"]);
      const viewer = await storage.createLocalUser(`api-test-viewer-${suffix}`, "unused-test-hash", "user", undefined, undefined, null, subrole.id);
      viewerId = viewer.id;
      await storage.assignUserToProject(viewer.id, project.id);
      const app = express(); app.use(express.json());
      // Test-only auth seam on an isolated ephemeral HTTP server, never on the running app.
      app.use((req, _res, next) => { const actor = req.headers["x-test-user"]; (req as any).user = actor ? { claims: { sub: actor }, expires_at: Math.floor(Date.now() / 1000) + 60 } : null; (req as any).isAuthenticated = () => !!actor; next(); });
      registerApiImportRoutes(app);
      apiServer = createServer(app); await new Promise<void>(resolve => apiServer!.listen(0, "127.0.0.1", resolve));
      const base = `http://127.0.0.1:${(apiServer.address() as any).port}/api/projects/${project.id}/api-import`;
      const request = (path: string, user?: string, method = "GET", body?: any) => fetch(`${base}${path}`, { method, headers: { ...(user ? { "x-test-user": user } : {}), "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      assert.equal((await request("/configs")).status, 401);
      assert.equal((await request("/configs", viewer.id)).status, 200);
      assert.equal((await request("/configs", viewer.id, "POST", settings)).status, 403);
      assert.equal((await request("/preview", viewer.id, "POST", settings)).status, 403);
      assert.equal((await request(`/configs/${paginated.id}`, viewer.id, "PATCH", { isEnabled: false })).status, 403);
      assert.equal((await request(`/configs/${paginated.id}`, viewer.id, "DELETE")).status, 403);
      assert.equal((await request(`/configs/${paginated.id}/preview`, viewer.id, "POST")).status, 200);
      const queued = await request(`/configs/${paginated.id}/run`, viewer.id, "POST");
      assert.equal(queued.status, 202);
      const queuedRun = await queued.json(); await drain(queuedRun.id);
      assert.equal((await request(`/runs/${queuedRun.id}/retry`, viewer.id, "POST")).status, 403);
      const adminCreate = await request("/configs", admin.id, "POST", settings); assert.equal(adminCreate.status, 201);
      const adminConfig = await adminCreate.json();
      assert.equal((await request(`/configs/${adminConfig.id}`, admin.id, "PATCH", { isEnabled: false })).status, 200);
      assert.equal((await request(`/configs/${adminConfig.id}`, admin.id, "DELETE")).status, 204);
      const wrong = await fetch(base.replace(`/projects/${project.id}/`, `/projects/${otherProject.id}/`) + "/configs", { headers: { "x-test-user": viewer.id } });
      assert.equal(wrong.status, 403);
      const crossId = await request(`/configs/${paginated.id + 100000}`, admin.id, "PATCH", { isEnabled: false });
      assert.equal(crossId.status, 404);
      await storage.setSubrolePermissions(subrole.id, []);
      assert.equal((await request("/runs", viewer.id)).status, 403);
    });
    await t.test("removing configuration retains work orders and historical runs", async () => {
      await deleteApiImportConfig(project.id, paginated.id);
      assert.ok((await listApiImportRuns(project.id, 100)).some(run => run.configId === null && run.configName === settings.name));
      assert.ok(Number((await pool.query(`SELECT count(*) FROM "${schema}".work_orders`)).rows[0].count) > 0);
    });
    await t.test("customer API imports retain committed record batches and safe service attribution",async()=>{
      const {rows}=await pool.query(`SELECT actor_kind,source,operation_id,changes FROM meterflo_audit.events
        WHERE project_id=$1 AND entity_type='work_orders' AND source='customerApiImport'`,[project.id]);
      assert.ok(rows.length>0);
      assert.ok(rows.every(r=>r.actor_kind==="service"&&r.operation_id.startsWith("api_import_runs:")));
      const lifecycle=await pool.query("SELECT action,outcome FROM meterflo_audit.events WHERE project_id=$1 AND entity_type='api_import_runs'",[project.id]);
      assert.ok(lifecycle.rows.some(r=>r.action==="import.started"));
      assert.ok(lifecycle.rows.some(r=>r.action==="import.finished"&&["succeeded","partial","failed","interrupted"].includes(r.outcome)));
    });
  } finally {
    await new Promise<void>(resolve => source.close(() => resolve()));
    if (apiServer) await new Promise<void>(resolve => apiServer!.close(() => resolve()));
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await fs.rm(filesRoot, { recursive: true, force: true });
    await pool.query(`DELETE FROM public.projects WHERE id=ANY($1::int[])`, [[project.id, otherProject.id]]);
    const auditCleanup=await pool.connect();
    try{
      await auditCleanup.query("BEGIN");await auditCleanup.query("SELECT set_config('meterflo.audit_retention','authorized',true)");
      await auditCleanup.query("DELETE FROM meterflo_audit.events WHERE project_id=ANY($1::int[]) OR actor_id=ANY($2::text[])",[[project.id,otherProject.id],[adminId,viewerId].filter(Boolean)]);
      await auditCleanup.query("COMMIT");
    } finally {auditCleanup.release();}
    if (adminId || viewerId) await pool.query(`DELETE FROM public.users WHERE id=ANY($1::text[])`, [[adminId, viewerId].filter(Boolean)]);
    if (subroleId) await pool.query(`DELETE FROM public.subroles WHERE id=$1`, [subroleId]);
    await pool.end();
  }
});
