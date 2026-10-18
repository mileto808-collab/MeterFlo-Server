import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { withAuditContext } from "../server/auditContext";
import { initializeProjectTroubleCodes, installProjectTroubleCodes } from "../server/projectTroubleCodes";
import { enqueueCustomerDelivery } from "../server/customerApiService";
import { buildCustomerPayload } from "../server/customerApiPayload";
import { createFullSystemBackup, restoreFullSystem } from "../server/systemBackup";

if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Use the owned workspace sandbox.");

test("development upgrade is transactional, idempotent, UUID-backed and history preserving", async () => {
  const client = await pool.connect();
  try {
    await withAuditContext({ actorKind: "system", actorLabel: "Trouble migration fixture",
      source: "trouble-migration-test", operationId: randomUUID() }, async () => {
      await client.query("BEGIN");
      try {
        await initializeProjectTroubleCodes(client);
        const schema = `project_trouble_${randomUUID().replaceAll("-", "")}`;
        const { rows: [project] } = await client.query(
          "INSERT INTO public.projects(name,database_name) VALUES($1,$1) RETURNING id", [schema]);
        const key = randomUUID(), code = `BEFORE_${randomUUID().slice(0, 8)}`;
        await client.query(`INSERT INTO public.trouble_codes(code,label,rule_key,project_id)
          VALUES($1,'Original name',$2,$3)`, [code, key, project.id]);
        await client.query(`CREATE SCHEMA "${schema}";
          CREATE TABLE "${schema}".work_orders(id integer PRIMARY KEY, trouble varchar(50),
            status text, notes text, sub_status_id uuid, updated_at timestamptz DEFAULT now());`);
        await client.query(`INSERT INTO "${schema}".work_orders(id,trouble,status,notes)
          VALUES(1,$1,'Scheduled','Immutable captured note'),(2,NULL,'Open','No trouble')`, [code]);
        const before = (await client.query(`SELECT * FROM "${schema}".work_orders ORDER BY id`)).rows;
        await installProjectTroubleCodes(client, schema);
        await installProjectTroubleCodes(client, schema);
        const after = (await client.query(`SELECT * FROM "${schema}".work_orders ORDER BY id`)).rows;
        assert.equal(after[0].trouble, key);
        assert.equal(after[1].trouble, null);
        for (const field of ["notes", "status", "sub_status_id", "updated_at"]) {
          assert.deepEqual(after[0][field], before[0][field]);
        }
        await client.query("UPDATE public.trouble_codes SET code=$2,label='New name' WHERE rule_key=$1",
          [key, `AFTER_${randomUUID().slice(0, 8)}`]);
        assert.deepEqual((await client.query(`SELECT * FROM "${schema}".work_orders ORDER BY id`)).rows, after);
        await client.query("SAVEPOINT forbidden_rekey");
        await assert.rejects(client.query("UPDATE public.trouble_codes SET rule_key=gen_random_uuid() WHERE rule_key=$1", [key]),
          (e: any) => e.code === "23514");
        await client.query("ROLLBACK TO SAVEPOINT forbidden_rekey");
        await client.query("SAVEPOINT referenced_delete");
        await assert.rejects(client.query("DELETE FROM public.trouble_codes WHERE rule_key=$1", [key]),
          (e: any) => e.code === "23503");
        await client.query("ROLLBACK TO SAVEPOINT referenced_delete");
        // A deliberately reviewed database key maintenance transaction cascades
        // through the FK. Normal API/SQL edits remain prohibited above.
        await client.query("SAVEPOINT reviewed_key_maintenance");
        await client.query("ALTER TABLE public.trouble_codes DISABLE TRIGGER guard_trouble_code_identity");
        const replacement = randomUUID();
        await client.query("UPDATE public.trouble_codes SET rule_key=$2 WHERE rule_key=$1", [key, replacement]);
        assert.equal((await client.query(`SELECT trouble FROM "${schema}".work_orders WHERE id=1`)).rows[0].trouble, replacement);
        await client.query("ROLLBACK TO SAVEPOINT reviewed_key_maintenance");
        await client.query("UPDATE public.projects SET customer_api_enabled=true WHERE id=$1", [project.id]);
        await enqueueCustomerDelivery(client, schema, {
          id: 1, customer_wo_id: "TRB-1", status: "Trouble", trouble: key, updated_at: new Date(),
        });
        const { rows: [delivery] } = await client.query(
          "SELECT snapshot FROM public.customer_api_deliveries WHERE project_id=$1", [project.id]);
        const original = delivery.snapshot;
        await client.query("UPDATE public.trouble_codes SET code='AFTER_CAPTURE',label='Later name' WHERE rule_key=$1", [key]);
        const frozen = (await client.query("SELECT snapshot FROM public.customer_api_deliveries WHERE project_id=$1", [project.id])).rows[0].snapshot;
        assert.deepEqual(frozen, original);
        const payload = buildCustomerPayload(frozen, { id: project.id, name: schema }, randomUUID());
        assert.equal(payload.troubleCodeId, key);
        assert.equal(payload.troubleCode, original.troubleCodeValue);
        assert.equal(payload.troubleCodeName, "New name");
        // A migration cannot silently turn a dangling old string into NULL.
        const bad = `${schema}_bad`;
        await client.query("INSERT INTO public.projects(name,database_name) VALUES($1,$1)", [bad]);
        await client.query(`CREATE SCHEMA "${bad}"; CREATE TABLE "${bad}".work_orders(id integer, trouble text);
          INSERT INTO "${bad}".work_orders VALUES(1,'UNRESOLVED');`);
        await client.query("SAVEPOINT unresolved");
        await assert.rejects(installProjectTroubleCodes(client, bad), /unresolved trouble code/);
        await client.query("ROLLBACK TO SAVEPOINT unresolved");
        assert.equal((await client.query(`SELECT trouble FROM "${bad}".work_orders`)).rows[0].trouble, "UNRESOLVED");
        assert.equal((await client.query(`SELECT data_type FROM information_schema.columns
          WHERE table_schema=$1 AND table_name='work_orders' AND column_name='trouble'`, [bad])).rows[0].data_type, "text");
      } finally {
        await client.query("ROLLBACK");
      }
    });
  } finally {
    client.release();
  }
});

test("full-system backup roundtrip keeps UUID catalog relationships", async () => {
  await withAuditContext({ actorKind: "system", actorLabel: "Trouble full backup fixture",
    source: "trouble-backup-test", operationId: randomUUID() }, async () => {
    const { backup } = await createFullSystemBackup();
    const snapshot = JSON.parse(JSON.stringify(backup));
    const expected = snapshot.projectDatabases.flatMap((p: any) => p.workOrders.filter((w: any) => w.trouble)
      .map((w: any) => [p.schemaName, w.customerWoId, w.trouble]));
    assert.ok(expected.length > 0);
    const restored = await restoreFullSystem(snapshot, { clearExisting: true });
    assert.equal(restored.errors.length, 0);
    for (const [schema, customerWoId, key] of expected) {
      assert.match(schema, /^project_[a-z0-9_]+$/);
      const { rows: [row] } = await pool.query(`SELECT w.trouble,t.rule_key FROM "${schema}".work_orders w
        JOIN public.trouble_codes t ON t.rule_key=w.trouble WHERE w.customer_wo_id=$1`, [customerWoId]);
      assert.equal(row.trouble, key);
      assert.equal(row.rule_key, key);
    }
  });
});

test.after(async () => { await pool.end(); });
