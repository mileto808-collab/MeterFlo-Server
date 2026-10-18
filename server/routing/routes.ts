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
import { destinationAddress, destinationPolicy, resolveDestination } from "./destinations";
import { createAddressReview, manualAddressFields, readAddressConfirmation, reviewHash } from "./addressReview";
export { parseGps } from "./destinations";
import { optimizeStops, type Candidate } from "./optimizer";
import { DispatchCache, type DispatchEntry } from "./dispatchCache";
import type { AddressMatchSummary, AddressReview, GeocodedPoint, RoutePoint, RoutingResult } from "../../shared/workOrderRouting";

const point=z.object({lat:z.number().finite().min(-90).max(90),lng:z.number().finite().min(-180).max(180)}).strict();
const idsSchema=z.array(z.number().int().positive()).min(1).max(50).refine(ids=>new Set(ids).size===ids.length);
const planSchema=z.object({ids:idsSchema,origin:z.union([point,z.object({address:z.string().trim().min(5).max(400)}).strict()]),
  departureAt:z.string().datetime({offset:true}),serviceMinutes:z.number().int().min(1).max(480).optional(),toleranceMinutes:z.number().int().min(0).max(240).optional(),
  addressConfirmations:z.array(z.string().min(1).max(1024)).max(51).optional()}).strict();
const running=new Set<string>(),lastRequest=new Map<string,number>(),continuedAt=new Map<string,number>();
export function routeFingerprint(orders:any[], definitions:any[], project?: { defaultServiceMinutes?: number | null; defaultAppointmentToleranceMinutes?: number | null }) {
  const defs=new Map(definitions.map(d=>[d.id,d]));
  return createHash("sha256").update(JSON.stringify([destinationPolicy,project?.defaultServiceMinutes??null,project?.defaultAppointmentToleranceMinutes??null,
    [...orders].sort((a,b)=>a.id-b.id).map(wo=>[
    "per-assignee-routing-v1",wo.id,wo.status,wo.scheduledAt,wo.serviceDurationMinutes,wo.appointmentWindowStart,wo.appointmentWindowEnd,wo.updatedAt,wo.address,wo.city,wo.state,wo.zip,
    wo.oldGps,wo.newGps,wo.assignedUserId,wo.assignedGroupId,wo.subStatusId,
    defs.get(wo.subStatusId)?.routingPriority??null,defs.get(wo.subStatusId)?.label??null,
  ])])).digest("hex");
}
// Dependency injection is limited to server construction for isolated acceptance
// tests; it is never controlled by an HTTP parameter or persisted setting.
export function registerRoutingRoutes(app:Express, services = { effectiveRouting, routingService, consumeRoutingQuota }) {
  const dispatchCache = new DispatchCache();
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
    // Match the technician grid scope, not unclaimed group work or another technician.
    const all=await getProjectWorkOrderStorage(project.databaseName).getWorkOrders();
    let visible=all;
    if(ctx.user.subroleId){
      const role=await storage.getSubrole(ctx.user.subroleId);
      if(role?.key==="field_technician"&&!ctx.admin){
        visible=all.filter(wo=>wo.status==="Scheduled"&&wo.assignedUserId===ctx.user.id);
      }
    }
    const wanted=new Set(ids),orders=visible.filter(wo=>wanted.has(wo.id));
    if(orders.length!==ids.length)throw new RoutingError(403,"One or more selected work orders are no longer available. Refresh the list.");
    const definitions=await listSubStatuses(project.id);
    return {...ctx,project,orders,definitions};
  }
  async function assertDispatcher(user:any) {
    const role=user.subroleId?await storage.getSubrole(user.subroleId):undefined;
    if(!await storage.hasPermission(user,"workOrders.optimizeRoute") ||
      role?.key==="field_technician"&&!await storage.isAdminUser(user))
      throw new RoutingError(403,"Dispatch requires authorized support or manager access.");
  }
  async function checkDispatch(req:any,entry:DispatchEntry) {
    const route=entry.route;
    const ctx=await candidates(req,route.scopeIds!);
    if(ctx.project.id!==route.projectId)throw new RoutingError(404,"Dispatched route not available.");
    const planner=await storage.getUser(entry.plannerId);
    if(!planner||planner.isLocked)throw new RoutingError(403,"Dispatch authorization is no longer available.");
    await assertDispatcher(planner);
    // Recheck both parties' project access, not just the actor's global view permission.
    for(const actor of [planner,await storage.getUser(route.assigneeId!)]){
      if(!actor||actor.isLocked||actor.role==="customer")
        throw new RoutingError(403,"Dispatch project assignment or route permission is no longer available.");
      if((!await storage.isAdminUser(actor)&&!await storage.isUserAssignedToProject(actor.id,route.projectId)) ||
        !await storage.hasPermission(actor,"workOrders.view") ||
        !await storage.hasPermission(actor,"workOrders.optimizeRoute"))
        throw new RoutingError(403,"Dispatch project assignment or route permission is no longer available.");
    }
    if(ctx.project.isActive===false)throw new RoutingError(409,"Inactive projects cannot activate dispatched routes.");
    if(ctx.orders.some(order=>order.status!=="Scheduled"||order.assignedUserId!==route.assigneeId))
      throw new RoutingError(409,"Route assignments or work-order status changed. Ask dispatch to plan again.");
    const config=await readEffective(ctx.project.id);
    if(!config.result.ready||config.result.revision!==route.configurationRevision||
      routeFingerprint(ctx.orders,ctx.definitions,ctx.project)!==route.fingerprint||
      route.addressReviewVersion!==1||route.assignmentRoutingVersion!==1||
      Date.parse(route.expiresAt)<=Date.now()||(!entry.activatedAt&&Date.parse(route.departureAt)<Date.now()-15*60000)||
      Date.parse(route.departureAt)>Date.now()+7*86400000)
      throw new RoutingError(409,"Route details, address review, departure assumptions or provider settings are out of date. Ask dispatch to plan again.");
    return ctx;
  }
  const dispatchId=z.string().uuid();
  app.post("/api/projects/:projectId/routing/dispatch",isAuthenticated,wrap(async(req,res)=>{
    const {planId}=z.object({planId:dispatchId}).strict().parse(req.body);
    const ctx=await access(req);
    await assertDispatcher(ctx.user);
    const entry=dispatchCache.get(planId);
    if(!entry||entry.plannerId!==ctx.user.id||entry.route.projectId!==ctx.project!.id)
      throw new RoutingError(404,"This plan is no longer available. Plan again before dispatching.");
    if(!entry.shareableOrigin)throw new RoutingError(422,"Device locations cannot be dispatched. Plan from an entered warehouse or starting address.");
    await checkDispatch(req,entry);
    entry.dispatched=true;
    res.set("Cache-Control","no-store").json({id:entry.id,expiresAt:entry.route.expiresAt});
  }));
  app.get("/api/projects/:projectId/routing/dispatched",isAuthenticated,wrap(async(req,res)=>{
    const ctx=await access(req);
    if(!await storage.hasPermission(ctx.user,"workOrders.optimizeRoute"))throw new RoutingError(403,"Optimize route permission required.");
    const summaries=[];
    for(const entry of dispatchCache.received(ctx.project!.id,ctx.user.id)){
      try{await checkDispatch(req,entry);}
      catch(error){if(error instanceof RoutingError)continue;throw error;}
      summaries.push({id:entry.id,departureAt:entry.route.departureAt,expiresAt:entry.route.expiresAt,
        stopCount:entry.route.stops.length,originAddress:entry.route.originAddress});
    }
    res.set("Cache-Control","no-store").json(summaries);
  }));
  app.post("/api/projects/:projectId/routing/dispatched/:dispatchId/open",isAuthenticated,wrap(async(req,res)=>{
    const ctx=await access(req),id=dispatchId.parse(req.params.dispatchId);
    const entry=dispatchCache.get(id);
    if(!entry||!entry.dispatched||entry.route.projectId!==ctx.project!.id||entry.route.assigneeId!==ctx.user.id)
      throw new RoutingError(404,"Dispatched route not available. Ask dispatch to send a current plan.");
    await checkDispatch(req,entry);
    // Once started, the original departure remains the route's baseline for
    // estimates. Do not force a re-plan every fifteen minutes mid-route.
    entry.activatedAt??=Date.now();
    const route={...entry.route,receivedDispatchId:entry.id};
    res.set("Cache-Control","no-store").json({...route,routes:[route]});
  }));
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
    const input=z.object({ids:idsSchema,fingerprint:z.string().length(64),configurationRevision:z.string().length(64),receivedDispatchId:dispatchId.optional()}).strict().parse(req.body);
    if(input.receivedDispatchId){
      const ctx=await access(req),entry=dispatchCache.get(input.receivedDispatchId);
      if(!entry||!entry.dispatched||entry.route.projectId!==ctx.project!.id||entry.route.assigneeId!==ctx.user.id)
        throw new RoutingError(403,"Dispatched route access is no longer available.");
      await checkDispatch(req,entry);
      return res.set("Cache-Control","no-store").json({stale:entry.route.fingerprint!==input.fingerprint||
        entry.route.configurationRevision!==input.configurationRevision||
        JSON.stringify([...entry.route.scopeIds!].sort((a,b)=>a-b))!==JSON.stringify([...input.ids].sort((a,b)=>a-b))});
    }
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
    const config=await readEffective(ctx.project.id);
    const scheduled=ctx.orders.filter(o=>o.status==="Scheduled");
    if(!scheduled.length)throw new RoutingError(422,"No Scheduled work orders remain in this scope.");
    const assigned=scheduled.filter(o=>!!o.assignedUserId);
    if(!assigned.length)throw new RoutingError(422,"The Scheduled work orders are unassigned. Assign them to a technician before optimizing routes.");
    const assignments=new Map<string,typeof assigned>();
    for(const order of assigned){
      const group=assignments.get(order.assignedUserId!)??[];
      group.push(order);assignments.set(order.assignedUserId!,group);
    }
    if([...assignments.values()].some(group=>group.length>config.effective.maxStops))
      throw new RoutingError(422,`This provider configuration allows ${config.effective.maxStops} stops per technician. Narrow your filters or select fewer rows for that technician.`);
    const {addressConfirmations=[],...planningInput}=input;
    const confirmationScope=reviewHash([ctx.user.id,ctx.project.id,planningInput,
      routeFingerprint(ctx.orders,ctx.definitions,ctx.project),config.result.revision]);
    const actor=ctx.user.id;
    // One signed review continuation may proceed immediately; replays still
    // observe the normal rate limit and every request consumes provider quota.
    const continuation=Date.now()-(continuedAt.get(actor)??0)>=10000&&
      addressConfirmations.some(token=>!!readAddressConfirmation(token,confirmationScope));
    if(running.has(actor)||Date.now()-(lastRequest.get(actor)??0)<10000&&!continuation)
      throw new RoutingError(429,"A route is already running or was just requested. Please wait before replanning.");
    if(!config.result.ready)throw new RoutingError(503,config.result.message);
    const departure=Date.parse(input.departureAt);
    if(departure<Date.now()-15*60000||departure>Date.now()+7*86400000)throw new RoutingError(422,"Choose a departure between now and seven days ahead.");
    running.add(actor);lastRequest.set(actor,Date.now());
    if(continuation)continuedAt.set(actor,Date.now());
    // Map size is bounded even across long-running instances.
    if(lastRequest.size>10000)for(const [id,t]of lastRequest)if(Date.now()-t>60000){lastRequest.delete(id);continuedAt.delete(id);}
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),90000);
    const abort=()=>controller.abort();res.on("close",abort);
    try{
      await consumeQuota(config.effective.provider,config.serverKey,config.effective.dailyPlans);
      const provider=makeProvider(config.effective.provider,config.serverKey,controller.signal);
      const addressReviews:AddressReview[]=[],confirmedAddressMatches:AddressMatchSummary[]=[];
      const review=(summary:Omit<AddressMatchSummary,"reasons"|"resolvedAddress">,
        expected:Parameters<typeof createAddressReview>[1],geocoded:GeocodedPoint)=>{
        const decision=createAddressReview(summary,expected,geocoded,confirmationScope,addressConfirmations);
        if(decision.pending)addressReviews.push(decision.pending);
        if(decision.confirmed)confirmedAddressMatches.push(decision.confirmed);
      };
      let origin:RoutePoint;
      if("address" in input.origin){
        const geocoded=await provider.geocode(input.origin.address);
        origin={lat:geocoded.lat,lng:geocoded.lng};
        review({id:"origin",kind:"origin",label:"Starting address",submittedAddress:input.origin.address,point:origin},
          manualAddressFields(input.origin.address),geocoded);
      }else origin=input.origin;
      const defs=new Map(ctx.definitions.map(d=>[d.id,d]));
      const resolved:(Candidate&{assigneeId:string})[]=[],excluded:RoutingResult["excluded"]=ctx.orders.filter(o=>o.status!=="Scheduled"||!o.assignedUserId)
        .map(o=>({id:o.id,label:String(o.customerWoId??o.id),reason:o.status!=="Scheduled"?"Not Scheduled.":"Unassigned. Assign this work order to a technician before optimizing."}));
      for(const order of assigned){
        if(controller.signal.aborted)throw new RoutingError(504,"Route planning timed out. Narrow the stop selection.");
        const address=destinationAddress(order);
        const label=String(order.customerWoId??order.id);
        try{
          const destination=await resolveDestination(order,provider,geocoded=>review({
            id:`stop-${order.id}`,kind:"stop",workOrderId:order.id,label:`Work order ${label}`,
            submittedAddress:address,point:{lat:geocoded.lat,lng:geocoded.lng},
          },{address:order.address||"",city:order.city,state:order.state,zip:order.zip},geocoded));
          const def=defs.get(order.subStatusId);
          resolved.push({id:order.id,label,address,point:destination,assigneeId:order.assignedUserId!,
            scheduledAt:order.scheduledAt?new Date(order.scheduledAt).toISOString():null,
            appointmentWindowStart:order.appointmentWindowStart?new Date(order.appointmentWindowStart).toISOString():null,
            appointmentWindowEnd:order.appointmentWindowEnd?new Date(order.appointmentWindowEnd).toISOString():null,
            serviceDurationMinutes:order.serviceDurationMinutes??serviceMinutes,
            durationSource:order.serviceDurationMinutes!=null?"work-order":durationSource,
            priority:def?.routingPriority??null,subStatus:def?.label??null});
        }catch(e){if(!(e instanceof RoutingError)||e.status!==422)throw e;excluded.push({id:order.id,label,reason:e.message});}
      }
      if(addressReviews.length)return res.status(409).set("Cache-Control","no-store").json({
        code:"ADDRESS_REVIEW_REQUIRED",message:"Review address matches before creating a route. No driving route has been activated.",
        addressReviews,
      });
      if(!resolved.length)throw new RoutingError(422,"No stops have a verified destination. Correct addresses or capture GPS coordinates.");
      const routes:RoutingResult[]=[];
      let matrixRequests=0;
      for(const [assigneeId,orders] of assignments){
        const group=resolved.filter(stop=>stop.assigneeId===assigneeId);
        if(!group.length)continue;
        const assignee=await storage.getUser(assigneeId);
        if(!assignee){
          for(const stop of group)excluded.push({id:stop.id,label:stop.label,reason:"Assigned user is unavailable. Reassign before optimizing."});
          continue;
        }
        if(matrixRequests++)await consumeQuota(config.effective.provider,config.serverKey,config.effective.dailyPlans);
        const matrix=await provider.matrix([origin,...group.map(s=>s.point)]);
        const unreachable=group.map((s,i)=>({s,i})).filter(({i})=>!matrix[0][i+1]);
        for(const {s}of unreachable)excluded.push({id:s.id,label:s.label,reason:"No driving route from the starting location."});
        const keep=group.map((_,i)=>i).filter(i=>!unreachable.some(u=>u.i===i));
        if(!keep.length)continue;
        const indices=[0,...keep.map(i=>i+1)],roadMatrix=indices.map(i=>indices.map(j=>matrix[i][j]));
        const stops=optimizeStops(keep.map(i=>group[i]),roadMatrix,departure,serviceMinutes,toleranceMinutes);
        const geometry=await provider.geometry([origin,...stops.map(s=>s.point)]);
        const ids=new Set(orders.map(order=>order.id));
        routes.push({assignmentRoutingVersion:1,addressReviewVersion:1,assigneeId,
          assigneeName:[assignee.firstName,assignee.lastName].filter(Boolean).join(" ")||assignee.username||"Assigned technician",
          originAddress:"address" in input.origin?input.origin.address:undefined,scopeIds:input.ids,
          projectId:ctx.project.id,provider:config.effective.provider,configurationRevision:config.result.revision,
          fingerprint:routeFingerprint(ctx.orders,ctx.definitions,ctx.project),createdAt:new Date().toISOString(),
          expiresAt:new Date(Date.now()+4*3600000).toISOString(),departureAt:input.departureAt,origin,stops,geometry,
          confirmedAddressMatches:confirmedAddressMatches.filter(match=>match.kind==="origin"||ids.has(match.workOrderId!)),
          excluded:excluded.filter(entry=>ids.has(entry.id)),warnings:[],
          totalTravelSeconds:stops.reduce((sum,stop)=>sum+stop.travelSeconds,0),
          totalTravelMeters:stops.reduce((sum,stop)=>sum+stop.travelMeters,0),serviceMinutes,toleranceMinutes});
      }
      if(!routes.length)throw new RoutingError(422,"No assigned Scheduled stops are reachable by road. Review addresses and assignments.");
      const stops=routes.flatMap(route=>route.stops);
      const warnings=["Driving times are estimates, not live traffic. This bounded planning method does not guarantee a mathematically optimal route.",
        `Explicit windows constrain service start without extra tolerance. Other appointments remain start times with ${toleranceMinutes} minutes tolerance. Early arrivals wait. Default service: ${serviceMinutes} minutes; individual overrides are shown per stop.`];
      if(stops.some(s=>s.lateMinutes>0))warnings.push("Some appointments cannot be met within tolerance. Review the displayed lateness before driving.");
      if(stops.some(s=>s.appointmentSource==="none"))warnings.push("Some Scheduled orders have no appointment time or window; they are explicitly marked unscheduled.");
      if(excluded.length)warnings.push(`${excluded.length} selected orders were excluded. Review their reasons; they were not silently dropped.`);
      if(confirmedAddressMatches.length)warnings.push(`${confirmedAddressMatches.length} address matches were manually confirmed for this plan; no work-order addresses or GPS history were changed.`);
      for(const route of routes){
        route.warnings=warnings.slice(0,2);
        if(route.stops.some(stop=>stop.lateMinutes>0))route.warnings.push("Some appointments on this technician's route cannot be met within tolerance.");
        if(route.stops.some(stop=>stop.appointmentSource==="none"))route.warnings.push("Some Scheduled orders on this route have no appointment time or window.");
        if(route.excluded.length)route.warnings.push(`${route.excluded.length} orders assigned to this technician could not be routed. Review the exclusions.`);
        if(route.confirmedAddressMatches?.length)route.warnings.push(`${route.confirmedAddressMatches.length} address matches were manually confirmed for this route; no saved work-order address or GPS history was changed.`);
        // Cache only this assignee's actual stops. Never leak the manager's
        // full selection, other assignees' exclusions or their fingerprints.
        const scopeIds=route.stops.map(stop=>stop.id);
        const ownOrders=ctx.orders.filter(order=>scopeIds.includes(order.id));
        const dispatchRoute={...route,scopeIds,excluded:[],
          confirmedAddressMatches:route.confirmedAddressMatches?.filter(match=>match.kind==="origin"||scopeIds.includes(match.workOrderId!)),
          fingerprint:routeFingerprint(ownOrders,ctx.definitions,ctx.project)};
        route.dispatchPlanId=dispatchCache.add(ctx.user.id,dispatchRoute,"address" in input.origin);
      }
      const result:RoutingResult={...routes[0],assignmentRoutingVersion:1,routes,scopeIds:input.ids,addressReviewVersion:1,confirmedAddressMatches,projectId:ctx.project.id,provider:config.effective.provider,
        configurationRevision:config.result.revision,fingerprint:routeFingerprint(ctx.orders,ctx.definitions,ctx.project),
        createdAt:routes[0].createdAt,expiresAt:new Date(Math.min(...routes.map(route=>Date.parse(route.expiresAt)))).toISOString(),
        departureAt:input.departureAt,origin,excluded,warnings,
        serviceMinutes,toleranceMinutes};
      res.set("Cache-Control","no-store").json(result);
    }finally{clearTimeout(timer);res.off("close",abort);running.delete(actor);}
  }));
}
