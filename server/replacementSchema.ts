/** Project-local relationships travel with PostgreSQL project schemas. */
export async function installReplacementProject(client: { query: Function }, schema: string) {
  if (!/^project_[a-z0-9_]+$/.test(schema)) throw new Error("Invalid project schema");
  await client.query(`ALTER TABLE "${schema}".work_orders
    ADD COLUMN IF NOT EXISTS replacement_root_id integer REFERENCES "${schema}".work_orders(id) DEFERRABLE INITIALLY DEFERRED,
    ADD COLUMN IF NOT EXISTS replacement_parent_id integer REFERENCES "${schema}".work_orders(id) DEFERRABLE INITIALLY DEFERRED,
    ADD COLUMN IF NOT EXISTS replacement_equipment text CHECK(replacement_equipment IN ('system','module','both')),
    ADD COLUMN IF NOT EXISTS replacement_reason text,
    ADD COLUMN IF NOT EXISTS replacement_vehicle_id text,
    ADD COLUMN IF NOT EXISTS replacement_operation_id uuid,
    ADD COLUMN IF NOT EXISTS replacement_actor_id text,
    ADD COLUMN IF NOT EXISTS replacement_predecessor_fingerprint text,
    ADD COLUMN IF NOT EXISTS replacement_active boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS replacement_cancelled_at timestamptz,
    ADD COLUMN IF NOT EXISTS replacement_cancelled_by text,
    ADD COLUMN IF NOT EXISTS replacement_cancelled_assignee text,
    ADD COLUMN IF NOT EXISTS replacement_deleted_at timestamptz,
    ADD COLUMN IF NOT EXISTS replacement_deleted_by text;
    CREATE UNIQUE INDEX IF NOT EXISTS work_order_replacement_operation ON "${schema}".work_orders(replacement_operation_id);
    CREATE UNIQUE INDEX IF NOT EXISTS work_order_one_active_replacement ON "${schema}".work_orders(replacement_root_id) WHERE replacement_active;
    CREATE INDEX IF NOT EXISTS work_order_replacement_chain ON "${schema}".work_orders(replacement_root_id,id);`);
  // An abandoned visit is not a second physical removal and must not retain
  // a uniqueness claim on the original installed device. Preserve the same
  // columns, comparison semantics and enabled/disabled index choices.
  const existing = await client.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname=$1", [schema]);
  for (const column of ["old_system_id", "new_system_id", "old_module_id", "new_module_id"]) {
    const name = `idx_unique_${column}`, index = existing.rows.find((row: any) => row.indexname === name);
    if (!index || index.indexdef.includes("replacement_cancelled_at") && index.indexdef.includes("replacement_deleted_at")) continue;
    // One SQL request is atomic even when the caller has no outer transaction.
    await client.query(`DROP INDEX "${schema}"."${name}";
      CREATE UNIQUE INDEX "${name}" ON "${schema}".work_orders (${column})
      WHERE ${column} IS NOT NULL AND replacement_cancelled_at IS NULL AND replacement_deleted_at IS NULL;`);
  }
}
