import type { EquipmentReturn, InventoryState } from "./inventory";
import { removalConfig } from "./inventory-removal-policy";

type Capture = { ruleId?: string; ruleName?: string; disposition?: string; outcome?: string };
type Stage = "field" | "warehouse";
type HistoryEvent = NonNullable<EquipmentReturn["history"]>[number];
type ActivityEntry = { record: EquipmentReturn; event: HistoryEvent };
export const removalFilterKey = (id: string, outcome: string) => `${id}:${outcome}`;
export const removalStatusLabel = (status: EquipmentReturn["status"]) => ({
  pending: "Awaiting warehouse receipt", quarantine: "Quarantine", released: "Returned to stock",
  scrapped: "Scrapped", left_onsite: "Left onsite", customer_pending: "Awaiting customer handoff", customer_returned: "Returned to customer",
})[status];

/** Current names follow project rules; historical events keep their recorded names. */
export function removalDispositionDisplay(state: InventoryState, capture: Capture, stage: Stage, historical = false) {
  const outcome = capture.disposition ?? capture.outcome ?? "";
  const rule = removalConfig(state).rules.find(rule =>
    rule.id === capture.ruleId && rule.stage === stage && rule.outcome === outcome);
  const saved = capture.ruleName?.trim();
  const label = (historical ? saved || rule?.name : rule?.name || saved) ||
    ({ returned: "Returned to warehouse", scrapped: "Scrapped", left_onsite: "Left onsite", released: "Released to stock",
      customer_return: "Return to customer" }[outcome] ?? "Disposition not recorded");
  return {
    label,
    // Missing identity is not evidence that a custom rule sharing this outcome was used.
    key: capture.ruleId ? removalFilterKey(capture.ruleId, outcome) : `recorded:${JSON.stringify([outcome, saved ?? ""])}`,
  };
}

export function warehouseRemovalDecision(record: EquipmentReturn) {
  if (record.disposition !== "returned") return undefined;
  for (const event of [...(record.history ?? [])].reverse()) {
    if (event.outcome === "decision_corrected") return undefined;
    if (["released", "scrapped", "customer_return"].includes(event.outcome)) return event;
  }
  return undefined;
}

export function removalHistoryLabel(state: InventoryState, record: EquipmentReturn, event: HistoryEvent) {
  if (event.outcome === "quarantine") return "Accepted into quarantine";
  if (event.outcome === "decision_corrected") return `Warehouse decision corrected · Previously ${removalStatusLabel(event.previousStatus as EquipmentReturn["status"]) ?? event.previousStatus ?? "recorded"}${event.physicallyPresent ? " · Physical presence verified" : ""}`;
  if (event.outcome === "customer_returned") return `Returned to customer · ${event.recipient ?? "Recipient not recorded"}${event.reference ? ` · Reference: ${event.reference}` : ""}`;
  return removalDispositionDisplay(state, event,
    record.disposition === "returned" && ["released", "scrapped", "customer_return"].includes(event.outcome) ? "warehouse" : "field", true).label;
}

/** Index exact receipt/history identities: later decisions must not relabel earlier activity. */
export function removalActivityIndex(state: InventoryState) {
  const index = new Map<string, ActivityEntry[]>();
  for (const record of state.returns) for (const event of record.history ?? [])
    index.set(event.operationId, [...(index.get(event.operationId) ?? []), { record, event }]);
  return index;
}

export function removalActivityDisplay(state: InventoryState, entries: readonly ActivityEntry[]) {
  const fields = entries.map(({ record }) => removalDispositionDisplay(state, record, "field", true));
  const decisions = entries.filter(({ record, event }) =>
    record.disposition === "returned" && ["released", "scrapped", "customer_return"].includes(event.outcome))
    .map(({ event }) => removalDispositionDisplay(state, event, "warehouse", true));
  return {
    fields, decisions,
    fieldLabel: [...new Set(fields.map(field => field.label))].join("; "),
    decisionLabel: [...new Set(decisions.map(decision => decision.label))].join("; "),
    custodyLabel: [...new Set(entries.filter(({ event }) => ["quarantine", "decision_corrected", "customer_returned"].includes(event.outcome))
      .map(({ record, event }) => removalHistoryLabel(state, record, event)))].join("; "),
  };
}
