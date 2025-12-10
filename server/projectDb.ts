import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { pool } from "./db";
import { sql } from "drizzle-orm";

// Work orders schema for project databases (within project-specific schemas)
export const projectWorkOrders = pgTable("work_orders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  priority: varchar("priority", { length: 20 }).notNull().default("medium"),
  assignedTo: varchar("assigned_to"),
  createdBy: varchar("created_by"),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  attachments: text("attachments").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ProjectWorkOrder = typeof projectWorkOrders.$inferSelect;
export type InsertProjectWorkOrder = typeof projectWorkOrders.$inferInsert;

// Sanitize project name for use as schema name
export function sanitizeSchemaName(projectName: string, projectId: number): string {
  const sanitized = projectName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .substring(0, 50);
  return `project_${sanitized}_${projectId}`;
}

// Create project schema and tables
export async function createProjectSchema(projectName: string, projectId: number): Promise<string> {
  const schemaName = sanitizeSchemaName(projectName, projectId);
  
  const client = await pool.connect();
  try {
    // Create schema
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    
    // Create work_orders table in the project schema
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".work_orders (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        priority VARCHAR(20) NOT NULL DEFAULT 'medium',
        assigned_to VARCHAR,
        created_by VARCHAR,
        due_date TIMESTAMP,
        completed_at TIMESTAMP,
        notes TEXT,
        attachments TEXT[],
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    console.log(`Created project schema: ${schemaName}`);
    return schemaName;
  } finally {
    client.release();
  }
}

// Delete project schema
export async function deleteProjectSchema(schemaName: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    console.log(`Deleted project schema: ${schemaName}`);
  } finally {
    client.release();
  }
}

// Project work order storage class with schema-based isolation
export class ProjectWorkOrderStorage {
  private schemaName: string;

  constructor(schemaName: string) {
    this.schemaName = schemaName;
  }

  async getWorkOrders(filters?: { status?: string; assignedTo?: string }): Promise<ProjectWorkOrder[]> {
    const client = await pool.connect();
    try {
      let query = `SELECT * FROM "${this.schemaName}".work_orders`;
      const conditions: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (filters?.status) {
        conditions.push(`status = $${paramCount++}`);
        values.push(filters.status);
      }
      if (filters?.assignedTo) {
        conditions.push(`assigned_to = $${paramCount++}`);
        values.push(filters.assignedTo);
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(" AND ")}`;
      }
      query += " ORDER BY created_at DESC";

      const result = await client.query(query, values);
      return result.rows.map(this.mapRowToWorkOrder);
    } finally {
      client.release();
    }
  }

  async getWorkOrder(id: number): Promise<ProjectWorkOrder | undefined> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM "${this.schemaName}".work_orders WHERE id = $1`,
        [id]
      );
      return result.rows[0] ? this.mapRowToWorkOrder(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  async createWorkOrder(workOrder: Omit<InsertProjectWorkOrder, "id" | "createdAt" | "updatedAt">): Promise<ProjectWorkOrder> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `INSERT INTO "${this.schemaName}".work_orders 
         (title, description, status, priority, assigned_to, created_by, due_date, notes, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          workOrder.title,
          workOrder.description || null,
          workOrder.status || "pending",
          workOrder.priority || "medium",
          workOrder.assignedTo || null,
          workOrder.createdBy || null,
          workOrder.dueDate || null,
          workOrder.notes || null,
          workOrder.attachments || null,
        ]
      );
      return this.mapRowToWorkOrder(result.rows[0]);
    } finally {
      client.release();
    }
  }

  async updateWorkOrder(id: number, updates: Partial<InsertProjectWorkOrder>): Promise<ProjectWorkOrder | undefined> {
    const client = await pool.connect();
    try {
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (updates.title !== undefined) {
        setClauses.push(`title = $${paramCount++}`);
        values.push(updates.title);
      }
      if (updates.description !== undefined) {
        setClauses.push(`description = $${paramCount++}`);
        values.push(updates.description);
      }
      if (updates.status !== undefined) {
        setClauses.push(`status = $${paramCount++}`);
        values.push(updates.status);
        if (updates.status === "completed") {
          setClauses.push(`completed_at = NOW()`);
        }
      }
      if (updates.priority !== undefined) {
        setClauses.push(`priority = $${paramCount++}`);
        values.push(updates.priority);
      }
      if (updates.assignedTo !== undefined) {
        setClauses.push(`assigned_to = $${paramCount++}`);
        values.push(updates.assignedTo);
      }
      if (updates.dueDate !== undefined) {
        setClauses.push(`due_date = $${paramCount++}`);
        values.push(updates.dueDate);
      }
      if (updates.notes !== undefined) {
        setClauses.push(`notes = $${paramCount++}`);
        values.push(updates.notes);
      }
      if (updates.attachments !== undefined) {
        setClauses.push(`attachments = $${paramCount++}`);
        values.push(updates.attachments);
      }

      setClauses.push(`updated_at = NOW()`);
      values.push(id);

      const result = await client.query(
        `UPDATE "${this.schemaName}".work_orders SET ${setClauses.join(", ")} WHERE id = $${paramCount} RETURNING *`,
        values
      );
      return result.rows[0] ? this.mapRowToWorkOrder(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  async deleteWorkOrder(id: number): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM "${this.schemaName}".work_orders WHERE id = $1`, [id]);
      return true;
    } finally {
      client.release();
    }
  }

  async getWorkOrderStats(): Promise<{ pending: number; inProgress: number; completed: number; total: number }> {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status = 'pending') as pending,
          COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) as total
        FROM "${this.schemaName}".work_orders
      `);
      const row = result.rows[0];
      return {
        pending: parseInt(row.pending) || 0,
        inProgress: parseInt(row.in_progress) || 0,
        completed: parseInt(row.completed) || 0,
        total: parseInt(row.total) || 0,
      };
    } finally {
      client.release();
    }
  }

  async importWorkOrders(workOrders: Array<Omit<InsertProjectWorkOrder, "id" | "createdAt" | "updatedAt">>): Promise<{ imported: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;

    for (let i = 0; i < workOrders.length; i++) {
      try {
        await this.createWorkOrder(workOrders[i]);
        imported++;
      } catch (error) {
        errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    return { imported, errors };
  }

  private mapRowToWorkOrder(row: any): ProjectWorkOrder {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assignedTo: row.assigned_to,
      createdBy: row.created_by,
      dueDate: row.due_date,
      completedAt: row.completed_at,
      notes: row.notes,
      attachments: row.attachments,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

// Cache for project storage instances
const projectStorageCache = new Map<string, ProjectWorkOrderStorage>();

export function getProjectWorkOrderStorage(schemaName: string): ProjectWorkOrderStorage {
  if (!projectStorageCache.has(schemaName)) {
    projectStorageCache.set(schemaName, new ProjectWorkOrderStorage(schemaName));
  }
  return projectStorageCache.get(schemaName)!;
}

// Backup project database to JSON format
export async function backupProjectDatabase(schemaName: string): Promise<{
  schemaName: string;
  backupDate: string;
  workOrders: ProjectWorkOrder[];
  version: string;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT * FROM "${schemaName}".work_orders ORDER BY id`
    );
    
    const workOrders = result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      assignedTo: row.assigned_to,
      createdBy: row.created_by,
      dueDate: row.due_date,
      completedAt: row.completed_at,
      notes: row.notes,
      attachments: row.attachments,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    
    return {
      schemaName,
      backupDate: new Date().toISOString(),
      workOrders,
      version: "1.0",
    };
  } finally {
    client.release();
  }
}

// Restore project database from backup JSON
export async function restoreProjectDatabase(
  schemaName: string,
  backup: { workOrders: Array<Omit<ProjectWorkOrder, "id" | "createdAt" | "updatedAt">> },
  options: { clearExisting?: boolean } = {}
): Promise<{ restored: number; errors: string[] }> {
  const client = await pool.connect();
  const errors: string[] = [];
  let restored = 0;
  
  try {
    if (options.clearExisting) {
      await client.query(`DELETE FROM "${schemaName}".work_orders`);
    }
    
    for (let i = 0; i < backup.workOrders.length; i++) {
      const wo = backup.workOrders[i];
      try {
        await client.query(
          `INSERT INTO "${schemaName}".work_orders 
           (title, description, status, priority, assigned_to, created_by, due_date, completed_at, notes, attachments)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            wo.title,
            wo.description || null,
            wo.status || "pending",
            wo.priority || "medium",
            wo.assignedTo || null,
            wo.createdBy || null,
            wo.dueDate || null,
            wo.completedAt || null,
            wo.notes || null,
            wo.attachments || null,
          ]
        );
        restored++;
      } catch (error) {
        errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
    
    return { restored, errors };
  } finally {
    client.release();
  }
}

// Get project database statistics
export async function getProjectDatabaseStats(schemaName: string): Promise<{
  totalRecords: number;
  tableSize: string;
  lastModified: string | null;
}> {
  const client = await pool.connect();
  try {
    const countResult = await client.query(
      `SELECT COUNT(*) as count FROM "${schemaName}".work_orders`
    );
    
    const sizeResult = await client.query(
      `SELECT pg_size_pretty(pg_total_relation_size('"${schemaName}".work_orders')) as size`
    );
    
    const lastModifiedResult = await client.query(
      `SELECT MAX(updated_at) as last_modified FROM "${schemaName}".work_orders`
    );
    
    return {
      totalRecords: parseInt(countResult.rows[0].count, 10),
      tableSize: sizeResult.rows[0].size,
      lastModified: lastModifiedResult.rows[0].last_modified?.toISOString() || null,
    };
  } finally {
    client.release();
  }
}
