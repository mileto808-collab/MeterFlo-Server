import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { initializeGpsSchema, installGpsColumns, migrateGpsSchema } from "../server/gpsSchema";

test("managed startup checks the schema without running DDL", async () => {
  const previous = process.env.REPL_ID, calls: string[] = [];
  try {
    process.env.REPL_ID = "gps-owned-runtime-fixture";
    const pool = {
      query: async (sql: string) => { calls.push(sql); return { rows: [] }; },
      connect: () => { throw new Error("Managed startup must not acquire a migration connection."); },
    } as unknown as Pool;
    await initializeGpsSchema(pool);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /^SELECT wizard_gps_max_accuracy_metres/);
    assert.doesNotMatch(calls.join("\n"), /ALTER|CREATE|DROP|DELETE/i);
  } finally { if (previous === undefined) delete process.env.REPL_ID; else process.env.REPL_ID = previous; }
});
test("explicit migration is transactional, additive, nullable and covers owned project schemas", async () => {
  const calls: string[] = [];
  let released = false;
  const client = {
    query: async (sql: string) => {
      calls.push(sql);
      return { rows: sql.startsWith("SELECT database_name")
        ? [{ database_name: "project_gps_owned" }, { database_name: 'invalid";DROP TABLE users;' }]
        : sql.startsWith("SELECT to_regclass") ? [{ name: "project_gps_owned.work_orders" }] : [] };
    },
    release: () => { released = true; },
  };
  await migrateGpsSchema({ connect: async () => client } as unknown as Pool);
  assert.equal(calls[0], "BEGIN"); assert.equal(calls.at(-1), "COMMIT"); assert.ok(released);
  assert.ok(calls.some(sql => sql.includes('"project_gps_owned".work_orders')));
  assert.doesNotMatch(calls.join("\n"), /DROP TABLE|DELETE FROM|UPDATE .*new_gps|gps_source.*NOT NULL/i);
  assert.ok(calls.some(sql => sql.includes("wizard_gps_max_accuracy_metres")));
  await assert.rejects(installGpsColumns(client as any, 'invalid";DROP TABLE users;'), /Invalid project schema/);
});
