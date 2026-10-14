import type { Express, RequestHandler } from "express";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { loadCustomerRelease, publicRelease, ownedPath, type CustomerRelease } from "../shared/customer-release";
import { permissionKeys } from "../shared/schema";

export type ReportResult = { title: string; columns: string[]; rows: (string | number | boolean | null)[][] };
export type ReportContext = { apiVersion: 1; actor: {id: string; username: string | null};
  getProjects(): Promise<{id:number;name:string;isActive:boolean|null}[]> };
type Dependencies = { auth: RequestHandler; storage: {
  getUser(id:string): Promise<any>; hasPermission(user:any,key:string): Promise<boolean>;
  isAdminUser(user:any): Promise<boolean>; getProjects():Promise<any[]>; getUserProjects(id:string):Promise<any[]>;
}};
export function runtimeCustomerRelease(): CustomerRelease {
  if (process.env.NODE_ENV === "production") {
    return JSON.parse(fs.readFileSync(path.join(__dirname,"customer-release.json"),"utf8"));
  }
  return loadCustomerRelease();
}
export function validateReport(result: unknown): asserts result is ReportResult {
  const r = result as ReportResult;
  if (!r || typeof r.title !== "string" || r.title.length > 200 || !Array.isArray(r.columns) || r.columns.length > 20 ||
      !r.columns.every(c=>typeof c === "string" && c.length <= 100) || !Array.isArray(r.rows) || r.rows.length > 1000 ||
      r.rows.some(row=>!Array.isArray(row) || row.length !== r.columns.length || row.some(cell=>
        !(cell === null || typeof cell === "boolean" || typeof cell === "number" && Number.isFinite(cell) ||
          typeof cell === "string" && cell.length <= 10000)))) throw new Error("Extension returned an invalid report");
}
export async function registerCustomerExtensions(app: Express, dependencies: Dependencies, release = runtimeCustomerRelease(),
  load?: (extension: CustomerRelease["extensions"][number])=>Promise<any>) {
  if (release.blockers.length) throw new Error("Customer extensions are incompatible or migration readiness is blocked");
  const allowedPermissions = new Set<string>(Object.values(permissionKeys));
  const modules = new Map<string,any>();
  for (const x of release.extensions) {
    if (!allowedPermissions.has(x.permission)) throw new Error("Extension references an unregistered permission; use normal MeterFlo role permissions");
    const module = load ? await load(x) : process.env.NODE_ENV === "production"
      ? createRequire(path.join(__dirname,"index.cjs"))(path.join(__dirname,"extensions",`${x.id}.cjs`))
      : await import(pathToFileURL(ownedPath(ownedPath(process.cwd(),x.directory),x.serverEntry)).href);
    if (!module.reports || x.screens.some(s=>typeof module.reports[s.report] !== "function"))
      throw new Error("Extension report exports do not match the declared screens");
    modules.set(x.id,module);
  }
  const actor = async (req:any) => dependencies.storage.getUser(req.user.claims.sub);
  app.get("/api/customer-extensions",dependencies.auth,async(req:any,res,next)=>{
    try {
      const user=await actor(req);if(!user)return res.status(401).json({message:"Unauthorized"});
      const visible=[];
      for(const x of release.extensions)if(await dependencies.storage.hasPermission(user,x.permission))
        visible.push({id:x.id,name:x.name,version:x.version,screens:x.screens});
      res.json(visible);
    } catch(error){next(error);}
  });
  app.get("/api/customer-extensions/:extensionId/reports/:reportId",dependencies.auth,async(req:any,res,next)=>{
    try {
      const x=release.extensions.find(x=>x.id===req.params.extensionId);
      if(!x || !x.screens.some(s=>s.report===req.params.reportId))return res.status(404).json({message:"Unknown extension report"});
      const user=await actor(req);if(!user)return res.status(401).json({message:"Unauthorized"});
      if(!await dependencies.storage.hasPermission(user,x.permission))return res.status(403).json({message:"Forbidden"});
      const context:ReportContext={apiVersion:1,actor:{id:user.id,username:user.username},
        getProjects:async()=>{
          if(!await dependencies.storage.hasPermission(user,"projects.view"))throw new Error("Project-view permission required");
          const projects=user.role==="admin" || await dependencies.storage.isAdminUser(user)
            ? await dependencies.storage.getProjects() : await dependencies.storage.getUserProjects(user.id);
          return projects.map(p=>({id:p.id,name:p.name,isActive:p.isActive}));
        }};
      const result=await modules.get(x.id).reports[req.params.reportId](context);
      validateReport(result);res.json(result);
    } catch {res.status(500).json({message:"Customer report failed; contact the extension maintainer"});}
  });
  app.get("/api/system/customer-release",dependencies.auth,async(req:any,res,next)=>{
    try{
      const user=await actor(req);
      if(!user || !await dependencies.storage.hasPermission(user,permissionKeys.SETTINGS_WEB_UPDATE))
        return res.status(403).json({message:"Forbidden"});
      res.json(publicRelease(release));
    }catch(error){next(error);}
  });
  // No customer data, configuration, secrets or report output in the readiness response.
  app.get("/api/system/release-health",(_req,res)=>res.json({
    ready:true,version:release.version,extensions:release.extensions.map(x=>({id:x.id,version:x.version,contentHash:x.contentHash})),
  }));
}
