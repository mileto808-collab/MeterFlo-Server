import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { InventoryItem, WorkRequirements } from "@shared/inventory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, Plus, Save, Trash2 } from "lucide-react";

export type WorkOrderPlanLine = {
  id: string;
  itemId: string;
  quantity: number;
  kind: "addition" | "override";
  reason: string;
};

export type WorkOrderPlan = {
  workOrderId: number;
  revision: number;
  updatedBy?: string;
  updatedAt?: string;
  lines: WorkOrderPlanLine[];
};

type Props = {
  projectId: string | number;
  workOrderId: number;
  items: InventoryItem[];
  requirements?: WorkRequirements & {
    automaticLines?: Array<{ itemId: string; quantity: number }>;
    manualLines?: WorkOrderPlanLine[];
    planRevision?: number;
  };
  plan?: WorkOrderPlan;
  canPlan: boolean;
  canOverridePlan?: boolean;
  timezone?: string;
};

const newLineId = () => crypto.randomUUID();

export function WorkOrderPlanEditor({ projectId, workOrderId, items, requirements, plan, canPlan, canOverridePlan = false, timezone = "UTC" }: Props) {
  const { toast } = useToast();
  const queryKey = ["/api/projects", projectId, "work-orders", workOrderId, "inventory"];
  const canEditOverride = canPlan && canOverridePlan;
  const currentPlan = plan ?? { workOrderId, revision: requirements?.planRevision ?? 0, lines: requirements?.manualLines ?? [] };
  const [draft, setDraft] = useState<WorkOrderPlanLine[]>(currentPlan.lines);
  const [itemId, setItemId] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [overrideItem, setOverrideItem] = useState("");
  const [overrideQuantity, setOverrideQuantity] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [baseRevision, setBaseRevision] = useState(currentPlan.revision);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const initializedFor = useRef<number | null>(null);
  const baseLines = useRef<WorkOrderPlanLine[]>(currentPlan.lines);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseLines.current), [draft]);
  const canEditPlan = canPlan;
  const changedElsewhere = revisionConflict || (dirty && currentPlan.revision !== baseRevision);
  const automaticLines = requirements?.automaticLines ?? requirements?.lines ?? [];
  const activeItems = useMemo(() => items.filter(item => item.active && item.kind !== "labor"), [items]);
  const matchingItems = useMemo(() => activeItems.filter(item =>
    `${item.sku} ${item.name}`.toLowerCase().includes(itemSearch.trim().toLowerCase())),
  [activeItems, itemSearch]);
  const itemById = (id: string) => items.find(item => item.id === id);
  const validDraft = draft.every(line => line.kind === "addition"
    ? Number.isInteger(line.quantity) && line.quantity >= 1
    : Number.isInteger(line.quantity) && line.quantity >= 0 && line.reason.trim().length >= 10);
  const effective = useMemo(() => {
    const totals = new Map<string, number>();
    automaticLines.forEach(line => totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + line.quantity));
    draft.filter(line => line.kind === "override").forEach(line => totals.set(line.itemId, line.quantity));
    draft.filter(line => line.kind === "addition").forEach(line => totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + line.quantity));
    return [...totals].filter(([, total]) => total > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
  }, [automaticLines, draft]);

  useEffect(() => {
    if (!dirty) return;
    const protectUnsavedPlan = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectUnsavedPlan);
    return () => window.removeEventListener("beforeunload", protectUnsavedPlan);
  }, [dirty]);

  useEffect(() => {
    if (initializedFor.current !== workOrderId) {
      initializedFor.current = workOrderId;
      setDraft(currentPlan.lines);
      setBaseRevision(currentPlan.revision);
      baseLines.current = currentPlan.lines;
      setRevisionConflict(false);
    } else if (!dirty && currentPlan.revision !== baseRevision) {
      setDraft(currentPlan.lines);
      setBaseRevision(currentPlan.revision);
      baseLines.current = currentPlan.lines;
      setRevisionConflict(false);
    }
  }, [workOrderId, currentPlan.revision, currentPlan.lines, dirty, baseRevision]);

  const saveMutation = useMutation({
    mutationFn: async (payload: { revision: number; lines: WorkOrderPlanLine[] }) => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/inventory/commands`, {
        operationId: crypto.randomUUID(),
        action: "plan",
        data: { workOrderId, revision: payload.revision, lines: payload.lines },
      });
      return response.json();
    },
    onSuccess: async (result, variables) => {
      setBaseRevision(result?.plan?.revision ?? result?.revision ?? baseRevision + 1);
      baseLines.current = variables.lines;
      setRevisionConflict(false);
      await queryClient.invalidateQueries({ queryKey });
      toast({ title: "Plan saved", description: "Planned quantities are not a stock reservation." });
    },
    onError: (error: Error) => {
      if (/conflict|revision|409/i.test(error.message)) setRevisionConflict(true);
      toast({ title: "Could not save plan", description: error.message, variant: "destructive" });
    },
  });

  const addAddition = () => {
    const qty = Number(quantity);
    if (!itemId || !Number.isInteger(qty) || qty < 1) return;
    setDraft(lines => [...lines, { id: newLineId(), itemId, quantity: qty, kind: "addition", reason: "" }]);
    setItemId("");
    setItemSearch("");
    setQuantity("1");
  };
  const addOverride = () => {
    const qty = Number(overrideQuantity);
    if (!overrideItem || !Number.isInteger(qty) || qty < 0 || overrideReason.trim().length < 10) return;
    setDraft(lines => [
      ...lines.filter(line => !(line.kind === "override" && line.itemId === overrideItem)),
      { id: newLineId(), itemId: overrideItem, quantity: qty, kind: "override", reason: overrideReason.trim() },
    ]);
    setOverrideItem("");
    setOverrideQuantity("");
    setOverrideReason("");
  };
  const save = async () => {
    if (!canEditPlan || saveMutation.isPending || changedElsewhere) return;
    try {
      const response = await queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          const result = await apiRequest("GET", `/api/projects/${projectId}/work-orders/${workOrderId}/inventory`);
          return result.json();
        },
        staleTime: 0,
      });
      const revision = response?.plan?.revision ?? response?.requirements?.planRevision ?? 0;
      if (revision !== baseRevision) {
        setRevisionConflict(true);
        toast({ title: "Plan changed elsewhere", description: "Your edits remain here. Review the current plan before saving.", variant: "destructive" });
        return;
      }
    } catch {
      toast({ title: "Could not recheck plan", description: "Your staged plan remains on this screen. Retry when inventory is available.", variant: "destructive" });
      return;
    }
    saveMutation.mutate({ revision: baseRevision, lines: draft });
  };
  const discardDraft = () => {
    setDraft(currentPlan.lines);
    setBaseRevision(currentPlan.revision);
    baseLines.current = currentPlan.lines;
    setRevisionConflict(false);
  };

  return <section aria-label="Work-order inventory plan" className="space-y-4 rounded-lg border border-border/80 bg-card/70 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">Planned items</h3>
          <Badge variant="outline">Revision {currentPlan.revision}</Badge>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Plan what the job is expected to need. Planning does not reserve, transfer, deduct, or prove installation of stock.</p>
      </div>
      {currentPlan.updatedAt && <span className="text-xs text-muted-foreground">Updated {new Date(currentPlan.updatedAt).toLocaleString(undefined, { timeZone: timezone })}</span>}
    </div>

    {changedElsewhere && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />The plan revision changed elsewhere. Your staged edits are preserved and saving is paused.</span>
      <Button type="button" variant="outline" size="sm" onClick={discardDraft}>Discard staged plan</Button>
    </div>}

    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">Automatic requirements</h4>
          <span className="text-xs text-muted-foreground">From assigned equipment</span>
        </div>
        {automaticLines.length ? <ul className="divide-y rounded-md border">
          {automaticLines.map((line, index) => {
            const item = itemById(line.itemId);
            return <li key={`${line.itemId}-${index}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0 break-words">{item?.name ?? line.itemId}{item?.sku ? <span className="ml-2 font-mono text-xs text-muted-foreground">{item.sku}</span> : null}</span>
              <span className="shrink-0 tabular-nums">{line.quantity} {item?.unit ?? "units"}</span>
            </li>;
          })}
        </ul> : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No automatic equipment requirements are mapped.</p>}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-medium">Effective plan</h4>
          <span className="text-xs text-muted-foreground">Automatic + additions, adjusted by overrides</span>
        </div>
        {effective.length ? <ul className="divide-y rounded-md border">
          {effective.map((line, index) => {
            const item = itemById(line.itemId);
            const override = draft.find(entry => entry.kind === "override" && entry.itemId === line.itemId);
            const automaticQty = automaticLines.filter(entry => entry.itemId === line.itemId).reduce((sum, entry) => sum + entry.quantity, 0);
            const additions = draft.filter(entry => entry.kind === "addition" && entry.itemId === line.itemId)
              .reduce((sum, entry) => sum + entry.quantity, 0);
            return <li key={`${line.itemId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <span className="min-w-0 break-words">{item?.name ?? line.itemId}{item?.sku ? <span className="ml-2 font-mono text-xs text-muted-foreground">{item.sku}</span> : null}
                <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                  {override ? <Badge variant="secondary">Override</Badge> : automaticQty > 0 ? <Badge variant="outline">Automatic</Badge> : <Badge variant="outline">Manual only</Badge>}
                  {additions > 0 && <Badge variant="outline">Manual +{additions}</Badge>}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{line.quantity} {item?.unit ?? "units"}</span>
            </li>;
          })}
          {draft.filter(line => line.kind === "addition" && !effective.some(total => total.itemId === line.itemId)).map(line => {
            const item = itemById(line.itemId);
            return <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0 break-words">{item?.name ?? line.itemId} <Badge className="ml-2" variant="outline">Manual</Badge></span>
              <span className="shrink-0 tabular-nums">{line.quantity} {item?.unit ?? "units"}</span>
            </li>;
          })}
        </ul> : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No effective planned items.</p>}
      </div>
    </div>

    {canPlan && <div className="space-y-2 border-t pt-4">
      <h4 className="text-sm font-medium">Manual additions</h4>
      <p className="text-xs text-muted-foreground">Supplemental additions remain planned after stock is staged or handed off. They do not change the original picked batch.</p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto] sm:items-end">
        <div className="space-y-1"><Label htmlFor={`plan-item-${workOrderId}`}>Item</Label>
          <Input value={itemSearch} onChange={event => setItemSearch(event.target.value)} placeholder="Search active items" aria-label="Search active inventory items" />
          <Select value={itemId} onValueChange={setItemId}><SelectTrigger id={`plan-item-${workOrderId}`}><SelectValue placeholder="Choose an item" /></SelectTrigger>
            <SelectContent>{matchingItems.map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent>
          </Select>
          {!matchingItems.length && <p className="text-xs text-muted-foreground">No active items match that search.</p>}
        </div>
        <div className="space-y-1"><Label htmlFor={`plan-qty-${workOrderId}`}>Quantity</Label><Input id={`plan-qty-${workOrderId}`} type="number" min="1" step="1" value={quantity} onChange={event => setQuantity(event.target.value)} /></div>
        <Button type="button" variant="outline" onClick={addAddition} disabled={!itemId || !Number.isInteger(Number(quantity)) || Number(quantity) < 1}><Plus className="mr-1 h-4 w-4" />Add planned item</Button>
      </div>
    </div>}

    {canEditOverride && !!automaticLines.length && <div className="space-y-2 border-t pt-4">
      <h4 className="text-sm font-medium">Override an automatic quantity</h4>
      <p className="text-xs text-muted-foreground">Overrides replace the derived quantity for one item. Zero is allowed; explain the reason in at least 10 characters.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1"><Label htmlFor={`override-item-${workOrderId}`}>Derived item</Label>
          <Select value={overrideItem} onValueChange={setOverrideItem}><SelectTrigger id={`override-item-${workOrderId}`}><SelectValue placeholder="Select automatic item" /></SelectTrigger>
            <SelectContent>{automaticLines.filter((line, index, list) => list.findIndex(other => other.itemId === line.itemId) === index).map(line => <SelectItem key={line.itemId} value={line.itemId}>{itemById(line.itemId)?.name ?? line.itemId}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1"><Label htmlFor={`override-qty-${workOrderId}`}>Replacement quantity</Label><Input id={`override-qty-${workOrderId}`} type="number" min="0" step="1" value={overrideQuantity} onChange={event => setOverrideQuantity(event.target.value)} placeholder="0 or more" /></div>
      </div>
      <div className="space-y-1"><Label htmlFor={`override-reason-${workOrderId}`}>Reason</Label><Input id={`override-reason-${workOrderId}`} value={overrideReason} onChange={event => setOverrideReason(event.target.value)} maxLength={500} placeholder="Why should this automatic requirement change?" /></div>
      <Button type="button" variant="outline" onClick={addOverride} disabled={!overrideItem || !Number.isInteger(Number(overrideQuantity)) || Number(overrideQuantity) < 0 || overrideReason.trim().length < 10}><Plus className="mr-1 h-4 w-4" />Apply override</Button>
    </div>}

    {!!draft.length && <div className="space-y-2 border-t pt-4">
      <h4 className="text-sm font-medium">Plan contributions</h4>
      <ul className="space-y-2">{draft.map(line => {
        const item = itemById(line.itemId);
        return <li key={line.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border px-3 py-2.5 text-sm">
          <div className="min-w-0"><div className="break-words font-medium">{item?.name ?? line.itemId} <Badge variant={line.kind === "override" ? "secondary" : "outline"}>{line.kind === "override" ? "Override" : "Manual addition"}</Badge></div>
            {line.kind === "override" && <p className="mt-1 text-xs text-muted-foreground">Replaces automatic quantity · {line.reason}</p>}
            <div className="mt-2 flex items-center gap-2"><Label className="text-xs" htmlFor={`plan-line-qty-${line.id}`}>Quantity</Label>
              {line.kind === "addition" && canPlan || line.kind === "override" && canEditOverride
                ? <Input className="h-8 w-24" id={`plan-line-qty-${line.id}`} type="number" min={line.kind === "override" ? "0" : "1"} step="1" value={line.quantity} onChange={event => {
                    const next = Number(event.target.value);
                    setDraft(lines => lines.map(entry => entry.id === line.id ? { ...entry, quantity: Number.isFinite(next) ? next : 0 } : entry));
                  }} />
                : <span className="tabular-nums">{line.quantity}</span>}
              <span className="text-xs text-muted-foreground">{item?.unit ?? "units"}</span>
            </div>
            {line.kind === "override" && canEditOverride && <div className="mt-2 space-y-1">
              <Label className="text-xs" htmlFor={`plan-line-reason-${line.id}`}>Reason</Label>
              <Input id={`plan-line-reason-${line.id}`} value={line.reason} maxLength={500} onChange={event =>
                setDraft(lines => lines.map(entry => entry.id === line.id ? { ...entry, reason: event.target.value } : entry))} />
            </div>}
          </div>
          {line.kind === "addition" && canPlan || line.kind === "override" && canEditOverride
            ? <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${item?.name ?? "planned"} line`} onClick={() => setDraft(lines => lines.filter(entry => entry.id !== line.id))}><Trash2 className="h-4 w-4" /></Button>
            : null}
        </li>;
      })}</ul>
    </div>}

    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="max-w-2xl text-xs text-muted-foreground">Reservations hold stock separately. Transfers move stock between locations. Actual consumption is recorded only after installation review with real serialized identities where required.</p>
      {canEditPlan && <Button type="button" onClick={save} disabled={!dirty || !validDraft || saveMutation.isPending || changedElsewhere}>
        {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save plan
      </Button>}
    </div>
    {!canEditPlan && <p className="text-xs text-muted-foreground">This plan is read-only for your access level or the current work-order status.</p>}
  </section>;
}
