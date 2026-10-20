import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "node:crypto";
import { storage } from "./storage";
import { writeAuditedFile,deleteAuditedFile,auditFileIdentifier } from "./auditFiles";
import { getProjectDirectoryName, workOrderFolderName, attachmentChild } from "./attachmentPaths";
export { getProjectDirectoryName } from "./attachmentPaths";

// Default project files root directory
const DEFAULT_PROJECT_FILES_PATH = "Project Files";

// Get the configured project files path from settings
export async function getProjectFilesPath(): Promise<string> {
  const setting = await storage.getSetting("project_files_path");
  return setting || DEFAULT_PROJECT_FILES_PATH;
}

// Set the project files path in settings
export async function setProjectFilesPath(newPath: string): Promise<void> {
  await storage.setSetting(
    "project_files_path",
    newPath,
    "Root directory path for project files storage"
  );
}

// An empty override keeps the original Project Files/<project>/Project FTP Files layout.
export async function getFtpFilesPathSetting() {
  const configured = await storage.getSetting("ftp_files_path");
  const root = configured?.trim() || "";
  return { path: root, effectivePath: root || await getProjectFilesPath(), usesProjectFilesPath: !root };
}

export async function getFtpFilesPath(): Promise<string> {
  return (await getFtpFilesPathSetting()).effectivePath;
}

export async function setFtpFilesPath(value: unknown) {
  if (typeof value !== "string" || value.length > 2048 || /[\x00-\x1f]/.test(value))
    throw Object.assign(new Error("Enter a valid server directory path, or leave it empty to use Project Files."), { status: 400 });
  const root = value.trim();
  if (process.platform !== "win32" && (/^[a-z]:[\\/]/i.test(root) || root.startsWith("\\\\")))
    throw Object.assign(new Error("Windows drive and UNC paths can only be used on a Windows server."), { status: 400 });
  const effective = root || await getProjectFilesPath();
  const probe = path.join(effective, `.meterflo-write-check-${randomUUID()}`);
  try {
    await fs.mkdir(effective, { recursive: true });
    await fs.writeFile(probe, "", { flag: "wx" });
    await fs.unlink(probe);
  } catch {
    throw Object.assign(new Error("The server cannot write to this directory. Check the path and service-account permissions."), { status: 400 });
  }
  await storage.setSetting("ftp_files_path", root, "Optional FTP Files root; empty inherits Project Files. Existing files are not moved.");
  return getFtpFilesPathSetting();
}

// Get the directory path for a project
// Ensure the project files root directory exists
export async function ensureProjectFilesRoot(): Promise<string> {
  const rootPath = await getProjectFilesPath();
  await fs.mkdir(rootPath, { recursive: true });
  return rootPath;
}

// Ensure a project directory exists
export async function ensureProjectDirectory(projectName: string, projectId: number): Promise<string> {
  const rootPath = await ensureProjectFilesRoot();
  const projectDir = getProjectDirectoryName(projectName, projectId);
  const fullPath = path.join(rootPath, projectDir);
  
  await fs.mkdir(fullPath, { recursive: true });
  
  return fullPath;
}

// Rename a project directory when project name changes
export async function renameProjectDirectory(
  oldProjectName: string,
  newProjectName: string,
  projectId: number
): Promise<boolean> {
  const roots = [...new Set([path.resolve(await ensureProjectFilesRoot()), path.resolve(await getFtpFilesPath())])];
  const oldDirName = getProjectDirectoryName(oldProjectName, projectId);
  const newDirName = getProjectDirectoryName(newProjectName, projectId);
  
  // If names are the same after sanitization, no rename needed
  if (oldDirName === newDirName) {
    return true;
  }
  
  const moved: [string, string][] = [];
  try {
    for (const root of roots) {
      const oldPath = path.join(root, oldDirName), newPath = path.join(root, newDirName);
      try { await fs.lstat(oldPath); }
      catch (error: any) {
        if (error.code !== "ENOENT") throw error;
        await fs.mkdir(newPath, { recursive: true });
        continue;
      }
      await fs.rename(oldPath, newPath);
      moved.push([oldPath, newPath]);
    }
    return true;
  } catch {
    for (const [oldPath, newPath] of moved.reverse()) await fs.rename(newPath, oldPath);
    return false;
  }
}

// Ensure the Work Orders parent folder exists within a project
export async function ensureWorkOrdersParentDirectory(projectName: string, projectId: number): Promise<string> {
  const projectPath = await ensureProjectDirectory(projectName, projectId);
  const workOrdersDir = path.join(projectPath, "Work Orders");
  
  await fs.mkdir(workOrdersDir, { recursive: true });
  
  return workOrdersDir;
}

// Ensure a work order directory exists within a project
// Uses customerWoId (the customer's work order identifier) for the folder name
export async function ensureWorkOrderDirectory(
  projectName: string,
  projectId: number,
  customerWoId: string
): Promise<string> {
  const workOrdersParent = await ensureWorkOrdersParentDirectory(projectName, projectId);
  const newWorkOrderDir = path.join(workOrdersParent, workOrderFolderName(customerWoId));
  await fs.mkdir(newWorkOrderDir, { recursive: true });
  return newWorkOrderDir;
}

// Save a file to a work order directory
export async function saveWorkOrderFile(
  projectName: string,
  projectId: number,
  customerWoId: string,
  filename: string,
  buffer: Buffer,
  workOrderId?: number
): Promise<string> {
  const workOrderDir = await ensureWorkOrderDirectory(projectName, projectId, customerWoId);
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(workOrderDir, sanitizedFilename);
  
  await writeAuditedFile(filePath,buffer,"workOrderFileUpload",projectId,projectName,
    `${workOrderId ?? customerWoId}:${auditFileIdentifier(sanitizedFilename)}`);
  
  return filePath;
}

// Get list of files in a work order directory
export async function getWorkOrderFiles(
  projectName: string,
  projectId: number,
  customerWoId: string,
  workOrderId?: number
): Promise<string[]> {
  const workOrderDir = await ensureWorkOrderDirectory(projectName, projectId, customerWoId);
  
  try {
    const files = await fs.readdir(workOrderDir);
    return files;
  } catch (error) {
    return [];
  }
}

// Delete a file from a work order directory
// Move reset files out of the visible folder before the database commit.
// A failed reset restores them; a successful reset removes the staging folder.
export async function stageWorkOrderResetFiles(
  projectName: string,
  projectId: number,
  customerWoId: string,
  workOrderId: number,
  deleteAttachments: boolean,
) {
  const directory = await ensureWorkOrderDirectory(projectName, projectId, customerWoId);
  const files = await fs.readdir(directory, { withFileTypes: true });
  const signatureNames = new Set([
    `${customerWoId}-signature.png`.replace(/[^a-zA-Z0-9._-]/g, "_"),
    `${workOrderId}-signature.png`,
    `${path.basename(directory)}-signature.png`,
  ]);
  const selected = files.filter(file => deleteAttachments || signatureNames.has(file.name));
  const staging = await fs.mkdtemp(path.join(path.dirname(directory), ".reset-"));
  const moved: string[] = [];
  const rollback = async () => {
    for (const name of [...moved].reverse()) {
      await fs.rename(path.join(staging, name), path.join(directory, name));
    }
    await fs.rm(staging, { recursive: true, force: true });
  };
  try {
    for (const file of selected) {
      await fs.rename(path.join(directory, file.name), path.join(staging, file.name));
      moved.push(file.name);
    }
  } catch (error) {
    await rollback();
    throw error;
  }
  return {
    removedNames: selected.map(file => file.name),
    rollback,
    commit: () => fs.rm(staging, { recursive: true, force: true }),
  };
}

export async function deleteWorkOrderFile(
  projectName: string,
  projectId: number,
  customerWoId: string,
  filename: string,
  workOrderId?: number
): Promise<boolean> {
  const workOrderDir = await ensureWorkOrderDirectory(projectName, projectId, customerWoId);
  const filePath = attachmentChild(workOrderDir, filename);
  
  return deleteAuditedFile(filePath,"workOrderFileDelete",projectId,projectName,
    `${workOrderId ?? customerWoId}:${auditFileIdentifier(filename)}`);
}

// Delete entire work order directory (all files and subdirectories)
export async function deleteWorkOrderDirectory(
  projectName: string,
  projectId: number,
  customerWoId: string,
  workOrderId?: number
): Promise<boolean> {
  const workOrdersParent = await ensureWorkOrdersParentDirectory(projectName, projectId);
  try {
    const workOrderDir = path.join(workOrdersParent, workOrderFolderName(customerWoId));
    await fs.rm(workOrderDir, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error("Error deleting work order directory:", error);
    return false;
  }
}

// Delete entire project directory
export async function deleteProjectDirectory(projectName: string, projectId: number): Promise<boolean> {
  const rootPath = await getProjectFilesPath();
  const projectDir = getProjectDirectoryName(projectName, projectId);
  const fullPath = path.join(rootPath, projectDir);
  
  try {
    await fs.rm(fullPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    return false;
  }
}

// Get file path for download
export async function getFilePath(
  projectName: string,
  projectId: number,
  customerWoId: string,
  filename: string,
  workOrderId?: number
): Promise<string | null> {
  const workOrderDir = await ensureWorkOrderDirectory(projectName, projectId, customerWoId);
  const filePath = attachmentChild(workOrderDir, filename);
  
  try {
    await fs.access(filePath);
    return filePath;
  } catch (error) {
    return null;
  }
}

// === PROJECT FTP FILES FUNCTIONS ===

// Ensure project FTP files folder exists (for scheduled file imports)
export async function ensureProjectFtpDirectory(projectName: string, projectId: number): Promise<string> {
  const projectPath = path.join(await getFtpFilesPath(), getProjectDirectoryName(projectName, projectId));
  const ftpDir = path.join(projectPath, "Project FTP Files");
  await fs.mkdir(ftpDir, { recursive: true });
  
  return ftpDir;
}

// Get list of files in project FTP directory
export async function getProjectFtpFiles(
  projectName: string,
  projectId: number
): Promise<{ name: string; size: number; modifiedAt: Date }[]> {
  const ftpDir = await ensureProjectFtpDirectory(projectName, projectId);
  
  try {
    const files = await fs.readdir(ftpDir);
    const fileDetails = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(ftpDir, file);
        const stats = await fs.stat(filePath);
        // Only include files, not directories
        if (stats.isFile()) {
          return {
            name: file,
            size: stats.size,
            modifiedAt: stats.mtime,
          };
        }
        return null;
      })
    );
    return fileDetails.filter((f): f is { name: string; size: number; modifiedAt: Date } => f !== null);
  } catch (error) {
    return [];
  }
}

// Get the latest file in project FTP directory (by modification time)
export async function getLatestProjectFtpFile(
  projectName: string,
  projectId: number
): Promise<{ name: string; path: string; size: number; modifiedAt: Date } | null> {
  const ftpDir = await ensureProjectFtpDirectory(projectName, projectId);
  const files = await getProjectFtpFiles(projectName, projectId);
  
  if (files.length === 0) return null;
  
  // Sort by modification time descending and get the most recent
  files.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
  const latestFile = files[0];
  
  return {
    name: latestFile.name,
    path: path.join(ftpDir, latestFile.name),
    size: latestFile.size,
    modifiedAt: latestFile.modifiedAt,
  };
}

// Read file content from FTP directory
export async function readProjectFtpFile(
  projectName: string,
  projectId: number,
  filename: string
): Promise<Buffer | null> {
  const ftpDir = await ensureProjectFtpDirectory(projectName, projectId);
  const filePath = path.join(ftpDir, filename);
  
  try {
    const content = await fs.readFile(filePath);
    return content;
  } catch (error) {
    return null;
  }
}

// Delete a file from project FTP directory
export async function deleteProjectFtpFile(
  projectName: string,
  projectId: number,
  filename: string
): Promise<boolean> {
  const ftpDir = await ensureProjectFtpDirectory(projectName, projectId);
  const filePath = path.join(ftpDir, filename);
  
  return deleteAuditedFile(filePath,"projectFtpDelete",projectId,projectName,auditFileIdentifier(filename));
}

// Get project FTP file path for download
export async function getProjectFtpFilePath(
  projectName: string,
  projectId: number,
  filename: string
): Promise<string | null> {
  const ftpDir = await ensureProjectFtpDirectory(projectName, projectId);
  const filePath = path.join(ftpDir, filename);
  
  try {
    await fs.access(filePath);
    return filePath;
  } catch (error) {
    return null;
  }
}

// Save a file to project FTP directory
export async function saveProjectFtpFile(
  projectName: string,
  projectId: number,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const ftpDir = await ensureProjectFtpDirectory(projectName, projectId);
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(ftpDir, sanitizedFilename);
  
  await writeAuditedFile(filePath,buffer,"projectFtpUpload",projectId,projectName,auditFileIdentifier(sanitizedFilename));
  
  return filePath;
}

// === PROJECT-LEVEL FILE FUNCTIONS ===

// Ensure project documents folder exists (separate from work order folders)
export async function ensureProjectDocumentsDirectory(projectName: string, projectId: number): Promise<string> {
  const projectPath = await ensureProjectDirectory(projectName, projectId);
  const newDocsDir = path.join(projectPath, "Project Documents");
  await fs.mkdir(newDocsDir, { recursive: true });
  return newDocsDir;
}

// Save a file to project documents
export async function saveProjectFile(
  projectName: string,
  projectId: number,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const docsDir = await ensureProjectDocumentsDirectory(projectName, projectId);
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(docsDir, sanitizedFilename);
  
  await writeAuditedFile(filePath,buffer,"projectDocumentUpload",projectId,projectName,auditFileIdentifier(sanitizedFilename));
  
  return filePath;
}

// Get list of files in project documents
export async function getProjectFiles(
  projectName: string,
  projectId: number
): Promise<{ name: string; size: number; modifiedAt: Date }[]> {
  const docsDir = await ensureProjectDocumentsDirectory(projectName, projectId);
  
  try {
    const files = await fs.readdir(docsDir);
    const fileDetails = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(docsDir, file);
        const stats = await fs.stat(filePath);
        return {
          name: file,
          size: stats.size,
          modifiedAt: stats.mtime,
        };
      })
    );
    return fileDetails;
  } catch (error) {
    return [];
  }
}

// Delete a file from project documents
export async function deleteProjectFile(
  projectName: string,
  projectId: number,
  filename: string
): Promise<boolean> {
  const docsDir = await ensureProjectDocumentsDirectory(projectName, projectId);
  const filePath = path.join(docsDir, filename);
  
  return deleteAuditedFile(filePath,"projectDocumentDelete",projectId,projectName,auditFileIdentifier(filename));
}

// Get project file path for download
export async function getProjectFilePath(
  projectName: string,
  projectId: number,
  filename: string
): Promise<string | null> {
  const docsDir = await ensureProjectDocumentsDirectory(projectName, projectId);
  const filePath = path.join(docsDir, filename);
  
  try {
    await fs.access(filePath);
    return filePath;
  } catch (error) {
    return null;
  }
}
