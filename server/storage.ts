import {
  users,
  projects,
  userProjects,
  systemSettings,
  subroles,
  permissions,
  subrolePermissions,
  externalDatabaseConfigs,
  importConfigs,
  importHistory,
  fileImportConfigs,
  fileImportHistory,
  workOrderStatuses,
  troubleCodes,
  defaultWorkOrderStatuses,
  permissionKeys,
  userGroups,
  userGroupMembers,
  type User,
  type UpsertUser,
  type Project,
  type InsertProject,
  type UserProject,
  type InsertUserProject,
  type SystemSetting,
  type InsertSystemSetting,
  type Subrole,
  type Permission,
  type PermissionKey,
  type ExternalDatabaseConfig,
  type InsertExternalDatabaseConfig,
  type UpdateExternalDatabaseConfig,
  type ImportConfig,
  type InsertImportConfig,
  type UpdateImportConfig,
  type ImportHistory,
  type FileImportConfig,
  type InsertFileImportConfig,
  type UpdateFileImportConfig,
  type FileImportHistory,
  type WorkOrderStatus,
  type InsertWorkOrderStatus,
  type UpdateWorkOrderStatus,
  type TroubleCode,
  type InsertTroubleCode,
  type UpdateTroubleCode,
  type UserGroup,
  type InsertUserGroup,
  type UserGroupMember,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createLocalUser(username: string, passwordHash: string, role: string, firstName?: string, lastName?: string, email?: string | null, subroleId?: number | null): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUser(id: string, data: Partial<{username: string; firstName: string | null; lastName: string | null; email: string | null; role: string; isLocked: boolean; lockedReason: string | null; subroleId: number | null}>): Promise<User | undefined>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  updateUserPassword(id: string, passwordHash: string): Promise<User | undefined>;
  lockUser(id: string, reason?: string): Promise<User | undefined>;
  unlockUser(id: string): Promise<User | undefined>;
  updateLastLogin(id: string): Promise<User | undefined>;
  deleteUser(id: string): Promise<boolean>;
  countActiveAdmins(): Promise<number>;

  // Project operations
  getProjects(): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: number, project: Partial<InsertProject>): Promise<Project | undefined>;
  updateProjectDatabaseName(id: number, databaseName: string): Promise<Project | undefined>;
  deleteProject(id: number): Promise<boolean>;

  // User-Project assignment operations
  getUserProjects(userId: string): Promise<Project[]>;
  getProjectUsers(projectId: number): Promise<User[]>;
  assignUserToProject(userId: string, projectId: number): Promise<UserProject>;
  removeUserFromProject(userId: string, projectId: number): Promise<boolean>;
  isUserAssignedToProject(userId: string, projectId: number): Promise<boolean>;

  // System settings operations
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string, description?: string): Promise<SystemSetting>;
  getAllSettings(): Promise<SystemSetting[]>;

  // Subrole and permission operations
  getAllSubroles(): Promise<Subrole[]>;
  getSubrole(id: number): Promise<Subrole | undefined>;
  getSubroleByKey(key: string): Promise<Subrole | undefined>;
  createSubrole(data: { key: string; label: string; baseRole: string; description?: string | null }): Promise<Subrole>;
  updateSubrole(id: number, data: { key?: string; label?: string; baseRole?: string; description?: string | null }): Promise<Subrole | undefined>;
  deleteSubrole(id: number): Promise<boolean>;
  getAllPermissions(): Promise<Permission[]>;
  getSubrolePermissions(subroleId: number): Promise<string[]>;
  setSubrolePermissions(subroleId: number, permissionKeys: string[]): Promise<void>;
  getUserEffectivePermissions(user: User): Promise<string[]>;
  updateUserSubrole(userId: string, subroleId: number | null): Promise<User | undefined>;
  hasPermission(user: User, permissionKey: string): Promise<boolean>;

  // External database config operations
  getExternalDatabaseConfigs(projectId: number): Promise<ExternalDatabaseConfig[]>;
  getExternalDatabaseConfig(id: number): Promise<ExternalDatabaseConfig | undefined>;
  createExternalDatabaseConfig(config: InsertExternalDatabaseConfig): Promise<ExternalDatabaseConfig>;
  updateExternalDatabaseConfig(id: number, data: UpdateExternalDatabaseConfig): Promise<ExternalDatabaseConfig | undefined>;
  updateExternalDatabaseConfigTestResult(id: number, success: boolean): Promise<ExternalDatabaseConfig | undefined>;
  deleteExternalDatabaseConfig(id: number): Promise<boolean>;

  // Import config operations
  getImportConfigs(externalDbConfigId: number): Promise<ImportConfig[]>;
  getImportConfigsByProject(projectId: number): Promise<ImportConfig[]>;
  getAllEnabledImportConfigs(): Promise<(ImportConfig & { externalDbConfig: ExternalDatabaseConfig })[]>;
  getImportConfig(id: number): Promise<ImportConfig | undefined>;
  createImportConfig(config: InsertImportConfig): Promise<ImportConfig>;
  updateImportConfig(id: number, data: UpdateImportConfig): Promise<ImportConfig | undefined>;
  updateImportConfigLastRun(id: number, status: string, message: string | null, recordCount: number | null, nextRunAt: Date | null): Promise<ImportConfig | undefined>;
  deleteImportConfig(id: number): Promise<boolean>;

  // Import history operations
  getImportHistory(importConfigId: number, limit?: number): Promise<ImportHistory[]>;
  createImportHistoryEntry(importConfigId: number, status: string): Promise<ImportHistory>;
  updateImportHistoryEntry(id: number, status: string, recordsImported: number, recordsFailed: number, errorDetails?: string | null): Promise<ImportHistory | undefined>;

  // File import config operations
  getFileImportConfigs(projectId: number): Promise<FileImportConfig[]>;
  getAllEnabledFileImportConfigs(): Promise<FileImportConfig[]>;
  getFileImportConfig(id: number): Promise<FileImportConfig | undefined>;
  createFileImportConfig(config: InsertFileImportConfig): Promise<FileImportConfig>;
  updateFileImportConfig(id: number, data: UpdateFileImportConfig): Promise<FileImportConfig | undefined>;
  updateFileImportConfigLastRun(id: number, status: string, message: string | null, recordCount: number | null, lastProcessedFile: string | null): Promise<FileImportConfig | undefined>;
  deleteFileImportConfig(id: number): Promise<boolean>;

  // File import history operations
  getFileImportHistory(fileImportConfigId: number, limit?: number): Promise<FileImportHistory[]>;
  createFileImportHistoryEntry(fileImportConfigId: number, fileName: string, status: string): Promise<FileImportHistory>;
  updateFileImportHistoryEntry(id: number, status: string, recordsImported: number, recordsFailed: number, errorDetails?: string | null): Promise<FileImportHistory | undefined>;

  // Work order status operations
  getWorkOrderStatuses(): Promise<WorkOrderStatus[]>;
  getWorkOrderStatus(id: number): Promise<WorkOrderStatus | undefined>;
  createWorkOrderStatus(data: InsertWorkOrderStatus): Promise<WorkOrderStatus>;
  updateWorkOrderStatus(id: number, data: UpdateWorkOrderStatus): Promise<WorkOrderStatus | undefined>;
  deleteWorkOrderStatus(id: number): Promise<boolean>;
  seedDefaultWorkOrderStatuses(): Promise<void>;

  // Trouble code operations
  getTroubleCodes(): Promise<TroubleCode[]>;
  getTroubleCode(id: number): Promise<TroubleCode | undefined>;
  createTroubleCode(data: InsertTroubleCode): Promise<TroubleCode>;
  updateTroubleCode(id: number, data: UpdateTroubleCode): Promise<TroubleCode | undefined>;
  deleteTroubleCode(id: number): Promise<boolean>;

  // User group operations
  getAllUserGroups(): Promise<UserGroup[]>;
  getUserGroup(id: number): Promise<UserGroup | undefined>;
  createUserGroup(data: InsertUserGroup): Promise<UserGroup>;
  updateUserGroup(id: number, data: Partial<InsertUserGroup>): Promise<UserGroup | undefined>;
  deleteUserGroup(id: number): Promise<boolean>;
  getGroupMembers(groupId: number): Promise<User[]>;
  addUserToGroup(groupId: number, userId: string): Promise<UserGroupMember>;
  removeUserFromGroup(groupId: number, userId: string): Promise<boolean>;
  getUserGroupMemberships(userId: string): Promise<UserGroup[]>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createLocalUser(username: string, passwordHash: string, role: string, firstName?: string, lastName?: string, email?: string | null, subroleId?: number | null): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        username,
        passwordHash,
        role,
        firstName: firstName || username,
        lastName: lastName || null,
        email: email || null,
        subroleId: subroleId || null,
      })
      .returning();
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        ...userData,
        role: userData.role || "user",
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(desc(users.createdAt));
  }

  async updateUserRole(id: string, role: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updateUser(id: string, data: Partial<{username: string; firstName: string | null; lastName: string | null; email: string | null; role: string; isLocked: boolean; lockedReason: string | null; subroleId: number | null}>): Promise<User | undefined> {
    const updateData: any = { ...data, updatedAt: new Date() };
    
    if (data.isLocked === true) {
      updateData.lockedAt = new Date();
    } else if (data.isLocked === false) {
      updateData.lockedAt = null;
      updateData.lockedReason = null;
    }
    
    const [user] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async lockUser(id: string, reason?: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ 
        isLocked: true, 
        lockedAt: new Date(), 
        lockedReason: reason || null,
        updatedAt: new Date() 
      })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async unlockUser(id: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ 
        isLocked: false, 
        lockedAt: null, 
        lockedReason: null,
        updatedAt: new Date() 
      })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updateLastLogin(id: string): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async deleteUser(id: string): Promise<boolean> {
    await db.delete(users).where(eq(users.id, id));
    return true;
  }

  async countActiveAdmins(): Promise<number> {
    const adminUsers = await db
      .select()
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.isLocked, false)));
    return adminUsers.length;
  }

  // Project operations
  async getProjects(): Promise<Project[]> {
    return await db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async getProject(id: number): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async createProject(project: InsertProject): Promise<Project> {
    const [newProject] = await db.insert(projects).values({
      name: project.name,
      description: project.description,
      customerEmail: project.customerEmail,
    }).returning();
    return newProject;
  }

  async updateProject(id: number, project: Partial<InsertProject>): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set({ ...project, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return updated;
  }

  async updateProjectDatabaseName(id: number, databaseName: string): Promise<Project | undefined> {
    const [updated] = await db
      .update(projects)
      .set({ databaseName, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();
    return updated;
  }

  async deleteProject(id: number): Promise<boolean> {
    await db.delete(projects).where(eq(projects.id, id));
    return true;
  }

  // User-Project assignment operations
  async getUserProjects(userId: string): Promise<Project[]> {
    const assignments = await db
      .select()
      .from(userProjects)
      .where(eq(userProjects.userId, userId));
    
    if (assignments.length === 0) return [];
    
    const projectIds = assignments.map(a => a.projectId);
    const projectList: Project[] = [];
    
    for (const projectId of projectIds) {
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      if (project) projectList.push(project);
    }
    
    return projectList;
  }

  async getProjectUsers(projectId: number): Promise<User[]> {
    const assignments = await db
      .select()
      .from(userProjects)
      .where(eq(userProjects.projectId, projectId));
    
    if (assignments.length === 0) return [];
    
    const userIds = assignments.map(a => a.userId);
    const userList: User[] = [];
    
    for (const userId of userIds) {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (user) userList.push(user);
    }
    
    return userList;
  }

  async assignUserToProject(userId: string, projectId: number): Promise<UserProject> {
    const existing = await db
      .select()
      .from(userProjects)
      .where(and(eq(userProjects.userId, userId), eq(userProjects.projectId, projectId)));
    
    if (existing.length > 0) return existing[0];
    
    const [assignment] = await db
      .insert(userProjects)
      .values({ userId, projectId })
      .returning();
    return assignment;
  }

  async removeUserFromProject(userId: string, projectId: number): Promise<boolean> {
    await db
      .delete(userProjects)
      .where(and(eq(userProjects.userId, userId), eq(userProjects.projectId, projectId)));
    return true;
  }

  async isUserAssignedToProject(userId: string, projectId: number): Promise<boolean> {
    const [assignment] = await db
      .select()
      .from(userProjects)
      .where(and(eq(userProjects.userId, userId), eq(userProjects.projectId, projectId)));
    return !!assignment;
  }

  // System settings operations
  async getSetting(key: string): Promise<string | null> {
    const [setting] = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
    return setting?.value || null;
  }

  async setSetting(key: string, value: string, description?: string): Promise<SystemSetting> {
    const existing = await db.select().from(systemSettings).where(eq(systemSettings.key, key));
    
    if (existing.length > 0) {
      const [updated] = await db
        .update(systemSettings)
        .set({ value, description, updatedAt: new Date() })
        .where(eq(systemSettings.key, key))
        .returning();
      return updated;
    }
    
    const [setting] = await db
      .insert(systemSettings)
      .values({ key, value, description })
      .returning();
    return setting;
  }

  async getAllSettings(): Promise<SystemSetting[]> {
    return await db.select().from(systemSettings);
  }

  // Subrole and permission operations
  async getAllSubroles(): Promise<Subrole[]> {
    return await db.select().from(subroles);
  }

  async getSubrole(id: number): Promise<Subrole | undefined> {
    const [subrole] = await db.select().from(subroles).where(eq(subroles.id, id));
    return subrole;
  }

  async getSubroleByKey(key: string): Promise<Subrole | undefined> {
    const [subrole] = await db.select().from(subroles).where(eq(subroles.key, key));
    return subrole;
  }

  async createSubrole(data: { key: string; label: string; baseRole: string; description?: string | null }): Promise<Subrole> {
    const [subrole] = await db
      .insert(subroles)
      .values({
        key: data.key,
        label: data.label,
        baseRole: data.baseRole,
        description: data.description || null,
      })
      .returning();
    return subrole;
  }

  async updateSubrole(id: number, data: { key?: string; label?: string; baseRole?: string; description?: string | null }): Promise<Subrole | undefined> {
    const [subrole] = await db
      .update(subroles)
      .set(data)
      .where(eq(subroles.id, id))
      .returning();
    return subrole;
  }

  async deleteSubrole(id: number): Promise<boolean> {
    const result = await db.delete(subroles).where(eq(subroles.id, id));
    return true;
  }

  async getAllPermissions(): Promise<Permission[]> {
    return await db.select().from(permissions);
  }

  async getSubrolePermissions(subroleId: number): Promise<string[]> {
    const perms = await db
      .select()
      .from(subrolePermissions)
      .where(eq(subrolePermissions.subroleId, subroleId));
    return perms.map(p => p.permissionKey);
  }

  async setSubrolePermissions(subroleId: number, permissionKeyList: string[]): Promise<void> {
    await db.delete(subrolePermissions).where(eq(subrolePermissions.subroleId, subroleId));
    if (permissionKeyList.length > 0) {
      await db.insert(subrolePermissions).values(
        permissionKeyList.map(key => ({ subroleId, permissionKey: key }))
      );
    }
  }

  async getUserEffectivePermissions(user: User): Promise<string[]> {
    // Admins have all permissions
    if (user.role === "admin") {
      return Object.values(permissionKeys);
    }

    // Customers have read-only view permissions for work orders only
    if (user.role === "customer") {
      return [permissionKeys.WORK_ORDERS_VIEW];
    }

    // For regular users, check their subrole
    if (user.role === "user" && user.subroleId) {
      return await this.getSubrolePermissions(user.subroleId);
    }

    // Users without a subrole get basic view permissions
    return [
      permissionKeys.PROJECTS_VIEW,
      permissionKeys.WORK_ORDERS_VIEW,
      permissionKeys.SEARCH_REPORTS,
    ];
  }

  async updateUserSubrole(userId: string, subroleId: number | null): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ subroleId, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async hasPermission(user: User, permissionKey: string): Promise<boolean> {
    const permissions = await this.getUserEffectivePermissions(user);
    return permissions.includes(permissionKey);
  }

  // External database config operations
  async getExternalDatabaseConfigs(projectId: number): Promise<ExternalDatabaseConfig[]> {
    return await db
      .select()
      .from(externalDatabaseConfigs)
      .where(eq(externalDatabaseConfigs.projectId, projectId))
      .orderBy(desc(externalDatabaseConfigs.createdAt));
  }

  async getExternalDatabaseConfig(id: number): Promise<ExternalDatabaseConfig | undefined> {
    const [config] = await db
      .select()
      .from(externalDatabaseConfigs)
      .where(eq(externalDatabaseConfigs.id, id));
    return config;
  }

  async createExternalDatabaseConfig(config: InsertExternalDatabaseConfig): Promise<ExternalDatabaseConfig> {
    const [created] = await db
      .insert(externalDatabaseConfigs)
      .values(config)
      .returning();
    return created;
  }

  async updateExternalDatabaseConfig(id: number, data: UpdateExternalDatabaseConfig): Promise<ExternalDatabaseConfig | undefined> {
    const [updated] = await db
      .update(externalDatabaseConfigs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(externalDatabaseConfigs.id, id))
      .returning();
    return updated;
  }

  async updateExternalDatabaseConfigTestResult(id: number, success: boolean): Promise<ExternalDatabaseConfig | undefined> {
    const [updated] = await db
      .update(externalDatabaseConfigs)
      .set({ lastTestedAt: new Date(), lastTestResult: success, updatedAt: new Date() })
      .where(eq(externalDatabaseConfigs.id, id))
      .returning();
    return updated;
  }

  async deleteExternalDatabaseConfig(id: number): Promise<boolean> {
    await db.delete(externalDatabaseConfigs).where(eq(externalDatabaseConfigs.id, id));
    return true;
  }

  // Import config operations
  async getImportConfigs(externalDbConfigId: number): Promise<ImportConfig[]> {
    return await db
      .select()
      .from(importConfigs)
      .where(eq(importConfigs.externalDbConfigId, externalDbConfigId))
      .orderBy(desc(importConfigs.createdAt));
  }

  async getImportConfigsByProject(projectId: number): Promise<ImportConfig[]> {
    const dbConfigs = await this.getExternalDatabaseConfigs(projectId);
    if (dbConfigs.length === 0) return [];
    
    const configIds = dbConfigs.map(c => c.id);
    const allConfigs: ImportConfig[] = [];
    
    for (const configId of configIds) {
      const configs = await db
        .select()
        .from(importConfigs)
        .where(eq(importConfigs.externalDbConfigId, configId));
      allConfigs.push(...configs);
    }
    
    return allConfigs;
  }

  async getAllEnabledImportConfigs(): Promise<(ImportConfig & { externalDbConfig: ExternalDatabaseConfig })[]> {
    const configs = await db
      .select()
      .from(importConfigs)
      .where(eq(importConfigs.isEnabled, true));
    
    const result: (ImportConfig & { externalDbConfig: ExternalDatabaseConfig })[] = [];
    
    for (const config of configs) {
      const [dbConfig] = await db
        .select()
        .from(externalDatabaseConfigs)
        .where(eq(externalDatabaseConfigs.id, config.externalDbConfigId));
      
      if (dbConfig && dbConfig.isActive) {
        result.push({ ...config, externalDbConfig: dbConfig });
      }
    }
    
    return result;
  }

  async getImportConfig(id: number): Promise<ImportConfig | undefined> {
    const [config] = await db
      .select()
      .from(importConfigs)
      .where(eq(importConfigs.id, id));
    return config;
  }

  async createImportConfig(config: InsertImportConfig): Promise<ImportConfig> {
    const [created] = await db
      .insert(importConfigs)
      .values(config)
      .returning();
    return created;
  }

  async updateImportConfig(id: number, data: UpdateImportConfig): Promise<ImportConfig | undefined> {
    const [updated] = await db
      .update(importConfigs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(importConfigs.id, id))
      .returning();
    return updated;
  }

  async updateImportConfigLastRun(
    id: number,
    status: string,
    message: string | null,
    recordCount: number | null,
    nextRunAt: Date | null
  ): Promise<ImportConfig | undefined> {
    const [updated] = await db
      .update(importConfigs)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: status,
        lastRunMessage: message,
        lastRunRecordCount: recordCount,
        nextRunAt,
        updatedAt: new Date(),
      })
      .where(eq(importConfigs.id, id))
      .returning();
    return updated;
  }

  async deleteImportConfig(id: number): Promise<boolean> {
    await db.delete(importConfigs).where(eq(importConfigs.id, id));
    return true;
  }

  // Import history operations
  async getImportHistory(importConfigId: number, limit: number = 50): Promise<ImportHistory[]> {
    return await db
      .select()
      .from(importHistory)
      .where(eq(importHistory.importConfigId, importConfigId))
      .orderBy(desc(importHistory.startedAt))
      .limit(limit);
  }

  async createImportHistoryEntry(importConfigId: number, status: string): Promise<ImportHistory> {
    const [entry] = await db
      .insert(importHistory)
      .values({ importConfigId, status })
      .returning();
    return entry;
  }

  async updateImportHistoryEntry(
    id: number,
    status: string,
    recordsImported: number,
    recordsFailed: number,
    errorDetails?: string | null
  ): Promise<ImportHistory | undefined> {
    const [updated] = await db
      .update(importHistory)
      .set({
        status,
        recordsImported,
        recordsFailed,
        errorDetails,
        completedAt: new Date(),
      })
      .where(eq(importHistory.id, id))
      .returning();
    return updated;
  }

  // File import config operations
  async getFileImportConfigs(projectId: number): Promise<FileImportConfig[]> {
    return await db
      .select()
      .from(fileImportConfigs)
      .where(eq(fileImportConfigs.projectId, projectId))
      .orderBy(desc(fileImportConfigs.createdAt));
  }

  async getAllEnabledFileImportConfigs(): Promise<FileImportConfig[]> {
    return await db
      .select()
      .from(fileImportConfigs)
      .where(eq(fileImportConfigs.isEnabled, true));
  }

  async getFileImportConfig(id: number): Promise<FileImportConfig | undefined> {
    const [config] = await db
      .select()
      .from(fileImportConfigs)
      .where(eq(fileImportConfigs.id, id));
    return config;
  }

  async createFileImportConfig(config: InsertFileImportConfig): Promise<FileImportConfig> {
    const [created] = await db
      .insert(fileImportConfigs)
      .values(config)
      .returning();
    return created;
  }

  async updateFileImportConfig(id: number, data: UpdateFileImportConfig): Promise<FileImportConfig | undefined> {
    const [updated] = await db
      .update(fileImportConfigs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(fileImportConfigs.id, id))
      .returning();
    return updated;
  }

  async updateFileImportConfigLastRun(
    id: number,
    status: string,
    message: string | null,
    recordCount: number | null,
    lastProcessedFile: string | null
  ): Promise<FileImportConfig | undefined> {
    const [updated] = await db
      .update(fileImportConfigs)
      .set({
        lastRunAt: new Date(),
        lastRunStatus: status,
        lastRunMessage: message,
        lastRunRecordCount: recordCount,
        lastProcessedFile,
        updatedAt: new Date(),
      })
      .where(eq(fileImportConfigs.id, id))
      .returning();
    return updated;
  }

  async deleteFileImportConfig(id: number): Promise<boolean> {
    await db.delete(fileImportConfigs).where(eq(fileImportConfigs.id, id));
    return true;
  }

  // File import history operations
  async getFileImportHistory(fileImportConfigId: number, limit: number = 50): Promise<FileImportHistory[]> {
    return await db
      .select()
      .from(fileImportHistory)
      .where(eq(fileImportHistory.fileImportConfigId, fileImportConfigId))
      .orderBy(desc(fileImportHistory.startedAt))
      .limit(limit);
  }

  async createFileImportHistoryEntry(fileImportConfigId: number, fileName: string, status: string): Promise<FileImportHistory> {
    const [entry] = await db
      .insert(fileImportHistory)
      .values({ fileImportConfigId, fileName, status })
      .returning();
    return entry;
  }

  async updateFileImportHistoryEntry(
    id: number,
    status: string,
    recordsImported: number,
    recordsFailed: number,
    errorDetails?: string | null
  ): Promise<FileImportHistory | undefined> {
    const [updated] = await db
      .update(fileImportHistory)
      .set({
        status,
        recordsImported,
        recordsFailed,
        errorDetails,
        completedAt: new Date(),
      })
      .where(eq(fileImportHistory.id, id))
      .returning();
    return updated;
  }

  // Work order status operations
  async getWorkOrderStatuses(): Promise<WorkOrderStatus[]> {
    return await db
      .select()
      .from(workOrderStatuses)
      .orderBy(workOrderStatuses.sortOrder);
  }

  async getWorkOrderStatus(id: number): Promise<WorkOrderStatus | undefined> {
    const [status] = await db
      .select()
      .from(workOrderStatuses)
      .where(eq(workOrderStatuses.id, id));
    return status;
  }

  async createWorkOrderStatus(data: InsertWorkOrderStatus): Promise<WorkOrderStatus> {
    const [status] = await db
      .insert(workOrderStatuses)
      .values(data)
      .returning();
    return status;
  }

  async updateWorkOrderStatus(id: number, data: UpdateWorkOrderStatus): Promise<WorkOrderStatus | undefined> {
    const [updated] = await db
      .update(workOrderStatuses)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(workOrderStatuses.id, id))
      .returning();
    return updated;
  }

  async deleteWorkOrderStatus(id: number): Promise<boolean> {
    await db.delete(workOrderStatuses).where(eq(workOrderStatuses.id, id));
    return true;
  }

  async seedDefaultWorkOrderStatuses(): Promise<void> {
    const existing = await this.getWorkOrderStatuses();
    if (existing.length === 0) {
      const statusColors: Record<string, string> = {
        Open: "blue",
        Completed: "green",
        Scheduled: "orange",
        Skipped: "gray",
      };
      for (let i = 0; i < defaultWorkOrderStatuses.length; i++) {
        const code = defaultWorkOrderStatuses[i];
        await db.insert(workOrderStatuses).values({
          code,
          label: code,
          color: statusColors[code] || "gray",
          isDefault: code === "Open",
          sortOrder: i,
        });
      }
      console.log("[Storage] Seeded default work order statuses");
    }
  }

  // Trouble code operations
  async getTroubleCodes(): Promise<TroubleCode[]> {
    return await db
      .select()
      .from(troubleCodes)
      .orderBy(troubleCodes.sortOrder);
  }

  async getTroubleCode(id: number): Promise<TroubleCode | undefined> {
    const [code] = await db
      .select()
      .from(troubleCodes)
      .where(eq(troubleCodes.id, id));
    return code;
  }

  async createTroubleCode(data: InsertTroubleCode): Promise<TroubleCode> {
    const [code] = await db
      .insert(troubleCodes)
      .values(data)
      .returning();
    return code;
  }

  async updateTroubleCode(id: number, data: UpdateTroubleCode): Promise<TroubleCode | undefined> {
    const [code] = await db
      .update(troubleCodes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(troubleCodes.id, id))
      .returning();
    return code;
  }

  async deleteTroubleCode(id: number): Promise<boolean> {
    const result = await db.delete(troubleCodes).where(eq(troubleCodes.id, id));
    return result.rowCount > 0;
  }

  // User group operations
  async getAllUserGroups(): Promise<UserGroup[]> {
    return await db.select().from(userGroups).orderBy(userGroups.name);
  }

  async getUserGroup(id: number): Promise<UserGroup | undefined> {
    const [group] = await db.select().from(userGroups).where(eq(userGroups.id, id));
    return group;
  }

  async createUserGroup(data: InsertUserGroup): Promise<UserGroup> {
    const [group] = await db.insert(userGroups).values(data).returning();
    return group;
  }

  async updateUserGroup(id: number, data: Partial<InsertUserGroup>): Promise<UserGroup | undefined> {
    const [updated] = await db
      .update(userGroups)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(userGroups.id, id))
      .returning();
    return updated;
  }

  async deleteUserGroup(id: number): Promise<boolean> {
    await db.delete(userGroups).where(eq(userGroups.id, id));
    return true;
  }

  async getGroupMembers(groupId: number): Promise<User[]> {
    const members = await db
      .select({ user: users })
      .from(userGroupMembers)
      .innerJoin(users, eq(userGroupMembers.userId, users.id))
      .where(eq(userGroupMembers.groupId, groupId));
    return members.map((m) => m.user);
  }

  async addUserToGroup(groupId: number, userId: string): Promise<UserGroupMember> {
    const [member] = await db
      .insert(userGroupMembers)
      .values({ groupId, userId })
      .returning();
    return member;
  }

  async removeUserFromGroup(groupId: number, userId: string): Promise<boolean> {
    await db
      .delete(userGroupMembers)
      .where(and(eq(userGroupMembers.groupId, groupId), eq(userGroupMembers.userId, userId)));
    return true;
  }

  async getUserGroupMemberships(userId: string): Promise<UserGroup[]> {
    const memberships = await db
      .select({ group: userGroups })
      .from(userGroupMembers)
      .innerJoin(userGroups, eq(userGroupMembers.groupId, userGroups.id))
      .where(eq(userGroupMembers.userId, userId));
    return memberships.map((m) => m.group);
  }
}

export const storage = new DatabaseStorage();
