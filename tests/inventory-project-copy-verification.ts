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
import { projectCopyPolicy } from "../server/projectCopy";
import { initializeAllProjectTroubleCodes } from "../server/projectTroubleCodes";
import { validateInventoryBackup } from "../server/inventoryBackup";

assert.ok(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "Never run on a real database.");
const config = JSON.parse(await fs.readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG!, "utf8"));
assert.equal(config.ownedWorkspaceSandbox, true);
const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
await initializeAudit(pool); enableAuditing();
const sourceId = fixture.projectId;
const original = await inventoryState(sourceId);
const category = randomUUID(), inactiveCategory = randomUUID(), vendor = randomUUID(), component = randomUUID(), kit = randomUUID(), customType = randomUUID();
const state = structuredClone(original);
const systemType = (await pool.query(`INSERT INTO public.system_types(product_id,product_label)
  VALUES($1,'Copy equipment type') RETURNING id`, [`COPY-${randomUUID()}`])).rows[0].id;
const moduleType = (await pool.query(`INSERT INTO public.module_types(product_id,product_label)
  VALUES($1,'Copy module type') RETURNING id`, [`COPY-${randomUUID()}`])).rows[0].id;
const serviceType = (await pool.query(`INSERT INTO public.service_types(code,label)
  VALUES($1,'Copy service') RETURNING id`, [`COPY-${randomUUID().slice(0,8)}`])).rows[0].id;
await pool.query(`INSERT INTO public.project_service_types(project_id,service_type_id) VALUES($1,$2)`, [sourceId,serviceType]);
await pool.query(`INSERT INTO public.system_type_projects(project_id,system_type_id) VALUES($1,$2)`, [sourceId,systemType]);
await pool.query(`INSERT INTO public.module_type_projects(project_id,module_type_id) VALUES($1,$2)`, [sourceId,moduleType]);
await pool.query(`INSERT INTO public.project_holidays(project_id,date,name) VALUES($1,'2027-01-01','Copy holiday')`, [sourceId]);
const parentStatus = (await pool.query("SELECT id FROM public.work_order_statuses ORDER BY id LIMIT 1")).rows[0].id;
await pool.query(`INSERT INTO public.work_order_sub_statuses(id,parent_status_id,project_id,code,label,routing_priority)
  VALUES($1,$2,$3,'COPY-SUB','Copy sub-status',7)`, [randomUUID(),parentStatus,sourceId]);
await pool.query(`INSERT INTO public.trouble_codes(project_id,code,label) VALUES($1,'COPY-ISSUE','Copy trouble code')`, [sourceId]);
await pool.query(`INSERT INTO public.work_order_closing_policy(project_id,enabled,after_hours) VALUES($1,true,23)`, [sourceId]);
await pool.query(`UPDATE public.projects SET timezone='Pacific/Honolulu',system_reading_decimal_places=0,
  module_reading_decimal_places=6,changeout_equipment_type='system',reading_equipment_type='module',
  search_show_manual_entry=false,search_show_hid_scanner=false,default_service_minutes=45,
  default_appointment_tolerance_minutes=15,customer_api_enabled=true,webhook_enabled=true,
  routing_configuration='{"mode":"inherit","provider":"geoapify","serverKeyEnv":"","browserKeyEnv":"","maxStops":12,"dailyPlans":50}'
  WHERE id=$1`, [sourceId]);
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
await pool.query("INSERT INTO public.user_projects(user_id,project_id) VALUES($1,$2)", [actor,sourceId]);
const group = (await pool.query("INSERT INTO public.user_groups(name) VALUES($1) RETURNING id", [`Copy group ${randomUUID()}`])).rows[0].id;
await pool.query("INSERT INTO public.user_group_projects(group_id,project_id) VALUES($1,$2)", [group,sourceId]);
await pool.query("INSERT INTO public.user_group_members(group_id,user_id) VALUES($1,$2)", [group,actor]);
const ruleId = randomUUID();
state.typeLinks = [{ id: `system-${systemType}`, equipment: "system", typeId: systemType, itemId: component,
  systemTypeId: systemType, moduleTypeId: null },
  { id: `module-${moduleType}`, equipment: "module", typeId: moduleType, itemId: component, systemTypeId: null, moduleTypeId: moduleType }];
state.fieldSettings = [{ id: "field-defaults", sourceMode: "project_warehouse", warehouseId: state.warehouses[0].id, fulfillment: "kits" }];
state.removalRules = [{ id: ruleId, name: "Copy return rule", equipment: "both", stage: "field", outcome: "returned", active: true, revision: 3 }];
state.removalPolicies = [{ id: "removal-policy", revision: 2, requireSystemReturn: false, requireModuleReturn: true }];
state.fieldRemovalChoices = [{ id: `system:${ruleId}`, equipment: "system", ruleId }];
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
  "serialOccupancy", "fulfillmentBatches", "stockDiscrepancies", "workPlans", "customerHandoffs"])
  dirty[field] = [{ sourceOnly: true }];
dirty.operations = { sourceReplay: "source receipt" }; dirty.orderNumberCounters = { purchase: 99 };
const clean = cleanInventoryCatalog(dirty);
validateInventoryBackup({ state: clean, movements: [], enabled: true }, []);
assert.equal(clean.revision, 0);
assert.deepEqual(clean.operations, {});
for (const [field, value] of Object.entries(clean))
  if (Array.isArray(value) && !["warehouses", "vendors", "categories", "categoryCatalog", "items", "locationTypes",
    "typeLinks", "fieldSettings", "removalRules", "removalPolicies", "fieldRemovalChoices"].includes(field))
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
const copy = (copyAccess = false) => fetch(`${config.baseURL}/api/projects/${sourceId}/copy`, {
  method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({copyAccess}) });
try {
  // An upgraded standalone database must not lose an unknown legacy FK.
  await pool.query("ALTER TABLE public.trouble_codes ADD CONSTRAINT trouble_codes_code_key UNIQUE(code)");
  await pool.query("CREATE TABLE public.copy_legacy_reference(code varchar(50) REFERENCES public.trouble_codes(code))");
  await assert.rejects(initializeAllProjectTroubleCodes(), /legacy code-based reference remains/);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM pg_constraint WHERE conname='trouble_codes_code_key'")).rows[0].count,1);
  await pool.query("DROP TABLE public.copy_legacy_reference");
  await initializeAllProjectTroubleCodes();
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM pg_constraint WHERE conname='trouble_codes_code_key'")).rows[0].count,0);
  const response = await copy(), project = await response.json();
  assert.equal(response.status, 201, project.message);
  assert.equal(project.inventoryEnabled, true);
  const sourceSettings = (await pool.query("SELECT * FROM public.projects WHERE id=$1", [sourceId])).rows[0];
  const copiedSettings = (await pool.query("SELECT * FROM public.projects WHERE id=$1", [project.id])).rows[0];
  const { getTableColumns } = await import("drizzle-orm");
  const { projects } = await import("../shared/schema");
  for (const [key,column] of Object.entries(getTableColumns(projects))) {
    const policy = projectCopyPolicy[key as keyof typeof projectCopyPolicy];
    if (policy === "copy" || policy === "routing") assert.deepEqual(copiedSettings[column.name],sourceSettings[column.name],key);
    if (policy === "pause") assert.equal(copiedSettings[column.name],false,key);
  }
  for (const table of ["project_service_types","system_type_projects","module_type_projects","project_holidays",
    "work_order_sub_statuses","trouble_codes","work_order_closing_policy"]) {
    assert.equal(Number((await pool.query(`SELECT count(*) FROM public.${table} WHERE project_id=$1`,[project.id])).rows[0].count),1,table);
  }
  for (const [table,key] of [["work_order_sub_statuses","id"],["trouble_codes","rule_key"]]) {
    const ids = await pool.query(`SELECT ${key} FROM public.${table} WHERE project_id=ANY($1)`,[[sourceId,project.id]]);
    assert.equal(new Set(ids.rows.map(row => row[key])).size,2,`${table} identities must be independent`);
  }
  for (const table of ["user_projects","user_group_projects"])
    assert.equal(Number((await pool.query(`SELECT count(*) FROM public.${table} WHERE project_id=$1`,[project.id])).rows[0].count),0);
  const copied = await inventoryState(project.id);
  validateInventoryBackup({ state: copied, movements: [], enabled: true }, []);
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
  assert.equal(copied.typeLinks![0].itemId,copiedComponent.id);
  assert.equal(copied.typeLinks![0].typeId,systemType);
  assert.equal(copied.fieldSettings![0].warehouseId,copied.warehouses.find(row=>row.code===source.warehouses[0].code)!.id);
  assert.notEqual(copied.removalRules![0].id,ruleId);
  assert.equal(copied.fieldRemovalChoices![0].ruleId,copied.removalRules![0].id);
  assert.equal(copied.removalPolicies![0].requireSystemReturn,false);
  assert.equal(project.copyReport.inventory.typeLinks,2);
  assert.equal(project.copyReport.accessCopied,false);
  assert.equal(copied.categoryCatalog!.find(row => row.id === copiedKit.categoryId)!.active, false);
  assert.equal(copied.locationTypes!.find(type => type.id === copied.warehouses.find(location => location.code === "CUSTOM")!.locationTypeId)!.name, "Copy custom location");
  assert.ok(copied.locationTypes!.some(type => type.id === defaultLocationTypeId("physical")));
  for (const location of copied.warehouses) { assert.deepEqual(location.userIds, []); assert.equal(location.assignedUserId, null); }
  const retained = new Set(["inventory_relational_projects", "inventory_warehouses", "inventory_location_types", "inventory_categories", "inventory_vendors",
    "inventory_items", "inventory_items_values", "inventory_kit_recipe_lines", "inventory_type_links",
    "inventory_field_settings", "inventory_removal_rules", "inventory_removal_policies", "inventory_field_removal_choices"]);
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
  const withAccessResponse = await copy(true), withAccess = await withAccessResponse.json();
  assert.equal(withAccessResponse.status,201,withAccess.message);
  const assignedCopy = await inventoryState(withAccess.id);
  assert.deepEqual(assignedCopy.warehouses.find(row=>row.code===source.warehouses[0].code)!.userIds,[actor]);
  for (const [table,key] of [["user_projects","user_id"],["user_group_projects","group_id"]]) {
    const expected=Number((await pool.query(`SELECT count(DISTINCT ${key}) FROM public.${table} WHERE project_id=$1`,[sourceId])).rows[0].count);
    assert.equal(Number((await pool.query(`SELECT count(*) FROM public.${table} WHERE project_id=$1`,[withAccess.id])).rows[0].count),expected);
  }
  assert.equal(withAccess.copyReport.accessCopied,true);
  assert.equal(Number((await pool.query("SELECT count(*) FROM public.user_group_members WHERE group_id=$1",[group])).rows[0].count),1);
  assert.equal((await fetch(`${config.baseURL}/api/projects/${sourceId}/copy`, {method:"POST",
    headers:{Cookie:cookie,"Content-Type":"application/json"},body:'{"copyAccess":"yes"}'})).status,400);
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
  console.log("PASS: Complete project setup HTTP copy, all scalar settings, service/equipment selections, custom codes, type links and policies, optional project/group/location access, zero operational rows, paused deliveries, unchanged source, rollback cleanup, disabled project and permission boundaries.");
} finally { await pool.end(); }
