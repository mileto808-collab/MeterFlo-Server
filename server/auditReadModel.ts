import type { PoolClient } from "pg";
import type { AuditEvent } from "../shared/audit";
import type { InventoryState } from "../shared/inventory";
import { inventoryCountReference } from "../shared/inventory-count-reference";
import { orderLabel } from "../shared/inventory-order-labels";
import { eventDto, safeAuditLabel } from "./auditService";

const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const readable = (value: unknown) => typeof value === "string" && value.trim() && !uuid.test(value) ? safeAuditLabel(value) : "";
const names: Record<string, string> = {
  orders: "Order", counts: "Cycle count", items: "Item", vendors: "Vendor", warehouses: "Location",
  allocations: "Work order", returns: "Removed equipment", shipmentHolds: "Inspection hold",
  shipmentDrafts: "Shipment draft", kitAssemblies: "Kit assembly", kitHolds: "Kit inspection hold",
};

export function inventoryAuditReferences(state: InventoryState): Map<string, string> {
  const refs = new Map<string, string>();
  for (const row of state.warehouses) refs.set(row.id, `${row.code} · ${row.name}`);
  for (const row of state.items) refs.set(row.id, `${row.sku} · ${row.name}`);
  for (const row of state.vendors) refs.set(row.id, row.name);
  for (const row of state.orders) refs.set(row.id, orderLabel(row));
  for (const row of state.counts) refs.set(row.id, inventoryCountReference(state.counts, row.id));
  for (const [n, row] of state.receipts.entries()) refs.set(row.id, `Receipt #${n + 1}${refs.has(row.reference) ? ` · ${refs.get(row.reference)}` : ""}`);
  for (const kind of ["shipmentHolds", "shipmentDrafts", "kitHolds"] as const)
    for (const [n, row] of (state[kind] ?? []).entries()) refs.set(row.id, `${names[kind]} #${n + 1}`);
  for (const row of state.kitAssemblies ?? []) refs.set(row.id, `Kit assembly · ${refs.get(row.id) ?? refs.get(row.itemId) ?? "Recorded kit"}`);
  for (const row of state.categoryCatalog ?? []) refs.set(row.id, row.name);
  return refs;
}

export function inventoryAuditEntity(
  state: InventoryState, changes: {field:string;before:unknown;after:unknown}[], operationId: string,
): string | undefined {
  const refs = inventoryAuditReferences(state);
  if (refs.has(operationId)) return refs.get(operationId);
  for (const kind of ["orders", "counts", "items", "warehouses", "vendors", "allocations", "returns", "shipmentHolds", "kitAssemblies", "kitHolds", "shipmentDrafts"]) {
    const change = changes.find(c => c.field.startsWith(`${kind}/`));
    if (!change) continue;
    const id = change.field.slice(kind.length + 1), value = (change.after ?? change.before) as any;
    return refs.get(id) || (kind === "allocations" ? `Work order #${id}` :
      readable(value?.orderNumber) || readable(value?.reference) || readable(value?.name) ||
      `${names[kind]} (historical record)`);
  }
  if (changes.some(c => c.field === "categoryCatalog")) return "Item categories";
  return undefined;
}

// This projection is used for BOTH filtering and presentation. No stored audit
// row is rewritten, and the join never expands the caller's authorized events.
const changeFor = (kind:string, id:string) =>
  `EXISTS(SELECT 1 FROM jsonb_array_elements(e.changes) ac WHERE ac->>'field'='${kind}/'||(${id}))`;
export const auditEntitySql = `COALESCE(
  CASE WHEN e.entity_label<>e.entity_id AND e.entity_label !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' THEN e.entity_label END,
  CASE WHEN e.entity_type='inventory' THEN COALESCE(
    (SELECT 'Count #'||c.n FROM jsonb_array_elements(COALESCE(i.state->'counts','[]')) WITH ORDINALITY c(obj,n)
      WHERE ${changeFor("counts", "c.obj->>'id'")} LIMIT 1),
    (SELECT COALESCE(NULLIF(o.obj->>'orderNumber',''),NULLIF(o.obj->>'reference',''),
      CASE WHEN o.obj->>'type'='transfer' THEN 'Transfer order' ELSE 'Purchase order' END)
      FROM jsonb_array_elements(COALESCE(i.state->'orders','[]')) o(obj)
      WHERE ${changeFor("orders", "o.obj->>'id'")} OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(COALESCE(i.state->'receipts','[]')) r
        WHERE r->>'id'=e.entity_id AND r->>'reference'=o.obj->>'id') LIMIT 1),
    (SELECT COALESCE(ac->'after'->>'name',ac->'before'->>'name')
      FROM jsonb_array_elements(e.changes) ac
      WHERE split_part(ac->>'field','/',1) IN ('items','warehouses','vendors') LIMIT 1)
  ) END,
  CASE WHEN e.entity_type IN ('work_orders','workOrder') AND e.entity_id ~ '^[0-9]+$' THEN 'Work order #'||e.entity_id END,
  CASE WHEN e.entity_id !~* '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' THEN e.entity_label END,
  'Audit event #'||e.sequence)`;
export const auditReadFrom = `meterflo_audit.events e LEFT JOIN public.projects p ON p.id=e.project_id
  LEFT JOIN public.inventory_state i ON i.project_id=e.project_id AND e.entity_type='inventory'`;

export async function readableAuditEvents(client: PoolClient, rows: any[]): Promise<AuditEvent[]> {
  const projectIds = [...new Set(rows.filter(r => r.project_id !== null && r.entity_type === "inventory").map(r => r.project_id))];
  const states = projectIds.length ? await client.query("SELECT project_id,state FROM public.inventory_state WHERE project_id=ANY($1::int[])", [projectIds]) : {rows:[]};
  const references = new Map<number,Map<string,string>>(states.rows.map(r => [r.project_id, inventoryAuditReferences(r.state)]));
  const operationIds = [...new Set(rows.map(r => r.operation_id))];
  const operations = operationIds.length ? await client.query(`SELECT operation_id,project_id,min(sequence)::text first
    FROM meterflo_audit.events WHERE operation_id=ANY($1::text[])
      AND (project_id=ANY($2::int[]) OR ($3::boolean AND project_id IS NULL))
    GROUP BY operation_id,project_id`, [operationIds, [...new Set(rows.map(r => r.project_id).filter(id => id !== null))],
      rows.some(r => r.project_id === null)]) : {rows:[]};
  const operationRefs = new Map(operations.rows.map(r => [`${r.operation_id}/${r.project_id}`, `Operation #${r.first}`]));
  return rows.map(row => {
    const event = eventDto(row), refs = new Map(references.get(event.projectId ?? -1) ?? []);
    if (event.actorId && readable(event.actorLabel)) refs.set(event.actorId,event.actorLabel);
    // A record's historical name is evidence, not today's renamed catalog name.
    for (const change of event.changes) {
      const [kind, id] = change.field.split("/"), value = (change.after ?? change.before) as any;
      if (["items", "warehouses", "vendors"].includes(kind) && readable(value?.name))
        refs.set(id, value.sku ? `${value.sku} · ${value.name}` : value.code ? `${value.code} · ${value.name}` : value.name);
      if (kind === "orders" && value) refs.set(id, readable(value.orderNumber) || readable(value.reference) || refs.get(id) || "Order (historical record)");
    }
    const display = (value:unknown, key = ""):unknown => {
      if (Array.isArray(value)) return value.map(v => display(v, key));
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,display(v,k)]));
      // Serial values and user-entered free text are never normalized.
      const referenceKey = key === "id" || /(?:user|actor|warehouse|location|item|category|order|count|operation|receipt|vendor|draft|assembly|hold|project)(?:Id|_id)$/i.test(key) ||
        /^(actor|savedBy|createdBy|saved_by|created_by|reference)$/.test(key);
      if (typeof value === "string" && referenceKey && uuid.test(value))
        return refs.get(value) ?? "Internal reference (see raw evidence)";
      return value;
    };
    const fieldLabel = (field:string) => {
      const [kind, id] = field.split("/");
      if (names[kind] && id) return refs.get(id) ?? (kind === "allocations" ? `Work order #${id}` : `${names[kind]} (historical record)`);
      if (id && refs.has(kind) && refs.has(id)) return `${refs.get(kind)} / ${refs.get(id)}`;
      return uuid.test(field) ? "Inventory balance (see raw evidence)" : field;
    };
    return {...event, eventReference:`Audit #${row.sequence}`,
      entityReference: safeAuditLabel(row.resolved_entity || `Audit event #${row.sequence}`),
      projectReference: safeAuditLabel(event.projectLabel || row.current_project_label || (event.projectId ? `Project ${event.projectId}` : "Global")),
      operationReference:operationRefs.get(`${event.operationId}/${event.projectId}`) ?? `Operation · Audit #${row.sequence}`,
      displayChanges:event.changes.map(c => ({field:fieldLabel(c.field),before:display(c.before),after:display(c.after)})),
      displayMetadata:display(event.metadata) as Record<string,unknown>};
  });
}
