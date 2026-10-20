import { pgTable, uuid, integer, text, boolean, timestamp, bigint, foreignKey, index, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./schema";
const date = (name: string) => timestamp(name, { withTimezone: true });
export const httpsTransferSettings = pgTable("https_transfer_settings", {
  projectId: integer("project_id").primaryKey(), enabled: boolean("enabled").notNull().default(false),
  provider: text("provider").notNull(), location: text("location").notNull(), retentionDays: integer("retention_days").notNull().default(30),
  updatedAt: date("updated_at").notNull().defaultNow(),
}, t => [foreignKey({ name: "hx_settings_project_fk", columns: [t.projectId], foreignColumns: [projects.id] }).onDelete("cascade")]);
export const httpsTransferCredentials = pgTable("https_transfer_credentials", {
  id: uuid("id").primaryKey(), projectId: integer("project_id").notNull(), name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(), tokenPrefix: text("token_prefix").notNull(),
  canUpload: boolean("can_upload").notNull(), canDownload: boolean("can_download").notNull(),
  expiresAt: date("expires_at").notNull(), revokedAt: date("revoked_at"),
  createdAt: date("created_at").notNull().defaultNow(), lastUsedAt: date("last_used_at"),
}, t => [foreignKey({ name: "hx_credential_project_fk", columns: [t.projectId], foreignColumns: [projects.id] }).onDelete("cascade"),
  index("hx_credentials_project").on(t.projectId)]);
export const httpsTransferFiles = pgTable("https_transfer_files", {
  id: uuid("id").primaryKey(), projectId: integer("project_id").notNull(), direction: text("direction").notNull(),
  credentialId: uuid("credential_id"), fileName: text("file_name").notNull(), size: bigint("size", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(), idempotencyKey: text("idempotency_key"), exportRunId: uuid("export_run_id"),
  provider: text("provider").notNull(), location: text("location").notNull(), storageKey: text("storage_key").notNull(),
  status: text("status").notNull(), message: text("message"), createdAt: date("created_at").notNull().defaultNow(),
  processedAt: date("processed_at"), acknowledgedAt: date("acknowledged_at"), processingConfigId: integer("processing_config_id"),
}, t => [foreignKey({ name: "hx_file_project_fk", columns: [t.projectId], foreignColumns: [projects.id] }).onDelete("cascade"),
  foreignKey({ name: "hx_file_credential_fk", columns: [t.credentialId], foreignColumns: [httpsTransferCredentials.id] }),
  index("hx_files_project").on(t.projectId, t.createdAt),
  uniqueIndex("hx_upload_identity").on(t.credentialId, t.idempotencyKey),
  uniqueIndex("hx_export_identity").on(t.exportRunId)]);
export const httpsTransferEvents = pgTable("https_transfer_events", {
  id: uuid("id").primaryKey(), projectId: integer("project_id").notNull(), credentialId: uuid("credential_id"),
  fileId: uuid("file_id"), action: text("action").notNull(), message: text("message").notNull(),
  createdAt: date("created_at").notNull().defaultNow(),
}, t => [foreignKey({ name: "hx_event_project_fk", columns: [t.projectId], foreignColumns: [projects.id] }).onDelete("cascade"),
  index("hx_events_project").on(t.projectId, t.createdAt)]);
