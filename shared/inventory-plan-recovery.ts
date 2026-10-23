import type { InventoryCommand, InventoryState } from "./inventory";
import { canonicalInventoryJson } from "./inventory-engine";
import { workPlanInputSchema } from "./inventory-planning";

/** Called only while holding the same relational inventory lock as command posting. */
export function resolvePlanOutcome(state: InventoryState, command: InventoryCommand, actor: string,
  mode: "lookup" | "resolve", now = new Date().toISOString()) {
  if (command.action !== "plan") throw new Error("Only plan command outcomes are supported.");
  const workOrderId = workPlanInputSchema.parse(command.data).workOrderId;
  const fingerprint = canonicalInventoryJson({ action: command.action, data: command.data, actor });
  const outcome = state.planOperationOutcomes?.find(value => value.id === command.operationId);
  const operation = state.operations[command.operationId];
  const unresolved = { status: "unresolved" as const, acceptedRevision: null, occurredAt: null };
  if (outcome) {
    if (outcome.fingerprint !== fingerprint || outcome.actor !== actor || outcome.workOrderId !== command.data.workOrderId)
      return { state, result: unresolved };
    return { state, result: { status: outcome.status, acceptedRevision: outcome.acceptedRevision ?? null,
      occurredAt: outcome.occurredAt } };
  }
  if (operation) return { state, result: operation === fingerprint
    ? { status: "accepted" as const, acceptedRevision: null, occurredAt: null }
    : unresolved };
  if (mode === "lookup") return { state, result: unresolved };
  const after = structuredClone(state);
  (after.planOperationOutcomes ??= []).push({ id: command.operationId, actor, workOrderId,
    fingerprint, status: "rejected", occurredAt: now });
  after.revision++;
  return { state: after, result: { status: "rejected" as const, acceptedRevision: null, occurredAt: now } };
}
