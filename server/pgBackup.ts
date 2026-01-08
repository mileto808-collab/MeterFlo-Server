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

export type BackupType = "database" | "full" | "files";

export async function createPgBackupArchive(res: any, backupType: BackupType = "full"): Promise<void> {
  console.log(`[Backup] Starting backup (type: ${backupType})...`);
  
  // Backup types:
  // - "database": Database only
  // - "full": Database + web app source files + project files (everything)
  // - "files": Web app source files only (excluding project files directory)
  
  const includeDatabase = backupType === "database" || backupType === "full";
  const includeWebAppFiles = backupType === "files" || backupType === "full";
  const includeProjectFiles = backupType === "full"; // Only full backup includes project files
  
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
  
  const projectFilesPath = await getProjectFilesPath();
  const projectFilesExist = fs.existsSync(projectFilesPath);
  const appDir = process.cwd();
  const skippedFiles: string[] = [];
  
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
  
  const filenamePrefix = backupType === "database" ? "db_backup" : 
                         backupType === "files" ? "webapp_backup" : "full_backup";
  
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filenamePrefix}_${new Date().toISOString().slice(0, 10)}.zip"`
  );
  
  archive.pipe(res);
  
  // Add database backup
  if (includeDatabase && backupResult) {
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
    version: "2.1",
    format: backupType === "database" ? "pg_dump_sql" : 
            backupType === "files" ? "webapp_files_only" : "full_system",
    backupType,
    backupDate: backupResult?.backupDate || new Date().toISOString(),
    schemas: backupResult?.schemas,
    postgresVersion: includeDatabase ? await getPostgresVersion() : undefined,
    includesWebAppFiles: includeWebAppFiles,
    includesProjectFiles: includeProjectFiles,
    includesDatabase: includeDatabase,
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
  backupType?: "database" | "full" | "files";
  backupDate: string;
  schemas?: string[];
  postgresVersion?: string;
}

export async function extractBackupFromArchive(zipBuffer: Buffer): Promise<{
  sqlFile: string | null;
  metadata: BackupMetadata | null;
  legacyJson: any | null;
}> {
  const tempDir = os.tmpdir();
  const timestamp = Date.now();
  let sqlFile: string | null = null;
  let metadata: BackupMetadata | null = null;
  let legacyJson: any | null = null;
  
  try {
    const directory = await unzipper.Open.buffer(zipBuffer);
    
    for (const file of directory.files) {
      if (file.path === "database_backup.sql") {
        const sqlPath = path.join(tempDir, `restore_${timestamp}.sql`);
        const content = await file.buffer();
        fs.writeFileSync(sqlPath, content);
        sqlFile = sqlPath;
      } else if (file.path === "backup_metadata.json") {
        const content = await file.buffer();
        metadata = JSON.parse(content.toString());
      } else if (file.path === "database_backup.json") {
        const content = await file.buffer();
        legacyJson = JSON.parse(content.toString());
      }
    }
    
    return { sqlFile, metadata, legacyJson };
  } catch (error) {
    console.error("Failed to extract backup:", error);
    return { sqlFile: null, metadata: null, legacyJson: null };
  }
}

export async function restorePgBackup(
  sqlFile: string,
  options: { disableForeignKeys?: boolean } = {}
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
    const preScript = path.join(os.tmpdir(), `pre_restore_${Date.now()}.sql`);
    const postScript = path.join(os.tmpdir(), `post_restore_${Date.now()}.sql`);
    
    fs.writeFileSync(preScript, `SET session_replication_role = 'replica';`);
    fs.writeFileSync(postScript, `SET session_replication_role = 'origin';`);
    
    let restoreSuccess = true;
    let restoreError = "";
    
    try {
      let result = await runPgCommand("psql", [
        "-h", params.host,
        "-p", params.port,
        "-U", params.user,
        "-d", params.database,
        "-f", preScript,
      ], { PGPASSWORD: params.password });
      
      if (!result.success) {
        return { success: false, error: "Failed to disable foreign keys: " + result.stderr, warnings };
      }
      
      result = await runPgCommand("psql", [
        "-h", params.host,
        "-p", params.port,
        "-U", params.user,
        "-d", params.database,
        "-f", sqlFile,
      ], { PGPASSWORD: params.password });
      
      if (result.stderr) {
        const lines = result.stderr.split("\n");
        for (const line of lines) {
          if (line.includes("WARNING") || line.includes("NOTICE")) {
            warnings.push(line);
          } else if (line.includes("DROP TABLE") || line.includes("CREATE TABLE") || line.includes("ALTER TABLE")) {
            tablesRestored++;
          }
        }
      }
      
      if (!result.success) {
        restoreSuccess = false;
        restoreError = result.stderr;
      }
    } finally {
      await runPgCommand("psql", [
        "-h", params.host,
        "-p", params.port,
        "-U", params.user,
        "-d", params.database,
        "-f", postScript,
      ], { PGPASSWORD: params.password });
      
      if (fs.existsSync(preScript)) fs.unlinkSync(preScript);
      if (fs.existsSync(postScript)) fs.unlinkSync(postScript);
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
