import { z } from "zod";
import type { InventoryState } from "./inventory";
import { InventoryError } from "./inventory-errors";

export const plannedLineSchema = z.object({
  id: z.string().uuid(), itemId: z.string().min(1).max(100),
  quantity: z.number().int().min(0).max(1000000),
  kind: z.enum(["addition", "override"]), reason: z.string().trim().max(1000).default(""),
}).strict().superRefine((line, ctx) => {
  if (line.kind === "addition" && line.quantity < 1)
    ctx.addIssue({ code: "custom", path: ["quantity"], message: "Additional quantity must be positive." });
  if (line.kind === "override" && line.reason.length < 10)
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Explain the override in at least 10 characters." });
});
export const workPlanInputSchema = z.object({
  workOrderId: z.number().int().positive(), revision: z.number().int().nonnegative(),
  lines: z.array(plannedLineSchema).max(500),
}).strict();
export type PlannedLine = z.infer<typeof plannedLineSchema>;
export type WorkPlan = z.infer<typeof workPlanInputSchema> & { updatedBy?: string; updatedAt?: string };

export function effectivePlannedLines(automatic: { itemId: string; quantity: number }[], manual: PlannedLine[]) {
  const totals = new Map(automatic.map(line => [line.itemId, line.quantity]));
  for (const line of manual.filter(line => line.kind === "override"))
    if (totals.has(line.itemId)) totals.set(line.itemId, line.quantity);
  for (const line of manual.filter(line => line.kind === "addition"))
    totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + line.quantity);
  return [...totals].filter(([, quantity]) => quantity > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
}

export function updateWorkPlan(state: InventoryState, data: unknown, actor: string, now: string) {
  const input = workPlanInputSchema.parse(data);
  const previous = state.workPlans?.find(plan => plan.workOrderId === input.workOrderId);
  if ((previous?.revision ?? 0) !== input.revision)
    throw Object.assign(new InventoryError("Planned items changed. Reload the plan before saving; your edits have not been applied."), { status: 409 });
  if (new Set(input.lines.map(line => line.id)).size !== input.lines.length)
    throw new InventoryError("Planned line identities must be unique.");
  const overrides = input.lines.filter(line => line.kind === "override");
  if (new Set(overrides.map(line => line.itemId)).size !== overrides.length)
    throw new InventoryError("Only one override is allowed for each automatic item.");
  if (input.lines.some(line => !state.items.some(item => item.id === line.itemId && item.active)))
    throw new InventoryError("Choose active items from this project.");
  const next: WorkPlan = { ...input, revision: input.revision + 1, updatedBy: actor, updatedAt: now };
  state.workPlans = [...(state.workPlans ?? []).filter(plan => plan.workOrderId !== input.workOrderId), next];
}
