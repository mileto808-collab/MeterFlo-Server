// Isolated subprocess fixture. Never start this against a shared app/database.
import express from "express";
import { readFileSync } from "node:fs";
import { registerRoutingRoutes } from "../../server/routing/routes";
import { pool } from "../../server/db";
import type { RoutingService } from "../../server/routing/providers";

if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG || !process.send)
  throw new Error("Routing instance fixture requires the owned workspace sandbox and IPC");
const fixture=JSON.parse(readFileSync("/tmp/meterflo-inventory-ui-fixture.json","utf8"));
let mode="",offset=0;
const now=Date.now.bind(Date);
Date.now=()=>now()+offset;
const app=express();app.use(express.json());
app.use((req:any,_res,next)=>{
  offset=Number(req.headers["x-test-offset"]??0);
  mode=String(req.headers["x-test-provider"]??"");
  req.isAuthenticated=()=>true;
  req.user={claims:{sub:req.headers["x-test-actor"]==="viewer"?fixture.viewer.id:fixture.id},
    expires_at:Math.floor(Date.now()/1000)+1000};
  next();
});
const provider:RoutingService={
  geocode:async address=> {
    if(mode==="failure")throw new Error("Synthetic provider failure");
    return {lat:mode==="shifted"?41:40.1,lng:-105,
      addressMatch:{formatted:mode==="mismatch"||mode==="shifted"?"Different provider address":address,
        street:mode==="mismatch"||mode==="shifted"?"Different provider address":address}};
  },
  matrix:async points=>points.map(()=>points.map(()=>({seconds:90,meters:1100}))),
  geometry:async points=>points,
};
const configuration={mode:"override" as const,provider:"geoapify" as const,
  serverKeyEnv:"",browserKeyEnv:"",maxStops:24,dailyPlans:50};
registerRoutingRoutes(app,{
  effectiveRouting:async()=>({result:{configuration,effective:{...configuration,source:"project" as const},
    ready:true,mapReady:false,disabled:false,canManage:true,revision:"c".repeat(64),message:"Fixture"},
    effective:configuration,serverKey:"synthetic-provider-placeholder",browserKey:""}),
  routingService:()=>provider,consumeRoutingQuota:async()=>{},
});
const server=app.listen(0,"127.0.0.1",()=>process.send!({port:(server.address() as any).port}));
process.on("disconnect",()=>server.close(()=>void pool.end().then(()=>process.exit(0))));
