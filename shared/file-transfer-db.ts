import { pgTable, integer, uuid, text, boolean, timestamp, jsonb, primaryKey, foreignKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { projects, workOrderStatuses, workOrderSubStatuses, fileImportConfigs } from "./schema";
const date = (name: string) => timestamp(name, { withTimezone: true });
export const projectSftpConnections = pgTable("project_sftp_connections", {
  projectId: integer("project_id").primaryKey(), name: text("name").notNull(), host: text("host").notNull(),
  port: integer("port").notNull(), username: text("username").notNull(), hostFingerprint: text("host_fingerprint").notNull(),
  authType: text("auth_type").notNull(), encryptedSecret: text("encrypted_secret").notNull(), updatedAt: date("updated_at").notNull().defaultNow(),
}, t => [foreignKey({ name: "ft_sftp_project_fk", columns: [t.projectId], foreignColumns: [projects.id] }).onDelete("cascade")]);
export const fileExports = pgTable("file_exports", {
  id: uuid("id").primaryKey(), projectId: integer("project_id").notNull(), name: text("name").notNull(),
  format: text("format").notNull(), mode: text("mode").notNull(), allStatuses: boolean("all_statuses").notNull(),
  filenameTemplate: text("filename_template").notNull(), columns: jsonb("columns").notNull(),
  destination: text("destination").notNull(), remoteDirectory: text("remote_directory").notNull().default(""),
  scheduleFrequency: text("schedule_frequency").notNull(), customCronExpression: text("custom_cron_expression"),
  isEnabled: boolean("is_enabled").notNull().default(false), nextRunAt: date("next_run_at"), scheduleTimezone: text("schedule_timezone"),
  lastRunAt: date("last_run_at"), lastRunStatus: text("last_run_status"), lastRunMessage: text("last_run_message"),
  deletedAt: date("deleted_at"), createdAt: date("created_at").notNull().defaultNow(), updatedAt: date("updated_at").notNull().defaultNow(),
}, t => [foreignKey({ name: "ft_exports_project_fk", columns: [t.projectId], foreignColumns: [projects.id] }).onDelete("cascade"),
  index("ft_exports_due").on(t.nextRunAt).where(sql`${t.isEnabled} AND ${t.deletedAt} IS NULL`)]);
export const fileExportStatuses = pgTable("file_export_statuses", {
  configId: uuid("config_id").notNull(), statusId: integer("status_id").notNull(),
}, t => [primaryKey({ name: "file_export_statuses_pkey", columns: [t.configId, t.statusId] }),
  foreignKey({ name: "ft_status_config_fk", columns: [t.configId], foreignColumns: [fileExports.id] }).onDelete("cascade"),
  foreignKey({ name: "ft_status_value_fk", columns: [t.statusId], foreignColumns: [workOrderStatuses.id] }).onDelete("cascade")]);
export const fileExportSubStatuses = pgTable("file_export_substatuses", {
  configId: uuid("config_id").notNull(), subStatusId: uuid("sub_status_id").notNull(),
}, t => [primaryKey({ name: "file_export_substatuses_pkey", columns: [t.configId, t.subStatusId] }),
  foreignKey({ name: "ft_substatus_config_fk", columns: [t.configId], foreignColumns: [fileExports.id] }).onDelete("cascade"),
  foreignKey({ name: "ft_substatus_value_fk", columns: [t.subStatusId], foreignColumns: [workOrderSubStatuses.id] }).onDelete("cascade")]);
export const fileExportRuns = pgTable("file_export_runs", {
  id: uuid("id").primaryKey(), configId: uuid("config_id").notNull(), projectId: integer("project_id").notNull(),
  configName: text("config_name").notNull(), snapshot: jsonb("snapshot").notNull(),
  fileName: text("file_name").notNull(), status: text("status").notNull(), recordCount: integer("record_count").notNull().default(0),
  attempts: integer("attempts").notNull().default(0), message: text("message"), createdAt: date("created_at").notNull().defaultNow(),
  startedAt: date("started_at"), completedAt: date("completed_at"), captured: boolean("captured").notNull().default(false),
}, t => [foreignKey({ name: "ft_run_config_fk", columns: [t.configId], foreignColumns: [fileExports.id] }).onDelete("cascade"),
  foreignKey({ name: "ft_run_project_fk", columns: [t.projectId], foreignColumns: [projects.id] }).onDelete("cascade"),
  index("ft_runs_history").on(t.projectId, t.createdAt),
  uniqueIndex("ft_runs_unresolved").on(t.configId).where(sql`${t.status} IN ('queued','running','failed','interrupted')`)]);
export const fileExportRunItems = pgTable("file_export_run_items", {
  runId: uuid("run_id").notNull(), workOrderId: integer("work_order_id").notNull(),
  contentHash: text("content_hash").notNull(), payload: jsonb("payload").notNull(),
}, t => [primaryKey({ name: "file_export_run_items_pkey", columns: [t.runId, t.workOrderId] }),
  foreignKey({ name: "ft_item_run_fk", columns: [t.runId], foreignColumns: [fileExportRuns.id] }).onDelete("cascade")]);
export const fileExportCheckpoints = pgTable("file_export_checkpoints", {
  configId: uuid("config_id").notNull(), workOrderId: integer("work_order_id").notNull(), contentHash: text("content_hash").notNull(),
}, t => [primaryKey({ name: "file_export_checkpoints_pkey", columns: [t.configId, t.workOrderId] }),
  foreignKey({ name: "ft_checkpoint_config_fk", columns: [t.configId], foreignColumns: [fileExports.id] }).onDelete("cascade")]);
export const fileExportAttempts = pgTable("file_export_attempts", {
  id: uuid("id").primaryKey(), runId: uuid("run_id").notNull(), status: text("status").notNull(), message: text("message"),
  startedAt: date("started_at").notNull().defaultNow(), completedAt: date("completed_at"),
}, t => [foreignKey({ name: "ft_attempt_run_fk", columns: [t.runId], foreignColumns: [fileExportRuns.id] }).onDelete("cascade"),
  index("ft_attempt_run").on(t.runId, t.startedAt)]);
export const fileImportReceipts = pgTable("file_import_receipts", {
  configId: integer("config_id").notNull(), contentHash: text("content_hash").notNull(),
  sourceIdentity: text("source_identity").notNull(), metadata: jsonb("metadata").notNull(), createdAt: date("created_at").notNull().defaultNow(),
}, t => [primaryKey({ name: "file_import_receipts_pkey", columns: [t.configId, t.contentHash] }),
  foreignKey({ name: "ft_receipt_config_fk", columns: [t.configId], foreignColumns: [fileImportConfigs.id] }).onDelete("cascade"),
  index("ft_receipts_identity").on(t.configId, t.sourceIdentity)]);
export const fileImportGeneratedIds = pgTable("file_import_generated_ids", {
  configId: integer("config_id").notNull(), contentHash: text("content_hash").notNull(),
  rowNumber: integer("row_number").notNull(), customerWoId: text("customer_wo_id").notNull(),
}, t => [primaryKey({ name: "file_import_generated_ids_pkey", columns: [t.configId, t.contentHash, t.rowNumber] }),
  foreignKey({ name: "ft_generated_config_fk", columns: [t.configId], foreignColumns: [fileImportConfigs.id] }).onDelete("cascade")]);
