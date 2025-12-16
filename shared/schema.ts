import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, jsonb, index, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

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

// Projects table - for customer organization with per-project database support
export const projects = pgTable("projects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  customerEmail: varchar("customer_email"),
  databaseName: varchar("database_name", { length: 255 }),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
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

// User column preferences - stores which columns each user wants visible per page
export const userColumnPreferences = pgTable("user_column_preferences", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  pageKey: varchar("page_key", { length: 50 }).notNull(),
  visibleColumns: jsonb("visible_columns").notNull(),
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

// Meter types table - product types (no longer tied to a single project)
export const meterTypes = pgTable("meter_types", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  productId: varchar("product_id", { length: 100 }).notNull(),
  productLabel: varchar("product_label", { length: 255 }).notNull(),
  productDescription: text("product_description"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Junction table for meter types to projects (many-to-many)
export const meterTypeProjects = pgTable("meter_type_projects", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  meterTypeId: integer("meter_type_id").notNull().references(() => meterTypes.id, { onDelete: "cascade" }),
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
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

export const insertProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  customerEmail: z.string().email().optional().nullable(),
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

// Project work order schema for utility meter tracking
export const insertProjectWorkOrderSchema = z.object({
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
  serviceType: z.enum(serviceTypeEnum),
  oldMeterId: z.string().max(100).optional().nullable(),
  oldMeterReading: z.number().int().optional().nullable(),
  newMeterId: z.string().max(100).optional().nullable(),
  newMeterReading: z.number().int().optional().nullable(),
  oldGps: z.string().max(100).optional().nullable(),
  newGps: z.string().max(100).optional().nullable(),
  status: z.string().max(50).optional().nullable(),
  scheduledDate: z.string().optional().nullable(),
  assignedUserId: z.string().optional().nullable(),
  assignedGroupId: z.number().int().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  trouble: z.string().max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
  attachments: z.array(z.string()).optional().nullable(),
  oldMeterType: z.string().max(255).optional().nullable(),
  newMeterType: z.string().max(255).optional().nullable(),
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

// Schema for meter type management
export const insertMeterTypeSchema = z.object({
  productId: z.string().min(1).max(100),
  productLabel: z.string().min(1).max(255),
  productDescription: z.string().optional().nullable(),
  projectIds: z.array(z.number()).optional(),
});

export const updateMeterTypeSchema = z.object({
  productId: z.string().min(1).max(100).optional(),
  productLabel: z.string().min(1).max(255).optional(),
  productDescription: z.string().optional().nullable(),
  projectIds: z.array(z.number()).optional(),
});

// Schema for meter type project assignment
export const insertMeterTypeProjectSchema = z.object({
  meterTypeId: z.number(),
  projectId: z.number(),
});

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type ResetPassword = z.infer<typeof resetPasswordSchema>;

export type Project = typeof projects.$inferSelect;
export type InsertProject = z.infer<typeof insertProjectSchema>;

export type UserProject = typeof userProjects.$inferSelect;
export type InsertUserProject = z.infer<typeof insertUserProjectSchema>;

export type UserGroup = typeof userGroups.$inferSelect;
export type InsertUserGroup = z.infer<typeof insertUserGroupSchema>;

export type UserGroupMember = typeof userGroupMembers.$inferSelect;
export type InsertUserGroupMember = z.infer<typeof insertUserGroupMemberSchema>;

export type UserGroupProject = typeof userGroupProjects.$inferSelect;
export type InsertUserGroupProject = z.infer<typeof insertUserGroupProjectSchema>;

export type UserColumnPreferences = typeof userColumnPreferences.$inferSelect;
export type InsertUserColumnPreferences = z.infer<typeof insertUserColumnPreferencesSchema>;

export type UserFilterPreferences = typeof userFilterPreferences.$inferSelect;
export type InsertUserFilterPreferences = z.infer<typeof insertUserFilterPreferencesSchema>;

// Extended user group with project associations
export type UserGroupWithProjects = UserGroup & { projectIds: number[] };

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;

export type InsertProjectWorkOrder = z.infer<typeof insertProjectWorkOrderSchema>;

export type Subrole = typeof subroles.$inferSelect;
export type InsertSubrole = z.infer<typeof insertSubroleSchema>;

export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;

export type SubrolePermission = typeof subrolePermissions.$inferSelect;
export type InsertSubrolePermission = z.infer<typeof insertSubrolePermissionSchema>;

export type MeterType = typeof meterTypes.$inferSelect;
export type InsertMeterType = z.infer<typeof insertMeterTypeSchema>;
export type UpdateMeterType = z.infer<typeof updateMeterTypeSchema>;

export type MeterTypeProject = typeof meterTypeProjects.$inferSelect;
export type InsertMeterTypeProject = z.infer<typeof insertMeterTypeProjectSchema>;

// Extended meter type with project associations
export type MeterTypeWithProjects = MeterType & { projectIds: number[] };

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

// Default permission keys
export const permissionKeys = {
  PROJECTS_VIEW: "projects.view",
  PROJECTS_MANAGE: "projects.manage",
  WORK_ORDERS_VIEW: "workOrders.view",
  WORK_ORDERS_CREATE: "workOrders.create",
  WORK_ORDERS_EDIT: "workOrders.edit",
  WORK_ORDERS_DELETE: "workOrders.delete",
  USERS_MANAGE: "users.manage",
  SETTINGS_MANAGE: "settings.manage",
  MAINTENANCE_MANAGE: "maintenance.manage",
  FILES_UPLOAD: "files.upload",
  FILES_DELETE: "files.delete",
  IMPORT_DATA: "import.data",
  SEARCH_REPORTS: "search.reports",
} as const;

export type PermissionKey = typeof permissionKeys[keyof typeof permissionKeys];
