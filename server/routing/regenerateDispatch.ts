import type { StoredDispatch } from "./dispatchStore";
import type { RoutingService } from "./providers";
import { RoutingError } from "./providers";
import { createAddressReview, manualAddressFields, reviewHash } from "./addressReview";
import { destinationAddress, resolveDestination } from "./destinations";
import { optimizeStops, type Candidate } from "./optimizer";
import type { AddressMatchSummary, AddressReview, GeocodedPoint, RoutingProvider, RoutingResult } from "../../shared/workOrderRouting";

export const dispatchReviewScope = (entry: StoredDispatch, actor: string) =>
  reviewHash(["dispatch-regeneration-v1",entry.id,actor,entry.route]);

/** Re-fetch licensed content, never resurrect the old provider result or its
 * confirmations. Preserve the dispatched business stop sequence and expiry. */
export async function regenerateDispatch(entry: StoredDispatch, orders: any[], definitions: any[],
  project: { defaultServiceMinutes?: number | null }, assigneeName: string, providerName: RoutingProvider, provider: RoutingService,
  actor: string, confirmations: string[]) {
  const r=entry.route, reviews:AddressReview[]=[], confirmed:AddressMatchSummary[]=[];
  const scope=dispatchReviewScope(entry,actor);
  const review=(summary:Omit<AddressMatchSummary,"reasons"|"resolvedAddress">,
    expected:Parameters<typeof createAddressReview>[1], geocoded:GeocodedPoint) => {
    const decision=createAddressReview(summary,expected,geocoded,scope,confirmations);
    if(decision.pending)reviews.push(decision.pending);
    if(decision.confirmed)confirmed.push(decision.confirmed);
  };
  const originResult=await provider.geocode(r.originAddress!);
  const origin={lat:originResult.lat,lng:originResult.lng};
  review({id:"origin",kind:"origin",label:"Starting address",submittedAddress:r.originAddress!,point:origin},
    manualAddressFields(r.originAddress!),originResult);
  const defs=new Map(definitions.map(d=>[d.id,d]));
  const durationSource=r.serviceMinutes!==(project.defaultServiceMinutes??45)
    ? "route" : project.defaultServiceMinutes!=null ? "project" : "legacy";
  const candidates:Candidate[]=[];
  for(const id of r.scopeIds) {
    const order=orders.find(o=>o.id===id)!;
    const address=destinationAddress(order),label=String(order.customerWoId??order.id);
    const point=await resolveDestination(order,provider,result=>review({
      id:`stop-${id}`,kind:"stop",workOrderId:id,label:`Work order ${label}`,submittedAddress:address,
      point:{lat:result.lat,lng:result.lng},
    },{address:order.address||"",city:order.city,state:order.state,zip:order.zip},result));
    const def=defs.get(order.subStatusId);
    const iso=(value:any)=>value?new Date(value).toISOString():null;
    candidates.push({id,label,address,point,scheduledAt:iso(order.scheduledAt),
      appointmentWindowStart:iso(order.appointmentWindowStart),appointmentWindowEnd:iso(order.appointmentWindowEnd),
      serviceDurationMinutes:order.serviceDurationMinutes??r.serviceMinutes,
      durationSource:order.serviceDurationMinutes!=null?"work-order":durationSource,
      priority:def?.routingPriority??null,subStatus:def?.label??null});
  }
  if(reviews.length)return {reviews};
  const matrix=await provider.matrix([origin,...candidates.map(c=>c.point)]);
  // Make only the dispatched sequence traversable. The shared scheduler still
  // calculates windows, waits and durations without optimizing a different order.
  const fixed=matrix.map((row,i)=>row.map((leg,j)=>j===i+1?leg:null));
  if(candidates.some((_,i)=>!fixed[i]?.[i+1]))
    throw new RoutingError(422,"A dispatched stop is no longer reachable. Ask dispatch to plan again.");
  const stops=optimizeStops(candidates,fixed,Date.parse(r.departureAt),r.serviceMinutes,r.toleranceMinutes);
  const geometry=await provider.geometry([origin,...stops.map(s=>s.point)]);
  const route:RoutingResult={...r,dispatchPlanId:entry.id,assigneeName,provider:providerName,
    createdAt:new Date().toISOString(),origin,stops,geometry,confirmedAddressMatches:confirmed,excluded:[],
    warnings:["Route map and travel estimates were refreshed from the provider. The dispatched stop sequence and original expiry are unchanged.",
      "Driving times are estimates, not live traffic."],
    totalTravelSeconds:stops.reduce((n,s)=>n+s.travelSeconds,0),
    totalTravelMeters:stops.reduce((n,s)=>n+s.travelMeters,0)};
  return {route};
}
