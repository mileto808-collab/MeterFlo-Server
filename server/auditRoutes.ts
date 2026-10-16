import type { Express, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { pool } from "./db";
import { storage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { auditContext } from "./auditContext";
import { auditFiltersSchema, auditPermissions, supportedAuditActions } from "../shared/audit";
import { auditInventory, cleanupAudit, previewAuditCleanup, saveAuditPolicy, safeAuditLabel } from "./auditService";
import { auditEntitySql, auditReadFrom, readableAuditEvents } from "./auditReadModel";

export const auditActorMiddleware:RequestHandler=async(req:any,res,next)=>{
  try {
    const sub=req.isAuthenticated?.() && req.user?.claims?.sub;
    const user=sub ? await storage.getUser(sub) : undefined;
    if (!user) return next();
    const source=req.path.startsWith("/api/mobile")||req.path.includes("/mobile/")||req.path.includes("/sync")?"mobile":
      req.path.includes("/import")?"manualImport":req.path.includes("/restore")?"restore":
      req.path.includes("/backup")?"backup":"web";
    auditContext.run({actorId:user.id,actorLabel:user.username || user.id,actorKind:"user",source,operationId:randomUUID()},next);
  } catch { res.status(503).json({message:"Unable to establish audit identity; try again later."}); }
};
export function registerAuditRoutes(app:Express) {
  app.use("/api/audit",isAuthenticated,async(req:any,res,next)=>{
    try {
      const user=await storage.getUser(req.user.claims.sub);
      if (!user || !await storage.hasPermission(user,auditPermissions.view)) return res.status(403).json({message:"Audit view permission required."});
      const all=await storage.hasPermission(user,auditPermissions.all);
      const manage=all && await storage.hasPermission(user,auditPermissions.manage);
      const {rows}=all ? {rows:[]} : await pool.query(`SELECT project_id id FROM public.user_projects WHERE user_id=$1
        UNION SELECT gp.project_id id FROM public.user_group_projects gp
        JOIN public.user_group_members gm ON gm.group_id=gp.group_id WHERE gm.user_id=$1`,[user.id]);
      res.locals.audit={user,all,manage,projectIds:rows.map(r=>r.id)};
      res.set("Cache-Control","no-store"); next();
    } catch { res.status(503).json({message:"Audit permission verification unavailable."}); }
  });
  const handler=(fn:(req:any,res:any)=>Promise<unknown>)=>async(req:any,res:any)=>{
    try {res.json(await fn(req,res));}
    catch(e) {
      if (e instanceof ZodError) return res.status(400).json({message:"Invalid audit filters or settings."});
      res.status((e as any).status || 500).json({message:(e as any).status ? (e as Error).message : "Audit operation could not complete. No success is assumed."});
    }
  };
  const scope=(res:any,values:unknown[],alias="")=>{
    if (res.locals.audit.all) return "true";
    values.push(res.locals.audit.projectIds);
    return `${alias}project_id=ANY($${values.length}::integer[])`;
  };
  const requireManage:RequestHandler=(_req,res,next)=>{
    if (!res.locals.audit.manage) return res.status(403).json({message:"Global audit retention requires audit-view, all-projects and retention permissions."});
    next();
  };
  app.get("/api/audit/options",handler(async(_req,res)=>{
    const values:unknown[]=[],where=scope(res,values);
    const [actors,projects,actions,types,timezone]=await Promise.all([
      pool.query(`SELECT DISTINCT coalesce(actor_id,'system') id,actor_label label FROM meterflo_audit.events WHERE ${where} ORDER BY label`,values),
      pool.query(`SELECT p.id,p.name FROM public.projects p
        WHERE ${res.locals.audit.all ? "true" : "p.id=ANY($1::integer[])"}
        UNION ALL
        SELECT historical.id,historical.name FROM (
          SELECT DISTINCT ON (e.project_id) e.project_id id,
            coalesce(e.project_label,'Project ' || e.project_id::text) name
          FROM meterflo_audit.events e WHERE ${where} AND e.project_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM public.projects p WHERE p.id=e.project_id)
          ORDER BY e.project_id,e.occurred_at DESC,e.sequence DESC
        ) historical ORDER BY name,id`,values),
      pool.query(`SELECT DISTINCT action FROM meterflo_audit.events WHERE ${where} ORDER BY action`,values),
      pool.query(`SELECT DISTINCT entity_type FROM meterflo_audit.events WHERE ${where} ORDER BY entity_type`,values),
      storage.getSetting("default_timezone"),
    ]);
    let tz=timezone || "America/Denver";
    try {new Intl.DateTimeFormat("en",{timeZone:tz});} catch {tz="UTC";}
    return {actors:actors.rows,projects:projects.rows.map(p=>({...p,name:safeAuditLabel(p.name)})),
      actions:[...new Set([...supportedAuditActions,...actions.rows.map(r=>r.action)])],
      entityTypes:types.rows.map(r=>r.entity_type),timezone:tz,canManage:res.locals.audit.manage,canViewAll:res.locals.audit.all};
  }));
  app.get("/api/audit/retention",requireManage,handler(()=>auditInventory()));
  app.put("/api/audit/retention",requireManage,handler(req=>saveAuditPolicy(req.body)));
  app.post("/api/audit/retention/preview",requireManage,handler(async(req,res)=>{
    const {before}=z.object({before:z.string().datetime()}).strict().parse(req.body);
    try {return await previewAuditCleanup(res.locals.audit.user.id,before);} catch {throw Object.assign(new Error("Choose a valid cutoff in the past."),{status:400});}
  }));
  app.post("/api/audit/retention/cleanup",requireManage,handler(async(req,res)=>{
    const body=z.object({token:z.string().uuid(),confirm:z.literal(true)}).strict().parse(req.body);
    try {return await cleanupAudit(res.locals.audit.user.id,body.token);} catch {throw Object.assign(new Error("Cleanup not completed. Preview again; check retention settings and database availability."),{status:409});}
  }));
  const readEvents=async(req:any,res:any,exporting=false)=>{
    const f=auditFiltersSchema.parse(req.query),values:unknown[]=[],clauses=[scope(res,values,"e.")];
    const add=(sql:string,value:unknown)=>{values.push(value);clauses.push(sql.replace("?",`$${values.length}`));};
    if (f.from) add("e.occurred_at>=?",f.from); if(f.to) add("e.occurred_at<=?",f.to);
    if(f.actorId) add("coalesce(e.actor_id,'system')=?",f.actorId);
    if(f.projectId) add("e.project_id=?",f.projectId); if(f.action) add("e.action=?",f.action);
    if(f.entityType) add("e.entity_type=?",f.entityType);if(f.entityId) add("e.entity_id=?",f.entityId);
    if(f.outcome) add("e.outcome=?",f.outcome);
    if(f.q) {values.push(`%${f.q.replace(/[\\%_]/g,"\\$&")}%`);const n=values.length;
      clauses.push(`(${auditEntitySql} ILIKE $${n} OR e.entity_id ILIKE $${n} OR e.operation_id ILIKE $${n}
        OR e.actor_label ILIKE $${n} OR e.action ILIKE $${n} OR e.entity_type ILIKE $${n}
        OR coalesce(e.project_label,p.name) ILIKE $${n} OR e.outcome ILIKE $${n}
        OR ('Audit #'||e.sequence) ILIKE $${n})`);}
    const where=clauses.join(" AND ");
    const client=await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const {rows:[count]}=await client.query(`SELECT count(*)::int total FROM ${auditReadFrom} WHERE ${where}`,values);
      if(exporting && count.total>10000) throw Object.assign(new Error("More than 10,000 audit events match. Narrow the filters before exporting; no partial export was created."),{status:413});
      const limit=exporting ? 10000 : f.limit, offset=exporting ? 0 : f.offset;
      const {rows}=await client.query(`SELECT e.*,p.name current_project_label,${auditEntitySql} resolved_entity
        FROM ${auditReadFrom} WHERE ${where} ORDER BY e.occurred_at DESC,e.sequence DESC
        LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,limit,offset]);
      const events=await readableAuditEvents(client,rows);
      await client.query("COMMIT");
      return {events,total:count.total,limit,offset};
    } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
  };
  app.get("/api/audit",handler((req,res)=>readEvents(req,res)));
  app.get("/api/audit/export",handler((req,res)=>readEvents(req,res,true)));
  app.get("/api/audit/:id",handler(async(req,res)=>{
    const id=z.string().uuid().parse(req.params.id),values:unknown[]=[id],where=scope(res,values,"e.");
    const client=await pool.connect();
    try {
      const {rows:[row]}=await client.query(`SELECT e.*,p.name current_project_label,${auditEntitySql} resolved_entity
        FROM ${auditReadFrom} WHERE e.id=$1 AND ${where}`,values);
      if(!row) throw Object.assign(new Error("Audit event not found."),{status:404});
      return (await readableAuditEvents(client,[row]))[0];
    } finally {client.release();}
  }));
}
