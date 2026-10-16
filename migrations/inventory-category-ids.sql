-- Apply to development or an explicitly selected standalone installation.
-- Replit-managed production receives schema changes through Publish, not startup.
BEGIN;
CREATE TABLE IF NOT EXISTS public.inventory_categories (
  project_id integer NOT NULL REFERENCES public.inventory_state(project_id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 500 AND name = btrim(name)),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (project_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_categories_project_name
  ON public.inventory_categories (project_id, lower(btrim(name)));
ALTER TABLE public.inventory_items ADD COLUMN IF NOT EXISTS category_id uuid;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_items'::regclass AND conname = 'inventory_items_category_fk') THEN
    ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_category_fk
      FOREIGN KEY (project_id, category_id) REFERENCES public.inventory_categories(project_id, id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS inventory_items_category_index ON public.inventory_items(project_id, category_id);
COMMIT;
