import type { PoolClient } from "pg";
import { pool } from "./db";
import { dispatchFromEvidence, type InventoryDispatch } from "../shared/inventory-dispatch";
import { fulfillmentTicketNumber } from "../shared/inventory-pickups";

type Query = Pick<PoolClient, "query">;
type Work = {
  id?: number; assignedUserId?: string | null; assignedGroupId?: string | number | null;
  newSystemType?: unknown; newModuleType?: unknown; status?: string; assignmentVersion?: number;
};

/** Set-based projection: no inventory aggregate load and no per-order database queries. */
export async function inventoryDispatchScope(
  projectId: number, userId: string, orders: Work[], client: Query = pool,
) {
  const { rows: [project] } = await client.query(`SELECT p.inventory_enabled,p.wizard_mode,p.changeout_equipment_type,
    coalesce(f.source_mode,'assigned_vehicle') source_mode
    FROM public.projects p LEFT JOIN public.inventory_field_settings f
      ON f.project_id=p.id AND f.id='field-defaults' WHERE p.id=$1`, [projectId]);
  const enabled = !!project?.inventory_enabled && project.wizard_mode !== "reading_only";
  const ids = orders.map(w => w.id).filter((id): id is number => Number.isInteger(id));
  const dispatch = new Map<number, InventoryDispatch>();
  const requires = new Set<number>();
  const batched = new Set<number>();
  if (!enabled || !ids.length) return { enabled, dispatch, requires, batched };
  const { rows } = await client.query(`SELECT saved.work_order_id,b.id batch_id,b.name batch_name,b.mode,b.status,
    saved.assignment_version,saved.installer_id,v.id vehicle_id,v.name vehicle_name,v.active vehicle_active,
    (v.assigned_user_id=$3 OR EXISTS(SELECT 1 FROM public.inventory_warehouses_values vu
      WHERE vu.project_id=v.project_id AND vu.parent_id=v._key AND vu.field='userIds' AND vu.value=$3)) member,
    coalesce(b.pickup_ready,false) OR NOT EXISTS(SELECT 1 FROM public.inventory_fulfillment_lines pending
      WHERE pending.project_id=b.project_id AND pending.parent_id=b._key AND pending.staged_quantity<pending.quantity) ready,
    EXISTS(SELECT 1 FROM public.inventory_fulfillment_issues issue
      WHERE issue.project_id=b.project_id AND issue.parent_id=b._key AND issue.status='open') issue,
    coalesce(sum(l.quantity),0)::int required,coalesce(sum(l.staged_quantity),0)::int staged,
    coalesce(sum(l.delivered_quantity),0)::int delivered,b.created_at,b._position
    FROM public.inventory_fulfillment_batches b
    JOIN public.inventory_fulfillment_work_orders saved ON saved.project_id=b.project_id AND saved.parent_id=b._key
    JOIN public.inventory_warehouses v ON v.project_id=b.project_id AND v.id=b.vehicle_id
    LEFT JOIN public.inventory_fulfillment_lines l ON l.project_id=b.project_id AND l.parent_id=b._key AND l.work_order_id=saved.work_order_id
    WHERE b.project_id=$1 AND saved.work_order_id=ANY($2::int[]) AND b.status<>'cancelled'
    GROUP BY b.project_id,b._key,saved.work_order_id,saved.assignment_version,saved.installer_id,v.project_id,v._key
    ORDER BY b.created_at DESC,b._position DESC`, [projectId, ids, userId]);
  // Plans are relational business data; a manual positive material line also needs dispatch.
  const { rows: manual } = await client.query(`SELECT DISTINCT p.work_order_id
    FROM public.inventory_work_plans p JOIN public.inventory_work_plan_lines l
      ON l.project_id=p.project_id AND l.parent_id=p._key
    JOIN public.inventory_items i ON i.project_id=l.project_id AND i.id=l.item_id
    WHERE p.project_id=$1 AND p.work_order_id=ANY($2::int[]) AND l.quantity>0 AND i.kind<>'labor'`,
  [projectId, ids]);
  if (project.source_mode !== "project_warehouse") {
    for (const work of orders) {
      const system = project.changeout_equipment_type !== "module" && work.newSystemType != null && work.newSystemType !== "";
      const module = project.changeout_equipment_type !== "system" && work.newModuleType != null && work.newModuleType !== "";
      if (work.id && (system || module)) requires.add(work.id);
    }
    for (const work of manual) requires.add(work.work_order_id);
  }
  const { rows: readingOnly } = await client.query(`SELECT work_order_id FROM public.inventory_allocations
    WHERE project_id=$1 AND work_order_id=ANY($2::int[]) AND mode='reading_only'`, [projectId, ids]);
  for (const row of readingOnly) requires.delete(row.work_order_id);
  const workById = new Map(orders.map(work => [work.id, work]));
  const { rows: membership } = await client.query(`SELECT w.id, w.assigned_user_id,
    coalesce(array_agg(v.value) FILTER (WHERE v.value IS NOT NULL),'{}') users
    FROM public.inventory_warehouses w LEFT JOIN public.inventory_warehouses_values v
      ON v.project_id=w.project_id AND v.parent_id=w._key AND v.field='userIds'
    WHERE w.project_id=$1 AND w.active GROUP BY w.project_id,w._key`, [projectId]);
  const crew = new Map<string, Set<string>>(membership.map(row =>
    [row.id, new Set<string>([...row.users, row.assigned_user_id].filter(Boolean))]));
  for (const row of rows) {
    batched.add(row.work_order_id);
    const work = workById.get(row.work_order_id) as (Work & { assignmentVersion?: number }) | undefined;
    const value = dispatchFromEvidence({
      batchId: row.batch_id, batchName: row.batch_name, receiptNumber: fulfillmentTicketNumber(row.created_at, row._position),
      vehicleId: row.vehicle_id, vehicleName: row.vehicle_name, member: !!row.member,
      mode: row.mode, status: row.status, assignmentVersion: row.assignment_version,
      currentVersion: work?.assignmentVersion ?? 0, installerId: row.installer_id,
      currentInstallerId: work?.assignedUserId ?? null, staged: row.staged, delivered: row.delivered,
      currentInstallerMember: !!work?.assignedUserId && !!crew.get(row.vehicle_id)?.has(work.assignedUserId),
      currentStatus: work?.status?.toLowerCase(),
      required: row.required, ready: row.ready, issue: row.issue, activeVehicle: row.vehicle_active,
    });
    if (value && !dispatch.has(row.work_order_id)) dispatch.set(row.work_order_id, value);
  }
  return { enabled, dispatch, requires, batched };
}
