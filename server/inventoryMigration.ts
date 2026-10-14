import type { Pool } from "pg";
export async function initializeInventory(pool: Pool) {
  await pool.query(`
    ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS inventory_enabled boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS public.inventory_state (
      project_id integer PRIMARY KEY REFERENCES public.projects(id) ON DELETE RESTRICT,
      state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS public.inventory_items (
      project_id integer NOT NULL REFERENCES public.inventory_state(project_id) ON DELETE CASCADE,
      id text NOT NULL, sku text NOT NULL, data jsonb NOT NULL,
      PRIMARY KEY(project_id,id), UNIQUE(project_id,sku)
    );
    CREATE TABLE IF NOT EXISTS public.inventory_quantities (
      project_id integer NOT NULL REFERENCES public.inventory_state(project_id) ON DELETE CASCADE,
      warehouse_id text NOT NULL, item_id text NOT NULL, quantity integer NOT NULL CHECK(quantity>=0),
      reserved integer NOT NULL CHECK(reserved>=0 AND reserved<=quantity), serials jsonb NOT NULL,
      PRIMARY KEY(project_id,warehouse_id,item_id),
      FOREIGN KEY(project_id,item_id) REFERENCES public.inventory_items(project_id,id)
    );
    CREATE TABLE IF NOT EXISTS public.inventory_movements (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      project_id integer NOT NULL REFERENCES public.inventory_state(project_id) ON DELETE RESTRICT,
      operation_id text NOT NULL, action text NOT NULL, actor_id text, occurred_at timestamptz NOT NULL DEFAULT now(),
      changes jsonb NOT NULL, UNIQUE(project_id,operation_id)
    );
  `);
}
