import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, varchar, timestamp, integer, numeric, uuid } from "drizzle-orm/pg-core";
import { pool } from "./db";
import { sql } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import { storage } from "./storage";
import { appendResetNote, resetAssignment, WorkOrderResetError, type ResetWorkOrderOptions } from "../shared/work-order-reset";
import { enqueueCustomerDelivery } from "./customerApiService";
import { initializeExactReadings } from "./exactReadingMigration";
import { installProjectAudit } from "./auditMigration";
import { auditedOperation, insertAuditEvent } from "./auditService";
import { auditingEnabled, auditContext } from "./auditContext";
import { exactReadingDto, exactReadingFields, capturedReadingText, readingParameter, withExactReadings } from "../shared/exact-readings";
import { inventoryWorkOrderChange, lockInventoryForSchema } from "./inventoryService";
import { acceptCompletion, assertClaimAllowed, canonicalStatus, ChangeoutError, submissionReplay } from "./changeoutService";
import { installChangeoutProject } from "./changeoutSchema";
import { exportInventory, restoreInventory, validateInventoryBackup, type InventoryBackup } from "./inventoryBackup";
import { installProjectSubStatuses, listSubStatuses, restoreSubStatusDefinitions } from "./workOrderSubStatuses";
import { migrateProjectTroubleCodeReferences, exportTroubleCodes, restoreTroubleCodes } from "./projectTroubleCodes";
import { exportProjectRouting, restoreProjectRouting } from "./routing/configuration";
import { installVisitScheduling, writeVisitScheduling } from "./visitScheduling";
import { schedulingDto, validateVisitScheduling, schedulingDefaultsSchema } from "../shared/visitScheduling";
import { installGpsColumns } from "./gpsSchema";
import { installWorkOrderLifecycle } from "./work-order-lifecycle/schema";
import { closingPolicySchema } from "./work-order-lifecycle/service";
import { gpsFixDto, gpsMetadataUpdate, completionGpsFix, validateGpsFix, gpsAccuracyError, reusedOldGpsFix, sameCoordinates, type GpsFix } from "../shared/gps-capture";

async function requireGpsAccuracy(client: Pick<PoolClient, "query">, schema: string, fix: GpsFix | null, oldGps?: string | null) {
  const { rows: [configuration] } = await client.query(
    "SELECT wizard_gps_mode,wizard_gps_max_accuracy_metres,wizard_reuse_old_gps FROM public.projects WHERE database_name=$1", [schema]);
  if (fix?.source === "reused_old") {
    const authorized = reusedOldGpsFix({ wizardReuseOldGps: configuration?.wizard_reuse_old_gps }, { oldGps });
    if (authorized && sameCoordinates(authorized.coordinates, fix.coordinates)) return;
    throw Object.assign(new Error("Old GPS reuse is not authorized for these coordinates."), { status: 400, code: "GPS_CAPTURE" });
  }
  if (configuration?.wizard_gps_mode === "disabled") return;
  const message = gpsAccuracyError(fix, configuration?.wizard_gps_max_accuracy_metres);
  if (message) throw Object.assign(new Error(message), { status: 400, code: "GPS_ACCURACY" });
}

async function writeGpsCapture(client: Pick<PoolClient, "query">, schema: string, id: number, capture: unknown, coordinates: unknown) {
  if (capture == null) return;
  const fix = validateGpsFix(capture, coordinates)!;
  await client.query(`UPDATE "${schema}".work_orders SET gps_source=$2,gps_accuracy=$3,gps_captured_at=$4,gps_receiver=$5 WHERE id=$1`,
    [id, fix.source, fix.accuracy, fix.capturedAt, fix.receiver]);
}

function readingSetClauses(column: string, valueIndex: number, textIndex: number) {
  // Old clients may echo a rounded numeric compatibility field. Preserve the
  // underlying exact value/text when that echo matches its legacy float view.
  const legacyEcho = `CASE WHEN $${textIndex}::text IS NULL AND $${valueIndex}::numeric IS NOT NULL THEN
    CASE WHEN abs(${column}::numeric)<=1e308 AND abs($${valueIndex}::numeric)<=1e308
      THEN ${column}::double precision IS NOT DISTINCT FROM $${valueIndex}::double precision
      ELSE false END ELSE false END`;
  return [
    `${column}=CASE WHEN ${legacyEcho} THEN ${column}::numeric ELSE $${valueIndex}::numeric END`,
    `${column}_text=CASE WHEN ${legacyEcho} THEN ${column}_text ELSE $${textIndex}::text END`,
  ];
}

// Work orders schema for project databases (within project-specific schemas)
// Canonical schema matching Aurora project structure (36 columns)
export const projectWorkOrders = pgTable("work_orders", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  status: varchar("status", { length: 50 }).notNull().default("Open"),
  subStatusId: uuid("sub_status_id"),
  createdBy: varchar("created_by", { length: 100 }),
  completedAt: timestamp("completed_at"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  closedBy: varchar("closed_by", { length: 100 }),
  reviewStartedAt: timestamp("review_started_at", { withTimezone: true }),
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
  oldSystemId: varchar("old_system_id", { length: 100 }),
  newSystemId: varchar("new_system_id", { length: 100 }),
  oldGps: varchar("old_gps", { length: 100 }),
  newGps: varchar("new_gps", { length: 100 }),
  gpsSource: varchar("gps_source", { length: 20 }),
  gpsAccuracy: numeric("gps_accuracy"),
  gpsCapturedAt: timestamp("gps_captured_at", { withTimezone: true }),
  gpsReceiver: varchar("gps_receiver", { length: 20 }),
  oldSystemReading: numeric("old_system_reading"),
  newSystemReading: numeric("new_system_reading"),
  scheduledAt: timestamp("scheduled_at"),
  serviceDurationMinutes: integer("service_duration_minutes"),
  appointmentWindowStart: timestamp("appointment_window_start", { withTimezone: true }),
  appointmentWindowEnd: timestamp("appointment_window_end", { withTimezone: true }),
  updatedBy: varchar("updated_by", { length: 100 }),
  // Permanent trouble_codes.rule_key; Code/Name are editable catalog values.
  trouble: uuid("trouble"),
  oldSystemType: varchar("old_system_type", { length: 100 }),
  newSystemType: varchar("new_system_type", { length: 100 }),
  oldModuleId: varchar("old_module_id", { length: 100 }),
  newModuleId: varchar("new_module_id", { length: 100 }),
  oldModuleRead: numeric("old_module_read"),
  newModuleRead: numeric("new_module_read"),
  oldSystemReadingText: text("old_system_reading_text"),
  newSystemReadingText: text("new_system_reading_text"),
  oldModuleReadText: text("old_module_read_text"),
  newModuleReadText: text("new_module_read_text"),
  oldModuleType: varchar("old_module_type", { length: 100 }),
  newModuleType: varchar("new_module_type", { length: 100 }),
  signatureData: text("signature_data"),
  signatureName: varchar("signature_name", { length: 100 }),
  assignedUserId: varchar("assigned_user_id", { length: 50 }),
  assignedGroupId: varchar("assigned_group_id", { length: 100 }),
  assignmentVersion: integer("assignment_version").notNull().default(0),
  completedBy: varchar("completed_by", { length: 50 }),
  scheduledBy: varchar("scheduled_by", { length: 50 }),
});

export type ProjectWorkOrder = Omit<typeof projectWorkOrders.$inferSelect, "gpsSource" | "gpsAccuracy" | "gpsCapturedAt" | "gpsReceiver"> & { gpsCapture?: GpsFix | null };
export type InsertProjectWorkOrder = typeof projectWorkOrders.$inferInsert & { gpsCapture?: GpsFix | null };

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
export async function createProjectSchema(projectName: string, projectId: number, schemaName = sanitizeSchemaName(projectName, projectId), connectionPool: Pick<Pool, "connect"> = pool): Promise<string> {
  if (!/^project_[a-z0-9_]+$/.test(schemaName)) throw new Error("Invalid project schema name.");
  
  const client = await connectionPool.connect();
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
        old_system_id VARCHAR(100),
        new_system_id VARCHAR(100),
        old_gps VARCHAR(100),
        new_gps VARCHAR(100),
        old_system_reading NUMERIC,
        new_system_reading NUMERIC,
        scheduled_at TIMESTAMP,
        updated_by VARCHAR(100),
        trouble UUID,
        old_system_type VARCHAR(100),
        new_system_type VARCHAR(100),
        old_module_id VARCHAR(100),
        new_module_id VARCHAR(100),
        old_module_read NUMERIC,
        new_module_read NUMERIC,
        old_module_type VARCHAR(100),
        new_module_type VARCHAR(100),
        signature_data TEXT,
        signature_name VARCHAR(100),
        assigned_user_id VARCHAR(50),
        assigned_group_id VARCHAR(100),
        completed_by VARCHAR(50),
        scheduled_by VARCHAR(50),
        CONSTRAINT fk_status_code FOREIGN KEY (status) REFERENCES public.work_order_statuses(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_service_types FOREIGN KEY (service_type) REFERENCES public.service_types(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_trouble_code FOREIGN KEY (trouble) REFERENCES public.trouble_codes(rule_key) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_old_system_type FOREIGN KEY (old_system_type) REFERENCES public.system_types(product_id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_new_system_type FOREIGN KEY (new_system_type) REFERENCES public.system_types(product_id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_old_module_type FOREIGN KEY (old_module_type) REFERENCES public.module_types(product_id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_new_module_type FOREIGN KEY (new_module_type) REFERENCES public.module_types(product_id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_assigned_user FOREIGN KEY (assigned_user_id) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_assigned_group FOREIGN KEY (assigned_group_id) REFERENCES public.user_groups(name) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_created_by FOREIGN KEY (created_by) REFERENCES public.users(username) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_updated_by FOREIGN KEY (updated_by) REFERENCES public.users(username) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_completed_by FOREIGN KEY (completed_by) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_scheduled_by FOREIGN KEY (scheduled_by) REFERENCES public.users(id) ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    
    // Add unique partial indexes for system and module IDs (only for non-null values)
    // These ensure no duplicate meters/modules are created within a project
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_old_system_id 
      ON "${schemaName}".work_orders (old_system_id) 
      WHERE old_system_id IS NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_new_system_id 
      ON "${schemaName}".work_orders (new_system_id) 
      WHERE new_system_id IS NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_old_module_id 
      ON "${schemaName}".work_orders (old_module_id) 
      WHERE old_module_id IS NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_new_module_id 
      ON "${schemaName}".work_orders (new_module_id) 
      WHERE new_module_id IS NOT NULL
    `);
    
    await initializeExactReadings(client,schemaName);
    await installProjectSubStatuses(client,schemaName);
    await migrateProjectTroubleCodeReferences(schemaName,connectionPool);
    await installVisitScheduling(client,schemaName);
    await installGpsColumns(client,schemaName);
    await installWorkOrderLifecycle(client,schemaName);
    await installChangeoutProject(client, schemaName);
    if (auditingEnabled) {
      await client.query(`INSERT INTO meterflo_audit.project_scopes(schema_name,project_id,project_label) VALUES($1,$2,$3)
        ON CONFLICT(schema_name) DO UPDATE SET project_id=EXCLUDED.project_id,project_label=EXCLUDED.project_label`,[schemaName,projectId,projectName]);
      await installProjectAudit(client,schemaName);
    }
    console.log(`Created project schema with unique ID indexes: ${schemaName}`);
    return schemaName;
  } finally {
    client.release();
  }
}

// Delete project schema
export async function deleteProjectSchema(schemaName: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    if (auditingEnabled) {
      const {rows:[scope]}=await client.query("SELECT project_id,project_label FROM meterflo_audit.project_scopes WHERE schema_name=$1",[schemaName]);
      await insertAuditEvent(client,{action:"schema.deleted",entityType:"projectSchema",entityId:String(scope?.project_id || ""),
        projectId:scope?.project_id,projectLabel:scope?.project_label});
    }
    await client.query("COMMIT");
    console.log(`Deleted project schema: ${schemaName}`);
  } catch(e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// Migrate existing project schema to canonical Aurora structure (36 columns)
export async function migrateProjectSchema(schemaName: string, connectionPool: Pick<Pool, "connect"> = pool): Promise<void> {
  const client = await connectionPool.connect();
  try {
    console.log(`Starting migration of ${schemaName} to canonical Aurora schema...`);
    
    // Step 1: Add new columns that don't exist
    const newColumns = [
      { name: 'completed_by', type: 'VARCHAR(50)' },
      { name: 'scheduled_by', type: 'VARCHAR(50)' },
      { name: 'signature_data', type: 'TEXT' },
      { name: 'signature_name', type: 'VARCHAR(100)' },
      { name: 'trouble', type: 'UUID' },
      { name: 'old_module_id', type: 'VARCHAR(100)' },
      { name: 'new_module_id', type: 'VARCHAR(100)' },
      { name: 'old_module_read', type: 'NUMERIC' },
      { name: 'new_module_read', type: 'NUMERIC' },
      { name: 'old_module_type', type: 'VARCHAR(100)' },
      { name: 'new_module_type', type: 'VARCHAR(100)' },
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
    
    // Step 3: Rename meter columns to system columns
    const meterToSystemRenames = [
      { old: 'old_meter_id', new: 'old_system_id' },
      { old: 'new_meter_id', new: 'new_system_id' },
      { old: 'old_meter_reading', new: 'old_system_reading' },
      { old: 'new_meter_reading', new: 'new_system_reading' },
      { old: 'old_meter_type', new: 'old_system_type' },
      { old: 'new_meter_type', new: 'new_system_type' },
    ];
    
    for (const rename of meterToSystemRenames) {
      const oldExists = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = 'work_orders' AND column_name = $2
      `, [schemaName, rename.old]);
      
      const newExists = await client.query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = 'work_orders' AND column_name = $2
      `, [schemaName, rename.new]);
      
      if (oldExists.rows.length > 0 && newExists.rows.length === 0) {
        // Drop old FK constraints before rename
        if (rename.old === 'old_meter_type') {
          await client.query(`ALTER TABLE "${schemaName}".work_orders DROP CONSTRAINT IF EXISTS fk_old_meter_type CASCADE`);
        } else if (rename.old === 'new_meter_type') {
          await client.query(`ALTER TABLE "${schemaName}".work_orders DROP CONSTRAINT IF EXISTS fk_new_meter_type CASCADE`);
        }
        await client.query(`ALTER TABLE "${schemaName}".work_orders RENAME COLUMN ${rename.old} TO ${rename.new}`);
        console.log(`Renamed ${rename.old} to ${rename.new} for ${schemaName}`);
      }
    }
    
    // Step 3b: Handle old_system_type/new_system_type type changes (INTEGER -> VARCHAR for product_id FK)
    const systemTypeCheck = await client.query(`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = 'work_orders' 
      AND column_name IN ('old_system_type', 'new_system_type')
    `, [schemaName]);
    
    for (const col of systemTypeCheck.rows) {
      if (col.data_type === 'integer') {
        // Drop FK constraint before type change
        const fkName = col.column_name === 'old_system_type' ? 'fk_old_system_type' : 'fk_new_system_type';
        await client.query(`
          ALTER TABLE "${schemaName}".work_orders 
          DROP CONSTRAINT IF EXISTS ${fkName} CASCADE
        `);
        // Convert INTEGER (id) to VARCHAR (product_id) using lookup
        await client.query(`
          ALTER TABLE "${schemaName}".work_orders 
          ALTER COLUMN ${col.column_name} TYPE VARCHAR(100) USING 
            (SELECT product_id FROM public.system_types WHERE id = ${col.column_name})
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
    
    // Step 4b: Migrate reading columns from INTEGER to NUMERIC (for decimal support)
    const readingColumns = ['old_system_reading', 'new_system_reading', 'old_module_read', 'new_module_read'];
    
    for (const colName of readingColumns) {
      const colCheck = await client.query(`
        SELECT data_type FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = 'work_orders' 
        AND column_name = $2
      `, [schemaName, colName]);
      
      if (colCheck.rows.length > 0 && colCheck.rows[0].data_type === 'integer') {
        // Convert INTEGER to NUMERIC (lossless conversion - integers become exact decimals)
        await client.query(`
          ALTER TABLE "${schemaName}".work_orders 
          ALTER COLUMN ${colName} TYPE NUMERIC USING ${colName}::NUMERIC
        `);
        console.log(`Converted ${colName} from INTEGER to NUMERIC for ${schemaName}`);
      }
    }
    
    await initializeExactReadings(client,schemaName);
    await installProjectSubStatuses(client,schemaName);
    await migrateProjectTroubleCodeReferences(schemaName,connectionPool);
    await installVisitScheduling(client,schemaName);
    await installGpsColumns(client,schemaName);
    await installWorkOrderLifecycle(client,schemaName);
    if (auditingEnabled) await installProjectAudit(client,schemaName);

    // Step 5: Drop deprecated _id suffix columns (consolidate to text-based references)
    const deprecatedColumns = [
      'service_type_id', 'status_id', 'created_by_id', 'updated_by_id', 
      'trouble_code_id', 'old_meter_type_id', 'new_meter_type_id', 'old_system_type_id', 'new_system_type_id'
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
      { column: 'trouble', ref_table: 'public.trouble_codes', ref_column: 'rule_key', constraint_name: 'fk_trouble_code' },
      { column: 'old_system_type', ref_table: 'public.system_types', ref_column: 'product_id', constraint_name: 'fk_old_system_type' },
      { column: 'new_system_type', ref_table: 'public.system_types', ref_column: 'product_id', constraint_name: 'fk_new_system_type' },
      { column: 'old_module_type', ref_table: 'public.module_types', ref_column: 'product_id', constraint_name: 'fk_old_module_type' },
      { column: 'new_module_type', ref_table: 'public.module_types', ref_column: 'product_id', constraint_name: 'fk_new_module_type' },
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
    // Never serve a partially migrated project as if its references were valid.
    throw error;
  } finally {
    client.release();
  }
  
  // Step 8: Add unique partial indexes for system and module IDs (separate connection)
  // These ensure no duplicate meters/modules are created within a project
  const indexClient = await connectionPool.connect();
  try {
    await indexClient.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_old_system_id 
      ON "${schemaName}".work_orders (old_system_id) 
      WHERE old_system_id IS NOT NULL
    `);
    await indexClient.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_new_system_id 
      ON "${schemaName}".work_orders (new_system_id) 
      WHERE new_system_id IS NOT NULL
    `);
    await indexClient.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_old_module_id 
      ON "${schemaName}".work_orders (old_module_id) 
      WHERE old_module_id IS NOT NULL
    `);
    await indexClient.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_new_module_id 
      ON "${schemaName}".work_orders (new_module_id) 
      WHERE new_module_id IS NOT NULL
    `);
    console.log(`Added unique indexes for system and module IDs to ${schemaName}`);
  } catch (indexError: any) {
    // Log detailed error but don't crash - existing duplicates may need cleanup
    console.error(`[UNIQUE_INDEX_ERROR] Failed to create unique indexes for ${schemaName}:`, indexError.message);
    console.error(`[UNIQUE_INDEX_ERROR] This may indicate duplicate system/module IDs exist in the data.`);
    console.error(`[UNIQUE_INDEX_ERROR] Query the work_orders table for duplicates and resolve before retrying.`);
  } finally {
    indexClient.release();
  }
}

// Project work order storage class with schema-based isolation
export class ProjectWorkOrderStorage {
  private schemaName: string;
  private migrationPromise: Promise<void>;
  private cachedTimezone: string | null = null;

  constructor(schemaName: string) {
    this.schemaName = schemaName;
    // Run migration on instantiation
    this.migrationPromise = migrateProjectSchema(schemaName);
  }
  
  // Ensure migration has completed before any operation
  private async ensureMigrated(): Promise<void> {
    await this.migrationPromise;
  }

  async getWorkOrders(filters?: { status?: string; subStatusId?: string; assignedUserId?: string; assignedGroupId?: string | number }): Promise<ProjectWorkOrder[]> {
    await this.ensureMigrated();
    const client = await pool.connect();
    try {
      let query = `
        SELECT w.*, 
               sb.username as scheduled_by_username,
               cb.username as completed_by_username,
               au.first_name as assigned_user_first_name,
               au.last_name as assigned_user_last_name,
               au.username as assigned_user_username,
               au.email as assigned_user_email
        FROM "${this.schemaName}".work_orders w
        LEFT JOIN public.users sb ON w.scheduled_by = sb.id
        LEFT JOIN public.users cb ON w.completed_by = cb.id
        LEFT JOIN public.users au ON w.assigned_user_id = au.id
      `;
      const conditions: string[] = [];
      const values: any[] = [];
      let paramCount = 1;

      if (filters?.status) {
        conditions.push(`w.status = $${paramCount++}`);
        values.push(filters.status);
      }
      if (filters?.assignedUserId) {
        // Sub-status is an additional filter; the core status remains unchanged.
        conditions.push(`w.assigned_user_id = $${paramCount++}`);
        values.push(filters.assignedUserId);
      }
      if (filters?.subStatusId) {
        conditions.push(`w.sub_status_id = $${paramCount++}`);
        values.push(filters.subStatusId);
      }
      if (filters?.assignedGroupId) {
        // Resolve group ID/name to group name for filtering (FK references user_groups.name)
        const resolvedGroupName = await this.resolveGroupName(filters.assignedGroupId);
        if (resolvedGroupName) {
          conditions.push(`w.assigned_group_id = $${paramCount++}`);
          values.push(resolvedGroupName);
        }
      }

      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(" AND ")}`;
      }
      query += " ORDER BY w.created_at DESC";

      const result = await client.query(query, values);
      return result.rows.map((row) => this.mapRowToWorkOrder(row));
    } finally {
      client.release();
    }
  }

  async getWorkOrder(id: number): Promise<ProjectWorkOrder | undefined> {
    await this.ensureMigrated();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT w.*, 
                sb.username as scheduled_by_username,
                cb.username as completed_by_username,
                au.first_name as assigned_user_first_name,
                au.last_name as assigned_user_last_name,
                au.username as assigned_user_username,
                au.email as assigned_user_email
         FROM "${this.schemaName}".work_orders w
         LEFT JOIN public.users sb ON w.scheduled_by = sb.id
         LEFT JOIN public.users cb ON w.completed_by = cb.id
         LEFT JOIN public.users au ON w.assigned_user_id = au.id
         WHERE w.id = $1`,
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
        `SELECT w.*, 
                sb.username as scheduled_by_username,
                cb.username as completed_by_username,
                au.first_name as assigned_user_first_name,
                au.last_name as assigned_user_last_name,
                au.username as assigned_user_username,
                au.email as assigned_user_email
         FROM "${this.schemaName}".work_orders w
         LEFT JOIN public.users sb ON w.scheduled_by = sb.id
         LEFT JOIN public.users cb ON w.completed_by = cb.id
         LEFT JOIN public.users au ON w.assigned_user_id = au.id
         WHERE w.customer_wo_id = $1`,
        [customerWoId]
      );
      return result.rows[0] ? this.mapRowToWorkOrder(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  async getNextCustomerWoId(): Promise<string> {
    await this.ensureMigrated();
    const client = await pool.connect();
    try {
      // Find the maximum numeric customer_wo_id
      // Use NUMERIC for safe handling of large numbers and order by length then value
      const result = await client.query(
        `SELECT customer_wo_id as max_id
         FROM "${this.schemaName}".work_orders
         WHERE customer_wo_id ~ '^[0-9]+$'
         ORDER BY LENGTH(customer_wo_id) DESC, customer_wo_id DESC
         LIMIT 1`
      );
      
      const maxId = result.rows[0]?.max_id;
      
      if (maxId !== null && maxId !== undefined) {
        // Increment the max ID by 1 using BigInt for safety
        const nextId = BigInt(maxId) + BigInt(1);
        return String(nextId);
      } else {
        // No numeric IDs exist, generate a random 4-digit integer
        // Range: 1000 to 9999
        const randomId = Math.floor(1000 + Math.random() * 9000);
        return String(randomId);
      }
    } finally {
      client.release();
    }
  }

  async getWorkOrderByOldSystemId(oldSystemId: string): Promise<ProjectWorkOrder | undefined> {
    await this.ensureMigrated();
    const client = await pool.connect();
    try {
      const result = await client.query(
        `SELECT w.*, 
                sb.username as scheduled_by_username,
                cb.username as completed_by_username,
                au.first_name as assigned_user_first_name,
                au.last_name as assigned_user_last_name,
                au.username as assigned_user_username,
                au.email as assigned_user_email
         FROM "${this.schemaName}".work_orders w
         LEFT JOIN public.users sb ON w.scheduled_by = sb.id
         LEFT JOIN public.users cb ON w.completed_by = cb.id
         LEFT JOIN public.users au ON w.assigned_user_id = au.id
         WHERE w.old_system_id = $1`,
        [oldSystemId]
      );
      return result.rows[0] ? this.mapRowToWorkOrder(result.rows[0]) : undefined;
    } finally {
      client.release();
    }
  }

  async createWorkOrder(workOrder: Omit<InsertProjectWorkOrder, "id" | "createdAt" | "updatedAt">, createdBy?: string, ordinaryImport = false): Promise<ProjectWorkOrder> {
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
      
      // If trouble code is set, auto-set status to "Trouble" and add note with username
      if (troubleCode) {
        status = "Trouble";
        const troubleCodeDetails = await this.getTroubleCodeDetails(troubleCode);
        const timestamp = await this.getTimezoneFormattedTimestamp();
        const userName = createdBy || 'System';
        let troubleNote: string;
        if (troubleCodeDetails) {
          troubleNote = `Trouble Code: ${troubleCodeDetails.code} - ${troubleCodeDetails.label} - ${timestamp} by ${userName}`;
          troubleCodeId = troubleCodeDetails.id;
        } else {
          // Fallback: use the code value directly if lookup fails
          troubleNote = `Trouble Code: ${troubleCode} - ${timestamp} by ${userName}`;
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
      await client.query("BEGIN");
      await lockInventoryForSchema(client, this.schemaName);
      if (status === "Completed" && !ordinaryImport)
        await requireGpsAccuracy(client, this.schemaName, validateGpsFix(workOrder.gpsCapture, workOrder.newGps), workOrder.oldGps);
      const result = await client.query(
        `INSERT INTO "${this.schemaName}".work_orders 
         (status, created_by, completed_at, notes, attachments, customer_wo_id, customer_id, customer_name, address, city, state, zip, phone, email, route, zone, service_type, old_system_id, new_system_id, old_gps, new_gps, old_system_reading, new_system_reading, scheduled_at, updated_by, trouble, old_system_type, new_system_type, old_module_id, new_module_id, old_module_read, new_module_read, old_module_type, new_module_type, signature_data, signature_name, assigned_user_id, assigned_group_id, completed_by, scheduled_by,old_system_reading_text,new_system_reading_text,old_module_read_text,new_module_read_text)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,$41,$42,$43,$44)
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
          workOrder.oldSystemId || null,
          workOrder.newSystemId || null,
          workOrder.oldGps || null,
          workOrder.newGps || null,
          readingParameter(workOrder.oldSystemReading),
          readingParameter(workOrder.newSystemReading),
          workOrder.scheduledAt || null,
          createdByValue,
          troubleCode || null,
          workOrder.oldSystemType ?? null,
          workOrder.newSystemType ?? null,
          (workOrder as any).oldModuleId || null,
          (workOrder as any).newModuleId || null,
          readingParameter(workOrder.oldModuleRead),
          readingParameter(workOrder.newModuleRead),
          (workOrder as any).oldModuleType || null,
          (workOrder as any).newModuleType || null,
          (workOrder as any).signatureData || null,
          (workOrder as any).signatureName || null,
          assignedUserId,
          assignedGroupId,
          completedBy,
          scheduledBy,
          ...exactReadingFields.map(({key}) => capturedReadingText(workOrder[key])),
        ]
      );
      
      // Re-fetch with JOINs to get display fields (scheduledByDisplay, completedByDisplay)
      const createdId = result.rows[0].id;
      await writeVisitScheduling(client, this.schemaName, createdId, workOrder);
      await writeGpsCapture(client, this.schemaName, createdId, workOrder.gpsCapture, workOrder.newGps);
      if (workOrder.subStatusId)
        await client.query(`UPDATE "${this.schemaName}".work_orders SET sub_status_id=$1 WHERE id=$2`, [workOrder.subStatusId,createdId]);
      await inventoryWorkOrderChange(client, this.schemaName, null, result.rows[0], undefined, (workOrder as any).inventoryItems, ordinaryImport);
      await client.query("COMMIT");
      return await this.getWorkOrder(createdId) as ProjectWorkOrder;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  
  private async getTroubleCodeDetails(troubleCodeValue: string): Promise<{ id: number; code: string; label: string } | null> {
    try {
      const project = await pool.query("SELECT id FROM public.projects WHERE database_name=$1", [this.schemaName]);
      const troubleCodes = await storage.getTroubleCodes(project.rows[0]?.id);
      const found = troubleCodes.find(tc => tc.ruleKey === troubleCodeValue);
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
  
  private async resolveSystemTypeId(systemTypeLabel: string): Promise<number | null> {
    try {
      const systemTypes = await storage.getSystemTypes();
      const found = systemTypes.find(m => m.productLabel === systemTypeLabel || m.productId === systemTypeLabel);
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
  
  private async resolveUserName(userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    try {
      const users = await storage.getAllUsers();
      const found = users.find(u => u.id === userId);
      return found?.username || null;
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

  // Get the project's timezone from the schemaName (cached for performance)
  // SchemaName format: project_{sanitized_name}_{id}
  private async getProjectTimezone(): Promise<string> {
    // Return cached timezone if available
    if (this.cachedTimezone !== null) {
      return this.cachedTimezone;
    }
    
    try {
      // Extract project ID from schemaName (last part after final underscore)
      const parts = this.schemaName.split('_');
      const projectId = parseInt(parts[parts.length - 1], 10);
      
      if (!isNaN(projectId)) {
        const project = await storage.getProject(projectId);
        if (project?.timezone) {
          this.cachedTimezone = project.timezone;
          return this.cachedTimezone;
        }
      }
    } catch (error) {
      console.error('Failed to get project timezone:', error);
    }
    // Default to UTC if no project timezone is set
    this.cachedTimezone = 'UTC';
    return this.cachedTimezone;
  }

  private async getTimezoneFormattedTimestamp(): Promise<string> {
    const timezone = await this.getProjectTimezone();
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

  private async formatDateToTimezone(date: Date): Promise<string> {
    const timezone = await this.getProjectTimezone();
    return date.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone
    });
  }

  // Format scheduledAt for notes - matches how frontend displays it
  // The frontend sends datetime-local values as "YYYY-MM-DDTHH:mm" (local time without timezone)
  // We should format this directly without re-interpreting through Date (which would assume UTC)
  private async formatScheduledAtForNote(scheduledAt: string | Date): Promise<string> {
    const timezone = await this.getProjectTimezone();
    
    if (typeof scheduledAt === 'string') {
      // Handle datetime-local format: "2026-01-01T11:40" (no timezone suffix)
      if (scheduledAt.includes('T') && !scheduledAt.includes('Z') && !scheduledAt.includes('+')) {
        // datetime-local format without timezone - parse directly (user's intended local time)
        const [datePart, timePart] = scheduledAt.split('T');
        const [year, month, day] = datePart.split('-');
        const [hours, minutes] = timePart.split(':');
        
        const hour = parseInt(hours, 10);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const hour12 = hour % 12 || 12;
        
        return `${month}/${day}/${year} ${hour12.toString().padStart(2, '0')}:${minutes} ${ampm}`;
      }
    }
    
    // Fallback for Date objects or ISO strings with timezone (Z or +offset)
    // These need to be converted to the project timezone
    const date = typeof scheduledAt === 'string' ? new Date(scheduledAt) : scheduledAt;
    return date.toLocaleString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone
    });
  }

  async resetCompletedWorkOrder(
    id: number,
    projectId: number,
    options: ResetWorkOrderOptions,
    actor: string,
    prepareFiles: (workOrder: ProjectWorkOrder) => Promise<{
      removedNames: string[];
      rollback: () => Promise<void>;
      commit: () => Promise<void>;
    }>,
  ): Promise<ProjectWorkOrder> {
    await this.ensureMigrated();
    const client = await pool.connect();
    let files: Awaited<ReturnType<typeof prepareFiles>> | undefined;
    let committed = false;
    try {
      await client.query("BEGIN");
      await lockInventoryForSchema(client, this.schemaName);
      const existing = await client.query(
        `SELECT * FROM "${this.schemaName}".work_orders WHERE id = $1 FOR UPDATE`, [id],
      );
      const row = existing.rows[0];
      if (!row) throw new WorkOrderResetError("Work order not found", 404);
      await inventoryWorkOrderChange(client, this.schemaName, row, { ...row, status: "Open" });
      if (row.status !== "Completed") {
        throw new WorkOrderResetError("Only a Completed work order can be reset. Refresh and try again.", 409);
      }
      const current = this.mapRowToWorkOrder(row);
      files = await prepareFiles(current);
      const assignment = resetAssignment({
        assignedUserId: current.assignedUserId,
        assignedGroupId: current.assignedGroupId,
      }, options);
      const notes = appendResetNote(current.notes, await this.getTimezoneFormattedTimestamp(), actor, options, {
        newSystemId: row.new_system_id,
        newSystemReading: row.new_system_reading_text ?? row.new_system_reading,
        newSystemType: row.new_system_type,
        newModuleId: row.new_module_id,
        newModuleRead: row.new_module_read_text ?? row.new_module_read,
        newModuleType: row.new_module_type,
        newGps: row.new_gps,
      });
      const attachments = options.attachments === "delete" ? [] : (current.attachments || []).filter(
        attachment => !files!.removedNames.includes(attachment.split(/[\\/]/).pop() || ""),
      );
      const result = await client.query(
        `UPDATE "${this.schemaName}".work_orders SET
          status = 'Open', completed_at = NULL, completed_by = NULL,
          scheduled_at = NULL, scheduled_by = NULL, trouble = NULL,
          signature_data = NULL, signature_name = NULL,
          assigned_user_id = $2, assigned_group_id = $3, attachments = $4,
          notes = $5, updated_by = $6, updated_at = NOW(),
          new_system_id = CASE WHEN $7::boolean THEN NULL ELSE new_system_id END,
          new_system_reading = CASE WHEN $7::boolean THEN NULL ELSE new_system_reading END,
          new_system_type = CASE WHEN $7::boolean THEN NULL ELSE new_system_type END,
          new_module_id = CASE WHEN $7::boolean THEN NULL ELSE new_module_id END,
          new_module_read = CASE WHEN $7::boolean THEN NULL ELSE new_module_read END,
          new_module_type = CASE WHEN $7::boolean THEN NULL ELSE new_module_type END,
          new_gps = CASE WHEN $7::boolean THEN NULL ELSE new_gps END,
          gps_source = CASE WHEN $7::boolean THEN NULL ELSE gps_source END,
          gps_accuracy = CASE WHEN $7::boolean THEN NULL ELSE gps_accuracy END,
          gps_captured_at = CASE WHEN $7::boolean THEN NULL ELSE gps_captured_at END,
          gps_receiver = CASE WHEN $7::boolean THEN NULL ELSE gps_receiver END
         WHERE id = $1 RETURNING *`,
        [id, assignment.assignedUserId, assignment.assignedGroupId, attachments, notes, actor, options.capturedData === "clear"],
      );
      await client.query(
        `DELETE FROM public.work_order_time_tracking WHERE project_id = $1 AND system_work_order_id = $2`,
        [projectId, current.customerWoId || String(current.id)],
      );
      await client.query("COMMIT");
      committed = true;
      // The database is already committed: cleanup failure must not masquerade as a failed reset.
      try { await files.commit(); } catch (error) {
        console.error("Work order reset staging cleanup failed:", error);
      }
      return this.mapRowToWorkOrder(result.rows[0]);
    } catch (error) {
      if (!committed) {
        try {
          await client.query("ROLLBACK");
        } finally {
          if (files) await files.rollback();
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async updateWorkOrder(id: number, updates: Partial<InsertProjectWorkOrder>, updatedBy?: string, ordinaryImport = false): Promise<ProjectWorkOrder | undefined> {
    await this.ensureMigrated();
    const client = await pool.connect();
    try {
      const setClauses: string[] = [];
      const values: any[] = [];
      let paramCount = 1;
      if (updates.subStatusId !== undefined) {
        setClauses.push(`sub_status_id = $${paramCount++}`);
        values.push(updates.subStatusId);
      }
      
      // Check if trouble code is being set - we'll handle status and notes later
      const troubleCode = (updates as any).trouble;
      let troubleNoteToAdd: string | null = null;
      let scheduledNoteToAdd: string | null = null;
      let completedNoteToAdd: string | null = null;
      let forceStatusToTrouble = false;
      

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
      if (updates.oldSystemId !== undefined) {
        setClauses.push(`old_system_id = $${paramCount++}`);
        values.push(updates.oldSystemId);
      }
      if (updates.oldSystemReading !== undefined) {
        setClauses.push(...readingSetClauses("old_system_reading",paramCount,paramCount+1));
        paramCount++;
        values.push(readingParameter(updates.oldSystemReading));
        values.push(capturedReadingText(updates.oldSystemReading)); paramCount++;
      }
      if (updates.newSystemId !== undefined) {
        setClauses.push(`new_system_id = $${paramCount++}`);
        values.push(updates.newSystemId);
      }
      if (updates.newSystemReading !== undefined) {
        setClauses.push(...readingSetClauses("new_system_reading",paramCount,paramCount+1));
        paramCount++;
        values.push(readingParameter(updates.newSystemReading));
        values.push(capturedReadingText(updates.newSystemReading)); paramCount++;
      }
      if (updates.oldGps !== undefined) {
        setClauses.push(`old_gps = $${paramCount++}`);
        values.push(updates.oldGps);
      }
      if (updates.newGps !== undefined) {
        setClauses.push(`new_gps = $${paramCount++}`);
        values.push(updates.newGps);
      }
      // Fetch existing status, scheduledAt, and trouble code to determine if they're actually changing
      let existingScheduledAt: Date | null = null;
      let existingStatus: string | null = null;
      let existingTroubleCode: string | null = null;
      let wasAlreadyCompleted = false;
      
      // Always fetch existing state to check for transitions
      const existingStateResult = await client.query(
        `SELECT * FROM "${this.schemaName}".work_orders WHERE id = $1`,
        [id]
      );
      const visit = validateVisitScheduling({ ...schedulingDto(existingStateResult.rows[0] ?? {}), ...updates });
      const beforeGps = existingStateResult.rows[0];
      const gpsUpdate = gpsMetadataUpdate(beforeGps ?? {}, updates);
      const previousFix = gpsFixDto(beforeGps ?? {}).gpsCapture;
      const completionFix = completionGpsFix(updates.newGps, updates.gpsCapture,
        { newGps: beforeGps?.new_gps, gpsCapture: previousFix });
      const metadataFix = gpsUpdate.fix ?? (updates.newGps !== undefined ? completionFix : null);
      if (metadataFix) {
        for (const [column, value] of Object.entries({
          gps_source: metadataFix.source, gps_accuracy: metadataFix.accuracy,
          gps_captured_at: metadataFix.capturedAt, gps_receiver: metadataFix.receiver,
        })) {
          setClauses.push(`${column} = $${paramCount++}`);
          values.push(value);
        }
      } else if (updates.newGps !== undefined) {
        // Compare inside the UPDATE too: a concurrent position change must not
        // leave somebody else's provenance attached to these coordinates.
        const coordinateParameter = paramCount++;
        values.push(updates.newGps);
        for (const column of ["gps_source", "gps_accuracy", "gps_captured_at", "gps_receiver"])
          setClauses.push(`${column} = CASE WHEN new_gps IS NOT DISTINCT FROM $${coordinateParameter} THEN ${column} ELSE NULL END`);
      }
      const proofChanged = gpsUpdate.fix && (["source", "accuracy", "capturedAt", "receiver"] as const)
        .some(key => gpsUpdate.fix![key] !== previousFix?.[key]);
      if (!ordinaryImport && ((updates.status === "Completed" && beforeGps?.status !== "Completed") ||
          (beforeGps?.status === "Completed" && (gpsUpdate.changed || proofChanged))))
        await requireGpsAccuracy(client, this.schemaName, completionFix, beforeGps?.old_gps);
      for (const [key, column] of Object.entries({
        serviceDurationMinutes: "service_duration_minutes",
        appointmentWindowStart: "appointment_window_start",
        appointmentWindowEnd: "appointment_window_end",
      })) {
        if ((updates as any)[key] !== undefined) {
          setClauses.push(`${column} = $${paramCount++}`);
          values.push((visit as any)[key] ?? null);
        }
      }
      existingScheduledAt = existingStateResult.rows[0]?.scheduled_at || null;
      existingStatus = existingStateResult.rows[0]?.status || null;
      existingTroubleCode = existingStateResult.rows[0]?.trouble || null;
      forceStatusToTrouble = !!troubleCode && troubleCode !== existingTroubleCode;
      const existingAssignedUserId = existingStateResult.rows[0]?.assigned_user_id || null;
      
      // Check if the work order was already in a completed status
      if (existingStatus) {
        wasAlreadyCompleted = await this.isCompletedStatus(existingStatus);
      }
      
      // Only add trouble note if the trouble code is actually changing (different from existing)
      // AND if the notes don't already contain a [Trouble Report header (which includes the trouble code line)
      const notesAlreadyHaveTroubleReport = updates.notes && updates.notes.includes('[Trouble Report');
      if (troubleCode && troubleCode !== existingTroubleCode && !notesAlreadyHaveTroubleReport) {
        const troubleCodeDetails = await this.getTroubleCodeDetails(troubleCode);
        const timestamp = await this.getTimezoneFormattedTimestamp();
        const userName = updatedBy || 'System';
        if (troubleCodeDetails) {
          troubleNoteToAdd = `Trouble Code: ${troubleCodeDetails.code} - ${troubleCodeDetails.label} - ${timestamp} by ${userName}`;
        } else {
          // Fallback: use the code value directly if lookup fails
          troubleNoteToAdd = `Trouble Code: ${troubleCode} - ${timestamp} by ${userName}`;
        }
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
          // Only add scheduled note if the datetime is actually changing
          const newScheduledAt = new Date(updates.scheduledAt);
          const isScheduleChanging = !existingScheduledAt || 
            newScheduledAt.getTime() !== new Date(existingScheduledAt).getTime();
          if (isScheduleChanging) {
            const actionTimestamp = await this.getTimezoneFormattedTimestamp();
            // Use the raw scheduledAt value directly - it's stored as-is in the database
            // and the frontend displays it correctly, so format it the same way
            const appointmentTimestamp = await this.formatScheduledAtForNote(updates.scheduledAt);
            const schedulerName = updatedBy || 'System';
            // Get assigned user name from updates or existing work order
            const assignedUserId = updates.assignedUserId !== undefined ? updates.assignedUserId : existingAssignedUserId;
            const assignedUserName = await this.resolveUserName(assignedUserId);
            scheduledNoteToAdd = `[Scheduled by ${schedulerName} at ${actionTimestamp}]\nAppointment set for ${appointmentTimestamp} for ${assignedUserName || 'unassigned'}`;
          }
        } else {
          // scheduledAt is being CLEARED - use the status from the update if provided
          setClauses.push(`scheduled_by = NULL`);
          if (forceStatusToTrouble) {
            // Trouble code is set - force status to "Trouble"
            setClauses.push(`status = $${paramCount++}`);
            values.push("Trouble");
          } else if (updates.status !== undefined && updates.status !== null && updates.status !== "") {
            setClauses.push(`status = $${paramCount++}`);
            values.push(updates.status);
            // Check if this status is a "Completed" type AND we're transitioning from non-completed
            const isCompleted = await this.isCompletedStatus(updates.status);
            if (isCompleted && !wasAlreadyCompleted) {
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
      } else if (updates.status !== undefined && updates.status !== null && updates.status !== "") {
        // scheduledAt was not in this update, handle status normally (skip empty strings)
        setClauses.push(`status = $${paramCount++}`);
        values.push(updates.status);
        // Check if this is a "Scheduled" status and add scheduled note
        // Only add note if there's no existing scheduledAt (i.e., this is a fresh scheduling)
        if (updates.status === "Scheduled" && !existingScheduledAt) {
          const timestamp = await this.getTimezoneFormattedTimestamp();
          const userName = updatedBy || 'System';
          scheduledNoteToAdd = `[Scheduled by ${userName} at ${timestamp}]`;
          if (updatedBy) {
            const scheduledByUserId = await this.resolveUserId(updatedBy);
            setClauses.push(`scheduled_by = $${paramCount++}`);
            values.push(scheduledByUserId);
          }
        } else if (updates.status === "Scheduled" && existingScheduledAt && updatedBy) {
          // Status staying as Scheduled with existing scheduledAt - just update scheduledBy but no note
          const scheduledByUserId = await this.resolveUserId(updatedBy);
          setClauses.push(`scheduled_by = $${paramCount++}`);
          values.push(scheduledByUserId);
        }
        // Check if this status is a "Completed" type and set completed_at and completed_by
        // Only add completion note if transitioning FROM non-completed TO completed
        const isCompleted = await this.isCompletedStatus(updates.status);
        if (isCompleted && !wasAlreadyCompleted) {
          setClauses.push(`completed_at = NOW()`);
          // Clear trouble code when completing a work order
          setClauses.push(`trouble = NULL`);
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
      // Handle notes - only update when there are actual changes
      // Separate auto notes: scheduled/trouble are appended normally, completed is handled specially
      const autoNotesToAppend: string[] = [];
      if (scheduledNoteToAdd) autoNotesToAppend.push(scheduledNoteToAdd);
      if (troubleNoteToAdd) autoNotesToAppend.push(troubleNoteToAdd);
      
      // Check if we need to update notes (auto-generated notes OR user-provided notes that actually changed)
      const hasAutoNotes = autoNotesToAppend.length > 0 || completedNoteToAdd !== null;
      const hasUserNotes = updates.notes !== undefined;
      
      if (hasAutoNotes || hasUserNotes) {
        // Get existing notes first
        const existingResult = await client.query(
          `SELECT notes FROM "${this.schemaName}".work_orders WHERE id = $1`,
          [id]
        );
        const existingNotes = existingResult.rows[0]?.notes || "";
        
        let finalNotes = existingNotes;
        let notesChanged = false;
        let newUserText = "";
        
        // Handle user-provided notes - detect NEW text added beyond existing notes
        // When auto-notes are present, we want: existing + blank line + auto notes + new user text
        if (hasUserNotes) {
          const userProvidedNotes = updates.notes || "";
          if (userProvidedNotes !== existingNotes) {
            // First, check if user notes start with existing notes (appending scenario)
            let appendedSegment = "";
            if (existingNotes && userProvidedNotes.startsWith(existingNotes)) {
              appendedSegment = userProvidedNotes.substring(existingNotes.length).replace(/^\n+/, '');
            } else if (!existingNotes) {
              appendedSegment = userProvidedNotes;
            }
            
            // Check if appended segment contains a completion report header
            const reportHeaderMatch = appendedSegment.match(/^(\[(Changeout|Reading) Report - [^\]]+\])\n?([\s\S]*)$/);
            
            if (reportHeaderMatch && completedNoteToAdd) {
              // Appended segment starts with [Changeout/Reading Report - ...] header
              // Insert completed line right after header, then remaining notes
              const headerLine = reportHeaderMatch[1];
              const remainingNotes = reportHeaderMatch[3].trim();
              
              // Build: existing + blank line + header + completed line + remaining notes
              if (existingNotes) {
                finalNotes = `${existingNotes.trimEnd()}\n\n${headerLine}\n${completedNoteToAdd}`;
              } else {
                finalNotes = `${headerLine}\n${completedNoteToAdd}`;
              }
              if (remainingNotes) {
                finalNotes = `${finalNotes}\n${remainingNotes}`;
              }
              // Mark completedNoteToAdd as handled so it's not added again
              completedNoteToAdd = null;
              notesChanged = true;
            } else if (hasAutoNotes && appendedSegment) {
              // User added text to existing notes - this will be appended AFTER auto-generated notes
              newUserText = appendedSegment.trim();
            } else if (!hasAutoNotes) {
              // No auto-notes, just use user-provided notes directly (standard edit)
              finalNotes = userProvidedNotes;
              notesChanged = true;
            } else {
              // Auto-notes present but user rewrote notes entirely - keep their full text as new user text
              newUserText = userProvidedNotes.trim();
              finalNotes = ""; // Start fresh, auto-notes will be first
            }
          }
        }
        
        // Handle completedNoteToAdd if it wasn't already handled by report header logic
        if (completedNoteToAdd) {
          autoNotesToAppend.push(completedNoteToAdd);
        }
        
        // Append remaining auto-generated notes (trouble, scheduled, and completed if not already handled)
        if (autoNotesToAppend.length > 0) {
          const autoNotes = autoNotesToAppend.join('\n');
          // Build: existing notes + blank line + auto notes + new user text
          if (finalNotes) {
            finalNotes = `${finalNotes.trimEnd()}\n\n${autoNotes}`;
          } else {
            finalNotes = autoNotes;
          }
          // Append new user text after auto-generated notes
          if (newUserText) {
            finalNotes = `${finalNotes}\n${newUserText}`;
          }
          notesChanged = true;
        }
        
        // Only add to SET clause if notes actually changed
        if (notesChanged) {
          setClauses.push(`notes = $${paramCount++}`);
          values.push(finalNotes);
        }
      }
      if (updates.attachments !== undefined) {
        setClauses.push(`attachments = $${paramCount++}`);
        values.push(updates.attachments);
      }
      if ((updates as any).oldSystemType !== undefined) {
        setClauses.push(`old_system_type = $${paramCount++}`);
        values.push((updates as any).oldSystemType ?? null);
      }
      if ((updates as any).newSystemType !== undefined) {
        setClauses.push(`new_system_type = $${paramCount++}`);
        values.push((updates as any).newSystemType ?? null);
      }
      if ((updates as any).oldModuleId !== undefined) {
        setClauses.push(`old_module_id = $${paramCount++}`);
        values.push((updates as any).oldModuleId || null);
      }
      if ((updates as any).newModuleId !== undefined) {
        setClauses.push(`new_module_id = $${paramCount++}`);
        values.push((updates as any).newModuleId || null);
      }
      if ((updates as any).oldModuleRead !== undefined) {
        setClauses.push(...readingSetClauses("old_module_read",paramCount,paramCount+1));
        paramCount++;
        values.push(readingParameter(updates.oldModuleRead));
        values.push(capturedReadingText(updates.oldModuleRead)); paramCount++;
      }
      if ((updates as any).newModuleRead !== undefined) {
        setClauses.push(...readingSetClauses("new_module_read",paramCount,paramCount+1));
        paramCount++;
        values.push(readingParameter(updates.newModuleRead));
        values.push(capturedReadingText(updates.newModuleRead)); paramCount++;
      }
      if ((updates as any).oldModuleType !== undefined) {
        setClauses.push(`old_module_type = $${paramCount++}`);
        values.push((updates as any).oldModuleType || null);
      }
      if ((updates as any).newModuleType !== undefined) {
        setClauses.push(`new_module_type = $${paramCount++}`);
        values.push((updates as any).newModuleType || null);
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
      // When status is being set to "Closed", automatically unassign all users and groups
      const newStatus = updates.status?.toLowerCase();
      const isClosingWorkOrder = newStatus === 'closed';
      
      if (isClosingWorkOrder) {
        // Force clear assignments when closing work order
        setClauses.push(`assigned_user_id = NULL`);
        setClauses.push(`assigned_group_id = NULL`);
      } else {
        // Normal assignment handling
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
      }

      // Always set updatedBy and updated_at
      if (updatedBy) {
        setClauses.push(`updated_by = $${paramCount++}`);
        values.push(updatedBy);
      }
      setClauses.push(`updated_at = NOW()`);
      values.push(id);

      await client.query("BEGIN");
      try {
        const completing = !ordinaryImport && await canonicalStatus(client, updates.status) === "completed";
        if (!completing) await lockInventoryForSchema(client, this.schemaName);
        const { rows: [prior] } = await client.query(`SELECT * FROM "${this.schemaName}".work_orders WHERE id=$1 FOR UPDATE`, [id]);
        const { rows: [project] } = await client.query("SELECT id,inventory_enabled FROM public.projects WHERE database_name=$1", [this.schemaName]);
        const replay = await submissionReplay(client, project.id, id, (updates as any).changeoutSubmissionId);
        if (replay) {
          // Do not replay old completion over a subsequently reopened order.
          if (await canonicalStatus(client, prior?.status) !== "completed" &&
              await canonicalStatus(client, prior?.status) !== "closed")
            throw new ChangeoutError("This submission already completed an earlier attempt. Start a new changeout.");
          await client.query("COMMIT");
          return await this.getWorkOrder(id);
        }
        const result = await client.query(
          `UPDATE "${this.schemaName}".work_orders SET ${setClauses.join(", ")} WHERE id = $${paramCount} RETURNING *`,
          values
        );
        if (!result.rows[0]) {
          await client.query("COMMIT");
          return undefined;
        }
        if (completing && !["completed", "closed"].includes(await canonicalStatus(client, prior?.status))) {
          await acceptCompletion(client, this.schemaName, prior, result.rows[0], updates, project);
        } else {
          await inventoryWorkOrderChange(client, this.schemaName, prior, result.rows[0], (updates as any).inventoryUsage, (updates as any).inventoryItems, ordinaryImport);
          await client.query("INSERT INTO public.changeout_events(project_id,work_order_id,type,actor_id,operation_id) VALUES($1,$2,'workorder_updated',$3,$4) ON CONFLICT DO NOTHING",
            [project.id, id, auditContext.getStore()?.actorId ?? null, auditContext.getStore()?.operationId ?? null]);
        }
        await enqueueCustomerDelivery(client, this.schemaName, result.rows[0]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        if ((error as any)?.code === "P0001" && /Closed|authorized close/.test((error as Error).message)) {
          const { rows: [project] } = await client.query("SELECT id FROM public.projects WHERE database_name=$1", [this.schemaName]);
          if (project) await insertAuditEvent(client, { action: "workOrder.changeBlocked", entityType: "work_orders",
            entityId: String(id), projectId: project.id, outcome: "failed",
            metadata: { reason: "Closed work requires authorized Close/Reopen actions before corrections." } });
        }
        throw error;
      }
      
      // Re-fetch with JOINs to get display fields (scheduledByDisplay, completedByDisplay)
      return await this.getWorkOrder(id);
    } finally {
      client.release();
    }
  }

  async deleteWorkOrder(id: number): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockInventoryForSchema(client, this.schemaName);
      const { rows: [prior] } = await client.query(`SELECT * FROM "${this.schemaName}".work_orders WHERE id=$1 FOR UPDATE`, [id]);
      if (prior) await inventoryWorkOrderChange(client, this.schemaName, prior, null);
      await client.query(`DELETE FROM "${this.schemaName}".work_orders WHERE id = $1`, [id]);
      await client.query("COMMIT");
      return true;
    } catch (e) {
      await client.query("ROLLBACK"); throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Atomically claim a work order for a user.
   * Only succeeds if the work order is not already assigned to another user.
   * Uses WHERE condition to prevent race conditions.
   * 
   * @returns The claimed work order if successful, or null if already claimed by another user
   */
  async claimWorkOrder(id: number, userId: string, updatedBy: string): Promise<ProjectWorkOrder | null> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [current] } = await client.query(`SELECT * FROM "${this.schemaName}".work_orders WHERE id=$1 FOR UPDATE`, [id]);
      if (!current) { await client.query("COMMIT"); return null; }
      await assertClaimAllowed(client, current, userId);
      // Atomic update: only claim if assigned_user_id is NULL or already assigned to this user
      // This prevents race conditions where two users try to claim simultaneously
      const result = await client.query(`
        UPDATE "${this.schemaName}".work_orders 
        SET assigned_user_id = $1, 
            assigned_group_id = NULL, 
            updated_by = $2, 
            updated_at = NOW()
        WHERE id = $3 
          AND (assigned_user_id IS NULL OR assigned_user_id = $1)
        RETURNING id
      `, [userId, updatedBy, id]);
      
      // If no rows were updated, the work order was already claimed by someone else
      if (result.rowCount === 0) {
        await client.query("COMMIT");
        return null;
      }
      const { rows: [project] } = await client.query("SELECT id FROM public.projects WHERE database_name=$1", [this.schemaName]);
      await client.query("INSERT INTO public.changeout_events(project_id,work_order_id,type,actor_id,operation_id) VALUES($1,$2,'workorder_updated',$3,$4) ON CONFLICT DO NOTHING",
        [project.id, id, userId, auditContext.getStore()?.operationId ?? null]);
      await client.query("COMMIT");
      // Re-fetch with JOINs to get display fields
      return await this.getWorkOrder(id) ?? null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
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
            await this.updateWorkOrder(existing.id, updateData, importedBy, true);
            updated++;
            continue;
          }
        }
        
        // Create new work order
        await this.createWorkOrder(wo, importedBy, true);
        imported++;
      } catch (error) {
        errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }

    return { imported, updated, errors };
  }
  
  private parseNumericReading(value: any): number | null {
    if (value === null || value === undefined) return null;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }
  
  private mapRowToWorkOrder(row: any): ProjectWorkOrder {
    const result: any = {
      ...exactReadingDto(row),
      ...gpsFixDto(row),
      id: row.id,
      status: row.status,
      subStatusId: row.sub_status_id ?? null,
      createdBy: row.created_by,
      completedAt: row.completed_at,
      closedAt: row.closed_at,
      closedBy: row.closed_by,
      reviewStartedAt: row.review_started_at,
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
      oldSystemId: row.old_system_id,
      newSystemId: row.new_system_id,
      oldGps: row.old_gps,
      newGps: row.new_gps,
      oldSystemReading: this.parseNumericReading(row.old_system_reading),
      newSystemReading: this.parseNumericReading(row.new_system_reading),
      scheduledAt: row.scheduled_at,
      ...schedulingDto(row),
      updatedBy: row.updated_by,
      trouble: row.trouble,
      oldSystemType: row.old_system_type,
      newSystemType: row.new_system_type,
      oldModuleId: row.old_module_id,
      newModuleId: row.new_module_id,
      oldModuleRead: this.parseNumericReading(row.old_module_read),
      newModuleRead: this.parseNumericReading(row.new_module_read),
      oldModuleType: row.old_module_type,
      newModuleType: row.new_module_type,
      signatureData: row.signature_data,
      signatureName: row.signature_name,
      assignedUserId: row.assigned_user_id,
      assignedGroupId: row.assigned_group_id,
      assignmentVersion: row.assignment_version,
      // Keep IDs for data integrity and filtering
      completedBy: row.completed_by,
      scheduledBy: row.scheduled_by,
      // Add display fields with resolved usernames for UI
      completedByDisplay: row.completed_by_username || row.completed_by,
      scheduledByDisplay: row.scheduled_by_username || row.scheduled_by,
      // Resolve assigned user display name - prefer first/last name, fallback to username, email, then null
      assignedUserDisplay: row.assigned_user_first_name && row.assigned_user_last_name
        ? `${row.assigned_user_first_name} ${row.assigned_user_last_name}`
        : row.assigned_user_username || row.assigned_user_email || null,
    };
    return result as ProjectWorkOrder;
  }
}

// Helper function to parse NUMERIC values (returned as strings by pg driver)
function parseNumericReading(value: any): number | null {
  if (value === null || value === undefined) return null;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
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
export async function backupProjectDatabase(schemaName:string) {
  if (!auditingEnabled) return backupProjectDatabaseData(schemaName);
  const {rows:[scope]}=await pool.query("SELECT project_id,project_label FROM meterflo_audit.project_scopes WHERE schema_name=$1",[schemaName]);
  return auditedOperation("projectBackup","project-database",()=>backupProjectDatabaseData(schemaName),scope?.project_id,scope?.project_label);
}
async function backupProjectDatabaseData(schemaName: string): Promise<{
  schemaName: string;
  backupDate: string;
  workOrders: ProjectWorkOrder[];
  version: string;
  inventory?: InventoryBackup;
  subStatuses?: unknown[];
  troubleCodes?: unknown[];
  routingConfiguration?: unknown;
  schedulingDefaults?: unknown;
  closingPolicy?: { enabled: boolean; afterHours: number };
}> {
  await migrateProjectSchema(schemaName);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const result = await client.query(
      `SELECT * FROM "${schemaName}".work_orders ORDER BY id`
    );
    
    const workOrders = result.rows.map((row) => ({
      ...exactReadingDto(row),
      ...gpsFixDto(row),
      id: row.id,
      status: row.status,
      subStatusId: row.sub_status_id ?? null,
      createdBy: row.created_by,
      completedAt: row.completed_at,
      closedAt: row.closed_at,
      closedBy: row.closed_by,
      reviewStartedAt: row.review_started_at,
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
      oldSystemId: row.old_system_id,
      newSystemId: row.new_system_id,
      oldGps: row.old_gps,
      newGps: row.new_gps,
      oldSystemReading: row.old_system_reading_text ?? row.old_system_reading,
      newSystemReading: row.new_system_reading_text ?? row.new_system_reading,
      scheduledAt: row.scheduled_at,
      ...schedulingDto(row),
      updatedBy: row.updated_by,
      trouble: row.trouble,
      oldSystemType: row.old_system_type,
      newSystemType: row.new_system_type,
      oldModuleId: row.old_module_id,
      newModuleId: row.new_module_id,
      oldModuleRead: row.old_module_read_text ?? row.old_module_read,
      newModuleRead: row.new_module_read_text ?? row.new_module_read,
      oldModuleType: row.old_module_type,
      newModuleType: row.new_module_type,
      signatureData: row.signature_data,
      signatureName: row.signature_name,
      assignedUserId: row.assigned_user_id,
      assignedGroupId: row.assigned_group_id,
      assignmentVersion: row.assignment_version ?? 0,
      completedBy: row.completed_by,
      scheduledBy: row.scheduled_by,
    })) as unknown as ProjectWorkOrder[];
    
    const inventory = await exportInventory(client, schemaName);
    const { rows:[scope] } = await client.query(`SELECT id, default_service_minutes AS "defaultServiceMinutes",
      default_appointment_tolerance_minutes AS "defaultAppointmentToleranceMinutes" FROM public.projects WHERE database_name=$1`,[schemaName]);
    const subStatuses = await listSubStatuses(scope?.id,client);
    const troubleCodeDefinitions = scope?.id ? await exportTroubleCodes(client, scope.id) : [];
    const routingConfiguration = scope?.id ? await exportProjectRouting(client,scope.id) : null;
    const { rows: [closing] } = scope?.id
      ? await client.query("SELECT enabled,after_hours FROM public.work_order_closing_policy WHERE project_id=$1", [scope.id])
      : { rows: [] };
    await client.query("COMMIT");
    return {
      schemaName,
      backupDate: new Date().toISOString(),
      workOrders,
      version: "2.6",
      inventory,
      subStatuses,
      troubleCodes: troubleCodeDefinitions,
      routingConfiguration,
      closingPolicy: closing ? { enabled: closing.enabled, afterHours: closing.after_hours } : undefined,
      schedulingDefaults: scope ? { defaultServiceMinutes: scope.defaultServiceMinutes,
        defaultAppointmentToleranceMinutes: scope.defaultAppointmentToleranceMinutes } : undefined,
    };
  } finally {
    client.release();
  }
}

// Restore project database from backup JSON
export async function restoreProjectDatabase(
  schemaName:string,backup:{workOrders:Array<Omit<ProjectWorkOrder,"id"|"createdAt"|"updatedAt">>;inventory?:InventoryBackup;subStatuses?:unknown[];troubleCodes?:unknown[];routingConfiguration?:unknown;schedulingDefaults?:unknown;closingPolicy?:unknown},options:{clearExisting?:boolean}={}
) {
  if (!auditingEnabled) return restoreProjectDatabaseData(schemaName,backup,options);
  const {rows:[scope]}=await pool.query("SELECT project_id,project_label FROM meterflo_audit.project_scopes WHERE schema_name=$1",[schemaName]);
  return auditedOperation("projectRestore","project-database",()=>restoreProjectDatabaseData(schemaName,backup,options),scope?.project_id,scope?.project_label);
}
// The full-system restore owns the transaction and prepares schemas before calling this.
export async function restoreProjectDatabaseInTransaction(
  client: PoolClient,
  schemaName: string,
  backup: Parameters<typeof restoreProjectDatabase>[1],
  options: { clearExisting?: boolean } = {}
) {
  return restoreProjectDatabaseData(schemaName, backup, options, client);
}

async function restoreProjectDatabaseData(
  schemaName: string,
  backup: { workOrders: Array<Omit<ProjectWorkOrder, "id" | "createdAt" | "updatedAt">>; inventory?: InventoryBackup; subStatuses?:unknown[];troubleCodes?:unknown[];routingConfiguration?:unknown;schedulingDefaults?:unknown;closingPolicy?:unknown },
  options: { clearExisting?: boolean } = {},
  transactionClient?: PoolClient
): Promise<{ restored: number; errors: string[] }> {
  backup.workOrders.forEach(validateVisitScheduling);
  const schedulingDefaults = backup.schedulingDefaults === undefined ? undefined : schedulingDefaultsSchema.parse(backup.schedulingDefaults);
  const restoredClosing = backup.closingPolicy === undefined ? undefined : closingPolicySchema.parse(backup.closingPolicy);
  if (!transactionClient) await migrateProjectSchema(schemaName);
  const client = transactionClient ?? await pool.connect();
  const errors: string[] = [];
  const atomic = !!backup.inventory || !!backup.subStatuses || backup.routingConfiguration !== undefined || schedulingDefaults !== undefined || restoredClosing !== undefined;
  let restored = 0;
  
  try {
    if (atomic && !transactionClient) await client.query("BEGIN");
    if (backup.inventory) {
      validateInventoryBackup(backup.inventory, backup.workOrders.map((wo: any) => zInventoryId(wo.id)));
      await lockInventoryForSchema(client, schemaName);
      await client.query(`LOCK TABLE "${schemaName}".work_orders IN SHARE ROW EXCLUSIVE MODE`);
      const { rows: [r] } = await client.query(`SELECT count(*)::int n FROM "${schemaName}".work_orders`);
      if (r.n && !options.clearExisting) throw new Error("Inventory backups require explicit replacement of existing project data; inventory cannot be merged safely.");
    } else {
      const existingInventory = await exportInventory(client, schemaName);
      if (existingInventory && (existingInventory.enabled || existingInventory.state.allocations.length))
        throw new Error("This backup has no inventory snapshot. Restore an inventory-aware backup to protect stock and work-order links.");
    }
    const subStatusMapping = backup.subStatuses ? await restoreSubStatusDefinitions(client,schemaName,backup.subStatuses) : new Map<string,string>();
    if (backup.troubleCodes) await restoreTroubleCodes(client, schemaName, backup.troubleCodes);
    // Restoring history may retain retired codes; scope and FK checks still apply.
    await client.query("SELECT set_config('meterflo.restore_trouble_codes','on',true)");
    if(backup.routingConfiguration!==undefined)await restoreProjectRouting(client,schemaName,backup.routingConfiguration);
    if(schedulingDefaults) await client.query(`UPDATE public.projects SET default_service_minutes=$2,
      default_appointment_tolerance_minutes=$3 WHERE database_name=$1`,
      [schemaName,schedulingDefaults.defaultServiceMinutes??null,schedulingDefaults.defaultAppointmentToleranceMinutes??null]);
    if (options.clearExisting) {
      await client.query(`DELETE FROM "${schemaName}".work_orders`);
    }
    if (restoredClosing) await client.query(`INSERT INTO public.work_order_closing_policy(project_id,enabled,after_hours)
      SELECT id,false,$2 FROM public.projects WHERE database_name=$1 ON CONFLICT(project_id)
      DO UPDATE SET enabled=false,after_hours=excluded.after_hours,enabled_at=now(),updated_at=now()`,
    [schemaName, restoredClosing.afterHours]);
    
    for (let i = 0; i < backup.workOrders.length; i++) {
      const wo = withExactReadings(backup.workOrders[i]) as any;
      try {
        const restoredOrder = await client.query(
          `INSERT INTO "${schemaName}".work_orders 
           (${backup.inventory ? "id, " : ""}status, created_by, completed_at, notes, attachments, customer_wo_id, customer_id, customer_name, address, city, state, zip, phone, email, route, zone, service_type, old_system_id, new_system_id, old_gps, new_gps, old_system_reading, new_system_reading, scheduled_at, updated_by, trouble, old_system_type, new_system_type, old_module_id, new_module_id, old_module_read, new_module_read, old_module_type, new_module_type, signature_data, signature_name, assigned_user_id, assigned_group_id, completed_by, scheduled_by,old_system_reading_text,new_system_reading_text,old_module_read_text,new_module_read_text,assignment_version)
           ${backup.inventory ? "OVERRIDING SYSTEM VALUE" : ""}
           VALUES (${backup.inventory ? "$46, " : ""}$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40,$41,$42,$43,$44,$45) RETURNING id`,
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
            wo.oldSystemId || null,
            wo.newSystemId || null,
            wo.oldGps || null,
            wo.newGps || null,
            wo.oldSystemReading ?? null,
            wo.newSystemReading ?? null,
            wo.scheduledAt || null,
            wo.updatedBy || null,
            wo.trouble || null,
            wo.oldSystemType ?? null,
            wo.newSystemType ?? null,
            wo.oldModuleId || null,
            wo.newModuleId || null,
            wo.oldModuleRead ?? null,
            wo.newModuleRead ?? null,
            wo.oldModuleType || null,
            wo.newModuleType || null,
            wo.signatureData || null,
            wo.signatureName || null,
            wo.assignedUserId || null,
            wo.assignedGroupId || null,
            wo.completedBy || null,
            wo.scheduledBy || null,
            ...exactReadingFields.map(({key}) => capturedReadingText(wo[key])),
            Number.isInteger(wo.assignmentVersion) && wo.assignmentVersion >= 0 ? wo.assignmentVersion : 0,
            ...(backup.inventory ? [zInventoryId(wo.id)] : []),
          ]
        );
        if (wo.subStatusId) await client.query(`UPDATE "${schemaName}".work_orders SET sub_status_id=$1 WHERE id=$2`,
          [subStatusMapping.get(wo.subStatusId) ?? wo.subStatusId,restoredOrder.rows[0].id]);
        await writeVisitScheduling(client, schemaName, restoredOrder.rows[0].id, wo);
        await writeGpsCapture(client, schemaName, restoredOrder.rows[0].id, wo.gpsCapture, wo.newGps);
        await client.query(`UPDATE "${schemaName}".work_orders SET closed_at=$2,closed_by=$3,review_started_at=$4 WHERE id=$1`,
          [restoredOrder.rows[0].id, wo.closedAt ?? null, wo.closedBy ?? null, wo.reviewStartedAt ?? null]);
        restored++;
      } catch (error) {
        if (atomic || transactionClient) throw error;
        errors.push(`Row ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    }
    
    if (backup.inventory) {
      await restoreInventory(client, schemaName, backup.inventory);
      await client.query(`SELECT setval(pg_get_serial_sequence('"${schemaName}".work_orders','id'), greatest(1,(SELECT coalesce(max(id),1) FROM "${schemaName}".work_orders)),EXISTS(SELECT 1 FROM "${schemaName}".work_orders))`);
    }
    if (atomic && !transactionClient) await client.query("COMMIT");
    return { restored, errors };
  } catch (error) {
    if (atomic && !transactionClient) await client.query("ROLLBACK");
    throw error;
  } finally {
    if (!transactionClient) client.release();
  }
}

function zInventoryId(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error("Inventory backups require original numeric work-order IDs.");
  return value as number;
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
      await client.query(`ALTER TABLE "${schemaName}".work_orders ADD COLUMN trouble UUID`);
      console.log(`Added trouble column to ${schemaName}.work_orders`);
      return true;
    }
    return false;
  } finally {
    client.release();
  }
}
