import { getTableColumns } from "drizzle-orm";
import { z } from "zod";
import { projects } from "../shared/schema";
import { pool } from "./db";
import { copyCleanProjectInventory } from "./inventoryProjectCopy";
import { insertAuditEvent } from "./auditService";

export const projectCopyOptions = z.object({ copyAccess: z.boolean().default(false) }).strict();
// Exhaustive policy: adding a project column requires deciding how copies handle it.
export const projectCopyPolicy = {
  id: "fresh", name: "fresh", databaseName: "fresh", createdAt: "fresh", updatedAt: "fresh",
  description: "copy", customerEmail: "copy", phone: "copy", address: "copy", city: "copy", state: "copy",
  zip: "copy", notes: "copy", isActive: "copy", inventoryEnabled: "copy",
  routingConfiguration: "routing", defaultServiceMinutes: "copy", defaultAppointmentToleranceMinutes: "copy",
  webhookUrl: "copy", webhookEnabled: "pause", customerApiEnabled: "pause", customerApiUrl: "copy",
  customerApiAuthType: "copy", customerApiKeyHeader: "copy", customerApiSecretEnvVar: "copy", customerApiSendPhotos: "copy",
  operationalHoursEnabled: "copy", operationalHoursStart: "copy", operationalHoursEnd: "copy", operationalHoursDays: "copy",
  timezone: "copy", wizardMode: "copy", wizardGpsMode: "copy", wizardReuseOldGps: "copy", wizardGpsMaxAccuracyMetres: "copy",
  systemReadingDecimalPlaces: "copy", moduleReadingDecimalPlaces: "copy",
  wizardShowNotesStep: "copy", wizardShowGpsStep: "copy", wizardShowBeforePhotosStep: "copy",
  wizardShowAfterPhotosStep: "copy", wizardShowSignatureStep: "copy",
  searchShowBarcodeScan: "copy", searchShowQrCodeScan: "copy", searchShowManualEntry: "copy", searchShowHidScanner: "copy",
  changeoutEquipmentType: "copy", readingEquipmentType: "copy",
} satisfies Record<keyof typeof projects.$inferSelect, "copy" | "fresh" | "pause" | "routing">;

const relations = [
  ["project_holidays", ["date", "name"]],
  ["project_service_types", ["service_type_id"]],
  ["system_type_projects", ["system_type_id"]],
  ["module_type_projects", ["module_type_id"]],
  ["work_order_sub_statuses", ["parent_status_id", "code", "label", "description", "color", "sort_order", "routing_priority", "active"]],
  ["trouble_codes", ["code", "label", "description", "active", "sort_order"]],
  ["work_order_closing_policy", ["enabled", "after_hours"]],
] as const;
const exclusions = [
  "Work orders, stock, serials, reservations, operational drafts, transactions, files and source history are not copied.",
  "Webhooks and customer API delivery are off. Review their copied settings before enabling them.",
  "Import/export jobs, connection credentials, SFTP/HTTPS access credentials and access locks are not copied. Configure them separately if needed.",
];

/** Copy one consistent setup snapshot, with independent project-owned identities. */
export async function copyProjectSetup(sourceId: number, destinationId: number, copyAccess: boolean, admin: boolean) {
  if (copyAccess && !admin) throw new Error("Administrator permission is required to copy access assignments.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const { rows: [source] } = await client.query("SELECT * FROM public.projects WHERE id=$1 FOR SHARE", [sourceId]);
    if (!source) throw new Error("Source project was removed before its settings could be copied.");
    if (source.inventory_enabled && !admin) throw new Error("Administrator permission is required to copy inventory setup.");
    const assignments = Object.entries(getTableColumns(projects)).flatMap(([key, column]) => {
      const policy = projectCopyPolicy[key as keyof typeof projectCopyPolicy];
      if (policy === "fresh") return [];
      if (policy === "pause") return [`"${column.name}"=false`];
      if (policy === "routing" && !admin) return [`"${column.name}"=NULL`];
      return [`"${column.name}"=source."${column.name}"`];
    });
    await client.query(`UPDATE public.projects AS destination SET ${assignments.join(",")}
      FROM public.projects AS source WHERE destination.id=$2 AND source.id=$1`, [sourceId, destinationId]);
    const counts: Record<string, number> = {};
    for (const [table, columns] of relations) {
      const names = columns.map(column => `"${column}"`).join(",");
      const extra = table === "work_order_sub_statuses" ? ",id" : table === "trouble_codes" ? ",rule_key" : "";
      const identity = extra ? ",gen_random_uuid()" : "";
      const result = await client.query(`INSERT INTO public.${table} (project_id,${names}${extra})
        SELECT $2::integer,${names}${identity} FROM public.${table} WHERE project_id=$1`, [sourceId, destinationId]);
      counts[table] = result.rowCount ?? 0;
      const comparison = await client.query(`SELECT
        (SELECT count(*)::integer FROM public.${table} WHERE project_id=$1) AS expected,
        (SELECT count(*)::integer FROM public.${table} WHERE project_id=$2) AS actual`, [sourceId,destinationId]);
      if (comparison.rows[0].actual !== comparison.rows[0].expected)
        throw new Error(`Project copy verification failed for ${table}.`);
    }
    if (copyAccess) {
      for (const [table, column] of [["user_projects", "user_id"], ["user_group_projects", "group_id"]]) {
        const result = await client.query(`INSERT INTO public.${table} (project_id,${column})
          SELECT DISTINCT $2::integer,${column} FROM public.${table} WHERE project_id=$1`, [sourceId, destinationId]);
        counts[table] = result.rowCount ?? 0;
      }
    }
    const inventory = source.inventory_enabled ? await copyCleanProjectInventory(sourceId, destinationId, copyAccess, client) : null;
    const report = { copied: counts, inventory, accessCopied: copyAccess,
      review: [...exclusions, ...(!copyAccess ? ["Project users, user groups and location assignments were not copied."] : []),
        ...(!admin ? ["Maps & Routing configuration requires administrator review and was not copied."] : [])] };
    await insertAuditEvent(client, { action: "project.setupCopied", entityType: "project", entityId: String(destinationId),
      projectId: destinationId, metadata: { sourceProjectId: sourceId, ...report } });
    await client.query("COMMIT");
    return report;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
