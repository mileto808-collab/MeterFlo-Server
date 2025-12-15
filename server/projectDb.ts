import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { pool } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";

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
  status: varchar("status", { length: 50 }).notNull().default("Open"),
  scheduledDate: timestamp("scheduled_date"),
  assignedTo: varchar("assigned_to"),
  createdBy: varchar("created_by"),
  updatedBy: varchar("updated_by"),
  completedAt: timestamp("completed_at"),
  trouble: varchar("trouble", { length: 100 }),
  notes: text("notes"),
  attachments: text("attachments").array(),
  oldMeterType: varchar("old_meter_type", { length: 255 }),
  newMeterType: varchar("new_meter_type", { length: 255 }),
  signatureData: text("signature_data"),
  signatureName: varchar("signature_name", { length: 255 }),
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
        status VARCHAR(50) NOT NULL DEFAULT 'Open',
        scheduled_date TIMESTAMP,
        assigned_to VARCHAR,
        created_by VARCHAR,
        updated_by VARCHAR,
        completed_at TIMESTAMP,
        trouble VARCHAR(100),
        notes TEXT,
        attachments TEXT[],
        old_meter_type VARCHAR(255),
        new_meter_type VARCHAR(255),
        signature_data TEXT,
        signature_name VARCHAR(255),
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

// Migrate existing project schema to add missing columns
export async function migrateProjectSchema(schemaName: string): Promise<void> {
  const client = await pool.connect();
  try {
    // Add trouble column if it doesn't exist
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS trouble VARCHAR(100)
    `);
    
    // Rename meter_type to old_meter_type if needed, then add new_meter_type
    // First check if meter_type exists and old_meter_type doesn't
    const columnCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'work_orders' 
      AND column_name IN ('meter_type', 'old_meter_type')
    `, [schemaName]);
    
    const existingColumns = columnCheck.rows.map(r => r.column_name);
    
    if (existingColumns.includes('meter_type') && !existingColumns.includes('old_meter_type')) {
      // Rename meter_type to old_meter_type
      await client.query(`
        ALTER TABLE "${schemaName}".work_orders 
        RENAME COLUMN meter_type TO old_meter_type
      `);
    } else if (!existingColumns.includes('old_meter_type')) {
      // Add old_meter_type if neither exists
      await client.query(`
        ALTER TABLE "${schemaName}".work_orders 
        ADD COLUMN IF NOT EXISTS old_meter_type VARCHAR(255)
      `);
    }
    
    // Add new_meter_type column if it doesn't exist
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS new_meter_type VARCHAR(255)
    `);
    
    // Add signature columns if they don't exist
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS signature_data TEXT
    `);
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS signature_name VARCHAR(255)
    `);
    
    // Migrate scheduled_date from VARCHAR/DATE to TIMESTAMP if needed
    const scheduledDateCheck = await client.query(`
      SELECT data_type FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'work_orders' 
      AND column_name = 'scheduled_date'
    `, [schemaName]);
    
    if (scheduledDateCheck.rows.length > 0) {
      const currentType = scheduledDateCheck.rows[0].data_type;
      if (currentType !== 'timestamp without time zone' && currentType !== 'timestamp with time zone') {
        // Convert to TIMESTAMP - handles both VARCHAR and DATE types
        await client.query(`
          ALTER TABLE "${schemaName}".work_orders 
          ALTER COLUMN scheduled_date TYPE TIMESTAMP USING 
            CASE 
              WHEN scheduled_date IS NULL THEN NULL
              WHEN scheduled_date ~ '^\\d{4}-\\d{2}-\\d{2}' THEN scheduled_date::timestamp
              ELSE NULL
            END
        `);
        console.log(`Migrated scheduled_date to TIMESTAMP for ${schemaName}`);
      }
    }
    
    console.log(`Migration completed for ${schemaName}.work_orders`);
  } catch (error) {
    // Log but don't fail - table might not exist yet
    console.log(`Migration check for ${schemaName}: ${error}`);
  } finally {
    client.release();
  }
}

// Project work order storage class with schema-based isolation
export class ProjectWorkOrderStorage {
  private schemaName: string;
  private migrationPromise: Promise<void>;

  constructor(schemaName: string) {
    this.schemaName = schemaName;
    // Run migration on instantiation
    this.migrationPromise = migrateProjectSchema(schemaName);
  }
  
  // Ensure migration has completed before any operation
  private async ensureMigrated(): Promise<void> {
    await this.migrationPromise;
  }

  async getWorkOrders(filters?: { status?: string; assignedTo?: string }): Promise<ProjectWorkOrder[]> {
    await this.ensureMigrated();
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
    await this.ensureMigrated();
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
    await this.ensureMigrated();
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

  async createWorkOrder(workOrder: Omit<InsertProjectWorkOrder, "id" | "createdAt" | "updatedAt">, createdBy?: string): Promise<ProjectWorkOrder> {
    await this.ensureMigrated();
    const client = await pool.connect();
    try {
      // If scheduledDate is set, auto-set status to "Scheduled"
      let status = workOrder.status || "Open";
      if (workOrder.scheduledDate) {
        status = "Scheduled";
      }
      
      let notes = workOrder.notes || null;
      const troubleCode = (workOrder as any).trouble;
      
      // If trouble code is set, auto-set status to "Trouble" and add note
      if (troubleCode) {
        status = "Trouble";
        const troubleCodeDetails = await this.getTroubleCodeDetails(troubleCode);
        const timestamp = await this.getTimezoneFormattedTimestamp();
        let troubleNote: string;
        if (troubleCodeDetails) {
          troubleNote = `Trouble Code: ${troubleCodeDetails.code} - ${troubleCodeDetails.label} - ${timestamp}`;
        } else {
          // Fallback: use the code value directly if lookup fails
          troubleNote = `Trouble Code: ${troubleCode} - ${timestamp}`;
        }
        notes = notes ? `${notes}\n${troubleNote}` : troubleNote;
      }
      
      const result = await client.query(
        `INSERT INTO "${this.schemaName}".work_orders 
         (customer_wo_id, customer_id, customer_name, address, city, state, zip, phone, email, route, zone, service_type, old_meter_id, old_meter_reading, new_meter_id, new_meter_reading, old_gps, new_gps, status, scheduled_date, assigned_to, created_by, updated_by, trouble, notes, attachments, old_meter_type, new_meter_type, signature_data, signature_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
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
          status,
          workOrder.scheduledDate || null,
          workOrder.assignedTo || null,
          createdBy || workOrder.createdBy || null,
          createdBy || null,
          troubleCode || null,
          notes,
          workOrder.attachments || null,
          (workOrder as any).oldMeterType || null,
          (workOrder as any).newMeterType || null,
          (workOrder as any).signatureData || null,
          (workOrder as any).signatureName || null,
        ]
      );
      return this.mapRowToWorkOrder(result.rows[0]);
    } finally {
      client.release();
    }
  }
  
  private async getTroubleCodeDetails(troubleCodeValue: string): Promise<{ code: string; label: string } | null> {
    try {
      const troubleCodes = await storage.getTroubleCodes();
      const found = troubleCodes.find(tc => tc.code === troubleCodeValue);
      if (found) {
        return { code: found.code, label: found.label };
      }
      return null;
    } catch (error) {
      console.error("Error fetching trouble code details:", error);
      return null;
    }
  }

  private async getTimezoneFormattedTimestamp(): Promise<string> {
    const timezone = await storage.getSetting("default_timezone") || "America/Denver";
    return new Date().toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone
    });
  }

  async updateWorkOrder(id: number, updates: Partial<InsertProjectWorkOrder>, updatedBy?: string): Promise<ProjectWorkOrder | undefined> {
    await this.ensureMigrated();
    const client = await pool.connect();
    try {
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramCount = 1;
      
      // Check if trouble code is being set - we'll handle status and notes later
      const troubleCode = (updates as any).trouble;
      let troubleNoteToAdd: string | null = null;
      let forceStatusToTrouble = false;
      
      if (troubleCode) {
        forceStatusToTrouble = true;
        const troubleCodeDetails = await this.getTroubleCodeDetails(troubleCode);
        const timestamp = await this.getTimezoneFormattedTimestamp();
        if (troubleCodeDetails) {
          troubleNoteToAdd = `Trouble Code: ${troubleCodeDetails.code} - ${troubleCodeDetails.label} - ${timestamp}`;
        } else {
          // Fallback: use the code value directly if lookup fails
          troubleNoteToAdd = `Trouble Code: ${troubleCode} - ${timestamp}`;
        }
      }

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
      if (updates.scheduledDate !== undefined) {
        setClauses.push(`scheduled_date = $${paramCount++}`);
        values.push(updates.scheduledDate || null);
        // If scheduledDate is being set, auto-set status to "Scheduled"
        if (updates.scheduledDate && updates.status === undefined) {
          setClauses.push(`status = 'Scheduled'`);
        }
      }
      // Handle status - if trouble code is set, force status to "Trouble"
      if (forceStatusToTrouble) {
        setClauses.push(`status = $${paramCount++}`);
        values.push("Trouble");
      } else if (updates.status !== undefined) {
        setClauses.push(`status = $${paramCount++}`);
        values.push(updates.status);
        if (updates.status === "Completed") {
          setClauses.push(`completed_at = NOW()`);
        }
        // If status is changing away from "Scheduled", clear scheduledDate
        if (updates.status !== "Scheduled" && updates.scheduledDate === undefined) {
          setClauses.push(`scheduled_date = NULL`);
        }
      }
      if ((updates as any).trouble !== undefined) {
        setClauses.push(`trouble = $${paramCount++}`);
        values.push((updates as any).trouble);
      }
      // Handle notes - append trouble note if needed
      if (troubleNoteToAdd) {
        // We need to get existing notes and append the trouble note
        const existingResult = await client.query(
          `SELECT notes FROM "${this.schemaName}".work_orders WHERE id = $1`,
          [id]
        );
        const existingNotes = existingResult.rows[0]?.notes || "";
        const updatedNotes = updates.notes !== undefined ? updates.notes : existingNotes;
        const finalNotes = updatedNotes ? `${updatedNotes}\n${troubleNoteToAdd}` : troubleNoteToAdd;
        setClauses.push(`notes = $${paramCount++}`);
        values.push(finalNotes);
      } else if (updates.notes !== undefined) {
        setClauses.push(`notes = $${paramCount++}`);
        values.push(updates.notes);
      }
      if (updates.attachments !== undefined) {
        setClauses.push(`attachments = $${paramCount++}`);
        values.push(updates.attachments);
      }
      if ((updates as any).oldMeterType !== undefined) {
        setClauses.push(`old_meter_type = $${paramCount++}`);
        values.push((updates as any).oldMeterType);
      }
      if ((updates as any).newMeterType !== undefined) {
        setClauses.push(`new_meter_type = $${paramCount++}`);
        values.push((updates as any).newMeterType);
      }
      if ((updates as any).signatureData !== undefined) {
        setClauses.push(`signature_data = $${paramCount++}`);
        values.push((updates as any).signatureData);
      }
      if ((updates as any).signatureName !== undefined) {
        setClauses.push(`signature_name = $${paramCount++}`);
        values.push((updates as any).signatureName);
      }

      // Always set updatedBy and updated_at
      if (updatedBy) {
        setClauses.push(`updated_by = $${paramCount++}`);
        values.push(updatedBy);
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

  async getWorkOrderStats(): Promise<{ statusCounts: Record<string, number>; total: number }> {
    const client = await pool.connect();
    try {
      const result = await client.query(`
        SELECT status, COUNT(*) as count
        FROM "${this.schemaName}".work_orders
        GROUP BY status
      `);
      
      const statusCounts: Record<string, number> = {};
      let total = 0;
      
      for (const row of result.rows) {
        const count = parseInt(row.count) || 0;
        statusCounts[row.status] = count;
        total += count;
      }
      
      return { statusCounts, total };
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
      scheduledDate: row.scheduled_date,
      assignedTo: row.assigned_to,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      completedAt: row.completed_at,
      trouble: row.trouble,
      notes: row.notes,
      attachments: row.attachments,
      oldMeterType: row.old_meter_type,
      newMeterType: row.new_meter_type,
      signatureData: row.signature_data,
      signatureName: row.signature_name,
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
      scheduledDate: row.scheduled_date,
      assignedTo: row.assigned_to,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      completedAt: row.completed_at,
      trouble: row.trouble,
      notes: row.notes,
      attachments: row.attachments,
      oldMeterType: row.old_meter_type,
      newMeterType: row.new_meter_type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    
    return {
      schemaName,
      backupDate: new Date().toISOString(),
      workOrders,
      version: "2.2",
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
      const wo = backup.workOrders[i] as any;
      try {
        await client.query(
          `INSERT INTO "${schemaName}".work_orders 
           (customer_wo_id, customer_id, customer_name, address, city, state, zip, phone, email, route, zone, service_type, old_meter_id, old_meter_reading, new_meter_id, new_meter_reading, old_gps, new_gps, status, scheduled_date, assigned_to, created_by, updated_by, completed_at, trouble, notes, attachments, old_meter_type, new_meter_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)`,
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
            wo.status || "Open",
            wo.scheduledDate || null,
            wo.assignedTo || null,
            wo.createdBy || null,
            wo.updatedBy || null,
            wo.completedAt || null,
            wo.trouble || null,
            wo.notes || null,
            wo.attachments || null,
            wo.oldMeterType || wo.meterType || null,
            wo.newMeterType || null,
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

// Migrate project schema to add trouble column if it doesn't exist
export async function migrateProjectSchemaAddTrouble(schemaName: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    // Check if trouble column exists
    const checkResult = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'work_orders' AND column_name = 'trouble'
    `, [schemaName]);
    
    if (checkResult.rows.length === 0) {
      // Add trouble column
      await client.query(`ALTER TABLE "${schemaName}".work_orders ADD COLUMN trouble VARCHAR(100)`);
      console.log(`Added trouble column to ${schemaName}.work_orders`);
      return true;
    }
    return false;
  } finally {
    client.release();
  }
}
