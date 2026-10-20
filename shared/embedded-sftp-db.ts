import { pgTable, integer, text, boolean, timestamp, uuid, foreignKey, index } from "drizzle-orm/pg-core";
import { projects } from "./schema";
const date = (name: string) => timestamp(name, { withTimezone: true });
export const sftpServerSettings = pgTable("sftp_server_settings", {
  id: integer("id").primaryKey(), enabled: boolean("enabled").notNull().default(false),
  host: text("host").notNull().default("0.0.0.0"), port: integer("port").notNull().default(2222),
  publicHost: text("public_host").notNull().default(""), updatedAt: date("updated_at").notNull().defaultNow(),
});
export const sftpServerAccounts = pgTable("sftp_server_accounts", {
  id: uuid("id").primaryKey(), projectId: integer("project_id").notNull(),
  username: text("username").notNull().unique("sftp_server_accounts_username_key"), label: text("label").notNull(), authType: text("auth_type").notNull(),
  publicKey: text("public_key"), passwordHash: text("password_hash"), canUpload: boolean("can_upload").notNull(),
  canDownload: boolean("can_download").notNull(), expiresAt: date("expires_at").notNull(),
  revokedAt: date("revoked_at"), createdAt: date("created_at").notNull().defaultNow(),
}, t => [foreignKey({ name: "sx_accounts_project_fk", columns: [t.projectId], foreignColumns: [projects.id] }).onDelete("cascade")]);
export const sftpServerEvents = pgTable("sftp_server_events", {
  id: uuid("id").primaryKey(), projectId: integer("project_id"), username: text("username").notNull(),
  action: text("action").notNull(), status: text("status").notNull(), fileName: text("file_name"),
  bytes: integer("bytes").notNull().default(0), message: text("message").notNull(),
  createdAt: date("created_at").notNull().defaultNow(),
}, t => [foreignKey({ name: "sx_events_project_fk", columns: [t.projectId], foreignColumns: [projects.id] }).onDelete("cascade"),
  index("sx_events_history").on(t.projectId, t.createdAt)]);
