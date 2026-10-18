import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgSequence } from "drizzle-orm/pg-core";
import { projects } from "../shared/schema";
import { initializeInventory } from "../server/inventoryMigration";
import { publishingPostgres } from "./helpers/publishing-postgres";

// This installed drizzle-kit release's ESM bundle uses dynamic Node requires.
// Its CommonJS entry exposes the same typed API without that ESM loader failure.
const { generateDrizzleJson, generateMigration, pushSchema } =
  createRequire(import.meta.url)("drizzle-kit/api") as typeof import("drizzle-kit/api");

test("publishing retains active scheduling columns, constraints and populated business data across repeat reconciliation", { timeout: 180000 }, async t => {
  const sandbox = await publishingPostgres();
  t.after(() => sandbox.close());
  const { pool } = sandbox;
  const database = drizzle(pool);
  let desired: Record<string, unknown> = { projects };
  const reconcile = () => pushSchema(desired, database, ["public"], ["projects"]);
  const first = await reconcile();
  assert.equal(first.hasDataLoss, false);
  await first.apply();

  // Reproduce the dev database from the report: code knows these columns, but
  // the actual dev database does not, while a standalone startup creates them.
  await pool.query(`ALTER TABLE public.projects DROP COLUMN default_service_minutes CASCADE,
    DROP COLUMN default_appointment_tolerance_minutes CASCADE;
    CREATE SCHEMA project_publishing_fixture;
    CREATE TABLE project_publishing_fixture.work_orders(id integer PRIMARY KEY, status text, notes text);
    INSERT INTO project_publishing_fixture.work_orders VALUES(7,'Scheduled','Do not replace this work order');
    INSERT INTO public.projects(name,database_name,routing_configuration,notes) VALUES
      ('Legacy populated project','project_publishing_fixture',
        '{"mode":"override","provider":"geoapify","serverKeyEnv":"GEOAPIFY_SERVER_API_KEY","browserKeyEnv":"GEOAPIFY_BROWSER_API_KEY","maxStops":10,"dailyPlans":10}',
        'Keep settings'),
      ('Legacy unconfigured project',null,null,'Keep legacy null defaults');`);
  await initializeInventory(pool);
  // drizzle-kit's table filter does not filter standalone sequence discovery.
  // Explicitly retain the unrelated inventory identity sequence in this focused
  // test, rather than allowing a projects-only reconciliation to remove it.
  desired = { ...desired, inventoryMovementSequence: pgSequence("inventory_movements_id_seq") };
  await pool.query(`INSERT INTO public.inventory_state(project_id,state) VALUES(1,'{"revision":7}');
    INSERT INTO public.inventory_items(project_id,id,sku,data) VALUES
      (1,'equipment','TEST-EQUIPMENT','{"name":"Preserve stock","serialized":true}');
    INSERT INTO public.inventory_quantities(project_id,warehouse_id,item_id,quantity,reserved,serials) VALUES
      (1,'vehicle','equipment',2,1,'["TEST-SERIAL-A","TEST-SERIAL-B"]');
    INSERT INTO public.inventory_movements(project_id,operation_id,action,changes) VALUES
      (1,'fixture-receipt','receive','{"quantity":2}');`);

  const snapshot = generateDrizzleJson(desired);
  const missingFields = structuredClone(snapshot);
  delete missingFields.tables["public.projects"].columns.default_service_minutes;
  delete missingFields.tables["public.projects"].columns.default_appointment_tolerance_minutes;
  missingFields.tables["public.projects"].checkConstraints = {};
  const unsafeReverse = await generateMigration(snapshot, missingFields);
  assert.ok(unsafeReverse.some(sql => /DROP COLUMN "default_service_minutes"/.test(sql)),
    "An actual dev database missing these active columns explains the destructive publish proposal");
  const additiveForward = await generateMigration(missingFields, snapshot);
  assert.ok(additiveForward.some(sql => /ADD COLUMN "default_service_minutes" integer/.test(sql)));
  assert.ok(additiveForward.every(sql => !/\b(DROP COLUMN|DROP TABLE|TRUNCATE)\b/i.test(sql)));

  const migrate = () => sandbox.run(process.execPath, [
    resolve("node_modules/tsx/dist/cli.mjs"), resolve("script/migrate-visit-scheduling.ts"), "--development",
  ], sandbox.env);
  await migrate();
  const legacy = await pool.query("SELECT default_service_minutes,default_appointment_tolerance_minutes FROM public.projects");
  assert.equal(legacy.rowCount, 2);
  assert.ok(legacy.rows.every(row => row.default_service_minutes === null && row.default_appointment_tolerance_minutes === null),
    "Adding fields does not backfill historical project values");
  await pool.query(`UPDATE public.projects SET default_service_minutes=47,default_appointment_tolerance_minutes=83
    WHERE name='Legacy populated project';
    UPDATE project_publishing_fixture.work_orders SET service_duration_minutes=73,
      appointment_window_start='2026-10-20T13:00:00Z',appointment_window_end='2026-10-20T15:00:00Z' WHERE id=7;`);
  const evidence = async () => ({
    projects: (await pool.query("SELECT * FROM public.projects ORDER BY id")).rows,
    workOrders: (await pool.query("SELECT * FROM project_publishing_fixture.work_orders ORDER BY id")).rows,
    inventoryState: (await pool.query("SELECT * FROM public.inventory_state ORDER BY project_id")).rows,
    inventoryItems: (await pool.query("SELECT * FROM public.inventory_items ORDER BY project_id,id")).rows,
    inventoryQuantities: (await pool.query("SELECT * FROM public.inventory_quantities ORDER BY project_id,warehouse_id,item_id")).rows,
    inventoryMovements: (await pool.query("SELECT * FROM public.inventory_movements ORDER BY id")).rows,
    columns: (await pool.query(`SELECT attnum,attname,format_type(atttypid,atttypmod) AS type,attnotnull
      FROM pg_attribute WHERE attrelid='public.projects'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`)).rows,
  });
  const before = await evidence();
  for (let pass = 1; pass <= 2; pass++) {
    const result = await reconcile();
    assert.equal(result.hasDataLoss, false, `Pass ${pass} cannot require data loss`);
    assert.deepEqual(result.statementsToExecute, [], `Pass ${pass} has no schema drift after additive setup`);
    await result.apply();
    await migrate();
    assert.deepEqual(await evidence(), before, `Pass ${pass} preserves values and physical column identities`);
  }
  const columns = (await pool.query(`SELECT column_name,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema='public' AND table_name='projects' AND column_name IN
    ('default_service_minutes','default_appointment_tolerance_minutes')`)).rows;
  assert.equal(columns.length, 2);
  assert.ok(columns.every(row => row.is_nullable === "YES" && row.column_default === null));
  const constraints = (await pool.query(`SELECT conname FROM pg_constraint WHERE conrelid='public.projects'::regclass
    AND conname IN ('visit_default_duration_range','visit_default_tolerance_range')`)).rows;
  assert.equal(constraints.length, 2);
  for (const [column, value] of [["default_service_minutes", 0], ["default_service_minutes", 481],
    ["default_appointment_tolerance_minutes", -1], ["default_appointment_tolerance_minutes", 241]] as const) {
    await assert.rejects(pool.query(`UPDATE public.projects SET ${column}=$1 WHERE id=1`, [value]),
      (error: any) => error.code === "23514");
  }
  await assert.rejects(pool.query("UPDATE project_publishing_fixture.work_orders SET service_duration_minutes=0"), (error: any) => error.code === "23514");
  await assert.rejects(pool.query("UPDATE project_publishing_fixture.work_orders SET appointment_window_end=NULL"), (error: any) => error.code === "23514");
  await assert.rejects(sandbox.run(process.execPath, [
    resolve("node_modules/tsx/dist/cli.mjs"), resolve("script/migrate-visit-scheduling.ts"), "--development",
  ], { ...sandbox.env, NODE_ENV: "production" }), /restricted to the development workspace/);
  await assert.rejects(sandbox.run(process.execPath, [
    resolve("node_modules/tsx/dist/cli.mjs"), resolve("script/migrate-visit-scheduling.ts"), "--development",
  ], { ...sandbox.env, REPLIT_DEPLOYMENT: "1" }), /restricted to the development workspace/);
  await assert.rejects(sandbox.run(process.execPath, [
    resolve("node_modules/tsx/dist/cli.mjs"), resolve("script/migrate-visit-scheduling.ts"), "--development",
  ], { ...sandbox.env, REPLIT_DEV_DOMAIN: "" }), /restricted to the development workspace/);
  await assert.rejects(sandbox.run(process.execPath, [
    resolve("node_modules/tsx/dist/cli.mjs"), resolve("script/migrate-visit-scheduling.ts"),
  ], sandbox.env), /restricted to the development workspace/);
  assert.deepEqual(await evidence(), before, "Refused production invocations make no changes");
});

test("post-merge installs scheduling on development before publishing without altering publish commands", async () => {
  const postMerge = await readFile("scripts/post-merge.sh", "utf8");
  assert.match(postMerge, /if \[ -n "\$\{REPL_ID:-\}" \]; then[\s\S]*migrate-visit-scheduling\.ts --development[\s\S]*fi/);
  const replit = await readFile(".replit", "utf8");
  const deployment = replit.split("[deployment]")[1].split("[[ports]]")[0];
  assert.doesNotMatch(deployment, /db:push|migrate-|--force|drizzle-kit/);
});
