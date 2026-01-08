import * as cron from "node-cron";
import { storage } from "./storage";
import { getProjectWorkOrderStorage } from "./projectDb";
import { insertProjectWorkOrderSchema } from "@shared/schema";
import { getProjectFtpFiles, getProjectFtpFilePath } from "./fileStorage";
import * as fs from "fs";
import * as XLSX from "xlsx";

class FileImportScheduler {
  private scheduledTasks: Map<number, cron.ScheduledTask> = new Map();

  async initialize() {
    console.log("[FileImportScheduler] Initializing scheduled file imports...");
    await this.loadAllSchedules();
  }

  private async loadAllSchedules() {
    try {
      const activeConfigs = await storage.getAllEnabledFileImportConfigs();
      console.log(`[FileImportScheduler] Found ${activeConfigs.length} active file import configurations`);

      for (const config of activeConfigs) {
        if (config.scheduleFrequency && config.scheduleFrequency !== "manual") {
          this.scheduleImport(config);
        }
      }
    } catch (error) {
      console.error("[FileImportScheduler] Error loading schedules:", error);
    }
  }

  private getCronExpression(frequency: string, customCron?: string | null): string | null {
    switch (frequency) {
      case "manual":
        return null;
      case "every_15_minutes":
        return "*/15 * * * *";
      case "every_30_minutes":
        return "*/30 * * * *";
      case "hourly":
        return "0 * * * *";
      case "every_2_hours":
        return "0 */2 * * *";
      case "every_6_hours":
        return "0 */6 * * *";
      case "every_12_hours":
        return "0 */12 * * *";
      case "daily":
        return "0 0 * * *";
      case "weekly":
        return "0 0 * * 0";
      case "monthly":
        return "0 0 1 * *";
      case "custom":
        return customCron || null;
      default:
        return null;
    }
  }

  scheduleImport(config: {
    id: number;
    name: string;
    scheduleFrequency: string | null;
    customCronExpression?: string | null;
  }) {
    this.cancelSchedule(config.id);

    if (!config.scheduleFrequency || config.scheduleFrequency === "manual") {
      return;
    }

    const cronExpression = this.getCronExpression(config.scheduleFrequency, config.customCronExpression);
    if (!cronExpression) {
      console.warn(`[FileImportScheduler] Invalid schedule frequency for config ${config.id}: ${config.scheduleFrequency}`);
      return;
    }

    if (!cron.validate(cronExpression)) {
      console.warn(`[FileImportScheduler] Invalid cron expression for config ${config.id}: ${cronExpression}`);
      return;
    }

    console.log(`[FileImportScheduler] Scheduling file import "${config.name}" (ID: ${config.id}) with cron: ${cronExpression}`);

    const task = cron.schedule(cronExpression, async () => {
      console.log(`[FileImportScheduler] Running scheduled file import "${config.name}" (ID: ${config.id})`);
      await this.runImport(config.id);
    });

    this.scheduledTasks.set(config.id, task);
  }

  cancelSchedule(configId: number) {
    const existingTask = this.scheduledTasks.get(configId);
    if (existingTask) {
      existingTask.stop();
      this.scheduledTasks.delete(configId);
      console.log(`[FileImportScheduler] Cancelled schedule for config ${configId}`);
    }
  }

  async runImport(configId: number): Promise<{
    success: boolean;
    imported: number;
    failed: number;
    error?: string;
    fileName?: string;
  }> {
    const startTime = Date.now();

    try {
      const importConfig = await storage.getFileImportConfig(configId);
      if (!importConfig || !importConfig.isEnabled) {
        return { success: false, imported: 0, failed: 0, error: "File import configuration not found or disabled" };
      }

      const project = await storage.getProject(importConfig.projectId);
      if (!project || !project.databaseName) {
        await storage.updateFileImportConfigLastRun(configId, "failed", "Project not found or has no database", 0, null);
        return { success: false, imported: 0, failed: 0, error: "Project not found or has no database" };
      }

      const ftpFiles = await getProjectFtpFiles(project.name, project.id);
      if (ftpFiles.length === 0) {
        await storage.updateFileImportConfigLastRun(configId, "skipped", "No files in FTP directory", 0, null);
        return { success: true, imported: 0, failed: 0, error: "No files in FTP directory" };
      }

      const sortedFiles = ftpFiles.sort((a, b) => 
        new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
      );
      const latestFile = sortedFiles[0];

      if (importConfig.lastProcessedFile === latestFile.name) {
        console.log(`[FileImportScheduler] Skipping already processed file: ${latestFile.name}`);
        return { success: true, imported: 0, failed: 0, error: "No new files to process" };
      }

      const filePath = await getProjectFtpFilePath(project.name, project.id, latestFile.name);
      if (!filePath) {
        await storage.updateFileImportConfigLastRun(configId, "failed", "File not found", 0, null);
        return { success: false, imported: 0, failed: 0, error: "File not found" };
      }

      const historyEntry = await storage.createFileImportHistoryEntry(
        configId, 
        latestFile.name, 
        "running",
        importConfig.projectId,
        "scheduled_file",
        "system"
      );

      // Track the actual filename (might be renamed after processing)
      let processedFileName = latestFile.name;

      try {
        const fileContent = fs.readFileSync(filePath);
        let rows: Record<string, any>[] = [];

        const ext = latestFile.name.toLowerCase().split('.').pop();
        if (ext === 'xlsx' || ext === 'xls') {
          const workbook = XLSX.read(fileContent, { type: "buffer" });
          const sheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[sheetName];
          rows = XLSX.utils.sheet_to_json(sheet, { raw: false });
        } else if (ext === 'json') {
          // Parse JSON file
          const text = fileContent.toString("utf-8");
          try {
            const parsed = JSON.parse(text);
            // Handle both array of objects and object with data array
            if (Array.isArray(parsed)) {
              rows = parsed;
            } else if (parsed.data && Array.isArray(parsed.data)) {
              rows = parsed.data;
            } else if (parsed.workOrders && Array.isArray(parsed.workOrders)) {
              rows = parsed.workOrders;
            } else if (parsed.records && Array.isArray(parsed.records)) {
              rows = parsed.records;
            } else {
              // Single object - wrap in array
              rows = [parsed];
            }
          } catch (parseError: any) {
            await storage.updateFileImportHistoryEntry(historyEntry.id, "failed", 0, 0, "Invalid JSON format");
            await storage.updateFileImportConfigLastRun(configId, "failed", "Invalid JSON format", 0, latestFile.name);
            return { success: false, imported: 0, failed: 0, error: "Invalid JSON format", fileName: latestFile.name };
          }
        } else {
          // CSV parsing
          const delimiter = importConfig.delimiter || ",";
          const hasHeader = importConfig.hasHeader !== false;
          const text = fileContent.toString("utf-8");
          const lines = text.split(/\r?\n/).filter(line => line.trim());
          
          if (lines.length === 0) {
            await storage.updateFileImportHistoryEntry(historyEntry.id, "failed", 0, 0, "Empty file");
            await storage.updateFileImportConfigLastRun(configId, "failed", "Empty file", 0, latestFile.name);
            return { success: false, imported: 0, failed: 0, error: "Empty file", fileName: latestFile.name };
          }

          let headers: string[];
          let dataLines: string[];

          if (hasHeader) {
            headers = lines[0].split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
            dataLines = lines.slice(1);
          } else {
            headers = lines[0].split(delimiter).map((_, i) => `column_${i}`);
            dataLines = lines;
          }

          rows = dataLines.map(line => {
            const values = line.split(delimiter).map(v => v.trim().replace(/^"|"$/g, ''));
            const row: Record<string, any> = {};
            headers.forEach((header, i) => {
              row[header] = values[i] || '';
            });
            return row;
          });
        }

        const workOrderStorage = await getProjectWorkOrderStorage(project.databaseName);
        const columnMapping = (importConfig.columnMapping as Record<string, string>) || {};

        let imported = 0;
        let failed = 0;
        const errors: string[] = [];

        for (const row of rows) {
          try {
            const mappedData: Record<string, any> = {};
            // columnMapping is stored as {targetField: sourceCol}
            // e.g., {"customerWoId": "customer_wo_id", ...}
            for (const [targetField, sourceCol] of Object.entries(columnMapping)) {
              if (sourceCol && row[sourceCol] !== undefined) {
                mappedData[targetField] = row[sourceCol];
              }
            }

            if (!mappedData.customerWoId || !mappedData.customerId || !mappedData.customerName || !mappedData.address || !mappedData.serviceType) {
              failed++;
              errors.push(`Row missing required fields: ${JSON.stringify(row).slice(0, 100)}`);
              continue;
            }

            const serviceType = String(mappedData.serviceType);
            if (!["Water", "Electric", "Gas"].includes(serviceType)) {
              mappedData.serviceType = "Water";
            }

            if (mappedData.oldSystemReading) {
              mappedData.oldSystemReading = parseInt(String(mappedData.oldSystemReading)) || null;
            }
            if (mappedData.oldMeterReading) {
              mappedData.oldSystemReading = parseInt(String(mappedData.oldMeterReading)) || null;
              delete mappedData.oldMeterReading;
            }
            if (mappedData.newSystemReading) {
              mappedData.newSystemReading = parseInt(String(mappedData.newSystemReading)) || null;
            }
            if (mappedData.newMeterReading) {
              mappedData.newSystemReading = parseInt(String(mappedData.newMeterReading)) || null;
              delete mappedData.newMeterReading;
            }
            if (mappedData.oldMeterId) {
              mappedData.oldSystemId = mappedData.oldMeterId;
              delete mappedData.oldMeterId;
            }
            if (mappedData.newMeterId) {
              mappedData.newSystemId = mappedData.newMeterId;
              delete mappedData.newMeterId;
            }

            // Set default status and createdBy
            mappedData.createdBy = "file_import";

            const existingWo = await workOrderStorage.getWorkOrderByCustomerWoId(mappedData.customerWoId);
            if (existingWo) {
              await workOrderStorage.updateWorkOrder(existingWo.id, mappedData);
            } else {
              // Create clean data with explicit status (must be string, not null)
              const cleanedData: Record<string, any> = { ...mappedData };
              // Ensure status is a string
              cleanedData.status = typeof cleanedData.status === 'string' && cleanedData.status.length > 0 
                ? cleanedData.status 
                : "Open";
              // Remove any null values that might cause validation issues
              Object.keys(cleanedData).forEach(key => {
                if (cleanedData[key] === null) {
                  delete cleanedData[key];
                }
              });
              const validated = insertProjectWorkOrderSchema.parse(cleanedData);
              // Cast to bypass type issue - we've already ensured status is a string
              await workOrderStorage.createWorkOrder(validated as any);
            }
            imported++;
          } catch (rowError: any) {
            failed++;
            errors.push(`Row error: ${rowError.message?.slice(0, 100) || "Unknown error"}`);
          }
        }

        const status = failed === 0 ? "success" : (imported > 0 ? "partial" : "failed");
        const duration = Date.now() - startTime;

        // Rename processed file with _completed_YYYY-MM-DD suffix if any records were imported
        if (imported > 0) {
          try {
            const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const fileExt = latestFile.name.includes('.') ? '.' + latestFile.name.split('.').pop() : '';
            const baseName = latestFile.name.replace(/\.[^.]+$/, '');
            const newFileName = `${baseName}_completed_${dateStr}${fileExt}`;
            const newFilePath = filePath.replace(latestFile.name, newFileName);
            
            fs.renameSync(filePath, newFilePath);
            processedFileName = newFileName; // Update the tracked filename after successful rename
            console.log(`[FileImportScheduler] Renamed processed file to: ${newFileName}`);
          } catch (renameError: any) {
            // If rename fails, still use original filename to prevent reprocessing
            console.warn(`[FileImportScheduler] Could not rename file (will still mark as processed): ${renameError.message}`);
          }
        }

        const message = `Imported ${imported} records, ${failed} failed from ${processedFileName}`;
        await storage.updateFileImportHistoryEntry(historyEntry.id, status, imported, failed, errors.length > 0 ? errors.slice(0, 10).join("\n") : null);
        await storage.updateFileImportConfigLastRun(configId, status, message, imported, processedFileName);

        console.log(`[FileImportScheduler] File import "${importConfig.name}" completed: ${message} (${duration}ms)`);

        return { success: true, imported, failed, fileName: latestFile.name };
      } catch (importError: any) {
        // Use processedFileName (which may have been renamed) to ensure we don't reprocess
        await storage.updateFileImportHistoryEntry(historyEntry.id, "failed", 0, 0, importError.message);
        await storage.updateFileImportConfigLastRun(configId, "failed", importError.message, 0, processedFileName);
        return { success: false, imported: 0, failed: 0, error: importError.message, fileName: processedFileName };
      }
    } catch (error: any) {
      console.error(`[FileImportScheduler] Error running file import ${configId}:`, error);
      return { success: false, imported: 0, failed: 0, error: error.message };
    }
  }

  async refreshSchedule(configId: number) {
    const config = await storage.getFileImportConfig(configId);
    if (config && config.isEnabled) {
      this.scheduleImport({
        id: config.id,
        name: config.name,
        scheduleFrequency: config.scheduleFrequency,
        customCronExpression: config.customCronExpression,
      });
    } else {
      this.cancelSchedule(configId);
    }
  }

  getScheduleStatus(configId: number): { isScheduled: boolean } {
    return { isScheduled: this.scheduledTasks.has(configId) };
  }
}

export const fileImportScheduler = new FileImportScheduler();
