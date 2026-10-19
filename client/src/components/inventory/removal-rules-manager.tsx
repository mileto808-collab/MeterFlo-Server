import { useRef, useState } from "react";
import type { InventoryCommand, InventoryState } from "@shared/inventory";
import { removalConfig, isCoreRemovalRule, removalActionLabel, type RemovalRule } from "@shared/inventory-removal-policy";
import { RemovalFieldChoices } from "./removal-field-choices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

type Post = (action: InventoryCommand["action"], data: Record<string, unknown>, operationId: string) => Promise<unknown>;
const blankRule = (): RemovalRule => ({ id: crypto.randomUUID(), name: "", equipment: "both", stage: "field", outcome: "returned", active: true, revision: 1 });
const selectStyle = "h-10 w-full rounded-md border bg-background px-3 text-sm";
export function RemovalRulesManager({ state, authorized, post }: { state: InventoryState; authorized: boolean; post: Post }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<RemovalRule | null>(null);
  const [baseline, setBaseline] = useState("");
  const [localBusy, setBusy] = useState(false);
  const [choicesBusy, setChoicesBusy] = useState<Record<string, boolean>>({});
  const busy = localBusy || Object.values(choicesBusy).some(Boolean);
  const [choicesDirty, setChoicesDirty] = useState<Record<string, boolean>>({});
  const attempts = useRef(new Map<string, string>());
  const config = removalConfig(state);
  const current = form && config.rules.find(r => r.id === form.id);
  const stale = !!baseline && JSON.stringify(current ?? null) !== baseline;
  const dirty = !!form && JSON.stringify(form) !== baseline;
  const immutableBehavior = !!form && (isCoreRemovalRule(form.id) || state.fieldRemovalChoices?.some(choice => choice.ruleId === form.id) || state.allocations.some(allocation =>
    allocation.dispositions.some(disposition => disposition.ruleId === form.id)) ||
    state.returns.some(record => record.ruleId === form.id || record.history?.some(event => event.ruleId === form.id)));
  const change = (patch: Partial<RemovalRule>) => setForm(r => r ? { ...r, ...patch } : r);
  const run = async (action: InventoryCommand["action"], data: Record<string, unknown>, closeForm = false) => {
    if (busy || !authorized) return;
    const fingerprint = JSON.stringify({ action, data });
    const id = attempts.current.get(fingerprint) ?? crypto.randomUUID();
    attempts.current.set(fingerprint, id);
    setBusy(true);
    try {
      await post(action, data, id);
      attempts.current.delete(fingerprint);
      if (closeForm) { setForm(null); setBaseline(""); }
    } catch (e) {
      toast({ title: "Removal settings not saved", description: e instanceof Error ? e.message : "Retry after reconnecting.", variant: "destructive" });
    } finally { setBusy(false); }
  };
  const leaveForm = () => {
    if (busy || dirty && !window.confirm("Discard unsaved disposition changes?")) return false;
    setForm(null); setBaseline(""); return true;
  };
  if (!authorized) return null;
  return <>
    <Button type="button" size="sm" onClick={() => setOpen(true)}>Removal rules</Button>
    <Dialog open={open} onOpenChange={value => {
      if (!value && busy) return;
      if (!value && Object.values(choicesDirty).some(Boolean) && !window.confirm("Discard unsaved technician option selections?")) return;
      if (value || leaveForm()) { setOpen(value); if (!value) setChoicesDirty({}); }
    }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" data-testid="removal-rules-manager">
        <DialogHeader><DialogTitle>Equipment removal rules</DialogTitle><DialogDescription>Project-specific contract rules. Field decisions are separate from warehouse inspection decisions.</DialogDescription></DialogHeader>
        <fieldset disabled={busy} className="space-y-3 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Mandatory warehouse returns</legend>
          {(["system", "module"] as const).map(e => {
            const key = e === "system" ? "requireSystemReturn" : "requireModuleReturn";
            return <label key={e} className="flex items-center gap-2 text-sm"><Checkbox checked={config.policy[key]} onCheckedChange={value => {
              if (value !== true && !window.confirm(`Make returns optional for removed ${e}s? Only individually checked technician options will be available. Existing returns remain due.`)) return;
              void run("removalPolicy", { ...config.policy, [key]: value === true });
            }} />All removed {e}s must return to warehouse</label>;
          })}
        </fieldset>
        {(["system", "module"] as const).map(equipment => <RemovalFieldChoices key={equipment} state={state} equipment={equipment}
          locked={busy} onBusy={saving => setChoicesBusy(current => ({ ...current, [equipment]: saving }))}
          onDirty={dirty => setChoicesDirty(current => ({ ...current, [equipment]: dirty }))}
          post={(data, operationId) => post("removalFieldChoices", data, operationId)} />)}
        {form ? <fieldset disabled={busy} className="space-y-3 rounded-md border p-3">
          <h3 className="font-medium">{current ? "Edit disposition" : "Add disposition"}</h3>
          {stale && <div role="alert" className="space-y-2 text-sm text-destructive">This disposition changed elsewhere. Your input is retained; reload the rule before saving.<Button type="button" variant="outline" onClick={() => { if (current && window.confirm("Discard local edits and reload this disposition?")) { setForm(current); setBaseline(JSON.stringify(current)); } }}>Reload rule</Button></div>}
          <div><Label htmlFor="removal-name">Disposition name</Label><Input id="removal-name" value={form.name} onChange={e => change({ name: e.target.value })} maxLength={200} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label htmlFor="removal-equipment">Equipment</Label><select id="removal-equipment" className={selectStyle} disabled={immutableBehavior} value={form.equipment} onChange={e => change({ equipment: e.target.value as RemovalRule["equipment"] })}><option value="both">Systems and modules</option><option value="system">Systems</option><option value="module">Modules</option></select></div>
            <div><Label htmlFor="removal-stage">Available to</Label><select id="removal-stage" className={selectStyle} disabled={immutableBehavior} value={form.stage} onChange={e => change({ stage: e.target.value as RemovalRule["stage"], outcome: e.target.value === "field" ? "returned" : "released" })}><option value="field">Field technicians</option><option value="warehouse">Authorized warehouse decision makers</option></select></div>
          </div>
          {immutableBehavior ? <p className="text-sm">Inventory action: {removalActionLabel(form.outcome)}. This behavior is fixed; the name and enabled setting can change.</p> :
            <details className="space-y-2 rounded-md border p-3"><summary className="cursor-pointer text-sm">Inventory behavior (advanced)</summary>
              <p className="text-xs text-muted-foreground">Configure once for this custom disposition. Its name does not determine its behavior.</p>
              <Label htmlFor="removal-outcome">Inventory action</Label><select id="removal-outcome" className={selectStyle} value={form.outcome} onChange={e => change({ outcome: e.target.value as RemovalRule["outcome"] })}>
                {form.stage === "field" ? <><option value="returned">Return to warehouse</option><option value="scrapped">Scrap in field</option><option value="left_onsite">Leave onsite</option></> :
                  <><option value="released">Return to usable stock</option><option value="scrapped">Scrap</option><option value="customer_return">Return to customer — hold, then confirm handoff</option></>}
              </select>
            </details>}
          {form.stage === "field" && form.outcome !== "returned" && <p className="text-xs text-muted-foreground">This rule is hidden and rejected for equipment with mandatory returns enabled.</p>}
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={form.active} onCheckedChange={v => change({ active: v === true })} />Enabled</label>
          <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || stale || !form.name.trim()} onClick={() => void run("removalRule", form, true)}>Save disposition</Button><Button type="button" variant="outline" disabled={busy} onClick={leaveForm}>Cancel edit</Button></div>
        </fieldset> : <Button type="button" disabled={busy} onClick={() => { setForm(blankRule()); setBaseline("null"); }}>Add disposition</Button>}
        <div className="space-y-2">
          {config.rules.map(rule => {
            const used = isCoreRemovalRule(rule.id) || state.allocations.some(a => a.dispositions.some(d => d.ruleId === rule.id)) ||
              state.returns.some(r => r.ruleId === rule.id || r.history?.some(h => h.ruleId === rule.id));
            return <article key={rule.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3">
              <div className="min-w-0 flex-1"><p className="break-words font-medium">{rule.name}{!rule.active ? " · Disabled" : ""}</p><p className="text-xs text-muted-foreground">{rule.stage === "field" ? "Field" : "Warehouse"} · {rule.equipment}{isCoreRemovalRule(rule.id) ? " · Built-in" : ` · ${removalActionLabel(rule.outcome)}`}</p></div>
              <div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { if (!form || leaveForm()) { setForm(rule); setBaseline(JSON.stringify(rule)); } }}>Edit</Button><Button type="button" size="sm" variant="outline" disabled={busy || used} title={used ? "Used dispositions can be disabled, not deleted." : undefined} onClick={() => {
                if (window.confirm(`Delete unused disposition "${rule.name}"?`)) void run("removalRuleDelete", { id: rule.id, revision: rule.revision });
              }}>Delete</Button></div>
            </article>;
          })}
        </div>
        <p className="text-xs text-muted-foreground">Used rules retain their recorded labels and outcomes. Disable them to prevent future selection. Receipt into quarantine never automatically releases stock.</p>
      </DialogContent>
    </Dialog>
  </>;
}
