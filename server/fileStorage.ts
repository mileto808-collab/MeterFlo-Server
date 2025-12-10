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
export async function ensureWorkOrderDirectory(
  projectName: string,
  projectId: number,
  workOrderId: number
): Promise<string> {
  const projectPath = await ensureProjectDirectory(projectName, projectId);
  const workOrderDir = path.join(projectPath, String(workOrderId));
  
  try {
    await fs.mkdir(workOrderDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
  
  return workOrderDir;
}

// Save a file to a work order directory
export async function saveWorkOrderFile(
  projectName: string,
  projectId: number,
  workOrderId: number,
  filename: string,
  buffer: Buffer
): Promise<string> {
  const workOrderDir = await ensureWorkOrderDirectory(projectName, projectId, workOrderId);
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = path.join(workOrderDir, sanitizedFilename);
  
  await fs.writeFile(filePath, buffer);
  
  return filePath;
}

// Get list of files in a work order directory
export async function getWorkOrderFiles(
  projectName: string,
  projectId: number,
  workOrderId: number
): Promise<string[]> {
  const workOrderDir = await ensureWorkOrderDirectory(projectName, projectId, workOrderId);
  
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
  workOrderId: number,
  filename: string
): Promise<boolean> {
  const workOrderDir = await ensureWorkOrderDirectory(projectName, projectId, workOrderId);
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
  workOrderId: number,
  filename: string
): Promise<string | null> {
  const workOrderDir = await ensureWorkOrderDirectory(projectName, projectId, workOrderId);
  const filePath = path.join(workOrderDir, filename);
  
  try {
    await fs.access(filePath);
    return filePath;
  } catch (error) {
    return null;
  }
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
