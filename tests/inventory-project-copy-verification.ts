import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { inventoryState, postInventory } from "../server/inventoryService";
import { cleanInventoryCatalog } from "../server/inventoryProjectCopy";
import { writeRelationalInventory, relationalTableNames } from "../server/inventoryRelational";
import { enableAuditing } from "../server/auditContext";
import { initializeAudit } from "../server/auditMigration";
import { itemSchema, vendorSchema, warehouseSchema } from "../shared/inventory";
import { defaultLocationTypeId } from "../shared/inventory-location-types";

assert.ok(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "Never run on a real database.");
const config = JSON.parse(await fs.readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG!, "utf8"));
assert.equal(config.ownedWorkspaceSandbox, true);
const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
await initializeAudit(pool); enableAuditing();
const sourceId = fixture.projectId;
const original = await inventoryState(sourceId);
const category = randomUUID(), inactiveCategory = randomUUID(), vendor = randomUUID(), component = randomUUID(), kit = randomUUID(), customType = randomUUID();
const state = structuredClone(original);
state.categoryCatalog = [{ id: category, name: "Copy test meters", active: true }, { id: inactiveCategory, name: "Retired definition", active: false }];
state.vendors.push(vendorSchema.parse({ id: vendor, name: "Copy supplier", email: "supplier@example.invalid" }));
state.items.push(itemSchema.parse({ id: component, sku: "COPY-COMP", name: "Serialized meter", tracking: "serialized",
  categoryId: category, category: "Copy test meters", vendorId: vendor, cost: 17.5, billingRate: 32, reorderPoint: 5,
  images: ["https://example.invalid/catalog/meter.jpg"] }));
state.items.push(itemSchema.parse({ id: kit, sku: "COPY-KIT", name: "Meter recipe", tracking: "regular",
  components: [{ itemId: component, quantity: 1 }], categoryId: inactiveCategory, category: "Retired definition", vendorId: vendor }));
state.locationTypes!.push({ id: customType, name: "Copy custom location", kind: "physical", accessPolicy: "shared", revision: 4 });
state.warehouses.push(warehouseSchema.parse({ id: randomUUID(), code: "CUSTOM", name: "Custom staging area", type: "physical",
  locationTypeId: customType, address: "Owned fixture address" }));
const actor = (await pool.query("SELECT id FROM public.users WHERE username=$1", [fixture.username])).rows[0].id;
state.warehouses[0].assignedUserId = actor; state.warehouses[0].userIds = [actor];
state.stock.push({ warehouseId: state.warehouses[0].id, itemId: component, quantity: 2, revision: 1, serials: ["COPY-SERIAL-1", "COPY-SERIAL-2"] });
state.revision = 7;
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT project_id FROM public.inventory_state WHERE project_id=$1 FOR UPDATE", [sourceId]);
  await writeRelationalInventory(client, sourceId, state);
  await client.query("COMMIT");
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); }
const command = (action: string, data: any) => postInventory(sourceId, { operationId: randomUUID(), action, data } as any, actor, true);
await command("order", { id: randomUUID(), type: "purchase", vendorId: vendor, destinationId: state.warehouses[0].id,
  lines: [{ itemId: component, quantity: 1 }] });
const source = await inventoryState(sourceId);
assert.ok(source.stock.length && source.orders.length);

// Seed every optional workflow collection in memory to prove the whitelist cannot
// accidentally retain future/historical operational data.
const dirty = structuredClone(source) as any;
for (const field of ["receipts", "returns", "counts", "allocations", "shipmentHolds", "shipmentDrafts", "kitAssemblies", "kitHolds",
  "serialOccupancy", "fulfillmentBatches", "stockDiscrepancies", "workPlans", "typeLinks", "removalRules", "customerHandoffs"])
  dirty[field] = [{ sourceOnly: true }];
dirty.operations = { sourceReplay: "source receipt" }; dirty.orderNumberCounters = { purchase: 99 };
const clean = cleanInventoryCatalog(dirty);
assert.equal(clean.revision, 0);
assert.deepEqual(clean.operations, {});
for (const [field, value] of Object.entries(clean))
  if (Array.isArray(value) && !["warehouses", "vendors", "categories", "categoryCatalog", "items", "locationTypes"].includes(field))
    assert.deepEqual(value, [], field);
assert.equal(clean.orderNumberCounters, undefined);
assert.deepEqual(source, await inventoryState(sourceId), "Pure copying does not change the source");
const broken = structuredClone(source);
broken.items[0].vendorId = "missing-vendor";
assert.throws(() => cleanInventoryCatalog(broken), /reference is missing/);

const login = await fetch(config.baseURL + "/api/auth/local/login", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fixture) });
assert.equal(login.status, 200);
const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
const copy = () => fetch(`${config.baseURL}/api/projects/${sourceId}/copy`, { method: "POST", headers: { Cookie: cookie } });
try {
  const response = await copy(), project = await response.json();
  assert.equal(response.status, 201, project.message);
  assert.equal(project.inventoryEnabled, true);
  const copied = await inventoryState(project.id);
  assert.equal(copied.items.length, source.items.length);
  assert.equal(copied.vendors.length, source.vendors.length);
  assert.equal(copied.categoryCatalog!.length, source.categoryCatalog!.length);
  assert.equal(copied.warehouses.length, source.warehouses.length);
  assert.equal(copied.revision, 0);
  const copiedComponent = copied.items.find(item => item.sku === "COPY-COMP")!;
  const copiedKit = copied.items.find(item => item.sku === "COPY-KIT")!;
  assert.notEqual(copiedComponent.id, component);
  assert.equal(copiedComponent.cost, 17.5); assert.equal(copiedComponent.billingRate, 32);
  assert.deepEqual(copiedComponent.images, ["https://example.invalid/catalog/meter.jpg"]);
  assert.equal(copiedKit.components[0].itemId, copiedComponent.id);
  assert.equal(copiedComponent.vendorId, copied.vendors[0].id);
  assert.equal(copied.categoryCatalog!.find(row => row.id === copiedKit.categoryId)!.active, false);
  assert.equal(copied.locationTypes!.find(type => type.id === copied.warehouses.find(location => location.code === "CUSTOM")!.locationTypeId)!.name, "Copy custom location");
  assert.ok(copied.locationTypes!.some(type => type.id === defaultLocationTypeId("physical")));
  for (const location of copied.warehouses) { assert.deepEqual(location.userIds, []); assert.equal(location.assignedUserId, null); }
  const retained = new Set(["inventory_relational_projects", "inventory_warehouses", "inventory_location_types", "inventory_categories", "inventory_vendors",
    "inventory_items", "inventory_items_values", "inventory_kit_recipe_lines"]);
  const unexpected = [];
  for (const table of relationalTableNames.filter(table => !retained.has(table))) {
    const count = Number((await pool.query(`SELECT count(*) FROM public.${table} WHERE project_id=$1`, [project.id])).rows[0].count);
    if (count) unexpected.push({ table, count });
  }
  assert.deepEqual(unexpected, [], "Only the inventory catalog and its storage metadata may have rows");
  assert.equal(Number((await pool.query("SELECT count(*) FROM public.inventory_movements WHERE project_id=$1", [project.id])).rows[0].count), 0);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM "${project.databaseName}".work_orders`)).rows[0].count), 0);
  assert.deepEqual(await inventoryState(sourceId), source, "HTTP copy leaves source catalog, stock and orders untouched");
  const audit = (await pool.query("SELECT actor_id FROM meterflo_audit.events WHERE project_id=$1 AND action='inventory.catalogCopied'", [project.id])).rows[0];
  assert.equal(audit.actor_id, actor);
  // Force a mid-copy write failure. The route must remove only its incomplete copy.
  const before = Number((await pool.query("SELECT count(*) FROM public.projects")).rows[0].count);
  await pool.query(`CREATE FUNCTION public.test_inventory_copy_failure() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.project_id <> ${Number(sourceId)} THEN RAISE EXCEPTION 'Synthetic inventory-copy failure'; END IF; RETURN NEW; END $$`);
  await pool.query("CREATE TRIGGER test_inventory_copy_failure BEFORE INSERT ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.test_inventory_copy_failure()");
  const failed = await copy();
  assert.equal(failed.status, 500);
  assert.equal(Number((await pool.query("SELECT count(*) FROM public.projects")).rows[0].count), before);
  await pool.query("DROP TRIGGER test_inventory_copy_failure ON public.inventory_items");
  await pool.query("DROP FUNCTION public.test_inventory_copy_failure()");
  await pool.query("UPDATE public.projects SET inventory_enabled=false WHERE id=$1", [sourceId]);
  const disabledResponse = await copy(), disabled = await disabledResponse.json();
  assert.equal(disabledResponse.status, 201, disabled.message);
  assert.equal(disabled.inventoryEnabled, false);
  assert.equal((await inventoryState(disabled.id)).items.length, 0);
  const viewerLogin = await fetch(config.baseURL + "/api/auth/local/login", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fixture.viewer) });
  const viewerCookie = viewerLogin.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.equal((await fetch(`${config.baseURL}/api/projects/${sourceId}/copy`, { method: "POST", headers: { Cookie: viewerCookie } })).status, 403);
  console.log("PASS: Clean inventory HTTP project copy, definitions and recipes, fresh identities, cleared assignments, zero operational rows, unchanged source, rollback cleanup, disabled project and permission boundaries.");
} finally { await pool.end(); }
