import * as fs from "fs/promises";
import * as path from "path";
import { storage } from "./storage";

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
export function getProjectDirectoryName(projectName: string, projectId: number): string {
  const sanitized = projectName
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return `${sanitized}_${projectId}`;
}

// Ensure the project files root directory exists
export async function ensureProjectFilesRoot(): Promise<string> {
  const rootPath = await getProjectFilesPath();
  try {
    await fs.mkdir(rootPath, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
  return rootPath;
}

// Ensure a project directory exists
export async function ensureProjectDirectory(projectName: string, projectId: number): Promise<string> {
  const rootPath = await ensureProjectFilesRoot();
  const projectDir = getProjectDirectoryName(projectName, projectId);
  const fullPath = path.join(rootPath, projectDir);
  
  try {
    await fs.mkdir(fullPath, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
  
  return fullPath;
}

// Ensure a work order directory exists within a project
// Uses customerWoId (the customer's work order identifier) for the folder name
// If legacyWorkOrderId is provided, checks for legacy folder first for backward compatibility
export async function ensureWorkOrderDirectory(
  projectName: string,
  projectId: number,
  customerWoId: string,
  legacyWorkOrderId?: number
): Promise<string> {
  const projectPath = await ensureProjectDirectory(projectName, projectId);
  
  // Sanitize customerWoId for use as folder name
  const sanitizedWoId = customerWoId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const newWorkOrderDir = path.join(projectPath, sanitizedWoId);
  
  // Check if legacy folder exists (for backward compatibility)
  if (legacyWorkOrderId !== undefined) {
    const legacyWorkOrderDir = path.join(projectPath, String(legacyWorkOrderId));
    try {
      await fs.access(legacyWorkOrderDir);
      // Legacy folder exists, use it for backward compatibility
      return legacyWorkOrderDir;
    } catch {
      // Legacy folder doesn't exist, continue with new folder name
    }
  }
  
  try {
    await fs.mkdir(newWorkOrderDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
  
  return newWorkOrderDir;
}

// Save a file to a work order directory
export async function saveWorkOrderFile(
  projectName: string,
  projectId: number,
  customerWoId: string,
  filename: string,
  buffer: Buffer,
  legacyWorkOrderId?: number
): Promise<string> {
  const workOrderDir = await ensureWorkOrderDirectory(projectName, projectId, customerWoId, legacyWorkOrderId);
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(workOrderDir, sanitizedFilename);
  
  await fs.writeFile(filePath, buffer);
  
  return filePath;
}

// Get list of files in a work order directory
export async function getWorkOrderFiles(
  projectName: string,
  projectId: number,
  customerWoId: string,
  legacyWorkOrderId?: number
): Promise<string[]> {
  const workOrderDir = await ensureWorkOrderDirectory(projectName, projectId, customerWoId, legacyWorkOrderId);
  
  try {
    const files = await fs.readdir(workOrderDir);
    return files;
  } catch (error) {
    return [];
  }
}

// Delete a file from a work order directory
export async function deleteWorkOrderFile(
  projectName: string,
  projectId: number,
  customerWoId: string,
  filename: string,
  legacyWorkOrderId?: number
): Promise<boolean> {
  const workOrderDir = await ensureWorkOrderDirectory(projectName, projectId, customerWoId, legacyWorkOrderId);
  const filePath = path.join(workOrderDir, filename);
  
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
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
  legacyWorkOrderId?: number
): Promise<string | null> {
  const workOrderDir = await ensureWorkOrderDirectory(projectName, projectId, customerWoId, legacyWorkOrderId);
  const filePath = path.join(workOrderDir, filename);
  
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
  
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    return false;
  }
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
  
  await fs.writeFile(filePath, buffer);
  
  return filePath;
}

// === PROJECT-LEVEL FILE FUNCTIONS ===

// Ensure project documents folder exists (separate from work order folders)
export async function ensureProjectDocumentsDirectory(projectName: string, projectId: number): Promise<string> {
  const projectPath = await ensureProjectDirectory(projectName, projectId);
  const docsDir = path.join(projectPath, "_project_documents");
  
  try {
    await fs.mkdir(docsDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
  
  return docsDir;
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
  
  await fs.writeFile(filePath, buffer);
  
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
  
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    return false;
  }
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
