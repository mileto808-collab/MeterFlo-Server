import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, serial, jsonb, index, uniqueIndex, primaryKey, boolean, uuid, date, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";
import { readingDecimalPlacesSchema } from "./reading-precision";
import { inventoryImportSchema } from "./inventory";

// Session storage table - mandatory for Replit Auth
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// User roles enum
export const userRoleEnum = ["admin", "user", "customer"] as const;
export type UserRole = (typeof userRoleEnum)[number];

// Subroles table - defines subroles within base roles (primarily for "user" role)
export const subroles = pgTable("subroles", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  key: varchar("key", { length: 50 }).notNull().unique(),
  label: varchar("label", { length: 100 }).notNull(),
  baseRole: varchar("base_role", { length: 20 }).notNull().default("user"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Permissions table - defines all available permissions
export const permissions = pgTable("permissions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  label: varchar("label", { length: 100 }).notNull(),
  category: varchar("category", { length: 50 }).notNull(),
  description: text("description"),
});

// SubRole-Permissions junction table
export const subrolePermissions = pgTable("subrole_permissions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  subroleId: integer("subrole_id").notNull().references(() => subroles.id, { onDelete: "cascade" }),
  permissionKey: varchar("permission_key", { length: 100 }).notNull(),
});

// Users table - supports both Replit Auth and local auth
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  username: varchar("username", { length: 100 }).unique(),
  passwordHash: varchar("password_hash", { length: 255 }),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: varchar("role", { length: 20 }).notNull().default("user"),
  subroleId: integer("subrole_id").references(() => subroles.id, { onDelete: "set null" }),
  isLocked: boolean("is_locked").default(false),
  lockedAt: timestamp("locked_at"),
  lockedReason: varchar("locked_reason", { length: 255 }),
  lastLoginAt: timestamp("last_login_at"),
  address: varchar("address", { length: 255 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 50 }),
  zip: varchar("zip", { length: 20 }),
  phone: varchar("phone", { length: 50 }),
  website: varchar("website", { length: 255 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Customer API auth types
export const customerApiAuthTypes = ["none", "api_key", "bearer_token", "basic_auth"] as const;
export type CustomerApiAuthType = (typeof customerApiAuthTypes)[number];

// Wizard mode enum for projects
export const wizardModeEnum = ["changeout", "reading_only", "user_choice"] as const;
export type WizardMode = (typeof wizardModeEnum)[number];

// GPS capture mode enum for projects
export const gpsModeEnum = ["automatic", "manual_step", "disabled"] as const;
export type GpsMode = (typeof gpsModeEnum)[number];

// Equipment type enum for changeout/reading configuration
export const equipmentTypeEnum = ["system", "module", "both", "user_choice"] as const;
export type EquipmentType = (typeof equipmentTypeEnum)[number];

// Projects table - for customer organization with per-project database support
export const projects = pgTable("projects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  customerEmail: varchar("customer_email"),
  phone: varchar("phone", { length: 50 }),
  address: varchar("address", { length: 255 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 50 }),
  zip: varchar("zip", { length: 20 }),
  notes: text("notes"),
  databaseName: varchar("database_name", { length: 255 }),
  isActive: boolean("is_active").default(true),
  inventoryEnabled: boolean("inventory_enabled").notNull().default(false),
  // Dedicated routing endpoints manage this metadata; ordinary project DTOs
  // redact it so environment references are not general project information.
  routingConfiguration: jsonb("routing_configuration"),
  defaultServiceMinutes: integer("default_service_minutes"),
  defaultAppointmentToleranceMinutes: integer("default_appointment_tolerance_minutes"),
  webhookUrl: varchar("webhook_url", { length: 500 }),
  webhookEnabled: boolean("webhook_enabled").default(false),
  customerApiEnabled: boolean("customer_api_enabled").default(false),
  customerApiUrl: varchar("customer_api_url", { length: 500 }),
  customerApiAuthType: varchar("customer_api_auth_type", { length: 20 }).default("none"),
  customerApiKeyHeader: varchar("customer_api_key_header", { length: 100 }),
  customerApiSecretEnvVar: varchar("customer_api_secret_env_var", { length: 100 }),
  customerApiSendPhotos: boolean("customer_api_send_photos").default(true),
  operationalHoursEnabled: boolean("operational_hours_enabled").default(false),
  operationalHoursStart: varchar("operational_hours_start", { length: 10 }),
  operationalHoursEnd: varchar("operational_hours_end", { length: 10 }),
  operationalHoursDays: text("operational_hours_days").array(),
  timezone: varchar("timezone", { length: 100 }),
  wizardMode: varchar("wizard_mode", { length: 20 }).default("changeout"),
  wizardGpsMode: varchar("wizard_gps_mode", { length: 20 }).default("automatic"),
  systemReadingDecimalPlaces: integer("system_reading_decimal_places").notNull().default(3),
  moduleReadingDecimalPlaces: integer("module_reading_decimal_places").notNull().default(3),
  wizardShowNotesStep: boolean("wizard_show_notes_step").default(true),
  wizardShowGpsStep: boolean("wizard_show_gps_step").default(true),
  wizardShowBeforePhotosStep: boolean("wizard_show_before_photos_step").default(true),
  wizardShowAfterPhotosStep: boolean("wizard_show_after_photos_step").default(true),
  wizardShowSignatureStep: boolean("wizard_show_signature_step").default(true),
  // Search method visibility settings
  searchShowBarcodeScan: boolean("search_show_barcode_scan").default(true),
  searchShowQrCodeScan: boolean("search_show_qr_code_scan").default(true),
  searchShowManualEntry: boolean("search_show_manual_entry").default(true),
  searchShowHidScanner: boolean("search_show_hid_scanner").default(true),
  // Equipment type for changeout and reading modes
  changeoutEquipmentType: varchar("changeout_equipment_type", { length: 20 }).default("both"),
  readingEquipmentType: varchar("reading_equipment_type", { length: 20 }).default("both"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, table => [
  // Match the independently hosted upgrade path. Publishing/schema tools must
  // not remove rules which the next standalone startup would recreate.
  check("visit_default_duration_range", sql`${table.defaultServiceMinutes} BETWEEN 1 AND 480`),
  check("visit_default_tolerance_range", sql`${table.defaultAppointmentToleranceMinutes} BETWEEN 0 AND 240`),
]);

// Project Holidays - dates to exclude from scheduling
export const projectHolidays = pgTable("project_holidays", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  date: varchar("date", { length: 10 }).notNull(),
  name: varchar("name", { length: 100 }),
  createdAt: timestamp("created_at").defaultNow(),
});

// User-Project junction table (many-to-many relationship)
export const userProjects = pgTable("user_projects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

// User Groups table - for organizing users into assignable groups
export const userGroups = pgTable("user_groups", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 100 }).notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Group Members - many-to-many relationship between users and groups
export const userGroupMembers = pgTable("user_group_members", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  groupId: integer("group_id").notNull().references(() => userGroups.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

// User Group Projects - many-to-many relationship between user groups and projects
export const userGroupProjects = pgTable("user_group_projects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  groupId: integer("group_id").notNull().references(() => userGroups.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Customer API Logs - tracks outbound API calls to customer backends
export const customerApiLogs = pgTable("customer_api_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workOrderId: integer("work_order_id"),
  customerWoId: varchar("customer_wo_id", { length: 100 }),
  requestUrl: varchar("request_url", { length: 500 }).notNull(),
  requestMethod: varchar("request_method", { length: 10 }).notNull().default("POST"),
  requestPayload: text("request_payload"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  success: boolean("success").default(false),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0),
  deliveryId: text("delivery_id"),
  attemptNumber: integer("attempt_number"),
  triggeredBy: text("triggered_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const customerApiDeliveries = pgTable("customer_api_deliveries", {
  id: text("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workOrderId: integer("work_order_id").notNull(),
  customerWoId: varchar("customer_wo_id", { length: 100 }),
  versionKey: text("version_key").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  payload: text("payload"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  cycleAttempts: integer("cycle_attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockToken: text("lock_token"),
  lastError: text("last_error"),
  lastResponseStatus: integer("last_response_status"),
  requestedBy: text("requested_by"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("customer_api_deliveries_due").on(table.status, table.nextAttemptAt),
  uniqueIndex("customer_api_deliveries_version").on(table.projectId, table.workOrderId, table.versionKey)]);

// Customer API pull imports, independent of outbound delivery.
export const apiImportConfigs = pgTable("api_import_configs", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull(),
  cursor: text("cursor"),
  watermark: timestamp("watermark", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const apiImportRuns = pgTable("api_import_runs", {
  id: text("id").primaryKey(),
  configId: integer("config_id").references(() => apiImportConfigs.id, { onDelete: "set null" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  configName: text("config_name").notNull(),
  settings: jsonb("settings").notNull(),
  checkpoint: jsonb("checkpoint").notNull().default({}),
  status: text("status").notNull().default("queued"),
  triggeredBy: text("triggered_by").notNull(),
  currentUrl: text("current_url"),
  pageNumber: integer("page_number").notNull().default(0),
  pageValue: integer("page_value").notNull().default(1),
  candidateCursor: text("candidate_cursor"),
  visited: jsonb("visited").notNull().default([]),
  createdCount: integer("created_count").notNull().default(0),
  updatedCount: integer("updated_count").notNull().default(0),
  skippedCount: integer("skipped_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  fetchAttempts: integer("fetch_attempts").notNull().default(0),
  pageAttempts: integer("page_attempts").notNull().default(0),
  messages: jsonb("messages").notNull().default([]),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, table => [
  uniqueIndex("api_import_one_active_run").on(table.configId).where(sql`${table.status} IN ('queued','running','retrying')`),
  index("api_import_due").on(table.status, table.nextAttemptAt),
  index("api_import_project_history").on(table.projectId, table.startedAt),
]);
export const apiImportVersions = pgTable("api_import_versions", {
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workOrderId: integer("work_order_id").notNull(),
  customerWoId: text("customer_wo_id").notNull(),
  rowVersion: text("row_version").notNull(),
}, table => [primaryKey({ columns: [table.projectId, table.workOrderId] })]);

// User column preferences - stores which columns each user wants visible per page
export const userColumnPreferences = pgTable("user_column_preferences", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pageKey: varchar("page_key", { length: 50 }).notNull(),
  visibleColumns: jsonb("visible_columns").notNull(),
  stickyColumns: jsonb("sticky_columns").default([]),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User filter preferences - stores which search filters each user wants visible per page
export const userFilterPreferences = pgTable("user_filter_preferences", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pageKey: varchar("page_key", { length: 50 }).notNull(),
  visibleFilters: jsonb("visible_filters").notNull(),
  knownFilters: jsonb("known_filters"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// System settings table for application-wide configuration
export const systemSettings = pgTable("system_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value"),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Operational quota state, deliberately excluded from business backup payloads.
// Dispatch inputs are durable; provider payloads and device origins are not.
export const routeDispatches = pgTable("route_dispatches", {
  id: uuid("id").primaryKey(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  plannerId: varchar("planner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  assigneeId: varchar("assignee_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  originAddress: text("origin_address").notNull(),
  departureAt: timestamp("departure_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  configurationRevision: varchar("configuration_revision", { length: 64 }).notNull(),
  fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
  serviceMinutes: integer("service_minutes").notNull(),
  toleranceMinutes: integer("tolerance_minutes").notNull(),
  addressReviewVersion: integer("address_review_version").notNull(),
  assignmentRoutingVersion: integer("assignment_routing_version").notNull(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
}, t => [
  index("route_dispatches_inbox").on(t.projectId,t.assigneeId,t.expiresAt),
  check("route_dispatches_check", sql`${t.expiresAt} > ${t.departureAt} - interval '7 days'`),
]);
export const routeDispatchOrders = pgTable("route_dispatch_orders", {
  dispatchId: uuid("dispatch_id").notNull().references(() => routeDispatches.id, { onDelete: "cascade" }),
  // Work orders live in project schemas. Resolve this reference only through
  // its dispatch's project and always recheck its current assignment.
  workOrderId: integer("work_order_id").notNull(),
  position: integer("position").notNull(),
}, t => [
  primaryKey({ columns: [t.dispatchId,t.workOrderId] }),
  uniqueIndex("route_dispatch_orders_dispatch_id_position_key").on(t.dispatchId,t.position),
]);

export const routingDailyUsage = pgTable("routing_daily_usage", {
  accountHash: varchar("account_hash", { length: 64 }).notNull(),
  usageDay: date("usage_day").notNull(),
  plans: integer("plans").notNull().default(0),
}, table => [primaryKey({ columns: [table.accountHash, table.usageDay] })]);

// Instance-wide Android distribution, independent of project files and native update URLs.
export const mobileApkReleases = pgTable("mobile_apk_releases", {
  id: text("id").primaryKey(),
  version: varchar("version", { length: 64 }).notNull(),
  buildCode: integer("build_code"),
  notes: text("notes").notNull().default(""),
  fileName: varchar("file_name", { length: 180 }).notNull(),
  size: integer("size").notNull(),
  sha256: varchar("sha256", { length: 64 }).notNull(),
  provider: text("provider").notNull(),
  location: text("location").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  deleted: boolean("deleted").notNull().default(false),
  ready: boolean("ready").notNull().default(false),
  originUploadId: text("origin_upload_id"),
});
export const mobileApkPublication = pgTable("mobile_apk_publication", {
  id: integer("id").primaryKey(),
  releaseId: text("release_id").references(() => mobileApkReleases.id, { onDelete: "set null" }),
});
export const mobileApkUploads = pgTable("mobile_apk_uploads", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  fileName: varchar("file_name", { length: 180 }).notNull(),
  totalSize: integer("total_size").notNull(),
  totalChunks: integer("total_chunks").notNull(),
  metadata: jsonb("metadata").notNull(),
  provider: text("provider").notNull(),
  location: text("location").notNull(),
  received: integer("received").array().notNull().default(sql`'{}'::integer[]`),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull().default(sql`now() + interval '1 hour'`),
}, table => [index("mobile_apk_upload_expiry").on(table.expiresAt)]);

// Support submissions table - stores support form submissions
export const supportSubmissions = pgTable("support_submissions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").references(() => users.id, { onDelete: "set null" }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 500 }).notNull(),
  priority: varchar("priority", { length: 20 }).notNull().default("medium"),
  message: text("message").notNull(),
  emailSent: boolean("email_sent").default(false),
  emailError: text("email_error"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Database types enum for external database connections
export const databaseTypeEnum = ["postgresql", "mysql", "mssql", "oracle", "sqlite", "mariadb"] as const;
export type DatabaseType = (typeof databaseTypeEnum)[number];

// Import schedule frequency enum
export const importScheduleFrequencyEnum = ["manual", "every_15_minutes", "every_30_minutes", "hourly", "every_2_hours", "every_6_hours", "every_12_hours", "daily", "weekly", "monthly", "custom"] as const;
export type ImportScheduleFrequency = (typeof importScheduleFrequencyEnum)[number];

// Import job status enum
export const importJobStatusEnum = ["idle", "running", "success", "failed"] as const;
export type ImportJobStatus = (typeof importJobStatusEnum)[number];

// External database configurations per project
export const externalDatabaseConfigs = pgTable("external_database_configs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  databaseType: varchar("database_type", { length: 50 }).notNull(),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull(),
  databaseName: varchar("database_name", { length: 255 }).notNull(),
  username: varchar("username", { length: 255 }).notNull(),
  password: text("password").notNull(),
  sslEnabled: boolean("ssl_enabled").default(false),
  additionalOptions: jsonb("additional_options"),
  isActive: boolean("is_active").default(true),
  lastTestedAt: timestamp("last_tested_at"),
  lastTestResult: boolean("last_test_result"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Import configurations - SQL queries and schedules per database config
export const importConfigs = pgTable("import_configs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  externalDbConfigId: integer("external_db_config_id").notNull().references(() => externalDatabaseConfigs.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  sqlQuery: text("sql_query").notNull(),
  columnMapping: jsonb("column_mapping"),
  scheduleFrequency: varchar("schedule_frequency", { length: 50 }).notNull().default("manual"),
  customCronExpression: varchar("custom_cron_expression", { length: 100 }),
  isEnabled: boolean("is_enabled").default(true),
  lastRunAt: timestamp("last_run_at"),
  lastRunStatus: varchar("last_run_status", { length: 50 }),
  lastRunMessage: text("last_run_message"),
  lastRunRecordCount: integer("last_run_record_count"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Import history - tracks each import execution
export const importHistory = pgTable("import_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  importConfigId: integer("import_config_id").notNull().references(() => importConfigs.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 50 }).notNull(),
  recordsImported: integer("records_imported").default(0),
  recordsFailed: integer("records_failed").default(0),
  errorDetails: text("error_details"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

// File import configurations - scheduled pickup from FTP directory
export const fileImportConfigs = pgTable("file_import_configs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  delimiter: varchar("delimiter", { length: 10 }).notNull().default(","),
  hasHeader: boolean("has_header").default(true),
  columnMapping: jsonb("column_mapping"),
  scheduleFrequency: varchar("schedule_frequency", { length: 50 }).notNull().default("manual"),
  customCronExpression: varchar("custom_cron_expression", { length: 100 }),
  isEnabled: boolean("is_enabled").default(true),
  processedFilePattern: varchar("processed_file_pattern", { length: 255 }),
  lastProcessedFile: varchar("last_processed_file", { length: 500 }),
  lastRunAt: timestamp("last_run_at"),
  lastRunStatus: varchar("last_run_status", { length: 50 }),
  lastRunMessage: text("last_run_message"),
  lastRunRecordCount: integer("last_run_record_count"),
  nextRunAt: timestamp("next_run_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// File import history - tracks each file import execution (both scheduled and manual)
export const fileImportHistory = pgTable("file_import_history", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  fileImportConfigId: integer("file_import_config_id").references(() => fileImportConfigs.id, { onDelete: "cascade" }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  importSource: varchar("import_source", { length: 50 }).notNull().default("scheduled"),
  userName: varchar("user_name", { length: 255 }),
  fileName: varchar("file_name", { length: 500 }).notNull(),
  status: varchar("status", { length: 50 }).notNull(),
  recordsImported: integer("records_imported").default(0),
  recordsFailed: integer("records_failed").default(0),
  errorDetails: text("error_details"),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

// Work order statuses table - configurable status codes
export const workOrderStatuses = pgTable("work_order_statuses", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  label: varchar("label", { length: 100 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 20 }),
  isDefault: boolean("is_default").default(false),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Default work order status values (for seeding)
export const defaultWorkOrderStatuses = ["Open", "Completed", "Scheduled", "Skipped", "Trouble"] as const;
export type DefaultWorkOrderStatus = (typeof defaultWorkOrderStatuses)[number];

export const workOrderSubStatuses = pgTable("work_order_sub_statuses", {
  id: uuid("id").primaryKey(),
  parentStatusId: integer("parent_status_id").notNull().references(() => workOrderStatuses.id, { onDelete: "restrict" }),
  projectId: integer("project_id").references(() => projects.id, { onDelete: "cascade" }),
  code: varchar("code", { length: 50 }).notNull(),
  label: varchar("label", { length: 100 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 20 }),
  sortOrder: integer("sort_order").notNull().default(0),
  routingPriority: integer("routing_priority"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Trouble codes table - configurable trouble/issue codes for work orders
export const troubleCodes = pgTable("trouble_codes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  label: varchar("label", { length: 100 }).notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Service types table - configurable service type codes
export const serviceTypes = pgTable("service_types", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  label: varchar("label", { length: 100 }).notNull(),
  color: varchar("color", { length: 20 }),
  isDefault: boolean("is_default").default(false),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// System types table - product types (no longer tied to a single project)
export const systemTypes = pgTable("system_types", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  productId: varchar("product_id", { length: 100 }).notNull().unique(),
  productLabel: varchar("product_label", { length: 255 }).notNull(),
  productDescription: text("product_description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Junction table for system types to projects (many-to-many)
export const systemTypeProjects = pgTable("system_type_projects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  systemTypeId: integer("system_type_id").notNull().references(() => systemTypes.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Module types table - product types for modules (mirrors system types)
export const moduleTypes = pgTable("module_types", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  productId: varchar("product_id", { length: 100 }).notNull().unique(),
  productLabel: varchar("product_label", { length: 255 }).notNull(),
  productDescription: text("product_description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Junction table for module types to projects (many-to-many)
export const moduleTypeProjects = pgTable("module_type_projects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  moduleTypeId: integer("module_type_id").notNull().references(() => moduleTypes.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Junction table for service types to projects (many-to-many)
export const projectServiceTypes = pgTable("project_service_types", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  serviceTypeId: integer("service_type_id").notNull().references(() => serviceTypes.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow(),
});

// Work order time tracking - tracks start/end times for field tech work on work orders
export const workOrderTimeTracking = pgTable("work_order_time_tracking", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  systemWorkOrderId: text("system_work_order_id").notNull(),
  startTime: timestamp("start_time").notNull(),
  endTime: timestamp("end_time").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Default service type values (for backward compatibility and seeding)
export const defaultServiceTypes = ["Water", "Electric", "Gas"] as const;
export type DefaultServiceType = (typeof defaultServiceTypes)[number];

// Service type enum for utility work orders (kept for backward compatibility)
export const serviceTypeEnum = ["Water", "Electric", "Gas"] as const;
export type ServiceType = (typeof serviceTypeEnum)[number];

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  userProjects: many(userProjects),
}));

export const projectsRelations = relations(projects, ({ many }) => ({
  userProjects: many(userProjects),
}));

export const userProjectsRelations = relations(userProjects, ({ one }) => ({
  user: one(users, {
    fields: [userProjects.userId],
    references: [users.id],
  }),
  project: one(projects, {
    fields: [userProjects.projectId],
    references: [projects.id],
  }),
}));

// Insert schemas - defined manually for proper type inference
export const insertUserSchema = z.object({
  email: z.string().email().optional().nullable(),
  username: z.string().min(3).max(100).optional().nullable(),
  passwordHash: z.string().optional().nullable(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  profileImageUrl: z.string().optional().nullable(),
  role: z.enum(userRoleEnum).optional(),
  isLocked: z.boolean().optional(),
  lockedReason: z.string().optional().nullable(),
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  website: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Schema for creating a new user
export const createUserSchema = z.object({
  username: z.string().min(3).max(100),
  password: z.string().min(8).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Password must contain at least one uppercase letter, one lowercase letter, and one number"
  ),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional().nullable(),
  role: z.enum(userRoleEnum).default("user"),
  subroleId: z.number().nullable().optional(),
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  website: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable(),
  projectIds: z.array(z.number()).optional(),
  groupIds: z.array(z.number()).optional(),
});

// Schema for updating a user
export const updateUserSchema = z.object({
  username: z.string().min(3).max(100).optional(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  role: z.enum(userRoleEnum).optional(),
  subroleId: z.number().optional().nullable(),
  isLocked: z.boolean().optional(),
  lockedReason: z.string().optional().nullable(),
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  website: z.string().max(255).optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Schema for password reset
export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Password must contain at least one uppercase letter, one lowercase letter, and one number"
  ),
});

// Schema for changing own password (self-service)
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Password must contain at least one uppercase letter, one lowercase letter, and one number"
  ),
  confirmPassword: z.string().min(1, "Please confirm your new password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

// Schema for updating own profile (self-service, limited fields)
export const updateProfileSchema = z.object({
  firstName: z.string().max(100).optional().nullable(),
  lastName: z.string().max(100).optional().nullable(),
  email: z.string().email("Invalid email address").optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
});
export type UpdateProfile = z.infer<typeof updateProfileSchema>;

export const insertProjectSchema = z.object({
  name: z.string().min(1).max(255),
  inventoryEnabled: z.boolean().optional().default(false),
  description: z.string().optional().nullable(),
  customerEmail: z.string().email().optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  address: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  notes: z.string().optional().nullable(),
  customerApiEnabled: z.boolean().optional().default(false),
  customerApiUrl: z.string().max(500).optional().nullable(),
  customerApiAuthType: z.enum(["none", "api_key", "bearer_token", "basic_auth"]).optional().default("none"),
  customerApiKeyHeader: z.string().max(100).optional().nullable(),
  customerApiSecretEnvVar: z.string().max(100).optional().nullable(),
  customerApiSendPhotos: z.boolean().optional().default(true),
  operationalHoursEnabled: z.boolean().optional().default(false),
  operationalHoursStart: z.string().max(10).optional().nullable(),
  operationalHoursEnd: z.string().max(10).optional().nullable(),
  operationalHoursDays: z.array(z.string()).optional().nullable(),
  timezone: z.string().max(100).optional().nullable(),
  defaultServiceMinutes: z.number().int().min(1).max(480).nullable().optional(),
  defaultAppointmentToleranceMinutes: z.number().int().min(0).max(240).nullable().optional(),
  wizardMode: z.enum(wizardModeEnum).optional().default("changeout"),
  wizardGpsMode: z.enum(gpsModeEnum).optional().default("automatic"),
  systemReadingDecimalPlaces: readingDecimalPlacesSchema.optional().default(3),
  moduleReadingDecimalPlaces: readingDecimalPlacesSchema.optional().default(3),
  wizardShowNotesStep: z.boolean().optional().default(true),
  wizardShowGpsStep: z.boolean().optional().default(true),
  wizardShowBeforePhotosStep: z.boolean().optional().default(true),
  wizardShowAfterPhotosStep: z.boolean().optional().default(true),
  wizardShowSignatureStep: z.boolean().optional().default(true),
  changeoutEquipmentType: z.enum(equipmentTypeEnum).optional().default("both"),
  readingEquipmentType: z.enum(equipmentTypeEnum).optional().default("both"),
  // Search method visibility settings
  searchShowBarcodeScan: z.boolean().optional().default(true),
  searchShowQrCodeScan: z.boolean().optional().default(true),
  searchShowManualEntry: z.boolean().optional().default(true),
  searchShowHidScanner: z.boolean().optional().default(true),
});

export const insertProjectHolidaySchema = z.object({
  projectId: z.number(),
  date: z.string().max(10),
  name: z.string().max(100).optional().nullable(),
});

export const insertSubroleSchema = z.object({
  key: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  baseRole: z.enum(userRoleEnum).default("user"),
  description: z.string().optional().nullable(),
});

export const insertPermissionSchema = z.object({
  key: z.string().min(1).max(100),
  label: z.string().min(1).max(100),
  category: z.string().min(1).max(50),
  description: z.string().optional().nullable(),
});

export const insertSubrolePermissionSchema = z.object({
  subroleId: z.number(),
  permissionKey: z.string(),
});

export const insertUserProjectSchema = z.object({
  userId: z.string(),
  projectId: z.number(),
});

export const insertUserGroupSchema = z.object({
  name: z.string().min(1, "Group name is required").max(100),
  description: z.string().optional().nullable(),
});

export const insertUserGroupMemberSchema = z.object({
  groupId: z.number(),
  userId: z.string(),
});

export const insertUserGroupProjectSchema = z.object({
  groupId: z.number(),
  projectId: z.number(),
});

export const insertUserColumnPreferencesSchema = z.object({
  userId: z.string(),
  pageKey: z.string().max(50),
  visibleColumns: z.array(z.string()),
  stickyColumns: z.array(z.string()).optional(),
});

export const insertUserFilterPreferencesSchema = z.object({
  userId: z.string(),
  pageKey: z.string().max(50),
  visibleFilters: z.array(z.string()),
});

export const insertSystemSettingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

export const insertSupportSubmissionSchema = z.object({
  userId: z.string().optional().nullable(),
  name: z.string().min(1).max(255),
  email: z.string().email().max(255),
  subject: z.string().min(1).max(500),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  message: z.string().min(1),
  emailSent: z.boolean().optional().default(false),
  emailError: z.string().optional().nullable(),
});

// Project work order schema for utility meter tracking
export const insertProjectWorkOrderSchema = z.object({
  inventoryItems: inventoryImportSchema.optional(),
  customerWoId: z.string().min(1, "Work Order ID is required").max(100),
  customerId: z.string().min(1, "Customer ID is required").max(100),
  customerName: z.string().min(1, "Customer name is required").max(255),
  address: z.string().min(1, "Address is required").max(500),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().max(255).optional().nullable().or(z.literal("")),
  route: z.string().max(100).optional().nullable(),
  zone: z.string().max(100).optional().nullable(),
  serviceType: z.string().min(1, "Service type is required"),
  oldSystemId: z.string().max(100).optional().nullable(),
  oldSystemReading: z.union([z.string(),z.number()]).optional().nullable(),
  newSystemId: z.string().max(100).optional().nullable(),
  newSystemReading: z.union([z.string(),z.number()]).optional().nullable(),
  oldGps: z.string().max(100).optional().nullable(),
  newGps: z.string().max(100).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  subStatusId: z.string().uuid().optional().nullable(),
  scheduledAt: z.string().optional().nullable(),
  serviceDurationMinutes: z.number().int().min(1).max(480).nullable().optional(),
  appointmentWindowStart: z.string().datetime({ offset: true }).nullable().optional(),
  appointmentWindowEnd: z.string().datetime({ offset: true }).nullable().optional(),
  scheduledBy: z.string().optional().nullable(),
  assignedUserId: z.string().optional().nullable(),
  assignedGroupId: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  completedBy: z.string().optional().nullable(),
  trouble: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
  attachments: z.array(z.string()).optional().nullable(),
  oldSystemType: z.string().max(255).optional().nullable(),
  newSystemType: z.string().max(255).optional().nullable(),
  oldModuleId: z.string().max(100).optional().nullable(),
  newModuleId: z.string().max(100).optional().nullable(),
  oldModuleRead: z.union([z.string(),z.number()]).optional().nullable(),
  newModuleRead: z.union([z.string(),z.number()]).optional().nullable(),
  oldModuleType: z.string().max(255).optional().nullable(),
  newModuleType: z.string().max(255).optional().nullable(),
  signatureData: z.string().optional().nullable(),
  signatureName: z.string().max(255).optional().nullable(),
});

// Schema for work order status management
export const insertWorkOrderStatusSchema = z.object({
  code: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  color: z.string().max(20).optional().nullable(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const updateWorkOrderStatusSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  label: z.string().min(1).max(100).optional(),
  description: z.string().optional().nullable(),
  color: z.string().max(20).optional().nullable(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// Schema for trouble code management
export const insertTroubleCodeSchema = z.object({
  code: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

export const updateTroubleCodeSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  label: z.string().min(1).max(100).optional(),
  description: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

// Schema for service type management
export const insertServiceTypeSchema = z.object({
  code: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  color: z.string().max(20).optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const updateServiceTypeSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  label: z.string().min(1).max(100).optional(),
  color: z.string().max(20).optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

// Schema for system type management
export const insertSystemTypeSchema = z.object({
  productId: z.string().min(1).max(100),
  productLabel: z.string().min(1).max(255),
  productDescription: z.string().optional().nullable(),
  projectIds: z.array(z.number()).optional(),
});

export const updateSystemTypeSchema = z.object({
  productId: z.string().min(1).max(100).optional(),
  productLabel: z.string().min(1).max(255).optional(),
  productDescription: z.string().optional().nullable(),
  projectIds: z.array(z.number()).optional(),
});

// Schema for system type project assignment
export const insertSystemTypeProjectSchema = z.object({
  systemTypeId: z.number(),
  projectId: z.number(),
});

// Schema for module type management
export const insertModuleTypeSchema = z.object({
  productId: z.string().min(1).max(100),
  productLabel: z.string().min(1).max(255),
  productDescription: z.string().optional().nullable(),
  projectIds: z.array(z.number()).optional(),
});

export const updateModuleTypeSchema = z.object({
  productId: z.string().min(1).max(100).optional(),
  productLabel: z.string().min(1).max(255).optional(),
  productDescription: z.string().optional().nullable(),
  projectIds: z.array(z.number()).optional(),
});

// Schema for module type project assignment
export const insertModuleTypeProjectSchema = z.object({
  moduleTypeId: z.number(),
  projectId: z.number(),
});

// Schema for project service type assignment
export const insertProjectServiceTypeSchema = z.object({
  serviceTypeId: z.number(),
  projectId: z.number(),
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
// Extended user type with subrole key (returned by /api/auth/user)
export type UserWithSubroleKey = User & { subroleKey?: string | null };
export type InsertUser = z.infer<typeof insertUserSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type ResetPassword = z.infer<typeof resetPasswordSchema>;
export type ChangePassword = z.infer<typeof changePasswordSchema>;

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export type ProjectHoliday = typeof projectHolidays.$inferSelect;
export type InsertProjectHoliday = z.infer<typeof insertProjectHolidaySchema>;

export type UserProject = typeof userProjects.$inferSelect;
export type InsertUserProject = z.infer<typeof insertUserProjectSchema>;

export type UserGroup = typeof userGroups.$inferSelect;
export type InsertUserGroup = z.infer<typeof insertUserGroupSchema>;

export type UserGroupMember = typeof userGroupMembers.$inferSelect;
export type InsertUserGroupMember = z.infer<typeof insertUserGroupMemberSchema>;

export type UserGroupProject = typeof userGroupProjects.$inferSelect;
export type InsertUserGroupProject = z.infer<typeof insertUserGroupProjectSchema>;

export type CustomerApiLog = typeof customerApiLogs.$inferSelect;
export const insertCustomerApiLogSchema = z.object({
  projectId: z.number(),
  workOrderId: z.number().optional().nullable(),
  customerWoId: z.string().max(100).optional().nullable(),
  requestUrl: z.string().max(500),
  requestMethod: z.string().max(10).optional().default("POST"),
  requestPayload: z.string().optional().nullable(),
  responseStatus: z.number().optional().nullable(),
  responseBody: z.string().optional().nullable(),
  success: z.boolean().optional().default(false),
  errorMessage: z.string().optional().nullable(),
  retryCount: z.number().optional().default(0),
});
export type InsertCustomerApiLog = z.infer<typeof insertCustomerApiLogSchema>;

export type UserColumnPreferences = typeof userColumnPreferences.$inferSelect;
export type InsertUserColumnPreferences = z.infer<typeof insertUserColumnPreferencesSchema>;

export type UserFilterPreferences = typeof userFilterPreferences.$inferSelect;
export type InsertUserFilterPreferences = z.infer<typeof insertUserFilterPreferencesSchema>;

// Extended user group with project associations
export type UserGroupWithProjects = UserGroup & { projectIds: number[] };

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;

export type SupportSubmission = typeof supportSubmissions.$inferSelect;
export type InsertSupportSubmission = z.infer<typeof insertSupportSubmissionSchema>;

export type InsertProjectWorkOrder = z.infer<typeof insertProjectWorkOrderSchema>;

// Legacy global work-order screens use a separate API shape from project work orders.
export interface WorkOrder {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  projectId: number | null;
  assignedTo: string | null;
  dueDate: string | Date | null;
  notes: string | null;
  attachments: string[] | null;
  createdAt: string | Date | null;
  completedAt?: string | Date | null;
}

export type Subrole = typeof subroles.$inferSelect;
export type InsertSubrole = z.infer<typeof insertSubroleSchema>;

export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;

export type SubrolePermission = typeof subrolePermissions.$inferSelect;
export type InsertSubrolePermission = z.infer<typeof insertSubrolePermissionSchema>;

export type SystemType = typeof systemTypes.$inferSelect;
export type InsertSystemType = z.infer<typeof insertSystemTypeSchema>;
export type UpdateSystemType = z.infer<typeof updateSystemTypeSchema>;

export type SystemTypeProject = typeof systemTypeProjects.$inferSelect;
export type InsertSystemTypeProject = z.infer<typeof insertSystemTypeProjectSchema>;

// Extended system type with project associations
export type SystemTypeWithProjects = SystemType & { projectIds: number[] };

export type ModuleType = typeof moduleTypes.$inferSelect;
export type InsertModuleType = z.infer<typeof insertModuleTypeSchema>;
export type UpdateModuleType = z.infer<typeof updateModuleTypeSchema>;

export type ModuleTypeProject = typeof moduleTypeProjects.$inferSelect;
export type InsertModuleTypeProject = z.infer<typeof insertModuleTypeProjectSchema>;

// Extended module type with project associations
export type ModuleTypeWithProjects = ModuleType & { projectIds: number[] };

export type ProjectServiceType = typeof projectServiceTypes.$inferSelect;
export type InsertProjectServiceType = z.infer<typeof insertProjectServiceTypeSchema>;

// Extended service type with project associations
export type ServiceTypeWithProjects = ServiceTypeRecord & { projectIds: number[] };

// External database config schemas and types
export const insertExternalDatabaseConfigSchema = z.object({
  projectId: z.number(),
  name: z.string().min(1).max(255),
  databaseType: z.enum(databaseTypeEnum),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  databaseName: z.string().min(1).max(255),
  username: z.string().min(1).max(255),
  password: z.string().min(1),
  sslEnabled: z.boolean().optional(),
  additionalOptions: z.record(z.any()).optional(),
  isActive: z.boolean().optional(),
});

export const updateExternalDatabaseConfigSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  databaseType: z.enum(databaseTypeEnum).optional(),
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  databaseName: z.string().min(1).max(255).optional(),
  username: z.string().min(1).max(255).optional(),
  password: z.string().min(1).optional(),
  sslEnabled: z.boolean().optional(),
  additionalOptions: z.record(z.any()).optional(),
  isActive: z.boolean().optional(),
});

export type ExternalDatabaseConfig = typeof externalDatabaseConfigs.$inferSelect;
export type InsertExternalDatabaseConfig = z.infer<typeof insertExternalDatabaseConfigSchema>;
export type UpdateExternalDatabaseConfig = z.infer<typeof updateExternalDatabaseConfigSchema>;

// Import config schemas and types
export const insertImportConfigSchema = z.object({
  externalDbConfigId: z.number(),
  name: z.string().min(1).max(255),
  sqlQuery: z.string().min(1),
  columnMapping: z.record(z.string()).optional(),
  scheduleFrequency: z.enum(importScheduleFrequencyEnum).optional(),
  isEnabled: z.boolean().optional(),
});

export const updateImportConfigSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  sqlQuery: z.string().min(1).optional(),
  columnMapping: z.record(z.string()).optional(),
  scheduleFrequency: z.enum(importScheduleFrequencyEnum).optional(),
  isEnabled: z.boolean().optional(),
});

export type ImportConfig = typeof importConfigs.$inferSelect;
export type InsertImportConfig = z.infer<typeof insertImportConfigSchema>;
export type UpdateImportConfig = z.infer<typeof updateImportConfigSchema>;

// Import history types
export type ImportHistory = typeof importHistory.$inferSelect;

// File import config schemas and types
export const insertFileImportConfigSchema = z.object({
  projectId: z.number(),
  name: z.string().min(1).max(255),
  delimiter: z.string().max(10).optional(),
  hasHeader: z.boolean().optional(),
  columnMapping: z.record(z.string()).optional(),
  scheduleFrequency: z.enum(importScheduleFrequencyEnum).optional(),
  customCronExpression: z.string().max(100).optional().nullable(),
  isEnabled: z.boolean().optional(),
  processedFilePattern: z.string().max(255).optional().nullable(),
});

export const updateFileImportConfigSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  delimiter: z.string().max(10).optional(),
  hasHeader: z.boolean().optional(),
  columnMapping: z.record(z.string()).optional(),
  scheduleFrequency: z.enum(importScheduleFrequencyEnum).optional(),
  customCronExpression: z.string().max(100).optional().nullable(),
  isEnabled: z.boolean().optional(),
  processedFilePattern: z.string().max(255).optional().nullable(),
});

export type FileImportConfig = typeof fileImportConfigs.$inferSelect;
export type InsertFileImportConfig = z.infer<typeof insertFileImportConfigSchema>;
export type UpdateFileImportConfig = z.infer<typeof updateFileImportConfigSchema>;

// File import history types
export type FileImportHistory = typeof fileImportHistory.$inferSelect;

// Work order status types
export type WorkOrderStatus = typeof workOrderStatuses.$inferSelect;
export type InsertWorkOrderStatus = z.infer<typeof insertWorkOrderStatusSchema>;
export type UpdateWorkOrderStatus = z.infer<typeof updateWorkOrderStatusSchema>;

// Trouble code types
export type TroubleCode = typeof troubleCodes.$inferSelect;
export type InsertTroubleCode = z.infer<typeof insertTroubleCodeSchema>;
export type UpdateTroubleCode = z.infer<typeof updateTroubleCodeSchema>;

// Service type types
export type ServiceTypeRecord = typeof serviceTypes.$inferSelect;
export type InsertServiceType = z.infer<typeof insertServiceTypeSchema>;
export type UpdateServiceType = z.infer<typeof updateServiceTypeSchema>;

// Work order time tracking schema and types
export const insertWorkOrderTimeTrackingSchema = z.object({
  projectId: z.number(),
  systemWorkOrderId: z.string(),
  startTime: z.string().or(z.date()),
  endTime: z.string().or(z.date()),
});
export type WorkOrderTimeTracking = typeof workOrderTimeTracking.$inferSelect;
export type InsertWorkOrderTimeTracking = z.infer<typeof insertWorkOrderTimeTrackingSchema>;

// Permission keys - granular permissions from the registry
export const permissionKeys = {
  INVENTORY_CONFIGURE: "inventory.configure",
  INVENTORY_VIEW: "inventory.view",
  INVENTORY_MAINTAIN: "inventory.maintain",
  INVENTORY_RECEIVE: "inventory.receive",
  INVENTORY_PURCHASE: "inventory.purchase",
  INVENTORY_TRANSFER: "inventory.transfer",
  INVENTORY_COUNT: "inventory.count",
  INVENTORY_ASSIGN: "inventory.assign",
  INVENTORY_ASSEMBLE: "inventory.assemble",
  INVENTORY_CLOSE_ORDERS: "inventory.closeOrders",
  INVENTORY_RESOLVE_EXCEPTIONS: "inventory.resolveExceptions",
  AUDIT_VIEW: "audit.view",
  AUDIT_ALL_PROJECTS: "audit.viewAllProjects",
  AUDIT_MANAGE_RETENTION: "audit.manageRetention",
  // Navigation permissions
  NAV_DASHBOARD: "nav.dashboard",
  NAV_PROJECTS: "nav.projects",
  NAV_USERS: "nav.users",
  NAV_MAINTENANCE: "nav.maintenance",
  NAV_SETTINGS: "nav.settings",
  NAV_SEARCH_REPORTS: "nav.searchReports",
  // Project menu permissions
  PROJECT_WORK_ORDERS: "project.workOrders",
  PROJECT_DOCUMENTS: "project.documents",
  PROJECT_IMPORT: "project.import",
  PROJECT_FTP_FILES: "project.ftpFiles",
  PROJECT_DB_IMPORT: "project.dbImport",
  PROJECT_API_IMPORT: "project.apiImport",
  // Project actions
  PROJECTS_VIEW: "projects.view",
  PROJECTS_VIEW_INACTIVE: "projects.viewInactive",
  PROJECTS_CREATE: "projects.create",
  PROJECTS_EDIT: "projects.edit",
  PROJECTS_READING_PRECISION: "projects.readingPrecision",
  PROJECTS_DELETE: "projects.delete",
  // Work order actions
  WORK_ORDERS_VIEW: "workOrders.view",
  WORK_ORDERS_CREATE: "workOrders.create",
  WORK_ORDERS_EDIT: "workOrders.edit",
  WORK_ORDERS_DELETE: "workOrders.delete",
  WORK_ORDERS_ASSIGN: "workOrders.assign",
  WORK_ORDERS_METER_CHANGEOUT: "workOrders.meterChangeout",
  // User actions
  USERS_VIEW: "users.view",
  USERS_CREATE: "users.create",
  USERS_EDIT: "users.edit",
  USERS_DELETE: "users.delete",
  USERS_LOCK: "users.lock",
  USERS_RESET_PASSWORD: "users.resetPassword",
  // Settings permissions
  SETTINGS_PROJECT_FILES: "settings.projectFiles",
  SETTINGS_FILE_UPLOAD: "settings.fileUpload",
  SETTINGS_TIMEZONE: "settings.timezone",
  SETTINGS_IMPORT_HISTORY: "settings.importHistory",
  SETTINGS_DB_IMPORT_HISTORY: "settings.dbImportHistory",
  SETTINGS_STATUSES: "settings.statuses",
  SETTINGS_TROUBLE_CODES: "settings.troubleCodes",
  SETTINGS_USER_GROUPS: "settings.userGroups",
  SETTINGS_SERVICE_TYPES: "settings.serviceTypes",
  SETTINGS_SYSTEM_TYPES: "settings.systemTypes",
  SETTINGS_MODULE_TYPES: "settings.moduleTypes",
  SETTINGS_CUSTOMER_API_LOGS: "settings.customerApiLogs",
  SETTINGS_MOBILE_CONFIG: "settings.mobileConfig",
  SETTINGS_WEB_UPDATE: "settings.webUpdate",
  SETTINGS_SECURITY: "settings.security",
  SETTINGS_CONTACT_SUPPORT: "settings.contactSupport",
  // Maintenance permissions
  MAINTENANCE_LOG_MANAGEMENT: "maintenance.logManagement",
  MAINTENANCE_PROJECT_BACKUP: "maintenance.projectBackup",
  MAINTENANCE_PROJECT_RESTORE: "maintenance.projectRestore",
  MAINTENANCE_SYSTEM_BACKUP: "maintenance.systemBackup",
  MAINTENANCE_SYSTEM_RESTORE: "maintenance.systemRestore",
} as const;

export const ADMINISTRATOR_SUBROLE_KEY = "administrator";
export const PROJECT_MANAGER_SUBROLE_KEY = "project_manager";
export const FIELD_TECHNICIAN_SUBROLE_KEY = "field_technician";
export const VIEWER_SUBROLE_KEY = "viewer";

// Subrole hierarchy - higher number = more privileges
// Used to prevent privilege escalation (users can only assign subroles with equal or lower level)
export const SUBROLE_HIERARCHY: Record<string, number> = {
  [ADMINISTRATOR_SUBROLE_KEY]: 100,
  [PROJECT_MANAGER_SUBROLE_KEY]: 75,
  [FIELD_TECHNICIAN_SUBROLE_KEY]: 50,
  [VIEWER_SUBROLE_KEY]: 25,
};

// Helper function to get subrole level (returns 0 if unknown)
export function getSubroleLevel(subroleKey: string | null | undefined): number {
  if (!subroleKey) return 0;
  return SUBROLE_HIERARCHY[subroleKey] ?? 0;
}

export type PermissionKey = typeof permissionKeys[keyof typeof permissionKeys];
