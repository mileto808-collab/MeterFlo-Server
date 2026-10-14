import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadCustomerRelease, packageHash, type CustomerRelease } from "../shared/customer-release";
import { coreUpdatePreview, gitReader, type GitRead } from "../server/coreUpdatePreview";
import { scanText } from "./secret-patterns.mjs";
const exec = promisify(execFile);
export type ToolRunner = (tool: string,args: string[],cwd: string)=>Promise<void>;
export function preparationEnvironment(environment:NodeJS.ProcessEnv=process.env) {
  const safe:NodeJS.ProcessEnv={NODE_ENV:"production"};
  const allowed=new Set(["PATH","HOME","USERPROFILE","APPDATA","LOCALAPPDATA","SystemRoot","SYSTEMROOT","WINDIR","COMSPEC","PATHEXT",
    "TMP","TEMP","TMPDIR","LANG","LD_LIBRARY_PATH","SSL_CERT_FILE","NODE_EXTRA_CA_CERTS",
    "HTTP_PROXY","HTTPS_PROXY","NO_PROXY","http_proxy","https_proxy","no_proxy","NPM_TOKEN","NODE_AUTH_TOKEN"]);
  for(const key of Object.keys(environment))
    if(allowed.has(key) || key.startsWith("NPM_CONFIG_") || key.startsWith("npm_config_") || key.startsWith("NIX_"))safe[key]=environment[key];
  return safe;
}
export const runTool: ToolRunner = async(tool,args,cwd)=>{
  try {
    // Preparation does not inherit production DB/session/mail credentials.
    // Preserve package authentication, proxy settings and managed network protections.
    const env=tool==="npm" || tool===process.execPath ? preparationEnvironment() : process.env;
    if(process.platform==="win32" && ["npm","pm2"].includes(tool)) {
      // Execute the installed JavaScript CLI through Node, not .cmd through a shell.
      // This preserves argument boundaries for Windows paths with spaces.
      const relative=tool==="npm" ? "node_modules/npm/bin/npm-cli.js" : "node_modules/pm2/bin/pm2";
      const directories=[path.dirname(process.execPath),...(process.env.PATH??"").split(path.delimiter)];
      const cli=directories.map(dir=>path.join(dir,relative)).find(file=>fs.existsSync(file));
      if(!cli)throw new Error("Installed CLI not found");
      await exec(process.execPath,[cli,...args],{cwd,env,timeout:300000,maxBuffer:8*1024*1024});
    } else await exec(tool,args,{cwd,env,timeout:300000,maxBuffer:8*1024*1024});
  }catch{
    const phase=tool==="npm" ? `npm ${args.slice(0,args[0]==="run"?2:1).join(" ")}` : tool==="git" ? `git ${args[0]}` : "Node validation";
    throw new Error(`Candidate preparation failed during ${phase}; no raw command output or credentials were returned. Review local diagnostics privately.`);
  }
};
export type StageReceipt = {ready:true;tag:string;commit:string;instanceRoot:string;candidateRoot:string;
  version:string;artifactHash:string;lockHash:string;coreManifestHash:string;extensions:{id:string;version:string;contentHash:string}[];schemaVersion:number};
export function verifyStagedRelease(candidate: string): StageReceipt {
  const receipt:StageReceipt=JSON.parse(fs.readFileSync(path.join(candidate,"meterflo-stage-receipt.json"),"utf8"));
  if(receipt.ready!==true || fs.realpathSync(candidate)!==receipt.candidateRoot ||
    packageHash(path.join(candidate,"dist"))!==receipt.artifactHash ||
    packageHashFile(path.join(candidate,"package-lock.json"))!==receipt.lockHash ||
    coreManifestHash(candidate)!==receipt.coreManifestHash)
    throw new Error("Candidate receipt or artifacts changed; prepare a fresh candidate");
  const compiled=JSON.parse(fs.readFileSync(path.join(candidate,"dist/customer-release.json"),"utf8"));
  if(compiled.version!==receipt.version || compiled.schemaVersion!==receipt.schemaVersion ||
    JSON.stringify(compiled.extensions.map(({id,version,contentHash}:any)=>({id,version,contentHash})))!==JSON.stringify(receipt.extensions))
    throw new Error("Candidate compiled metadata does not match its receipt");
  return receipt;
}
import { createHash } from "node:crypto";
export const packageHashFile=(file:string)=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const coreManifestHash=(directory:string)=>createHash("sha256").update(fs.readFileSync(path.join(directory,"package.json")))
  .update(fs.readFileSync(path.join(directory,"meterflo.release.json"))).digest("hex");
export function installedCustomerRelease(root:string):CustomerRelease {
  const pointer=path.join(root,"meterflo.activation.json");
  if(!fs.existsSync(pointer))return loadCustomerRelease(root);
  const active=JSON.parse(fs.readFileSync(pointer,"utf8"));
  const receipt=verifyStagedRelease(active.directory);
  if(receipt.instanceRoot!==fs.realpathSync(root))throw new Error("Active release belongs to a different instance");
  return loadCustomerRelease(root,path.join(root,"meterflo.instance.json"),active.directory);
}
function checkCustomerSource(directory:string) {
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    if(["node_modules",".git","dist",".cache"].includes(entry.name))continue;
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())checkCustomerSource(file);
    else if(/\.(?:[cm]?js|jsx|ts|tsx|json|sql)$/.test(entry.name) &&
      scanText(entry.name,fs.readFileSync(file,"utf8")).some((finding:any)=>finding.blocking))
      throw new Error("Customer package contains a potential credential literal; review privately before staging");
  }
}
export async function stageCustomerRelease(options:{root:string;target:string;tag:string;git?:GitRead;run?:ToolRunner}):Promise<StageReceipt>{
  const root=fs.realpathSync(options.root),target=path.resolve(options.target),run=options.run??runTool;
  let ancestor=path.dirname(target);
  while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
  const actualTarget=path.resolve(fs.realpathSync(ancestor),path.relative(ancestor,target));
  const canonical=(s:string)=>process.platform==="win32" ? s.toLowerCase() : s;
  if(!/^v\d+\.\d+\.\d+$/.test(options.tag))throw new Error("Select an exact numbered core tag");
  if(canonical(actualTarget)===canonical(root) || canonical(actualTarget).startsWith(canonical(root)+path.sep) ||
    canonical(root).startsWith(canonical(actualTarget)+path.sep) || fs.existsSync(target))
    throw new Error("Candidate directory must be new and outside the live installation");
  const current=installedCustomerRelease(root);
  const git=options.git??gitReader(root),preview=await coreUpdatePreview(current,git,options.tag);
  if(!preview.canPrepare || !current.coreSource)throw new Error(preview.blockers.join("; ") || "Selected core release is not newer than the installed release");
  console.log(`Preparing ${options.tag}; live installation and data will not be modified.`);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  await run("git",["clone","--no-checkout","--",current.coreSource,target],root);
  await run("git",["checkout","--detach",preview.coreCommit],target);
  for(const extension of current.extensions){
    const source=path.resolve(root,extension.directory),destination=path.resolve(target,extension.directory);
    checkCustomerSource(source);
    if(!destination.startsWith(target+path.sep))throw new Error("Invalid owned extension destination");
    if(fs.existsSync(destination))throw new Error("Core release overlaps customer-owned package paths; reconcile ownership before staging");
    fs.cpSync(source,destination,{recursive:true,filter:file=>!["node_modules",".git","dist",".cache"].includes(path.basename(file))});
    if(packageHash(destination)!==extension.contentHash)throw new Error("Customer package source changed during staging");
  }
  fs.writeFileSync(path.join(target,"meterflo.instance.json"),JSON.stringify({
    coreSource:current.coreSource,installedSchemaVersion:current.installedSchemaVersion,approvedMigrations:current.approvedMigrations,
    extensions:current.extensions.map(x=>({directory:x.directory})),
  },null,2));
  const candidate=loadCustomerRelease(target);
  if(candidate.version!==options.tag.slice(1) || candidate.blockers.length || candidate.installedSchemaVersion!==candidate.schemaVersion)
    throw new Error(candidate.blockers.join("; ") || "Selected tag does not match core metadata");
  await run(process.execPath,["script/check-dependency-portability.mjs","--files"],target);
  await run(process.execPath,["script/check-deployment-secrets.mjs"],target);
  const lockHash=packageHashFile(path.join(target,"package-lock.json"));
  await run("npm",["ci","--include=dev","--registry=https://registry.npmjs.org"],target);
  for(const extension of candidate.extensions){
    const directory=path.resolve(target,extension.directory);
    if(!fs.existsSync(path.join(directory,"package-lock.json")))throw new Error("Customer packages require their own npm lockfile");
    await run("npm",["ci","--include=dev","--registry=https://registry.npmjs.org"],directory);
    if(packageHash(directory)!==extension.contentHash)throw new Error("Customer package source/lockfile changed during installation");
  }
  await run("npm",["run","check"],target);
  await run("npm",["run","build"],target);
  await run("npm",["run","test:customer-updates"],target);
  if(packageHashFile(path.join(target,"package-lock.json"))!==lockHash)throw new Error("Candidate install changed the locked core graph");
  const receipt:StageReceipt={ready:true,tag:options.tag,commit:preview.coreCommit,instanceRoot:root,candidateRoot:fs.realpathSync(target),
    version:candidate.version,artifactHash:packageHash(path.join(target,"dist")),lockHash,coreManifestHash:coreManifestHash(target),schemaVersion:candidate.schemaVersion,
    extensions:candidate.extensions.map(x=>({id:x.id,version:x.version,contentHash:x.contentHash}))};
  fs.writeFileSync(path.join(target,"meterflo-stage-receipt.json"),JSON.stringify(receipt,null,2));
  verifyStagedRelease(target);
  console.log("Candidate passed checks. It is NOT active or published. Back up and review before explicit activation.");
  return receipt;
}
