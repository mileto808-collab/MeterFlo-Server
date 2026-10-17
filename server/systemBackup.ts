import type { Pool } from "pg";
import { readRelationalInventory } from "./inventoryRelational";
import { inventoryToRelational } from "./inventoryRelationalCodec";
import { emptyInventory as emptyRelationalInventory } from "../shared/inventory";
import archiver from "archiver";
import unzipper from "unzipper";
import * as fs from "fs";
import * as path from "path";
import { storage } from "./storage";
import { auditedOperation } from "./auditService";
import { auditingEnabled } from "./auditContext";
import { initializeAudit } from "./auditMigration";
import { pool as applicationPool } from "./db";
import { backupProjectDatabase, createProjectSchema, migrateProjectSchema, restoreProjectDatabaseInTransaction } from "./projectDb";
import { getProjectFilesPath } from "./fileStorage";
import { exportInventory, validateInventoryBackup, type InventoryBackup } from "./inventoryBackup";
import { mergeOrderHighWater } from "../shared/inventory-order-labels";
import { emptyInventory } from "../shared/inventory";
import { prepareLocationTypeRestore } from "./inventoryLocationTypesBackup";
import { lockInventoryForSchema } from "./inventoryService";

const pool = applicationPool;

export class SystemRestoreError extends Error {
  constructor(message: string, public databaseCommitted: boolean, options?: ErrorOptions) {
    super(message, options);
  }
}

const TABLE_PRIMARY_KEYS: Record<string, string[]> = {
  users: ["id"],
  projects: ["id"],
  user_projects: ["user_id", "project_id"],
  user_groups: ["id"],
  user_group_members: ["group_id", "user_id"],
  subroles: ["id"],
  permissions: ["id"],
  subrole_permissions: ["subrole_id", "permission_id"],
  system_settings: ["key"],
  work_order_statuses: ["id"],
  work_order_sub_statuses: ["id"],
  trouble_codes: ["id"],
  service_types: ["id"],
  system_types: ["id"],
  module_types: ["id"],
  project_service_types: ["id"],
  system_type_projects: ["id"],
  module_type_projects: ["id"],
  import_configs: ["id"],
  import_history: ["id"],
  file_import_configs: ["id"],
  file_import_history: ["id"],
  external_database_configs: ["id"],
  inventory_state: ["project_id"],
  inventory_categories: ["project_id", "id"],
  inventory_items: ["project_id", "id"],
  inventory_quantities: ["project_id", "warehouse_id", "item_id"],
  inventory_movements: ["id"],
};

for (const [name, table] of inventoryToRelational(emptyRelationalInventory(), 0))
  TABLE_PRIMARY_KEYS[name] = ["project_id", ...table.keys];
TABLE_PRIMARY_KEYS.inventory_relational_projects = ["project_id"];
const MAIN_TABLES = Object.keys(TABLE_PRIMARY_KEYS);

const TABLE_RESTORE_ORDER = [
  "users",
  "subroles",
  "permissions",
  "subrole_permissions",
  "projects",
  "user_projects",
  "user_groups",
  "user_group_members",
  "system_settings",
  "work_order_statuses",
  "work_order_sub_statuses",
  "trouble_codes",
  "service_types",
  "system_types",
  "module_types",
  "project_service_types",
  "system_type_projects",
  "module_type_projects",
  "import_configs",
  "import_history",
  "file_import_configs",
  "file_import_history",
  "external_database_configs",
  "inventory_state",
  "inventory_categories",
  "inventory_items",
  "inventory_quantities",
  ...Object.keys(TABLE_PRIMARY_KEYS).filter(name => name.startsWith("inventory_") &&
    !["inventory_state", "inventory_categories", "inventory_items", "inventory_quantities", "inventory_movements"].includes(name)),
  "inventory_movements",
];

const TABLE_DELETE_ORDER = [...TABLE_RESTORE_ORDER].reverse();

export interface FullSystemBackup {
  version: string;
  backupDate: string;
  mainDatabase: Record<string, any[]>;
  projectDatabases: Array<{
    projectId: number;
    projectName: string;
    schemaName: string;
    workOrders: any[];
    inventory?: InventoryBackup;
    subStatuses?: unknown[];
  }>;
}

export async function createFullSystemBackup(): Promise<{ backup: FullSystemBackup; filesPath: string | null }> {
  const client = await pool.connect();
  
  try {
    const mainDatabase: Record<string, any[]> = {};
    
    for (const tableName of MAIN_TABLES) {
      try {
        const result = await client.query(`SELECT * FROM "${tableName}" ORDER BY 1`);
        mainDatabase[tableName] = result.rows;
      } catch (error) {
        console.warn(`Failed to backup table ${tableName}:`, error);
        mainDatabase[tableName] = [];
      }
    }
    
    const projectDatabases: FullSystemBackup["projectDatabases"] = [];
    const projects = await storage.getProjects();
    
    for (const project of projects) {
      if (project.databaseName) {
        try {
          const backup = await backupProjectDatabase(project.databaseName);
          projectDatabases.push({
            projectId: project.id,
            projectName: project.name,
            schemaName: project.databaseName,
            workOrders: backup.workOrders,
            inventory: backup.inventory,
            subStatuses: backup.subStatuses,
          });
        } catch (error) {
          console.warn(`Failed to backup project database ${project.databaseName}:`, error);
        }
      }
    }
    
    const filesPath = await getProjectFilesPath();
    const filesExist = fs.existsSync(filesPath);
    
    return {
      backup: {
        version: "1.1",
        backupDate: new Date().toISOString(),
        mainDatabase,
        projectDatabases,
      },
      filesPath: filesExist ? filesPath : null,
    };
  } finally {
    client.release();
  }
}

function addDirectoryToArchive(
  archive: archiver.Archiver,
  dirPath: string,
  archivePrefix: string,
  skippedFiles: string[]
): void {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const archivePath = archivePrefix ? `${archivePrefix}/${entry.name}` : entry.name;
    
    if (entry.isDirectory()) {
      addDirectoryToArchive(archive, fullPath, archivePath, skippedFiles);
    } else if (entry.isFile()) {
      try {
        const fileStream = fs.createReadStream(fullPath);
        archive.append(fileStream, { name: archivePath });
      } catch (error: any) {
        console.warn(`[Backup] Skipping locked/inaccessible file: ${fullPath} - ${error.message}`);
        skippedFiles.push(fullPath);
      }
    }
  }
}

export async function createBackupArchive(res:any):Promise<void> {
  if(!auditingEnabled) return createBackupArchiveData(res);
  return auditedOperation("systemBackup","legacy-json",()=>createBackupArchiveData(res));
}
async function createBackupArchiveData(res: any): Promise<void> {
  console.log("[Backup] Starting full system backup...");
  
  let backup: FullSystemBackup;
  let filesPath: string | null;
  
  try {
    const result = await createFullSystemBackup();
    backup = result.backup;
    filesPath = result.filesPath;
    console.log(`[Backup] Database backup complete. Projects: ${backup.projectDatabases.length}`);
  } catch (error: any) {
    console.error("[Backup] Failed to create database backup:", error);
    throw new Error(`Database backup failed: ${error.message}`);
  }
  
  const archive = archiver("zip", { zlib: { level: 6 } });
  const skippedFiles: string[] = [];
  
  archive.on("error", (err) => {
    console.error("[Backup] Archive error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: `Archive creation failed: ${err.message}` });
    }
  });
  
  archive.on("warning", (err) => {
    if (err.code === "ENOENT") {
      console.warn("[Backup] Archive warning (file not found):", err.message);
    } else {
      console.warn("[Backup] Archive warning:", err);
    }
  });
  
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="full_backup_${new Date().toISOString().slice(0, 10)}.zip"`);
  
  archive.pipe(res);
  
  archive.append(JSON.stringify(backup, null, 2), { name: "database_backup.json" });
  console.log("[Backup] Added database_backup.json to archive");
  
  if (filesPath && fs.existsSync(filesPath)) {
    console.log(`[Backup] Adding project files from: ${filesPath}`);
    try {
      addDirectoryToArchive(archive, filesPath, "project_files", skippedFiles);
      if (skippedFiles.length > 0) {
        console.warn(`[Backup] Skipped ${skippedFiles.length} locked/inaccessible files`);
        archive.append(
          JSON.stringify({ skippedFiles, reason: "Files were locked or inaccessible during backup" }, null, 2),
          { name: "backup_warnings.json" }
        );
      }
    } catch (error: any) {
      console.error(`[Backup] Error reading project files directory: ${error.message}`);
      archive.append(
        JSON.stringify({ error: error.message, path: filesPath }, null, 2),
        { name: "file_backup_error.json" }
      );
    }
  } else {
    console.log("[Backup] No project files directory to backup");
  }
  
  console.log("[Backup] Finalizing archive...");
  await archive.finalize();
  console.log("[Backup] Archive complete");
}

async function getPrimaryKeyColumns(client: any, tableName: string): Promise<string[]> {
  try {
    const result = await client.query(`
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)
    `, [tableName]);
    return result.rows.map((r: any) => r.attname);
  } catch {
    return TABLE_PRIMARY_KEYS[tableName] || ["id"];
  }
}

async function getExistingTables(client: any): Promise<string[]> {
  const result = await client.query(`
    SELECT tablename FROM pg_tables 
    WHERE schemaname = 'public' AND tablename NOT IN ('sessions', 'drizzle_migrations')
  `);
  return result.rows.map((r: any) => r.tablename);
}

export async function restoreFullSystem(backup:FullSystemBackup,options:Parameters<typeof restoreFullSystemData>[1]={},connectionPool:Pick<Pool,"connect">=pool) {
  if (!auditingEnabled) return restoreFullSystemData(backup,options,connectionPool);
  return auditedOperation("systemRestore","legacy-json",async()=>{
    const result = await restoreFullSystemData(backup,options,connectionPool);
    try { await initializeAudit(applicationPool); }
    catch (cause) {
      throw new SystemRestoreError("Database restored, but audit hook verification failed. Restore is incomplete; an administrator must repair auditing before resuming work.", true, { cause });
    }
    return result;
  });
}
export async function restoreFullSystemData(
  backupData: FullSystemBackup,
  options: { clearExisting?: boolean } = {},
  connectionPool: Pick<Pool, "connect"> = pool
): Promise<{ 
  mainTablesRestored: Record<string, number>;
  projectsRestored: number;
  projectErrors: string[];
  errors: string[];
  warnings: string[];
  success: boolean;
  databaseCommitted: boolean;
}> {
  const client = await connectionPool.connect();
  const errors: string[] = [];
  const warnings: string[] = [];
  const projectErrors: string[] = [];
  const mainTablesRestored: Record<string, number> = {};
  let projectsRestored = 0;
  
  try {
    // Reject incomplete snapshots before clearing or changing any business data.
    const schemas = new Set<string>();
    for (const projectBackup of backupData.projectDatabases) {
      if (!/^project_[a-z0-9_]+$/.test(projectBackup.schemaName) || schemas.has(projectBackup.schemaName))
        throw new Error("Invalid or duplicate project schema in backup.");
      schemas.add(projectBackup.schemaName);
      const project = backupData.mainDatabase.projects?.find(p => p.id === projectBackup.projectId);
      if (!project || project.database_name !== projectBackup.schemaName)
        throw new Error(`Project ${projectBackup.projectName}: matching project configuration is missing.`);
      if (projectBackup.inventory) {
        const ids = projectBackup.workOrders.map(wo => wo.id);
        if (ids.some(id => !Number.isSafeInteger(id) || id < 1) || new Set(ids).size !== ids.length)
          throw new Error(`Project ${projectBackup.projectName}: invalid or duplicate work-order IDs.`);
        validateInventoryBackup(projectBackup.inventory, ids);
      } else if (project.inventory_enabled || backupData.mainDatabase.inventory_state?.some(s => s.project_id === project.id)) {
        throw new Error(`Project ${projectBackup.projectName}: inventory snapshot is missing.`);
      }
    }
    for (const project of backupData.mainDatabase.projects ?? []) {
      if (project.database_name && !schemas.has(project.database_name))
        throw new Error(`Project ${project.name}: work-order snapshot is missing.`);
    }
    for (const table of ["inventory_state", "inventory_categories", "inventory_items", "inventory_quantities", "inventory_movements"]) {
      for (const row of backupData.mainDatabase[table] ?? []) {
        const project = backupData.mainDatabase.projects?.find(p => p.id === row.project_id);
        if (!project) throw new Error(`Inventory backup has no project configuration for project ${row.project_id}.`);
        if (table === "inventory_state" && row.state?.allocations?.length &&
          !backupData.projectDatabases.some(p => p.projectId === project.id && p.inventory))
          throw new Error(`Project ${project.name}: allocated inventory has no work-order snapshot.`);
      }
    }
    const lookupReferences = [
      { table: "work_order_statuses", key: "code", fields: ["status"] },
      { table: "trouble_codes", key: "code", fields: ["trouble"] },
      { table: "service_types", key: "code", fields: ["serviceType"] },
      { table: "system_types", key: "product_id", fields: ["oldSystemType", "newSystemType"] },
      { table: "module_types", key: "product_id", fields: ["oldModuleType", "newModuleType"] },
    ];
    for (const { table, key, fields } of lookupReferences) {
      const required = new Set(backupData.projectDatabases.flatMap(p => p.workOrders.flatMap(wo =>
        fields.map(field => field === "status" ? wo[field] || "Open" : wo[field]).filter(value => value != null && value !== ""))));
      if (!required.size) continue;
      // Older archives omitted equipment/service catalogs. Allow them only if
      // matching configuration is already installed, and preserve that catalog.
      const rows = backupData.mainDatabase[table] ??
        (await client.query(`SELECT "${key}" FROM public.${table} WHERE "${key}" = ANY($1::text[])`, [[...required]])).rows;
      const available = new Set(rows.map(row => row[key]));
      const missing = [...required].filter(value => !available.has(value));
      if (missing.length) throw new Error(`Missing ${table} configuration: ${missing.join(", ")}. Restore matching lookup configuration or use a newer complete JSON backup.`);
    }

    // DDL/migrations use their own connections; finish them before taking data locks.
    // Empty schemas may remain on failure, but no restored business rows are committed.
    for (const projectBackup of backupData.projectDatabases) {
      const { rows: [r] } = await client.query("SELECT to_regclass($1) AS table_name", [`"${projectBackup.schemaName}".work_orders`]);
      if (!r.table_name) await createProjectSchema(projectBackup.projectName, projectBackup.projectId, projectBackup.schemaName, connectionPool);
      await migrateProjectSchema(projectBackup.schemaName, connectionPool);
    }
    prepareLocationTypeRestore(backupData);
    const existingTables = await getExistingTables(client);
    const backupTables = Object.keys(backupData.mainDatabase);
    
    for (const table of existingTables) {
      if (!backupTables.includes(table) && !["sessions", "drizzle_migrations"].includes(table)) {
        warnings.push(`Table "${table}" exists in database but not in backup`);
      }
    }
    for (const table of backupTables) {
      if (!TABLE_RESTORE_ORDER.includes(table) && backupData.mainDatabase[table]?.length)
        throw new Error(`Cannot restore nonempty table "${table}": unsupported legacy JSON table.`);
      if (!existingTables.includes(table)) {
        if (backupData.mainDatabase[table]?.length)
          throw new Error(`Cannot restore nonempty table "${table}": table is missing on this server.`);
        warnings.push(`Table "${table}" exists in backup but not in database`);
      }
    }
    
    await client.query("BEGIN");
    // Retain locally issued numbers even when replacing stock with an older
    // snapshot. Clone the caller's archive before adding local high-water marks.
    backupData = structuredClone(backupData);
    const { rows: localNumbering } = await client.query("SELECT project_id,state FROM public.inventory_state FOR UPDATE");
    for (const local of localNumbering) {
      local.state = await readRelationalInventory(client, local.project_id);
      if (!options.clearExisting && backupData.mainDatabase.inventory_state?.some(row => row.project_id === local.project_id))
        throw new Error("Inventory snapshots require explicit replacement; merging can leave inconsistent relational records.");
      const row = backupData.mainDatabase.inventory_state?.find(row => row.project_id === local.project_id);
      if (row) row.state = mergeOrderHighWater(row.state, local.state);
      else if (backupData.mainDatabase.projects?.some(project => project.id === local.project_id)) {
        const state = mergeOrderHighWater(emptyInventory(), local.state);
        if (state.orderNumberCounters) {
          backupData.mainDatabase.inventory_state ??= [];
          backupData.mainDatabase.inventory_state.push({ project_id: local.project_id, state });
        }
      }
      const project = backupData.projectDatabases?.find(project => project.projectId === local.project_id);
      if (project?.inventory) project.inventory.state = mergeOrderHighWater(project.inventory.state, local.state);
      const marker = backupData.mainDatabase.inventory_relational_projects?.find(row => row.project_id === local.project_id);
      if (marker && Object.keys(local.state.orderNumberCounters ?? {}).length) {
        marker.collections = [...new Set([...marker.collections, "orderNumberCounters"])];
        const counters = backupData.mainDatabase.inventory_order_counters ??= [];
        for (const [key, value] of Object.entries(local.state.orderNumberCounters!)) {
          const counter = counters.find(row => row.project_id === local.project_id && row.counter_key === key);
          if (counter) counter.value = Math.max(counter.value, value as number);
          else counters.push({ project_id: local.project_id, counter_key: key, value });
        }
      }
    }
    // Check the destination before restoring public inventory/configuration.
    // Otherwise those rows could mask an unsafe merge or a legacy downgrade.
    for (const projectBackup of backupData.projectDatabases) {
      await lockInventoryForSchema(client, projectBackup.schemaName);
      await client.query(`LOCK TABLE "${projectBackup.schemaName}".work_orders IN SHARE ROW EXCLUSIVE MODE`);
      if (projectBackup.inventory && !options.clearExisting) {
        const { rows: [r] } = await client.query(`SELECT count(*)::int n FROM "${projectBackup.schemaName}".work_orders`);
        if (r.n) throw new Error(`Project ${projectBackup.projectName}: inventory backups require explicit replacement of existing project data.`);
      }
      if (!projectBackup.inventory) {
        const existing = await exportInventory(client, projectBackup.schemaName);
        if (existing && (existing.enabled || existing.state.allocations.length))
          throw new Error(`Project ${projectBackup.projectName}: this backup has no inventory snapshot for the destination inventory.`);
      }
    }

    if (options.clearExisting) {
      for (const tableName of TABLE_DELETE_ORDER) {
        if (existingTables.includes(tableName) && (backupTables.includes(tableName) || tableName.startsWith("inventory_"))) {
          await client.query(`TRUNCATE TABLE "${tableName}" CASCADE`);
        }
      }
    }
    
    for (const tableName of TABLE_RESTORE_ORDER) {
      if (!existingTables.includes(tableName)) continue;
      
      const rows = backupData.mainDatabase[tableName];
      if (!rows || rows.length === 0) {
        mainTablesRestored[tableName] = 0;
        continue;
      }
      
      let restoredCount = 0;
      const primaryKeys = await getPrimaryKeyColumns(client, tableName);
      
      const { rows: columnTypes } = await client.query(
        "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [tableName]);
      const jsonColumns = new Set(columnTypes.filter(column => ["json", "jsonb"].includes(column.data_type)).map(column => column.column_name));
      for (const row of rows) {
        try {
          const columns = Object.keys(row);
          const values = columns.map(c => jsonColumns.has(c) && row[c] != null
            ? JSON.stringify(row[c]) : row[c]);
          // Valid for serial/default columns too; fresh installations may use
          // GENERATED ALWAYS identities on any public table, not only movements.
          const identityOverride = " OVERRIDING SYSTEM VALUE";
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
          const columnList = columns.map((c) => `"${c}"`).join(", ");
          
          if (options.clearExisting) {
            await client.query(
              `INSERT INTO "${tableName}" (${columnList})${identityOverride} VALUES (${placeholders})`,
              values
            );
          } else {
            const pkColumns = primaryKeys.map((pk) => `"${pk}"`).join(", ");
            const updateColumns = columns.filter((c) => !primaryKeys.includes(c));
            
            if (updateColumns.length > 0) {
              const updateSet = updateColumns
                .map((c) => `"${c}" = EXCLUDED."${c}"`)
                .join(", ");
              
              await client.query(
                `INSERT INTO "${tableName}" (${columnList})${identityOverride} VALUES (${placeholders})
                 ON CONFLICT (${pkColumns}) DO UPDATE SET ${updateSet}`,
                values
              );
            } else {
              await client.query(
                `INSERT INTO "${tableName}" (${columnList})${identityOverride} VALUES (${placeholders})
                 ON CONFLICT (${pkColumns}) DO NOTHING`,
                values
              );
            }
          }
          restoredCount++;
        } catch (error: any) {
          throw new Error(`Critical restore errors: ${tableName}: ${error.message}`);
        }
      }
      
      mainTablesRestored[tableName] = restoredCount;
    }
    
    for (const tableName of TABLE_RESTORE_ORDER) {
      if (!existingTables.includes(tableName)) continue;
      for (const key of await getPrimaryKeyColumns(client, tableName)) {
        const { rows: [r] } = await client.query("SELECT pg_get_serial_sequence($1,$2) AS sequence", [tableName, key]);
        if (!r.sequence) continue;
        await client.query(`LOCK TABLE "${tableName}" IN SHARE ROW EXCLUSIVE MODE`);
        await client.query(`SELECT setval($1::regclass,
          GREATEST(coalesce((SELECT max("${key}") FROM "${tableName}"),0),1),
          EXISTS(SELECT 1 FROM "${tableName}"))`, [r.sequence]);
      }
    }
    
    for (const projectBackup of backupData.projectDatabases) {
      try {
        const result = await restoreProjectDatabaseInTransaction(
          client,
          projectBackup.schemaName,
          { workOrders: projectBackup.workOrders, inventory: projectBackup.inventory, subStatuses: projectBackup.subStatuses },
          { clearExisting: options.clearExisting }
        );
        if (result.errors.length > 0) {
          projectErrors.push(...result.errors.map((e) => `${projectBackup.projectName}: ${e}`));
        }
        projectsRestored++;
      } catch (error: any) {
        projectErrors.push(`Project ${projectBackup.projectName}: ${error.message}`);
        throw new Error(`System database restore rolled back: ${projectErrors.join("; ")}`);
      }
    }
    if (projectErrors.length) throw new Error(`System database restore rolled back: ${projectErrors.join("; ")}`);
    await client.query("COMMIT");
    return { mainTablesRestored, projectsRestored, projectErrors, errors, warnings, success: true, databaseCommitted: true };
  } catch (error: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw new SystemRestoreError(`System database restore rolled back: ${error.message}`, false, { cause: error });
  } finally {
    client.release();
  }
}

export async function restoreFilesFromArchive(zipBuffer:Buffer,targetPath:string) {
  if(!auditingEnabled) return restoreFilesFromArchiveData(zipBuffer,targetPath);
  return auditedOperation("systemFilesRestore","legacy-project-files",()=>restoreFilesFromArchiveData(zipBuffer,targetPath));
}
async function restoreFilesFromArchiveData(
  zipBuffer: Buffer,
  targetPath: string
): Promise<{ filesRestored: number; errors: string[] }> {
  let filesRestored = 0;
  const errors: string[] = [];
  
  try {
    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }
    
    const directory = await unzipper.Open.buffer(zipBuffer);
    
    for (const file of directory.files) {
      if (file.path.startsWith("project_files/") && file.type === "File") {
        const relativePath = file.path.replace("project_files/", "");
        const fullPath = path.join(targetPath, relativePath);
        const dir = path.dirname(fullPath);
        
        try {
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
          
          const content = await file.buffer();
          fs.writeFileSync(fullPath, content);
          filesRestored++;
        } catch (error: any) {
          errors.push(`File ${relativePath}: ${error.message}`);
        }
      }
    }
    
    return { filesRestored, errors };
  } catch (error: any) {
    errors.push(`Archive extraction failed: ${error.message}`);
    return { filesRestored, errors };
  }
}

export async function extractDatabaseBackupFromArchive(zipBuffer: Buffer): Promise<FullSystemBackup | null> {
  try {
    const directory = await unzipper.Open.buffer(zipBuffer);
    
    for (const file of directory.files) {
      if (file.path === "database_backup.json") {
        const content = await file.buffer();
        return JSON.parse(content.toString());
      }
    }
    
    return null;
  } catch (error) {
    console.error("Failed to extract database backup:", error);
    return null;
  }
}
