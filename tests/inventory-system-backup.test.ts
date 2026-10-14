import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { restoreFullSystemData, type FullSystemBackup } from "../server/systemBackup";
import { emptyInventory } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";

test("full-system inventory restore preserves identity IDs, JSON serials, sequences and merge safety", async () => {
  const schema = `inventory_backup_fixture_${randomUUID().replaceAll("-", "")}`;
  const client = await pool.connect();
  const tables = ["inventory_state", "inventory_items", "inventory_quantities", "inventory_movements"];
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    for (const table of tables) await client.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    await client.query(`SET search_path TO "${schema}"`);
    let state = emptyInventory();
    const post = (action: any, data: any) => {
      state = applyInventoryCommand(state, { action, data, operationId: randomUUID() }, "fixture", true).state;
    };
    post("warehouse", { id: "w", code: "W", name: "Warehouse", type: "physical", address: "Test address" });
    post("vendor", { id: "v", name: "Supplier" });
    post("item", { id: "m", sku: "M", name: "Meter", tracking: "serialized", equipment: "system" });
    post("order", { id: "po", type: "purchase", vendorId: "v", destinationId: "w", lines: [{ itemId: "m", quantity: 2 }] });
    post("release", { orderId: "po" });
    post("receive", { orderId: "po", lines: [{ itemId: "m", quantity: 2, serials: ["00001", "00002"] }] });
    await client.query("INSERT INTO inventory_state VALUES($1,$2)", [42, state]);
    await client.query("INSERT INTO inventory_items VALUES($1,$2,$3,$4)", [42, "m", "M", state.items[0]]);
    await client.query("INSERT INTO inventory_quantities VALUES($1,$2,$3,$4,$5,$6)", [42, "w", "m", 2, 0, JSON.stringify(["00001", "00002"])]);
    await client.query("INSERT INTO inventory_movements(id,project_id,operation_id,action,changes) OVERRIDING SYSTEM VALUE VALUES(500,42,$1,'receive',$2)",
      [randomUUID(), { stock: state.stock, entities: [] }]);
    const mainDatabase: Record<string, any[]> = {};
    for (const table of tables) mainDatabase[table] = (await client.query(`SELECT * FROM "${table}"`)).rows;
    const backup: FullSystemBackup = JSON.parse(JSON.stringify({ version: "1", backupDate: new Date().toISOString(), mainDatabase, projectDatabases: [] }));
    // Exercise the actual full-system restore without touching public/customer tables.
    // Its unqualified inserts resolve only to this isolated lookalike schema.
    const isolated = { connect: async () => ({
      query: (sql: string, values?: any[]) => client.query(sql.replace("schemaname = 'public'", `schemaname = '${schema}'`), values),
      release: () => {},
    }) } as any;
    const result = await restoreFullSystemData(backup, { clearExisting: true }, isolated);
    assert.deepEqual(result.errors, []);
    for (const table of tables) assert.equal(result.mainTablesRestored[table], mainDatabase[table].length);
    assert.deepEqual((await client.query("SELECT state FROM inventory_state")).rows[0].state, backup.mainDatabase.inventory_state[0].state);
    assert.deepEqual((await client.query("SELECT serials FROM inventory_quantities")).rows[0].serials, ["00001", "00002"]);
    assert.equal((await client.query("SELECT id FROM inventory_movements")).rows[0].id, "500");
    const next = await client.query("INSERT INTO inventory_movements(project_id,operation_id,action,changes) VALUES(42,$1,'test',$2) RETURNING id",
      [randomUUID(), { stock: [], entities: [] }]);
    assert.equal(next.rows[0].id, "501");
    assert.deepEqual((await restoreFullSystemData(backup, {}, isolated)).errors, []);
    assert.equal((await client.query("SELECT count(*) FROM inventory_movements")).rows[0].count, "2");
    const broken = structuredClone(backup);
    broken.mainDatabase.inventory_quantities[0].quantity = -1;
    await assert.rejects(restoreFullSystemData(broken, { clearExisting: true }, isolated), /Critical restore errors/);
    assert.equal((await client.query("SELECT count(*) FROM inventory_movements")).rows[0].count, "2");
  } finally {
    await client.query("ROLLBACK");
    await client.query("RESET search_path");
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
});
