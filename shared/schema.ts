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

// System settings table for application-wide configuration
export const systemSettings = pgTable("system_settings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  key: varchar("key", { length: 100 }).notNull().unique(),
  value: text("value"),
  description: text("description"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Work order status enum
export const workOrderStatusEnum = ["pending", "in_progress", "completed", "cancelled"] as const;
export type WorkOrderStatus = (typeof workOrderStatusEnum)[number];

// Work order priority enum
export const workOrderPriorityEnum = ["low", "medium", "high", "urgent"] as const;
export type WorkOrderPriority = (typeof workOrderPriorityEnum)[number];

// Work Orders table - kept in main schema for reference but will be in per-project databases
export const workOrders = pgTable("work_orders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  priority: varchar("priority", { length: 20 }).notNull().default("medium"),
  projectId: integer("project_id"),
  assignedTo: varchar("assigned_to"),
  createdBy: varchar("created_by"),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  attachments: text("attachments").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

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

export const insertSystemSettingSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
});

export const insertWorkOrderSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
  status: z.enum(workOrderStatusEnum).optional(),
  priority: z.enum(workOrderPriorityEnum).optional(),
  projectId: z.number().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
  createdBy: z.string().optional().nullable(),
  dueDate: z.date().optional().nullable(),
  notes: z.string().optional().nullable(),
  attachments: z.array(z.string()).optional().nullable(),
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

export type SystemSetting = typeof systemSettings.$inferSelect;
export type InsertSystemSetting = z.infer<typeof insertSystemSettingSchema>;

export type WorkOrder = typeof workOrders.$inferSelect;
export type InsertWorkOrder = z.infer<typeof insertWorkOrderSchema>;

export type Subrole = typeof subroles.$inferSelect;
export type InsertSubrole = z.infer<typeof insertSubroleSchema>;

export type Permission = typeof permissions.$inferSelect;
export type InsertPermission = z.infer<typeof insertPermissionSchema>;

export type SubrolePermission = typeof subrolePermissions.$inferSelect;
export type InsertSubrolePermission = z.infer<typeof insertSubrolePermissionSchema>;

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
