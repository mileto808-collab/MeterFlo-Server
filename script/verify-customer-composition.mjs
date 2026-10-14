// Isolated regression fixture: never starts the real server, connects a database, or publishes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import {pathToFileURL} from "node:url";
import {buildSync} from "esbuild";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {Router} from "wouter";

const source=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),"meterflo-composition-"));
const env={NODE_ENV:"production"};
for(const key of ["PATH","HOME","TMPDIR","LD_LIBRARY_PATH","SSL_CERT_FILE","SystemRoot","USERPROFILE"])
  if(process.env[key])env[key]=process.env[key];
try{
  const files=execFileSync("git",["ls-files","--cached","--others","--exclude-standard","-z"],{encoding:"utf8"}).split("\0").filter(Boolean);
  for(const file of files){
    if(/^(?:attached_assets|\.local|\.agents|generated-artifacts)\//.test(file) || /(?:^|\/)\.env(?:\.|$)/.test(file))continue;
    const from=path.join(source,file);
    if(!fs.existsSync(from) || !fs.statSync(from).isFile())continue;
    fs.mkdirSync(path.dirname(path.join(temp,file)),{recursive:true});fs.copyFileSync(from,path.join(temp,file));
  }
  // Reuse installed dependencies; this is a build/contract test, not a fresh-install claim.
  fs.symlinkSync(path.join(source,"node_modules"),path.join(temp,"node_modules"),process.platform==="win32"?"junction":"dir");
  fs.cpSync(path.join(source,"examples/customer-report"),path.join(temp,"customer-packages/project-report"),{recursive:true});
  fs.writeFileSync(path.join(temp,"meterflo.instance.json"),JSON.stringify({coreSource:null,installedSchemaVersion:1,
    approvedMigrations:[],extensions:[{directory:"customer-packages/project-report"}]}));
  const fingerprints=[];
  for(const version of ["2.1.1","2.2.0"]){
    const pkg=JSON.parse(fs.readFileSync(path.join(temp,"package.json"),"utf8"));pkg.version=version;
    fs.writeFileSync(path.join(temp,"package.json"),JSON.stringify(pkg));
    const lock=JSON.parse(fs.readFileSync(path.join(temp,"package-lock.json"),"utf8"));lock.version=version;
    if(lock.packages?.[""])lock.packages[""].version=version;
    fs.writeFileSync(path.join(temp,"package-lock.json"),JSON.stringify(lock));
    execFileSync(process.execPath,[path.join(source,"node_modules/tsx/dist/cli.mjs"),"script/build.ts"],
      {cwd:temp,env,stdio:["ignore","pipe","pipe"],timeout:180000});
    const release=JSON.parse(fs.readFileSync(path.join(temp,"dist/customer-release.json"),"utf8"));
    assert.equal(release.version,version);assert.equal(release.extensions.length,1);
    fingerprints.push(release.extensions[0].contentHash);
    const require=createRequire(path.join(temp,"package.json"));
    const module=require(path.join(temp,"dist/extensions/project-report.cjs"));
    const report=await module.reports.projects({getProjects:async()=>[{id:1,name:"Authorized Fixture Project",isActive:true}]});
    assert.deepEqual(report.rows,[[1,"Authorized Fixture Project","Yes"]]);
  }
  assert.equal(fingerprints[0],fingerprints[1]);
  const ui=path.join(temp,"customer-screen.mjs");
  buildSync({entryPoints:[path.join(temp,"client/src/pages/customer-extension.tsx")],outfile:ui,bundle:true,
    platform:"node",format:"esm",packages:"external",jsx:"automatic",alias:{"@":path.join(temp,"client/src")}});
  const {default:Screen}=await import(pathToFileURL(ui).href);
  const query=new QueryClient({defaultOptions:{queries:{staleTime:Infinity}}});
  query.setQueryData(["/api/customer-extensions"],[{id:"project-report",name:"Fixture package",version:"1.0.0",
    screens:[{id:"projects",title:"Project report",report:"projects"}]}]);
  query.setQueryData(["/api/customer-extensions/project-report/reports/projects"],
    {title:"Customer Project Report",columns:["Project"],rows:[["Authorized Fixture Project"],["<script>fixture</script>"]]});
  const html=renderToStaticMarkup(React.createElement(QueryClientProvider,{client:query},
    React.createElement(Router,{ssrPath:"/extensions/project-report/projects"},React.createElement(Screen))));
  assert.ok(html.includes("Customer Project Report"));assert.ok(html.includes("Authorized Fixture Project"));
  assert.ok(html.includes("&lt;script&gt;fixture&lt;/script&gt;"));assert.ok(!html.includes("<script>fixture"));
  query.clear();
  console.log("PASS: two versioned production builds preserve the sample customer package; compiled handler and actual report component render correctly.");
}finally{fs.rmSync(temp,{recursive:true,force:true});}
