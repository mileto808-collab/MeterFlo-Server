import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { pool } from "./db";
import { storage } from "./storage";
import { isAuthenticated } from "./replitAuth";

const mutable = z.object({
  code: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_-]+$/),
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
});
export const createTroubleCodeFields = mutable.omit({ active: true }).extend({
  code: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_-]+$/),
}).strict();
export const patchTroubleCodeFields = mutable.partial().strict().refine(d => Object.keys(d).length > 0);

export async function initializeProjectTroubleCodes(client: Pick<PoolClient, "query"> = pool) {
  await client.query(`ALTER TABLE public.trouble_codes
    ADD COLUMN IF NOT EXISTS project_id integer REFERENCES public.projects(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS rule_key uuid NOT NULL DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
    CREATE UNIQUE INDEX IF NOT EXISTS trouble_codes_rule_key_unique ON public.trouble_codes(rule_key);
    CREATE INDEX IF NOT EXISTS trouble_codes_project_idx ON public.trouble_codes(project_id);
    CREATE OR REPLACE FUNCTION public.guard_trouble_code_identity() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='UPDATE' THEN
        IF NEW.id IS DISTINCT FROM OLD.id
          OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.rule_key IS DISTINCT FROM OLD.rule_key THEN
          RAISE EXCEPTION 'Trouble-code internal identity and scope cannot change; Code and Name can be edited.' USING ERRCODE='23514';
        END IF;
      END IF;
      -- A project catalog includes shared core rows. A narrow trigger enforces
      -- that cross-scope exclusion, which a per-project unique index cannot.
      -- Serialize catalog writes, including core writes, before checking overlap.
      PERFORM pg_advisory_xact_lock(197, 1);
      IF EXISTS(SELECT 1 FROM public.trouble_codes t WHERE t.id IS DISTINCT FROM NEW.id
        AND lower(t.code)=lower(NEW.code)
        AND (NEW.project_id IS NULL OR t.project_id IS NULL OR t.project_id=NEW.project_id)) THEN
        RAISE EXCEPTION 'Code already exists in this project or the shared core catalog.' USING ERRCODE='23505';
      END IF;
      IF NEW.project_id IS NULL AND NOT NEW.active THEN
        RAISE EXCEPTION 'Core trouble codes cannot be retired per project.' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;
    DROP TRIGGER IF EXISTS guard_trouble_code_identity ON public.trouble_codes;
    CREATE TRIGGER guard_trouble_code_identity BEFORE INSERT OR UPDATE ON public.trouble_codes
      FOR EACH ROW EXECUTE FUNCTION public.guard_trouble_code_identity();
    CREATE OR REPLACE FUNCTION public.guard_project_trouble_code() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE chosen record; target_project integer;
    BEGIN
      IF NEW.trouble IS NULL THEN RETURN NEW; END IF;
      SELECT * INTO chosen FROM public.trouble_codes WHERE rule_key=NEW.trouble FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Unknown trouble code.' USING ERRCODE='23503'; END IF;
      SELECT id INTO target_project FROM public.projects WHERE database_name=TG_TABLE_SCHEMA;
      IF chosen.project_id IS NOT NULL AND chosen.project_id IS DISTINCT FROM target_project THEN
        RAISE EXCEPTION 'Trouble code belongs to another project.' USING ERRCODE='23514';
      END IF;
      IF NOT chosen.active AND coalesce(current_setting('meterflo.restore_trouble_codes',true),'')<>'on'
        AND (TG_OP='INSERT' OR NEW.trouble IS DISTINCT FROM OLD.trouble) THEN
        RAISE EXCEPTION 'Trouble code is retired; choose an active code.' USING ERRCODE='23514';
      END IF;
      RETURN NEW;
    END $$;`);
}

export async function installProjectTroubleCodes(client: Pick<PoolClient, "query">, schema: string) {
  if (!/^project_[a-z0-9_]+$/.test(schema)) throw new Error("Invalid project schema.");
  const ready = await client.query("SELECT to_regprocedure('public.guard_project_trouble_code()') AS ready");
  if (!ready.rows[0].ready) await initializeProjectTroubleCodes(client);
  const column = await client.query(`SELECT data_type FROM information_schema.columns
    WHERE table_schema=$1 AND table_name='work_orders' AND column_name='trouble'`, [schema]);
  if (!column.rows.length) throw new Error(`Missing trouble reference in ${schema}.`);
  await client.query(`DROP TRIGGER IF EXISTS guard_project_trouble_code ON "${schema}".work_orders`);
  if (column.rows[0].data_type !== "uuid") {
    const { rows: [project] } = await client.query("SELECT id FROM public.projects WHERE database_name=$1", [schema]);
    if (!project) throw new Error(`Project identity is required before migrating ${schema}.`);
    const unresolved = await client.query(`SELECT w.id FROM "${schema}".work_orders w
      WHERE nullif(w.trouble,'') IS NOT NULL AND
      (SELECT count(*) FROM public.trouble_codes t WHERE t.code=w.trouble
        AND (t.project_id IS NULL OR t.project_id=$1)) <> 1 LIMIT 1`, [project.id]);
    if (unresolved.rows.length) throw new Error(`Cannot migrate ${schema}: work order ${unresolved.rows[0].id} has an unresolved trouble code.`);
    const constraints = await client.query(`SELECT c.conname FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
      WHERE c.conrelid=$1::regclass AND c.contype='f' AND a.attname='trouble'`, [`"${schema}".work_orders`]);
    for (const row of constraints.rows) {
      await client.query(`ALTER TABLE "${schema}".work_orders DROP CONSTRAINT "${String(row.conname).replaceAll('"','""')}"`);
    }
    // Temporary conversion function is not a retained compatibility/read path.
    // ALTER TYPE preserves the column and existing row history without UPDATEs.
    await client.query(`CREATE OR REPLACE FUNCTION pg_temp.meterflo_trouble_uuid(value text, project integer)
      RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT rule_key FROM public.trouble_codes WHERE code=value AND (project_id IS NULL OR project_id=project)
      $$;
      ALTER TABLE "${schema}".work_orders ALTER COLUMN trouble TYPE uuid
        USING pg_temp.meterflo_trouble_uuid(nullif(trouble,''),${Number(project.id)});`);
  }
  await client.query(`ALTER TABLE "${schema}".work_orders DROP CONSTRAINT IF EXISTS fk_trouble_code;
    ALTER TABLE "${schema}".work_orders ADD CONSTRAINT fk_trouble_code
      FOREIGN KEY(trouble) REFERENCES public.trouble_codes(rule_key) ON UPDATE CASCADE ON DELETE RESTRICT;
    CREATE TRIGGER guard_project_trouble_code BEFORE INSERT OR UPDATE ON "${schema}".work_orders
      FOR EACH ROW EXECUTE FUNCTION public.guard_project_trouble_code();`);
}

/** Schema maintenance callers do not otherwise own a transaction. */
export async function migrateProjectTroubleCodeReferences(schema: string, connectionPool: Pick<Pool, "connect"> = pool) {
  if (!/^project_[a-z0-9_]+$/.test(schema)) throw new Error("Invalid project schema.");
  const client = await connectionPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`LOCK TABLE "${schema.replaceAll('"','""')}".work_orders IN ACCESS EXCLUSIVE MODE`);
    await installProjectTroubleCodes(client, schema);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function initializeAllProjectTroubleCodes() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(197, 1)");
    await client.query("LOCK TABLE public.trouble_codes IN SHARE ROW EXCLUSIVE MODE");
    await initializeProjectTroubleCodes(client);
    const { rows } = await client.query("SELECT database_name FROM public.projects WHERE database_name IS NOT NULL");
    for (const row of rows) {
      if (!/^project_[a-z0-9_]+$/.test(row.database_name)) continue;
      const exists = await client.query("SELECT to_regclass($1) AS t", [`"${row.database_name}".work_orders`]);
      if (exists.rows[0].t) await installProjectTroubleCodes(client, row.database_name);
    }
    // All text foreign keys have now been converted. Codes are unique within
    // their applicable catalog, not across unrelated projects.
    const old = await client.query(`SELECT c.conname FROM pg_constraint c
      WHERE c.conrelid='public.trouble_codes'::regclass AND c.contype='u'
      AND c.conkey=ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid=c.conrelid AND attname='code')]::smallint[]`);
    for (const row of old.rows)
      await client.query(`ALTER TABLE public.trouble_codes DROP CONSTRAINT "${String(row.conname).replaceAll('"','""')}"`);
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS trouble_codes_core_code_unique ON public.trouble_codes(lower(code)) WHERE project_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS trouble_codes_project_code_unique ON public.trouble_codes(project_id,lower(code)) WHERE project_id IS NOT NULL`);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

export async function exportTroubleCodes(client: Pick<PoolClient, "query">, projectId: number) {
  return (await client.query(`SELECT id,code,label,description,sort_order AS "sortOrder",project_id AS "projectId",
    rule_key AS "ruleKey",active FROM public.trouble_codes WHERE project_id IS NULL OR project_id=$1 ORDER BY id`, [projectId])).rows;
}

export async function restoreTroubleCodes(client: Pick<PoolClient, "query">, schema: string, input: unknown) {
  const definitions = z.array(z.object({
    // Archives can contain older core definitions outside today's editor limits.
    code: z.string().min(1).max(50),
    label: z.string().max(100),
    description: z.string().nullable().optional(),
    sortOrder: z.number().int().nullable().optional(),
    ruleKey: z.string().uuid(), projectId: z.number().int().positive().nullable(), active: z.boolean(),
  }).passthrough()).max(10000).parse(input);
  if (new Set(definitions.map(d => d.code)).size !== definitions.length ||
      new Set(definitions.map(d => d.ruleKey)).size !== definitions.length) throw new Error("Duplicate trouble-code identities in backup.");
  const { rows: [project] } = await client.query("SELECT id FROM public.projects WHERE database_name=$1", [schema]);
  if (!project) throw new Error("Project not found for trouble-code restore.");
  for (const d of definitions) {
    const { rows: [existing] } = await client.query("SELECT * FROM public.trouble_codes WHERE rule_key=$1 FOR UPDATE", [d.ruleKey]);
    if (d.projectId === null) {
      if (!existing || existing.project_id !== null)
        throw new Error(`Missing core trouble code ${d.code}; configure core definitions first.`);
      continue; // A project restore never rewrites core labels or identities.
    }
    if (existing) {
      if (existing.project_id !== project.id)
        throw new Error("Trouble-code identity conflicts with another definition; no project data was restored.");
      await client.query(`UPDATE public.trouble_codes SET label=$1,description=$2,sort_order=$3,active=$4,code=$6,updated_at=now() WHERE rule_key=$5`,
        [d.label, d.description ?? null, d.sortOrder ?? 0, d.active, d.ruleKey,d.code]);
    } else await client.query(`INSERT INTO public.trouble_codes(code,label,description,sort_order,project_id,rule_key,active)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [d.code,d.label,d.description??null,d.sortOrder??0,project.id,d.ruleKey,d.active]);
  }
  await client.query("SELECT set_config('meterflo.restore_trouble_codes','on',true)");
}

export function troubleCodeError(error: any, res: any) {
  if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid trouble-code fields. Identity fields cannot be edited.", errors: error.issues });
  if (error.code === "23505") return res.status(409).json({ message: "That Code is already used in this project's applicable catalog. Choose another Code." });
  if (error.code === "22P02") return res.status(400).json({ message: "Select a valid trouble-code identity." });
  if (error.code === "23503") return res.status(409).json({ message: "This trouble code is referenced by existing work orders and cannot be deleted." });
  if (error.code === "23514") return res.status(400).json({ message: error.message });
  console.error("Trouble-code operation failed", { code: error.code });
  return res.status(500).json({ message: "Trouble-code operation failed." });
}

export function registerProjectTroubleCodeRoutes(app: Express) {
  const base = "/api/projects/:projectId/trouble-codes";
  const authorize = async (req: any, res: any, next: any) => {
    try {
      const user = await storage.getUser(req.user?.claims?.sub);
      if (!user || user.isLocked) return res.status(401).json({ message: "Sign in required." });
      const projectId = Number(req.params.projectId);
      if (!Number.isSafeInteger(projectId) || projectId < 1) return res.status(400).json({ message: "Invalid project." });
      const admin = await storage.isAdminUser(user);
      const project = await storage.getProject(projectId);
      if (!project || !admin && !await storage.isUserAssignedToProject(user.id, projectId))
        return res.status(403).json({ message: "Project access required." });
      if (project.isActive === false && !await storage.hasPermission(user, "projects.viewInactive"))
        return res.status(403).json({ message: "Inactive project access required." });
      if (req.method !== "GET" && !admin && !await storage.hasPermission(user, "projects.manageTroubleCodes"))
        return res.status(403).json({ message: "Project trouble-code management permission required." });
      res.locals.troubleProjectId = projectId;
      next();
    } catch (error) { troubleCodeError(error, res); }
  };
  app.get(base, isAuthenticated, authorize, async (_req, res) => {
    try { res.json(await storage.getTroubleCodes(res.locals.troubleProjectId)); } catch (error) { troubleCodeError(error, res); }
  });
  app.post(base, isAuthenticated, authorize, async (req, res) => {
    try {
      const d = createTroubleCodeFields.parse(req.body);
      res.status(201).json(await storage.createTroubleCode({ ...d, projectId: res.locals.troubleProjectId, ruleKey: randomUUID(), active: true }));
    } catch (error) { troubleCodeError(error, res); }
  });
  for (const method of ["patch", "delete"] as const) app[method](`${base}/:id`, isAuthenticated, authorize, async (req, res) => {
    try {
      const id = z.coerce.number().int().positive().parse(req.params.id);
      const data = method === "delete" ? { active: false } : patchTroubleCodeFields.parse(req.body);
      const columns: Record<string,string> = { code: "code", label: "label", description: "description", sortOrder: "sort_order", active: "active" };
      const entries = Object.entries(data);
      const updated = await pool.query(`UPDATE public.trouble_codes SET ${entries.map(([k], i) => `${columns[k]}=$${i+1}`).join(",")},updated_at=now()
        WHERE id=$${entries.length+1} AND project_id=$${entries.length+2} RETURNING id`,
        [...entries.map(([,v])=>v),id,res.locals.troubleProjectId]);
      if (!updated.rowCount) return res.status(404).json({ message: "Project trouble code not found. Core codes are read-only here." });
      res.json((await storage.getTroubleCodes(res.locals.troubleProjectId)).find(d => d.id === id));
    } catch (error) { troubleCodeError(error, res); }
  });
}
