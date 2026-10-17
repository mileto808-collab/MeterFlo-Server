import { createHash } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool } from "../db";
import { storage } from "../storage";
import { defaultRoutingConfiguration, isRoutingBrowserReference, isRoutingServerReference, type RoutingConfiguration, type RoutingReadiness } from "../../shared/workOrderRouting";
import { RoutingError } from "./providers";

// References only, never credential values. Prevent selecting unrelated process
// secrets (e.g. SESSION_SECRET) and transmitting them to a mapping provider.
const envRef=z.string().max(100).regex(/^(?:(?:METERFLO_ROUTING_|GOOGLE_MAPS_|GEOAPIFY_)[A-Z0-9_]+)?$/);
export const routingConfigurationSchema=z.object({
  mode:z.enum(["inherit","override","disabled"]),provider:z.enum(["google","geoapify"]),
  serverKeyEnv:envRef.refine(isRoutingServerReference,"Server references cannot use the BROWSER token."),
  browserKeyEnv:envRef.refine(isRoutingBrowserReference,"Browser references must include BROWSER and cannot include SERVER, SECRET or PRIVATE."),
  maxStops:z.number().int().min(1).max(24),dailyPlans:z.number().int().min(1).max(1000),
}).strict().refine(c=>!c.serverKeyEnv||!c.browserKeyEnv||c.serverKeyEnv!==c.browserKeyEnv,
  "Use separate server and domain-restricted browser key references.");
export const SITE_ROUTING_KEY="maps_routing";
export function assertProjectCredentialReferences(config:RoutingConfiguration,projectId:number,admin:boolean,previous:RoutingConfiguration) {
  if(admin||config.mode!=="override")return;
  const prefix=`METERFLO_ROUTING_PROJECT_${projectId}_`;
  const reuse=config.provider===previous.provider;
  for(const name of ["serverKeyEnv","browserKeyEnv"] as const){
    const reference=config[name];
    if(reference&&!reference.startsWith(prefix)&&!(reuse&&reference===previous[name]))
      throw new RoutingError(403,`Project credentials must use the ${prefix} prefix. An instance administrator can explicitly assign other references.`);
  }
}
export async function initializeRouting() {
  await pool.query(`ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS routing_configuration jsonb;
    CREATE TABLE IF NOT EXISTS public.routing_daily_usage (
      account_hash varchar(64) NOT NULL, usage_day date NOT NULL, plans integer NOT NULL DEFAULT 0,
      PRIMARY KEY(account_hash,usage_day));
    DELETE FROM public.routing_daily_usage WHERE usage_day < CURRENT_DATE - 7;`);
}
export async function readRoutingConfiguration(projectId?:number):Promise<RoutingConfiguration>{
  let raw:unknown;
  if(projectId){
    const result=await pool.query("SELECT routing_configuration FROM public.projects WHERE id=$1",[projectId]);
    raw=result.rows[0]?.routing_configuration;
  }else{
    const setting=await storage.getSetting(SITE_ROUTING_KEY);
    try{raw=setting?JSON.parse(setting):null;}catch{throw new RoutingError(503,"Invalid site routing configuration. Ask an administrator to save it again.");}
  }
  if(raw==null)return {...defaultRoutingConfiguration,mode:projectId?"inherit":"disabled"};
  const parsed=routingConfigurationSchema.safeParse(raw);
  if(!parsed.success)throw new RoutingError(503,"Routing settings need administrator review.");
  return parsed.data;
}
export async function effectiveRouting(projectId?:number,canManage=false) {
  const configuration=await readRoutingConfiguration(projectId);
  const inherited=!!projectId&&configuration.mode==="inherit";
  const effective=inherited?await readRoutingConfiguration():configuration;
  const disabled=configuration.mode==="disabled"||inherited&&effective.mode==="disabled";
  const serverKey=effective.serverKeyEnv?process.env[effective.serverKeyEnv]??"":"";
  const browserCandidate=effective.browserKeyEnv?process.env[effective.browserKeyEnv]??"":"";
  const browserKey=browserCandidate&&browserCandidate!==serverKey?browserCandidate:"";
  // Revision includes nonreversible key identity so credential rotation invalidates
  // prior results. No key values enter responses, audit payloads or persistent data.
  const revision=createHash("sha256").update(JSON.stringify([configuration,effective,serverKey,browserKey])).digest("hex");
  const result:RoutingReadiness={
    configuration:canManage?configuration:{...configuration,serverKeyEnv:"",browserKeyEnv:""},
    effective:{provider:effective.provider,source:inherited||!projectId?"site":"project",maxStops:effective.maxStops,dailyPlans:effective.dailyPlans},
    ready:!disabled&&!!serverKey,mapReady:!disabled&&!!browserKey,disabled,canManage,revision,
    message:disabled?"Route optimization is disabled.":!serverKey?"Add the configured server API key through instance Secrets to calculate routes.":
      !browserKey?"Route calculations are configured. Add a domain-restricted browser key to display maps.":"Routing and map credentials are configured; live service access has not been verified.",
  };
  return {result,effective,serverKey,browserKey};
}
export async function saveRoutingConfiguration(projectId:number|undefined,input:unknown) {
  const config=routingConfigurationSchema.parse(input);
  if(!projectId&&config.mode==="inherit")throw new RoutingError(400,"Site settings cannot inherit another configuration.");
  if(projectId)await pool.query("UPDATE public.projects SET routing_configuration=$2::jsonb WHERE id=$1",[projectId,JSON.stringify(config)]);
  else await storage.setSetting(SITE_ROUTING_KEY,JSON.stringify(config),"Maps and routing defaults (credential references only)");
}
export async function consumeRoutingQuota(provider:string,key:string,limit:number) {
  const account=createHash("sha256").update(`${provider}:${key}`).digest("hex");
  const result=await pool.query(`INSERT INTO public.routing_daily_usage(account_hash,usage_day,plans) VALUES($1,CURRENT_DATE,1)
    ON CONFLICT(account_hash,usage_day) DO UPDATE SET plans=routing_daily_usage.plans+1
    WHERE routing_daily_usage.plans < $2 RETURNING plans`,[account,limit]);
  if(!result.rowCount)throw new RoutingError(429,"MeterFlo's daily route-plan limit for this provider account has been reached. No other account was charged.");
}
export async function exportProjectRouting(client:Pick<PoolClient,"query">,projectId:number) {
  return (await client.query("SELECT routing_configuration FROM public.projects WHERE id=$1",[projectId])).rows[0]?.routing_configuration??null;
}
export async function restoreProjectRouting(client:Pick<PoolClient,"query">,schema:string,raw:unknown) {
  const config=raw==null?null:routingConfigurationSchema.parse(raw);
  // Restore references, not secrets; clone/portable restore must not silently
  // activate billing in its destination. Operator explicitly enables it again.
  await client.query("UPDATE public.projects SET routing_configuration=$2::jsonb WHERE database_name=$1",
    [schema,config?JSON.stringify({...config,mode:"disabled"}):null]);
}
