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
  try {
    const whichResult = execSync(`which ${toolName}`, { encoding: "utf-8" }).trim();
    if (whichResult) return whichResult;
  } catch {}
  
  const commonPaths = [
    `/usr/bin/${toolName}`,
    `/usr/local/bin/${toolName}`,
    `/usr/lib/postgresql/14/bin/${toolName}`,
    `/usr/lib/postgresql/15/bin/${toolName}`,
    `/usr/lib/postgresql/16/bin/${toolName}`,
  ];
  
  for (const p of commonPaths) {
    if (fs.existsSync(p)) return p;
  }
  
  return toolName;
}

async function runPgCommand(
  command: string,
  args: string[],
  env: Record<string, string>,
  outputFile?: string
): Promise<{ success: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const toolPath = getPgToolPath(command);
    let stdout = "";
    let stderr = "";
    
    const options: any = {
      env: { ...process.env, ...env },
      stdio: outputFile ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    };
    
    const proc = spawn(toolPath, args, options);
    
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
    
    proc.on("error", (err) => {
      if (outputStream) {
        outputStream.close();
      }
      resolve({
        success: false,
        stdout,
        stderr: stderr + "\n" + err.message,
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

export async function createPgBackupArchive(res: any): Promise<void> {
  const backupResult = await createPgBackup();
  
  if (!backupResult.success) {
    throw new Error(backupResult.error || "Failed to create database backup");
  }
  
  const filesPath = await getProjectFilesPath();
  const filesExist = fs.existsSync(filesPath);
  
  const archive = archiver("zip", { zlib: { level: 9 } });
  
  archive.on("error", (err) => {
    console.error("Archive error:", err);
    if (fs.existsSync(backupResult.backupFile)) {
      fs.unlinkSync(backupResult.backupFile);
    }
    throw err;
  });
  
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="full_backup_${new Date().toISOString().slice(0, 10)}.zip"`
  );
  
  archive.pipe(res);
  
  archive.file(backupResult.backupFile, { name: "database_backup.sql" });
  
  const metadata = {
    version: "2.0",
    format: "pg_dump_sql",
    backupDate: backupResult.backupDate,
    schemas: backupResult.schemas,
    postgresVersion: await getPostgresVersion(),
  };
  archive.append(JSON.stringify(metadata, null, 2), { name: "backup_metadata.json" });
  
  if (filesPath && filesExist) {
    archive.directory(filesPath, "project_files");
  }
  
  await archive.finalize();
  
  if (fs.existsSync(backupResult.backupFile)) {
    fs.unlinkSync(backupResult.backupFile);
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
  backupDate: string;
  schemas: string[];
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
