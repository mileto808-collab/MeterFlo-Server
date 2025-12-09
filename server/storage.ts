import {
  users,
  projects,
  workOrders,
  type User,
  type UpsertUser,
  type Project,
  type InsertProject,
  type WorkOrder,
  type InsertWorkOrder,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, sql, ilike, or } from "drizzle-orm";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: string): Promise<User | undefined>;
  updateUserProject(id: string, projectId: number | null): Promise<User | undefined>;

  getProjects(): Promise<Project[]>;
  getProject(id: number): Promise<Project | undefined>;
  createProject(project: InsertProject): Promise<Project>;
  updateProject(id: number, project: Partial<InsertProject>): Promise<Project | undefined>;
  deleteProject(id: number): Promise<boolean>;

  getWorkOrders(filters?: { projectId?: number; status?: string; assignedTo?: string }): Promise<WorkOrder[]>;
  getWorkOrder(id: number): Promise<WorkOrder | undefined>;
  createWorkOrder(workOrder: InsertWorkOrder): Promise<WorkOrder>;
  updateWorkOrder(id: number, workOrder: Partial<InsertWorkOrder>): Promise<WorkOrder | undefined>;
  deleteWorkOrder(id: number): Promise<boolean>;
  getWorkOrderStats(): Promise<{ pending: number; inProgress: number; completed: number; total: number }>;
  importWorkOrders(workOrders: InsertWorkOrder[]): Promise<{ imported: number; errors: string[] }>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
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

  async updateUserProject(id: string, projectId: number | null): Promise<User | undefined> {
    const [user] = await db
      .update(users)
      .set({ projectId, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getProjects(): Promise<Project[]> {
    return await db.select().from(projects).orderBy(desc(projects.createdAt));
  }

  async getProject(id: number): Promise<Project | undefined> {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    return project;
  }

  async createProject(project: InsertProject): Promise<Project> {
    const [newProject] = await db.insert(projects).values(project).returning();
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

  async deleteProject(id: number): Promise<boolean> {
    const result = await db.delete(projects).where(eq(projects.id, id));
    return true;
  }

  async getWorkOrders(filters?: { projectId?: number; status?: string; assignedTo?: string }): Promise<WorkOrder[]> {
    let query = db.select().from(workOrders);
    
    const conditions = [];
    if (filters?.projectId) {
      conditions.push(eq(workOrders.projectId, filters.projectId));
    }
    if (filters?.status) {
      conditions.push(eq(workOrders.status, filters.status));
    }
    if (filters?.assignedTo) {
      conditions.push(eq(workOrders.assignedTo, filters.assignedTo));
    }
    
    if (conditions.length > 0) {
      return await db.select().from(workOrders).where(and(...conditions)).orderBy(desc(workOrders.createdAt));
    }
    
    return await db.select().from(workOrders).orderBy(desc(workOrders.createdAt));
  }

  async getWorkOrder(id: number): Promise<WorkOrder | undefined> {
    const [workOrder] = await db.select().from(workOrders).where(eq(workOrders.id, id));
    return workOrder;
  }

  async createWorkOrder(workOrder: InsertWorkOrder): Promise<WorkOrder> {
    const [newWorkOrder] = await db.insert(workOrders).values(workOrder).returning();
    return newWorkOrder;
  }

  async updateWorkOrder(id: number, workOrder: Partial<InsertWorkOrder>): Promise<WorkOrder | undefined> {
    const updateData: any = { ...workOrder, updatedAt: new Date() };
    
    if (workOrder.status === "completed") {
      updateData.completedAt = new Date();
    }
    
    const [updated] = await db
      .update(workOrders)
      .set(updateData)
      .where(eq(workOrders.id, id))
      .returning();
    return updated;
  }

  async deleteWorkOrder(id: number): Promise<boolean> {
    await db.delete(workOrders).where(eq(workOrders.id, id));
    return true;
  }

  async getWorkOrderStats(): Promise<{ pending: number; inProgress: number; completed: number; total: number }> {
    const allOrders = await db.select().from(workOrders);
    
    const stats = {
      pending: 0,
      inProgress: 0,
      completed: 0,
      total: allOrders.length,
    };
    
    for (const order of allOrders) {
      if (order.status === "pending") stats.pending++;
      else if (order.status === "in_progress") stats.inProgress++;
      else if (order.status === "completed") stats.completed++;
    }
    
    return stats;
  }

  async importWorkOrders(workOrdersData: InsertWorkOrder[]): Promise<{ imported: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;
    
    for (let i = 0; i < workOrdersData.length; i++) {
      try {
        await db.insert(workOrders).values(workOrdersData[i]);
        imported++;
      } catch (error) {
        errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
    
    return { imported, errors };
  }
}

export const storage = new DatabaseStorage();
