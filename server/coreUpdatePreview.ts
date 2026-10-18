import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compareReleaseVersions, type CustomerRelease, publicRelease } from "../shared/customer-release";
import { readPublicCoreFeed } from "./coreReleaseFeed";

const exec = promisify(execFile);
export type GitRead = (args: string[]) => Promise<string>;
export function gitReader(root: string): GitRead {
  return async args => (await exec("git",args,{cwd:root,timeout:30000,maxBuffer:2*1024*1024,
    env:{...process.env,GIT_TERMINAL_PROMPT:"0"}})).stdout;
}
export async function coreUpdatePreview(release: CustomerRelease, git: GitRead, selectedTag?: string, feedRequest?:typeof fetch) {
  const blockers=[...release.blockers];
  let isGitRepo=false,currentBranch="",commitsAhead:number|null=null,commitsBehind:number|null=null;
  let changes:{status:string;file:string}[]=[], filesChanged:string[]=[],diff="",tag="",candidateVersion:string|null=null;
  let coreCommit="",candidateMetadata:any=null;
  const extensionCompatibility:{id:string;version:string;compatible:boolean}[]=[];
  try {
    isGitRepo=(await git(["rev-parse","--is-inside-work-tree"])).trim()==="true";
    currentBranch=(await git(["rev-parse","--abbrev-ref","HEAD"])).trim();
    const tokens=(await git(["status","--porcelain=v1","-z"])).split("\0");
    for(let i=0;i<tokens.length;i++){
      if(!tokens[i])continue;
      const status=tokens[i].slice(0,2),file=tokens[i].slice(3);
      if(status.includes("R") || status.includes("C"))i++;
      changes.push({status,file});
    }
    const owned=(file:string)=>release.extensions.some(x=>file===x.directory || file.startsWith(x.directory.replaceAll("\\","/")+"/"));
    if(changes.some(c=>!owned(c.file)))blockers.push("Local core changes must be committed/reviewed; do not overwrite or hard reset this installation");
    try {
      await git(["fetch","--no-tags","origin"]);
      const counts=(await git(["rev-list","--left-right","--count","HEAD...@{upstream}"])).trim().split(/\s+/).map(Number);
      if (counts.length !== 2 || counts.some(n=>!Number.isSafeInteger(n) || n < 0))
        throw new Error("Unknown tracking revision");
      [commitsAhead,commitsBehind]=counts;
      if(commitsAhead && commitsBehind)blockers.push("Customer branch has diverged from its tracking branch; manual reconciliation is required");
    }catch{blockers.push("Customer branch tracking state is unknown; review the repository before updating");}
  }catch{blockers.push("Prepare and test the update in the customer workspace; this runtime has no usable Git checkout");}
  if(!release.coreSource)blockers.push("Configure an approved HTTPS coreSource in the customer workspace instance manifest");
  if(!release.coreBaseline)blockers.push("Record the verified numbered coreBaseline version and full commit before preparing an update");
  if(release.installedSchemaVersion===null)blockers.push("Declare and verify installedSchemaVersion before preparing a core update");
  if(!isGitRepo && release.coreSource){
    try{
      const feed=await readPublicCoreFeed(release.coreSource,feedRequest);
      tag=feed.tag;candidateVersion=feed.version;candidateMetadata=feed.metadata;
    }catch{blockers.push("Approved core release feed is unavailable; authenticate/check it in the customer workspace");}
  }
  if(isGitRepo && release.coreSource){
    try{
      const tags=(await git(["ls-remote","--tags","--refs",release.coreSource])).split("\n").map(line=>
        /refs\/tags\/(v\d+\.\d+\.\d+)$/.exec(line)?.[1]).filter((t):t is string=>!!t);
      tags.sort((a,b)=>compareReleaseVersions(b.slice(1),a.slice(1)));
      if(selectedTag && (!/^v\d+\.\d+\.\d+$/.test(selectedTag) || !tags.includes(selectedTag)))throw new Error("Unverified selected tag");
      tag=selectedTag??tags[0]??"";
      if(!tag)throw new Error("Missing tagged release");
      const fetchTag=async(t:string)=>{
        const ref=`refs/meterflo/core/${t}`;
        await git(["fetch","--no-tags",release.coreSource!,`refs/tags/${t}:${ref}`]);return ref;
      };
      const candidateRef=await fetchTag(tag);
      coreCommit=(await git(["rev-parse",`${candidateRef}^{commit}`])).trim();
      const pkg=JSON.parse(await git(["show",`${candidateRef}:package.json`]));
      candidateVersion=pkg.version;
      if(candidateVersion!==tag.slice(1))throw new Error("Tag/version mismatch");
      candidateMetadata=JSON.parse(await git(["show",`${candidateRef}:meterflo.release.json`]));
      if (!Number.isSafeInteger(candidateMetadata.schemaVersion) || candidateMetadata.schemaVersion < 1 ||
          !Number.isSafeInteger(candidateMetadata.extensionApiVersion) || !Array.isArray(candidateMetadata.migrations) ||
          candidateMetadata.migrations.some((m:any)=>!m || typeof m.id!=="string" ||
            !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(m.id) || !/^[a-f0-9]{64}$/.test(m.sha256) ||
            m.ownership!=="core" || typeof m.reversible!=="boolean"))
        throw new Error("Invalid candidate metadata");
      if(candidateMetadata.extensionApiVersion!==release.extensionApiVersion)blockers.push("Candidate extension API is incompatible");
      if(candidateMetadata.schemaVersion!==release.installedSchemaVersion)blockers.push("Candidate database schema requires reviewed migration readiness");
      if(!Array.isArray(candidateMetadata.migrations))throw new Error("Missing migration metadata");
      for(const m of candidateMetadata.migrations)
        if(!release.approvedMigrations.some(a=>a.id===m.id && a.sha256===m.sha256))blockers.push(`Candidate migration ${m.id} requires checksum approval after review/application`);
      for(const x of release.extensions){
        const compatible=x.extensionApiVersion===candidateMetadata.extensionApiVersion &&
          compareReleaseVersions(candidateVersion!,x.minCoreVersion)>=0 && compareReleaseVersions(candidateVersion!,x.maxCoreVersionExclusive)<0;
        extensionCompatibility.push({id:x.id,version:x.version,compatible});
        if(!compatible)blockers.push(`Customer extension ${x.id} does not support the candidate core release`);
      }
      // The protected instance checkout can remain at an older core after PM2 activates a staged release.
      // Compare its source ownership against its own core baseline, not the active compiled version.
      if (!release.coreBaseline) throw new Error("Unknown source baseline");
      const checkoutVersion=release.coreBaseline.version;
      compareReleaseVersions(checkoutVersion,checkoutVersion);
      const baselineRef=await fetchTag(`v${checkoutVersion}`);
      if ((await git(["rev-parse",`${baselineRef}^{commit}`])).trim() !== release.coreBaseline.commit)
        throw new Error("Core baseline tag no longer matches the approved commit");
      await git(["merge-base","HEAD",release.coreBaseline.commit]);
      const directEdits=(await git(["diff","--name-only",`${baselineRef}^{commit}`,"HEAD"])).trim().split("\n").filter(Boolean);
      if(directEdits.some(file=>!release.extensions.some(x=>file.startsWith(x.directory.replaceAll("\\","/")+"/"))))
        blockers.push("This customer fork contains direct core modifications; merge/review them separately before adopting an unmodified core release");
      filesChanged=(await git(["diff","--name-status",baselineRef,candidateRef])).trim().split("\n").filter(Boolean);
      diff=await git(["diff","--stat",baselineRef,candidateRef]);
    }catch{
      blockers.push("Core release, installed baseline or compatibility metadata could not be verified; unavailable is not up to date");
      candidateVersion=null;
    }
  }
  if(candidateVersion && candidateMetadata){
    if(!Number.isSafeInteger(candidateMetadata.schemaVersion) || candidateMetadata.schemaVersion<1 ||
      !Number.isSafeInteger(candidateMetadata.extensionApiVersion) || !Array.isArray(candidateMetadata.migrations) ||
      candidateMetadata.migrations.some((m:any)=>!m || typeof m.id!=="string" || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(m.id) ||
        !/^[a-f0-9]{64}$/.test(m.sha256) || m.ownership!=="core" || typeof m.reversible!=="boolean")){
      candidateVersion=null;blockers.push("Candidate release metadata is invalid");
    }else if(!isGitRepo){
      if(candidateMetadata.extensionApiVersion!==release.extensionApiVersion)blockers.push("Candidate extension API is incompatible");
      if(candidateMetadata.schemaVersion!==release.installedSchemaVersion)blockers.push("Candidate database schema requires reviewed migration readiness");
      for(const m of candidateMetadata.migrations)
        if(!release.approvedMigrations.some(a=>a.id===m.id && a.sha256===m.sha256))blockers.push(`Candidate migration ${m.id} requires checksum approval after review/application`);
      for(const x of release.extensions){
        const compatible=x.extensionApiVersion===candidateMetadata.extensionApiVersion &&
          compareReleaseVersions(candidateVersion,x.minCoreVersion)>=0 && compareReleaseVersions(candidateVersion,x.maxCoreVersionExclusive)<0;
        extensionCompatibility.push({id:x.id,version:x.version,compatible});
        if(!compatible)blockers.push(`Customer extension ${x.id} does not support the candidate core release`);
      }
    }
  }
  const uniqueBlockers=[...new Set(blockers)];
  const available=candidateVersion!==null && compareReleaseVersions(candidateVersion,release.version)>0;
  return {configurationRequired:!release.coreSource || !release.coreBaseline,
    isGitRepo,currentBranch,remoteBranch:tag,commitsAhead,commitsBehind,changes:changes.slice(0,100),
    filesChanged:filesChanged.slice(0,200),diff,installed:publicRelease(release),candidateVersion,coreCommit,
    extensionCompatibility,blockers:uniqueBlockers,updateAvailable:available,canPrepare:available && !uniqueBlockers.length,
    updateCommand:available && !uniqueBlockers.length
      ? `npm run stage:customer-release -- --tag ${tag} --target /absolute/path/to/a/new-release-directory` : "",
    message:uniqueBlockers.length ? "Update preparation is blocked; review the checks below" :
      available ? `Core ${candidateVersion} is available; stage and test it before activation` : "Verified core release is up to date",
  };
}
