/**
 * Runs only against a new, internally owned PostgreSQL cluster.
 * Input is the read-only explainSchemaDiff() output saved as JSON.
 * Usage: npx tsx tests/support/validate-publish-reference-diff.ts <diff.json>
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { publishingPostgres } from "../helpers/publishing-postgres";

const file = process.argv[2];
if (!file) throw new Error("Provide the saved explainSchemaDiff JSON; no database URL is accepted.");
const diff = JSON.parse(await readFile(file, "utf8"));
assert.equal(diff.success, true);
assert.equal(diff.hasStructuralDataLoss, false);
for (const field of ["tablesToRemove", "tablesToTruncate", "columnsToRemove", "schemasToRemove", "matViewsToRemove"])
  assert.deepEqual(diff[field], []);
assert.ok(Array.isArray(diff.statementsToExecute) && diff.statementsToExecute.length);
assert.ok(!diff.statementsToExecute.some((sql: string) => /DROP CONSTRAINT\s+"trouble_codes_code_key"/i.test(sql)));

const owned = await publishingPostgres();
try {
  const { pool } = owned;
  // Minimal metadata-equivalent dependencies, populated with synthetic records.
  // No production data, credentials, connection strings or schemas are copied.
  await pool.query(`
    CREATE TABLE public.projects(id integer PRIMARY KEY,database_name text);
    CREATE TABLE public.users(id varchar PRIMARY KEY);
    CREATE TABLE public.inventory_state(project_id integer PRIMARY KEY);
    CREATE TABLE public.inventory_warehouses(project_id integer NOT NULL,_key text NOT NULL,id text,
      PRIMARY KEY(project_id,_key),UNIQUE(project_id,id));
    CREATE TABLE public.inventory_removal_rules(project_id integer NOT NULL,_key text NOT NULL,id uuid,
      name text,active boolean,revision integer,equipment text,stage text,outcome text,
      PRIMARY KEY(project_id,_key),UNIQUE(project_id,id),
      CONSTRAINT inventory_removal_rule_valid CHECK(true));
    CREATE TABLE public.inventory_returns(project_id integer NOT NULL,_key text NOT NULL,id text,serial text,
      PRIMARY KEY(project_id,_key));
    CREATE UNIQUE INDEX inventory_returns_identity ON public.inventory_returns(project_id,id);
    CREATE TABLE public.trouble_codes(id integer PRIMARY KEY,code varchar(50) NOT NULL,label text,
      CONSTRAINT trouble_codes_code_key UNIQUE(code));
    CREATE SCHEMA project_publish_reference_fixture;
    CREATE TABLE project_publish_reference_fixture.work_orders(id integer PRIMARY KEY,trouble varchar(50),
      CONSTRAINT fk_trouble_code FOREIGN KEY(trouble) REFERENCES public.trouble_codes(code)
        ON UPDATE CASCADE ON DELETE RESTRICT);
    INSERT INTO public.projects VALUES(1,'project_publish_reference_fixture');
    INSERT INTO public.users VALUES('warehouse-fixture');
    INSERT INTO public.inventory_state VALUES(1);
    INSERT INTO public.inventory_warehouses VALUES(1,'warehouse','warehouse');
    INSERT INTO public.inventory_returns VALUES(1,'return-1','return-1','OLD-001');
    INSERT INTO public.trouble_codes VALUES(1,'FIXTURE-A','First'),(2,'FIXTURE-B','Second');
    INSERT INTO project_publish_reference_fixture.work_orders VALUES(101,'FIXTURE-A'),(102,'FIXTURE-B');
  `);
  // Reproduce the original error, without CASCADE or any removals.
  await assert.rejects(pool.query('ALTER TABLE public.trouble_codes DROP CONSTRAINT trouble_codes_code_key'),
    (error: any) => error.code === "2BP01");
  const evidence = async () => ({
    workOrders: (await pool.query("SELECT * FROM project_publish_reference_fixture.work_orders ORDER BY id")).rows,
    codes: (await pool.query("SELECT id,code,label FROM public.trouble_codes ORDER BY id")).rows,
    returns: (await pool.query("SELECT project_id,_key,id,serial FROM public.inventory_returns ORDER BY id")).rows,
  });
  const before = await evidence();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Preserve the exact generated order: never reorder to make this test pass.
    for (let index = 0; index < diff.statementsToExecute.length; index++) {
      try { await client.query(diff.statementsToExecute[index]); }
      catch (error: any) { throw new Error(`Generated statement ${index + 1} failed (${error.code}): ${diff.statementsToExecute[index]}`, { cause: error }); }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
  assert.deepEqual(await evidence(), before, "Publishing must preserve work orders, code identities and removed equipment");
  const { rows: constraints } = await pool.query(`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid IN ('public.inventory_returns'::regclass,'public.inventory_customer_handoff_lines'::regclass) AND contype='f'`);
  assert.ok(constraints.some(row => row.definition.includes("return_id") && row.definition.includes("inventory_returns(project_id, _key)")));
  assert.ok(constraints.some(row => row.definition.includes("customer_handoff_id") && row.definition.includes("inventory_customer_handoffs(project_id, _key)")));
  await pool.query(`INSERT INTO public.inventory_customer_handoffs(project_id,_key,id,warehouse_id) VALUES(1,'handoff-1','handoff-1','warehouse');
    INSERT INTO public.inventory_customer_handoff_lines(project_id,parent_id,path,line_no,_fields,return_id)
      VALUES(1,'handoff-1','lines',0,'{}','return-1');
    UPDATE public.inventory_returns SET customer_handoff_id='handoff-1' WHERE project_id=1 AND _key='return-1'`);
  await assert.rejects(pool.query(`INSERT INTO public.inventory_customer_handoff_lines(project_id,parent_id,path,line_no,_fields,return_id)
    VALUES(1,'handoff-1','lines',1,'{}','missing-return')`), (error: any) => error.code === "23503");
  await assert.rejects(pool.query(`INSERT INTO public.inventory_customer_handoff_lines(project_id,parent_id,path,line_no,_fields,return_id)
    VALUES(1,'handoff-1','lines',1,'{}','return-1')`), (error: any) => error.code === "23505");
  await assert.rejects(pool.query("UPDATE public.trouble_codes SET rule_key=(SELECT rule_key FROM public.trouble_codes WHERE id=1) WHERE id=2"),
    (error: any) => error.code === "23505");
  // Invoke the real startup routine in a fresh process, with the owned test
  // environment installed before importing server modules. No dev/prod URL
  // is inherited. A generated-SQL-only check cannot catch startup schema drift.
  const startup = await owned.run(process.execPath, [
    resolve("node_modules/tsx/dist/cli.mjs"),
    resolve("tests/support/verify-publish-trouble-startup.ts"),
  ], owned.env);
  console.log(startup.trim());
  console.log(`PASS: original dependent-key failure reproduced; all ${diff.statementsToExecute.length} regenerated statements applied in their original order; records preserved, handoff references enforced, no truncation.`);
} finally { await owned.close(); }
