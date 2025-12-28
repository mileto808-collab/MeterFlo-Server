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
  
  try {
    await fs.mkdir(workOrdersDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
  
  return workOrdersDir;
}

// Helper function to migrate files from legacy folder to new folder
async function migrateWorkOrderFiles(legacyDir: string, newDir: string): Promise<void> {
  try {
    // Ensure destination exists
    await fs.mkdir(newDir, { recursive: true });
    
    const legacyItems = await fs.readdir(legacyDir);
    for (const item of legacyItems) {
      const sourcePath = path.join(legacyDir, item);
      const destPath = path.join(newDir, item);
      
      // Check if item is a directory
      const stats = await fs.stat(sourcePath);
      
      if (stats.isDirectory()) {
        // Recursively migrate subdirectories
        await migrateWorkOrderFiles(sourcePath, destPath);
      } else {
        // Check if destination file already exists
        let destExists = false;
        try {
          await fs.access(destPath);
          destExists = true;
        } catch {
          // Destination doesn't exist
        }
        
        if (destExists) {
          // File exists in new folder - delete the legacy copy (keep the new one)
          try {
            await fs.unlink(sourcePath);
          } catch (unlinkError) {
            console.error(`Failed to remove duplicate legacy file ${item}:`, unlinkError);
          }
        } else {
          // File doesn't exist in new folder, move it
          try {
            await fs.rename(sourcePath, destPath);
          } catch (moveError) {
            console.error(`Failed to migrate file ${item} from legacy work order folder:`, moveError);
          }
        }
      }
    }
    
    // Try to remove legacy folder if empty
    try {
      const remainingItems = await fs.readdir(legacyDir);
      if (remainingItems.length === 0) {
        await fs.rmdir(legacyDir);
        console.log(`Removed empty legacy work order folder: ${legacyDir}`);
      }
    } catch {
      // Folder may not be empty or removal failed - leave it
    }
  } catch (error) {
    console.error(`Failed to migrate legacy work order folder: ${legacyDir}`, error);
  }
}

// Ensure a work order directory exists within a project
// Uses customerWoId (the customer's work order identifier) for the folder name
// If legacyWorkOrderId is provided, checks for legacy folder first for backward compatibility
// Work order folders are now stored under "Work Orders/" parent folder
// Legacy folders at project root are automatically migrated to the new location
export async function ensureWorkOrderDirectory(
  projectName: string,
  projectId: number,
  customerWoId: string,
  legacyWorkOrderId?: number
): Promise<string> {
  const projectPath = await ensureProjectDirectory(projectName, projectId);
  const workOrdersParent = await ensureWorkOrdersParentDirectory(projectName, projectId);
  
  // Sanitize customerWoId for use as folder name
  const sanitizedWoId = customerWoId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const newWorkOrderDir = path.join(workOrdersParent, sanitizedWoId);
  
  // Check for legacy folders at project root and migrate if needed
  // Legacy location 1: project root with numeric ID (oldest format)
  if (legacyWorkOrderId !== undefined) {
    const legacyNumericDir = path.join(projectPath, String(legacyWorkOrderId));
    const migratedNumericDir = path.join(workOrdersParent, String(legacyWorkOrderId));
    
    let legacyNumericExists = false;
    try {
      await fs.access(legacyNumericDir);
      legacyNumericExists = true;
    } catch {
      // Legacy doesn't exist
    }
    
    if (legacyNumericExists) {
      // Legacy numeric folder exists - migrate files and use the migrated location
      await migrateWorkOrderFiles(legacyNumericDir, migratedNumericDir);
      return migratedNumericDir;
    }
    
    // Check if already migrated with numeric ID
    try {
      await fs.access(migratedNumericDir);
      return migratedNumericDir;
    } catch {
      // Not in migrated location either, continue
    }
  }
  
  // Legacy location 2: project root with customerWoId (previous format)
  const legacyWoIdDir = path.join(projectPath, sanitizedWoId);
  
  let legacyWoIdExists = false;
  try {
    await fs.access(legacyWoIdDir);
    legacyWoIdExists = true;
  } catch {
    // Legacy doesn't exist
  }
  
  if (legacyWoIdExists) {
    // Legacy customerWoId folder exists - migrate files
    await migrateWorkOrderFiles(legacyWoIdDir, newWorkOrderDir);
    return newWorkOrderDir;
  }
  
  // Create new work order directory in the Work Orders parent folder
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

// Delete entire work order directory (all files and subdirectories)
export async function deleteWorkOrderDirectory(
  projectName: string,
  projectId: number,
  customerWoId: string,
  legacyWorkOrderId?: number
): Promise<boolean> {
  const workOrdersParent = await ensureWorkOrdersParentDirectory(projectName, projectId);
  const projectPath = await ensureProjectDirectory(projectName, projectId);
  const sanitizedWoId = customerWoId.replace(/[^a-zA-Z0-9._-]/g, "_");
  
  // Check if customerWoId is actually the numeric ID (fallback case when no real customerWoId exists)
  const isNumericFallback = legacyWorkOrderId !== undefined && sanitizedWoId === String(legacyWorkOrderId);
  
  try {
    // Delete the primary work order directory
    const workOrderDir = path.join(workOrdersParent, sanitizedWoId);
    await fs.rm(workOrderDir, { recursive: true, force: true });
    
    // Only check legacy locations if customerWoId is a real value (not the numeric fallback)
    if (!isNumericFallback && legacyWorkOrderId !== undefined) {
      // Legacy location 1: numeric ID folder at project root
      const legacyNumericDir = path.join(projectPath, String(legacyWorkOrderId));
      try {
        await fs.rm(legacyNumericDir, { recursive: true, force: true });
      } catch { /* Legacy dir may not exist */ }
      
      // Legacy location 2: migrated numeric ID folder in Work Orders
      const migratedNumericDir = path.join(workOrdersParent, String(legacyWorkOrderId));
      try {
        await fs.rm(migratedNumericDir, { recursive: true, force: true });
      } catch { /* Migrated dir may not exist */ }
    }
    
    // Check for legacy customerWoId folder at project root (oldest format)
    const legacyWoIdDir = path.join(projectPath, sanitizedWoId);
    try {
      await fs.rm(legacyWoIdDir, { recursive: true, force: true });
    } catch { /* Legacy dir may not exist */ }
    
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
// Migrates legacy "_project_documents" folder to "Project Documents" if needed
export async function ensureProjectDocumentsDirectory(projectName: string, projectId: number): Promise<string> {
  const projectPath = await ensureProjectDirectory(projectName, projectId);
  const legacyDocsDir = path.join(projectPath, "_project_documents");
  const newDocsDir = path.join(projectPath, "Project Documents");
  
  // Check if legacy folder exists
  let legacyExists = false;
  try {
    await fs.access(legacyDocsDir);
    legacyExists = true;
  } catch {
    // Legacy folder doesn't exist
  }
  
  // Ensure new folder exists
  try {
    await fs.mkdir(newDocsDir, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
  
  // If legacy folder exists, migrate files from it to new folder
  if (legacyExists) {
    try {
      const legacyFiles = await fs.readdir(legacyDocsDir);
      for (const file of legacyFiles) {
        const sourcePath = path.join(legacyDocsDir, file);
        const destPath = path.join(newDocsDir, file);
        
        // Check if destination file already exists
        try {
          await fs.access(destPath);
          // File exists in new folder, skip to avoid overwriting
        } catch {
          // File doesn't exist in new folder, move it
          try {
            await fs.rename(sourcePath, destPath);
          } catch (moveError) {
            console.error(`Failed to migrate file ${file} from legacy project documents:`, moveError);
          }
        }
      }
      
      // Try to remove legacy folder if empty
      try {
        const remainingFiles = await fs.readdir(legacyDocsDir);
        if (remainingFiles.length === 0) {
          await fs.rmdir(legacyDocsDir);
        }
      } catch {
        // Folder may not be empty or removal failed - leave it
      }
    } catch (error) {
      console.error("Failed to migrate legacy project documents:", error);
    }
  }
  
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
