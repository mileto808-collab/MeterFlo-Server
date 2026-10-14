import type { Express, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { pool } from "./db";
import { storage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { auditContext } from "./auditContext";
import { auditFiltersSchema, auditPermissions } from "../shared/audit";
import { auditInventory, cleanupAudit, eventDto, previewAuditCleanup, saveAuditPolicy } from "./auditService";

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
  const scope=(res:any,values:unknown[])=>{
    if (res.locals.audit.all) return "true";
    values.push(res.locals.audit.projectIds);
    return `project_id=ANY($${values.length}::integer[])`;
  };
  const requireManage:RequestHandler=(_req,res,next)=>{
    if (!res.locals.audit.manage) return res.status(403).json({message:"Global audit retention requires audit-view, all-projects and retention permissions."});
    next();
  };
  app.get("/api/audit/options",handler(async(_req,res)=>{
    const values:unknown[]=[],where=scope(res,values);
    const [actors,projects,actions,types,timezone]=await Promise.all([
      pool.query(`SELECT DISTINCT coalesce(actor_id,'system') id,actor_label label FROM meterflo_audit.events WHERE ${where} ORDER BY label`,values),
      pool.query(`SELECT DISTINCT project_id id,project_label name FROM meterflo_audit.events WHERE ${where} AND project_id IS NOT NULL ORDER BY name`,values),
      pool.query(`SELECT DISTINCT action FROM meterflo_audit.events WHERE ${where} ORDER BY action`,values),
      pool.query(`SELECT DISTINCT entity_type FROM meterflo_audit.events WHERE ${where} ORDER BY entity_type`,values),
      storage.getSetting("default_timezone"),
    ]);
    let tz=timezone || "America/Denver";
    try {new Intl.DateTimeFormat("en",{timeZone:tz});} catch {tz="UTC";}
    return {actors:actors.rows,projects:projects.rows,actions:actions.rows.map(r=>r.action),
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
  app.get("/api/audit",handler(async(req,res)=>{
    const f=auditFiltersSchema.parse(req.query),values:unknown[]=[],clauses=[scope(res,values)];
    const add=(sql:string,value:unknown)=>{values.push(value);clauses.push(sql.replace("?",`$${values.length}`));};
    if (f.from) add("occurred_at>=?",f.from); if(f.to) add("occurred_at<=?",f.to);
    if(f.actorId) add("coalesce(actor_id,'system')=?",f.actorId);
    if(f.projectId) add("project_id=?",f.projectId); if(f.action) add("action=?",f.action);
    if(f.entityType) add("entity_type=?",f.entityType);if(f.entityId) add("entity_id=?",f.entityId);
    if(f.outcome) add("outcome=?",f.outcome);
    if(f.q) {values.push(`%${f.q.replace(/[\\%_]/g,"\\$&")}%`);const n=values.length;
      clauses.push(`(entity_label ILIKE $${n} OR entity_id ILIKE $${n} OR operation_id ILIKE $${n})`);}
    const where=clauses.join(" AND ");
    const {rows:[count]}=await pool.query(`SELECT count(*)::int total FROM meterflo_audit.events WHERE ${where}`,values);
    const {rows}=await pool.query(`SELECT * FROM meterflo_audit.events WHERE ${where} ORDER BY occurred_at DESC,sequence DESC
      LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,f.limit,f.offset]);
    return {events:rows.map(eventDto),total:count.total,limit:f.limit,offset:f.offset};
  }));
  app.get("/api/audit/:id",handler(async(req,res)=>{
    const id=z.string().uuid().parse(req.params.id),values:unknown[]=[id],where=scope(res,values);
    const {rows:[row]}=await pool.query(`SELECT * FROM meterflo_audit.events WHERE id=$1 AND ${where}`,values);
    if(!row) throw Object.assign(new Error("Audit event not found."),{status:404});
    return eventDto(row);
  }));
}
