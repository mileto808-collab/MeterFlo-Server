import { z } from "zod";
import type { GeocodedPoint, RoutePoint, RoutingProvider } from "../../shared/workOrderRouting";
import type { RoadLeg } from "./optimizer";

export class RoutingError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const coordinate=z.object({lat:z.number().finite().min(-90).max(90),lng:z.number().finite().min(-180).max(180)});
export interface RoutingService {
  geocode(address:string):Promise<GeocodedPoint>;
  matrix(points:RoutePoint[]):Promise<(RoadLeg|null)[][]>;
  geometry(points:RoutePoint[]):Promise<RoutePoint[]>;
}
/** Fixed hosts only. Provider errors never include request URLs, keys or bodies. */
export function routingService(provider:RoutingProvider,key:string, signal?:AbortSignal):RoutingService {
  async function request(url:URL, body?:unknown, headers:Record<string,string>={}) {
    let response:Response;
    try { response=await fetch(url,{method:body?"POST":"GET",body:body?JSON.stringify(body):undefined,
      headers:{"Content-Type":"application/json",...headers},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)}); }
    catch { throw new RoutingError(502,"Routing service could not be reached or timed out. Retry when connected."); }
    if(!response.ok) throw new RoutingError(response.status===429?429:502,
      response.status===429?"Routing provider quota exceeded. Wait or review provider limits.":"Routing provider rejected the request. Check API enablement, key restrictions and account configuration.");
    const text=await response.text();
    if(text.length>8_000_000)throw new RoutingError(502,"Routing response exceeded safe limits.");
    try {return JSON.parse(text);}catch{throw new RoutingError(502,"Routing provider returned an invalid response.");}
  }
  function geoUrl(path:string) {const url=new URL(path,"https://api.geoapify.com");url.searchParams.set("apiKey",key);return url;}
  function googleUrl(path:string){const url=new URL(path,"https://maps.googleapis.com");url.searchParams.set("key",key);return url;}
  const waypoint=(p:RoutePoint)=>({location:{latLng:{latitude:p.lat,longitude:p.lng}}});
  const addressText=(value:unknown):string|undefined=>typeof value==="string"?value.trim().slice(0,500):
    typeof value==="number"&&Number.isFinite(value)?String(value):undefined;
  function leg(seconds:unknown,meters:unknown):RoadLeg|null {
    const s=Number(seconds),m=Number(meters);
    return Number.isFinite(s)&&s>=0&&Number.isFinite(m)&&m>=0?{seconds:s,meters:m}:null;
  }
  return {
    async geocode(address) {
      if(provider==="geoapify"){
        const url=geoUrl("/v1/geocode/search");url.searchParams.set("text",address);url.searchParams.set("limit","2");url.searchParams.set("format","json");
        const data=await request(url), results=data.results??[];
        const r=results[0];
        if(!r||!Number.isFinite(r.rank?.confidence)||r.rank.confidence<0.9||!["building","amenity"].includes(r.result_type)||results[1]&&results[1].rank?.confidence>=r.rank?.confidence)
          throw new RoutingError(422,"Address is unresolved or ambiguous. Correct it or capture verified GPS coordinates.");
        return {...coordinate.parse({lat:r.lat,lng:r.lon}),addressMatch:{
          formatted:addressText(r.formatted)||"",houseNumber:addressText(r.housenumber),street:addressText(r.street),
          city:addressText(r.city||r.town||r.village||r.municipality),state:addressText(r.state),
          stateCode:addressText(r.state_code),postcode:addressText(r.postcode),
        }};
      }
      const url=googleUrl("/maps/api/geocode/json");url.searchParams.set("address",address);
      const data=await request(url);
      if(data.status==="OVER_QUERY_LIMIT"||data.status==="OVER_DAILY_LIMIT")throw new RoutingError(429,"Google geocoding quota exceeded. Review provider limits before retrying.");
      if(!["OK","ZERO_RESULTS"].includes(data.status))throw new RoutingError(502,"Google geocoding is unavailable. Check Geocoding API enablement, billing and key restrictions.");
      if(data.status!=="OK"||data.results?.length!==1||data.results[0].partial_match||
        !["ROOFTOP","RANGE_INTERPOLATED"].includes(data.results[0].geometry?.location_type))
        throw new RoutingError(422,"Address is unresolved or ambiguous. Correct it or capture verified GPS coordinates.");
      const result=data.results[0];
      const component=(type:string,short=false)=>{
        const value=result.address_components?.find((part:any)=>part.types?.includes(type));
        return addressText(value?.[short?"short_name":"long_name"]);
      };
      return {...coordinate.parse(result.geometry.location),addressMatch:{
        formatted:addressText(result.formatted_address)||"",houseNumber:component("street_number"),street:component("route"),
        city:component("locality")||component("postal_town")||component("sublocality"),
        state:component("administrative_area_level_1"),stateCode:component("administrative_area_level_1",true),
        postcode:component("postal_code"),
      }};
    },
    async matrix(points) {
      const matrix:(RoadLeg|null)[][]=points.map(()=>points.map(()=>null));
      if(provider==="geoapify"){
        const data=await request(geoUrl("/v1/routematrix"),{mode:"drive",traffic:"approximated",
          sources:points.map(p=>({location:[p.lng,p.lat]})),targets:points.map(p=>({location:[p.lng,p.lat]}))});
        if(!Array.isArray(data.sources_to_targets)||data.sources_to_targets.length!==points.length||
          data.sources_to_targets.some((row:unknown)=>!Array.isArray(row)||row.length!==points.length))
          throw new RoutingError(502,"Routing provider returned an incomplete matrix.");
        for(let i=0;i<points.length;i++)for(let j=0;j<points.length;j++){
          const cell=data.sources_to_targets[i]?.[j];if(cell)matrix[i][j]=leg(cell.time,cell.distance);
        }
      }else{
        const data=await request(new URL("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"),{
          origins:points.map(p=>({waypoint:waypoint(p)})),destinations:points.map(p=>({waypoint:waypoint(p)})),
          travelMode:"DRIVE",routingPreference:"TRAFFIC_UNAWARE"},{
          "X-Goog-Api-Key":key,"X-Goog-FieldMask":"originIndex,destinationIndex,status,condition,duration,distanceMeters"});
        if(!Array.isArray(data))throw new RoutingError(502,"Routing provider returned an incomplete matrix.");
        for(const cell of data){
          if(cell.status?.code===8)throw new RoutingError(429,"Google road-matrix quota exceeded. Review provider limits.");
          if(cell.status?.code&&cell.status.code!==5)throw new RoutingError(502,"Google could not calculate the road matrix. Check API access and retry.");
          const i=cell.originIndex??0,j=cell.destinationIndex??0;
          if(cell.condition==="ROUTE_EXISTS"&&Number.isInteger(i)&&Number.isInteger(j)&&i>=0&&j>=0&&matrix[i]&&j<points.length)
            matrix[i][j]=leg(String(cell.duration).replace(/s$/,""),cell.distanceMeters??0);
        }
      }
      for(let i=0;i<points.length;i++)matrix[i][i]={seconds:0,meters:0};
      return matrix;
    },
    async geometry(points){
      if(points.length<2)return [];
      if(provider==="geoapify"){
        const url=geoUrl("/v1/routing");url.searchParams.set("waypoints",points.map(p=>`${p.lat},${p.lng}`).join("|"));
        url.searchParams.set("mode","drive");url.searchParams.set("traffic","approximated");
        const data=await request(url), geometry=data.features?.[0]?.geometry;
        const coords=geometry?.type==="MultiLineString"?geometry.coordinates.flat():geometry?.type==="LineString"?geometry.coordinates:[];
        if(!coords.length)throw new RoutingError(502,"Routing provider returned no road geometry.");
        return coords.map((c:number[])=>coordinate.parse({lat:c[1],lng:c[0]}));
      }
      const data=await request(new URL("https://routes.googleapis.com/directions/v2:computeRoutes"),{
        origin:waypoint(points[0]),destination:waypoint(points[points.length-1]),
        intermediates:points.slice(1,-1).map(waypoint),travelMode:"DRIVE",routingPreference:"TRAFFIC_UNAWARE",
        polylineEncoding:"GEO_JSON_LINESTRING",polylineQuality:"OVERVIEW"},{
        "X-Goog-Api-Key":key,"X-Goog-FieldMask":"routes.polyline.geoJsonLinestring"});
      const coords=data.routes?.[0]?.polyline?.geoJsonLinestring?.coordinates;
      if(!Array.isArray(coords)||!coords.length)throw new RoutingError(502,"Routing provider returned no road geometry.");
      return coords.map((c:number[])=>coordinate.parse({lat:c[1],lng:c[0]}));
    },
  };
}
