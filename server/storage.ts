import {
  users,
  projects,
  projectHolidays,
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
  serviceTypes,
  systemTypes,
  systemTypeProjects,
  defaultWorkOrderStatuses,
  permissionKeys,
  ADMINISTRATOR_SUBROLE_KEY,
  userGroups,
  userGroupMembers,
  userGroupProjects,
  userColumnPreferences,
  userFilterPreferences,
  customerApiLogs,
  type User,
  type UpsertUser,
  type Project,
  type InsertProject,
  type ProjectHoliday,
  type InsertProjectHoliday,
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
  type ServiceTypeRecord,
  type InsertServiceType,
  type UpdateServiceType,
  type SystemType,
  type InsertSystemType,
  type UpdateSystemType,
  type SystemTypeWithProjects,
  type UserGroup,
  type InsertUserGroup,
  type UserGroupMember,
  type UserGroupWithProjects,
  type UserColumnPreferences,
  type UserFilterPreferences,
  type CustomerApiLog,
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

  // Project holiday operations
  getProjectHolidays(projectId: number): Promise<ProjectHoliday[]>;
  createProjectHoliday(data: InsertProjectHoliday): Promise<ProjectHoliday>;
  deleteProjectHoliday(id: number): Promise<boolean>;

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
  isAdminUser(user: User): Promise<boolean>;
  getAdministratorSubrole(): Promise<Subrole | undefined>;
  ensureAdministratorSubrole(): Promise<Subrole>;
  getRoleForSubrole(subroleId: number | null, fallbackRole?: string): Promise<string>;
  syncPermissionsFromRegistry(): Promise<void>;
  ensureDefaultSubroles(): Promise<void>;

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
  getAllImportHistory(limit?: number): Promise<ImportHistory[]>;
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
  getAllFileImportHistory(limit?: number): Promise<FileImportHistory[]>;
  createFileImportHistoryEntry(fileImportConfigId: number | null, fileName: string, status: string, projectId?: number, importSource?: string, userName?: string): Promise<FileImportHistory>;
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

  // Service type operations
  getServiceTypes(): Promise<ServiceTypeRecord[]>;
  getServiceType(id: number): Promise<ServiceTypeRecord | undefined>;
  createServiceType(data: InsertServiceType): Promise<ServiceTypeRecord>;
  updateServiceType(id: number, data: UpdateServiceType): Promise<ServiceTypeRecord | undefined>;
  deleteServiceType(id: number): Promise<boolean>;

  // User group operations
  getAllUserGroups(): Promise<UserGroup[]>;
  getAllUserGroupsWithProjects(): Promise<UserGroupWithProjects[]>;
  getUserGroup(id: number): Promise<UserGroup | undefined>;
  getUserGroupWithProjects(id: number): Promise<UserGroupWithProjects | undefined>;
  createUserGroup(data: InsertUserGroup, projectIds: number[]): Promise<UserGroupWithProjects>;
  updateUserGroup(id: number, data: Partial<InsertUserGroup>, projectIds?: number[]): Promise<UserGroupWithProjects | undefined>;
  deleteUserGroup(id: number): Promise<boolean>;
  getGroupMembers(groupId: number): Promise<User[]>;
  addUserToGroup(groupId: number, userId: string): Promise<UserGroupMember>;
  removeUserFromGroup(groupId: number, userId: string): Promise<boolean>;
  getUserGroupMemberships(userId: string): Promise<UserGroup[]>;
  getGroupProjectIds(groupId: number): Promise<number[]>;
  setGroupProjects(groupId: number, projectIds: number[]): Promise<void>;

  // System type operations
  getSystemTypes(projectId?: number): Promise<SystemTypeWithProjects[]>;
  getSystemType(id: number): Promise<SystemTypeWithProjects | undefined>;
  createSystemType(data: InsertSystemType): Promise<SystemTypeWithProjects>;
  updateSystemType(id: number, data: UpdateSystemType): Promise<SystemTypeWithProjects | undefined>;
  deleteSystemType(id: number): Promise<boolean>;
  getSystemTypeProjectIds(systemTypeId: number): Promise<number[]>;
  setSystemTypeProjects(systemTypeId: number, projectIds: number[]): Promise<void>;

  // User column preferences operations
  getUserColumnPreferences(userId: string, pageKey: string): Promise<UserColumnPreferences | undefined>;
  setUserColumnPreferences(userId: string, pageKey: string, visibleColumns: string[], stickyColumns?: string[]): Promise<UserColumnPreferences>;

  // User filter preferences operations
  getUserFilterPreferences(userId: string, pageKey: string): Promise<UserFilterPreferences | undefined>;
  setUserFilterPreferences(userId: string, pageKey: string, visibleFilters: string[], knownFilters?: string[]): Promise<UserFilterPreferences>;

  // Customer API logs operations
  getCustomerApiLogs(options?: { projectId?: number; success?: boolean; limit?: number }): Promise<CustomerApiLog[]>;
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
    // Auto-sync role based on subrole if provided, otherwise use the passed role
    const effectiveRole = await this.getRoleForSubrole(subroleId || null, role);
    const [user] = await db
      .insert(users)
      .values({
        username,
        passwordHash,
        role: effectiveRole,
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
    
    // Auto-sync role based on subrole if subroleId is being updated
    // Preserve the original role if no subrole is specified
    if (data.subroleId !== undefined) {
      updateData.role = await this.getRoleForSubrole(data.subroleId, data.role);
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
    // Get the administrator subrole
    const adminSubrole = await this.getAdministratorSubrole();
    if (!adminSubrole) {
      // Fallback: count legacy admin role users
      const adminUsers = await db
        .select()
        .from(users)
        .where(and(eq(users.role, "admin"), eq(users.isLocked, false)));
      return adminUsers.length;
    }
    // Count users with the administrator subrole who are not locked
    const adminUsers = await db
      .select()
      .from(users)
      .where(and(eq(users.subroleId, adminSubrole.id), eq(users.isLocked, false)));
    // Also count legacy admin role users without subrole (for backward compatibility during migration)
    const legacyAdmins = await db
      .select()
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.isLocked, false)));
    const legacyCount = legacyAdmins.filter(u => u.subroleId !== adminSubrole.id).length;
    return adminUsers.length + legacyCount;
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

  // Project holiday operations
  async getProjectHolidays(projectId: number): Promise<ProjectHoliday[]> {
    return await db.select().from(projectHolidays).where(eq(projectHolidays.projectId, projectId)).orderBy(projectHolidays.date);
  }

  async createProjectHoliday(data: InsertProjectHoliday): Promise<ProjectHoliday> {
    const [holiday] = await db.insert(projectHolidays).values(data).returning();
    return holiday;
  }

  async deleteProjectHoliday(id: number): Promise<boolean> {
    const result = await db.delete(projectHolidays).where(eq(projectHolidays.id, id));
    return (result.rowCount ?? 0) > 0;
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
    // Customers have read-only view permissions for work orders only
    if (user.role === "customer") {
      return [permissionKeys.WORK_ORDERS_VIEW, "project.workOrders", "project.documents", "project.ftpFiles"];
    }

    // Helper to get all permission keys (old + new from registry)
    const getAllPermissionKeys = async (): Promise<string[]> => {
      const { getAllPermissionKeys: getRegistryKeys } = await import("@shared/permissionRegistry");
      const oldKeys = Object.values(permissionKeys);
      const newKeys = getRegistryKeys();
      // Combine and deduplicate without using Set spread
      const combined = oldKeys.concat(newKeys);
      const unique: string[] = [];
      for (const key of combined) {
        if (!unique.includes(key)) {
          unique.push(key);
        }
      }
      return unique;
    };

    // Check if user has a subrole - permissions come from subrole
    if (user.subroleId) {
      const subrolePerms = await this.getSubrolePermissions(user.subroleId);
      // If this is the administrator subrole, ensure they have all permissions
      const subrole = await this.getSubrole(user.subroleId);
      if (subrole?.key === ADMINISTRATOR_SUBROLE_KEY) {
        return await getAllPermissionKeys();
      }
      return subrolePerms;
    }

    // Legacy support: users with admin role but no subrole still get all permissions
    // This handles existing admins before migration
    if (user.role === "admin") {
      return await getAllPermissionKeys();
    }

    // Users without a subrole get basic view permissions
    return [
      permissionKeys.PROJECTS_VIEW,
      permissionKeys.WORK_ORDERS_VIEW,
      permissionKeys.SEARCH_REPORTS,
      "nav.dashboard",
      "project.workOrders",
      "project.documents",
    ];
  }

  async updateUserSubrole(userId: string, subroleId: number | null): Promise<User | undefined> {
    // Get the existing user to use their role as fallback
    const existingUser = await this.getUser(userId);
    const fallbackRole = existingUser?.role || "user";
    // Auto-sync the main role based on subrole
    const role = await this.getRoleForSubrole(subroleId, fallbackRole);
    const [user] = await db
      .update(users)
      .set({ subroleId, role, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async hasPermission(user: User, permissionKey: string): Promise<boolean> {
    const permissions = await this.getUserEffectivePermissions(user);
    return permissions.includes(permissionKey);
  }

  async isAdminUser(user: User): Promise<boolean> {
    if (!user.subroleId) return false;
    const subrole = await this.getSubrole(user.subroleId);
    return subrole?.key === ADMINISTRATOR_SUBROLE_KEY;
  }

  async getAdministratorSubrole(): Promise<Subrole | undefined> {
    return await this.getSubroleByKey(ADMINISTRATOR_SUBROLE_KEY);
  }

  async ensureAdministratorSubrole(): Promise<Subrole> {
    let adminSubrole = await this.getAdministratorSubrole();
    if (!adminSubrole) {
      adminSubrole = await this.createSubrole({
        key: ADMINISTRATOR_SUBROLE_KEY,
        label: "Administrator",
        baseRole: "admin",
        description: "Full system access with all permissions",
      });
      // Grant all permissions to the administrator subrole
      const allPermissions = Object.values(permissionKeys);
      await this.setSubrolePermissions(adminSubrole.id, allPermissions);
    }
    // Migrate existing admin users to have the administrator subrole
    await this.migrateAdminUsersToSubrole(adminSubrole.id);
    return adminSubrole;
  }

  private async migrateAdminUsersToSubrole(adminSubroleId: number): Promise<void> {
    // Find admin users who don't have a subrole assigned
    const adminUsers = await db
      .select()
      .from(users)
      .where(and(eq(users.role, "admin"), eq(users.subroleId, null as unknown as number)));
    
    // Assign the administrator subrole to each
    for (const user of adminUsers) {
      await db
        .update(users)
        .set({ subroleId: adminSubroleId })
        .where(eq(users.id, user.id));
      console.log(`Migrated admin user ${user.username || user.id} to administrator subrole`);
    }
  }

  async getRoleForSubrole(subroleId: number | null, fallbackRole?: string): Promise<string> {
    if (!subroleId) return fallbackRole || "user";
    const subrole = await this.getSubrole(subroleId);
    if (!subrole) return fallbackRole || "user";
    // If the subrole is administrator, the main role should be admin
    // Otherwise, derive from the subrole's baseRole
    if (subrole.key === ADMINISTRATOR_SUBROLE_KEY) {
      return "admin";
    }
    return subrole.baseRole || "user";
  }

  async syncPermissionsFromRegistry(): Promise<void> {
    // Dynamic import to avoid circular dependencies
    const { permissionRegistry } = await import("@shared/permissionRegistry");
    
    for (const perm of permissionRegistry) {
      // Check if permission exists
      const existing = await db
        .select()
        .from(permissions)
        .where(eq(permissions.key, perm.key));
      
      if (existing.length === 0) {
        // Insert new permission
        await db.insert(permissions).values({
          key: perm.key,
          label: perm.label,
          category: perm.category,
          description: perm.description,
        });
        console.log(`Created permission: ${perm.key}`);
      } else {
        // Update existing permission label/category/description
        await db
          .update(permissions)
          .set({
            label: perm.label,
            category: perm.category,
            description: perm.description,
          })
          .where(eq(permissions.key, perm.key));
      }
    }
  }

  async ensureDefaultSubroles(): Promise<void> {
    const { permissionRegistry, getAllPermissionKeys } = await import("@shared/permissionRegistry");
    
    const defaultSubroles = [
      { key: "administrator", label: "Administrator", baseRole: "admin", description: "Full system access with all permissions" },
      { key: "project_manager", label: "Project Manager", baseRole: "user", description: "Manage projects and work orders" },
      { key: "field_technician", label: "Field Technician", baseRole: "user", description: "Create and edit work orders in the field" },
      { key: "viewer", label: "Viewer", baseRole: "user", description: "Read-only access to projects and work orders" },
    ];

    for (const subroleData of defaultSubroles) {
      let subrole = await this.getSubroleByKey(subroleData.key);
      
      if (!subrole) {
        subrole = await this.createSubrole(subroleData);
        console.log(`Created subrole: ${subroleData.label}`);
        
        // Assign default permissions based on registry
        const defaultPerms: string[] = [];
        const accessKey = subroleData.key === "administrator" ? "administrator" :
                          subroleData.key === "project_manager" ? "projectManager" :
                          subroleData.key === "field_technician" ? "fieldTechnician" :
                          "viewer";
        
        for (const perm of permissionRegistry) {
          if (perm.defaultAccess[accessKey as keyof typeof perm.defaultAccess]) {
            defaultPerms.push(perm.key);
          }
        }
        
        // Administrator gets all permissions
        if (subroleData.key === "administrator") {
          await this.setSubrolePermissions(subrole.id, getAllPermissionKeys());
        } else {
          await this.setSubrolePermissions(subrole.id, defaultPerms);
        }
        console.log(`Assigned ${subroleData.key === "administrator" ? "all" : defaultPerms.length} permissions to ${subroleData.label}`);
      }
    }
    
    // Ensure admin users are migrated
    const adminSubrole = await this.getAdministratorSubrole();
    if (adminSubrole) {
      await this.migrateAdminUsersToSubrole(adminSubrole.id);
    }
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

  async getAllImportHistory(limit: number = 500): Promise<ImportHistory[]> {
    return await db
      .select()
      .from(importHistory)
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

  async getAllFileImportHistory(limit: number = 500): Promise<FileImportHistory[]> {
    return await db
      .select()
      .from(fileImportHistory)
      .orderBy(desc(fileImportHistory.startedAt))
      .limit(limit);
  }

  async createFileImportHistoryEntry(
    fileImportConfigId: number | null, 
    fileName: string, 
    status: string,
    projectId?: number,
    importSource: string = "scheduled",
    userName?: string
  ): Promise<FileImportHistory> {
    const [entry] = await db
      .insert(fileImportHistory)
      .values({ 
        fileImportConfigId, 
        fileName, 
        status,
        projectId: projectId ?? null,
        importSource,
        userName: userName ?? null,
      })
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
        Trouble: "red",
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

  // Service type operations
  async getServiceTypes(): Promise<ServiceTypeRecord[]> {
    return await db
      .select()
      .from(serviceTypes)
      .orderBy(serviceTypes.sortOrder);
  }

  async getServiceType(id: number): Promise<ServiceTypeRecord | undefined> {
    const [serviceType] = await db
      .select()
      .from(serviceTypes)
      .where(eq(serviceTypes.id, id));
    return serviceType;
  }

  async createServiceType(data: InsertServiceType): Promise<ServiceTypeRecord> {
    const [serviceType] = await db
      .insert(serviceTypes)
      .values(data)
      .returning();
    return serviceType;
  }

  async updateServiceType(id: number, data: UpdateServiceType): Promise<ServiceTypeRecord | undefined> {
    const [serviceType] = await db
      .update(serviceTypes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(serviceTypes.id, id))
      .returning();
    return serviceType;
  }

  async deleteServiceType(id: number): Promise<boolean> {
    const result = await db.delete(serviceTypes).where(eq(serviceTypes.id, id));
    return result.rowCount > 0;
  }

  // User group operations
  async getAllUserGroups(): Promise<UserGroup[]> {
    return await db.select().from(userGroups).orderBy(userGroups.name);
  }

  async getAllUserGroupsWithProjects(): Promise<UserGroupWithProjects[]> {
    const groups = await db.select().from(userGroups).orderBy(userGroups.name);
    const result: UserGroupWithProjects[] = [];
    for (const group of groups) {
      const projectIds = await this.getGroupProjectIds(group.id);
      result.push({ ...group, projectIds });
    }
    return result;
  }

  async getUserGroup(id: number): Promise<UserGroup | undefined> {
    const [group] = await db.select().from(userGroups).where(eq(userGroups.id, id));
    return group;
  }

  async getUserGroupWithProjects(id: number): Promise<UserGroupWithProjects | undefined> {
    const [group] = await db.select().from(userGroups).where(eq(userGroups.id, id));
    if (!group) return undefined;
    const projectIds = await this.getGroupProjectIds(id);
    return { ...group, projectIds };
  }

  async createUserGroup(data: InsertUserGroup, projectIds: number[]): Promise<UserGroupWithProjects> {
    const [group] = await db.insert(userGroups).values(data).returning();
    if (projectIds && projectIds.length > 0) {
      await this.setGroupProjects(group.id, projectIds);
    }
    return { ...group, projectIds: projectIds || [] };
  }

  async updateUserGroup(id: number, data: Partial<InsertUserGroup>, projectIds?: number[]): Promise<UserGroupWithProjects | undefined> {
    if (Object.keys(data).length > 0) {
      await db
        .update(userGroups)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(userGroups.id, id));
    }
    if (projectIds !== undefined) {
      await this.setGroupProjects(id, projectIds);
    }
    return await this.getUserGroupWithProjects(id);
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

  async getGroupProjectIds(groupId: number): Promise<number[]> {
    const rows = await db
      .select({ projectId: userGroupProjects.projectId })
      .from(userGroupProjects)
      .where(eq(userGroupProjects.groupId, groupId));
    return rows.map(r => r.projectId);
  }

  async setGroupProjects(groupId: number, projectIds: number[]): Promise<void> {
    await db.delete(userGroupProjects).where(eq(userGroupProjects.groupId, groupId));
    if (projectIds.length > 0) {
      await db.insert(userGroupProjects).values(
        projectIds.map(projectId => ({ groupId, projectId }))
      );
    }
  }

  // System type operations
  async getSystemTypes(projectId?: number): Promise<SystemTypeWithProjects[]> {
    let allSystemTypes: SystemType[];
    
    if (projectId) {
      // Get system types that are assigned to this project
      const systemTypeIds = await db
        .select({ systemTypeId: systemTypeProjects.systemTypeId })
        .from(systemTypeProjects)
        .where(eq(systemTypeProjects.projectId, projectId));
      
      if (systemTypeIds.length === 0) {
        return [];
      }
      
      const ids = systemTypeIds.map(r => r.systemTypeId);
      allSystemTypes = await db
        .select()
        .from(systemTypes)
        .where(eq(systemTypes.id, ids[0])) // First ID filter
        .orderBy(systemTypes.productLabel);
      
      // If there are more IDs, we need to filter properly
      if (ids.length > 1) {
        allSystemTypes = await db
          .select()
          .from(systemTypes)
          .orderBy(systemTypes.productLabel);
        allSystemTypes = allSystemTypes.filter(mt => ids.includes(mt.id));
      }
    } else {
      allSystemTypes = await db
        .select()
        .from(systemTypes)
        .orderBy(systemTypes.productLabel);
    }
    
    // Get project IDs for each system type
    const result: SystemTypeWithProjects[] = [];
    for (const mt of allSystemTypes) {
      const projectIds = await this.getSystemTypeProjectIds(mt.id);
      result.push({ ...mt, projectIds });
    }
    return result;
  }

  async getSystemType(id: number): Promise<SystemTypeWithProjects | undefined> {
    const [systemType] = await db
      .select()
      .from(systemTypes)
      .where(eq(systemTypes.id, id));
    
    if (!systemType) return undefined;
    
    const projectIds = await this.getSystemTypeProjectIds(id);
    return { ...systemType, projectIds };
  }

  async createSystemType(data: InsertSystemType): Promise<SystemTypeWithProjects> {
    const { projectIds, ...systemTypeData } = data;
    const [systemType] = await db
      .insert(systemTypes)
      .values(systemTypeData)
      .returning();
    
    // Assign to projects if provided
    if (projectIds && projectIds.length > 0) {
      await this.setSystemTypeProjects(systemType.id, projectIds);
    }
    
    return { ...systemType, projectIds: projectIds || [] };
  }

  async updateSystemType(id: number, data: UpdateSystemType): Promise<SystemTypeWithProjects | undefined> {
    const { projectIds, ...systemTypeData } = data;
    
    // Only update system type fields if there are any
    if (Object.keys(systemTypeData).length > 0) {
      await db
        .update(systemTypes)
        .set({ ...systemTypeData, updatedAt: new Date() })
        .where(eq(systemTypes.id, id));
    }
    
    // Update project assignments if provided
    if (projectIds !== undefined) {
      await this.setSystemTypeProjects(id, projectIds);
    }
    
    return await this.getSystemType(id);
  }

  async deleteSystemType(id: number): Promise<boolean> {
    await db.delete(systemTypes).where(eq(systemTypes.id, id));
    return true;
  }

  async getSystemTypeProjectIds(systemTypeId: number): Promise<number[]> {
    const rows = await db
      .select({ projectId: systemTypeProjects.projectId })
      .from(systemTypeProjects)
      .where(eq(systemTypeProjects.systemTypeId, systemTypeId));
    return rows.map(r => r.projectId);
  }

  async setSystemTypeProjects(systemTypeId: number, projectIds: number[]): Promise<void> {
    // Delete existing assignments
    await db.delete(systemTypeProjects).where(eq(systemTypeProjects.systemTypeId, systemTypeId));
    
    // Add new assignments
    if (projectIds.length > 0) {
      await db.insert(systemTypeProjects).values(
        projectIds.map(projectId => ({ systemTypeId, projectId }))
      );
    }
  }

  // User column preferences operations
  async getUserColumnPreferences(userId: string, pageKey: string): Promise<UserColumnPreferences | undefined> {
    const [pref] = await db
      .select()
      .from(userColumnPreferences)
      .where(and(eq(userColumnPreferences.userId, userId), eq(userColumnPreferences.pageKey, pageKey)));
    return pref;
  }

  async setUserColumnPreferences(userId: string, pageKey: string, visibleColumns: string[], stickyColumns?: string[]): Promise<UserColumnPreferences> {
    const existing = await this.getUserColumnPreferences(userId, pageKey);
    
    if (existing) {
      const updateData: any = { visibleColumns, updatedAt: new Date() };
      if (stickyColumns !== undefined) {
        updateData.stickyColumns = stickyColumns;
      }
      const [updated] = await db
        .update(userColumnPreferences)
        .set(updateData)
        .where(and(eq(userColumnPreferences.userId, userId), eq(userColumnPreferences.pageKey, pageKey)))
        .returning();
      return updated;
    }
    
    const [created] = await db
      .insert(userColumnPreferences)
      .values({ userId, pageKey, visibleColumns, stickyColumns: stickyColumns || [] })
      .returning();
    return created;
  }

  // User filter preferences operations
  async getUserFilterPreferences(userId: string, pageKey: string): Promise<UserFilterPreferences | undefined> {
    const [pref] = await db
      .select()
      .from(userFilterPreferences)
      .where(and(eq(userFilterPreferences.userId, userId), eq(userFilterPreferences.pageKey, pageKey)));
    return pref;
  }

  async setUserFilterPreferences(userId: string, pageKey: string, visibleFilters: string[], knownFilters?: string[]): Promise<UserFilterPreferences> {
    const existing = await this.getUserFilterPreferences(userId, pageKey);
    
    if (existing) {
      const [updated] = await db
        .update(userFilterPreferences)
        .set({ visibleFilters, knownFilters: knownFilters || null, updatedAt: new Date() })
        .where(and(eq(userFilterPreferences.userId, userId), eq(userFilterPreferences.pageKey, pageKey)))
        .returning();
      return updated;
    }
    
    const [created] = await db
      .insert(userFilterPreferences)
      .values({ userId, pageKey, visibleFilters, knownFilters: knownFilters || null })
      .returning();
    return created;
  }

  // Customer API logs operations
  async getCustomerApiLogs(options?: { projectId?: number; success?: boolean; limit?: number }): Promise<CustomerApiLog[]> {
    const limit = options?.limit || 100;
    
    let query = db.select().from(customerApiLogs).orderBy(desc(customerApiLogs.createdAt)).limit(limit);
    
    const conditions = [];
    if (options?.projectId !== undefined) {
      conditions.push(eq(customerApiLogs.projectId, options.projectId));
    }
    if (options?.success !== undefined) {
      conditions.push(eq(customerApiLogs.success, options.success));
    }
    
    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }
    
    return await query;
  }
}

export const storage = new DatabaseStorage();
