import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
export interface AuditContext {
  actorId:string|null; actorLabel:string; actorKind:"user"|"service"; source:string; operationId:string;
  sftpRestoreMode?: "retain" | "replace";
}
export const auditContext = new AsyncLocalStorage<AuditContext>();
export const serviceAuditContext = (source:string):AuditContext =>
  ({actorId:null,actorLabel:"System",actorKind:"service",source,operationId:randomUUID()});
export function withAuditContext<T>(context:AuditContext,fn:()=>T):T { return auditContext.run(context,fn); }
export let auditingEnabled = false;
export function enableAuditing() { auditingEnabled = true; }
