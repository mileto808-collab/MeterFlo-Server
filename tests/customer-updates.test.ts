import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import express from "express";
import { loadCustomerRelease, compareReleaseVersions, packageHash } from "../shared/customer-release";
import { coreUpdatePreview, gitReader } from "../server/coreUpdatePreview";
import { registerCustomerExtensions, validateReport } from "../server/customerExtensions";
import { stageCustomerRelease, verifyStagedRelease, preparationEnvironment, installedCustomerRelease, type ToolRunner } from "../script/customer-release-stage";
import { activateCustomerRelease } from "../script/customer-release-activation";
import { createHash } from "node:crypto";

const source="https://example.invalid/MeterFlo-Core.git";
function fixture(){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"meterflo-customer-updates-")),core=path.join(temp,"core"),root=path.join(temp,"customer");
  fs.mkdirSync(core);
  const write=(directory:string,file:string,value:unknown)=>{
    fs.mkdirSync(path.dirname(path.join(directory,file)),{recursive:true});
    fs.writeFileSync(path.join(directory,file),typeof value==="string"?value:JSON.stringify(value,null,2));
  };
  const git=(directory:string,...args:string[])=>execFileSync("git",args,{cwd:directory,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  git(core,"init","-q");git(core,"config","user.email","fixture@example.invalid");git(core,"config","user.name","Fixture");
  write(core,"package.json",{name:"fixture",version:"2.1.1",type:"module"});
  write(core,"package-lock.json",{name:"fixture",version:"2.1.1",lockfileVersion:3,packages:{}});
  write(core,"meterflo.release.json",{extensionApiVersion:1,schemaVersion:1,migrations:[]});
  write(core,".gitignore","meterflo.instance.json\ncustomer-packages/\n.env\ndist/\nProject Files/\ncustomer.db\n");
  write(core,"core-feature.txt","core release one");git(core,"add",".");git(core,"commit","-qm","Core baseline");git(core,"tag","v2.1.1");
  git(core,"branch","stable-v1");
  write(core,"package.json",{name:"fixture",version:"2.2.0",type:"module"});
  write(core,"core-feature.txt","core release two");git(core,"add",".");git(core,"commit","-qm","Core release");git(core,"tag","v2.2.0");
  git(temp,"clone","-q",core,root);git(root,"checkout","-q","--track","origin/stable-v1");
  git(root,"config","user.email","fixture@example.invalid");git(root,"config","user.name","Fixture");
  fs.cpSync(path.resolve("examples/customer-report"),path.join(root,"customer-packages/project-report"),{recursive:true});
  write(root,"meterflo.instance.json",{coreSource:source,installedSchemaVersion:1,approvedMigrations:[],
    coreBaseline:{version:"2.1.1",commit:git(core,"rev-parse","v2.1.1^{commit}")},
    extensions:[{directory:"customer-packages/project-report"}]});
  write(root,".env","PRIVATE_CONFIGURATION_FIXTURE");
  write(root,"Project Files/customer.txt","CUSTOMER_BYTE_FIXTURE");
  write(root,"customer.db","CUSTOM_TABLE_AND_WORK_ORDER_FIXTURE");
  const calls:{tool:string;args:string[];cwd:string}[]=[];
  const reader=async(args:string[])=>gitReader(root)(args.map(a=>a===source?core:a));
  const run:ToolRunner=async(tool,args,cwd)=>{
    calls.push({tool,args,cwd});
    if(tool==="git"){git(cwd,...args.map(a=>a===source?core:a));return;}
    if(tool==="npm" && args.join(" ")==="run build"){
      write(cwd,"dist/index.cjs","// fixture compiled core");
      write(cwd,"dist/customer-release.json",loadCustomerRelease(cwd));
      write(cwd,"dist/extensions/project-report.cjs","// fixture compiled customer package");
    }
  };
  return {temp,core,root,write,git,reader,run,calls,cleanup:()=>fs.rmSync(temp,{recursive:true,force:true})};
}
test("real Git preview fetches numbered core releases without changing customer working tree/index",async()=>{
  const f=fixture();
  try {
    const before=f.git(f.root,"status","--porcelain"),head=f.git(f.root,"rev-parse","HEAD");
    const result=await coreUpdatePreview(loadCustomerRelease(f.root),f.reader);
    assert.equal(result.candidateVersion,"2.2.0");assert.equal(result.canPrepare,true);
    assert.equal(result.extensionCompatibility[0].compatible,true);
    assert.equal(f.git(f.root,"status","--porcelain"),before);assert.equal(f.git(f.root,"rev-parse","HEAD"),head);
    assert.ok(!JSON.stringify(result).includes("reset --hard"));
    f.write(f.root,"core-feature.txt","customer direct edit");
    const dirty=await coreUpdatePreview(loadCustomerRelease(f.root),f.reader);
    assert.equal(dirty.canPrepare,false);assert.ok(dirty.blockers.some(b=>b.includes("Local core")));
    f.git(f.root,"add","core-feature.txt");f.git(f.root,"commit","-qm","Customer core change");
    const committed=await coreUpdatePreview(loadCustomerRelease(f.root),f.reader);
    assert.ok(committed.blockers.some(b=>b.includes("direct core modifications")));
    const unknown=await coreUpdatePreview(loadCustomerRelease(f.root),async()=>{throw new Error("FAKE_CREDENTIAL_DIAGNOSTIC");});
    assert.equal(unknown.canPrepare,false);assert.ok(!JSON.stringify(unknown).includes("FAKE_CREDENTIAL"));
    assert.ok(!unknown.message.includes("up to date"));
  }finally{f.cleanup();}
});
test("published runtime receives approved public release notices but cannot prepare/overwrite itself",async()=>{
  const f=fixture();
  try {
    const release={...loadCustomerRelease(f.root),coreSource:"https://github.com/example/Core.git"};
    const request:typeof fetch=async input=>{
      const address=String(input);
      return new Response(JSON.stringify(address.endsWith("/releases/latest") ? {tag_name:"v2.2.0"} :
        address.endsWith("/package.json") ? {version:"2.2.0"} : {extensionApiVersion:1,schemaVersion:1,migrations:[]}));
    };
    const noGit=async()=>{throw new Error("No workspace Git");};
    const notice=await coreUpdatePreview(release,noGit,undefined,request);
    assert.equal(notice.updateAvailable,true);assert.equal(notice.candidateVersion,"2.2.0");assert.equal(notice.canPrepare,false);
    assert.equal(notice.updateCommand,"");assert.equal(notice.extensionCompatibility[0].compatible,true);
    const failed=await coreUpdatePreview(release,noGit,undefined,async()=>new Response("",{status:404}));
    assert.equal(failed.candidateVersion,null);assert.ok(failed.blockers.some(b=>b.includes("feed is unavailable")));
  }finally{f.cleanup();}
});
test("preparation excludes runtime secrets without discarding package authentication or network protections",()=>{
  const isolated=preparationEnvironment({PATH:"fixture-path",DATABASE_URL:"fixture-db",SESSION_SECRET:"fixture-session",
    SMTP_PASSWORD:"fixture-mail",HTTPS_PROXY:"fixture-proxy",NPM_TOKEN:"fixture-package-auth"});
  assert.equal(isolated.DATABASE_URL,undefined);assert.equal(isolated.SESSION_SECRET,undefined);assert.equal(isolated.SMTP_PASSWORD,undefined);
  assert.equal(isolated.NPM_TOKEN,"fixture-package-auth");assert.equal(isolated.HTTPS_PROXY,"fixture-proxy");
});
test("preview blocks missing/moved baselines, conflicts, divergent history and invalid candidate metadata",async()=>{
  const f=fixture();
  try {
    const release=loadCustomerRelease(f.root);
    assert.equal((await coreUpdatePreview({...release,coreBaseline:null},f.reader)).canPrepare,false);
    const moved=await coreUpdatePreview({...release,coreBaseline:{version:"2.1.1",commit:"0".repeat(40)}},f.reader);
    assert.equal(moved.candidateVersion,null);
    const statuses=await coreUpdatePreview(release,async args=>args[0]==="status"
      ? "M  staged.txt\0 M unstaged.txt\0?? untracked.txt\0UU conflict.txt\0" : f.reader(args));
    assert.deepEqual(statuses.changes.map(x=>x.status),["M "," M","??","UU"]);
    assert.equal(statuses.canPrepare,false);
    const divergent=await coreUpdatePreview(release,async args=>args[0]==="rev-list" ? "1\t2\n" : f.reader(args));
    assert.ok(divergent.blockers.some(b=>b.includes("diverged")));
    const malformed=await coreUpdatePreview(release,async args=>args[0]==="show" && args[1]?.endsWith(":meterflo.release.json")
      ? JSON.stringify({schemaVersion:1,extensionApiVersion:1,migrations:[{id:"FAKE_PRIVATE_DIAGNOSTIC"}]}) : f.reader(args));
    assert.equal(malformed.candidateVersion,null);
    assert.ok(!JSON.stringify(malformed).includes("FAKE_PRIVATE_DIAGNOSTIC"));
    f.git(f.root,"checkout","-q","-b","current-core","--track","origin/"+f.git(f.core,"branch","--show-current"));
    f.write(f.root,"meterflo.instance.json",{coreSource:source,installedSchemaVersion:1,approvedMigrations:[],
      coreBaseline:{version:"2.2.0",commit:f.git(f.core,"rev-parse","v2.2.0^{commit}")},extensions:[]});
    const upToDate=await coreUpdatePreview(loadCustomerRelease(f.root),f.reader);
    assert.equal(upToDate.updateAvailable,false);
    assert.equal(upToDate.blockers.length,0);
    assert.match(upToDate.message,/Verified core release is up to date/);
  }finally{f.cleanup();}
});
test("incompatible candidate is rejected before installing dependencies or touching a live process",async()=>{
  const f=fixture();
  try {
    const file=path.join(f.root,"customer-packages/project-report/package.json");
    const pkg=JSON.parse(fs.readFileSync(file,"utf8"));
    pkg.meterfloExtension.maxCoreVersionExclusive="2.2.0";
    f.write(f.root,"customer-packages/project-report/package.json",pkg);
    await assert.rejects(stageCustomerRelease({root:f.root,target:path.join(f.temp,"incompatible"),
      tag:"v2.2.0",git:f.reader,run:f.run}),/does not support/);
    assert.equal(f.calls.length,0);
  }finally{f.cleanup();}
});
test("legacy fork reconciliation conflicts remain in a separate review checkout and cannot activate",async()=>{
  const f=fixture();
  try {
    f.write(f.root,"core-feature.txt","Customer-specific conflicting behavior");
    f.git(f.root,"add","core-feature.txt");f.git(f.root,"commit","-qm","Customer direct core modification");
    const originalHead=f.git(f.root,"rev-parse","HEAD");
    const review=path.join(f.temp,"manual-review");
    f.git(f.temp,"clone","-q",f.root,review);
    f.git(review,"config","user.email","fixture@example.invalid");f.git(review,"config","user.name","Fixture");
    f.git(review,"fetch",f.core,"refs/tags/v2.2.0:refs/meterflo/review/v2.2.0");
    assert.throws(()=>f.git(review,"merge","--no-commit","refs/meterflo/review/v2.2.0"));
    assert.match(f.git(review,"status","--porcelain"),/UU core-feature.txt/);
    fs.copyFileSync(path.join(f.root,"meterflo.instance.json"),path.join(review,"meterflo.instance.json"));
    fs.cpSync(path.join(f.root,"customer-packages"),path.join(review,"customer-packages"),{recursive:true});
    const preview=await coreUpdatePreview(loadCustomerRelease(review),async args=>gitReader(review)(args.map(a=>a===source?f.core:a)));
    assert.equal(preview.canPrepare,false);
    assert.ok(preview.changes.some(x=>x.status==="UU"));
    assert.equal(preview.updateCommand,"");
    assert.equal(f.git(f.root,"rev-parse","HEAD"),originalHead);
    assert.equal(fs.readFileSync(path.join(f.root,".env"),"utf8"),"PRIVATE_CONFIGURATION_FIXTURE");
    assert.equal(f.calls.length,0);
  }finally{f.cleanup();}
});
test("staging compatible core retains customer packages and never copies/modifies private data; install failure never invokes PM2",async()=>{
  const f=fixture();
  try{
    const release=path.join(f.temp,"release"),hash=packageHash(path.join(f.root,"customer-packages/project-report"));
    const receipt=await stageCustomerRelease({root:f.root,target:release,tag:"v2.2.0",git:f.reader,run:f.run});
    assert.equal(receipt.version,"2.2.0");assert.equal(receipt.extensions[0].contentHash,hash);
    assert.equal(verifyStagedRelease(release).ready,true);
    assert.equal(fs.existsSync(path.join(release,".env")),false);
    assert.equal(fs.existsSync(path.join(release,"customer.db")),false);
    assert.equal(fs.existsSync(path.join(release,"Project Files")),false);
    assert.equal(fs.readFileSync(path.join(f.root,"customer.db"),"utf8"),"CUSTOM_TABLE_AND_WORK_ORDER_FIXTURE");
    assert.equal(fs.readFileSync(path.join(f.root,".env"),"utf8"),"PRIVATE_CONFIGURATION_FIXTURE");
    assert.ok(!f.calls.some(c=>c.tool==="pm2"));
    await assert.rejects(stageCustomerRelease({root:f.root,target:release,tag:"v2.2.0",git:f.reader,run:f.run}),/new and outside/);
    await assert.rejects(stageCustomerRelease({root:f.root,target:path.join(f.temp,"failed"),tag:"v2.2.0",git:f.reader,
      run:async(tool,args,cwd)=>{if(tool==="npm")throw new Error("Install failed");await f.run(tool,args,cwd);}}),/Install failed/);
    assert.ok(!f.calls.some(c=>c.tool==="pm2"));
    fs.writeFileSync(path.join(release,"dist/index.cjs"),"modified after staging");
    assert.throws(()=>verifyStagedRelease(release),/artifacts changed/);
  }finally{f.cleanup();}
});
test("incompatible versions, API, paths and unapproved/customer-owned migrations fail explicitly",()=>{
  const f=fixture();
  try{
    assert.equal(compareReleaseVersions("2.10.0","2.2.0"),1);
    assert.throws(()=>compareReleaseVersions("v2.1.1","2.2.0"));
    const file=path.join(f.root,"customer-packages/project-report/package.json"),pkg=JSON.parse(fs.readFileSync(file,"utf8"));
    pkg.meterfloExtension.maxCoreVersionExclusive="2.1.1";f.write(f.root,"customer-packages/project-report/package.json",pkg);
    assert.ok(loadCustomerRelease(f.root).blockers.length);
    pkg.meterfloExtension.maxCoreVersionExclusive="3.0.0";pkg.meterfloExtension.extensionApiVersion=2;
    f.write(f.root,"customer-packages/project-report/package.json",pkg);assert.ok(loadCustomerRelease(f.root).blockers.length);
    f.write(f.root,"meterflo.instance.json",{extensions:[{directory:"../core"}]});
    assert.throws(()=>loadCustomerRelease(f.root),/ownership boundary/);
    f.write(f.root,"meterflo.instance.json",{extensions:[],coreSource:"https://example.invalid/core.git?token=FAKE_QUERY"});
    assert.throws(()=>loadCustomerRelease(f.root),/without embedded/);
    f.write(f.root,"meterflo.instance.json",{extensions:[],installedSchemaVersion:1});
    f.write(f.root,"migration.sql","CREATE TABLE ext_customer_example (id integer);");
    const sha=createHash("sha256").update(fs.readFileSync(path.join(f.root,"migration.sql"))).digest("hex");
    f.write(f.root,"meterflo.release.json",{extensionApiVersion:1,schemaVersion:1,migrations:[
      {id:"core.example",file:"migration.sql",sha256:sha,ownership:"core",reversible:false}]});
    assert.ok(loadCustomerRelease(f.root).blockers.some(b=>b.includes("checksum approval")));
    f.write(f.root,"meterflo.instance.json",{extensions:[],installedSchemaVersion:1,approvedMigrations:[{id:"core.example",sha256:sha}]});
    assert.deepEqual(loadCustomerRelease(f.root).blockers,[]);
    f.write(f.root,"migration.sql","ALTER TABLE ext_customer_example ADD COLUMN description text;");
    assert.throws(()=>loadCustomerRelease(f.root),/checksum/);
  }finally{f.cleanup();}
});
test("customer screens/reports use known role permissions and only associated projects; revocation takes effect",async()=>{
  const f=fixture(),app=express(),users:any={alice:{id:"alice",username:"alice",role:"user",permissions:["projects.view"]},
    bob:{id:"bob",username:"bob",role:"user",permissions:[]}};
  let server:any;
  try{
    const release=loadCustomerRelease(f.root);
    await registerCustomerExtensions(app,{auth:(req:any,res,next)=>{
      if(!users[req.headers["x-fixture-user"]])return res.status(401).end();
      req.user={claims:{sub:req.headers["x-fixture-user"]}};next();
    },storage:{getUser:async id=>users[id],hasPermission:async(user,key)=>user.permissions.includes(key),
      isAdminUser:async()=>false,getProjects:async()=>[{id:99,name:"Unassociated",isActive:true}],
      getUserProjects:async()=>[{id:1,name:"Associated project",isActive:true}]}},release,
      async x=>import(pathToFileURL(path.join(f.root,x.directory,x.serverEntry)).href));
    server=app.listen(0);await new Promise<void>(resolve=>server.once("listening",resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(base+"/api/customer-extensions")).status,401);
    const headers={"x-fixture-user":"alice"};
    assert.equal((await (await fetch(base+"/api/customer-extensions",{headers})).json()).length,1);
    const report=await (await fetch(base+"/api/customer-extensions/project-report/reports/projects",{headers})).json();
    assert.deepEqual(report.rows,[[1,"Associated project","Yes"]]);
    users.alice.permissions=[];
    assert.deepEqual(await (await fetch(base+"/api/customer-extensions",{headers})).json(),[]);
    assert.equal((await fetch(base+"/api/customer-extensions/project-report/reports/projects",{headers})).status,403);
    assert.equal((await fetch(base+"/api/system/customer-release",{headers})).status,403);
    assert.throws(()=>validateReport({title:"Bad",columns:["one"],rows:[[{nested:"not renderable"}]]}));
  }finally{if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));f.cleanup();}
});
test("PM2 activation requires backup confirmation and restores prior application after mismatched health",async()=>{
  const f=fixture();
  try{
    const target=path.join(f.temp,"candidate"),receipt=await stageCustomerRelease({root:f.root,target,tag:"v2.2.0",git:f.reader,run:f.run});
    f.write(f.root,"deploy/pm2-config-policy.cjs",fs.readFileSync("deploy/pm2-config-policy.cjs","utf8"));
    f.write(f.root,"deploy/ecosystem.config.cjs",`module.exports=${JSON.stringify({apps:[{name:"meterflo",cwd:f.root,
      script:path.join(f.root,"dist/index.cjs"),env:{NODE_ENV:"production"}}]})}`);
    f.write(f.root,"dist/customer-release.json",loadCustomerRelease(f.root));
    const healthUrl="http://127.0.0.1:3000/api/system/release-health",calls:any[]=[];
    const run:ToolRunner=async(tool,args)=>{calls.push({tool,args});};
    await assert.rejects(activateCustomerRelease({root:f.root,candidate:target,healthUrl,confirmBackup:false,run}),/backup/);
    await assert.rejects(activateCustomerRelease({root:f.root,candidate:target,healthUrl,confirmBackup:true,run,
      sleep:async()=>{},
      health:async()=>({ready:true,version:calls.length===1?"WRONG":"2.1.1",extensions:receipt.extensions})}),/prior application restored/);
    assert.equal(calls.length,2);assert.equal(fs.existsSync(path.join(f.root,"meterflo.activation.json")),false);
    let promoted=false;
    await activateCustomerRelease({root:f.root,candidate:target,healthUrl,confirmBackup:true,
      run:async(tool,args,cwd)=>{promoted=true;await run(tool,args,cwd);},
      health:async()=>({ready:true,version:promoted?receipt.version:"2.1.1",extensions:receipt.extensions})});
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,"meterflo.activation.json"),"utf8")).version,"2.2.0");
    assert.equal(installedCustomerRelease(f.root).version,"2.2.0","subsequent staging reads active core rather than old protected checkout");
    assert.equal(fs.readFileSync(path.join(f.root,".env"),"utf8"),"PRIVATE_CONFIGURATION_FIXTURE");
    assert.equal(fs.readFileSync(path.join(f.root,"customer.db"),"utf8"),"CUSTOM_TABLE_AND_WORK_ORDER_FIXTURE");
  }finally{f.cleanup();}
});
