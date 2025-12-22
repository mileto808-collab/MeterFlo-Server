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
  serviceTypeId: integer("service_type_id"),
  oldMeterId: varchar("old_meter_id", { length: 100 }),
  oldMeterReading: integer("old_meter_reading"),
  newMeterId: varchar("new_meter_id", { length: 100 }),
  newMeterReading: integer("new_meter_reading"),
  oldGps: varchar("old_gps", { length: 100 }),
  newGps: varchar("new_gps", { length: 100 }),
  status: varchar("status", { length: 50 }).notNull().default("Open"),
  statusId: integer("status_id"),
  scheduledDate: timestamp("scheduled_date"),
  assignedUserId: varchar("assigned_user_id"),
  assignedGroupId: integer("assigned_group_id"),
  createdBy: varchar("created_by"),
  createdById: varchar("created_by_id"),
  updatedBy: varchar("updated_by"),
  updatedById: varchar("updated_by_id"),
  completedAt: timestamp("completed_at"),
  trouble: varchar("trouble", { length: 100 }),
  troubleCodeId: integer("trouble_code_id"),
  notes: text("notes"),
  attachments: text("attachments").array(),
  oldMeterType: varchar("old_meter_type", { length: 255 }),
  oldMeterTypeId: integer("old_meter_type_id"),
  newMeterType: varchar("new_meter_type", { length: 255 }),
  newMeterTypeId: integer("new_meter_type_id"),
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
    
    // Create work_orders table in the project schema with foreign key constraints
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
        service_type_id INTEGER REFERENCES public.service_types(id) ON DELETE RESTRICT,
        old_meter_id VARCHAR(100),
        old_meter_reading INTEGER,
        new_meter_id VARCHAR(100),
        new_meter_reading INTEGER,
        old_gps VARCHAR(100),
        new_gps VARCHAR(100),
        status VARCHAR(50) NOT NULL DEFAULT 'Open',
        status_id INTEGER REFERENCES public.work_order_statuses(id) ON DELETE RESTRICT,
        scheduled_date TIMESTAMP,
        assigned_user_id VARCHAR REFERENCES public.users(id) ON DELETE RESTRICT,
        assigned_group_id INTEGER REFERENCES public.user_groups(id) ON DELETE RESTRICT,
        created_by VARCHAR,
        created_by_id VARCHAR REFERENCES public.users(id) ON DELETE RESTRICT,
        updated_by VARCHAR,
        updated_by_id VARCHAR REFERENCES public.users(id) ON DELETE RESTRICT,
        completed_at TIMESTAMP,
        trouble VARCHAR(100),
        trouble_code_id INTEGER REFERENCES public.trouble_codes(id) ON DELETE RESTRICT,
        notes TEXT,
        attachments TEXT[],
        old_meter_type VARCHAR(255),
        old_meter_type_id INTEGER REFERENCES public.meter_types(id) ON DELETE RESTRICT,
        new_meter_type VARCHAR(255),
        new_meter_type_id INTEGER REFERENCES public.meter_types(id) ON DELETE RESTRICT,
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
    
    // Add foreign key ID columns for data integrity
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS service_type_id INTEGER
    `);
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS status_id INTEGER
    `);
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS assigned_user_id VARCHAR
    `);
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS assigned_group_id INTEGER
    `);
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS created_by_id VARCHAR
    `);
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS updated_by_id VARCHAR
    `);
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS trouble_code_id INTEGER
    `);
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS old_meter_type_id INTEGER
    `);
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      ADD COLUMN IF NOT EXISTS new_meter_type_id INTEGER
    `);
    
    // Add/update foreign key constraints with ON DELETE RESTRICT
    // Drop existing constraints first if they exist, then recreate with RESTRICT
    const fkConstraints = [
      { column: 'service_type_id', ref_table: 'public.service_types', ref_column: 'id', constraint_name: 'fk_service_type' },
      { column: 'status_id', ref_table: 'public.work_order_statuses', ref_column: 'id', constraint_name: 'fk_status' },
      { column: 'assigned_user_id', ref_table: 'public.users', ref_column: 'id', constraint_name: 'fk_assigned_user' },
      { column: 'assigned_group_id', ref_table: 'public.user_groups', ref_column: 'id', constraint_name: 'fk_assigned_group' },
      { column: 'created_by_id', ref_table: 'public.users', ref_column: 'id', constraint_name: 'fk_created_by' },
      { column: 'updated_by_id', ref_table: 'public.users', ref_column: 'id', constraint_name: 'fk_updated_by' },
      { column: 'trouble_code_id', ref_table: 'public.trouble_codes', ref_column: 'id', constraint_name: 'fk_trouble_code' },
      { column: 'old_meter_type_id', ref_table: 'public.meter_types', ref_column: 'id', constraint_name: 'fk_old_meter_type' },
      { column: 'new_meter_type_id', ref_table: 'public.meter_types', ref_column: 'id', constraint_name: 'fk_new_meter_type' },
    ];
    
    for (const fk of fkConstraints) {
      try {
        // Check if constraint already exists
        const constraintExists = await client.query(`
          SELECT 1 FROM information_schema.table_constraints 
          WHERE table_schema = $1 AND table_name = 'work_orders' 
          AND constraint_name = $2
        `, [schemaName, fk.constraint_name]);
        
        if (constraintExists.rows.length > 0) {
          // Drop existing constraint (it may have SET NULL, we want RESTRICT)
          await client.query(`
            ALTER TABLE "${schemaName}".work_orders 
            DROP CONSTRAINT IF EXISTS ${fk.constraint_name}
          `);
          console.log(`Dropped existing FK constraint ${fk.constraint_name} from ${schemaName}.work_orders`);
        }
        
        // Add constraint with ON DELETE RESTRICT
        await client.query(`
          ALTER TABLE "${schemaName}".work_orders 
          ADD CONSTRAINT ${fk.constraint_name} 
          FOREIGN KEY (${fk.column}) REFERENCES ${fk.ref_table}(${fk.ref_column}) ON DELETE RESTRICT
        `);
        console.log(`Added FK constraint ${fk.constraint_name} with ON DELETE RESTRICT to ${schemaName}.work_orders`);
      } catch (fkError) {
        // Log error and continue
        console.log(`FK constraint ${fk.constraint_name} for ${schemaName}: ${fkError}`);
      }
    }
    
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
    
    // Drop the deprecated assigned_to column if it exists
    const assignedToCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'work_orders' 
      AND column_name = 'assigned_to'
    `, [schemaName]);
    
    if (assignedToCheck.rows.length > 0) {
      await client.query(`
        ALTER TABLE "${schemaName}".work_orders 
        DROP COLUMN IF EXISTS assigned_to
      `);
      console.log(`Dropped deprecated assigned_to column from ${schemaName}.work_orders`);
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

  async getWorkOrders(filters?: { status?: string; assignedUserId?: string; assignedGroupId?: number }): Promise<ProjectWorkOrder[]> {
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
      if (filters?.assignedUserId) {
        conditions.push(`assigned_user_id = $${paramCount++}`);
        values.push(filters.assignedUserId);
      }
      if (filters?.assignedGroupId) {
        conditions.push(`assigned_group_id = $${paramCount++}`);
        values.push(filters.assignedGroupId);
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
      let troubleCodeId: number | null = null;
      
      // If trouble code is set, auto-set status to "Trouble" and add note
      if (troubleCode) {
        status = "Trouble";
        const troubleCodeDetails = await this.getTroubleCodeDetails(troubleCode);
        const timestamp = await this.getTimezoneFormattedTimestamp();
        let troubleNote: string;
        if (troubleCodeDetails) {
          troubleNote = `Trouble Code: ${troubleCodeDetails.code} - ${troubleCodeDetails.label} - ${timestamp}`;
          troubleCodeId = troubleCodeDetails.id;
        } else {
          // Fallback: use the code value directly if lookup fails
          troubleNote = `Trouble Code: ${troubleCode} - ${timestamp}`;
        }
        notes = notes ? `${notes}\n${troubleNote}` : troubleNote;
      }
      
      // Resolve text values to IDs for foreign key integrity
      const statusId = await this.resolveStatusId(status);
      const serviceTypeId = workOrder.serviceType ? await this.resolveServiceTypeId(workOrder.serviceType) : null;
      const oldMeterTypeId = (workOrder as any).oldMeterType ? await this.resolveMeterTypeId((workOrder as any).oldMeterType) : null;
      const newMeterTypeId = (workOrder as any).newMeterType ? await this.resolveMeterTypeId((workOrder as any).newMeterType) : null;
      
      // Get assigned user/group IDs directly from the work order
      const assignedUserId = workOrder.assignedUserId || null;
      const assignedGroupId = workOrder.assignedGroupId || null;
      
      // Resolve created_by to user ID
      const createdByValue = createdBy || workOrder.createdBy || null;
      const createdById = createdByValue ? await this.resolveUserId(createdByValue) : null;
      
      // Set completedAt if status is a "Completed" type status
      const isCompleted = await this.isCompletedStatus(status);
      const completedAt = isCompleted ? new Date() : null;
      
      const result = await client.query(
        `INSERT INTO "${this.schemaName}".work_orders 
         (customer_wo_id, customer_id, customer_name, address, city, state, zip, phone, email, route, zone, service_type, service_type_id, old_meter_id, old_meter_reading, new_meter_id, new_meter_reading, old_gps, new_gps, status, status_id, scheduled_date, assigned_user_id, assigned_group_id, created_by, created_by_id, updated_by, updated_by_id, trouble, trouble_code_id, notes, attachments, old_meter_type, old_meter_type_id, new_meter_type, new_meter_type_id, signature_data, signature_name, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39)
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
          serviceTypeId,
          workOrder.oldMeterId || null,
          workOrder.oldMeterReading ?? null,
          workOrder.newMeterId || null,
          workOrder.newMeterReading ?? null,
          workOrder.oldGps || null,
          workOrder.newGps || null,
          status,
          statusId,
          workOrder.scheduledDate || null,
          assignedUserId,
          assignedGroupId,
          createdByValue,
          createdById,
          createdByValue,
          createdById,
          troubleCode || null,
          troubleCodeId,
          notes,
          workOrder.attachments || null,
          (workOrder as any).oldMeterType || null,
          oldMeterTypeId,
          (workOrder as any).newMeterType || null,
          newMeterTypeId,
          (workOrder as any).signatureData || null,
          (workOrder as any).signatureName || null,
          completedAt,
        ]
      );
      return this.mapRowToWorkOrder(result.rows[0]);
    } finally {
      client.release();
    }
  }
  
  private async getTroubleCodeDetails(troubleCodeValue: string): Promise<{ id: number; code: string; label: string } | null> {
    try {
      const troubleCodes = await storage.getTroubleCodes();
      const found = troubleCodes.find(tc => tc.code === troubleCodeValue);
      if (found) {
        return { id: found.id, code: found.code, label: found.label };
      }
      return null;
    } catch (error) {
      console.error("Error fetching trouble code details:", error);
      return null;
    }
  }
  
  private async resolveStatusId(statusLabel: string): Promise<number | null> {
    try {
      const statuses = await storage.getWorkOrderStatuses();
      const found = statuses.find(s => s.label === statusLabel || s.code === statusLabel);
      return found?.id || null;
    } catch {
      return null;
    }
  }
  
  private async isCompletedStatus(statusValue: string): Promise<boolean> {
    try {
      const statuses = await storage.getWorkOrderStatuses();
      const found = statuses.find(s => s.label === statusValue || s.code === statusValue);
      // Check if this status is the "Completed" status (label matches "Completed")
      return found?.label === "Completed";
    } catch {
      return false;
    }
  }
  
  private async resolveServiceTypeId(serviceTypeLabel: string): Promise<number | null> {
    try {
      const serviceTypes = await storage.getServiceTypes();
      const found = serviceTypes.find(s => s.label === serviceTypeLabel || s.code === serviceTypeLabel);
      return found?.id || null;
    } catch {
      return null;
    }
  }
  
  private async resolveMeterTypeId(meterTypeLabel: string): Promise<number | null> {
    try {
      const meterTypes = await storage.getMeterTypes();
      const found = meterTypes.find(m => m.productLabel === meterTypeLabel || m.productId === meterTypeLabel);
      return found?.id || null;
    } catch {
      return null;
    }
  }
  
  private async resolveUserId(userIdentifier: string): Promise<string | null> {
    try {
      const users = await storage.getAllUsers();
      const found = users.find(u => 
        u.id === userIdentifier || 
        u.username === userIdentifier ||
        `${u.firstName} ${u.lastName}`.trim() === userIdentifier
      );
      return found?.id || null;
    } catch {
      return null;
    }
  }
  
  private async resolveGroupId(groupName: string): Promise<number | null> {
    try {
      const groups = await storage.getAllUserGroups();
      const found = groups.find(g => g.name === groupName);
      return found?.id || null;
    } catch {
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
        
        // Only add a trouble note if the trouble code is actually changing
        const existingWoResult = await client.query(
          `SELECT trouble FROM "${this.schemaName}".work_orders WHERE id = $1`,
          [id]
        );
        const existingTroubleCode = existingWoResult.rows[0]?.trouble;
        
        // Only add note if trouble code is different from existing value
        if (troubleCode !== existingTroubleCode) {
          const troubleCodeDetails = await this.getTroubleCodeDetails(troubleCode);
          const timestamp = await this.getTimezoneFormattedTimestamp();
          if (troubleCodeDetails) {
            troubleNoteToAdd = `Trouble Code: ${troubleCodeDetails.code} - ${troubleCodeDetails.label} - ${timestamp}`;
          } else {
            // Fallback: use the code value directly if lookup fails
            troubleNoteToAdd = `Trouble Code: ${troubleCode} - ${timestamp}`;
          }
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
        values.push(updates.serviceType || null);
        if (updates.serviceType) {
          const serviceTypeId = await this.resolveServiceTypeId(updates.serviceType);
          setClauses.push(`service_type_id = $${paramCount++}`);
          values.push(serviceTypeId);
        } else {
          setClauses.push(`service_type_id = NULL`);
        }
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
        // If scheduledDate is being set, auto-set status to "Scheduled" with corresponding ID
        if (updates.scheduledDate && updates.status === undefined) {
          setClauses.push(`status = $${paramCount++}`);
          values.push("Scheduled");
          const scheduledStatusId = await this.resolveStatusId("Scheduled");
          setClauses.push(`status_id = $${paramCount++}`);
          values.push(scheduledStatusId);
        }
      }
      // Handle status - if trouble code is set, force status to "Trouble"
      if (forceStatusToTrouble) {
        setClauses.push(`status = $${paramCount++}`);
        values.push("Trouble");
        const statusId = await this.resolveStatusId("Trouble");
        setClauses.push(`status_id = $${paramCount++}`);
        values.push(statusId);
      } else if (updates.status !== undefined) {
        setClauses.push(`status = $${paramCount++}`);
        values.push(updates.status);
        const statusId = await this.resolveStatusId(updates.status);
        setClauses.push(`status_id = $${paramCount++}`);
        values.push(statusId);
        // Check if this status is a "Completed" type and set completed_at
        const isCompleted = await this.isCompletedStatus(updates.status);
        if (isCompleted) {
          setClauses.push(`completed_at = NOW()`);
        }
        // If status is changing away from "Scheduled", clear scheduledDate and related fields
        if (updates.status !== "Scheduled" && updates.scheduledDate === undefined) {
          setClauses.push(`scheduled_date = NULL`);
        }
      }
      // Handle clearing scheduled_date without explicit status change - preserve status_id
      if (updates.scheduledDate === null && updates.status === undefined) {
        // Just clearing the date, don't change status
      }
      if ((updates as any).trouble !== undefined) {
        setClauses.push(`trouble = $${paramCount++}`);
        values.push((updates as any).trouble || null);
        if ((updates as any).trouble) {
          const troubleCodeDetails = await this.getTroubleCodeDetails((updates as any).trouble);
          setClauses.push(`trouble_code_id = $${paramCount++}`);
          values.push(troubleCodeDetails?.id || null);
        } else {
          // Clear trouble_code_id when clearing trouble text
          setClauses.push(`trouble_code_id = NULL`);
        }
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
        values.push((updates as any).oldMeterType || null);
        if ((updates as any).oldMeterType) {
          const oldMeterTypeId = await this.resolveMeterTypeId((updates as any).oldMeterType);
          setClauses.push(`old_meter_type_id = $${paramCount++}`);
          values.push(oldMeterTypeId);
        } else {
          setClauses.push(`old_meter_type_id = NULL`);
        }
      }
      if ((updates as any).newMeterType !== undefined) {
        setClauses.push(`new_meter_type = $${paramCount++}`);
        values.push((updates as any).newMeterType || null);
        if ((updates as any).newMeterType) {
          const newMeterTypeId = await this.resolveMeterTypeId((updates as any).newMeterType);
          setClauses.push(`new_meter_type_id = $${paramCount++}`);
          values.push(newMeterTypeId);
        } else {
          setClauses.push(`new_meter_type_id = NULL`);
        }
      }
      if ((updates as any).signatureData !== undefined) {
        setClauses.push(`signature_data = $${paramCount++}`);
        values.push((updates as any).signatureData);
      }
      if ((updates as any).signatureName !== undefined) {
        setClauses.push(`signature_name = $${paramCount++}`);
        values.push((updates as any).signatureName);
      }

      // Handle assignedUserId and assignedGroupId directly
      if (updates.assignedUserId !== undefined) {
        setClauses.push(`assigned_user_id = $${paramCount++}`);
        values.push(updates.assignedUserId || null);
      }
      if (updates.assignedGroupId !== undefined) {
        setClauses.push(`assigned_group_id = $${paramCount++}`);
        values.push(updates.assignedGroupId || null);
      }

      // Always set updatedBy and updated_at
      if (updatedBy) {
        setClauses.push(`updated_by = $${paramCount++}`);
        values.push(updatedBy);
        const updatedById = await this.resolveUserId(updatedBy);
        setClauses.push(`updated_by_id = $${paramCount++}`);
        values.push(updatedById);
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
      // Join with work_order_statuses to map both status codes and labels to the canonical label
      // Uses COALESCE to handle cases where status is stored as code or label
      const result = await client.query(`
        SELECT 
          COALESCE(
            (SELECT label FROM public.work_order_statuses WHERE code = wo.status),
            (SELECT label FROM public.work_order_statuses WHERE label = wo.status),
            wo.status
          ) as status_label,
          COUNT(*) as count
        FROM "${this.schemaName}".work_orders wo
        GROUP BY status_label
      `);
      
      const statusCounts: Record<string, number> = {};
      let total = 0;
      
      for (const row of result.rows) {
        const count = parseInt(row.count) || 0;
        const label = row.status_label || "Unknown";
        statusCounts[label] = (statusCounts[label] || 0) + count;
        total += count;
      }
      
      return { statusCounts, total };
    } finally {
      client.release();
    }
  }

  async importWorkOrders(workOrders: Array<Omit<InsertProjectWorkOrder, "id" | "createdAt" | "updatedAt">>, importedBy?: string): Promise<{ imported: number; updated: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;
    let updated = 0;

    for (let i = 0; i < workOrders.length; i++) {
      try {
        const wo = workOrders[i];
        
        // Check if work order with this customerWoId already exists
        if (wo.customerWoId) {
          const existing = await this.getWorkOrderByCustomerWoId(wo.customerWoId);
          if (existing) {
            // Update existing work order (upsert) - exclude createdBy for updates
            const { createdBy, ...updateData } = wo as any;
            await this.updateWorkOrder(existing.id, updateData, importedBy);
            updated++;
            continue;
          }
        }
        
        // Create new work order
        await this.createWorkOrder(wo, importedBy);
        imported++;
      } catch (error) {
        errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    return { imported, updated, errors };
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
      serviceTypeId: row.service_type_id,
      oldMeterId: row.old_meter_id,
      oldMeterReading: row.old_meter_reading,
      newMeterId: row.new_meter_id,
      newMeterReading: row.new_meter_reading,
      oldGps: row.old_gps,
      newGps: row.new_gps,
      status: row.status,
      statusId: row.status_id,
      scheduledDate: row.scheduled_date,
      assignedUserId: row.assigned_user_id,
      assignedGroupId: row.assigned_group_id,
      createdBy: row.created_by,
      createdById: row.created_by_id,
      updatedBy: row.updated_by,
      updatedById: row.updated_by_id,
      completedAt: row.completed_at,
      trouble: row.trouble,
      troubleCodeId: row.trouble_code_id,
      notes: row.notes,
      attachments: row.attachments,
      oldMeterType: row.old_meter_type,
      oldMeterTypeId: row.old_meter_type_id,
      newMeterType: row.new_meter_type,
      newMeterTypeId: row.new_meter_type_id,
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
      serviceTypeId: row.service_type_id,
      oldMeterId: row.old_meter_id,
      oldMeterReading: row.old_meter_reading,
      newMeterId: row.new_meter_id,
      newMeterReading: row.new_meter_reading,
      oldGps: row.old_gps,
      newGps: row.new_gps,
      status: row.status,
      statusId: row.status_id,
      scheduledDate: row.scheduled_date,
      assignedUserId: row.assigned_user_id,
      assignedGroupId: row.assigned_group_id,
      createdBy: row.created_by,
      createdById: row.created_by_id,
      updatedBy: row.updated_by,
      updatedById: row.updated_by_id,
      completedAt: row.completed_at,
      trouble: row.trouble,
      troubleCodeId: row.trouble_code_id,
      notes: row.notes,
      attachments: row.attachments,
      oldMeterType: row.old_meter_type,
      oldMeterTypeId: row.old_meter_type_id,
      newMeterType: row.new_meter_type,
      newMeterTypeId: row.new_meter_type_id,
      signatureData: row.signature_data,
      signatureName: row.signature_name,
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
           (customer_wo_id, customer_id, customer_name, address, city, state, zip, phone, email, route, zone, service_type, service_type_id, old_meter_id, old_meter_reading, new_meter_id, new_meter_reading, old_gps, new_gps, status, status_id, scheduled_date, assigned_user_id, assigned_group_id, created_by, created_by_id, updated_by, updated_by_id, completed_at, trouble, trouble_code_id, notes, attachments, old_meter_type, old_meter_type_id, new_meter_type, new_meter_type_id, signature_data, signature_name)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39)`,
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
            wo.serviceTypeId || null,
            wo.oldMeterId || null,
            wo.oldMeterReading ?? null,
            wo.newMeterId || null,
            wo.newMeterReading ?? null,
            wo.oldGps || null,
            wo.newGps || null,
            wo.status || "Open",
            wo.statusId || null,
            wo.scheduledDate || null,
            wo.assignedUserId || null,
            wo.assignedGroupId || null,
            wo.createdBy || null,
            wo.createdById || null,
            wo.updatedBy || null,
            wo.updatedById || null,
            wo.completedAt || null,
            wo.trouble || null,
            wo.troubleCodeId || null,
            wo.notes || null,
            wo.attachments || null,
            wo.oldMeterType || wo.meterType || null,
            wo.oldMeterTypeId || null,
            wo.newMeterType || null,
            wo.newMeterTypeId || null,
            wo.signatureData || null,
            wo.signatureName || null,
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
