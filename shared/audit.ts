import { z } from "zod";
export const auditPermissions = { view:"audit.view", all:"audit.viewAllProjects", manage:"audit.manageRetention" } as const;
// Capability metadata, not evidence that an action occurred in any project.
const auditOperationTypes = [
  "projectBackup", "projectRestore", "projectFilesBackup", "projectFilesRestore",
  "systemBackup", "systemRestore", "systemFilesRestore", "databaseImport", "fileImport",
  "workOrderFileUpload", "workOrderFileDelete", "projectDocumentUpload", "projectDocumentDelete",
  "projectFtpUpload", "projectFtpDelete",
] as const;
export const supportedAuditActions: readonly string[] = [
  "created", "updated", "deleted", "schema.deleted",
  "import.started", "import.finished", "import.outcomeUnknown",
  "audit.cleanup", "audit.policyChanged",
  ...auditOperationTypes.flatMap(type => [`${type}.started`, `${type}.finished`]),
];
export interface AuditChange { field:string; before:unknown; after:unknown }
export interface AuditEvent {
  id:string; occurredAt:string; actorId:string|null; actorLabel:string; actorKind:"user"|"service";
  source:string; action:string; entityType:string; entityId:string; entityLabel:string;
  projectId:number|null; projectLabel:string|null; operationId:string; outcome:string;
  changes:AuditChange[]; metadata:Record<string,unknown>;
}
export interface AuditList { events:AuditEvent[]; total:number; offset:number; limit:number }
export interface AuditOptions {
  actors:{id:string;label:string}[]; projects:{id:number;name:string}[];
  actions:string[]; entityTypes:string[]; timezone:string; canManage:boolean; canViewAll:boolean;
}
export const auditFiltersSchema = z.object({
  from:z.string().datetime().optional(),to:z.string().datetime().optional(),
  actorId:z.string().max(100).optional(),projectId:z.coerce.number().int().positive().optional(),
  action:z.string().max(100).optional(),entityType:z.string().max(100).optional(),
  entityId:z.string().max(200).optional(),outcome:z.string().max(30).optional(),
  q:z.string().max(200).optional(),limit:z.coerce.number().int().min(1).max(100).default(25),
  offset:z.coerce.number().int().min(0).max(1000000).default(0),
}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,{message:"Start date must precede end date"});
export const auditRetentionSchema = z.object({automatic:z.boolean(),days:z.number().int().min(1).max(3650)}).strict();
export type AuditRetention = z.infer<typeof auditRetentionSchema>;
export interface AuditRetentionSummary { policy:AuditRetention; count:number; bytes:number; oldest:string|null; newest:string|null }
export interface AuditPreview { token:string; count:number; before:string; expiresAt:string; limited:boolean }
