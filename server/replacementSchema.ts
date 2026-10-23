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
    ADD COLUMN IF NOT EXISTS replacement_cancelled_by text;
    CREATE UNIQUE INDEX IF NOT EXISTS work_order_replacement_operation ON "${schema}".work_orders(replacement_operation_id);
    CREATE UNIQUE INDEX IF NOT EXISTS work_order_one_active_replacement ON "${schema}".work_orders(replacement_root_id) WHERE replacement_active;
    CREATE INDEX IF NOT EXISTS work_order_replacement_chain ON "${schema}".work_orders(replacement_root_id,id);`);
}
