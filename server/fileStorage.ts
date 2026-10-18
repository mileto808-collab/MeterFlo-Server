import * as fs from "fs/promises";
import * as path from "path";
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
  const rootPath = await ensureProjectFilesRoot();
  const oldDirName = getProjectDirectoryName(oldProjectName, projectId);
  const newDirName = getProjectDirectoryName(newProjectName, projectId);
  
  // If names are the same after sanitization, no rename needed
  if (oldDirName === newDirName) {
    return true;
  }
  
  const oldPath = path.join(rootPath, oldDirName);
  const newPath = path.join(rootPath, newDirName);
  
  try {
    // Check if old directory exists
    await fs.access(oldPath);
    // Rename the directory
    await fs.rename(oldPath, newPath);
    return true;
  } catch (error) {
    // Old directory doesn't exist or rename failed
    // Try to ensure the new directory exists instead
    try {
      await fs.mkdir(newPath, { recursive: true });
      return true;
    } catch {
      return false;
    }
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
  const projectPath = await ensureProjectDirectory(projectName, projectId);
  const ftpDir = path.join(projectPath, "Project FTP Files");
  
  try {
    await fs.mkdir(ftpDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
  
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
