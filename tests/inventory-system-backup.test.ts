import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { restoreFullSystem, restoreFullSystemData, type FullSystemBackup } from "../server/systemBackup";
import { emptyInventory } from "../shared/inventory";
import { blankShipmentCapture } from "../shared/inventory-shipment-draft-model";
import { applyInventoryCommand, completeInventoryWorkOrder } from "../shared/inventory-engine";
import { createProjectSchema } from "../server/projectDb";
import { initializeAudit } from "../server/auditMigration";
import { withAuditContext } from "../server/auditContext";
import { storedCategoryState } from "../server/inventoryCategories";
import { relationalTableNames, readRelationalInventory, writeRelationalInventory } from "../server/inventoryRelational";

test("full-system inventory restore preserves identity IDs, JSON serials, sequences and merge safety", async () => {
  await initializeAudit(pool);
  const actor = randomUUID();
  const scope = () => ({ actorId: actor, actorLabel: "Full restore fixture", actorKind: "user" as const, source: "restore-test", operationId: randomUUID() });
  const schema = `inventory_backup_fixture_${randomUUID().replaceAll("-", "")}`;
  const client = await pool.connect();
  const tables = [...new Set(["inventory_state", "inventory_categories", "inventory_items", "inventory_quantities", "inventory_movements", ...relationalTableNames])];
  const catalogs = ["service_types", "system_types", "module_types", "project_service_types", "system_type_projects", "module_type_projects"];
  const projectSchemas: string[] = [];
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    for (const table of tables) await client.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    await client.query(`CREATE TABLE "${schema}".projects (LIKE public.projects INCLUDING ALL)`);
    for (const table of catalogs) await client.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
    for (const [table, field, parent] of [
      ["project_service_types", "service_type_id", "service_types"],
      ["system_type_projects", "system_type_id", "system_types"],
      ["module_type_projects", "module_type_id", "module_types"],
    ]) {
      await client.query(`ALTER TABLE "${schema}"."${table}" ADD FOREIGN KEY(project_id) REFERENCES "${schema}".projects(id),
        ADD FOREIGN KEY("${field}") REFERENCES "${schema}"."${parent}"(id)`);
    }
    await client.query(`SET search_path TO "${schema}"`);
    let state = emptyInventory();
    const post = (action: any, data: any) => {
      state = applyInventoryCommand(state, { action, data, operationId: randomUUID() }, "fixture", true).state;
    };
    post("warehouse", { id: "w", code: "W", name: "Warehouse", type: "physical", address: "Test address" });
    post("vendor", { id: "v", name: "Supplier" });
    post("category", { name: "Meters" });
    const categoryId = state.categoryCatalog![0].id;
    post("item", { id: "m", sku: "M", name: "Meter", tracking: "serialized", equipment: "system", categoryId });
    post("order", { id: "po", type: "purchase", vendorId: "v", destinationId: "w", lines: [{ itemId: "m", quantity: 2 }] });
    post("release", { orderId: "po" });
    post("receive", { orderId: "po", lines: [{ itemId: "m", quantity: 2, serials: ["00001", "00002"] }] });
    post("countStart", { id: "unfinished", warehouseId: "w" });
    post("countSaveDraft", { id: "unfinished", revision: 0, reason: "Resume after full restore",
      rows: [{ itemId: "m", quantity: "", serials: "00001\npartial" }] });
    // Held units are physically present, but deliberately absent from the usable
    // stock mirror. Exercise real full-system AND project restore with these.
    post("order", { id: "damaged-shipment", type: "purchase", vendorId: "v", destinationId: "w",
      lines: [{ itemId: "m", quantity: 5 }] });
    post("release", { orderId: "damaged-shipment" });
    post("receive", { orderId: "damaged-shipment", lines: [], damaged: [{
      itemId: "m", quantity: 4, serials: ["QUARANTINE-0003", "QUARANTINE-0004"], unidentifiedQuantity: 2,
      reason: "Damaged carton with one unreadable label",
    }], closeRemainder: true, reason: "Supplier cannot fulfill last unit; keep inspection outstanding" });
    const holdId = state.shipmentHolds![0].id;
    post("resolveHold", { id: holdId, outcome: "released", quantity: 1, serials: ["QUARANTINE-0003"],
      verifiedSerials: ["QUARANTINE-0003"], reason: "One tested unit passed inspection" });
    post("resolveHold", { id: holdId, outcome: "returned", quantity: 1, unidentifiedQuantity: 1,
      reason: "One unreadable unit physically returned", reference: "RMA-restore" });
    for (const pending of [false, true]) {
      const orderId = pending ? "saved-pending" : "saved-partial", draftId = randomUUID();
      post("order", { id: orderId, type: "purchase", vendorId: "v", destinationId: "w", lines: [{ itemId: "m", quantity: 2 }] });
      post("release", { orderId });
      post("shipmentDraftSave", { id: draftId, revision: 0, orderId, stage: "receive", capture: {
        ...blankShipmentCapture(), entries: { m: { itemId: "m", goodQuantity: "1", damagedQuantity: "0",
          unreadableQuantity: "0", damageReason: "", goodSerials: ["RESTORE-0006"], damagedSerials: [], expectedSerials: [] } },
        scanBuffers: pending ? {} : { "m-goodSerials": "0000 unfinished " },
      } });
      if (pending) post("shipmentDraftPrepare", { id: draftId, revision: 1, postingId: randomUUID(),
        payload: { orderId, lines: [{ itemId: "m", quantity: 1, serials: ["RESTORE-0006"] }], damaged: [], reason: "" } });
    }
    post("item", { id: "kit-part", sku: "KIT-PART", name: "Kit component", tracking: "regular" });
    post("item", { id: "kit", sku: "KIT", name: "Kit", tracking: "regular", components: [{ itemId: "kit-part", quantity: 1 }] });
    post("order", { id: "kit-po", type: "purchase", vendorId: "v", destinationId: "w", lines: [{ itemId: "kit-part", quantity: 8 }] });
    post("release", { orderId: "kit-po" });
    post("receive", { orderId: "kit-po", lines: [{ itemId: "kit-part", quantity: 8 }] });
    post("assemble", { warehouseId: "w", itemId: "kit", quantity: 3, serials: [],
      components: [{ itemId: "kit-part", quantity: 3, serials: [] }] });
    const assemblyId = state.receipts.at(-1)!.id;
    post("disassemble", { warehouseId: "w", assemblyId, quantity: 3, serials: [], reason: "Breakdown fixture",
      components: [{ itemId: "kit-part", usableQuantity: 0, damagedQuantity: 3, missingQuantity: 0,
        usableSerials: [], damagedSerials: [], missingSerials: [], reason: "Damaged component" }] });
    const kitHoldId = state.kitHolds![0].id;
    post("resolveKitHold", { id: kitHoldId, quantity: 1, serials: [], outcome: "released", reason: "Passed inspection" });
    post("resolveKitHold", { id: kitHoldId, quantity: 1, serials: [], outcome: "scrapped", reason: "Failed inspection" });
    post("item", { id: "serial-part", sku: "SERIAL-PART", name: "Serialized kit component", tracking: "serialized" });
    post("item", { id: "serial-kit", sku: "SERIAL-KIT", name: "Serialized recovery kit", tracking: "serialized",
      components: [{ itemId: "serial-part", quantity: 5 }] });
    post("order", { id: "serial-kit-po", type: "purchase", vendorId: "v", destinationId: "w",
      lines: [{ itemId: "serial-part", quantity: 5 }] });
    post("release", { orderId: "serial-kit-po" });
    post("receive", { orderId: "serial-kit-po", lines: [{ itemId: "serial-part", quantity: 5, serials: ["S1", "S2", "S3", "S4", "S5"] }] });
    post("assemble", { warehouseId: "w", itemId: "serial-kit", quantity: 1, serials: ["SK1"],
      components: [{ itemId: "serial-part", quantity: 5, serials: ["S1", "S2", "S3", "S4", "S5"] }] });
    const serialAssemblyId = state.receipts.at(-1)!.id;
    post("disassemble", { warehouseId: "w", assemblyId: serialAssemblyId, quantity: 1, serials: ["SK1"],
      components: [{ itemId: "serial-part", usableQuantity: 0, usableSerials: [], damagedQuantity: 4,
        damagedSerials: ["S1", "S2", "S3", "S4"], missingQuantity: 1, missingSerials: ["S5"], reason: "Physical inspection fixture" }] });
    const serialHoldId = state.kitHolds!.find(h => h.itemId === "serial-part")!.id;
    post("resolveKitHold", { id: serialHoldId, quantity: 1, serials: ["S2"], outcome: "released", reason: "S2 passed" });
    post("resolveKitHold", { id: serialHoldId, quantity: 1, serials: ["S1"], outcome: "scrapped", reason: "S1 failed" });
    post("item", { id: "vendor-kit", sku: "VENDOR-KIT", name: "Purchased kit", tracking: "serialized",
      components: [{ itemId: "m", quantity: 1 }] });
    post("order", { id: "vendor-po", type: "purchase", vendorId: "v", destinationId: "w",
      lines: [{ itemId: "vendor-kit", quantity: 1 }] });
    post("release", { orderId: "vendor-po" });
    post("receive", { orderId: "vendor-po", lines: [{ itemId: "vendor-kit", quantity: 1, serials: ["VK1"] }] });
    const vendorReceive = state.receipts.at(-1)!.id;
    post("verifyVendorKit", { receiptId: vendorReceive, itemId: "vendor-kit", quantity: 1, serials: ["VK1"],
      components: [{ itemId: "m", quantity: 1, serials: ["VENDOR-METER"] }], reason: "Vendor physical inspection" });
    await client.query("INSERT INTO inventory_state VALUES($1,$2)", [42, state]);
    await client.query("INSERT INTO inventory_categories(project_id,id,name,active) VALUES($1,$2,$3,true)", [42, categoryId, "Meters"]);
    for (const item of state.items) await client.query("INSERT INTO inventory_items(project_id,id,sku,data,category_id) VALUES($1,$2,$3,$4,$5)", [42, item.id, item.sku, item, item.categoryId]);
    for (const b of state.stock) await client.query("INSERT INTO inventory_quantities VALUES($1,$2,$3,$4,$5,$6)", [42, b.warehouseId, b.itemId, b.quantity, 0, JSON.stringify(b.serials)]);
    await client.query("INSERT INTO inventory_movements(id,project_id,operation_id,action,changes) OVERRIDING SYSTEM VALUE VALUES(500,42,$1,'receive',$2)",
      [randomUUID(), { stock: state.stock, entities: [] }]);
    const mainDatabase: Record<string, any[]> = {};
    for (const table of tables) mainDatabase[table] = (await client.query(`SELECT * FROM "${table}"`)).rows;
    mainDatabase.projects = [{ id: 42, name: "Inventory backup fixture", database_name: null, inventory_enabled: false }];
    const backup: FullSystemBackup = JSON.parse(JSON.stringify({ version: "1", backupDate: new Date().toISOString(), mainDatabase, projectDatabases: [] }));
    // Exercise the actual full-system restore without touching public/customer tables.
    // Its unqualified inserts resolve only to this isolated lookalike schema.
    const isolated = { connect: async () => ({
      query: (sql: string, values?: any[]) => client.query(sql.replace("schemaname = 'public'", `schemaname = '${schema}'`)
        .replace(/table_schema\s*=\s*'public'/g, `table_schema='${schema}'`)
        .replace(/public\.(inventory_[a-z_]+|projects)\b/g, `"${schema}".$1`), values),
      release: () => {},
    }) } as any;
    const result = await restoreFullSystemData(backup, { clearExisting: true }, isolated);
    assert.deepEqual(result.errors, []);
    // The restore adapter adds typed warehouse relationships to older public dumps.
    for (const table of tables) assert.equal(result.mainTablesRestored[table], backup.mainDatabase[table].length);
    assert.deepEqual((await client.query("SELECT state FROM inventory_state")).rows[0].state, backup.mainDatabase.inventory_state[0].state);
    assert.deepEqual((await client.query("SELECT serials FROM inventory_quantities")).rows[0].serials, ["00001", "00002", "QUARANTINE-0003"]);
    assert.equal((await client.query("SELECT id FROM inventory_movements")).rows[0].id, "500");
    const next = await client.query("INSERT INTO inventory_movements(project_id,operation_id,action,changes) VALUES(42,$1,'test',$2) RETURNING id",
      [randomUUID(), { stock: [], entities: [] }]);
    assert.equal(next.rows[0].id, "501");
    await assert.rejects(restoreFullSystemData(backup, {}, isolated), /explicit replacement/);
    assert.equal((await client.query("SELECT count(*) FROM inventory_movements")).rows[0].count, "2");
    const broken = structuredClone(backup);
    broken.mainDatabase.inventory_quantities[0].quantity = -1;
    await assert.rejects(restoreFullSystemData(broken, { clearExisting: true }, isolated), /Critical restore errors/);
    assert.equal((await client.query("SELECT count(*) FROM inventory_movements")).rows[0].count, "2");

    // The real project restore shares this same isolated public-data transaction.
    // Rewrite every explicit public business-table reference, never audit references.
    const transactional = { connect: async () => ({
      query: (sql: string, values?: any[]) => client.query(
        sql.replace("schemaname = 'public'", `schemaname = '${schema}'`)
          .replace(/table_schema\s*=\s*'public'/g, `table_schema='${schema}'`)
          .replace(/public\.(projects|inventory_[a-z_]+|service_types|system_types|module_types|project_service_types|system_type_projects|module_type_projects)\b/g, `"${schema}".$1`), values),
      release: () => {},
    }) } as any;
    const workSchema = await createProjectSchema(`Full backup ${schema}`, 42);
    projectSchemas.push(workSchema);
    post("assign", { workOrderId: 2, lines: [{ itemId: "m", warehouseId: "w", quantity: 1, serials: ["00001"] }] });
    post("prepareUse", { workOrderId: 2, revision: 1, mode: "changeout", used: [{ itemId: "m", warehouseId: "w", quantity: 1, serials: ["00001"] }], dispositions: [] });
    state = completeInventoryWorkOrder(state, 2, false);
    state = JSON.parse(JSON.stringify(state));
    const full = structuredClone(backup);
    full.mainDatabase.projects = [{ id: 42, name: "Fresh full-system fixture", database_name: workSchema, inventory_enabled: true }];
    full.mainDatabase.inventory_state[0].state = state;
    full.mainDatabase.inventory_quantities[0] = { ...full.mainDatabase.inventory_quantities[0], quantity: 2, serials: ["00002", "QUARANTINE-0003"] };
    const service = `svc_${actor.slice(0, 8)}`, systemType = `sys_${actor}`, moduleType = `mod_${actor}`;
    full.mainDatabase.service_types = [{ id: 601, code: service, label: "Source-only service" }];
    full.mainDatabase.system_types = [{ id: 602, product_id: systemType, product_label: "Source-only meter" }];
    full.mainDatabase.module_types = [{ id: 603, product_id: moduleType, product_label: "Source-only module" }];
    full.mainDatabase.project_service_types = [{ id: 604, project_id: 42, service_type_id: 601 }];
    full.mainDatabase.system_type_projects = [{ id: 605, project_id: 42, system_type_id: 602 }];
    full.mainDatabase.module_type_projects = [{ id: 606, project_id: 42, module_type_id: 603 }];
    full.projectDatabases = [{
      projectId: 42, projectName: "Fresh full-system fixture", schemaName: workSchema,
      workOrders: [{ id: 2, status: "Completed", customerWoId: "posted", newSystemId: "00001",
        serviceType: service, oldSystemType: systemType, newSystemType: systemType, oldModuleType: moduleType, newModuleType: moduleType }, { id: 3, customerWoId: "open" }],
      inventory: { enabled: true, state, movements: full.mainDatabase.inventory_movements },
    }];
    for (const table of catalogs) assert.equal((await client.query(`SELECT count(*) FROM "${table}"`)).rows[0].count, "0", "source configuration is absent from fresh destination");
    const legacyMissingLookups = structuredClone(full);
    for (const table of catalogs) delete legacyMissingLookups.mainDatabase[table];
    await assert.rejects(restoreFullSystemData(legacyMissingLookups, { clearExisting: true }, transactional), /Missing service_types configuration/);
    const numberingYear = String(new Date().getUTCFullYear());
    const advancedCounters = { ...state.orderNumberCounters, [numberingYear]: (state.orderNumberCounters?.[numberingYear] || 0) + 20 };
    const localClient = await transactional.connect();
    const localState = await readRelationalInventory(localClient, 42);
    await writeRelationalInventory(localClient, 42, { ...localState, orderNumberCounters: advancedCounters });
    const restoredFull = await withAuditContext(scope(), () => restoreFullSystem(full, { clearExisting: true }, transactional));
    assert.equal(restoredFull.success, true);
    assert.equal(restoredFull.databaseCommitted, true);
    assert.equal(restoredFull.projectsRestored, 1);
    const { rows: [typedOrder] } = await client.query(`SELECT service_type,old_system_type,new_system_type,old_module_type,new_module_type FROM "${workSchema}".work_orders WHERE id=2`);
    assert.deepEqual(typedOrder, { service_type: service, old_system_type: systemType, new_system_type: systemType, old_module_type: moduleType, new_module_type: moduleType });
    for (const table of catalogs) assert.equal((await client.query(`SELECT count(*) FROM "${table}"`)).rows[0].count, "1", "catalog and project relationships are restored");
    const { rows: priorAudit } = await pool.query("SELECT id,outcome,actor_id FROM meterflo_audit.events WHERE actor_id=$1 AND entity_type='systemRestore'", [actor]);
    assert.ok(priorAudit.some(e => e.outcome === "started"));
    assert.ok(priorAudit.some(e => e.outcome === "success"), "authenticated identity is retained even though it is absent from the snapshot");
    assert.deepEqual((await client.query(`SELECT id FROM "${workSchema}".work_orders ORDER BY id`)).rows.map(r => r.id), [2, 3]);
    assert.deepEqual((await client.query("SELECT state FROM inventory_state WHERE project_id=42")).rows[0].state, storedCategoryState({ ...state, orderNumberCounters: advancedCounters }));
    assert.equal((await client.query("SELECT category_id FROM inventory_items WHERE project_id=42 AND id='m'")).rows[0].category_id, categoryId);
    assert.equal((await client.query("SELECT name FROM inventory_categories WHERE project_id=42 AND id=$1", [categoryId])).rows[0].name, "Meters");
    assert.deepEqual((await readRelationalInventory(await transactional.connect(), 42)).stock[0].serials, ["00002", "QUARANTINE-0003"]);
    assert.equal((await client.query(`INSERT INTO "${workSchema}".work_orders(customer_wo_id,created_by) VALUES('after-full',NULL) RETURNING id`)).rows[0].id, 4);
    const savedRows = (await client.query(`SELECT * FROM "${workSchema}".work_orders ORDER BY id`)).rows;
    const savedInventory: Record<string, any[]> = {};
    for (const table of tables) savedInventory[table] = (await client.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows;

    // Fail a later project after the first project's work orders and inventory
    // have already been replaced. Neither public data nor project data may commit.
    const laterSchema = await createProjectSchema(`Later backup ${schema}`, 43);
    projectSchemas.push(laterSchema);
    const incomplete = structuredClone(full);
    incomplete.mainDatabase.projects.push({ id: 43, name: "Later fixture", database_name: laterSchema, inventory_enabled: false });
    incomplete.projectDatabases.push({ projectId: 43, projectName: "Later fixture", schemaName: laterSchema,
      workOrders: [{ customerWoId: "duplicate" }, { customerWoId: "duplicate" }] });
    await assert.rejects(withAuditContext(scope(), () => restoreFullSystem(incomplete, { clearExisting: true }, transactional)), /Later fixture/);
    const { rows: afterAudit } = await pool.query("SELECT id,outcome FROM meterflo_audit.events WHERE actor_id=$1 AND entity_type='systemRestore'", [actor]);
    assert.ok(priorAudit.every(e => afterAudit.some(a => a.id === e.id)), "newer local history survives failed restore");
    assert.ok(afterAudit.some(e => e.outcome === "failed"), "rolled-back restore has a failed terminal outcome");
    assert.deepEqual((await client.query(`SELECT * FROM "${workSchema}".work_orders ORDER BY id`)).rows, savedRows);
    assert.equal((await client.query(`SELECT count(*) FROM "${laterSchema}".work_orders`)).rows[0].count, "0");
    for (const table of tables) assert.deepEqual((await client.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows, savedInventory[table]);
    assert.equal((await client.query("SELECT count(*) FROM projects")).rows[0].count, "1");

    const missingProject = structuredClone(full);
    missingProject.projectDatabases = [];
    await assert.rejects(restoreFullSystemData(missingProject, { clearExisting: true }, transactional), /work-order snapshot is missing/);
    const invalidLink = structuredClone(full);
    invalidLink.projectDatabases[0].inventory!.state.allocations[0].workOrderId = 999;
    await assert.rejects(restoreFullSystemData(invalidLink, { clearExisting: true }, transactional), /missing work order/);
    await assert.rejects(restoreFullSystemData(full, {}, transactional), /explicit replacement/);
    assert.deepEqual((await client.query(`SELECT * FROM "${workSchema}".work_orders ORDER BY id`)).rows, savedRows);
    for (const table of tables) assert.deepEqual((await client.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows, savedInventory[table]);

    const fresh = structuredClone(full);
    const freshSchema = `project_fresh_full_${randomUUID().replaceAll("-", "")}_44`;
    projectSchemas.push(freshSchema);
    fresh.mainDatabase.projects = [{ id: 44, name: "New server fixture", database_name: freshSchema, inventory_enabled: true }];
    for (const table of tables) fresh.mainDatabase[table] = fresh.mainDatabase[table].map(row => ({ ...row, project_id: 44 }));
    for (const table of ["project_service_types", "system_type_projects", "module_type_projects"]) fresh.mainDatabase[table] = fresh.mainDatabase[table].map(row => ({ ...row, project_id: 44 }));
    fresh.projectDatabases[0] = { ...fresh.projectDatabases[0], projectId: 44, schemaName: freshSchema };
    assert.equal((await client.query("SELECT to_regclass($1) AS table_name", [`"${freshSchema}".work_orders`])).rows[0].table_name, null);
    assert.equal((await restoreFullSystemData(fresh, { clearExisting: true }, transactional)).success, true, "missing destination schemas are prepared on fresh servers");
    assert.deepEqual((await client.query(`SELECT id FROM "${freshSchema}".work_orders ORDER BY id`)).rows.map(r => r.id), [2, 3]);
    assert.equal((await client.query(`INSERT INTO "${freshSchema}".work_orders(customer_wo_id,created_by) VALUES('fresh-next',NULL) RETURNING id`)).rows[0].id, 4);
    const savedCatalogs: Record<string, any[]> = {};
    for (const table of ["service_types", "system_types", "module_types"]) savedCatalogs[table] = (await client.query(`SELECT * FROM "${table}"`)).rows;
    assert.equal((await restoreFullSystemData(legacyMissingLookups, { clearExisting: true }, transactional)).success, true,
      "older archives work only once their lookup prerequisites are installed");
    for (const table of ["service_types", "system_types", "module_types"]) assert.deepEqual((await client.query(`SELECT * FROM "${table}"`)).rows, savedCatalogs[table], "omitted catalogs are retained");
  } finally {
    await client.query("ROLLBACK");
    await client.query("RESET search_path");
    for (const projectSchema of projectSchemas) await client.query(`DROP SCHEMA IF EXISTS "${projectSchema}" CASCADE`);
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    client.release();
    await pool.end();
  }
});
