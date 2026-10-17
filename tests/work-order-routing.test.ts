import test from "node:test";
import assert from "node:assert/strict";
import { optimizeStops, type Candidate } from "../server/routing/optimizer";
import { routingService, RoutingError } from "../server/routing/providers";
import { navigationLinks, isRoutingBrowserReference, isRoutingServerReference } from "../shared/workOrderRouting";
import { sanitizeGenericProjectSettings } from "../shared/project-settings-boundary";

test("generic project writes cannot select credentials and browser references cannot select server-only secrets",()=>{
  for(const field of ["routingConfiguration","routing_configuration"]){
    assert.throws(()=>sanitizeGenericProjectSettings({name:"example",[field]:{browserKeyEnv:"SESSION_SECRET"}}),/dedicated Maps & Routing/);
    assert.deepEqual(sanitizeGenericProjectSettings({name:"example",[field]:null}),{name:"example"});
  }
  for(const key of ["SESSION_SECRET","GOOGLE_MAPS_SERVER_API_KEY","GEOAPIFY_PRIVATE_BROWSER_KEY","METERFLO_ROUTING_PROJECT_3_SECRET_BROWSER"])
    assert.equal(isRoutingBrowserReference(key),false,key);
  assert.equal(isRoutingBrowserReference("GEOAPIFY_BROWSER_API_KEY"),true);
  assert.equal(isRoutingBrowserReference("METERFLO_ROUTING_PROJECT_3_BROWSER"),true);
  assert.equal(isRoutingServerReference("GOOGLE_MAPS_SERVER_API_KEY"),true);
  assert.equal(isRoutingServerReference("GOOGLE_MAPS_BROWSER_API_KEY"),false);
});

const start=Date.parse("2026-10-17T14:00:00Z");
const candidates=(values:Partial<Candidate>[]):Candidate[]=>values.map((v,i)=>({
  id:i+1,label:`WO-${i+1}`,address:"Verified fixture",point:{lat:40+i/100,lng:-105},
  scheduledAt:null,priority:null,subStatus:null,...v,
}));
function matrix(n:number,seconds=60){return Array.from({length:n+1},(_,i)=>Array.from({length:n+1},(_,j)=>({seconds:i===j?0:seconds,meters:i===j?0:1000})));}
test("priority zero beats one and absent priorities; driving cannot buy urgency",()=>{
  const stops=optimizeStops(candidates([{priority:null},{priority:1},{priority:0}]),matrix(3),start,10,0);
  assert.deepEqual(stops.map(s=>s.id),[3,2,1]);
  assert.equal(stops[0].priority,0);
});
test("appointments precede urgency and explicitly wait when early",()=>{
  const stops=optimizeStops(candidates([{priority:0},{priority:5,scheduledAt:"2026-10-17T14:05:00Z"}]),matrix(2,240),start,10,0);
  assert.deepEqual(stops.map(s=>s.id),[2,1]);
  assert.equal(stops[0].arrivalAt,"2026-10-17T14:04:00.000Z");
  assert.equal(stops[0].serviceAt,"2026-10-17T14:05:00.000Z");
  assert.equal(stops[0].lateMinutes,0);
});
test("impossible appointments remain in the route and report lateness",()=>{
  const stops=optimizeStops(candidates([{scheduledAt:"2026-10-17T13:00:00Z"},{scheduledAt:"2026-10-17T13:00:00Z"}]),matrix(2),start,10,5);
  assert.equal(stops.length,2);assert.ok(stops.every(s=>s.lateMinutes>0));
});
test("timestamp offsets, rather than local server timezone, govern arrival",()=>{
  const stops=optimizeStops(candidates([{scheduledAt:"2026-10-17T08:05:00-06:00"}]),matrix(1),start,5,0);
  assert.equal(stops[0].serviceAt,"2026-10-17T14:05:00.000Z");
});
test("equal-priority routes use actual directional road times, not coordinates",()=>{
  const m=matrix(3,600);m[0][3].seconds=10;m[3][1].seconds=10;m[1][2].seconds=10;
  assert.deepEqual(optimizeStops(candidates([{}, {}, {}]),m,start,1,0).map(s=>s.id),[3,1,2]);
});
test("unreachable inter-stop roads fail instead of inventing distances",()=>{
  const m:(ReturnType<typeof matrix>[0][0]|null)[][]=matrix(2);m[1][2]=null;m[2][1]=null;
  assert.throws(()=>optimizeStops(candidates([{},{}]),m,start,10,0),/No drivable route/);
});
test("Apple and Google handoffs are single-destination HTTPS links",()=>{
  const links=navigationLinks({lat:40.1,lng:-105.2});
  assert.match(links.apple,/^https:\/\/maps.apple.com/);
  assert.match(links.google,/api=1.*destination=40.1%2C-105.2/);
  assert.ok(!links.google.includes("waypoints"));
});
test("Geoapify adapter uses fixed hosts, real road matrix and geometry; rejects ambiguous addresses",async()=>{
  const original=globalThis.fetch,requests:string[]=[];
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));requests.push(url.hostname+url.pathname);
    assert.equal(url.hostname,"api.geoapify.com");
    if(url.pathname.includes("geocode"))return Response.json({results:[{lat:40,lon:-105,result_type:"city",rank:{confidence:1}}]});
    if(url.pathname.includes("routematrix")){
      assert.equal(JSON.parse(String(init?.body)).traffic,"approximated");
      return Response.json({sources_to_targets:[[{time:0,distance:0},{time:100,distance:500}],
        [{time:150,distance:600},{time:0,distance:0}]]});
    }
    return Response.json({features:[{geometry:{type:"MultiLineString",coordinates:[[[-105,40],[-105.1,40.1]]]}}]});
  };
  try{
    const service=routingService("geoapify","fixture-not-a-key");
    await assert.rejects(service.geocode("Ambiguous City"),(e:any)=>e instanceof RoutingError&&e.status===422);
    const points=[{lat:40,lng:-105},{lat:40.1,lng:-105.1}];
    const m=await service.matrix(points);assert.equal(m[1][0]?.seconds,150);
    assert.equal((await service.geometry(points)).length,2);
    assert.equal(requests.length,3);
  }finally{globalThis.fetch=original;}
});
test("Google matrix and geometry retain the caller's stop order and field restrictions",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));assert.equal(url.hostname,"routes.googleapis.com");
    assert.equal((init?.headers as Record<string,string>)["X-Goog-Api-Key"],"fixture-not-a-key");
    const body=JSON.parse(String(init?.body));
    if(url.pathname.includes("computeRouteMatrix")){
      assert.equal(body.origins.length,2);
      return Response.json([{originIndex:0,destinationIndex:1,condition:"ROUTE_EXISTS",duration:"123s",distanceMeters:456}]);
    }
    assert.equal(body.optimizeWaypointOrder,undefined);
    return Response.json({routes:[{polyline:{geoJsonLinestring:{coordinates:[[-105,40],[-105.1,40.1]]}}}]});
  };
  try{
    const service=routingService("google","fixture-not-a-key"),points=[{lat:40,lng:-105},{lat:40.1,lng:-105.1}];
    assert.equal((await service.matrix(points))[0][1]?.seconds,123);
    assert.deepEqual((await service.geometry(points))[1],points[1]);
  }finally{globalThis.fetch=original;}
});
test("quota/auth provider failures are explicit and never leak credentials",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async()=>new Response("private provider diagnostic",{status:429});
  try{await assert.rejects(routingService("google","fixture-sensitive-placeholder").geocode("Fixture address"),
    (e:any)=>e.status===429&&!e.message.includes("fixture-sensitive-placeholder")&&!e.message.includes("private"));}
  finally{globalThis.fetch=original;}
});
