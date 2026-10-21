import { z } from "zod";
import { pool } from "../db";
import { inventoryDateTime } from "../../shared/inventory-date-time";
import { projectSchema } from "./schema";
import { historyActionLabel, historyDisplayText, historyFieldLabel } from "../../shared/work-order-history-display";
import { lifecycleDisplayEvents } from "./history-display";

export const historyFilters = z.object({
  workOrderId: z.coerce.number().int().positive().optional(), operationId: z.string().uuid().optional(),
  q: z.string().max(200).optional(), action: z.string().max(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
  format: z.enum(["print", "csv"]).optional(),
});
export async function workOrderHistory(projectId: number, query: unknown) {
  const f = historyFilters.parse(query);
  if (f.from && f.to && f.from > f.to) throw Object.assign(new Error("From date must not follow To date."), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: [p] } = await client.query("SELECT name,timezone,database_name FROM public.projects WHERE id=$1", [projectId]);
    const schema = projectSchema(p.database_name), timezone = p.timezone || "UTC";
    const values: unknown[] = [projectId];
    const inventoryWork = `(e.entity_type='inventory' AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(e.changes) c WHERE
      c->>'field' ~ '^(allocations|workPlans|workRequirements|deferredCompletions)/[0-9]+$'
      OR coalesce(c->'after'->>'workOrderId',c->'before'->>'workOrderId') ~ '^[0-9]+$'))`;
    const clauses = [`e.project_id=$1`, `(e.entity_type IN ('work_orders','workOrder','work_order_time_tracking') OR e.action LIKE 'workOrder.%' OR ${inventoryWork})`];
    const add = (expression: string, value: unknown) => { values.push(value); clauses.push(expression.replaceAll("?", `$${values.length}`)); };
    if (f.workOrderId) add(`((e.entity_type IN ('work_orders','workOrder') AND e.entity_id=?::text) OR
      (e.entity_type='work_order_time_tracking' AND EXISTS(
        SELECT 1 FROM jsonb_array_elements(e.changes) c WHERE c->>'field' IN ('work_order_id','system_work_order_id')
        AND coalesce(c->>'after',c->>'before') IN (?::text,
          (SELECT customer_wo_id FROM ${schema}.work_orders WHERE id=?::int))))
      OR (e.metadata->'workOrderIds' @> to_jsonb(ARRAY[?::int]))
      OR (e.entity_type='inventory' AND EXISTS (SELECT 1 FROM jsonb_array_elements(e.changes) c
        WHERE c->>'field' IN ('allocations/'||?::text,'workPlans/'||?::text,'workRequirements/'||?::text,'deferredCompletions/'||?::text)
        OR coalesce(c->'after'->>'workOrderId',c->'before'->>'workOrderId')=?::text)))`, f.workOrderId);
    if (f.operationId) add("e.operation_id=?", f.operationId);
    if (f.action) add("e.action=?", f.action);
    if (f.from) { values.push(timezone); const zone = values.length; add(`e.occurred_at>=?::date::timestamp AT TIME ZONE $${zone}`, f.from); }
    if (f.to) { values.push(timezone); const zone = values.length; add(`e.occurred_at<(?::date+1)::timestamp AT TIME ZONE $${zone}`, f.to); }
    if (f.q) add(`(e.entity_id ILIKE ? OR e.entity_label ILIKE ? OR e.actor_label ILIKE ? OR e.action ILIKE ?
      OR EXISTS(SELECT 1 FROM ${schema}.work_orders w WHERE
        (w.id::text=e.entity_id OR (e.entity_type='inventory' AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(e.changes) c WHERE
          c->>'field' IN ('allocations/'||w.id::text,'workPlans/'||w.id::text,'workRequirements/'||w.id::text,'deferredCompletions/'||w.id::text)
          OR coalesce(c->'after'->>'workOrderId',c->'before'->>'workOrderId')=w.id::text)))
        AND (w.customer_wo_id ILIKE ? OR w.old_system_id ILIKE ? OR w.new_system_id ILIKE ? OR w.old_module_id ILIKE ? OR w.new_module_id ILIKE ?)))`,
      `%${f.q.replace(/[\\%_]/g, "\\$&")}%`);
    const match = `SELECT DISTINCT e.operation_id FROM meterflo_audit.events e WHERE ${clauses.join(" AND ")}`;
    const base = `WITH matched AS (${match}) SELECT e.* FROM meterflo_audit.events e
      JOIN matched m ON m.operation_id=e.operation_id WHERE e.project_id=$1`;
    const { rows: [count] } = await client.query(`SELECT count(*)::int total FROM (${match}) m`, values);
    if (f.format) {
      const { rows: [events] } = await client.query(`SELECT count(*)::int total FROM (${base}) e`, values);
      if (events.total > 10000) throw Object.assign(new Error("More than 10,000 events match. Narrow the filters; no partial export was created."), { status: 413 });
    }
    const { rows: selected } = await client.query(`SELECT operation_id FROM (${base}) e GROUP BY operation_id
      ORDER BY max(occurred_at) DESC,operation_id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, f.format ? 10000 : f.pageSize, f.format ? 0 : (f.page - 1) * f.pageSize]);
    const { rows } = selected.length ? await client.query(`SELECT e.*
      FROM meterflo_audit.events e
      WHERE e.project_id=$1 AND e.operation_id=ANY($2::text[]) ORDER BY e.occurred_at DESC,e.sequence DESC`,
    [projectId, selected.map(s => s.operation_id)]) : { rows: [] };
    const { events: readableEvents, labels } = await lifecycleDisplayEvents(client, rows, schema, projectId);
    const groups = selected.map(s => {
      const events = readableEvents.filter(e => e.operationId === s.operation_id);
      const subjects = [...new Set(events.filter(e => ["work_orders", "workOrder"].includes(e.entityType)).map(e => e.entityReference))];
      return { operationId: s.operation_id, occurredAt: events[0]?.occurredAt, actorLabel: events[0]?.actorLabel,
        operationReference: events[0]?.operationReference || `Operation · Audit #${events[0]?.id}`,
        workOrderReference: f.workOrderId ? `Work order ${labels.get(f.workOrderId) ?? f.workOrderId}`
          : subjects.length === 1 ? subjects[0] : subjects.length > 1 ? `${subjects.length} work orders` : undefined,
        source: events[0]?.source, outcome: events.some(e => ["failed", "partial"].includes(e.outcome)) ? "partial" :
          events.find(e => e.action.endsWith(".finished"))?.outcome || events[0]?.outcome, events };
    });
    await client.query("COMMIT");
    return { groups, total: count.total, timezone, projectName: p.name };
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function historyPrint(data: Awaited<ReturnType<typeof workOrderHistory>>) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Work-order history</title>
    <style>body{font:14px system-ui;margin:24px}table{border-collapse:collapse;width:100%;margin:12px 0 24px}
    td,th{border:1px solid #ccc;text-align:left;padding:6px;vertical-align:top;overflow-wrap:anywhere}.value{white-space:pre-wrap}h2{font-size:18px}h3{font-size:15px}
    @media print{button{display:none}thead{display:table-header-group}tr{break-inside:avoid}}</style></head>
    <body><button onclick="window.print()">Print / Save PDF</button><h1>${escape(data.projectName)} — Work-order history</h1>
    <p>Timezone: ${escape(data.timezone)} · ${data.total} matching operations · Full related history for each matching operation.</p>
    ${data.groups.map(g => `<section><h2>${escape(g.workOrderReference || "Related work-order history")} · ${escape(g.operationReference)}</h2>
    <p>${escape(inventoryDateTime(g.occurredAt, data.timezone))} · ${escape(g.actorLabel)} · ${escape(historyFieldLabel(g.source || "web"))} · ${escape(historyDisplayText(g.outcome))}</p>
    ${g.events.map(e => `<h3>${escape(historyActionLabel(e.action))} — ${escape(e.entityReference || "Audit event")}</h3>
      <p>${escape(inventoryDateTime(e.occurredAt, data.timezone))} · ${escape(e.actorLabel)} · ${escape(historyDisplayText(e.outcome))}</p>
      ${(e.displayChanges ?? e.changes).length ? `<table><thead><tr><th>Change</th><th>Before</th><th>After</th></tr></thead><tbody>
      ${(e.displayChanges ?? e.changes).map(c => `<tr><th>${escape(historyFieldLabel(c.field))}</th><td class="value">${escape(historyDisplayText(c.before, c.field, data.timezone))}</td><td class="value">${escape(historyDisplayText(c.after, c.field, data.timezone))}</td></tr>`).join("")}
      </tbody></table>` : ""}
      ${Object.entries(e.displayMetadata ?? {}).filter(([key]) => !["operationId", "requestId", "fingerprint"].includes(key)).map(([key, value]) =>
        `<p class="value"><strong>${escape(historyFieldLabel(key))}:</strong> ${escape(historyDisplayText(value, key, data.timezone))}</p>`).join("")}`).join("")}</section>`).join("")}</body></html>`;
}
export function historyCsv(data: Awaited<ReturnType<typeof workOrderHistory>>) {
  const cell = (v: unknown) => `"${String(v ?? "").replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`;
  return "\uFEFF" + [["Operation", "Time", "Timezone", "Work order / entity", "Actor", "Source", "Action", "Result", "Changes", "Metadata"],
    ...data.groups.flatMap(g => g.events.map(e => [g.operationReference, inventoryDateTime(e.occurredAt, data.timezone),
      data.timezone, e.entityReference || e.entityLabel, e.actorLabel, e.source, historyActionLabel(e.action), historyDisplayText(e.outcome),
      (e.displayChanges ?? e.changes).map(c => `${historyFieldLabel(c.field)}: ${historyDisplayText(c.before, c.field, data.timezone)} → ${historyDisplayText(c.after, c.field, data.timezone)}`).join("\n"),
      historyDisplayText(e.displayMetadata ?? {}, "", data.timezone)]))]
    .map(row => row.map(cell).join(",")).join("\r\n");
}
