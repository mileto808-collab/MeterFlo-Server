import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildCustomerPayload, customerAuthHeaders, readDeliveryPhotos, retryDelay } from "../server/customerApiPayload";
import { initializeCustomerApi, enqueueCustomerDelivery, runCustomerApiWorker, retryCustomerDelivery, retryLegacyCustomerLog } from "../server/customerApiService";
import { pool } from "../server/db";
import { createProjectSchema, getProjectWorkOrderStorage } from "../server/projectDb";
import { storage } from "../server/storage";

test("payload retains the existing contract and includes canonical captured/customer fields", () => {
  const payload = buildCustomerPayload({
    id: 7, customer_wo_id: "CUSTOMER-7", status: "Completed", customer_id: "C1", customer_name: "Test customer",
    old_system_id: "old", new_system_id: "new", old_system_reading: "000.010", new_system_reading: "0.001",
    old_module_read: "123456789.0001", new_module_read: "0.005", new_module_type: "module",
    old_system_type: "old-type", new_system_type: "new-type", old_gps: "1, 2", new_gps: "3, 4",
    signature_name: "Test signer", phone: "test-phone", email: "test@example.invalid", route: "R1", zone: "Z1",
  }, { id: 1, name: "Test project" }, "delivery-id");
  assert.equal(payload.customerId, "C1");
  assert.equal(payload.oldMeterReading, "000.010");
  assert.equal(payload.oldModuleReading, "123456789.0001");
  assert.equal(payload.newModuleReading, "0.005");
  assert.equal(payload.oldSystemType, "old-type");
  assert.equal(payload.newSystemType, "new-type");
  assert.equal(payload.meterType, "new-type");
  assert.equal(payload.latitude, "3");
  assert.equal(payload.longitude, "4");
  assert.equal(payload.oldGps, "1, 2");
  assert.equal(payload.signatureName, "Test signer");
  assert.equal(payload.gpsAccuracy, null);
  const fallback = buildCustomerPayload({ id: 1, status: "Trouble", oldGps: "1,2" }, { id: 1, name: "P" }, "D");
  assert.equal(fallback.latitude, "1");
  assert.equal(fallback.completedAt, null);
});

test("auth modes are explicit and missing credentials never result in unauthenticated delivery", () => {
  const fixtureSecrets = { TEST_ONLY: "fixture-user:fixture-password" };
  const config = { customer_api_secret_env_var: "TEST_ONLY" };
  assert.deepEqual(customerAuthHeaders({ customer_api_auth_type: "none" }, {}), { "Content-Type": "application/json" });
  assert.equal(customerAuthHeaders({ ...config, customer_api_auth_type: "api_key" }, fixtureSecrets)["X-API-Key"], fixtureSecrets.TEST_ONLY);
  assert.equal(customerAuthHeaders({ ...config, customer_api_auth_type: "bearer_token" }, fixtureSecrets).Authorization, `Bearer ${fixtureSecrets.TEST_ONLY}`);
  assert.equal(customerAuthHeaders({ ...config, customer_api_auth_type: "basic_auth" }, fixtureSecrets).Authorization, `Basic ${Buffer.from(fixtureSecrets.TEST_ONLY).toString("base64")}`);
  assert.throws(() => customerAuthHeaders({ customer_api_auth_type: "bearer_token" }, {}), /not configured/);
  assert.throws(() => customerAuthHeaders({ ...config, customer_api_auth_type: "api_key", customer_api_key_header: "Idempotency-Key" }, fixtureSecrets), /reserved/);
});

test("backoff honors Retry-After without unlimited waits", () => {
  assert.equal(retryDelay(1), 60_000);
  assert.equal(retryDelay(2), 300_000);
  assert.equal(retryDelay(3), 900_000);
  assert.equal(retryDelay(4), 3_600_000);
  assert.equal(retryDelay(1, "120"), 120_000);
  assert.equal(retryDelay(1, "900000"), 86_400_000);
  assert.equal(retryDelay(1, "invalid"), 60_000);
  assert.equal(retryDelay(1, new Date(120_000).toUTCString(), 0), 120_000);
});

test("all image categories are included; symlinks and nonimages are not read", async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-customer-photos-"));
  try {
    await fs.mkdir(path.join(folder, "before"));
    await fs.writeFile(path.join(folder, "before", "one.jpg"), "fixture-one");
    await fs.writeFile(path.join(folder, "WO-after-01.png"), "fixture-two");
    await fs.writeFile(path.join(folder, "WO-trouble-01.jpg"), "fixture-three");
    await fs.writeFile(path.join(folder, "WO-signature.png"), "fixture-four");
    await fs.writeFile(path.join(folder, "notes.pdf"), "not-an-image");
    await fs.symlink(path.join(folder, "WO-signature.png"), path.join(folder, "link.png"));
    const photos = await readDeliveryPhotos(folder);
    assert.equal(photos.length, 4);
    assert.deepEqual(photos.map(p => p.type).sort(), ["after", "before", "signature", "trouble"]);
    assert.ok(photos.every(p => p.contentType.startsWith("image/") && p.data));
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test("persistent outbox delivery, retries, recovery, and legacy replay", async t => {
  await initializeCustomerApi();
  let responseStatus = 200;
  const requests: { body: string; id: string | undefined; key: string | undefined }[] = [];
  const receiver = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ body, id: req.headers["x-meterflo-delivery-id"] as string, key: req.headers["idempotency-key"] as string });
    res.writeHead(responseStatus, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: responseStatus === 200 }));
  });
  await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
  const port = (receiver.address() as { port: number }).port;
  const schemaName = `customer_api_fixture_${randomUUID().replace(/-/g, "")}`;
  const { rows: [project] } = await pool.query(
    `INSERT INTO public.projects (name,database_name,customer_api_enabled,customer_api_url,customer_api_auth_type,customer_api_send_photos)
     VALUES ($1,$2,true,$3,'none',false) RETURNING id`, ["Customer API automated fixture", schemaName, `http://127.0.0.1:${port}`]);
  let workOrderId = 100;
  let createdSchema: string | undefined;
  async function enqueue(status = "Completed") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await enqueueCustomerDelivery(client, schemaName, {
        id: ++workOrderId, customer_wo_id: `FIXTURE-${workOrderId}`, status, updated_at: new Date(),
        old_module_read: "12.5", new_system_id: "new-device", notes: "Fixture only",
      });
      await client.query("COMMIT");
      const { rows: [job] } = await pool.query(`SELECT * FROM public.customer_api_deliveries WHERE project_id=$1 AND work_order_id=$2`, [project.id, workOrderId]);
      return job;
    } finally { client.release(); }
  }
  async function due(id: string) {
    await pool.query(`UPDATE public.customer_api_deliveries SET next_attempt_at=now()-interval '1 second' WHERE id=$1`, [id]);
  }
  async function job(id: string) {
    return (await pool.query(`SELECT * FROM public.customer_api_deliveries WHERE id=$1`, [id])).rows[0];
  }
  try {
    await t.test("disabled and open work orders do not enter the queue; rolled-back events disappear", async () => {
      assert.equal(await enqueue("Open"), undefined);
      await pool.query(`UPDATE public.projects SET customer_api_enabled=false WHERE id=$1`, [project.id]);
      assert.equal(await enqueue(), undefined);
      await pool.query(`UPDATE public.projects SET customer_api_enabled=true WHERE id=$1`, [project.id]);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await enqueueCustomerDelivery(client, schemaName, { id: 999, status: "Completed", updated_at: new Date() });
        await client.query("ROLLBACK");
        assert.equal((await pool.query(`SELECT id FROM public.customer_api_deliveries WHERE project_id=$1 AND work_order_id=999`, [project.id])).rowCount, 0);
      } finally { client.release(); }
    });
    await t.test("503 schedules retry; the later successful request uses the identical body and ID", async () => {
      const delivery = await enqueue();
      responseStatus = 503;
      await due(delivery.id); await runCustomerApiWorker(project.id);
      const failed = await job(delivery.id);
      assert.equal(failed.status, "retrying");
      assert.equal(failed.attempt_count, 1);
      assert.ok(new Date(failed.next_attempt_at).getTime() > Date.now() + 50_000);
      responseStatus = 200;
      await due(delivery.id); await runCustomerApiWorker(project.id);
      assert.equal((await job(delivery.id)).status, "delivered");
      assert.equal(requests.at(-1)!.body, requests.at(-2)!.body);
      assert.equal(requests.at(-1)!.id, requests.at(-2)!.id);
      assert.equal(requests.at(-1)!.key, delivery.id);
      const payload = JSON.parse(requests.at(-1)!.body);
      assert.equal(payload.oldModuleReading, "12.5");
      assert.ok(!("photos" in payload) && !("signature" in payload));
      assert.equal(await retryCustomerDelivery(delivery.id, "fixture-admin"), undefined);
    });
    await t.test("five failures stop automatic delivery; manual retry starts a new cycle", async () => {
      const delivery = await enqueue("Trouble");
      responseStatus = 400;
      for (let i = 0; i < 5; i++) { await due(delivery.id); await runCustomerApiWorker(project.id); }
      assert.equal((await job(delivery.id)).status, "failed");
      assert.equal((await job(delivery.id)).attempt_count, 5);
      const before = requests.length;
      await runCustomerApiWorker(project.id);
      assert.equal(requests.length, before);
      assert.ok(await retryCustomerDelivery(delivery.id, "fixture-admin"));
      assert.equal(await retryCustomerDelivery(delivery.id, "fixture-admin"), undefined);
      responseStatus = 200;
      await runCustomerApiWorker(project.id);
      const recovered = await job(delivery.id);
      assert.equal(recovered.status, "delivered");
      assert.equal(recovered.attempt_count, 6);
      assert.equal(recovered.cycle_attempts, 1);
      const logs = (await pool.query(`SELECT * FROM public.customer_api_logs WHERE delivery_id=$1 ORDER BY attempt_number`, [delivery.id])).rows;
      assert.equal(logs.length, 6);
      assert.equal(logs[5].triggered_by, "manual:fixture-admin");
      assert.equal(logs[5].retry_count, 5);
    });
    await t.test("disabled projects pause existing work; expired processing claims recover after restart", async () => {
      const delivery = await enqueue();
      await pool.query(`UPDATE public.projects SET customer_api_enabled=false WHERE id=$1`, [project.id]);
      await due(delivery.id); await runCustomerApiWorker(project.id);
      assert.equal((await job(delivery.id)).status, "paused");
      assert.equal((await job(delivery.id)).attempt_count, 0);
      assert.equal(await retryCustomerDelivery(delivery.id, "fixture-admin"), undefined);
      await pool.query(`UPDATE public.projects SET customer_api_enabled=true WHERE id=$1`, [project.id]);
      await pool.query(`UPDATE public.customer_api_deliveries SET status='processing',locked_at=now()-interval '3 minutes',lock_token='expired' WHERE id=$1`, [delivery.id]);
      await runCustomerApiWorker(project.id);
      assert.equal((await job(delivery.id)).status, "delivered");
    });
    await t.test("overlapping workers do not deliver the same request twice", async () => {
      const delivery = await enqueue();
      await due(delivery.id);
      const before = requests.length;
      await Promise.all([runCustomerApiWorker(project.id), runCustomerApiWorker(project.id)]);
      assert.equal(requests.length, before + 1);
    });
    await t.test("invalid authentication fails without an outbound request, then recovers when configuration is fixed", async () => {
      const delivery = await enqueue();
      await pool.query(`UPDATE public.projects SET customer_api_auth_type='bearer_token',customer_api_secret_env_var=NULL WHERE id=$1`, [project.id]);
      const before = requests.length;
      await due(delivery.id); await runCustomerApiWorker(project.id);
      assert.equal(requests.length, before);
      assert.match((await job(delivery.id)).last_error, /secret is not configured/);
      await pool.query(`UPDATE public.projects SET customer_api_auth_type='none' WHERE id=$1`, [project.id]);
      await due(delivery.id); await runCustomerApiWorker(project.id);
      assert.equal((await job(delivery.id)).status, "delivered");
    });
    await t.test("failed historical logs can be manually replayed once and traced to the original attempt", async () => {
      const saved = JSON.stringify({ workOrderId: 22, customerWoId: "OLD-22", status: "Completed", notes: "Legacy fixture" });
      const { rows: [log] } = await pool.query(
        `INSERT INTO public.customer_api_logs(project_id,work_order_id,customer_wo_id,request_url,request_payload,success) VALUES ($1,22,'OLD-22','http://fixture.invalid',$2,false) RETURNING id`,
        [project.id,saved]);
      const id = await retryLegacyCustomerLog(log.id, "fixture-admin");
      await assert.rejects(retryLegacyCustomerLog(log.id, "fixture-admin"), /legacy/);
      await runCustomerApiWorker(project.id);
      assert.equal((await job(id)).status, "delivered");
      assert.equal(requests.at(-1)!.body, saved);
      assert.equal((await job(id)).attempt_count, 2);
    });
    await t.test("real finalized work-order saves and timing updates create transactional delivery events", async () => {
      createdSchema = await createProjectSchema("Customer API automated fixture", project.id);
      await pool.query(`UPDATE public.projects SET database_name=$2 WHERE id=$1`, [project.id,createdSchema]);
      const { rows: [wo] } = await pool.query(
        `INSERT INTO "${createdSchema}".work_orders(status,customer_wo_id,created_by) VALUES ('Open','ATOMIC-FIXTURE',NULL) RETURNING id`);
      const orders = getProjectWorkOrderStorage(createdSchema);
      await orders.updateWorkOrder(wo.id, { status: "Completed", newSystemId: "atomic-meter", newModuleRead: "0.125" });
      const { rows: [event] } = await pool.query(
        `SELECT * FROM public.customer_api_deliveries WHERE project_id=$1 AND work_order_id=$2`, [project.id,wo.id]);
      assert.ok(event);
      assert.equal(event.snapshot.new_system_id, "atomic-meter");
      assert.equal(event.snapshot.new_module_read, "0.125");
      await storage.saveWorkOrderTimeTracking({
        projectId: project.id, systemWorkOrderId: "ATOMIC-FIXTURE",
        startTime: "2026-01-01T12:00:00Z", endTime: "2026-01-01T12:01:00Z",
      });
      assert.equal((await pool.query(`SELECT id FROM public.customer_api_deliveries WHERE project_id=$1 AND work_order_id=$2`, [project.id,wo.id])).rowCount, 2);
      await pool.query(`UPDATE public.customer_api_deliveries SET next_attempt_at=now() WHERE project_id=$1 AND work_order_id=$2`, [project.id,wo.id]);
      await runCustomerApiWorker(project.id);
      assert.equal(JSON.parse(requests.at(-1)!.body).timeTracking.durationSeconds, 60);
    });
  } finally {
    if (createdSchema) await pool.query(`DROP SCHEMA "${createdSchema}" CASCADE`);
    await pool.query(`DELETE FROM public.projects WHERE id=$1`, [project.id]);
    await new Promise<void>(resolve => receiver.close(() => resolve()));
    await pool.end();
  }
});
