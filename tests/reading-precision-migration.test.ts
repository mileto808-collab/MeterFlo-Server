import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import pg from "pg";
import { getTableConfig } from "drizzle-orm/pg-core";
import { projects } from "../shared/schema";
import { initializeReadingPrecision } from "../server/readingPrecisionMigration";

const columns = ["system_reading_decimal_places", "module_reading_decimal_places"];
const names = columns.map(column => `projects_${column}_check`);

test("reading precision migration on an owned disposable PostgreSQL cluster", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "reading-precision-"));
  const port = await new Promise<number>(resolve => {
    const server = net.createServer().listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { encoding: "utf8" });
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  };
  const data = path.join(root, "pg");
  let started = false;
  const pool = new pg.Pool({ host: "127.0.0.1", port, user: "precision_owner", database: "postgres" });
  const reset = async (definitions = "") => {
    await pool.query(`DROP TABLE IF EXISTS public.projects;
      CREATE TABLE public.projects(id integer PRIMARY KEY ${definitions ? `, ${definitions}` : ""})`);
  };
  const assertEnforced = async () => {
    const { rows } = await pool.query("SELECT conname, convalidated FROM pg_constraint WHERE conrelid='public.projects'::regclass AND contype='c'");
    for (const name of names) assert.ok(rows.some(row => row.conname === name && row.convalidated));
    for (const column of columns) {
      for (const invalid of [-1, 7]) {
        await assert.rejects(pool.query(`UPDATE public.projects SET ${column}=$1`, [invalid]),
          (error: any) => error.code === "23514");
      }
      for (const valid of [0, 6]) await pool.query(`UPDATE public.projects SET ${column}=$1`, [valid]);
    }
  };
  try {
    run("initdb", ["-D", data, "-U", "precision_owner", "--auth=trust", "--encoding=UTF8", "--no-locale"]);
    run("pg_ctl", ["-D", data, "-l", path.join(root, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port} -k ${root}`, "-w", "start"]);
    started = true;
    await t.test("schema tools declare the same named constraints", () => {
      const checks = getTableConfig(projects).checks;
      for (const name of names) assert.ok(checks.some(check => check.name === name));
    });
    await t.test("missing columns get default 3; repeated and concurrent initialization", async () => {
      await reset();
      await pool.query("INSERT INTO public.projects VALUES(1)");
      await Promise.all([initializeReadingPrecision(pool), initializeReadingPrecision(pool)]);
      const { rows: [row] } = await pool.query("SELECT * FROM public.projects");
      assert.deepEqual(row, { id: 1, system_reading_decimal_places: 3, module_reading_decimal_places: 3 });
      await initializeReadingPrecision(pool);
      await assertEnforced();
    });
    await t.test("existing unconstrained columns preserve zero/six", async () => {
      await reset(columns.map(column => `${column} integer NOT NULL DEFAULT 3`).join(","));
      await pool.query("INSERT INTO public.projects VALUES(1,0,6)");
      await initializeReadingPrecision(pool);
      await initializeReadingPrecision(pool);
      const { rows: [row] } = await pool.query("SELECT * FROM public.projects");
      assert.deepEqual(row, { id: 1, system_reading_decimal_places: 0, module_reading_decimal_places: 6 });
      await assertEnforced();
    });
    await t.test("one missing column preserves the existing setting", async () => {
      await reset("system_reading_decimal_places integer NOT NULL DEFAULT 3");
      await pool.query("INSERT INTO public.projects VALUES(1,0)");
      await initializeReadingPrecision(pool);
      assert.deepEqual((await pool.query("SELECT * FROM public.projects")).rows[0],
        { id: 1, system_reading_decimal_places: 0, module_reading_decimal_places: 3 });
    });
    await t.test("invalid rows are reported, never rewritten; upgrade is atomic", async () => {
      await reset("system_reading_decimal_places integer NOT NULL DEFAULT 3");
      await pool.query("INSERT INTO public.projects VALUES(1,-1),(2,7),(3,0)");
      await assert.rejects(initializeReadingPrecision(pool), /2 project\(s\).*outside 0–6.*"id":1.*"id":2/);
      assert.deepEqual((await pool.query("SELECT system_reading_decimal_places FROM public.projects ORDER BY id")).rows.map(row => row.system_reading_decimal_places), [-1, 7, 0]);
      assert.equal((await pool.query("SELECT count(*) FROM pg_attribute WHERE attrelid='public.projects'::regclass AND attname='module_reading_decimal_places' AND NOT attisdropped")).rows[0].count, "0");
      await pool.query("UPDATE public.projects SET system_reading_decimal_places=6 WHERE id IN (1,2)");
      await initializeReadingPrecision(pool);
      await assertEnforced();
    });
    await t.test("DBA NOT VALID checks are validated, not trusted by name", async () => {
      await reset(columns.map(column => `${column} integer`).join(","));
      await pool.query("INSERT INTO public.projects VALUES(1,0,7)");
      for (const column of columns) await pool.query(`ALTER TABLE public.projects ADD CONSTRAINT projects_${column}_check CHECK (${column} BETWEEN 0 AND 6) NOT VALID`);
      await assert.rejects(initializeReadingPrecision(pool), /outside 0–6/);
      await pool.query("UPDATE public.projects SET module_reading_decimal_places=6");
      await initializeReadingPrecision(pool);
      await assertEnforced();
    });
    await t.test("misleading named checks fail explicitly without replacement", async () => {
      await reset(columns.map(column => `${column} integer`).join(","));
      await pool.query(`ALTER TABLE public.projects ADD CONSTRAINT ${names[0]} CHECK (system_reading_decimal_places BETWEEN 0 AND 99)`);
      await assert.rejects(initializeReadingPrecision(pool), /unexpected definition/);
      await pool.query("INSERT INTO public.projects VALUES(1,99,6)");
    });
    await t.test("invalid module settings are also reported without mutation", async () => {
      await reset(columns.map(column => `${column} integer NOT NULL DEFAULT 3`).join(","));
      await pool.query("INSERT INTO public.projects VALUES(1,0,-1),(2,6,7)");
      await assert.rejects(initializeReadingPrecision(pool), /2 project\(s\).*outside 0–6/);
      assert.deepEqual((await pool.query("SELECT module_reading_decimal_places FROM public.projects ORDER BY id")).rows.map(row => row.module_reading_decimal_places), [-1, 7]);
    });
    await t.test("fully prepared limited-privilege read-only runtime performs no DDL", async () => {
      await reset();
      await pool.query("INSERT INTO public.projects VALUES(1)");
      await initializeReadingPrecision(pool);
      await pool.query("CREATE ROLE precision_runtime LOGIN; GRANT USAGE ON SCHEMA public TO precision_runtime; GRANT SELECT ON public.projects TO precision_runtime");
      const runtime = new pg.Pool({ host: "127.0.0.1", port, user: "precision_runtime", database: "postgres", options: "-c default_transaction_read_only=on" });
      try {
        await initializeReadingPrecision(runtime);
        await initializeReadingPrecision(runtime);
        await assert.rejects(runtime.query("ALTER TABLE public.projects ADD COLUMN forbidden integer"));
        await pool.query(`ALTER TABLE public.projects DROP CONSTRAINT ${names[1]}`);
        await assert.rejects(initializeReadingPrecision(runtime),
          (error: any) => ["42501", "25006"].includes(error.code));
        assert.equal((await pool.query("SELECT count(*) FROM pg_constraint WHERE conrelid='public.projects'::regclass AND conname=$1", [names[1]])).rows[0].count, "0");
      } finally { await runtime.end(); }
    });
  } finally {
    await pool.end();
    try { if (started) run("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"]); }
    finally { await rm(root, { recursive: true, force: true }); }
  }
});
