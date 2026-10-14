import { createHash,randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { beginAuditOperation,finishAuditOperation } from "./auditService";
import { auditingEnabled } from "./auditContext";

export function auditFileIdentifier(name:string) {return createHash("sha256").update(name).digest("hex").slice(0,24);}
export async function writeAuditedFile(filePath:string,buffer:Buffer,type:string,projectId:number,projectLabel:string,target:string) {
  if (!auditingEnabled) {await fs.writeFile(filePath,buffer);return;}
  const id=await beginAuditOperation(type,target,projectId,projectLabel);
  const temporary=`${filePath}.${randomUUID()}.staged`,previous=`${temporary}.previous`;
  let movedPrevious=false,written=false;
  try {
    await fs.writeFile(temporary,buffer);
    try {await fs.rename(filePath,previous);movedPrevious=true;} catch(e:any) {if(e.code!=="ENOENT") throw e;}
    await fs.rename(temporary,filePath);written=true;
    await finishAuditOperation(id,"success",{bytes:buffer.length});
  } catch(e) {
    if(written) await fs.rm(filePath,{force:true});
    if(movedPrevious) await fs.rename(previous,filePath);
    await fs.rm(temporary,{force:true});
    await finishAuditOperation(id,"failed");
    throw e;
  }
  if(movedPrevious) await fs.rm(previous,{force:true}).catch(()=>console.warn("[Audit] A staged previous file requires filesystem cleanup."));
}
export async function deleteAuditedFile(filePath:string,type:string,projectId:number,projectLabel:string,target:string):Promise<boolean> {
  if(!auditingEnabled) {try {await fs.unlink(filePath);return true;} catch{return false;}}
  const id=await beginAuditOperation(type,target,projectId,projectLabel),staged=`${filePath}.${randomUUID()}.deleted`;
  let moved=false;
  try {
    await fs.rename(filePath,staged);moved=true;
    await finishAuditOperation(id,"success");
  } catch(e:any) {
    if(moved) await fs.rename(staged,filePath);
    await finishAuditOperation(id,e.code==="ENOENT"?"notFound":"failed");
    if(e.code==="ENOENT") return false;
    throw e;
  }
  await fs.rm(staged,{force:true}).catch(()=>console.warn("[Audit] A staged deleted file requires filesystem cleanup."));
  return true;
}
