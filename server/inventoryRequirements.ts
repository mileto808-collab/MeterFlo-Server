import type { PoolClient } from "pg";
import type { InventoryState, WorkRequirements } from "../shared/inventory";
import { deduplicateRequirements } from "../shared/inventory-requirements";
import { effectivePlannedLines } from "../shared/inventory-planning";

export async function workRequirements(client: Pick<PoolClient, "query">, projectId: number, state: InventoryState, work: any): Promise<WorkRequirements> {
  const ids: string[] = [], missing: WorkRequirements["missing"] = [];
  const { rows: [project] } = await client.query("SELECT changeout_equipment_type FROM public.projects WHERE id=$1", [projectId]);
  for (const equipment of ["system", "module"] as const) {
    if (project?.changeout_equipment_type === "system" && equipment === "module" ||
        project?.changeout_equipment_type === "module" && equipment === "system") continue;
    const value = work?.[`new_${equipment}_type`];
    if (value === null || value === undefined || value === "") continue;
    const { rows: [type] } = await client.query(`SELECT t.id FROM public.${equipment}_types t
      JOIN public.${equipment}_type_projects p ON p.${equipment}_type_id=t.id
      WHERE p.project_id=$1 AND (t.product_id=$2 OR t.id::text=$2) ORDER BY (t.product_id=$2) DESC LIMIT 1`, [projectId, String(value)]);
    const link = type && state.typeLinks?.find(l => l.equipment === equipment && l.typeId === type.id);
    if (link && state.items.some(i => i.id === link.itemId && i.active)) ids.push(link.itemId);
    else missing.push({ equipment, typeId: String(value) });
  }
  const automaticLines = deduplicateRequirements(state, ids);
  const plan = state.workPlans?.find(plan => plan.workOrderId === work.id);
  return { workOrderId: work.id, lines: effectivePlannedLines(automaticLines, plan?.lines ?? []), missing,
    automaticLines, manualLines: plan?.lines ?? [], planRevision: plan?.revision ?? 0 };
}

export function setWorkRequirements(state: InventoryState, requirements: WorkRequirements) {
  requirements = { workOrderId: requirements.workOrderId, lines: requirements.lines, missing: requirements.missing,
    ...(requirements.automaticLines ? { automaticLines: requirements.automaticLines } : {}) };
  if (!requirements.lines.length && !requirements.missing.length) {
    if (state.workRequirements) state.workRequirements = state.workRequirements.filter(r => r.workOrderId !== requirements.workOrderId);
    return;
  }
  const index = (state.workRequirements ??= []).findIndex(r => r.workOrderId === requirements.workOrderId);
  if (index === -1) state.workRequirements.push(requirements);
  else state.workRequirements[index] = requirements;
}
