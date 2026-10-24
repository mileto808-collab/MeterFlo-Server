import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "./db";
import { storage } from "./storage";
import { isAuthenticated } from "./replitAuth";

const mutable = z.object({
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  routingPriority: z.number().int().min(0).max(100000).nullable().optional(),
  active: z.boolean().optional(),
});
const createSchema = mutable.extend({ parentStatusId: z.number().int().positive(),
  code: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_-]+$/) }).strict();
const patchSchema = mutable.partial().strict().refine(value => Object.keys(value).length > 0);

export async function initializeSubStatusTables(client: Pick<PoolClient, "query"> = pool) {
  // Older schemas have a unique ID index but no primary-key constraint. A
  // unique index alone cannot identify rows to portable backup/restore tools.
  // Preserve all IDs/code FKs; fail explicitly if existing IDs are invalid.
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS work_order_statuses_id_reference_idx ON public.work_order_statuses(id);
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint
        WHERE conrelid='public.work_order_statuses'::regclass AND contype='p') THEN
        ALTER TABLE public.work_order_statuses ADD PRIMARY KEY (id);
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS public.work_order_sub_statuses (
    id uuid PRIMARY KEY, parent_status_id integer NOT NULL REFERENCES public.work_order_statuses(id) ON DELETE RESTRICT,
    project_id integer REFERENCES public.projects(id) ON DELETE CASCADE, code varchar(50) NOT NULL, label varchar(100) NOT NULL,
    description text, color varchar(20), sort_order integer NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true,
    created_at timestamp DEFAULT now(), updated_at timestamp DEFAULT now());
    ALTER TABLE public.work_order_sub_statuses ADD COLUMN IF NOT EXISTS routing_priority integer CHECK(routing_priority >= 0);
    CREATE UNIQUE INDEX IF NOT EXISTS work_order_sub_status_shared_code ON public.work_order_sub_statuses(parent_status_id,lower(code)) WHERE project_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS work_order_sub_status_project_code ON public.work_order_sub_statuses(project_id,parent_status_id,lower(code)) WHERE project_id IS NOT NULL;
    CREATE OR REPLACE FUNCTION public.guard_work_order_sub_status_definition() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code OR NEW.parent_status_id IS DISTINCT FROM OLD.parent_status_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        RAISE EXCEPTION 'Sub-status identity, parent and project cannot be changed; retire it and create another.' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS guard_sub_status_definition ON public.work_order_sub_statuses;
    CREATE TRIGGER guard_sub_status_definition BEFORE UPDATE ON public.work_order_sub_statuses
      FOR EACH ROW EXECUTE FUNCTION public.guard_work_order_sub_status_definition();
    CREATE OR REPLACE FUNCTION public.guard_project_work_order_sub_status() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE chosen record; target_project integer;
    BEGIN
      IF NEW.sub_status_id IS NULL THEN RETURN NEW; END IF;
      SELECT s.*,p.code AS parent_code INTO chosen FROM public.work_order_sub_statuses s
        JOIN public.work_order_statuses p ON p.id=s.parent_status_id WHERE s.id=NEW.sub_status_id FOR SHARE OF s;
      IF NOT FOUND THEN RAISE EXCEPTION 'Sub-status does not exist.' USING ERRCODE='23503'; END IF;
      IF NEW.status IS DISTINCT FROM chosen.parent_code THEN
        IF TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.sub_status_id IS NOT DISTINCT FROM OLD.sub_status_id THEN
          NEW.sub_status_id=NULL; RETURN NEW;
        END IF;
        RAISE EXCEPTION 'Sub-status must belong to the selected core status.' USING ERRCODE='23514';
      END IF;
      SELECT id INTO target_project FROM public.projects WHERE database_name=TG_TABLE_SCHEMA;
      IF chosen.project_id IS NOT NULL AND chosen.project_id IS DISTINCT FROM target_project THEN
        RAISE EXCEPTION 'Sub-status belongs to another project.' USING ERRCODE='23514';
      END IF;
      IF NOT chosen.active AND coalesce(current_setting('meterflo.restore_sub_status',true),'')<>'on'
        AND (TG_OP='INSERT' OR NEW.sub_status_id IS DISTINCT FROM OLD.sub_status_id) THEN
        RAISE EXCEPTION 'Sub-status is inactive; choose an active sub-status.' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    DO $$ BEGIN IF to_regprocedure('meterflo_audit.capture()') IS NOT NULL THEN
      DROP TRIGGER IF EXISTS meterflo_business_audit ON public.work_order_sub_statuses;
      CREATE TRIGGER meterflo_business_audit AFTER INSERT OR UPDATE OR DELETE ON public.work_order_sub_statuses
        FOR EACH ROW EXECUTE FUNCTION meterflo_audit.capture();
    END IF; END $$;`);
}

export async function installProjectSubStatuses(client: Pick<PoolClient, "query">, schema: string) {
  if (!/^project_[a-z0-9_]+$/.test(schema)) throw new Error("Invalid project schema.");
  const ready = await client.query("SELECT to_regprocedure('public.guard_project_work_order_sub_status()') AS ready");
  if (!ready.rows[0].ready) await initializeSubStatusTables(client);
  await client.query(`ALTER TABLE "${schema}".work_orders ADD COLUMN IF NOT EXISTS sub_status_id uuid;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"${schema}".work_orders'::regclass AND conname='fk_work_order_sub_status') THEN
      ALTER TABLE "${schema}".work_orders ADD CONSTRAINT fk_work_order_sub_status FOREIGN KEY(sub_status_id)
        REFERENCES public.work_order_sub_statuses(id) ON DELETE RESTRICT;
    END IF; END $$;
    CREATE INDEX IF NOT EXISTS idx_work_order_sub_status ON "${schema}".work_orders(sub_status_id);
    DROP TRIGGER IF EXISTS guard_work_order_sub_status ON "${schema}".work_orders;
    CREATE TRIGGER guard_work_order_sub_status BEFORE INSERT OR UPDATE ON "${schema}".work_orders
      FOR EACH ROW EXECUTE FUNCTION public.guard_project_work_order_sub_status();`);
}

export async function initializeWorkOrderSubStatuses() {
  const client = await pool.connect();
  try {
    await initializeSubStatusTables(client);
    const projects = await client.query("SELECT database_name AS schema_name FROM public.projects WHERE database_name IS NOT NULL");
    for (const row of projects.rows) {
      if (!/^project_[a-z0-9_]+$/.test(row.schema_name)) continue;
      const exists = await client.query("SELECT to_regclass($1) AS table_name", [`"${row.schema_name}".work_orders`]);
      if (exists.rows[0].table_name) await installProjectSubStatuses(client, row.schema_name);
    }
  } finally { client.release(); }
}

export async function listSubStatuses(projectId?: number, client: Pick<PoolClient, "query"> = pool) {
  return (await client.query(`SELECT s.id,s.parent_status_id AS "parentStatusId",s.project_id AS "projectId",
    s.code,s.label,s.description,s.color,s.sort_order AS "sortOrder",s.routing_priority AS "routingPriority",s.active,s.created_at AS "createdAt",s.updated_at AS "updatedAt",
    p.code AS "parentStatusCode",p.label AS "parentStatusLabel"
    FROM public.work_order_sub_statuses s JOIN public.work_order_statuses p ON p.id=s.parent_status_id
    WHERE s.project_id IS NULL ${projectId ? "OR s.project_id=$1" : ""} ORDER BY p.sort_order,s.sort_order,s.label`,
  projectId ? [projectId] : [])).rows;
}

/** Project restores cannot overwrite global configuration or another project's definitions. */
export async function restoreSubStatusDefinitions(client: Pick<PoolClient,"query">, schema: string, input: unknown) {
  const definitions = z.array(createSchema.extend({ id:z.string().uuid(), projectId:z.number().int().positive().nullable(),
    parentStatusCode:z.string().min(1).max(50) }).passthrough()).max(10000).parse(input);
  if (new Set(definitions.map(d=>d.id)).size !== definitions.length) throw new Error("Duplicate sub-status IDs in backup.");
  const { rows:[project] } = await client.query("SELECT id FROM public.projects WHERE database_name=$1", [schema]);
  if (!project) throw new Error("Project not found for sub-status restore.");
  const mapping = new Map<string,string>();
  for (const d of definitions) {
    const { rows:[parent] } = await client.query("SELECT id FROM public.work_order_statuses WHERE code=$1", [d.parentStatusCode]);
    if (!parent) throw new Error(`Missing core status ${d.parentStatusCode}; restore shared statuses first.`);
    const targetProject = d.projectId === null ? null : project.id;
    const { rows:[byId] } = await client.query("SELECT * FROM public.work_order_sub_statuses WHERE id=$1", [d.id]);
    const { rows:[byCode] } = await client.query(`SELECT * FROM public.work_order_sub_statuses
      WHERE parent_status_id=$1 AND project_id IS NOT DISTINCT FROM $2::integer AND lower(code)=lower($3)`,
    [parent.id,targetProject,d.code]);
    if (byId && byId.project_id === targetProject && (byId.parent_status_id !== parent.id || byId.code !== d.code))
      throw new Error("Backup sub-status identity conflicts with an existing definition.");
    const existing = byId?.project_id === targetProject ? byId : byCode;
    const id = existing?.id ?? (byId ? randomUUID() : d.id);
    if (!existing) {
      if (targetProject === null)
        throw new Error("Missing shared sub-status. Restore shared definitions through administrator Settings or a full-system backup first.");
      await client.query(`INSERT INTO public.work_order_sub_statuses(id,parent_status_id,project_id,code,label,description,color,sort_order,active,routing_priority)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id,parent.id,targetProject,d.code,d.label,d.description??null,d.color??null,d.sortOrder??0,d.active??true,d.routingPriority??null]);
    } else if (targetProject !== null) {
      await client.query(`UPDATE public.work_order_sub_statuses SET label=$2,description=$3,color=$4,sort_order=$5,active=$6,routing_priority=$7,updated_at=now() WHERE id=$1`,
        [id,d.label,d.description??null,d.color??null,d.sortOrder??0,d.active??true,d.routingPriority??null]);
    }
    mapping.set(d.id,id);
  }
  await client.query("SELECT set_config('meterflo.restore_sub_status','on',true)");
  return mapping;
}

export function registerWorkOrderSubStatusRoutes(app: Express) {
  const authorize = async (req: any, res: any, next: any) => {
    try {
    const user = await storage.getUser(req.user?.claims?.sub);
    if (!user || user.isLocked) return res.status(401).json({ message: "Sign in required." });
    const admin = await storage.isAdminUser(user);
    const projectId = req.params.projectId ? Number(req.params.projectId) : undefined;
    if (projectId !== undefined && (!Number.isSafeInteger(projectId) || projectId <= 0)) return res.status(400).json({ message: "Invalid project." });
    if (projectId !== undefined) {
      const project = await storage.getProject(projectId);
      if (!project || !admin && !await storage.isUserAssignedToProject(user.id, projectId))
        return res.status(403).json({ message: "Project access required." });
      if (project.isActive === false && !await storage.hasPermission(user, "projects.viewInactive"))
        return res.status(403).json({ message: "Inactive project access required." });
    }
    if (req.method !== "GET" && !(projectId === undefined ? admin : admin || await storage.hasPermission(user, "projects.manageSubStatuses")))
      return res.status(403).json({ message: projectId ? "Project sub-status management permission required." : "Administrator access required." });
    res.locals.subStatusProjectId = projectId;
    next();
    } catch (err) { next(err); }
  };
  const error = (err: any, res: any) => {
    if (err instanceof z.ZodError) return res.status(400).json({ message: "Invalid sub-status fields.", errors: err.issues });
    if (err.code === "23505") return res.status(409).json({ message: "This parent status already has that sub-status code in this scope." });
    if (err.code === "23503") return res.status(409).json({ message: "Referenced status cannot be deleted. Deactivate a used sub-status instead." });
    if (err.code === "23514") return res.status(409).json({ message: err.message });
    console.error("Sub-status operation failed", { code: err.code });
    return res.status(500).json({ message: "Sub-status operation failed." });
  };
  for (const base of ["/api/work-order-sub-statuses", "/api/projects/:projectId/work-order-sub-statuses"]) {
    app.get(base, isAuthenticated, authorize, async (_req, res) => {
      try { res.json(await listSubStatuses(res.locals.subStatusProjectId)); } catch (err) { error(err, res); }
    });
    app.post(base, isAuthenticated, authorize, async (req, res) => {
      try {
        const d = createSchema.parse(req.body), id = randomUUID();
        await pool.query(`INSERT INTO public.work_order_sub_statuses(id,parent_status_id,project_id,code,label,description,color,sort_order,active,routing_priority)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [id,d.parentStatusId,res.locals.subStatusProjectId ?? null,d.code,d.label,d.description ?? null,d.color ?? null,d.sortOrder ?? 0,d.active ?? true,d.routingPriority??null]);
        res.status(201).json((await listSubStatuses(res.locals.subStatusProjectId)).find(s => s.id === id));
      } catch (err) { error(err, res); }
    });
    app.patch(`${base}/:id`, isAuthenticated, authorize, async (req, res) => {
      try {
        const id = z.string().uuid().parse(req.params.id), d = patchSchema.parse(req.body);
        const columns: Record<string,string> = { label:"label", description:"description", color:"color", sortOrder:"sort_order", active:"active", routingPriority:"routing_priority" };
        const entries = Object.entries(d), values: any[] = entries.map(([,value]) => value);
        values.push(id,res.locals.subStatusProjectId ?? null);
        const result = await pool.query(`UPDATE public.work_order_sub_statuses SET ${entries.map(([key],i)=>`${columns[key]}=$${i+1}`).join(",")},updated_at=now()
          WHERE id=$${values.length-1} AND project_id IS NOT DISTINCT FROM $${values.length}::integer RETURNING id`, values);
        if (!result.rowCount) return res.status(404).json({ message: "Sub-status not found in this scope." });
        res.json((await listSubStatuses(res.locals.subStatusProjectId)).find(s => s.id === id));
      } catch (err) { error(err, res); }
    });
    app.delete(`${base}/:id`, isAuthenticated, authorize, async (req, res) => {
      try {
        const id = z.string().uuid().parse(req.params.id);
        const result = await pool.query("DELETE FROM public.work_order_sub_statuses WHERE id=$1 AND project_id IS NOT DISTINCT FROM $2::integer RETURNING id",
          [id,res.locals.subStatusProjectId ?? null]);
        if (!result.rowCount) return res.status(404).json({ message: "Sub-status not found in this scope." });
        res.json({ success: true });
      } catch (err) { error(err, res); }
    });
  }
}
