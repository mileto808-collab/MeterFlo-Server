import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { createProjectSchema } from "../server/projectDb";
import { getProjectDirectoryName } from "../server/fileStorage";
import { enableAuditing } from "../server/auditContext";
import { saveInventory } from "../server/inventoryService";
import { writeRelationalInventory } from "../server/inventoryRelational";
import { emptyInventory, itemSchema, warehouseSchema, vendorSchema } from "../shared/inventory";
import { normalizeInventoryLocations } from "../shared/inventory-location-types";
import { deleteProjectCompletely, pendingProjectFileCleanups, retryProjectFileCleanup, ProjectDeletionCleanupPending } from "../server/projectDeletion";
import type { Pool } from "pg";

enableAuditing();
const root = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-project-deletion-"));
const owned = new Set<number>();
async function fixture(inventory: boolean | null = true) {
  const project = await storage.createProjectWithFullData({
    name: `Deletion regression ${randomUUID()}`, inventoryEnabled: inventory ?? false,
  });
  owned.add(project.id);
  const schema = await createProjectSchema(project.name, project.id);
  await storage.updateProjectDatabaseName(project.id, schema);
  await pool.query(`INSERT INTO "${schema}".work_orders(status,customer_wo_id,created_by) VALUES('Scheduled',$1,NULL)`, [`DELETE-${project.id}`]);
  await pool.query("INSERT INTO public.project_holidays(project_id,name,date) VALUES($1,'Fixture holiday','2026-12-25')", [project.id]);
  if (inventory !== null) {
    const before = emptyInventory(), after = normalizeInventoryLocations({ ...emptyInventory(), locationTypes: undefined }), category = randomUUID();
    after.categoryCatalog = [{ id: category, name: "Fixture category" }];
    after.items = [
      itemSchema.parse({ id: "meter", sku: "DEL-METER", name: "Fixture meter", tracking: "serialized", categoryId: category }),
      itemSchema.parse({ id: "kit", sku: "DEL-KIT", name: "Fixture kit", tracking: "regular", components: [{ itemId: "meter", quantity: 1 }] }),
    ];
    after.warehouses = [warehouseSchema.parse({ id: "warehouse", code: "DELETE", name: "Fixture warehouse",
      type: "physical", address: "100 Fixture Way", city: "Fixture City" })];
    after.vendors = [vendorSchema.parse({ id: "vendor", name: "Fixture vendor" })];
    after.stock = [{ warehouseId: "warehouse", itemId: "meter", quantity: 1, serials: ["DELETE-SERIAL"], revision: 1 }];
    after.orders = [{ id: "order", type: "purchase", vendorId: "vendor", sourceId: null,
      destinationId: "warehouse", status: "completed", lines: [{ itemId: "meter", quantity: 1, serials: [] }],
      received: [{ itemId: "meter", quantity: 1, serials: ["DELETE-SERIAL"] }], dispatched: [], notes: "", createdAt: new Date().toISOString() }];
    after.receipts = [{ id: "receipt", action: "receive", reference: "order", warehouseId: "warehouse",
      lines: [{ itemId: "meter", quantity: 1, serials: ["DELETE-SERIAL"] }],
      actor: "project-deletion-fixture", occurredAt: new Date().toISOString(), reason: "Fixture receipt" }];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2)", [project.id, JSON.stringify(before)]);
      // saveInventory writes a delta against an already-persisted baseline;
      // inserting only the legacy JSON root does not persist default catalogs.
      await writeRelationalInventory(client, project.id, before);
      await saveInventory(client, project.id, before, after, randomUUID(), "fixture");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  const directory = path.join(root, getProjectDirectoryName(project.name, project.id));
  await fs.mkdir(path.join(directory, "nested"), { recursive: true });
  await fs.writeFile(path.join(directory, "nested", "evidence.txt"), "project-owned evidence");
  const inventoryDirectory = path.join(root, `inventory-${project.id}`);
  await fs.mkdir(inventoryDirectory);
  await fs.writeFile(path.join(inventoryDirectory, "inspection.jpg"), "fixture photo evidence");
  return { ...project, schema, directory, inventoryDirectory };
}
async function assertGone(project: Awaited<ReturnType<typeof fixture>>) {
  assert.equal(await storage.getProject(project.id), undefined);
  assert.equal((await pool.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [project.schema])).rowCount, 0);
  const tables = await pool.query(`SELECT table_name FROM information_schema.columns
    WHERE table_schema='public' AND column_name='project_id'`);
  for (const { table_name: table } of tables.rows) {
    assert.match(table, /^[a-z0-9_]+$/);
    assert.equal((await pool.query(`SELECT 1 FROM public."${table}" WHERE project_id=$1 LIMIT 1`, [project.id])).rowCount, 0, table);
  }
  assert.equal((await pool.query("SELECT 1 FROM meterflo_audit.project_scopes WHERE project_id=$1", [project.id])).rowCount, 0);
  assert.ok((await pool.query("SELECT 1 FROM meterflo_audit.events WHERE project_id=$1 AND entity_type='projects' AND action='deleted' LIMIT 1",
    [project.id])).rowCount, "Security evidence of project deletion remains");
  await assert.rejects(fs.stat(project.directory), { code: "ENOENT" });
  await assert.rejects(fs.stat(project.inventoryDirectory), { code: "ENOENT" });
}
function failCommit(afterCommit: boolean): Pick<Pool, "connect"> {
  let fail = true;
  return { connect: (async () => {
    const client = await pool.connect();
    return {
      query: async (sql: string, values?: unknown[]) => {
        if (sql === "COMMIT" && fail) {
          fail = false;
          await client.query(afterCommit ? "COMMIT" : "ROLLBACK");
          throw new Error("Injected commit transport failure");
        }
        return client.query(sql, values);
      },
      release: (error?: boolean) => client.release(error),
    };
  }) as Pool["connect"] };
}

try {
  const untouched = await fixture(false);
  for (const enabled of [true, false, null]) {
    await test(`complete deletion with ${enabled === null ? "no inventory" : enabled ? "enabled inventory" : "disabled inventory and posted history"}`, async () => {
      const project = await fixture(enabled);
      assert.equal(await deleteProjectCompletely(project.id, root), true);
      await assertGone(project);
      assert.ok(await storage.getProject(untouched.id), "Other projects are not deleted");
      assert.equal((await pool.query(`SELECT count(*)::int n FROM "${untouched.schema}".work_orders`)).rows[0].n, 1);
    });
  }
  await test("SQL commit failure restores schema, inventory, project and staged files", async () => {
    const project = await fixture();
    await assert.rejects(deleteProjectCompletely(project.id, root, { database: failCommit(false) }), /Injected commit/);
    assert.ok(await storage.getProject(project.id));
    assert.equal((await pool.query(`SELECT count(*)::int n FROM "${project.schema}".work_orders`)).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*)::int n FROM public.inventory_stock_serials WHERE project_id=$1", [project.id])).rows[0].n, 1);
    assert.equal(await fs.readFile(path.join(project.directory, "nested", "evidence.txt"), "utf8"), "project-owned evidence");
    assert.equal(await fs.readFile(path.join(project.inventoryDirectory, "inspection.jpg"), "utf8"), "fixture photo evidence");
    assert.equal((await pendingProjectFileCleanups(root)).filter(row => row.projectId === project.id).length, 0);
  });
  await test("unknown COMMIT outcome checks actual state and completes committed deletion", async () => {
    const project = await fixture();
    assert.equal(await deleteProjectCompletely(project.id, root, { database: failCommit(true) }), true);
    await assertGone(project);
  });
  await test("a lock on the second file directory restores the first directory and all database records", async () => {
    const project = await fixture();
    let renames = 0;
    await assert.rejects(deleteProjectCompletely(project.id, root, {
      files: { ...fs, rename: async (from, to) => {
        if (++renames === 2) throw new Error("Injected inventory photo folder lock");
        await fs.rename(from, to);
      } },
    }), /Injected inventory photo folder lock/);
    assert.ok(await storage.getProject(project.id));
    assert.equal((await pool.query(`SELECT count(*)::int n FROM "${project.schema}".work_orders`)).rows[0].n, 1);
    assert.equal(await fs.readFile(path.join(project.directory, "nested", "evidence.txt"), "utf8"), "project-owned evidence");
    assert.equal(await fs.readFile(path.join(project.inventoryDirectory, "inspection.jpg"), "utf8"), "fixture photo evidence");
  });
  await test("locked file leaves a durable, visible retry; no false complete response", async () => {
    const project = await fixture();
    await assert.rejects(deleteProjectCompletely(project.id, root, {
      files: { ...fs, rm: async () => { throw new Error("Injected Windows file lock"); } },
    }), ProjectDeletionCleanupPending);
    await assertGone(project);
    const pending = (await pendingProjectFileCleanups(root)).find(row => row.projectId === project.id)!;
    assert.ok(pending && !pending.restore);
    assert.deepEqual(Object.keys(pending).sort(), ["key", "projectId", "projectName", "restore"], "Never expose private paths");
    assert.equal(await retryProjectFileCleanup(pending.key), true);
    assert.equal(await retryProjectFileCleanup(pending.key), false, "Retry is idempotent");
    assert.equal((await pendingProjectFileCleanups(root)).filter(row => row.projectId === project.id).length, 0);
  });
  await test("interrupted pre-commit file move is recovered from its journal", async () => {
    const project = await fixture(), token = `${project.id}-${randomUUID()}`;
    const directory = path.join(root, ".meterflo-project-deletions", token);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify({
      projectId: project.id, projectName: project.name, root, token,
    }));
    await fs.rename(project.directory, path.join(directory, "files"));
    await pendingProjectFileCleanups(root);
    assert.equal(await fs.readFile(path.join(project.directory, "nested", "evidence.txt"), "utf8"), "project-owned evidence");
    assert.ok(await storage.getProject(project.id));
  });
  await test("invalid IDs and unsafe/shared schemas cannot delete a different scope", async () => {
    await assert.rejects(deleteProjectCompletely(NaN, root), /Invalid project ID/);
    const project = await fixture(null);
    await storage.updateProjectDatabaseName(project.id, "public");
    await assert.rejects(deleteProjectCompletely(project.id, root), /Unsafe project schema/);
    await storage.updateProjectDatabaseName(project.id, untouched.schema);
    await assert.rejects(deleteProjectCompletely(project.id, root), /schema is shared/);
    await storage.updateProjectDatabaseName(project.id, project.schema);
    assert.ok(await storage.getProject(project.id));
    assert.ok(await storage.getProject(untouched.id));
  });
} finally {
  for (const id of owned) if (await storage.getProject(id)) await deleteProjectCompletely(id, root);
  for (const pending of (await pendingProjectFileCleanups(root)).filter(row => owned.has(row.projectId)))
    await retryProjectFileCleanup(pending.key);
  await fs.rm(root, { recursive: true, force: true });
  await pool.end();
}
