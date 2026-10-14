import * as cron from "node-cron";
import { storage } from "./storage";
import { auditContext, serviceAuditContext, withAuditContext } from "./auditContext";
import { auditedOperation } from "./auditService";
import { ExternalDatabaseService } from "./externalDbService";
import { getProjectWorkOrderStorage } from "./projectDb";
import { insertProjectWorkOrderSchema } from "@shared/schema";

class ImportScheduler {
  private scheduledTasks: Map<number, cron.ScheduledTask> = new Map();

  async initialize() {
    console.log("[ImportScheduler] Initializing scheduled imports...");
    await this.loadAllSchedules();
  }

  private async loadAllSchedules() {
    try {
      const activeConfigs = await storage.getAllEnabledImportConfigs();
      console.log(`[ImportScheduler] Found ${activeConfigs.length} active import configurations`);

      for (const config of activeConfigs) {
        if (config.scheduleFrequency && config.scheduleFrequency !== "manual") {
          this.scheduleImport(config);
        }
      }
    } catch (error) {
      console.error("[ImportScheduler] Error loading schedules:", error);
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
    externalDbConfigId: number;
  }) {
    this.cancelSchedule(config.id);

    if (!config.scheduleFrequency || config.scheduleFrequency === "manual") {
      return;
    }

    const cronExpression = this.getCronExpression(config.scheduleFrequency, config.customCronExpression);
    if (!cronExpression) {
      console.warn(`[ImportScheduler] Invalid schedule frequency for config ${config.id}: ${config.scheduleFrequency}`);
      return;
    }

    if (!cron.validate(cronExpression)) {
      console.warn(`[ImportScheduler] Invalid cron expression for config ${config.id}: ${cronExpression}`);
      return;
    }

    console.log(`[ImportScheduler] Scheduling import "${config.name}" (ID: ${config.id}) with cron: ${cronExpression}`);

    const task = cron.schedule(cronExpression, async () => {
      console.log(`[ImportScheduler] Running scheduled import "${config.name}" (ID: ${config.id})`);
      await withAuditContext(serviceAuditContext("scheduledDatabaseImport"),()=>this.runImport(config.id));
    });

    this.scheduledTasks.set(config.id, task);
  }

  cancelSchedule(configId: number) {
    const existingTask = this.scheduledTasks.get(configId);
    if (existingTask) {
      existingTask.stop();
      this.scheduledTasks.delete(configId);
      console.log(`[ImportScheduler] Cancelled schedule for config ${configId}`);
    }
  }

  async runImport(configId:number):Promise<Awaited<ReturnType<ImportScheduler["runImportData"]>>> {
    const config=await storage.getImportConfig(configId);
    const database=config ? await storage.getExternalDatabaseConfig(config.externalDbConfigId):undefined;
    const project=database ? await storage.getProject(database.projectId):undefined;
    const ctx=auditContext.getStore() || serviceAuditContext("scheduledDatabaseImport");
    return withAuditContext(ctx,()=>auditedOperation("databaseImport",String(configId),()=>this.runImportData(configId),project?.id,project?.name));
  }
  private async runImportData(configId: number): Promise<{
    success: boolean;
    imported: number;
    failed: number;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      const importConfig = await storage.getImportConfig(configId);
      if (!importConfig || !importConfig.isEnabled) {
        return { success: false, imported: 0, failed: 0, error: "Import configuration not found or disabled" };
      }

      const dbConfig = await storage.getExternalDatabaseConfig(importConfig.externalDbConfigId);
      if (!dbConfig || !dbConfig.isActive) {
        await storage.updateImportConfigLastRun(configId, "failed", "Database configuration not found or inactive", 0, null);
        return { success: false, imported: 0, failed: 0, error: "Database configuration not found or inactive" };
      }

      const project = await storage.getProject(dbConfig.projectId);
      if (!project || !project.databaseName) {
        await storage.updateImportConfigLastRun(configId, "failed", "Project not found or has no database", 0, null);
        return { success: false, imported: 0, failed: 0, error: "Project not found or has no database" };
      }
      
      // Skip imports for inactive projects
      if (project.isActive === false) {
        await storage.updateImportConfigLastRun(configId, "skipped", "Project is inactive", 0, null);
        return { success: false, imported: 0, failed: 0, error: "Project is inactive - import skipped" };
      }

      const historyEntry = await storage.createImportHistoryEntry(configId, "running");

      try {
        const queryResult = await ExternalDatabaseService.executeQuery(dbConfig, importConfig.sqlQuery);

        if (!queryResult.success || !queryResult.data) {
          await storage.updateImportHistoryEntry(historyEntry.id, "failed", 0, 0, queryResult.error);
          await storage.updateImportConfigLastRun(configId, "failed", queryResult.error || "Query failed", 0, null);
          return { success: false, imported: 0, failed: 0, error: queryResult.error };
        }

        const workOrderStorage = await getProjectWorkOrderStorage(project.databaseName);
        const columnMapping = (importConfig.columnMapping as Record<string, string>) || {};

        let imported = 0;
        let failed = 0;
        const errors: string[] = [];
        
        // Get the next available customerWoId for auto-generation
        let nextAutoId = BigInt(await workOrderStorage.getNextCustomerWoId());
        
        // Get project's configured service types for default assignment
        const projectServiceTypes = await storage.getProjectServiceTypes(project.id);
        const allowedServiceTypeCodes = new Set(projectServiceTypes.map(st => st.code));
        const defaultServiceType = projectServiceTypes.length === 1 ? projectServiceTypes[0].code : null;
        const hasMultipleServiceTypes = projectServiceTypes.length > 1;

        for (const row of queryResult.data) {
          try {
            const mappedData: Record<string, any> = {};
            for (const [sourceCol, targetField] of Object.entries(columnMapping)) {
              if (targetField && row[sourceCol] !== undefined) {
                mappedData[targetField] = row[sourceCol];
              }
            }

            // Auto-generate customerWoId if not provided
            if (!mappedData.customerWoId) {
              mappedData.customerWoId = String(nextAutoId);
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
                mappedData.serviceType = "Water";
              }
            } else {
              // Normalize case: capitalize first letter
              const normalizedType = rawServiceType.charAt(0).toUpperCase() + rawServiceType.slice(1).toLowerCase();
              
              // Validate against project's configured service types
              if (allowedServiceTypeCodes.size > 0 && !allowedServiceTypeCodes.has(normalizedType)) {
                failed++;
                errors.push(`Row has invalid serviceType "${rawServiceType}" - project only allows: ${Array.from(allowedServiceTypeCodes).join(", ")}: ${JSON.stringify(row).slice(0, 100)}`);
                continue;
              }
              
              if (["Water", "Electric", "Gas"].includes(normalizedType)) {
                mappedData.serviceType = normalizedType;
              } else if (defaultServiceType) {
                mappedData.serviceType = defaultServiceType;
              } else {
                mappedData.serviceType = "Water";
              }
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

            mappedData.status = mappedData.status || "Open";
            mappedData.createdBy = "system_import";

            const existingWo = await workOrderStorage.getWorkOrderByCustomerWoId(mappedData.customerWoId);
            if (existingWo) {
              await workOrderStorage.updateWorkOrder(existingWo.id, mappedData);
            } else {
              const validated = insertProjectWorkOrderSchema.parse(mappedData);
              await workOrderStorage.createWorkOrder(validated as any);
            }
            imported++;
          } catch (rowError: any) {
            failed++;
            errors.push(`Row error: ${rowError.message?.slice(0, 100) || "Unknown error"}`);
          }
        }

        const status = failed === 0 ? "success" : (imported > 0 ? "partial" : "failed");
        const message = `Imported ${imported} records, ${failed} failed`;
        const duration = Date.now() - startTime;

        await storage.updateImportHistoryEntry(historyEntry.id, status, imported, failed, errors.length > 0 ? errors.slice(0, 10).join("\n") : null);
        await storage.updateImportConfigLastRun(configId, status, message, imported, null);

        console.log(`[ImportScheduler] Import "${importConfig.name}" completed: ${message} (${duration}ms)`);

        return { success: true, imported, failed };
      } catch (importError: any) {
        await storage.updateImportHistoryEntry(historyEntry.id, "failed", 0, 0, importError.message);
        await storage.updateImportConfigLastRun(configId, "failed", importError.message, 0, null);
        return { success: false, imported: 0, failed: 0, error: importError.message };
      }
    } catch (error: any) {
      console.error(`[ImportScheduler] Error running import ${configId}:`, error);
      return { success: false, imported: 0, failed: 0, error: error.message };
    }
  }

  async refreshSchedule(configId: number) {
    const config = await storage.getImportConfig(configId);
    if (config && config.isEnabled) {
      const dbConfig = await storage.getExternalDatabaseConfig(config.externalDbConfigId);
      if (dbConfig) {
        this.scheduleImport({
          id: config.id,
          name: config.name,
          scheduleFrequency: config.scheduleFrequency,
          externalDbConfigId: config.externalDbConfigId,
        });
      }
    } else {
      this.cancelSchedule(configId);
    }
  }

  getActiveSchedules(): number[] {
    return Array.from(this.scheduledTasks.keys());
  }

  shutdown() {
    console.log("[ImportScheduler] Shutting down...");
    this.scheduledTasks.forEach((task, configId) => {
      task.stop();
    });
    this.scheduledTasks.clear();
  }
}

export const importScheduler = new ImportScheduler();
