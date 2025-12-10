import {
  users,
  projects,
  userProjects,
  systemSettings,
  subroles,
  permissions,
  subrolePermissions,
  permissionKeys,
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
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and } from "drizzle-orm";

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createLocalUser(username: string, passwordHash: string, role: string, firstName?: string, lastName?: string, email?: string | null): Promise<User>;
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
  getAllPermissions(): Promise<Permission[]>;
  getSubrolePermissions(subroleId: number): Promise<string[]>;
  getUserEffectivePermissions(user: User): Promise<string[]>;
  updateUserSubrole(userId: string, subroleId: number | null): Promise<User | undefined>;
  hasPermission(user: User, permissionKey: string): Promise<boolean>;
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

  async createLocalUser(username: string, passwordHash: string, role: string, firstName?: string, lastName?: string, email?: string | null): Promise<User> {
    const [user] = await db
      .insert(users)
      .values({
        username,
        passwordHash,
        role,
        firstName: firstName || username,
        lastName: lastName || null,
        email: email || null,
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
}

export const storage = new DatabaseStorage();
