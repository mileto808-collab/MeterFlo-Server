import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { createProjectSchema, getProjectWorkOrderStorage } from "../server/projectDb";
import { mobileSubmissionRoute, mobileSubmissionBatchItem } from "../server/mobileSubmissions";
import { mobileSubmissionMediaName } from "../server/mobileSubmissionContext";
import { clearRelationalInventory } from "../server/inventoryRelational";

test("durable mobile acceptance, lost-response recovery, concurrency and authority", { timeout: 60000 }, async t => {
  const { rows: [project] } = await pool.query(
    "INSERT INTO public.projects(name,inventory_enabled) VALUES($1,false) RETURNING id,name", [`Mobile submission fixture ${randomUUID()}`]);
  const actorId = randomUUID(), otherId = randomUUID();
  let schema: string | undefined;
  const folder = await mkdtemp(path.join(tmpdir(), "mobile-submission-"));
  let preparations = 0;
  const failedAttempts = new Set<string>();
  try {
    const administrator = await storage.getAdministratorSubrole();
    assert.ok(administrator, "use the normal administrator subrole, not seeded permission keys");
    for (const id of [actorId, otherId]) await pool.query(
      "INSERT INTO public.users(id,username,role,subrole_id) VALUES($1,$2,'user',$3)",
      [id, `mobile-fixture-${id}`, administrator.id]);
    schema = await createProjectSchema(`Mobile ${randomUUID().replace(/-/g, "")}`, project.id);
    await pool.query("UPDATE public.projects SET database_name=$1 WHERE id=$2", [schema, project.id]);
    const store = getProjectWorkOrderStorage(schema);
    const order = () => store.createWorkOrder({
      customerWoId: `MOBILE-${randomUUID()}`, customerName: "Fixture", address: "Fixture", status: "Open", assignedUserId: actorId,
    } as any);
    const identity = (wo: any) => ({ changeoutSubmissionId: randomUUID(), changeoutAssignmentVersion: wo.assignmentVersion ?? 0,
      notes: "immutable capture", oldSystemReading: "00001.001200" });
    const request = (id: number, body: any, user = actorId) => ({
      params: { projectId: String(project.id), workOrderId: String(id) }, body, user: { claims: { sub: user } },
    });
    const guarded = (kind: "complete" | "trouble", lateFailure = false, failFirst = false) => mobileSubmissionRoute(kind, async (req: any, res) => {
      try {
        preparations++;
        await writeFile(path.join(folder, mobileSubmissionMediaName(kind, 0, ".png", `${randomUUID()}.png`)),
          Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8b8AAAAASUVORK5CYII=", "base64"));
        if (failFirst && !failedAttempts.has(req.body.changeoutSubmissionId)) {
          failedAttempts.add(req.body.changeoutSubmissionId);
          return res.status(503).json({ message: "Interrupted before commit" });
        }
        const current = await store.getWorkOrder(Number(req.params.workOrderId));
        const workOrder = await store.updateWorkOrder(current!.id, {
          status: kind === "complete" ? "Completed" : "Trouble",
          oldSystemReading: req.body.oldSystemReading,
          notes: `${current?.notes ?? ""}|${req.body.notes}`,
        } as any, (await storage.getUser(req.user.claims.sub))!.username!);
        if (lateFailure) return res.status(500).json({ success: false, message: "Late delivery failed" });
        return res.json({ success: true, workOrder });
      } catch (error: any) { return res.status(error.status ?? 500).json({ code: error.code, message: error.message }); }
    });
    const complete = guarded("complete"), trouble = guarded("trouble");
    const submit = (handler: any, wo: any, body: any, actor = actorId) =>
      mobileSubmissionBatchItem(handler, request(wo.id, body, actor), wo.id, body);

    await t.test("legacy requests bypass all new identity, boolean and multipart rules", async () => {
      const wo = await order();
      const handler = mobileSubmissionRoute("auto", async (_req, res) => { res.json({ legacy: true }); });
      const result = await submit(handler, wo, { data: '{"canChange":true,"photoTypes":["before"]}', photoTypes: '["before"]' });
      assert.equal(result.status, 200);
      assert.equal(result.payload.legacy, true);
      assert.equal(result.payload.submission, undefined);
    });

    await t.test("inventory-disabled completion commits once; duplicate response loss bypasses preparation", async () => {
      const wo = await order(), body = identity(wo), before = preparations;
      const first = await submit(complete, wo, body);
      assert.equal(first.status, 200);
      assert.equal(first.payload.submission.fieldStatus, "accepted");
      assert.equal(first.payload.submission.reconciliationStatus, "not_required");
      assert.equal(first.payload.submission.attachmentsConfirmed, true);
      const recovered = await submit(complete, wo, body);
      assert.equal(recovered.status, 200);
      assert.equal(recovered.payload.submission.replayed, true);
      assert.equal(preparations, before + 1);
      assert.equal((await store.getWorkOrder(wo.id))?.oldSystemReadingText, body.oldSystemReading);
      assert.equal(((await store.getWorkOrder(wo.id))?.notes?.match(/\|immutable capture/g) ?? []).length, 1);
      assert.equal(recovered.payload.workOrder.notes, first.payload.workOrder.notes);
      assert.equal((await pool.query("SELECT count(*)::int n FROM public.changeout_completions WHERE project_id=$1 AND work_order_id=$2", [project.id, wo.id])).rows[0].n, 1);
      assert.equal((await readdir(folder)).length, 1);
      const changed = await submit(complete, wo, { ...body, notes: "changed after acceptance" });
      assert.equal(changed.status, 409);
      assert.equal(changed.payload.code, "CHANGEOUT_PAYLOAD_MISMATCH");
      assert.equal((await submit(complete, wo, body, otherId)).status, 409);
      assert.equal(preparations, before + 1);
    });

    await t.test("more simultaneous retries than pool connections neither duplicate nor deadlock", async () => {
      const wo = await order(), body = identity(wo), before = preparations;
      const results = await Promise.all(Array.from({ length: (pool.options.max ?? 10) + 2 }, () => submit(complete, wo, body)));
      assert.ok(results.every(result => result.status === 200));
      assert.equal(results.filter(result => !result.payload.submission.replayed).length, 1);
      assert.equal(preparations, before + 1);
    });

    await t.test("stale assignments reject before media preparation; new identities cannot overwrite completed work", async () => {
      const wo = await order(), body = identity(wo), before = preparations;
      await store.updateWorkOrder(wo.id, { assignedUserId: otherId } as any);
      const stale = await submit(complete, wo, body);
      assert.equal(stale.status, 409);
      assert.equal(stale.payload.code, "CHANGEOUT_ATTEMPT_CHANGED");
      assert.equal(preparations, before);
      const fresh = await order(), accepted = identity(fresh);
      await submit(complete, fresh, accepted);
      assert.equal((await submit(complete, fresh, { ...accepted, changeoutSubmissionId: randomUUID() })).status, 409);
      await store.updateWorkOrder(fresh.id, { status: "Open" } as any);
      const replay = await submit(complete, fresh, accepted);
      assert.equal(replay.status, 409);
      assert.equal((await store.getWorkOrder(fresh.id))?.status, "Open");
    });

    await t.test("Trouble has a durable receipt but never becomes a completed changeout", async () => {
      const wo = await order(), body = identity(wo), before = preparations;
      const first = await submit(trouble, wo, body);
      const retry = await submit(trouble, wo, body);
      assert.equal(first.status, 200);
      assert.equal(retry.payload.submission.replayed, true);
      assert.equal(first.payload.submission.kind, "trouble");
      assert.equal(first.payload.submission.reconciliationStatus, "not_required");
      assert.equal(preparations, before + 1);
      assert.equal((await store.getWorkOrder(wo.id))?.status, "Trouble");
      assert.equal((await submit(complete, wo, body)).status, 409, "one identity cannot switch operation kinds");
    });

    await t.test("a late delivery failure does not misreport accepted field work as rejected", async () => {
      const wo = await order(), body = identity(wo);
      const result = await submit(guarded("complete", true), wo, body);
      assert.equal(result.status, 200);
      assert.equal(result.payload.success, true);
      assert.equal(result.payload.submission.fieldStatus, "accepted");
      assert.equal(result.payload.message, undefined);
    });

    await t.test("pre-commit interruption retains identity and overwrites only its retry-stable media file", async () => {
      const wo = await order(), body = identity(wo), files = (await readdir(folder)).length;
      const handler = guarded("complete", false, true);
      assert.equal((await submit(handler, wo, body)).status, 503);
      assert.equal((await store.getWorkOrder(wo.id))?.status, "Open");
      assert.equal((await submit(handler, wo, body)).payload.submission.fieldStatus, "accepted");
      assert.equal((await readdir(folder)).length, files + 1);
    });

    await t.test("a bare successful response without durable acceptance is explicitly unconfirmed", async () => {
      const wo = await order(), body = identity(wo);
      const handler = mobileSubmissionRoute("complete", async (_req, res) => { res.json({ success: true }); });
      const unconfirmed = await submit(handler, wo, body);
      assert.equal(unconfirmed.status, 503);
      assert.equal(unconfirmed.payload.code, "CHANGEOUT_UNCONFIRMED");
      assert.equal((await store.getWorkOrder(wo.id))?.status, "Open");
      assert.equal((await submit(complete, wo, body)).status, 200);
    });

    await t.test("inventory-enabled field acceptance is separate from eventual reconciliation", async () => {
      await pool.query("UPDATE public.projects SET inventory_enabled=true WHERE id=$1", [project.id]);
      const wo = await order(), body = identity(wo);
      const first = await submit(complete, wo, body);
      assert.equal(first.status, 200);
      assert.equal(first.payload.submission.fieldStatus, "accepted");
      assert.ok(["pending", "succeeded", "failed"].includes(first.payload.submission.reconciliationStatus));
      assert.equal((await submit(complete, wo, body)).payload.submission.replayed, true);
      assert.equal((await store.getWorkOrder(wo.id))?.status, "Completed");
    });

    await t.test("unauthenticated and revoked callers cannot recover another response", async () => {
      const wo = await order(), body = identity(wo);
      assert.equal((await submit(complete, wo, body, "missing-fixture-user")).status, 401);
      await pool.query("UPDATE public.users SET role='customer',subrole_id=NULL WHERE id=$1", [otherId]);
      assert.equal((await submit(complete, wo, body, otherId)).status, 403);
    });
  } finally {
    await pool.query("DELETE FROM public.changeout_completions WHERE project_id=$1", [project.id]);
    if (schema) await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await clearRelationalInventory(pool, project.id);
    for (const table of ["inventory_movements", "inventory_state"])
      await pool.query(`DELETE FROM public.${table} WHERE project_id=$1`, [project.id]);
    await pool.query("DELETE FROM public.projects WHERE id=$1", [project.id]);
    await pool.query("DELETE FROM public.users WHERE id=ANY($1::varchar[])", [[actorId, otherId]]);
    await rm(folder, { recursive: true, force: true });
    await pool.end();
  }
});
