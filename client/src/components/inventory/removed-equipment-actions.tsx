import { useRef, useState } from "react";
import { inventoryDateTime } from "@shared/inventory-date-time";
import type { EquipmentReturn, InventoryState } from "@shared/inventory";
import { removalChoices } from "@shared/inventory-removal-policy";
import { removalHistoryLabel } from "@shared/inventory-removal-display";
import { RemovedEquipmentCustodyActions, type CustodyAction } from "./removed-equipment-custody-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

export type ReturnDecisionDraft = { ruleId: string; basis: string; itemId: string; reason: string };
export function RemovedEquipmentActions({ record, state, canReceive, canDecide, post, draft, onDraft, actorLabel, timezone }: {
  record: EquipmentReturn; state: InventoryState; canReceive: boolean; canDecide: boolean;
  post: (action: "returnAccept" | "returnDecide" | CustodyAction, data: Record<string, unknown>, operationId: string) => Promise<unknown>;
  draft?: ReturnDecisionDraft; onDraft: (draft: ReturnDecisionDraft | null) => void;
  actorLabel: (id: string) => string;
  timezone: string;
}) {
  const { toast } = useToast();
  const { ruleId = "", basis = "", itemId = "", reason = "" } = draft ?? {};
  const update = (patch: Partial<ReturnDecisionDraft>) => onDraft({ ruleId, basis: basis || JSON.stringify({ record, rules }), itemId, reason, ...patch });
  const [busy, setBusy] = useState(false);
  const attempts = useRef(new Map<string, string>());
  const rules = removalChoices(state, record.equipment, "warehouse");
  const selected = rules.find(r => r.id === ruleId);
  const stale = !!basis && basis !== JSON.stringify({ record, rules });
  const run = async (action: "returnAccept" | "returnDecide" | CustodyAction, data: Record<string, unknown>) => {
    if (busy) return false;
    const fp = JSON.stringify({ action, data }), id = attempts.current.get(fp) ?? crypto.randomUUID();
    attempts.current.set(fp, id); setBusy(true);
    try { await post(action, data, id); attempts.current.delete(fp); onDraft(null); return true; }
    catch (e) { toast({ title: "Equipment action not saved", description: e instanceof Error ? e.message : "Retry after reconnecting.", variant: "destructive" }); return false; }
    finally { setBusy(false); }
  };
  const style = "h-10 w-full rounded-md border bg-background px-3 text-sm";
  return <div className="w-full space-y-2 sm:max-w-md">
    {canDecide && <RemovedEquipmentCustodyActions record={record} busy={busy} run={run} />}
    {!!record.history?.length && <details className="text-xs"><summary className="cursor-pointer">Custody & decision history</summary><ul className="space-y-1 py-2">{record.history.map(h => <li key={h.operationId} className="break-words">{removalHistoryLabel(state, record, h)} · {h.reason} · <time dateTime={h.occurredAt}>{inventoryDateTime(h.occurredAt, timezone)}</time> · {actorLabel(h.actor)}</li>)}</ul></details>}
    {record.disposition === "returned" && record.status === "pending" && canReceive && <Button type="button" size="sm" disabled={busy} onClick={() => void run("returnAccept", { id: record.id })}>Accept into quarantine</Button>}
    {record.status === "quarantine" && canDecide && <fieldset disabled={busy} className="space-y-2">
      {stale && <div role="alert" className="text-sm text-destructive">Return or rules changed. Your input is retained.<Button type="button" variant="outline" size="sm" onClick={() => { if (window.confirm("Review the current return/rules and keep your inspection note?")) update({ basis: JSON.stringify({ record, rules }), ruleId: "" }); }}>Review current rules</Button></div>}
      <div><Label htmlFor={`return-rule-${record.id}`}>Warehouse decision</Label><select id={`return-rule-${record.id}`} className={style} value={ruleId} onChange={e => update({ ruleId: e.target.value })}><option value="">Select approved warehouse decision</option>{rules.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
      {!rules.length && <p className="text-sm text-destructive">No approved warehouse dispositions. Ask an administrator to configure removal rules.</p>}
      {selected?.outcome === "released" && <div><Label htmlFor={`return-item-${record.id}`}>Matching equipment item</Label><select id={`return-item-${record.id}`} className={style} value={itemId} onChange={e => update({ itemId: e.target.value })}><option value="">Select item for stock</option>{state.items.filter(i => i.active && i.equipment === record.equipment && !i.components.length).map(i => <option key={i.id} value={i.id}>{i.sku} · {i.name}</option>)}</select></div>}
      <div><Label htmlFor={`return-reason-${record.id}`}>Inspection reason</Label><Input id={`return-reason-${record.id}`} value={reason} onChange={e => update({ reason: e.target.value })} maxLength={1000} /></div>
      <Button type="button" size="sm" disabled={busy || stale || !selected || !reason.trim() || selected.outcome === "released" && !itemId} onClick={() => {
        if (selected && window.confirm(`Record "${selected.name}" for ${record.serial}?`)) void run("returnDecide", { id: record.id, ruleId: selected.id, ruleRevision: selected.revision, reason, ...(selected.outcome === "released" ? { itemId } : {}) });
      }}>Record warehouse decision</Button>
    </fieldset>}
  </div>;
}
