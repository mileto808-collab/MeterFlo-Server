import { pool } from "../db";
import { storage } from "../storage";
import { schemaIdentifier } from "./exports";
import { insertProjectWorkOrderSchema } from "../../shared/schema";
import type { WorkOrderColumnGuide } from "../../shared/file-transfers";
const camel = (name: string) => name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
// Match the actual manual CSV mapping and manual import endpoint, not DB nullability.
const csv = new Set(["customerWoId", "customerId", "customerName", "address", "city", "state", "zip", "phone", "email", "route", "zone",
  "serviceType", "oldSystemId", "oldSystemReading", "oldGps", "oldSystemType", "newSystemType", "oldModuleId", "newModuleId",
  "oldModuleRead", "newModuleRead", "oldModuleType", "newModuleType", "status", "scheduledAt", "serviceDurationMinutes",
  "appointmentWindowStart", "appointmentWindowEnd", "trouble", "notes", "assignedUserId", "assignedGroupId"]);
const json = new Set([...csv, "newSystemId", "newSystemReading", "newGps", "attachments",
  "oldSystemReadingText", "newSystemReadingText", "oldModuleReadText", "newModuleReadText"]);
const scheduled = new Set([...Object.keys(insertProjectWorkOrderSchema.shape), "completedAt"]);
const managed = new Set(["id", "createdAt", "updatedAt", "createdBy", "updatedBy"]);
const required = new Set(["customerId", "customerName", "address"]);
export async function workOrderColumnGuide(projectId: number): Promise<WorkOrderColumnGuide> {
  const project = await storage.getProject(projectId);
  if (!project?.databaseName) throw new Error("Project work-order schema unavailable.");
  schemaIdentifier(project.databaseName);
  const columns = (await pool.query(`SELECT column_name,data_type,is_nullable,column_default IS NOT NULL AS has_default
    FROM information_schema.columns WHERE table_schema=$1 AND table_name='work_orders' ORDER BY ordinal_position`, [project.databaseName])).rows;
  const projectServices = await storage.getProjectServiceTypes(projectId);
  const globalServices = await storage.getServiceTypes();
  return {
    checkedAgainst: "Live project work_orders table and current file-import handlers",
    serviceTypes: projectServices.map(row => ({ code: row.code, label: row.label })),
    availableServiceTypes: globalServices.map(row => ({ code: row.code, label: row.label })),
    columns: columns.map((row): WorkOrderColumnGuide["columns"][number] => {
      const field = camel(row.column_name), system = managed.has(field);
      const note = field === "customerWoId" ? "Recommended customer identity. Generated when omitted; remote-file retries retain stable generated identities."
        : field === "serviceType" ? "Use a configured service code. A sole project service type can default; supply a value when more than one is configured."
        : required.has(field) ? "Required by import validation even where the legacy database column permits NULL."
        : field === "createdBy" ? "Set to the authenticated importer or file-import service identity; file values do not override audit attribution."
        : field === "completedAt" ? "Scheduled file imports: updates only. Not accepted by manual file import or the new-work-order validation schema."
        : field === "scheduledBy" || field === "completedBy" ? "Supported by scheduled file processing; manual file import does not accept this field."
        : field === "appointmentWindowStart" || field === "appointmentWindowEnd" ? "ISO timestamp with Z or an explicit UTC offset. Supply both window boundaries."
        : field === "serviceDurationMinutes" ? "Whole minutes from 1 to 480."
        : field === "oldGps" || field === "newGps" ? "Imported coordinate text is saved data, not proof of a fresh device GPS capture."
        : field.endsWith("ReadingText") || field.endsWith("ReadText") ? "Exact reading text retained by MeterFlo. JSON manual import accepts these aliases; use ordinary reading fields in CSV mapping."
        : system ? "Generated or maintained by MeterFlo, not a customer-file input."
        : "";
      return { field, databaseColumn: row.column_name, dataType: row.data_type, databaseNullable: row.is_nullable === "YES",
        databaseDefault: !!row.has_default, manualCsv: !system && csv.has(field), manualJson: !system && json.has(field),
        scheduled: !system && scheduled.has(field), exportable: true,
        requirement: (system ? "managed" : required.has(field) ? "required" : field === "serviceType" ? "conditional" : field === "customerWoId" ? "generated" : "optional"),
        note };
    }),
  };
}
