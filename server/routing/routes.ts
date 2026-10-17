import { createHash } from "node:crypto";
import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { pool } from "../db";
import { isAuthenticated } from "../replitAuth";
import { getProjectWorkOrderStorage } from "../projectDb";
import { listSubStatuses } from "../workOrderSubStatuses";
import { assertProjectCredentialReferences, consumeRoutingQuota, effectiveRouting, readRoutingConfiguration, routingConfigurationSchema, saveRoutingConfiguration } from "./configuration";
import { routingService, RoutingError } from "./providers";
import { optimizeStops, type Candidate } from "./optimizer";
import type { RoutePoint, RoutingResult } from "../../shared/workOrderRouting";

const point=z.object({lat:z.number().finite().min(-90).max(90),lng:z.number().finite().min(-180).max(180)}).strict();
const idsSchema=z.array(z.number().int().positive()).min(1).max(50).refine(ids=>new Set(ids).size===ids.length);
const planSchema=z.object({ids:idsSchema,origin:z.union([point,z.object({address:z.string().trim().min(5).max(400)}).strict()]),
  departureAt:z.string().datetime({offset:true}),serviceMinutes:z.number().int().min(1).max(480).optional(),toleranceMinutes:z.number().int().min(0).max(240).optional()}).strict();
const running=new Set<string>(),lastRequest=new Map<string,number>();
export function parseGps(value:unknown):RoutePoint|null {
  if(typeof value!=="string")return null;
  const match=value.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if(!match)return null;
  const parsed=point.safeParse({lat:Number(match[1]),lng:Number(match[2])});
  return parsed.success?parsed.data:null;
}
export function routeFingerprint(orders:any[], definitions:any[], project?: { defaultServiceMinutes?: number | null; defaultAppointmentToleranceMinutes?: number | null }) {
  const defs=new Map(definitions.map(d=>[d.id,d]));
  return createHash("sha256").update(JSON.stringify([project?.defaultServiceMinutes??null,project?.defaultAppointmentToleranceMinutes??null,
    [...orders].sort((a,b)=>a.id-b.id).map(wo=>[
    "visit-scheduling-v1",wo.id,wo.status,wo.scheduledAt,wo.serviceDurationMinutes,wo.appointmentWindowStart,wo.appointmentWindowEnd,wo.updatedAt,wo.address,wo.city,wo.state,wo.zip,
    wo.oldGps,wo.newGps,wo.assignedUserId,wo.assignedGroupId,wo.subStatusId,
    defs.get(wo.subStatusId)?.routingPriority??null,defs.get(wo.subStatusId)?.label??null,
  ])])).digest("hex");
}
// Dependency injection is limited to server construction for isolated acceptance
// tests; it is never controlled by an HTTP parameter or persisted setting.
export function registerRoutingRoutes(app:Express, services = { effectiveRouting, routingService, consumeRoutingQuota }) {
  const { effectiveRouting: readEffective, routingService: makeProvider, consumeRoutingQuota: consumeQuota }=services;
  const wrap=(fn:(req:any,res:any)=>Promise<any>)=>async(req:any,res:any)=>{
    try{await fn(req,res);}catch(e:any){
      if(e instanceof z.ZodError)return res.status(400).json({message:"Invalid routing fields.",errors:e.issues});
      if(e instanceof RoutingError)return res.status(e.status).json({message:e.message});
      console.error("Routing operation failed",{code:e.code??"internal"});
      if(!res.headersSent)res.status(500).json({message:"Routing operation failed. Your work orders have not been changed."});
    }
  };
  async function access(req:any,projectRequired=true) {
    const user=await storage.getUser(req.user?.claims?.sub);
    if(!user||user.isLocked)throw new RoutingError(401,"Sign in required.");
    const admin=await storage.isAdminUser(user);
    if(!projectRequired){if(!admin)throw new RoutingError(403,"Instance administrator access required.");return {user,admin,project:undefined};}
    const id=z.coerce.number().int().positive().parse(req.params.projectId);
    const project=await storage.getProject(id);
    if(!project)throw new RoutingError(404,"Project not found.");
    if(user.role==="customer"||!admin&&!await storage.isUserAssignedToProject(user.id,id)&&!await storage.hasPermission(user,"projects.view"))
      throw new RoutingError(403,"Project access required.");
    if(project.isActive===false&&!admin&&!await storage.hasPermission(user,"projects.viewInactive"))
      throw new RoutingError(403,"Inactive project access required.");
    if(!await storage.hasPermission(user,"workOrders.view"))throw new RoutingError(403,"Work order view permission required.");
    return {user,admin,project};
  }
  async function candidates(req:any,ids:number[]){
    const ctx=await access(req);
    if(!await storage.hasPermission(ctx.user,"workOrders.optimizeRoute"))throw new RoutingError(403,"Optimize route permission required.");
    const project=ctx.project!;
    if(!project.databaseName)throw new RoutingError(404,"Project database unavailable.");
    // Match existing Work Orders visibility exactly, including claimed group work.
    const all=await getProjectWorkOrderStorage(project.databaseName).getWorkOrders();
    let visible=all;
    if(ctx.user.subroleId){
      const role=await storage.getSubrole(ctx.user.subroleId);
      if(role?.key==="field_technician"){
        const groups=(await storage.getUserGroupMemberships(ctx.user.id)).map(g=>g.name);
        visible=all.filter(wo=>wo.assignedUserId===ctx.user.id||!!wo.assignedGroupId&&groups.includes(wo.assignedGroupId)&&!wo.assignedUserId);
      }
    }
    const wanted=new Set(ids),orders=visible.filter(wo=>wanted.has(wo.id));
    if(orders.length!==ids.length)throw new RoutingError(403,"One or more selected work orders are no longer available. Refresh the list.");
    const definitions=await listSubStatuses(project.id);
    return {...ctx,project,orders,definitions};
  }
  for(const base of ["/api/routing/settings","/api/projects/:projectId/routing/settings"]){
    const scoped=base.includes(":projectId");
    app.get(base,isAuthenticated,wrap(async(req,res)=>{
      const ctx=await access(req,scoped);
      const canManage=ctx.admin||scoped&&await storage.hasPermission(ctx.user,"projects.edit");
      res.set("Cache-Control","no-store").json((await readEffective(ctx.project?.id,canManage)).result);
    }));
    app.put(base,isAuthenticated,wrap(async(req,res)=>{
      const ctx=await access(req,scoped);
      if(!ctx.admin&&(!scoped||!await storage.hasPermission(ctx.user,"projects.edit")))throw new RoutingError(403,"Project edit permission required.");
      const input=routingConfigurationSchema.parse(req.body);
      if(ctx.project)assertProjectCredentialReferences(input,ctx.project.id,ctx.admin,await readRoutingConfiguration(ctx.project.id));
      await saveRoutingConfiguration(ctx.project?.id,input);
      res.json((await readEffective(ctx.project?.id,true)).result);
    }));
  }
  app.get("/api/projects/:projectId/routing/map-config",isAuthenticated,wrap(async(req,res)=>{
    const ctx=await access(req);
    if(!await storage.hasPermission(ctx.user,"workOrders.optimizeRoute"))throw new RoutingError(403,"Optimize route permission required.");
    const config=await readEffective(ctx.project!.id);
    if(!config.result.mapReady)throw new RoutingError(503,"Map display is not configured. Add a separate domain-restricted browser key.");
    res.set("Cache-Control","no-store").json({provider:config.effective.provider,browserKey:config.browserKey});
  }));
  app.post("/api/projects/:projectId/routing/validate",isAuthenticated,wrap(async(req,res)=>{
    const input=z.object({ids:idsSchema,fingerprint:z.string().length(64),configurationRevision:z.string().length(64)}).strict().parse(req.body);
    const ctx=await candidates(req,input.ids),config=await readEffective(ctx.project.id);
    res.set("Cache-Control","no-store").json({stale:!config.result.ready||config.result.revision!==input.configurationRevision||
      routeFingerprint(ctx.orders,ctx.definitions,ctx.project)!==input.fingerprint});
  }));
  app.post("/api/projects/:projectId/routing/plan",isAuthenticated,wrap(async(req,res)=>{
    const input=planSchema.parse(req.body),ctx=await candidates(req,input.ids);
    const serviceMinutes=input.serviceMinutes??ctx.project.defaultServiceMinutes??45;
    const toleranceMinutes=input.toleranceMinutes??ctx.project.defaultAppointmentToleranceMinutes??10;
    const durationSource = input.serviceMinutes!==undefined && input.serviceMinutes!==(ctx.project.defaultServiceMinutes??45)
      ? "route" : ctx.project.defaultServiceMinutes!=null ? "project" : "legacy";
    const actor=ctx.user.id;
    if(running.has(actor)||Date.now()-(lastRequest.get(actor)??0)<10000)throw new RoutingError(429,"A route is already running or was just requested. Please wait before replanning.");
    const config=await readEffective(ctx.project.id);
    if(!config.result.ready)throw new RoutingError(503,config.result.message);
    const scheduled=ctx.orders.filter(o=>o.status==="Scheduled");
    if(scheduled.length>config.effective.maxStops)throw new RoutingError(422,`This provider configuration allows ${config.effective.maxStops} stops. Narrow your filters or select fewer rows.`);
    if(!scheduled.length)throw new RoutingError(422,"No Scheduled work orders remain in this scope.");
    const departure=Date.parse(input.departureAt);
    if(departure<Date.now()-15*60000||departure>Date.now()+7*86400000)throw new RoutingError(422,"Choose a departure between now and seven days ahead.");
    running.add(actor);lastRequest.set(actor,Date.now());
    // Map size is bounded even across long-running instances.
    if(lastRequest.size>10000)for(const [id,t]of lastRequest)if(Date.now()-t>60000)lastRequest.delete(id);
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
    const abort=()=>controller.abort();res.on("close",abort);
    try{
      await consumeQuota(config.effective.provider,config.serverKey,config.effective.dailyPlans);
      const provider=makeProvider(config.effective.provider,config.serverKey,controller.signal);
      const origin="address" in input.origin?await provider.geocode(input.origin.address):input.origin;
      const defs=new Map(ctx.definitions.map(d=>[d.id,d]));
      const resolved:Candidate[]=[],excluded:RoutingResult["excluded"]=ctx.orders.filter(o=>o.status!=="Scheduled")
        .map(o=>({id:o.id,label:String(o.customerWoId??o.id),reason:"Not Scheduled."}));
      for(const order of scheduled){
        if(controller.signal.aborted)throw new RoutingError(504,"Route planning timed out. Narrow the stop selection.");
        const address=[order.address,order.city,order.state,order.zip].filter(Boolean).join(", ");
        const label=String(order.customerWoId??order.id);
        try{
          const destination=parseGps(order.newGps)||parseGps(order.oldGps)||(address?await provider.geocode(address):null);
          if(!destination)throw new RoutingError(422,"Missing address and verified GPS coordinates.");
          const def=defs.get(order.subStatusId);
          resolved.push({id:order.id,label,address,point:destination,
            scheduledAt:order.scheduledAt?new Date(order.scheduledAt).toISOString():null,
            appointmentWindowStart:order.appointmentWindowStart?new Date(order.appointmentWindowStart).toISOString():null,
            appointmentWindowEnd:order.appointmentWindowEnd?new Date(order.appointmentWindowEnd).toISOString():null,
            serviceDurationMinutes:order.serviceDurationMinutes??serviceMinutes,
            durationSource:order.serviceDurationMinutes!=null?"work-order":durationSource,
            priority:def?.routingPriority??null,subStatus:def?.label??null});
        }catch(e){if(!(e instanceof RoutingError)||e.status!==422)throw e;excluded.push({id:order.id,label,reason:e.message});}
      }
      if(!resolved.length)throw new RoutingError(422,"No stops have a verified destination. Correct addresses or capture GPS coordinates.");
      const matrix=await provider.matrix([origin,...resolved.map(s=>s.point)]);
      // Explicitly identify stops disconnected from the origin.
      const unreachable=resolved.map((s,i)=>({s,i})).filter(({i})=>!matrix[0][i+1]);
      for(const {s}of unreachable)excluded.push({id:s.id,label:s.label,reason:"No driving route from the starting location."});
      const keep=resolved.map((_,i)=>i).filter(i=>!unreachable.some(u=>u.i===i));
      if(!keep.length)throw new RoutingError(422,"No selected stops are reachable by road.");
      const indices=[0,...keep.map(i=>i+1)],roadMatrix=indices.map(i=>indices.map(j=>matrix[i][j]));
      const stops=optimizeStops(keep.map(i=>resolved[i]),roadMatrix,departure,serviceMinutes,toleranceMinutes);
      const geometry=await provider.geometry([origin,...stops.map(s=>s.point)]);
      const warnings=["Driving times are estimates, not live traffic. This bounded planning method does not guarantee a mathematically optimal route.",
        `Explicit windows constrain service start without extra tolerance. Other appointments remain start times with ${toleranceMinutes} minutes tolerance. Early arrivals wait. Default service: ${serviceMinutes} minutes; individual overrides are shown per stop.`];
      if(stops.some(s=>s.lateMinutes>0))warnings.push("Some appointments cannot be met within tolerance. Review the displayed lateness before driving.");
      if(stops.some(s=>s.appointmentSource==="none"))warnings.push("Some Scheduled orders have no appointment time or window; they are explicitly marked unscheduled.");
      if(excluded.length)warnings.push(`${excluded.length} selected orders were excluded. Review their reasons; they were not silently dropped.`);
      const result:RoutingResult={projectId:ctx.project.id,provider:config.effective.provider,
        configurationRevision:config.result.revision,fingerprint:routeFingerprint(ctx.orders,ctx.definitions,ctx.project),
        createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+4*3600000).toISOString(),
        departureAt:input.departureAt,origin,stops,excluded,warnings,geometry,
        totalTravelSeconds:stops.reduce((s,c)=>s+c.travelSeconds,0),totalTravelMeters:stops.reduce((s,c)=>s+c.travelMeters,0),
        serviceMinutes,toleranceMinutes};
      res.set("Cache-Control","no-store").json(result);
    }finally{clearTimeout(timer);res.off("close",abort);running.delete(actor);}
  }));
}
