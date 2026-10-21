import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { arrayTable, columnName, relationalEntities } from "./inventoryRelationalModel";

const q = (name: string) => `"${name}"`;
const referenceTables: Record<string, string> = {
  itemId: "inventory_items", vendorId: "inventory_vendors",
  warehouseId: "inventory_warehouses", sourceId: "inventory_warehouses", destinationId: "inventory_warehouses",
  stagingId: "inventory_warehouses", vehicleId: "inventory_warehouses",
  orderId: "inventory_orders", receiptId: "inventory_receipts", sourceReceiptId: "inventory_receipts", assemblyId: "inventory_kit_assemblies",
  replacementFor: "inventory_orders",
  locationTypeId: "inventory_location_types",
  ruleId: "inventory_removal_rules",
  customerHandoffId: "inventory_customer_handoffs", returnId: "inventory_returns",
};

// These entities persist their immutable domain ID as _key. Their existing
// composite primary keys are available before Publish adds dependent FKs;
// secondary unique constraints on existing tables can be emitted after FKs.
const referenceColumns = (field: string) =>
  ["project_id", field === "returnId" || field === "customerHandoffId" ? "_key" : "id"];

/** Development/standalone maintenance only. Publish transports schema to managed production. */
export async function applyInventoryRelationalSchema(pool: Pool) {
  const statements: string[] = [
    `CREATE TABLE IF NOT EXISTS public.inventory_relational_projects (
      project_id integer PRIMARY KEY REFERENCES public.inventory_state(project_id) ON DELETE CASCADE,
      version integer NOT NULL CHECK(version=1), revision integer NOT NULL CHECK(revision>=0),
      collections text[] NOT NULL, migrated_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS public.inventory_order_counters (
      project_id integer NOT NULL REFERENCES public.inventory_state(project_id) ON DELETE CASCADE,
      counter_key text NOT NULL, value integer NOT NULL CHECK(value>=0), PRIMARY KEY(project_id,counter_key))`,
    `CREATE TABLE IF NOT EXISTS public.inventory_operations (
      project_id integer NOT NULL REFERENCES public.inventory_state(project_id) ON DELETE CASCADE,
      operation_id text NOT NULL, fingerprint text NOT NULL, PRIMARY KEY(project_id,operation_id))`,
  ];
  const constraints: string[] = [];
  const fk = (table: string, columns: string[], target: string, targetColumns = ["project_id", "id"]) => {
    const name = `inventory_rel_fk_${createHash("sha256").update(JSON.stringify([table, columns, target, targetColumns])).digest("hex").slice(0, 16)}`;
    constraints.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.${table}'::regclass AND conname='${name}') THEN
      ALTER TABLE public.${table} ADD CONSTRAINT ${name} FOREIGN KEY (${columns.map(q).join(",")})
      REFERENCES public.${target} (${targetColumns.map(q).join(",")}) DEFERRABLE INITIALLY DEFERRED NOT VALID;
      END IF; END $$`);
    statements.push(`CREATE INDEX IF NOT EXISTS ${name}_idx ON public.${table} (${columns.map(q).join(",")})`);
  };
  const values = (table: string, parent: string, child: boolean) => {
    statements.push(`CREATE TABLE IF NOT EXISTS public.${table} (
      project_id integer NOT NULL, parent_id text NOT NULL,
      ${child ? "path text NOT NULL, line_no integer NOT NULL," : ""}
      field text NOT NULL, value_no integer NOT NULL, value text NOT NULL,
      PRIMARY KEY(project_id,parent_id,${child ? "path,line_no," : ""}field,value_no))`);
    fk(table, child ? ["project_id", "parent_id", "path", "line_no"] : ["project_id", "parent_id"],
      parent, child ? ["project_id", "parent_id", "path", "line_no"] : ["project_id", "_key"]);
  };
  for (const model of relationalEntities) {
    if (model.name !== "inventory_items")
      statements.push(`CREATE TABLE IF NOT EXISTS public.${model.name} (
        project_id integer NOT NULL REFERENCES public.inventory_state(project_id) ON DELETE CASCADE,
        _key text NOT NULL, PRIMARY KEY(project_id,_key))`);
    else {
      statements.push(`ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS _key text`);
      statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_rel_key ON public.inventory_items(project_id,_key)`);
    }
    statements.push(`ALTER TABLE public.${model.name} ADD COLUMN IF NOT EXISTS _position integer NOT NULL DEFAULT 0`);
    statements.push(`ALTER TABLE public.${model.name} ADD COLUMN IF NOT EXISTS _fields text[] NOT NULL DEFAULT '{}'`);
    statements.push(`ALTER TABLE public.${model.name} ADD COLUMN IF NOT EXISTS _paths text[] NOT NULL DEFAULT '{}'`);
    for (const [field, type] of Object.entries(model.columns))
      statements.push(`ALTER TABLE public.${model.name} ADD COLUMN IF NOT EXISTS ${q(columnName(field))} ${type}`);
    for (const field of model.json ?? [])
      statements.push(`ALTER TABLE public.${model.name} ADD COLUMN IF NOT EXISTS ${q(columnName(field))} jsonb`);
    // Foreign keys target the actual public ID, not an ordinal or display label.
    if (model.columns.id && model.name !== "inventory_items")
      statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${model.name}_identity ON public.${model.name}(project_id,id)`);
    for (const field of Object.keys(model.columns))
      if (referenceTables[field]) fk(model.name, ["project_id", columnName(field)], referenceTables[field], referenceColumns(field));
    if (model.arrays?.length) values(arrayTable(model.name), model.name, false);
    for (const child of model.children ?? []) {
      statements.push(`CREATE TABLE IF NOT EXISTS public.${child.name} (
        project_id integer NOT NULL, parent_id text NOT NULL, path text NOT NULL, line_no integer NOT NULL,
        _fields text[] NOT NULL, PRIMARY KEY(project_id,parent_id,path,line_no))`);
      for (const [field, type] of Object.entries(child.columns))
        statements.push(`ALTER TABLE public.${child.name} ADD COLUMN IF NOT EXISTS ${q(columnName(field))} ${type}`);
      if (child.name === "inventory_kit_recipe_lines")
        statements.push(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
          AND table_name='inventory_kit_recipe_lines' AND column_name='quantity' AND data_type <> 'numeric') THEN
          ALTER TABLE public.inventory_kit_recipe_lines ALTER COLUMN quantity TYPE numeric USING quantity::numeric;
          END IF; END $$`);
      fk(child.name, ["project_id", "parent_id"], model.name, ["project_id", "_key"]);
      for (const field of Object.keys(child.columns))
        if (referenceTables[field]) fk(child.name, ["project_id", columnName(field)], referenceTables[field], referenceColumns(field));
      if (child.arrays?.length) values(arrayTable(child.name), child.name, true);
      if (["integer", "numeric"].includes(child.columns.quantity))
        constraints.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.${child.name}'::regclass AND conname='inventory_quantity_nonnegative') THEN
          ALTER TABLE public.${child.name} ADD CONSTRAINT inventory_quantity_nonnegative CHECK(quantity>=0); END IF; END $$`);
    }
  }
  statements.push(`ALTER TABLE public.inventory_quantities ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0`);
  statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS inventory_customer_handoff_return_unique
    ON public.inventory_customer_handoff_lines(project_id,return_id)`);
  statements.push(`ALTER TABLE public.inventory_quantities ADD COLUMN IF NOT EXISTS _position integer NOT NULL DEFAULT 0`);
  fk("inventory_quantities", ["project_id", "warehouse_id"], "inventory_warehouses");
  statements.push(`CREATE TABLE IF NOT EXISTS public.inventory_stock_serials (
    project_id integer NOT NULL, warehouse_id text NOT NULL, item_id text NOT NULL,
    serial text NOT NULL, _position integer NOT NULL,
    PRIMARY KEY(project_id,item_id,serial))`);
  fk("inventory_stock_serials", ["project_id", "warehouse_id", "item_id"], "inventory_quantities", ["project_id", "warehouse_id", "item_id"]);
  statements.push(`CREATE TABLE IF NOT EXISTS public.inventory_capture_item_refs (
    project_id integer NOT NULL, draft_id text NOT NULL, item_id text NOT NULL,
    PRIMARY KEY(project_id,draft_id,item_id))`);
  fk("inventory_capture_item_refs", ["project_id", "draft_id"], "inventory_shipment_drafts");
  fk("inventory_capture_item_refs", ["project_id", "item_id"], "inventory_items");
  statements.push(`ALTER TABLE public.inventory_categories ADD COLUMN IF NOT EXISTS _position integer NOT NULL DEFAULT 0`);
  statements.push(`ALTER TABLE public.inventory_receipts ADD COLUMN IF NOT EXISTS related_order_id text`);
  fk("inventory_receipts", ["project_id", "related_order_id"], "inventory_orders");
  statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS inventory_order_number_unique
    ON public.inventory_orders(project_id,order_number) WHERE order_number IS NOT NULL AND order_number<>''`);
  statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS inventory_serial_occupancy_unique
    ON public.inventory_serial_occupancy(project_id,item_id,serial)`);
  statements.push(`CREATE INDEX IF NOT EXISTS inventory_stock_serial_bin_position
    ON public.inventory_stock_serials(project_id,warehouse_id,item_id,_position,serial)`);
  statements.push(`CREATE INDEX IF NOT EXISTS inventory_stock_item_location
    ON public.inventory_quantities(project_id,item_id,warehouse_id)`);
  statements.push(`CREATE INDEX IF NOT EXISTS inventory_stock_item_sort
    ON public.inventory_items(project_id,name,sku,id)`);
  statements.push(`CREATE INDEX IF NOT EXISTS inventory_stock_location_sort
    ON public.inventory_warehouses(project_id,name,code,id)`);
  statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS inventory_location_type_name_unique
    ON public.inventory_location_types(project_id,lower(regexp_replace(btrim(name),'\\s+',' ','g')))`);
  statements.push(`CREATE UNIQUE INDEX IF NOT EXISTS inventory_removal_rule_name_unique ON public.inventory_removal_rules(project_id,lower(btrim(name)))`);
  statements.push(`ALTER TABLE public.inventory_field_settings ALTER COLUMN id SET NOT NULL,
    ALTER COLUMN source_mode SET NOT NULL, ALTER COLUMN fulfillment SET NOT NULL`);
  constraints.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_field_settings'::regclass AND conname='inventory_field_settings_valid') THEN
    ALTER TABLE public.inventory_field_settings ADD CONSTRAINT inventory_field_settings_valid CHECK (
      id='field-defaults' AND source_mode IN ('assigned_vehicle','project_warehouse') AND fulfillment IN ('components','kits') AND
      ((source_mode='assigned_vehicle' AND warehouse_id IS NULL) OR (source_mode='project_warehouse' AND warehouse_id IS NOT NULL)));
    END IF; END $$`);
  constraints.push(`ALTER TABLE public.inventory_removal_rules DROP CONSTRAINT IF EXISTS inventory_removal_rule_valid`);
  constraints.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_field_removal_choices'::regclass AND conname='inventory_field_removal_choice_valid') THEN
    ALTER TABLE public.inventory_field_removal_choices ADD CONSTRAINT inventory_field_removal_choice_valid CHECK (
      id IS NOT NULL AND equipment IS NOT NULL AND equipment IN ('system','module') AND rule_id IS NOT NULL AND id=equipment || ':' || rule_id::text);
    END IF; END $$`);
  constraints.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_removal_rules'::regclass AND conname='inventory_removal_rule_action_valid') THEN
    ALTER TABLE public.inventory_removal_rules ADD CONSTRAINT inventory_removal_rule_action_valid CHECK (
      id IS NOT NULL AND length(btrim(name)) BETWEEN 1 AND 200 AND active IS NOT NULL AND revision>0 AND
      equipment IN ('system','module','both') AND
      (stage='field' AND outcome IN ('returned','scrapped','left_onsite') OR stage='warehouse' AND outcome IN ('released','scrapped','customer_return')));
    END IF; END $$`);
  constraints.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_removal_policies'::regclass AND conname='inventory_removal_policy_valid') THEN
    ALTER TABLE public.inventory_removal_policies ADD CONSTRAINT inventory_removal_policy_valid CHECK (
      id='removal-policy' AND revision IS NOT NULL AND revision>0 AND require_system_return IS NOT NULL AND require_module_return IS NOT NULL);
    END IF; END $$`);
  constraints.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_location_types'::regclass AND conname='inventory_location_type_valid') THEN
    ALTER TABLE public.inventory_location_types ADD CONSTRAINT inventory_location_type_valid CHECK (
      id IS NOT NULL AND name IS NOT NULL AND length(btrim(name)) BETWEEN 1 AND 200 AND
      kind IS NOT NULL AND kind IN ('physical','vehicle','mobile') AND
      access_policy IS NOT NULL AND access_policy IN ('shared','assigned') AND revision IS NOT NULL AND revision>0);
    END IF; END $$`);
  constraints.push(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.inventory_warehouses'::regclass AND conname='inventory_warehouse_location_type_required') THEN
    ALTER TABLE public.inventory_warehouses ADD CONSTRAINT inventory_warehouse_location_type_required
      CHECK(location_type_id IS NOT NULL) NOT VALID;
    END IF; END $$`);
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    // Define all relations before installing cross-table constraints.
    for (const statement of statements) await client.query(statement);
    for (const constraint of constraints) await client.query(constraint);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS inventory_type_link_identity
      ON public.inventory_type_links(project_id,equipment,type_id)`);
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='inventory_type_link_system_fk') THEN
        ALTER TABLE public.inventory_type_links ADD CONSTRAINT inventory_type_link_system_fk
          FOREIGN KEY(system_type_id) REFERENCES public.system_types(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
        ALTER TABLE public.inventory_type_links ADD CONSTRAINT inventory_type_link_module_fk
          FOREIGN KEY(module_type_id) REFERENCES public.module_types(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
        ALTER TABLE public.inventory_type_links ADD CONSTRAINT inventory_type_link_kind_check CHECK (
          equipment='system' AND system_type_id=type_id AND system_type_id IS NOT NULL AND module_type_id IS NULL OR
          equipment='module' AND module_type_id=type_id AND module_type_id IS NOT NULL AND system_type_id IS NULL);
      END IF;
    END $$`);
    await client.query(`CREATE OR REPLACE FUNCTION public.inventory_reject_legacy_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS(SELECT 1 FROM public.inventory_relational_projects WHERE project_id=OLD.project_id) THEN
          IF TG_OP='DELETE' THEN
            RAISE EXCEPTION 'Inventory uses relational storage. Clear relational records through the supported restore or inventory service first.' USING ERRCODE='23514';
          ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
            RAISE EXCEPTION 'Inventory uses relational storage. Legacy snapshot writes are prohibited; use the supported restore or inventory service.' USING ERRCODE='23514';
          END IF;
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END $$`);
    await client.query("DROP TRIGGER IF EXISTS inventory_reject_legacy_write ON public.inventory_state");
    await client.query(`CREATE TRIGGER inventory_reject_legacy_write BEFORE UPDATE OF state OR DELETE ON public.inventory_state
      FOR EACH ROW EXECUTE FUNCTION public.inventory_reject_legacy_write()`);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
