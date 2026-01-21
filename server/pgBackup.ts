import { spawn, execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Pool } from "pg";
import archiver from "archiver";
import unzipper from "unzipper";
import { storage } from "./storage";
import { getProjectFilesPath } from "./fileStorage";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface PgConnectionParams {
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
}

function parseConnectionString(connectionString: string): PgConnectionParams {
  const url = new URL(connectionString);
  return {
    host: url.hostname,
    port: url.port || "5432",
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
  };
}

function getPgToolPath(toolName: string): string {
  const isWindows = process.platform === "win32";
  const exeName = isWindows ? `${toolName}.exe` : toolName;
  
  // First check for explicit PG_BIN_PATH environment variable override
  const pgBinPath = process.env.PG_BIN_PATH;
  if (pgBinPath) {
    const customPath = path.join(pgBinPath, exeName);
    if (fs.existsSync(customPath)) {
      console.log(`[Backup] Found ${toolName} via PG_BIN_PATH at: ${customPath}`);
      return customPath;
    } else {
      console.log(`[Backup] PG_BIN_PATH set to ${pgBinPath} but ${exeName} not found there`);
    }
  }
  
  // Try to find via system command first
  try {
    const findCmd = isWindows ? `where ${exeName}` : `which ${toolName}`;
    const result = execSync(findCmd, { encoding: "utf-8", windowsHide: true });
    if (result) {
      // Windows uses \r\n, need to handle both line endings
      const lines = result.split(/\r?\n/).filter(line => line.trim());
      if (lines.length > 0) {
        const foundPath = lines[0].trim();
        // Verify the path actually exists
        if (fs.existsSync(foundPath)) {
          console.log(`[Backup] Found ${toolName} via system command at: ${foundPath}`);
          return foundPath;
        }
      }
    }
  } catch (err: any) {
    console.log(`[Backup] System command failed to find ${toolName}: ${err.message}`);
  }
  
  // Try standard installation paths
  if (isWindows) {
    const windowsPaths = [
      `C:\\Program Files\\PostgreSQL\\19\\bin\\${exeName}`,
      `C:\\Program Files\\PostgreSQL\\18\\bin\\${exeName}`,
      `C:\\Program Files\\PostgreSQL\\17\\bin\\${exeName}`,
      `C:\\Program Files\\PostgreSQL\\16\\bin\\${exeName}`,
      `C:\\Program Files\\PostgreSQL\\15\\bin\\${exeName}`,
      `C:\\Program Files\\PostgreSQL\\14\\bin\\${exeName}`,
      `C:\\Program Files\\PostgreSQL\\13\\bin\\${exeName}`,
      `C:\\Program Files (x86)\\PostgreSQL\\19\\bin\\${exeName}`,
      `C:\\Program Files (x86)\\PostgreSQL\\18\\bin\\${exeName}`,
      `C:\\Program Files (x86)\\PostgreSQL\\17\\bin\\${exeName}`,
      `C:\\Program Files (x86)\\PostgreSQL\\16\\bin\\${exeName}`,
      `C:\\Program Files (x86)\\PostgreSQL\\15\\bin\\${exeName}`,
      `C:\\Program Files (x86)\\PostgreSQL\\14\\bin\\${exeName}`,
    ];
    
    for (const p of windowsPaths) {
      if (fs.existsSync(p)) {
        console.log(`[Backup] Found ${toolName} at standard path: ${p}`);
        return p;
      }
    }
    console.log(`[Backup] ${toolName} not found in standard Windows paths`);
  } else {
    const linuxPaths = [
      `/usr/bin/${toolName}`,
      `/usr/local/bin/${toolName}`,
      `/usr/lib/postgresql/14/bin/${toolName}`,
      `/usr/lib/postgresql/15/bin/${toolName}`,
      `/usr/lib/postgresql/16/bin/${toolName}`,
      `/usr/lib/postgresql/17/bin/${toolName}`,
    ];
    
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) {
        console.log(`[Backup] Found ${toolName} at standard path: ${p}`);
        return p;
      }
    }
  }
  
  console.log(`[Backup] WARNING: ${toolName} not found, will try using bare command: ${exeName}`);
  return exeName;
}

async function runPgCommand(
  command: string,
  args: string[],
  env: Record<string, string>,
  outputFile?: string
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const toolPath = getPgToolPath(command);
    const isWindows = process.platform === "win32";
    let stdout = "";
    let stderr = "";
    
    console.log(`[Backup] Running ${command} from: ${toolPath}`);
    
    const options: any = {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      // Use shell on Windows to handle paths with spaces and proper PATH resolution
      shell: isWindows,
      windowsHide: true,
    };
    
    // On Windows with shell mode, quote paths that contain spaces
    const execPath = isWindows && toolPath.includes(" ") ? `"${toolPath}"` : toolPath;
    
    const proc = spawn(execPath, args, options);
    
    let outputStream: fs.WriteStream | null = null;
    if (outputFile) {
      outputStream = fs.createWriteStream(outputFile);
      proc.stdout.pipe(outputStream);
    } else {
      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });
    }
    
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    
    proc.on("close", (code) => {
      if (outputStream) {
        outputStream.close();
      }
      resolve({
        success: code === 0,
        stdout,
        stderr,
      });
    });
    
    proc.on("error", (err: any) => {
      if (outputStream) {
        outputStream.close();
      }
      const errorDetail = err.code === "ENOENT" 
        ? `PostgreSQL tool '${command}' could not be executed. Path tried: ${toolPath}. Ensure PostgreSQL client tools are installed and accessible.`
        : err.message;
      console.error(`[Backup] Process spawn error for ${command}:`, errorDetail);
      resolve({
        success: false,
        stdout,
        stderr: stderr + "\n" + errorDetail,
      });
    });
  });
}

export async function pgDump(
  connectionString: string,
  outputFile: string,
  schemas?: string[]
): Promise<{ success: boolean; error?: string }> {
  const params = parseConnectionString(connectionString);
  
  const args = [
    "-h", params.host,
    "-p", params.port,
    "-U", params.user,
    "-d", params.database,
    "--format=plain",
    "--no-owner",
    "--no-privileges",
    "--clean",
    "--if-exists",
  ];
  
  if (schemas && schemas.length > 0) {
    for (const schema of schemas) {
      args.push("--schema=" + schema);
    }
  }
  
  const env = { PGPASSWORD: params.password };
  
  const result = await runPgCommand("pg_dump", args, env, outputFile);
  
  if (!result.success) {
    return { success: false, error: result.stderr };
  }
  
  return { success: true };
}

export async function pgRestore(
  connectionString: string,
  sqlFile: string,
  options: { singleTransaction?: boolean } = {}
): Promise<{ success: boolean; error?: string; warnings: string[] }> {
  const params = parseConnectionString(connectionString);
  const warnings: string[] = [];
  
  const args = [
    "-h", params.host,
    "-p", params.port,
    "-U", params.user,
    "-d", params.database,
    "-v",
    "-f", sqlFile,
  ];
  
  if (options.singleTransaction) {
    args.push("--single-transaction");
  }
  
  const env = { PGPASSWORD: params.password };
  
  const result = await runPgCommand("psql", args, env);
  
  if (result.stderr) {
    const lines = result.stderr.split("\n");
    for (const line of lines) {
      if (line.includes("WARNING") || line.includes("NOTICE")) {
        warnings.push(line);
      } else if (line.includes("ERROR") && !result.success) {
        return { success: false, error: result.stderr, warnings };
      }
    }
  }
  
  return { success: true, warnings };
}

export async function getProjectSchemas(): Promise<string[]> {
  const projects = await storage.getProjects();
  const schemas: string[] = ["public"];
  
  for (const project of projects) {
    if (project.databaseName) {
      schemas.push(project.databaseName);
    }
  }
  
  return schemas;
}

export interface PgBackupResult {
  success: boolean;
  backupFile: string;
  schemas: string[];
  backupDate: string;
  error?: string;
}

export async function createPgBackup(): Promise<PgBackupResult> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return {
      success: false,
      backupFile: "",
      schemas: [],
      backupDate: new Date().toISOString(),
      error: "DATABASE_URL not configured",
    };
  }
  
  const schemas = await getProjectSchemas();
  const tempDir = os.tmpdir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(tempDir, `pg_backup_${timestamp}.sql`);
  
  const result = await pgDump(connectionString, backupFile, schemas);
  
  if (!result.success) {
    return {
      success: false,
      backupFile: "",
      schemas,
      backupDate: new Date().toISOString(),
      error: result.error,
    };
  }
  
  return {
    success: true,
    backupFile,
    schemas,
    backupDate: new Date().toISOString(),
  };
}

function addDirectoryToArchiveRecursive(
  archive: archiver.Archiver,
  dirPath: string,
  archivePrefix: string,
  skippedFiles: string[],
  excludeDirs: string[] = []
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (error: any) {
    console.warn(`[Backup] Cannot read directory: ${dirPath} - ${error.message}`);
    skippedFiles.push(dirPath);
    return;
  }
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const archivePath = archivePrefix ? `${archivePrefix}/${entry.name}` : entry.name;
    
    if (entry.isDirectory()) {
      // Check if this directory should be excluded
      const normalizedFullPath = path.normalize(fullPath);
      const shouldExclude = excludeDirs.some(excludeDir => {
        const normalizedExclude = path.normalize(excludeDir);
        return normalizedFullPath === normalizedExclude || normalizedFullPath.startsWith(normalizedExclude + path.sep);
      });
      
      if (!shouldExclude) {
        addDirectoryToArchiveRecursive(archive, fullPath, archivePath, skippedFiles, excludeDirs);
      } else {
        console.log(`[Backup] Excluding directory: ${fullPath}`);
      }
    } else if (entry.isFile()) {
      try {
        const fileStream = fs.createReadStream(fullPath);
        archive.append(fileStream, { name: archivePath });
      } catch (error: any) {
        console.warn(`[Backup] Skipping file: ${fullPath} - ${error.message}`);
        skippedFiles.push(fullPath);
      }
    }
  }
}

// Directories and files to exclude from web app backup
const WEB_APP_BACKUP_EXCLUDES = [
  "node_modules",
  ".git",
  ".cache",
  ".replit",
  ".upm",
  "dist",
  ".npm",
  "tmp",
  "temp",
  ".vscode",
  ".idea",
  "coverage",
  ".nyc_output",
  "logs",
];

function addWebAppFilesToArchive(
  archive: archiver.Archiver,
  appDir: string,
  archivePrefix: string,
  skippedFiles: string[],
  projectFilesPath: string | null
): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(appDir, { withFileTypes: true });
  } catch (error: any) {
    console.warn(`[Backup] Cannot read app directory: ${appDir} - ${error.message}`);
    skippedFiles.push(appDir);
    return;
  }
  
  // Build list of directories to exclude
  const excludeDirs: string[] = [];
  for (const excludeName of WEB_APP_BACKUP_EXCLUDES) {
    excludeDirs.push(path.join(appDir, excludeName));
  }
  // Also exclude the project files directory
  if (projectFilesPath) {
    excludeDirs.push(projectFilesPath);
  }
  
  for (const entry of entries) {
    const fullPath = path.join(appDir, entry.name);
    const archivePath = archivePrefix ? `${archivePrefix}/${entry.name}` : entry.name;
    
    // Skip excluded directories
    if (WEB_APP_BACKUP_EXCLUDES.includes(entry.name)) {
      console.log(`[Backup] Excluding from web app backup: ${entry.name}`);
      continue;
    }
    
    // Skip the project files directory
    if (projectFilesPath && path.normalize(fullPath) === path.normalize(projectFilesPath)) {
      console.log(`[Backup] Excluding project files directory from web app backup: ${entry.name}`);
      continue;
    }
    
    if (entry.isDirectory()) {
      addDirectoryToArchiveRecursive(archive, fullPath, archivePath, skippedFiles, excludeDirs);
    } else if (entry.isFile()) {
      try {
        const fileStream = fs.createReadStream(fullPath);
        archive.append(fileStream, { name: archivePath });
      } catch (error: any) {
        console.warn(`[Backup] Skipping file: ${fullPath} - ${error.message}`);
        skippedFiles.push(fullPath);
      }
    }
  }
}

export type BackupType = "database" | "clean" | "files" | "project";

// Tables to EXPORT in clean backup (configuration to keep)
const CLEAN_BACKUP_TABLES = [
  "subroles",
  "permissions", 
  "subrole_permissions",
  "system_settings",
  "work_order_statuses",
  "trouble_codes",
  "service_types",
];

// Tables to CLEAR during clean restore (will be empty after restore)
const CLEAN_TABLES_TO_CLEAR = [
  "file_import_history",
  "import_history",
  "user_groups",
  "module_types",
  "system_types",
  "projects",
];

const SYSTEM_USERS = ["admin", "file_import"];

export async function createCleanPgBackup(): Promise<PgBackupResult> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return {
      success: false,
      backupFile: "",
      schemas: [],
      backupDate: new Date().toISOString(),
      error: "DATABASE_URL not configured",
    };
  }
  
  const params = parseConnectionString(connectionString);
  const tempDir = os.tmpdir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(tempDir, `pg_clean_backup_${timestamp}.sql`);
  
  const args = [
    "-h", params.host,
    "-p", params.port,
    "-U", params.user,
    "-d", params.database,
    "--format=plain",
    "--no-owner",
    "--no-privileges",
    "--data-only",
    "--inserts",
    "--schema=public",
  ];
  
  for (const table of CLEAN_BACKUP_TABLES) {
    args.push(`--table=public.${table}`);
  }
  
  const env = { PGPASSWORD: params.password };
  
  const result = await runPgCommand("pg_dump", args, env, backupFile);
  
  if (!result.success) {
    return {
      success: false,
      backupFile: "",
      schemas: ["public"],
      backupDate: new Date().toISOString(),
      error: result.stderr,
    };
  }
  
  // Append system users (admin, file_import) to the backup
  try {
    const systemUsersInserts = await generateSystemUsersInserts();
    if (systemUsersInserts) {
      fs.appendFileSync(backupFile, systemUsersInserts);
      console.log(`[Clean Backup] Added ${SYSTEM_USERS.join(", ")} user(s) to backup`);
    }
  } catch (error) {
    console.error("[Clean Backup] Error adding system users:", error);
  }
  
  return {
    success: true,
    backupFile,
    schemas: ["public"],
    backupDate: new Date().toISOString(),
  };
}

async function generateSystemUsersInserts(): Promise<string> {
  const client = await pool.connect();
  try {
    const placeholders = SYSTEM_USERS.map((_, i) => `$${i + 1}`).join(", ");
    const result = await client.query(
      `SELECT id, email, username, password_hash, first_name, last_name, profile_image_url, 
              role, subrole_id, is_locked, locked_at, locked_reason, last_login_at,
              address, city, state, zip, phone, website, notes, created_at, updated_at
       FROM users 
       WHERE username IN (${placeholders})`,
      SYSTEM_USERS
    );
    
    if (result.rows.length === 0) {
      console.log("[Clean Backup] No system users found to backup");
      return "";
    }
    
    let sql = "\n\n-- Clean backup: System users (admin, file_import) preserved\n";
    sql += "-- Insert users first with NULL subrole_id to avoid FK issues during restore\n";
    sql += "-- Then update subrole_id after subroles table is populated\n\n";
    
    // First pass: INSERT users with NULL subrole_id to avoid FK constraint issues
    for (const row of result.rows) {
      const values = [
        escapeValue(row.id),
        escapeValue(row.email),
        escapeValue(row.username),
        escapeValue(row.password_hash),
        escapeValue(row.first_name),
        escapeValue(row.last_name),
        escapeValue(row.profile_image_url),
        escapeValue(row.role),
        "NULL", // Insert with NULL subrole_id first
        row.is_locked !== null ? row.is_locked : "false",
        escapeValue(row.locked_at),
        escapeValue(row.locked_reason),
        escapeValue(row.last_login_at),
        escapeValue(row.address),
        escapeValue(row.city),
        escapeValue(row.state),
        escapeValue(row.zip),
        escapeValue(row.phone),
        escapeValue(row.website),
        escapeValue(row.notes),
        escapeValue(row.created_at),
        escapeValue(row.updated_at),
      ];
      
      sql += `INSERT INTO public.users (id, email, username, password_hash, first_name, last_name, profile_image_url, role, subrole_id, is_locked, locked_at, locked_reason, last_login_at, address, city, state, zip, phone, website, notes, created_at, updated_at) VALUES (${values.join(", ")}) ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, role = EXCLUDED.role, updated_at = EXCLUDED.updated_at;\n`;
    }
    
    // Second pass: UPDATE subrole_id for users that have one
    sql += "\n-- Update subrole_id after subroles table is populated\n";
    for (const row of result.rows) {
      if (row.subrole_id !== null) {
        sql += `UPDATE public.users SET subrole_id = ${row.subrole_id} WHERE username = ${escapeValue(row.username)};\n`;
      }
    }
    
    return sql;
  } finally {
    client.release();
  }
}

function escapeValue(value: any): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  if (typeof value === "number") {
    return String(value);
  }
  const escaped = String(value).replace(/'/g, "''");
  return `'${escaped}'`;
}

export async function createPgBackupArchive(res: any, backupType: BackupType = "database"): Promise<void> {
  console.log(`[Backup] Starting backup (type: ${backupType})...`);
  
  // Backup types:
  // - "database": Full database + all project schemas (pg_dump of everything)
  // - "clean": Clean database (roles, permissions, settings, statuses only - no users/projects)
  // - "files": Web app source files only (excluding project files directory)
  // - "project": Project files only (uploads, attachments, work order files)
  
  const includeDatabase = backupType === "database";
  const includeCleanDatabase = backupType === "clean";
  const includeWebAppFiles = backupType === "files";
  const includeProjectFiles = backupType === "project";
  
  let backupResult: PgBackupResult | null = null;
  
  if (includeDatabase) {
    try {
      backupResult = await createPgBackup();
      
      if (!backupResult.success) {
        console.error("[Backup] pg_dump failed:", backupResult.error);
        throw new Error(backupResult.error || "Failed to create database backup");
      }
      console.log(`[Backup] Database dump complete. Schemas: ${backupResult.schemas.join(", ")}`);
    } catch (error: any) {
      console.error("[Backup] Database backup error:", error);
      throw new Error(`Database backup failed: ${error.message}`);
    }
  }
  
  if (includeCleanDatabase) {
    try {
      backupResult = await createCleanPgBackup();
      
      if (!backupResult.success) {
        console.error("[Backup] Clean pg_dump failed:", backupResult.error);
        throw new Error(backupResult.error || "Failed to create clean database backup");
      }
      console.log(`[Backup] Clean database dump complete. Tables: ${CLEAN_BACKUP_TABLES.join(", ")}`);
    } catch (error: any) {
      console.error("[Backup] Clean database backup error:", error);
      throw new Error(`Clean database backup failed: ${error.message}`);
    }
  }
  
  const projectFilesPath = await getProjectFilesPath();
  const projectFilesExist = fs.existsSync(projectFilesPath);
  const appDir = process.cwd();
  const skippedFiles: string[] = [];
  
  // For project-only backup, require the directory to exist
  if (backupType === "project" && !projectFilesExist) {
    throw new Error("No project files directory found to backup");
  }
  
  const archive = archiver("zip", { zlib: { level: 6 } });
  
  archive.on("error", (err) => {
    console.error("[Backup] Archive error:", err);
    if (backupResult && fs.existsSync(backupResult.backupFile)) {
      try { fs.unlinkSync(backupResult.backupFile); } catch {}
    }
    if (!res.headersSent) {
      res.status(500).json({ message: `Archive creation failed: ${err.message}` });
    }
  });
  
  archive.on("warning", (err) => {
    if (err.code === "ENOENT") {
      console.warn("[Backup] Archive warning (file not found):", err.message);
    } else if (err.code === "EBUSY" || err.code === "EPERM") {
      console.warn("[Backup] Archive warning (file locked/permission):", err.message);
    } else {
      console.warn("[Backup] Archive warning:", err);
    }
  });
  
  const filenamePrefix = backupType === "database" ? "full_db_backup" : 
                         backupType === "clean" ? "clean_db_backup" :
                         backupType === "files" ? "webapp_backup" : "project_backup";
  
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.zip"`
  );
  
  archive.pipe(res);
  
  // Add database backup
  if ((includeDatabase || includeCleanDatabase) && backupResult) {
    archive.file(backupResult.backupFile, { name: "database_backup.sql" });
    console.log("[Backup] Added database_backup.sql to archive");
  }
  
  // Add web app source files (excluding project files directory and common excludes)
  if (includeWebAppFiles) {
    console.log(`[Backup] Adding web app source files from: ${appDir}`);
    try {
      addWebAppFilesToArchive(
        archive, 
        appDir, 
        "webapp_files", 
        skippedFiles, 
        projectFilesPath
      );
      console.log("[Backup] Web app source files added to archive");
    } catch (error: any) {
      console.error(`[Backup] Error adding web app files: ${error.message}`);
      archive.append(
        JSON.stringify({ error: error.message, path: appDir }, null, 2),
        { name: "webapp_backup_error.json" }
      );
    }
  }
  
  // Add project files (only for full backup)
  if (includeProjectFiles && projectFilesPath && projectFilesExist) {
    console.log(`[Backup] Adding project files from: ${projectFilesPath}`);
    try {
      addDirectoryToArchiveRecursive(archive, projectFilesPath, "project_files", skippedFiles);
      console.log("[Backup] Project files added to archive");
    } catch (error: any) {
      console.error(`[Backup] Error adding project files: ${error.message}`);
      archive.append(
        JSON.stringify({ error: error.message, path: projectFilesPath }, null, 2),
        { name: "project_files_error.json" }
      );
    }
  } else if (includeProjectFiles) {
    console.log("[Backup] No project files directory to backup");
  }
  
  // Add warnings about skipped files
  if (skippedFiles.length > 0) {
    console.warn(`[Backup] Skipped ${skippedFiles.length} locked/inaccessible files`);
    archive.append(
      JSON.stringify({ 
        skippedFiles, 
        reason: "Files were locked, inaccessible, or permission denied during backup" 
      }, null, 2),
      { name: "backup_warnings.json" }
    );
  }
  
  // Add metadata
  const metadata = {
    version: "2.2",
    format: backupType === "database" ? "pg_dump_full" : 
            backupType === "clean" ? "pg_dump_clean" :
            backupType === "files" ? "webapp_files_only" : "project_files_only",
    backupType,
    backupDate: backupResult?.backupDate || new Date().toISOString(),
    schemas: backupResult?.schemas,
    tablesIncluded: includeCleanDatabase ? CLEAN_BACKUP_TABLES : undefined,
    systemUsersIncluded: includeCleanDatabase ? SYSTEM_USERS : undefined,
    postgresVersion: (includeDatabase || includeCleanDatabase) ? await getPostgresVersion() : undefined,
    includesWebAppFiles: includeWebAppFiles,
    includesProjectFiles: includeProjectFiles,
    includesDatabase: includeDatabase,
    includesCleanDatabase: includeCleanDatabase,
  };
  archive.append(JSON.stringify(metadata, null, 2), { name: "backup_metadata.json" });
  
  console.log("[Backup] Finalizing archive...");
  await archive.finalize();
  console.log("[Backup] Archive complete");
  
  if (backupResult && fs.existsSync(backupResult.backupFile)) {
    try { fs.unlinkSync(backupResult.backupFile); } catch {}
  }
}

async function getPostgresVersion(): Promise<string> {
  try {
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT version()");
      return result.rows[0]?.version || "unknown";
    } finally {
      client.release();
    }
  } catch {
    return "unknown";
  }
}

export interface BackupMetadata {
  version: string;
  format: string;
  backupType?: "database" | "clean" | "files" | "project";
  backupDate: string;
  schemas?: string[];
  tablesIncluded?: string[];
  postgresVersion?: string;
}

export async function extractBackupFromArchive(zipBuffer: Buffer): Promise<{
  sqlFile: string | null;
  metadata: BackupMetadata | null;
  legacyJson: any | null;
  foundFiles: string[];
}> {
  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  let sqlFile: string | null = null;
  let metadata: BackupMetadata | null = null;
  let legacyJson: any | null = null;
  const foundFiles: string[] = [];
  
  try {
    const directory = await unzipper.Open.buffer(zipBuffer);
    
    // Log all files in the archive for debugging
    console.log(`[Restore] Archive contains ${directory.files.length} files`);
    
    for (const file of directory.files) {
      // Collect key files for error reporting - include all sql, json, and metadata files
      const lowerPath = file.path.toLowerCase();
      if (file.type === 'File' && (
        lowerPath.endsWith('.sql') || 
        lowerPath.endsWith('.json') ||
        lowerPath.includes('backup') ||
        lowerPath.includes('metadata')
      )) {
        foundFiles.push(file.path);
      }
      
      // Normalize path - handle both "database_backup.sql" and "/database_backup.sql"
      const normalizedPath = file.path.replace(/^\/+/, '');
      const fileName = path.basename(normalizedPath);
      
      if (fileName === "database_backup.sql" && !sqlFile) {
        console.log(`[Restore] Found SQL backup at: ${file.path}`);
        const sqlPath = path.join(tempDir, `restore_${timestamp}.sql`);
        const content = await file.buffer();
        fs.writeFileSync(sqlPath, content);
        sqlFile = sqlPath;
      } else if (fileName === "backup_metadata.json" && !metadata) {
        console.log(`[Restore] Found metadata at: ${file.path}`);
        const content = await file.buffer();
        metadata = JSON.parse(content.toString());
      } else if (fileName === "database_backup.json" && !legacyJson) {
        console.log(`[Restore] Found legacy JSON backup at: ${file.path}`);
        const content = await file.buffer();
        legacyJson = JSON.parse(content.toString());
      }
    }
    
    if (!sqlFile && !legacyJson) {
      console.log(`[Restore] No database backup found. Top-level files: ${foundFiles.slice(0, 20).join(', ')}`);
    }
    
    return { sqlFile, metadata, legacyJson, foundFiles };
  } catch (error) {
    console.error("Failed to extract backup:", error);
    return { sqlFile: null, metadata: null, legacyJson: null, foundFiles };
  }
}

export async function restorePgBackup(
  sqlFile: string,
  options: { disableForeignKeys?: boolean; isCleanBackup?: boolean } = {}
): Promise<{
  success: boolean;
  error?: string;
  warnings: string[];
  tablesRestored?: number;
}> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return {
      success: false,
      error: "DATABASE_URL not configured",
      warnings: [],
    };
  }
  
  const params = parseConnectionString(connectionString);
  const warnings: string[] = [];
  let tablesRestored = 0;
  
  if (options.disableForeignKeys) {
    // Read the original SQL file and wrap it with FK disable/enable in a single session
    const originalSql = fs.readFileSync(sqlFile, "utf8");
    const wrappedScript = path.join(os.tmpdir(), `wrapped_restore_${Date.now()}.sql`);
    
    // For clean backups (fresh deployments), clear specified tables and disable Turnstile
    // Using TRUNCATE CASCADE is safe since clean backups are for fresh servers with no project schemas
    let clearStatements = "";
    if (options.isCleanBackup) {
      // All tables that need to be cleared before restore
      // Includes both tables to leave empty AND tables that will be repopulated from backup
      const allTablesToClear = [
        ...CLEAN_TABLES_TO_CLEAR,
        // Also clear tables that will be restored from backup to avoid duplicate key errors
        "subrole_permissions",
        "service_types",
        "trouble_codes",
        "work_order_statuses",
        "system_settings",
        "permissions",
        "subroles",
      ];
      
      clearStatements = `-- Clean backup restore: Clear all tables before repopulating from backup
-- Tables in CLEAN_TABLES_TO_CLEAR will remain empty, others will be restored from backup
${allTablesToClear.map(t => `TRUNCATE TABLE public.${t} CASCADE;`).join('\n')}

-- Clear non-system users (keep admin and file_import only)
DELETE FROM public.users WHERE username NOT IN ('admin', 'file_import');

`;
      console.log(`[Restore] Clean backup: Clearing ${allTablesToClear.length} tables before restore`);
    }
    
    // For clean backups, add post-restore commands (like disabling Turnstile)
    let postRestoreStatements = "";
    if (options.isCleanBackup) {
      postRestoreStatements = `
-- Disable Cloudflare Turnstile for fresh deployment (override backup value)
UPDATE public.system_settings SET value = 'false' WHERE key = 'turnstile_enabled';

`;
    }
    
    // Create a single SQL file that disables FKs, runs the restore, and re-enables FKs
    const wrappedSql = `-- Disable foreign key checks for this session
SET session_replication_role = 'replica';

${clearStatements}-- Original restore SQL
${originalSql}
${postRestoreStatements}
-- Re-enable foreign key checks
SET session_replication_role = 'origin';
`;
    
    fs.writeFileSync(wrappedScript, wrappedSql);
    console.log(`[Restore] Created wrapped SQL script (${wrappedSql.length} bytes)`);
    
    // Log a preview of the SQL for debugging
    const lines = wrappedSql.split('\n');
    console.log(`[Restore] SQL script has ${lines.length} lines`);
    if (lines.length > 20) {
      console.log(`[Restore] Last 10 lines of SQL:`);
      lines.slice(-10).forEach((line, i) => {
        console.log(`[Restore]   ${lines.length - 10 + i + 1}: ${line.substring(0, 100)}`);
      });
    }
    
    let restoreSuccess = true;
    let restoreError = "";
    
    try {
      const result = await runPgCommand("psql", [
        "-h", params.host,
        "-p", params.port,
        "-U", params.user,
        "-d", params.database,
        "-f", wrappedScript,
        "-v", "ON_ERROR_STOP=1",
      ], { PGPASSWORD: params.password });
      
      if (result.stderr) {
        const stderrLines = result.stderr.split("\n");
        for (const line of stderrLines) {
          if (line.includes("WARNING") || line.includes("NOTICE")) {
            warnings.push(line);
          } else if (line.includes("DROP TABLE") || line.includes("CREATE TABLE") || line.includes("ALTER TABLE")) {
            tablesRestored++;
          } else if (line.includes("ERROR")) {
            console.error(`[Restore] SQL Error: ${line}`);
          }
        }
      }
      
      if (result.stdout) {
        console.log(`[Restore] psql output: ${result.stdout.substring(0, 500)}`);
      }
      
      if (!result.success) {
        restoreSuccess = false;
        restoreError = result.stderr;
        console.error(`[Restore] Failed: ${restoreError}`);
      } else {
        console.log(`[Restore] SQL execution completed successfully`);
      }
    } finally {
      if (fs.existsSync(wrappedScript)) fs.unlinkSync(wrappedScript);
    }
    
    if (!restoreSuccess) {
      return { success: false, error: restoreError, warnings, tablesRestored };
    }
    
    return { success: true, warnings, tablesRestored };
  }
  
  const result = await pgRestore(connectionString, sqlFile, { singleTransaction: true });
  return { ...result, tablesRestored };
}

export async function restoreFilesFromPgArchive(
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

export async function restoreWebAppFilesFromArchive(
  zipBuffer: Buffer,
  targetPath: string
): Promise<{ filesRestored: number; errors: string[] }> {
  let filesRestored = 0;
  const errors: string[] = [];
  
  try {
    const directory = await unzipper.Open.buffer(zipBuffer);
    
    for (const file of directory.files) {
      if (file.path.startsWith("webapp_files/") && file.type === "File") {
        const relativePath = file.path.replace("webapp_files/", "");
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
