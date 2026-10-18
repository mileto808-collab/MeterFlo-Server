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
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.code IS DISTINCT FROM OLD.code
          OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.rule_key IS DISTINCT FROM OLD.rule_key THEN
          RAISE EXCEPTION 'Trouble code identity and scope cannot change; edit its label instead.' USING ERRCODE='23514';
        END IF;
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
      IF NEW.trouble IS NULL OR NEW.trouble='' THEN RETURN NEW; END IF;
      SELECT * INTO chosen FROM public.trouble_codes WHERE code=NEW.trouble FOR SHARE;
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
  await client.query(`DROP TRIGGER IF EXISTS guard_project_trouble_code ON "${schema}".work_orders;
    CREATE TRIGGER guard_project_trouble_code BEFORE INSERT OR UPDATE ON "${schema}".work_orders
      FOR EACH ROW EXECUTE FUNCTION public.guard_project_trouble_code();`);
}

export async function initializeAllProjectTroubleCodes() {
  const client = await pool.connect();
  try {
    await initializeProjectTroubleCodes(client);
    const { rows } = await client.query("SELECT database_name FROM public.projects WHERE database_name IS NOT NULL");
    for (const row of rows) {
      if (!/^project_[a-z0-9_]+$/.test(row.database_name)) continue;
      const exists = await client.query("SELECT to_regclass($1) AS t", [`"${row.database_name}".work_orders`]);
      if (exists.rows[0].t) await installProjectTroubleCodes(client, row.database_name);
    }
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
    const { rows: [existing] } = await client.query("SELECT * FROM public.trouble_codes WHERE code=$1 OR rule_key=$2 FOR UPDATE", [d.code, d.ruleKey]);
    if (d.projectId === null) {
      if (!existing || existing.code !== d.code || existing.project_id !== null)
        throw new Error(`Missing core trouble code ${d.code}; configure core definitions first.`);
      continue; // A project restore never rewrites core labels or identities.
    }
    if (existing) {
      if (existing.project_id !== project.id || existing.rule_key !== d.ruleKey || existing.code !== d.code)
        throw new Error("Trouble-code identity conflicts with another definition; no project data was restored.");
      await client.query(`UPDATE public.trouble_codes SET label=$1,description=$2,sort_order=$3,active=$4,updated_at=now() WHERE rule_key=$5`,
        [d.label, d.description ?? null, d.sortOrder ?? 0, d.active, d.ruleKey]);
    } else await client.query(`INSERT INTO public.trouble_codes(code,label,description,sort_order,project_id,rule_key,active)
      VALUES($1,$2,$3,$4,$5,$6,$7)`, [d.code,d.label,d.description??null,d.sortOrder??0,project.id,d.ruleKey,d.active]);
  }
  await client.query("SELECT set_config('meterflo.restore_trouble_codes','on',true)");
}

export function troubleCodeError(error: any, res: any) {
  if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid trouble-code fields. Identity fields cannot be edited.", errors: error.issues });
  if (error.code === "23505") return res.status(409).json({ message: "That immutable code key is already in use. Choose another code key." });
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
      const columns: Record<string,string> = { label: "label", description: "description", sortOrder: "sort_order", active: "active" };
      const entries = Object.entries(data);
      const updated = await pool.query(`UPDATE public.trouble_codes SET ${entries.map(([k], i) => `${columns[k]}=$${i+1}`).join(",")},updated_at=now()
        WHERE id=$${entries.length+1} AND project_id=$${entries.length+2} RETURNING id`,
        [...entries.map(([,v])=>v),id,res.locals.troubleProjectId]);
      if (!updated.rowCount) return res.status(404).json({ message: "Project trouble code not found. Core codes are read-only here." });
      res.json((await storage.getTroubleCodes(res.locals.troubleProjectId)).find(d => d.id === id));
    } catch (error) { troubleCodeError(error, res); }
  });
}
