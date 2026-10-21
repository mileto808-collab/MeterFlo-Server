import type { PoolClient } from "pg";
import type { AuditEvent } from "../../shared/audit";
import { readableAuditEvents } from "../auditReadModel";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const woKey = /^(?:workOrderId|work_order_id|workOrderIds)$/;
const userKey = /^(?:assigned_user_id|assignedUserId|previousAssignedUserId|user_id|userId|actorId|installerId|scheduled_by|completed_by|created_by|updated_by|scheduledBy|completedBy|createdBy|updatedBy)$/;

/** Enrich only the response. Raw audit rows, IDs, changes and metadata are retained. */
export async function lifecycleDisplayEvents(client: PoolClient, rows: any[], schema: string, projectId: number) {
  const workIds = new Set<number>(), userIds = new Set<string>();
  const eventWorkIds = new Map<any, Set<number>>();
  const collect = (value: unknown, key = "", ids = workIds) => {
    if (Array.isArray(value)) { value.forEach(v => collect(v, key, ids)); return; }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([k, v]) => collect(v, k, ids)); return;
    }
    if (woKey.test(key) && /^\d+$/.test(String(value))) ids.add(Number(value));
    if (userKey.test(key) && typeof value === "string" && uuid.test(value)) userIds.add(value);
  };
  for (const row of rows) {
    const ids = new Set<number>();
    if (["work_orders", "workOrder"].includes(row.entity_type) && /^\d+$/.test(row.entity_id)) ids.add(Number(row.entity_id));
    collect(row.metadata, "", ids);
    for (const change of row.changes ?? []) {
      const allocation = /^(?:allocations|workPlans|workRequirements|deferredCompletions)\/(\d+)$/.exec(change.field);
      if (allocation) ids.add(Number(allocation[1]));
      collect(change.before, change.field, ids); collect(change.after, change.field, ids);
    }
    eventWorkIds.set(row, ids);
    ids.forEach(id => workIds.add(id));
  }
  const { rows: work } = workIds.size ? await client.query(`SELECT id,customer_wo_id FROM ${schema}.work_orders WHERE id=ANY($1::int[])`,
    [[...workIds].filter(Number.isSafeInteger)]) : { rows: [] };
  const labels = new Map<number, string>(work.map(w => [w.id, w.customer_wo_id?.trim() || String(w.id)]));
  for (const row of rows.filter(r => ["work_orders", "workOrder"].includes(r.entity_type))) {
    const id = Number(row.entity_id);
    if (labels.has(id)) continue;
    const captured = (row.changes ?? []).find((c: any) => ["customer_wo_id", "customerWoId"].includes(c.field));
    const historical = captured?.after ?? captured?.before;
    const label = typeof historical === "string" && historical.trim() ? historical.trim()
      : typeof row.entity_label === "string" && !uuid.test(row.entity_label) &&
        !new RegExp(`^(?:Work order #?)?${id}$`, "i").test(row.entity_label) ? row.entity_label : String(id);
    labels.set(id, label);
  }
  const { rows: users } = userIds.size ? await client.query(`SELECT u.id,u.username FROM public.users u
    JOIN public.user_projects p ON p.user_id=u.id WHERE p.project_id=$1 AND u.id=ANY($2::varchar[])`,
    [projectId, [...userIds]]) : { rows: [] };
  const userLabels = new Map<string, string>(users.map(u => [u.id, u.username]));
  for (const row of rows)
    if (row.actor_id && row.actor_label && !uuid.test(row.actor_label)) userLabels.set(row.actor_id, row.actor_label);
  const resolve = (raw: unknown, key: string, fallback: unknown): unknown => {
    if (Array.isArray(raw)) return raw.map((value, i) => resolve(value, key, Array.isArray(fallback) ? fallback[i] : value));
    if (raw && typeof raw === "object") return Object.fromEntries(Object.entries(raw).map(([k, value]) =>
      [k, resolve(value, k, fallback && typeof fallback === "object" ? (fallback as Record<string, unknown>)[k] : value)]));
    if (woKey.test(key) && /^\d+$/.test(String(raw)))
      return `Work order ${labels.get(Number(raw)) ?? String(raw)}`;
    if (userKey.test(key) && typeof raw === "string") return userLabels.get(raw) ?? (uuid.test(raw) ? "User (historical reference)" : raw);
    // Never reinterpret scanned serials or user-entered notes as internal references.
    if ((key === "id" || /(?:Id|_id)$/.test(key)) && typeof raw === "string" && uuid.test(raw)) {
      return typeof fallback === "string" && fallback !== raw ? fallback : "Historical reference (see raw evidence)";
    }
    return fallback === undefined ? raw : fallback;
  };
  const events: AuditEvent[] = (await readableAuditEvents(client, rows)).map((event, i) => {
    const raw = rows[i];
    const workOrder = ["work_orders", "workOrder"].includes(event.entityType)
      ? `Work order ${labels.get(Number(event.entityId)) ?? event.entityId}` : undefined;
    const related = [...eventWorkIds.get(raw) ?? []].map(id => labels.get(id) ?? String(id));
    return { ...event, entityReference: workOrder ?? (related.length === 1 ? `Work order ${related[0]}` : event.entityReference),
      displayChanges: event.changes.map((change, n) => {
        const allocation = /^(?:allocations|workPlans|workRequirements|deferredCompletions)\/(\d+)$/.exec(change.field);
        const display = event.displayChanges?.[n];
        return { field: allocation ? `Work order ${labels.get(Number(allocation[1])) ?? allocation[1]}` : display?.field || change.field,
          before: resolve(change.before, change.field, display?.before),
          after: resolve(change.after, change.field, display?.after) };
      }),
      displayMetadata: resolve(raw.metadata ?? {}, "", event.displayMetadata) as Record<string, unknown> };
  });
  return { events, labels };
}
