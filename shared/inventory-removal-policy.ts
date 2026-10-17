import { z } from "zod";
import type { Disposition, InventoryState } from "./inventory";
import { InventoryError } from "./inventory-errors";
import { getProjectEquipmentVisibility } from "./project-equipment-scope";

export const removalRuleSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(200),
  equipment: z.enum(["system", "module", "both"]), stage: z.enum(["field", "warehouse"]),
  outcome: z.enum(["returned", "scrapped", "left_onsite", "released"]),
  active: z.boolean(), revision: z.number().int().positive(),
}).strict().refine(r => r.stage === "field" ? r.outcome !== "released" : ["released", "scrapped"].includes(r.outcome),
  "Field rules cannot release stock; warehouse rules release or scrap after inspection.");
export type RemovalRule = z.infer<typeof removalRuleSchema>;
export const removalPolicySchema = z.object({
  id: z.literal("removal-policy"), revision: z.number().int().positive(),
  requireSystemReturn: z.boolean(), requireModuleReturn: z.boolean(),
}).strict();
export type RemovalPolicy = z.infer<typeof removalPolicySchema>;
export const defaultRemovalRules = (): RemovalRule[] => [
  { id: "ea936000-0000-4000-8000-000000000001", name: "Return to warehouse", stage: "field", outcome: "returned", equipment: "both", active: true, revision: 1 },
  { id: "ea936000-0000-4000-8000-000000000002", name: "Release inspected equipment to stock", stage: "warehouse", outcome: "released", equipment: "both", active: true, revision: 1 },
  { id: "ea936000-0000-4000-8000-000000000003", name: "Scrap after warehouse inspection", stage: "warehouse", outcome: "scrapped", equipment: "both", active: true, revision: 1 },
];
export function removalConfig(s: Pick<InventoryState, "removalRules" | "removalPolicies">) {
  return { rules: s.removalRules ?? defaultRemovalRules(), policy: s.removalPolicies?.[0] ??
    { id: "removal-policy" as const, revision: 1, requireSystemReturn: true, requireModuleReturn: true } };
}
export function normalizeRemovalPolicy(s: InventoryState): InventoryState {
  const { rules, policy } = removalConfig(s);
  return { ...s, removalRules: rules, removalPolicies: [policy] };
}
export function removalChoices(s: Pick<InventoryState, "removalRules" | "removalPolicies">, equipment: "system" | "module", stage: "field" | "warehouse") {
  const { rules, policy } = removalConfig(s);
  const required = equipment === "system" ? policy.requireSystemReturn : policy.requireModuleReturn;
  return rules.filter(r => r.active && r.stage === stage && [equipment, "both"].includes(r.equipment) &&
    (stage !== "field" || !required || r.outcome === "returned"));
}
export function resolveFieldDisposition(s: InventoryState, d: Disposition): Disposition {
  const { policy } = removalConfig(s);
  const choices = removalChoices(s, d.equipment, "field");
  // Old clients may submit the legacy return value only. Never infer a custom
  // scrap/onsite approval or trust client-supplied labels and snapshots.
  const rule = d.ruleId ? choices.find(r => r.id === d.ruleId) :
    d.disposition === "returned" ? choices.find(r => r.id === defaultRemovalRules()[0].id) : undefined;
  if (!rule || rule.outcome !== d.disposition)
    throw new InventoryError("Choose a currently approved removed-equipment disposition for this project.");
  if (d.ruleRevision !== undefined && d.ruleRevision !== rule.revision ||
      d.policyRevision !== undefined && d.policyRevision !== policy.revision)
    throw new InventoryError("Equipment removal rules changed. Review the current project rules before continuing.");
  if (rule.outcome === "returned" && !d.warehouseId)
    throw new InventoryError("Choose the warehouse required for removed equipment.");
  if (rule.outcome !== "returned" && d.warehouseId)
    throw new InventoryError("Only return-to-warehouse dispositions select a return location.");
  return { ...d, ruleId: rule.id, ruleRevision: rule.revision, ruleName: rule.name, policyRevision: policy.revision };
}
export function applyRemovalRuleCommand(s: InventoryState, action: string, data: Record<string, unknown>) {
  if (action === "removalPolicy") {
    const input = removalPolicySchema.parse(data), prior = removalConfig(s).policy;
    if (input.revision !== prior.revision) throw new InventoryError("Removal policy changed. Reload before saving.");
    s.removalPolicies = [{ ...input, revision: prior.revision + 1 }];
  } else if (action === "removalRule") {
    const input = removalRuleSchema.parse(data), prior = s.removalRules!.find(r => r.id === input.id);
    if (!prior && s.removalRules!.length >= 1000) throw new InventoryError("This project supports up to 1000 removal dispositions.");
    if (input.revision !== (prior?.revision ?? 1)) throw new InventoryError("Disposition changed. Reload before saving.");
    if (s.removalRules!.some(r => r.id !== input.id && r.name.toLowerCase() === input.name.toLowerCase()))
      throw new InventoryError("A disposition with this name already exists.");
    s.removalRules = [...s.removalRules!.filter(r => r.id !== input.id), { ...input, revision: prior ? prior.revision + 1 : 1 }];
  } else {
    const { id, revision } = z.object({ id: z.string().uuid(), revision: z.number().int() }).strict().parse(data);
    const prior = s.removalRules!.find(r => r.id === id);
    if (!prior || prior.revision !== revision) throw new InventoryError("Disposition changed. Reload before deleting.");
    if (s.allocations.some(a => a.dispositions.some(d => d.ruleId === id)) ||
        s.returns.some(r => r.ruleId === id || r.history?.some(h => h.ruleId === id)))
      throw new InventoryError("This disposition has been used. Disable it instead to retain its history.");
    s.removalRules = s.removalRules!.filter(r => r.id !== id);
  }
}

/** Server-added historical labels must not make an identical mobile retry differ. */
export function sameRemovalCapture(saved: Disposition[], submitted: Disposition[]) {
  return saved.length === submitted.length && saved.every(old => submitted.some(next =>
    old.equipment === next.equipment && old.serial === next.serial && old.disposition === next.disposition &&
    old.warehouseId === next.warehouseId && (next.ruleId === undefined ? next.disposition === "returned" : next.ruleId === old.ruleId) &&
    (next.ruleRevision === undefined || next.ruleRevision === old.ruleRevision) &&
    (next.policyRevision === undefined || next.policyRevision === old.policyRevision)));
}

export type RemovalWorkflow = { wizardMode: string; equipment: string; readingEquipment?: string };
type EquipmentCapture = Partial<Record<"system" | "module", { old?: string | null; new?: string | null }>>;

/** Completion safety is not restricted to the fields visible on a reading form. */
export function hasInventoryReplacement(prior: EquipmentCapture | null, next: EquipmentCapture, workflow: RemovalWorkflow) {
  const scope = getProjectEquipmentVisibility({ wizardMode: workflow.wizardMode,
    changeoutEquipmentType: workflow.equipment, readingEquipmentType: workflow.readingEquipment });
  return (["system", "module"] as const).some(equipment => {
    const old = next[equipment]?.old ?? "", fresh = next[equipment]?.new ?? "";
    if (!fresh) return false;
    const previousOld = prior?.[equipment]?.old ?? old;
    const replacement = fresh !== previousOld || fresh !== old;
    const applicable = equipment === "system" ? scope.showSystem : scope.showModule;
    const unchanged = prior !== null && (prior[equipment]?.old ?? "") === old &&
      (prior[equipment]?.new ?? "") === fresh;
    // Unchanged inapplicable history is retained. Editing a hidden identity or
    // changing both old/new together cannot hide a new physical replacement.
    return replacement && (applicable || !unchanged);
  });
}
export function validateRemovalWorkflow(mode: string, used: Array<{ itemId: string }>, dispositions: Disposition[], s: InventoryState, workflow: RemovalWorkflow) {
  if (workflow.wizardMode !== "user_choice" && mode !== workflow.wizardMode)
    throw new InventoryError("Inventory work type must match the project's workflow.");
  if (mode === "reading_only" && (used.length || dispositions.length))
    throw new InventoryError("Reading-only visits cannot consume stock or record removed equipment.");
  if (mode === "changeout" && ["system", "module"].includes(workflow.equipment)) {
    const outsideScope = (itemId: string, seen = new Set<string>()): boolean => {
      if (seen.has(itemId)) return false;
      seen.add(itemId);
      const item = s.items.find(i => i.id === itemId);
      return !!item && (item.equipment !== "none" && item.equipment !== workflow.equipment ||
        item.components.some(c => outsideScope(c.itemId, seen)));
    };
    if (dispositions.some(d => d.equipment !== workflow.equipment) ||
        used.some(l => outsideScope(l.itemId))) throw new InventoryError("Inventory equipment must match this project's equipment scope.");
  }
}
