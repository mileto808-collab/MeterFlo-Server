import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { pool } from "./db";
import { sql } from "drizzle-orm";

// Service type enum for work orders
export const serviceTypeEnum = ["Water", "Electric", "Gas"] as const;
export type ServiceType = (typeof serviceTypeEnum)[number];

// Work orders schema for project databases (within project-specific schemas)
export const projectWorkOrders = pgTable("work_orders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  customerWoId: varchar("customer_wo_id", { length: 100 }).unique(),
  customerId: varchar("customer_id", { length: 100 }),
  customerName: varchar("customer_name", { length: 255 }),
  address: varchar("address", { length: 500 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 50 }),
  zip: varchar("zip", { length: 20 }),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 255 }),
  route: varchar("route", { length: 100 }),
  zone: varchar("zone", { length: 100 }),
  serviceType: varchar("service_type", { length: 20 }),
  oldMeterId: varchar("old_meter_id", { length: 100 }),
  oldMeterReading: integer("old_meter_reading"),
  newMeterId: varchar("new_meter_id", { length: 100 }),
  newMeterReading: integer("new_meter_reading"),
  oldGps: varchar("old_gps", { length: 100 }),
  newGps: varchar("new_gps", { length: 100 }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  priority: varchar("priority", { length: 20 }).notNull().default("medium"),
  assignedTo: varchar("assigned_to"),
  createdBy: varchar("created_by"),
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
        customer_wo_id VARCHAR(100) UNIQUE,
        customer_id VARCHAR(100),
        customer_name VARCHAR(255),
        address VARCHAR(500),
        city VARCHAR(100),
        state VARCHAR(50),
        zip VARCHAR(20),
        phone VARCHAR(50),
        email VARCHAR(255),
        route VARCHAR(100),
        zone VARCHAR(100),
        service_type VARCHAR(20),
        old_meter_id VARCHAR(100),
        old_meter_reading INTEGER,
        new_meter_id VARCHAR(100),
        new_meter_reading INTEGER,
        old_gps VARCHAR(100),
        new_gps VARCHAR(100),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        priority VARCHAR(20) NOT NULL DEFAULT 'medium',
        assigned_to VARCHAR,
        created_by VARCHAR,
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

  async getWorkOrderByCustomerWoId(customerWoId: string): Promise<ProjectWorkOrder | undefined> {
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT * FROM "${this.schemaName}".work_orders WHERE customer_wo_id = $1`,
        [customerWoId]
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
         (customer_wo_id, customer_id, customer_name, address, city, state, zip, phone, email, route, zone, service_type, old_meter_id, old_meter_reading, new_meter_id, new_meter_reading, old_gps, new_gps, status, priority, assigned_to, created_by, notes, attachments)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
         RETURNING *`,
        [
          workOrder.customerWoId,
          workOrder.customerId,
          workOrder.customerName,
          workOrder.address,
          workOrder.city || null,
          workOrder.state || null,
          workOrder.zip || null,
          workOrder.phone || null,
          workOrder.email || null,
          workOrder.route || null,
          workOrder.zone || null,
          workOrder.serviceType,
          workOrder.oldMeterId || null,
          workOrder.oldMeterReading ?? null,
          workOrder.newMeterId || null,
          workOrder.newMeterReading ?? null,
          workOrder.oldGps || null,
          workOrder.newGps || null,
          workOrder.status || "pending",
          workOrder.priority || "medium",
          workOrder.assignedTo || null,
          workOrder.createdBy || null,
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

      if (updates.customerWoId !== undefined) {
        setClauses.push(`customer_wo_id = $${paramCount++}`);
        values.push(updates.customerWoId);
      }
      if (updates.customerId !== undefined) {
        setClauses.push(`customer_id = $${paramCount++}`);
        values.push(updates.customerId);
      }
      if (updates.customerName !== undefined) {
        setClauses.push(`customer_name = $${paramCount++}`);
        values.push(updates.customerName);
      }
      if (updates.address !== undefined) {
        setClauses.push(`address = $${paramCount++}`);
        values.push(updates.address);
      }
      if (updates.city !== undefined) {
        setClauses.push(`city = $${paramCount++}`);
        values.push(updates.city);
      }
      if (updates.state !== undefined) {
        setClauses.push(`state = $${paramCount++}`);
        values.push(updates.state);
      }
      if (updates.zip !== undefined) {
        setClauses.push(`zip = $${paramCount++}`);
        values.push(updates.zip);
      }
      if (updates.phone !== undefined) {
        setClauses.push(`phone = $${paramCount++}`);
        values.push(updates.phone);
      }
      if (updates.email !== undefined) {
        setClauses.push(`email = $${paramCount++}`);
        values.push(updates.email);
      }
      if (updates.route !== undefined) {
        setClauses.push(`route = $${paramCount++}`);
        values.push(updates.route);
      }
      if (updates.zone !== undefined) {
        setClauses.push(`zone = $${paramCount++}`);
        values.push(updates.zone);
      }
      if (updates.serviceType !== undefined) {
        setClauses.push(`service_type = $${paramCount++}`);
        values.push(updates.serviceType);
      }
      if (updates.oldMeterId !== undefined) {
        setClauses.push(`old_meter_id = $${paramCount++}`);
        values.push(updates.oldMeterId);
      }
      if (updates.oldMeterReading !== undefined) {
        setClauses.push(`old_meter_reading = $${paramCount++}`);
        values.push(updates.oldMeterReading);
      }
      if (updates.newMeterId !== undefined) {
        setClauses.push(`new_meter_id = $${paramCount++}`);
        values.push(updates.newMeterId);
      }
      if (updates.newMeterReading !== undefined) {
        setClauses.push(`new_meter_reading = $${paramCount++}`);
        values.push(updates.newMeterReading);
      }
      if (updates.oldGps !== undefined) {
        setClauses.push(`old_gps = $${paramCount++}`);
        values.push(updates.oldGps);
      }
      if (updates.newGps !== undefined) {
        setClauses.push(`new_gps = $${paramCount++}`);
        values.push(updates.newGps);
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
      customerWoId: row.customer_wo_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      address: row.address,
      city: row.city,
      state: row.state,
      zip: row.zip,
      phone: row.phone,
      email: row.email,
      route: row.route,
      zone: row.zone,
      serviceType: row.service_type,
      oldMeterId: row.old_meter_id,
      oldMeterReading: row.old_meter_reading,
      newMeterId: row.new_meter_id,
      newMeterReading: row.new_meter_reading,
      oldGps: row.old_gps,
      newGps: row.new_gps,
      status: row.status,
      priority: row.priority,
      assignedTo: row.assigned_to,
      createdBy: row.created_by,
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
      customerWoId: row.customer_wo_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      address: row.address,
      city: row.city,
      state: row.state,
      zip: row.zip,
      phone: row.phone,
      email: row.email,
      route: row.route,
      zone: row.zone,
      serviceType: row.service_type,
      oldMeterId: row.old_meter_id,
      oldMeterReading: row.old_meter_reading,
      newMeterId: row.new_meter_id,
      newMeterReading: row.new_meter_reading,
      oldGps: row.old_gps,
      newGps: row.new_gps,
      status: row.status,
      priority: row.priority,
      assignedTo: row.assigned_to,
      createdBy: row.created_by,
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
      version: "2.0",
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
           (customer_wo_id, customer_id, customer_name, address, city, state, zip, phone, email, route, zone, service_type, old_meter_id, old_meter_reading, new_meter_id, new_meter_reading, old_gps, new_gps, status, priority, assigned_to, created_by, completed_at, notes, attachments)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)`,
          [
            wo.customerWoId || null,
            wo.customerId || null,
            wo.customerName || null,
            wo.address || null,
            wo.city || null,
            wo.state || null,
            wo.zip || null,
            wo.phone || null,
            wo.email || null,
            wo.route || null,
            wo.zone || null,
            wo.serviceType || null,
            wo.oldMeterId || null,
            wo.oldMeterReading ?? null,
            wo.newMeterId || null,
            wo.newMeterReading ?? null,
            wo.oldGps || null,
            wo.newGps || null,
            wo.status || "pending",
            wo.priority || "medium",
            wo.assignedTo || null,
            wo.createdBy || null,
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
