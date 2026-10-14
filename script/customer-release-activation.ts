import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadCustomerRelease } from "../shared/customer-release";
import { runTool, verifyStagedRelease, installedCustomerRelease, type ToolRunner } from "./customer-release-stage";

type HealthRead=(url:string)=>Promise<{ready:boolean;version:string;extensions:{id:string;version:string;contentHash:string}[]}>;
const healthRead:HealthRead=async url=>{
  const response=await fetch(url,{signal:AbortSignal.timeout(2000),redirect:"error"});
  if(!response.ok)throw new Error("Release health response was not successful");
  return await response.json() as any;
};
function matches(result:Awaited<ReturnType<HealthRead>>,expected:any) {
  const normalize=(xs:any[])=>xs.map(({id,version,contentHash})=>({id,version,contentHash})).sort((a,b)=>a.id.localeCompare(b.id));
  return result.ready && result.version===expected.version &&
    JSON.stringify(normalize(result.extensions))===JSON.stringify(normalize(expected.extensions));
}
async function waitForHealth(url:string,expected:any,health:HealthRead,sleep:(ms:number)=>Promise<void>) {
  for(let attempt=0;attempt<20;attempt++){
    try{if(matches(await health(url),expected))return;}catch{}
    await sleep(1500);
  }throw new Error("Health did not match the expected core and customer packages");
}
export async function activateCustomerRelease(options:{root:string;candidate:string;healthUrl:string;confirmBackup:boolean;
  run?:ToolRunner;health?:HealthRead;sleep?:(ms:number)=>Promise<void>}) {
  if(!options.confirmBackup)throw new Error("Confirm a current database/files/configuration backup before activation");
  let url:URL;
  try{url=new URL(options.healthUrl);}catch{throw new Error("Invalid local health URL");}
  if(!["http:","https:"].includes(url.protocol) || !["127.0.0.1","localhost","[::1]"].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash || url.pathname!=="/api/system/release-health")
    throw new Error("Use the instance's loopback release-health URL without credentials");
  const root=fs.realpathSync(options.root),candidate=fs.realpathSync(options.candidate),receipt=verifyStagedRelease(candidate);
  if(receipt.instanceRoot!==root)throw new Error("Candidate belongs to a different customer instance");
  const installed=installedCustomerRelease(root);
  const prepared=JSON.parse(fs.readFileSync(path.join(candidate,"dist/customer-release.json"),"utf8"));
  if(installed.coreSource!==prepared.coreSource ||
    JSON.stringify(installed.extensions.map(({id,version,contentHash})=>({id,version,contentHash})))!==JSON.stringify(receipt.extensions))
    throw new Error("Customer package/source configuration changed after staging; prepare a new candidate");
  if(installed.installedSchemaVersion!==receipt.schemaVersion || installed.schemaVersion!==receipt.schemaVersion)
    throw new Error("Schema compatibility changed; review/reprepare before activation. Database rollback is not automatic.");
  const privateConfig=path.join(root,"deploy/ecosystem.config.cjs");
  const require=createRequire(path.join(root,"package.json"));
  const {validateProductionConfig}=require(path.join(root,"deploy/pm2-config-policy.cjs"));
  const base=validateProductionConfig(require(privateConfig));
  if(base.apps[0].cwd!==root)throw new Error("Private PM2 configuration must retain the protected instance working directory");
  const run=options.run??runTool,health=options.health??healthRead;
  const sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  const directory=path.join(root,"generated-artifacts/customer-activation");
  fs.mkdirSync(directory,{recursive:true});
  const next=path.join(directory,"candidate.pm2.json"),prior=path.join(directory,"prior.pm2.json");
  // Validation permits only NODE_ENV in PM2 env. Do not read .env or save inherited environment variables.
  fs.writeFileSync(prior,JSON.stringify(base,null,2));
  const nextConfig=validateProductionConfig({apps:[{...base.apps[0],script:path.join(candidate,"dist/index.cjs")}]});
  fs.writeFileSync(next,JSON.stringify(nextConfig,null,2));
  let previous:{directory:string;version:string}|null=null;
  const pointer=path.join(root,"meterflo.activation.json");
  if(fs.existsSync(pointer)){
    previous=JSON.parse(fs.readFileSync(pointer,"utf8"));
    const old=verifyStagedRelease(previous!.directory);
    if(old.instanceRoot!==root || old.schemaVersion!==receipt.schemaVersion)throw new Error("Previous release is not a compatible rollback candidate");
    base.apps[0].script=path.join(previous!.directory,"dist/index.cjs");
    fs.writeFileSync(prior,JSON.stringify(validateProductionConfig(base),null,2));
  }
  const expectedPrevious=previous ? verifyStagedRelease(previous.directory) : (() => {
    try{return JSON.parse(fs.readFileSync(path.join(root,"dist/customer-release.json"),"utf8"));}
    catch{throw new Error("A compiled, healthy foundation baseline is required before verified standalone activation");}
  })();
  if(expectedPrevious.schemaVersion!==receipt.schemaVersion)throw new Error("Prior compiled schema is incompatible; use controlled migration maintenance");
  await waitForHealth(url.href,expectedPrevious,health,sleep);
  fs.writeFileSync(path.join(directory,"prior-release.json"),JSON.stringify({
    instanceRoot:root,pointer:previous,release:expectedPrevious,schemaVersion:installed.schemaVersion,
  },null,2));
  try{
    await run("pm2",["startOrReload",next],root);
    await waitForHealth(url.href,receipt,health,sleep);
    const temporary=`${pointer}.${process.pid}.pending`;
    fs.writeFileSync(temporary,JSON.stringify({directory:candidate,version:receipt.version,previous},null,2),{flag:"wx"});
    fs.renameSync(temporary,pointer);
    console.log("Candidate is active and healthy. No database restore/migration or publishing was performed.");
  }catch{
    try{
      await run("pm2",["startOrReload",prior],root);
      await waitForHealth(url.href,expectedPrevious,health,sleep);
    }catch{throw new Error("Activation and recovery failed. Service may be unavailable; use the protected prior configuration and verified backup. No database was reverted.");}
    throw new Error("Activation failed; prior application restored and health verified. No customer data or environment files were replaced.");
  }
}
