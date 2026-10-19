import * as cron from "node-cron";
import { storage } from "./storage";
import { auditContext, serviceAuditContext, withAuditContext } from "./auditContext";
import { auditedOperation } from "./auditService";
import { getProjectWorkOrderStorage } from "./projectDb";
import { importedVisitScheduling } from "../shared/visitScheduling";
import { insertProjectWorkOrderSchema } from "@shared/schema";
import * as fs from "fs";
import * as XLSX from "xlsx";
import { pool } from "./db";
import { backupLock } from "./backups/lock";
import { importCandidate, rememberImport, generatedImportId } from "./file-transfers/imports";
import { projectZone } from "./file-transfers/exports";
import { TransferError } from "./file-transfers/sftp";

function normalizeColumnName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function createNormalizedRowLookup(row: Record<string, any>): (columnName: string) => any {
  const normalizedMap = new Map<string, any>();
  for (const [key, value] of Object.entries(row)) {
    normalizedMap.set(normalizeColumnName(key), value);
  }
  return (columnName: string) => {
    if (row[columnName] !== undefined) {
      return row[columnName];
    }
    return normalizedMap.get(normalizeColumnName(columnName));
  };
}

class FileImportScheduler {
  private scheduledTasks: Map<number, cron.ScheduledTask> = new Map();
  private fingerprints = new Map<number, string>();
  private refreshing = false;

  async initialize() {
    console.log("[FileImportScheduler] Initializing scheduled file imports...");
    await this.loadAllSchedules();
    setInterval(() => void this.loadAllSchedules(), 60000).unref();
  }

  private async loadAllSchedules() {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      const activeConfigs = await storage.getAllEnabledFileImportConfigs();
      const ids = new Set(activeConfigs.filter(config => config.scheduleFrequency !== "manual").map(config => config.id));
      for (const id of this.scheduledTasks.keys()) if (!ids.has(id)) this.cancelSchedule(id);

      for (const config of activeConfigs) {
        if (config.scheduleFrequency && config.scheduleFrequency !== "manual") {
          await this.scheduleImport(config);
        }
      }
    } catch (error) {
      console.error("[FileImportScheduler] Could not refresh import schedules.");
    } finally { this.refreshing = false; }
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

  async scheduleImport(config: {
    id: number;
    name: string;
    scheduleFrequency: string | null;
    customCronExpression?: string | null;
  }) {
    if (!config.scheduleFrequency || config.scheduleFrequency === "manual") {
      this.cancelSchedule(config.id);
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

    const stored = await storage.getFileImportConfig(config.id);
    if (!stored || !stored.isEnabled) return;
    const timezone = await projectZone(stored.projectId);
    const fingerprint = JSON.stringify([cronExpression, timezone, stored.source, stored.remoteDirectory, stored.processedFilePattern]);
    if (this.fingerprints.get(config.id) === fingerprint) return;
    this.cancelSchedule(config.id);
    this.fingerprints.set(config.id, fingerprint);
    const task = cron.schedule(cronExpression, async () => {
      console.log(`[FileImportScheduler] Running scheduled file import "${config.name}" (ID: ${config.id})`);
      await withAuditContext(serviceAuditContext("scheduledFileImport"),()=>this.runImport(config.id));
    }, { timezone, noOverlap: true });

    this.scheduledTasks.set(config.id, task);
  }

  cancelSchedule(configId: number) {
    this.fingerprints.delete(configId);
    const existingTask = this.scheduledTasks.get(configId);
    if (existingTask) {
      void existingTask.destroy();
      this.scheduledTasks.delete(configId);
      console.log(`[FileImportScheduler] Cancelled schedule for config ${configId}`);
    }
  }

  async runImport(configId:number):Promise<Awaited<ReturnType<FileImportScheduler["runImportData"]>>> {
    const config=await storage.getFileImportConfig(configId);
    const project=config ? await storage.getProject(config.projectId):undefined;
    const ctx=auditContext.getStore() || serviceAuditContext("scheduledFileImport");
    const lock = await pool.connect(); let locked = false;
    try {
      locked = (await lock.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [backupLock])).rows[0].locked;
      if (!locked) return { success: false, imported: 0, failed: 0, error: "Another file operation or backup is running. Try again shortly." };
      return await withAuditContext(ctx,()=>auditedOperation("fileImport",String(configId),async () => {
        const total = { success: true, imported: 0, failed: 0, error: undefined as string | undefined, fileName: undefined as string | undefined };
        for (let index = 0; index < (config?.source === "sftp" ? 25 : 1); index++) {
          const result = await this.runImportData(configId, index > 0);
          total.imported += result.imported; total.failed += result.failed;
          total.success = total.success && result.success; total.error = result.error;
          if (result.fileName) total.fileName = result.fileName;
          if (!result.fileName || !result.success || result.failed) break;
        }
        return total;
      },project?.id,project?.name));
    } finally {
      if (locked) await lock.query("SELECT pg_advisory_unlock(hashtext($1))", [backupLock]).catch(() => {});
      lock.release();
    }
  }
  private async runImportData(configId: number, suppressEmpty = false): Promise<{
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
      
      // Skip imports for inactive projects
      if (project.isActive === false) {
        await storage.updateFileImportConfigLastRun(configId, "skipped", "Project is inactive", 0, null);
        return { success: false, imported: 0, failed: 0, error: "Project is inactive - import skipped" };
      }

      const candidate = await importCandidate(importConfig, project);
      if (!candidate) {
        if (!suppressEmpty) {
          await storage.updateFileImportConfigLastRun(configId, "skipped", "No new matching files to process.", 0, importConfig.lastProcessedFile);
          const skipped = await storage.createFileImportHistoryEntry(configId, importConfig.processedFilePattern || "*", "skipped", project.id,
            importConfig.source === "sftp" ? "sftp" : "scheduled_file", auditContext.getStore()?.actorLabel || "system");
          await storage.updateFileImportHistoryEntry(skipped.id, "skipped", 0, 0, "No new matching files to process.");
        }
        return { success: true, imported: 0, failed: 0 };
      }
      const latestFile = candidate, filePath = candidate.filePath;

      const historyEntry = await storage.createFileImportHistoryEntry(
        configId, 
        latestFile.name, 
        "running",
        importConfig.projectId,
        importConfig.source === "sftp" ? "sftp" : "scheduled_file",
        auditContext.getStore()?.actorLabel || "system"
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
          const workbook = XLSX.read(fileContent, { type: "buffer", raw: true, FS: delimiter });
          const grid = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: false, defval: "" });
          
          if (grid.length === 0) {
            await storage.updateFileImportHistoryEntry(historyEntry.id, "failed", 0, 0, "Empty file");
            await storage.updateFileImportConfigLastRun(configId, "failed", "Empty file", 0, latestFile.name);
            return { success: false, imported: 0, failed: 0, error: "Empty file", fileName: latestFile.name };
          }

          const headers = hasHeader ? grid[0].map(String) : grid[0].map((_, i) => `column_${i}`);
          rows = (hasHeader ? grid.slice(1) : grid).map(values => {
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
        
        // Get the next available customerWoId for auto-generation
        let nextAutoId = BigInt(await workOrderStorage.getNextCustomerWoId());
        
        // Get project's configured service types for default assignment
        const projectServiceTypes = await storage.getProjectServiceTypes(importConfig.projectId);
        const allowedServiceTypeCodes = new Set(projectServiceTypes.map(st => st.code));
        const defaultServiceType = projectServiceTypes.length === 1 ? projectServiceTypes[0].code : null;
        const hasMultipleServiceTypes = projectServiceTypes.length > 1;
        const services = (await pool.query("SELECT code,is_default FROM public.service_types ORDER BY sort_order,id")).rows;
        const serviceCodes = new Map<string, string>(services.map(service => [service.code.toLowerCase(), service.code]));
        // A real, non-interactive principal satisfies legacy actor foreign keys.
        await pool.query(`INSERT INTO public.users(id,username,role) VALUES(gen_random_uuid()::text,'file_import','user')
          ON CONFLICT(username) DO NOTHING`);

        for (const [rowNumber, row] of rows.entries()) {
          try {
            const mappedData: Record<string, any> = {};
            // columnMapping is stored as {targetField: sourceCol}
            // e.g., {"customerWoId": "customer_wo_id", ...}
            // Use normalized lookup to handle header variations like "Customer WO ID" vs "customer_wo_id"
            const getValue = createNormalizedRowLookup(row);
            for (const [targetField, sourceCol] of Object.entries(columnMapping)) {
              if (sourceCol) {
                const value = getValue(sourceCol);
                if (value !== undefined) {
                  mappedData[targetField] = value;
                }
              }
            }

            Object.assign(mappedData, importedVisitScheduling(mappedData));
            // Auto-generate customerWoId if not provided
            if (!mappedData.customerWoId) {
              mappedData.customerWoId = importConfig.source === "sftp" ?
                await generatedImportId(configId, candidate.hash, rowNumber, `SFTP-${configId}-${candidate.hash.slice(0, 32)}-${rowNumber + 1}`) : String(nextAutoId);
              nextAutoId++;
            }

            // Handle serviceType: trim and normalize, validate against project's configured types
            const rawServiceType = mappedData.serviceType ? String(mappedData.serviceType).trim() : "";
            
            if (!rawServiceType) {
              // Service type not provided or empty
              if (hasMultipleServiceTypes) {
                failed++;
                errors.push(`Row missing serviceType and project has multiple service types configured (${Array.from(allowedServiceTypeCodes).join(", ")}) - cannot determine which to use: ${JSON.stringify(row).slice(0, 100)}`);
                continue;
              }
              if (defaultServiceType) {
                mappedData.serviceType = defaultServiceType;
              } else {
                // No service types configured for project, default to Water
                mappedData.serviceType = (services.find(service => service.is_default) || services[0])?.code;
              }
            } else {
              const normalizedType = serviceCodes.get(rawServiceType.toLowerCase());
              if (!normalizedType) {
                failed++; errors.push(`Row has an unknown service type: ${rawServiceType.slice(0, 100)}`); continue;
              }
              
              // Validate against project's configured service types
              if (allowedServiceTypeCodes.size > 0 && !allowedServiceTypeCodes.has(normalizedType)) {
                failed++;
                errors.push(`Row has invalid serviceType "${rawServiceType}" - project only allows: ${Array.from(allowedServiceTypeCodes).join(", ")}: ${JSON.stringify(row).slice(0, 100)}`);
                continue;
              }
              
              mappedData.serviceType = normalizedType;
            }

            if (!mappedData.customerId || !mappedData.customerName || !mappedData.address) {
              failed++;
              errors.push(`Row missing required fields (customerId, customerName, or address): ${JSON.stringify(row).slice(0, 100)}`);
              continue;
            }

            if (mappedData.oldSystemReading) {
              mappedData.oldSystemReading = String(mappedData.oldSystemReading).trim() || null;
            }
            if (mappedData.oldMeterReading) {
              mappedData.oldSystemReading = String(mappedData.oldMeterReading).trim() || null;
              delete mappedData.oldMeterReading;
            }
            if (mappedData.newSystemReading) {
              mappedData.newSystemReading = String(mappedData.newSystemReading).trim() || null;
            }
            if (mappedData.newMeterReading) {
              mappedData.newSystemReading = String(mappedData.newMeterReading).trim() || null;
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

            if (mappedData.oldModuleRead) {
              mappedData.oldModuleRead = String(mappedData.oldModuleRead).trim() || null;
            }
            if (mappedData.newModuleRead) {
              mappedData.newModuleRead = String(mappedData.newModuleRead).trim() || null;
            }

            // Set default status and createdBy
            mappedData.createdBy = "file_import";
            mappedData.updatedBy = "file_import";

            const existingWo = await workOrderStorage.getWorkOrderByCustomerWoId(mappedData.customerWoId);
            if (existingWo) {
              delete mappedData.createdBy;
              await workOrderStorage.updateWorkOrder(existingWo.id, mappedData, undefined, true);
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
              await workOrderStorage.createWorkOrder(validated as any, undefined, true);
            }
            imported++;
          } catch (rowError: any) {
            failed++;
            errors.push(`Row error: ${rowError.message?.slice(0, 100) || "Unknown error"}`);
          }
        }

        const status = failed === 0 ? "success" : (imported > 0 ? "partial" : "failed");
        if (failed === 0) await rememberImport(configId, candidate);
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

        return { success: failed === 0, imported, failed, fileName: latestFile.name,
          error: failed ? `${failed} rows failed. See import history for details.` : undefined };
      } catch (importError: any) {
        // Use processedFileName (which may have been renamed) to ensure we don't reprocess
        await storage.updateFileImportHistoryEntry(historyEntry.id, "failed", 0, 0, importError.message);
        await storage.updateFileImportConfigLastRun(configId, "failed", importError.message, 0, processedFileName);
        return { success: false, imported: 0, failed: 0, error: importError.message, fileName: processedFileName };
      }
    } catch (error: any) {
      const message = error instanceof TransferError ? error.message : "File import failed. Check the source file and directory permissions.";
      const config = await storage.getFileImportConfig(configId);
      if (config) {
        await storage.updateFileImportConfigLastRun(configId, "failed", message, 0, config.lastProcessedFile);
        const entry = await storage.createFileImportHistoryEntry(configId, config.processedFilePattern || "*", "failed", config.projectId,
          config.source === "sftp" ? "sftp" : "scheduled_file", auditContext.getStore()?.actorLabel || "system");
        await storage.updateFileImportHistoryEntry(entry.id, "failed", 0, 0, message);
      }
      return { success: false, imported: 0, failed: 0, error: message };
    }
  }

  async refreshSchedule(configId: number) {
    const config = await storage.getFileImportConfig(configId);
    if (config && config.isEnabled) {
      await this.scheduleImport({
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
