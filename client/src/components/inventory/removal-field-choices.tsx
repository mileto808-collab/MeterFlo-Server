import { useRef, useState } from "react";
import type { InventoryState } from "@shared/inventory";
import { removalConfig, removalChoices } from "@shared/inventory-removal-policy";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function RemovalFieldChoices({ state, equipment, post, onDirty, locked, onBusy }: {
  state: InventoryState; equipment: "system" | "module";
  post: (data: Record<string, unknown>, operationId: string) => Promise<unknown>;
  onDirty: (dirty: boolean) => void;
  locked: boolean; onBusy: (busy: boolean) => void;
}) {
  const { toast } = useToast();
  const { rules, policy } = removalConfig(state);
  const required = equipment === "system" ? policy.requireSystemReturn : policy.requireModuleReturn;
  const eligible = rules.filter(rule => rule.active && rule.stage === "field" && [equipment, "both"].includes(rule.equipment) &&
    (!required || rule.outcome === "returned"));
  const stored = removalChoices(state, equipment, "field").map(rule => rule.id);
  const [draft, setDraft] = useState<{ ids: string[]; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const attempts = useRef(new Map<string, string>());
  const selected = draft?.ids ?? stored;
  const stale = !!draft && draft.revision !== policy.revision;
  return <fieldset disabled={busy || locked} className="space-y-2 rounded-md border p-3">
    <legend className="px-1 text-sm font-medium">Technician options — {equipment}s</legend>
    <p className="text-xs text-muted-foreground">{required
      ? "Only checked warehouse-return dispositions are available. Other actions remain hidden."
      : "Only the checked dispositions are available to technicians. Turning mandatory returns off does not enable other choices."}</p>
    {eligible.map(rule => <label key={rule.id} className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={selected.includes(rule.id)} onChange={event => {
        const ids = event.target.checked ? [...selected, rule.id] : selected.filter(id => id !== rule.id);
        setDraft({ ids, revision: draft?.revision ?? policy.revision }); onDirty(true);
      }} />{rule.name}
    </label>)}
    {!eligible.length && <p className="text-sm text-destructive">No eligible active field dispositions. Enable or create a matching disposition.</p>}
    {!selected.length && <p className="text-sm text-destructive">Select at least one disposition before saving.</p>}
    {stale && <p role="alert" className="text-sm text-destructive">Settings changed. Reload these options before saving; your selection has not been submitted.</p>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={!draft || stale || !selected.length} onClick={async () => {
        if (!draft) return;
        const data = { equipment, ruleIds: draft.ids, revision: draft.revision }, key = JSON.stringify(data);
        const operationId = attempts.current.get(key) ?? crypto.randomUUID();
        attempts.current.set(key, operationId); setBusy(true); onBusy(true);
        try {
          await post(data, operationId); attempts.current.delete(key); setDraft(null); onDirty(false);
        } catch (error) {
          toast({ title: "Technician options not saved", description: error instanceof Error ? error.message : "Retry after reconnecting.", variant: "destructive" });
        } finally { setBusy(false); onBusy(false); }
      }}>Save {equipment} options</Button>
      {draft && <Button type="button" size="sm" variant="outline" onClick={() => {
        if (window.confirm("Discard this selection and reload saved technician options?")) { setDraft(null); onDirty(false); }
      }}>Reload options</Button>}
    </div>
  </fieldset>;
}
