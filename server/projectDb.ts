import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, varchar, timestamp, integer } from "drizzle-orm/pg-core";
import { pool } from "./db";
import { sql } from "drizzle-orm";
import { storage } from "./storage";

// Service type enum for work orders
export const serviceTypeEnum = ["Water", "Electric", "Gas"] as const;
export type ServiceType = (typeof serviceTypeEnum)[number];

// Work orders schema for project databases (within project-specific schemas)
// Canonical schema matching Aurora project structure (36 columns)
export const projectWorkOrders = pgTable("work_orders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  status: varchar("status", { length: 50 }).notNull().default("Open"),
  createdBy: varchar("created_by", { length: 100 }),
  completedAt: timestamp("completed_at"),
  notes: text("notes"),
  attachments: text("attachments").array(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  customerWoId: varchar("customer_wo_id", { length: 100 }).unique(),
  customerId: varchar("customer_id", { length: 100 }),
  customerName: varchar("customer_name", { length: 100 }),
  address: varchar("address", { length: 500 }),
  city: varchar("city", { length: 100 }),
  state: varchar("state", { length: 50 }),
  zip: varchar("zip", { length: 20 }),
  phone: varchar("phone", { length: 50 }),
  email: varchar("email", { length: 100 }),
  route: varchar("route", { length: 100 }),
  zone: varchar("zone", { length: 100 }),
  serviceType: varchar("service_type", { length: 50 }),
  oldMeterId: varchar("old_meter_id", { length: 100 }),
  newMeterId: varchar("new_meter_id", { length: 100 }),
  oldGps: varchar("old_gps", { length: 100 }),
  newGps: varchar("new_gps", { length: 100 }),
  oldMeterReading: integer("old_meter_reading"),
  newMeterReading: integer("new_meter_reading"),
  scheduledAt: timestamp("scheduled_at"),
  updatedBy: varchar("updated_by", { length: 100 }),
  trouble: varchar("trouble", { length: 50 }),
  oldMeterType: varchar("old_meter_type", { length: 100 }),
  newMeterType: varchar("new_meter_type", { length: 100 }),
  signatureData: text("signature_data"),
  signatureName: varchar("signature_name", { length: 100 }),
  assignedUserId: varchar("assigned_user_id", { length: 50 }),
  assignedGroupId: varchar("assigned_group_id", { length: 100 }),
  completedBy: varchar("completed_by", { length: 50 }),
  scheduledBy: varchar("scheduled_by", { length: 50 }),
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
    
    // Create work_orders table in the project schema (canonical Aurora structure - 36 columns)
    await client.query(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".work_orders (
        id SERIAL PRIMARY KEY,
        status VARCHAR(50) NOT NULL DEFAULT 'Open',
        created_by VARCHAR(100) DEFAULT CURRENT_USER,
        completed_at TIMESTAMP,
        notes TEXT,
        attachments TEXT[],
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        customer_wo_id VARCHAR(100) UNIQUE,
        customer_id VARCHAR(100),
        customer_name VARCHAR(100),
        address VARCHAR(500),
        city VARCHAR(100),
        state VARCHAR(50),
        zip VARCHAR(20),
        phone VARCHAR(50),
        email VARCHAR(100),
        route VARCHAR(100),
        zone VARCHAR(100),
        service_type VARCHAR(50),
        old_meter_id VARCHAR(100),
        new_meter_id VARCHAR(100),
        old_gps VARCHAR(100),
        new_gps VARCHAR(100),
        old_meter_reading INTEGER,
        new_meter_reading INTEGER,
        scheduled_at TIMESTAMP,
        updated_by VARCHAR(100),
        trouble VARCHAR(50),
        old_meter_type VARCHAR(100),
        new_meter_type VARCHAR(100),
        signature_data TEXT,
        signature_name VARCHAR(100),
        assigned_user_id VARCHAR(50),
        assigned_group_id VARCHAR(100),
        completed_by VARCHAR(50),
        scheduled_by VARCHAR(50),
        CONSTRAINT fk_status_code FOREIGN KEY (status) REFERENCES public.work_order_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_service_types FOREIGN KEY (service_type) REFERENCES public.service_types(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_trouble_code FOREIGN KEY (trouble) REFERENCES public.trouble_codes(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_old_meter_type FOREIGN KEY (old_meter_type) REFERENCES public.meter_types(product_id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_new_meter_type FOREIGN KEY (new_meter_type) REFERENCES public.meter_types(product_id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_assigned_user FOREIGN KEY (assigned_user_id) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_assigned_group FOREIGN KEY (assigned_group_id) REFERENCES public.user_groups(name) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_created_by FOREIGN KEY (created_by) REFERENCES public.users(username) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_updated_by FOREIGN KEY (updated_by) REFERENCES public.users(username) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_completed_by FOREIGN KEY (completed_by) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_scheduled_by FOREIGN KEY (scheduled_by) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE
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

// Migrate existing project schema to canonical Aurora structure (36 columns)
export async function migrateProjectSchema(schemaName: string): Promise<void> {
  const client = await pool.connect();
  try {
    console.log(`Starting migration of ${schemaName} to canonical Aurora schema...`);
    
    // Step 1: Add new columns that don't exist
    const newColumns = [
      { name: 'completed_by', type: 'VARCHAR(50)' },
      { name: 'scheduled_by', type: 'VARCHAR(50)' },
      { name: 'signature_data', type: 'TEXT' },
      { name: 'signature_name', type: 'VARCHAR(100)' },
      { name: 'trouble', type: 'VARCHAR(50)' },
    ];
    
    for (const col of newColumns) {
      await client.query(`
        ALTER TABLE "${schemaName}".work_orders 
        ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}
      `);
    }
    
    // Step 2: Handle scheduled_date -> scheduled_at rename
    const scheduledDateCheck = await client.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'work_orders' 
      AND column_name = 'scheduled_date'
    `, [schemaName]);
    
    if (scheduledDateCheck.rows.length > 0) {
      // Check if scheduled_at already exists
      const scheduledAtExists = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = 'work_orders' 
        AND column_name = 'scheduled_at'
      `, [schemaName]);
      
      if (scheduledAtExists.rows.length === 0) {
        await client.query(`
          ALTER TABLE "${schemaName}".work_orders 
          RENAME COLUMN scheduled_date TO scheduled_at
        `);
        console.log(`Renamed scheduled_date to scheduled_at for ${schemaName}`);
      }
    }
    
    // Step 3: Handle old_meter_type/new_meter_type type changes (INTEGER -> VARCHAR for product_id FK)
    const meterTypeCheck = await client.query(`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'work_orders' 
      AND column_name IN ('old_meter_type', 'new_meter_type')
    `, [schemaName]);
    
    for (const col of meterTypeCheck.rows) {
      if (col.data_type === 'integer') {
        // Drop FK constraint before type change
        const fkName = col.column_name === 'old_meter_type' ? 'fk_old_meter_type' : 'fk_new_meter_type';
        await client.query(`
          ALTER TABLE "${schemaName}".work_orders 
          DROP CONSTRAINT IF EXISTS ${fkName} CASCADE
        `);
        // Convert INTEGER (id) to VARCHAR (product_id) using lookup
        await client.query(`
          ALTER TABLE "${schemaName}".work_orders 
          ALTER COLUMN ${col.column_name} TYPE VARCHAR(100) USING 
            (SELECT product_id FROM public.meter_types WHERE id = ${col.column_name})
        `);
        console.log(`Converted ${col.column_name} from INTEGER to VARCHAR (product_id) for ${schemaName}`);
      }
    }
    
    // Step 4: Handle assigned_group_id type change (INTEGER -> VARCHAR with name lookup)
    const groupIdCheck = await client.query(`
      SELECT data_type FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'work_orders' 
      AND column_name = 'assigned_group_id'
    `, [schemaName]);
    
    if (groupIdCheck.rows.length > 0 && groupIdCheck.rows[0].data_type === 'integer') {
      // Drop existing FK constraint before type change
      await client.query(`
        ALTER TABLE "${schemaName}".work_orders 
        DROP CONSTRAINT IF EXISTS fk_assigned_group CASCADE
      `);
      // Convert integer ID to group name using lookup
      await client.query(`
        ALTER TABLE "${schemaName}".work_orders 
        ALTER COLUMN assigned_group_id TYPE VARCHAR(100) USING 
          (SELECT name FROM public.user_groups WHERE id = assigned_group_id)
      `);
      console.log(`Converted assigned_group_id from INTEGER to group name for ${schemaName}`);
    }
    
    // Step 5: Drop deprecated _id suffix columns (consolidate to text-based references)
    const deprecatedColumns = [
      'service_type_id', 'status_id', 'created_by_id', 'updated_by_id', 
      'trouble_code_id', 'old_meter_type_id', 'new_meter_type_id'
    ];
    
    for (const colName of deprecatedColumns) {
      const colExists = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = 'work_orders' 
        AND column_name = $2
      `, [schemaName, colName]);
      
      if (colExists.rows.length > 0) {
        // Drop any FK constraints first
        await client.query(`
          ALTER TABLE "${schemaName}".work_orders 
          DROP COLUMN IF EXISTS ${colName} CASCADE
        `);
        console.log(`Dropped deprecated column ${colName} from ${schemaName}.work_orders`);
      }
    }
    
    // Step 6: Drop old assigned_to column if it exists
    await client.query(`
      ALTER TABLE "${schemaName}".work_orders 
      DROP COLUMN IF EXISTS assigned_to CASCADE
    `);
    
    // Step 7: Add/update foreign key constraints matching Aurora
    const fkConstraints = [
      { column: 'status', ref_table: 'public.work_order_statuses', ref_column: 'code', constraint_name: 'fk_status_code' },
      { column: 'service_type', ref_table: 'public.service_types', ref_column: 'code', constraint_name: 'fk_service_types' },
      { column: 'trouble', ref_table: 'public.trouble_codes', ref_column: 'code', constraint_name: 'fk_trouble_code' },
      { column: 'old_meter_type', ref_table: 'public.meter_types', ref_column: 'product_id', constraint_name: 'fk_old_meter_type' },
      { column: 'new_meter_type', ref_table: 'public.meter_types', ref_column: 'product_id', constraint_name: 'fk_new_meter_type' },
      { column: 'assigned_user_id', ref_table: 'public.users', ref_column: 'id', constraint_name: 'fk_assigned_user' },
      { column: 'assigned_group_id', ref_table: 'public.user_groups', ref_column: 'name', constraint_name: 'fk_assigned_group' },
      { column: 'created_by', ref_table: 'public.users', ref_column: 'username', constraint_name: 'fk_created_by' },
      { column: 'updated_by', ref_table: 'public.users', ref_column: 'username', constraint_name: 'fk_updated_by' },
      { column: 'completed_by', ref_table: 'public.users', ref_column: 'id', constraint_name: 'fk_completed_by' },
      { column: 'scheduled_by', ref_table: 'public.users', ref_column: 'id', constraint_name: 'fk_scheduled_by' },
    ];
    
    for (const fk of fkConstraints) {
      try {
        // Check if column exists
        const colExists = await client.query(`
          SELECT column_name FROM information_schema.columns 
          WHERE table_schema = $1 AND table_name = 'work_orders' 
          AND column_name = $2
        `, [schemaName, fk.column]);
        
        if (colExists.rows.length === 0) {
          console.log(`Column ${fk.column} does not exist, skipping FK ${fk.constraint_name}`);
          continue;
        }
        
        // Drop existing constraint if exists
        await client.query(`
          ALTER TABLE "${schemaName}".work_orders 
          DROP CONSTRAINT IF EXISTS ${fk.constraint_name}
        `);
        
        // Add constraint with ON DELETE RESTRICT ON UPDATE CASCADE
        await client.query(`
          ALTER TABLE "${schemaName}".work_orders 
          ADD CONSTRAINT ${fk.constraint_name} 
          FOREIGN KEY (${fk.column}) REFERENCES ${fk.ref_table}(${fk.ref_column}) ON DELETE RESTRICT ON UPDATE CASCADE
        `);
        console.log(`Added FK constraint ${fk.constraint_name} to ${schemaName}.work_orders`);
      } catch (fkError) {
        console.log(`FK constraint ${fk.constraint_name} for ${schemaName}: ${fkError}`);
      }
    }
    
    console.log(`Migration completed for ${schemaName}.work_orders to canonical Aurora schema`);
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

  async getWorkOrders(filters?: { status?: string; assignedUserId?: string; assignedGroupId?: string | number }): Promise<ProjectWorkOrder[]> {
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
        // Resolve group ID/name to group name for filtering (FK references user_groups.name)
        const resolvedGroupName = await this.resolveGroupName(filters.assignedGroupId);
        if (resolvedGroupName) {
          conditions.push(`assigned_group_id = $${paramCount++}`);
          values.push(resolvedGroupName);
        }
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
      // If scheduledAt is set, auto-set status to "Scheduled"
      let status = workOrder.status || "Open";
      if (workOrder.scheduledAt) {
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
      
      // Get assigned user/group IDs directly from the work order
      const assignedUserId = workOrder.assignedUserId || null;
      // Resolve group ID/name to group name (FK references user_groups.name)
      const assignedGroupId = await this.resolveGroupName(workOrder.assignedGroupId);
      
      // Resolve created_by to username for FK
      const createdByValue = createdBy || workOrder.createdBy || null;
      
      // Set completedAt if status is a "Completed" type status
      const isCompleted = await this.isCompletedStatus(status);
      const completedAt = isCompleted ? new Date() : null;
      const completedBy = isCompleted && createdBy ? await this.resolveUserId(createdBy) : null;
      
      // Resolve scheduledBy if scheduling
      const scheduledBy = workOrder.scheduledAt && createdBy ? await this.resolveUserId(createdBy) : null;
      
      const result = await client.query(
        `INSERT INTO "${this.schemaName}".work_orders 
         (status, created_by, completed_at, notes, attachments, customer_wo_id, customer_id, customer_name, address, city, state, zip, phone, email, route, zone, service_type, old_meter_id, new_meter_id, old_gps, new_gps, old_meter_reading, new_meter_reading, scheduled_at, updated_by, trouble, old_meter_type, new_meter_type, signature_data, signature_name, assigned_user_id, assigned_group_id, completed_by, scheduled_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)
         RETURNING *`,
        [
          status,
          createdByValue,
          completedAt,
          notes,
          workOrder.attachments || null,
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
          workOrder.newMeterId || null,
          workOrder.oldGps || null,
          workOrder.newGps || null,
          workOrder.oldMeterReading ?? null,
          workOrder.newMeterReading ?? null,
          workOrder.scheduledAt || null,
          createdByValue,
          troubleCode || null,
          workOrder.oldMeterType ?? null,
          workOrder.newMeterType ?? null,
          (workOrder as any).signatureData || null,
          (workOrder as any).signatureName || null,
          assignedUserId,
          assignedGroupId,
          completedBy,
          scheduledBy,
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
  
  private async resolveGroupName(groupIdOrName: string | number | null | undefined): Promise<string | null> {
    if (!groupIdOrName) return null;
    try {
      const groups = await storage.getAllUserGroups();
      if (typeof groupIdOrName === 'number') {
        const found = groups.find(g => g.id === groupIdOrName);
        return found?.name || null;
      }
      const numericId = parseInt(String(groupIdOrName), 10);
      if (!isNaN(numericId)) {
        const found = groups.find(g => g.id === numericId);
        if (found) return found.name;
      }
      const foundByName = groups.find(g => g.name === groupIdOrName);
      return foundByName?.name || null;
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
      let scheduledNoteToAdd: string | null = null;
      let completedNoteToAdd: string | null = null;
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
      // Handle scheduledAt and status together for proper auto-scheduling behavior
      if (updates.scheduledAt !== undefined) {
        setClauses.push(`scheduled_at = $${paramCount++}`);
        values.push(updates.scheduledAt || null);
        
        // If scheduledAt is being SET (not cleared), auto-set status to "Scheduled"
        if (updates.scheduledAt) {
          setClauses.push(`status = $${paramCount++}`);
          values.push("Scheduled");
          if (updatedBy) {
            const scheduledByUserId = await this.resolveUserId(updatedBy);
            setClauses.push(`scheduled_by = $${paramCount++}`);
            values.push(scheduledByUserId);
          }
          // Add scheduled note
          const timestamp = await this.getTimezoneFormattedTimestamp();
          scheduledNoteToAdd = `Scheduled at ${timestamp} by ${updatedBy || 'System'}`;
        } else {
          // scheduledAt is being CLEARED - use the status from the update if provided
          setClauses.push(`scheduled_by = NULL`);
          if (updates.status !== undefined && !forceStatusToTrouble) {
            setClauses.push(`status = $${paramCount++}`);
            values.push(updates.status);
            // Check if this status is a "Completed" type
            const isCompleted = await this.isCompletedStatus(updates.status);
            if (isCompleted) {
              setClauses.push(`completed_at = NOW()`);
              const timestamp = await this.getTimezoneFormattedTimestamp();
              completedNoteToAdd = `Completed at ${timestamp} by ${updatedBy || 'System'}`;
              if (updatedBy) {
                const completedByUserId = await this.resolveUserId(updatedBy);
                setClauses.push(`completed_by = $${paramCount++}`);
                values.push(completedByUserId);
              }
            }
          }
        }
      } else if (forceStatusToTrouble) {
        // Handle status - if trouble code is set, force status to "Trouble"
        setClauses.push(`status = $${paramCount++}`);
        values.push("Trouble");
      } else if (updates.status !== undefined) {
        // scheduledAt was not in this update, handle status normally
        setClauses.push(`status = $${paramCount++}`);
        values.push(updates.status);
        // Check if this is a "Scheduled" status and add scheduled note
        if (updates.status === "Scheduled") {
          const timestamp = await this.getTimezoneFormattedTimestamp();
          scheduledNoteToAdd = `Scheduled at ${timestamp} by ${updatedBy || 'System'}`;
          if (updatedBy) {
            const scheduledByUserId = await this.resolveUserId(updatedBy);
            setClauses.push(`scheduled_by = $${paramCount++}`);
            values.push(scheduledByUserId);
          }
        }
        // Check if this status is a "Completed" type and set completed_at and completed_by
        const isCompleted = await this.isCompletedStatus(updates.status);
        if (isCompleted) {
          setClauses.push(`completed_at = NOW()`);
          // Add completed note
          const timestamp = await this.getTimezoneFormattedTimestamp();
          completedNoteToAdd = `Completed at ${timestamp} by ${updatedBy || 'System'}`;
          if (updatedBy) {
            const completedByUserId = await this.resolveUserId(updatedBy);
            setClauses.push(`completed_by = $${paramCount++}`);
            values.push(completedByUserId);
          }
        }
        // If status is changing away from "Scheduled", clear scheduledAt and related fields
        if (updates.status !== "Scheduled") {
          setClauses.push(`scheduled_at = NULL`);
          setClauses.push(`scheduled_by = NULL`);
        }
      }
      if ((updates as any).trouble !== undefined) {
        setClauses.push(`trouble = $${paramCount++}`);
        values.push((updates as any).trouble || null);
      }
      // Handle notes - append trouble, scheduled, and completed notes if needed
      const notesToAppend: string[] = [];
      if (scheduledNoteToAdd) notesToAppend.push(scheduledNoteToAdd);
      if (completedNoteToAdd) notesToAppend.push(completedNoteToAdd);
      if (troubleNoteToAdd) notesToAppend.push(troubleNoteToAdd);
      
      if (notesToAppend.length > 0) {
        // We need to get existing notes and append the auto-generated notes
        const existingResult = await client.query(
          `SELECT notes FROM "${this.schemaName}".work_orders WHERE id = $1`,
          [id]
        );
        const existingNotes = existingResult.rows[0]?.notes || "";
        const updatedNotes = updates.notes !== undefined ? updates.notes : existingNotes;
        const autoNotes = notesToAppend.join('\n');
        const finalNotes = updatedNotes ? `${updatedNotes}\n${autoNotes}` : autoNotes;
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
        values.push((updates as any).oldMeterType ?? null);
      }
      if ((updates as any).newMeterType !== undefined) {
        setClauses.push(`new_meter_type = $${paramCount++}`);
        values.push((updates as any).newMeterType ?? null);
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
        // Resolve group ID/name to group name (FK references user_groups.name)
        const resolvedGroupName = await this.resolveGroupName(updates.assignedGroupId);
        setClauses.push(`assigned_group_id = $${paramCount++}`);
        values.push(resolvedGroupName);
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
      status: row.status,
      createdBy: row.created_by,
      completedAt: row.completed_at,
      notes: row.notes,
      attachments: row.attachments,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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
      newMeterId: row.new_meter_id,
      oldGps: row.old_gps,
      newGps: row.new_gps,
      oldMeterReading: row.old_meter_reading,
      newMeterReading: row.new_meter_reading,
      scheduledAt: row.scheduled_at,
      updatedBy: row.updated_by,
      trouble: row.trouble,
      oldMeterType: row.old_meter_type,
      newMeterType: row.new_meter_type,
      signatureData: row.signature_data,
      signatureName: row.signature_name,
      assignedUserId: row.assigned_user_id,
      assignedGroupId: row.assigned_group_id,
      completedBy: row.completed_by,
      scheduledBy: row.scheduled_by,
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
      status: row.status,
      createdBy: row.created_by,
      completedAt: row.completed_at,
      notes: row.notes,
      attachments: row.attachments,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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
      newMeterId: row.new_meter_id,
      oldGps: row.old_gps,
      newGps: row.new_gps,
      oldMeterReading: row.old_meter_reading,
      newMeterReading: row.new_meter_reading,
      scheduledAt: row.scheduled_at,
      updatedBy: row.updated_by,
      trouble: row.trouble,
      oldMeterType: row.old_meter_type,
      newMeterType: row.new_meter_type,
      signatureData: row.signature_data,
      signatureName: row.signature_name,
      assignedUserId: row.assigned_user_id,
      assignedGroupId: row.assigned_group_id,
      completedBy: row.completed_by,
      scheduledBy: row.scheduled_by,
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
           (status, created_by, completed_at, notes, attachments, customer_wo_id, customer_id, customer_name, address, city, state, zip, phone, email, route, zone, service_type, old_meter_id, new_meter_id, old_gps, new_gps, old_meter_reading, new_meter_reading, scheduled_at, updated_by, trouble, old_meter_type, new_meter_type, signature_data, signature_name, assigned_user_id, assigned_group_id, completed_by, scheduled_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34)`,
          [
            wo.status || "Open",
            wo.createdBy || null,
            wo.completedAt || null,
            wo.notes || null,
            wo.attachments || null,
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
            wo.newMeterId || null,
            wo.oldGps || null,
            wo.newGps || null,
            wo.oldMeterReading ?? null,
            wo.newMeterReading ?? null,
            wo.scheduledAt || null,
            wo.updatedBy || null,
            wo.trouble || null,
            wo.oldMeterType ?? null,
            wo.newMeterType ?? null,
            wo.signatureData || null,
            wo.signatureName || null,
            wo.assignedUserId || null,
            wo.assignedGroupId || null,
            wo.completedBy || null,
            wo.scheduledBy || null,
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
