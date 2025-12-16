import { Pool } from "pg";
import archiver from "archiver";
import unzipper from "unzipper";
import * as fs from "fs";
import * as path from "path";
import { storage } from "./storage";
import { backupProjectDatabase, restoreProjectDatabase } from "./projectDb";
import { getProjectFilesPath } from "./fileStorage";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const TABLE_PRIMARY_KEYS: Record<string, string[]> = {
  users: ["id"],
  projects: ["id"],
  user_projects: ["user_id", "project_id"],
  user_groups: ["id"],
  user_group_members: ["group_id", "user_id"],
  user_group_projects: ["group_id", "project_id"],
  subroles: ["id"],
  permissions: ["id"],
  subrole_permissions: ["subrole_id", "permission_id"],
  system_settings: ["key"],
  work_order_statuses: ["id"],
  trouble_codes: ["id"],
  meter_types: ["id"],
  meter_type_projects: ["meter_type_id", "project_id"],
  import_configs: ["id"],
  import_history: ["id"],
  file_import_configs: ["id"],
  file_import_history: ["id"],
  external_database_configs: ["id"],
  user_column_preferences: ["id"],
  user_filter_preferences: ["id"],
};

const MAIN_TABLES = Object.keys(TABLE_PRIMARY_KEYS);

const TABLE_RESTORE_ORDER = [
  "subroles",
  "permissions",
  "subrole_permissions",
  "user_groups",
  "projects",
  "system_settings",
  "work_order_statuses",
  "trouble_codes",
  "meter_types",
  "users",
  "external_database_configs",
  "file_import_configs",
  "meter_type_projects",
  "user_projects",
  "user_group_members",
  "user_group_projects",
  "user_column_preferences",
  "user_filter_preferences",
  "import_configs",
  "file_import_history",
  "import_history",
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

export async function createBackupArchive(res: any): Promise<void> {
  const { backup, filesPath } = await createFullSystemBackup();
  
  const archive = archiver("zip", { zlib: { level: 9 } });
  
  archive.on("error", (err) => {
    console.error("Archive error:", err);
    throw err;
  });
  
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="full_backup_${new Date().toISOString().slice(0, 10)}.zip"`);
  
  archive.pipe(res);
  
  archive.append(JSON.stringify(backup, null, 2), { name: "database_backup.json" });
  
  if (filesPath && fs.existsSync(filesPath)) {
    archive.directory(filesPath, "project_files");
  }
  
  await archive.finalize();
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

export async function restoreFullSystem(
  backupData: FullSystemBackup,
  options: { clearExisting?: boolean } = {}
): Promise<{ 
  mainTablesRestored: Record<string, number>;
  projectsRestored: number;
  projectErrors: string[];
  errors: string[];
  warnings: string[];
}> {
  const client = await pool.connect();
  const errors: string[] = [];
  const warnings: string[] = [];
  const projectErrors: string[] = [];
  const mainTablesRestored: Record<string, number> = {};
  let projectsRestored = 0;
  
  try {
    const existingTables = await getExistingTables(client);
    const backupTables = Object.keys(backupData.mainDatabase);
    
    for (const table of existingTables) {
      if (!backupTables.includes(table) && !["sessions", "drizzle_migrations"].includes(table)) {
        warnings.push(`Table "${table}" exists in database but not in backup`);
      }
    }
    for (const table of backupTables) {
      if (!existingTables.includes(table)) {
        warnings.push(`Table "${table}" exists in backup but not in database`);
      }
    }
    
    await client.query("BEGIN");
    
    if (options.clearExisting) {
      for (const tableName of TABLE_DELETE_ORDER) {
        if (existingTables.includes(tableName)) {
          try {
            await client.query(`TRUNCATE TABLE "${tableName}" CASCADE`);
          } catch (error: any) {
            try {
              await client.query(`DELETE FROM "${tableName}"`);
            } catch (deleteError) {
              warnings.push(`Could not clear table ${tableName}`);
            }
          }
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
      
      for (const row of rows) {
        try {
          const columns = Object.keys(row);
          const values = Object.values(row);
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
          const columnList = columns.map((c) => `"${c}"`).join(", ");
          
          if (options.clearExisting) {
            await client.query(
              `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders})`,
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
                `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders})
                 ON CONFLICT (${pkColumns}) DO UPDATE SET ${updateSet}`,
                values
              );
            } else {
              await client.query(
                `INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders})
                 ON CONFLICT (${pkColumns}) DO NOTHING`,
                values
              );
            }
          }
          restoredCount++;
        } catch (error: any) {
          errors.push(`${tableName}: ${error.message}`);
        }
      }
      
      mainTablesRestored[tableName] = restoredCount;
    }
    
    const criticalErrors = errors.filter(e => 
      e.includes("users:") || e.includes("projects:") || e.includes("subroles:")
    );
    if (criticalErrors.length > 0) {
      await client.query("ROLLBACK");
      throw new Error(`Critical restore errors: ${criticalErrors.join("; ")}`);
    }
    
    await client.query("COMMIT");
    
    for (const projectBackup of backupData.projectDatabases) {
      try {
        const result = await restoreProjectDatabase(
          projectBackup.schemaName,
          { workOrders: projectBackup.workOrders },
          { clearExisting: options.clearExisting }
        );
        projectsRestored++;
        if (result.errors.length > 0) {
          projectErrors.push(...result.errors.map((e) => `${projectBackup.projectName}: ${e}`));
        }
      } catch (error: any) {
        projectErrors.push(`Project ${projectBackup.projectName}: ${error.message}`);
      }
    }
    
    return { mainTablesRestored, projectsRestored, projectErrors, errors, warnings };
  } catch (error: any) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
}

export async function restoreFilesFromArchive(
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
