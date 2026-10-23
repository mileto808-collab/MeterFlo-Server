import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { Allocation, InventoryItem, StockLine, Warehouse } from "@shared/inventory";
import { inventoryDateTime } from "@shared/inventory-date-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SerialScanField } from "./serial-scan-field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Loader2, MoveRight, Printer, Trash2 } from "lucide-react";

type StageLine = { key: string; itemId: string; quantity: number; serials: string[] };
type StagingReceipt = {
  id: string;
  reason: string;
  occurredAt: string;
  warehouseId: string;
  lines: StockLine[];
  actor: string;
};
type Snapshot = { allocation?: { revision: number } | null; stagingReceipts?: StagingReceipt[] };
type PendingStageCommand = {
  operationId: string;
  data: {
    workOrderId: number;
    revision: number;
    sourceId: string;
    destinationId: string;
    lines: StockLine[];
    reason: string;
    physicallyConfirmed: true;
  };
};

type Props = {
  projectId: string | number;
  workOrderId: number;
  items: InventoryItem[];
  warehouses: Warehouse[];
  allocation: Allocation[] | undefined;
  allocationRevision: number;
  receipts: StagingReceipt[];
  timezone: string;
  canStage: boolean;
};

export function WorkOrderStagingPanel({
  projectId, workOrderId, items, warehouses, allocation, allocationRevision, receipts, timezone, canStage,
}: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryKey = ["/api/projects", projectId, "work-orders", workOrderId, "inventory"];
  const pendingStorageKey = user?.id
    ? `meterflo:work-order-stage:${encodeURIComponent(String(user.id))}:${encodeURIComponent(String(projectId))}:${workOrderId}`
    : null;
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [serialText, setSerialText] = useState("");
  const [lines, setLines] = useState<StageLine[]>([]);
  const [reason, setReason] = useState("");
  const [physicalConfirmed, setPhysicalConfirmed] = useState(false);
  const [touched, setTouched] = useState(false);
  const [baseRevision, setBaseRevision] = useState(allocationRevision);
  const [revisionConflict, setRevisionConflict] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<PendingStageCommand | null>(null);
  const [pendingLoadedFor, setPendingLoadedFor] = useState<string | null>(null);
  const [pendingUnknown, setPendingUnknown] = useState(false);
  const activeItems = useMemo(() => items.filter(item => item.active && item.kind !== "labor"), [items]);
  const selectedItem = activeItems.find(item => item.id === itemId);
  const serials = serialText.split(/[\n,;]/).map(value => value.trim()).filter(Boolean);
  const changedElsewhere = revisionConflict || (touched && baseRevision !== allocationRevision);
  const pendingReady = !!pendingStorageKey && pendingLoadedFor === pendingStorageKey;

  const beginEdit = () => {
    if (!touched) setBaseRevision(allocationRevision);
    setTouched(true);
  };
  const resetDraft = () => {
    setSourceId("");
    setDestinationId("");
    setItemId("");
    setQuantity("1");
    setSerialText("");
    setLines([]);
    setReason("");
    setPhysicalConfirmed(false);
    setTouched(false);
    setBaseRevision(allocationRevision);
    setRevisionConflict(false);
  };
  const clearPending = () => {
    if (pendingStorageKey) {
      try { window.sessionStorage.removeItem(pendingStorageKey); } catch { /* State is still cleared in this view. */ }
    }
    setPendingCommand(null);
    setPendingUnknown(false);
  };
  const restoreCommandDraft = (command: PendingStageCommand) => {
    setSourceId(command.data.sourceId);
    setDestinationId(command.data.destinationId);
    setLines(command.data.lines.map((line, index) => ({
      key: `${command.operationId}-${index}`,
      itemId: line.itemId,
      quantity: line.quantity,
      serials: [...line.serials],
    })));
    setReason(command.data.reason);
    setPhysicalConfirmed(command.data.physicallyConfirmed);
    setBaseRevision(command.data.revision);
    setTouched(true);
  };

  const stageMutation = useMutation({
    mutationFn: async (command: PendingStageCommand) => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/inventory/commands`, {
        operationId: command.operationId,
        action: "stageWorkOrder",
        data: command.data,
      });
      return response.json();
    },
    onSuccess: async () => {
      clearPending();
      resetDraft();
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/inventory`] });
      toast({ title: "Stock staged", description: "The physical move was recorded. Staged stock is not actual use or installed equipment." });
    },
    onError: (error: Error) => {
      const status = Number(error.message.match(/^\s*(\d{3}):/)?.[1] ?? 0);
      if (status >= 400 && status < 500) {
        clearPending();
        setRevisionConflict(status === 409);
        toast({ title: "Move was rejected", description: `${error.message} The draft is retained and can be corrected.`, variant: "destructive" });
      } else {
        setPendingUnknown(true);
        toast({ title: "Move outcome is unknown", description: "The exact command is saved. Check the receipt or retry this same command; do not start a second move.", variant: "destructive" });
      }
    },
  });
  const formLocked = !!pendingCommand || !pendingReady || stageMutation.isPending;

  useEffect(() => {
    if (!pendingStorageKey) {
      setPendingLoadedFor(null);
      setPendingCommand(null);
      setPendingUnknown(false);
      return;
    }
    setPendingLoadedFor(null);
    let restored: PendingStageCommand | null = null;
    try {
      const text = window.sessionStorage.getItem(pendingStorageKey);
      if (text) {
        const candidate = JSON.parse(text) as PendingStageCommand;
        if (candidate.operationId && candidate.data?.workOrderId === workOrderId &&
          candidate.data.physicallyConfirmed === true && Array.isArray(candidate.data.lines)) restored = candidate;
        else window.sessionStorage.removeItem(pendingStorageKey);
      }
    } catch {
      try { window.sessionStorage.removeItem(pendingStorageKey); } catch { /* Storage can be unavailable in restricted browsers. */ }
    }
    setPendingCommand(restored);
    setPendingUnknown(!!restored);
    if (restored) restoreCommandDraft(restored);
    else resetDraft();
    setPendingLoadedFor(pendingStorageKey);
  }, [pendingStorageKey, workOrderId]);

  useEffect(() => {
    if (!pendingCommand || pendingLoadedFor !== pendingStorageKey || !receipts.some(receipt => receipt.id === pendingCommand.operationId)) return;
    clearPending();
    resetDraft();
    toast({ title: "Move already recorded", description: "The staging receipt confirms this physical move; no second command was sent." });
  }, [pendingCommand, pendingLoadedFor, pendingStorageKey, receipts]);

  const addLine = () => {
    const amount = Number(quantity);
    if (formLocked || !selectedItem || !Number.isInteger(amount) || amount < 1) return;
    if (selectedItem.tracking === "serialized" && (serials.length !== amount || new Set(serials).size !== serials.length)) {
      toast({ title: "Scan each custody serial", description: `Enter ${amount} unique serial${amount === 1 ? "" : "s"} physically moved to staging.`, variant: "destructive" });
      return;
    }
    const previousSerials = lines.flatMap(line => line.serials);
    if (serials.some(serial => previousSerials.includes(serial))) {
      toast({ title: "Serial already staged", description: "Each serialized unit can appear only once in this move.", variant: "destructive" });
      return;
    }
    beginEdit();
    setLines(current => [...current, {
      key: crypto.randomUUID(), itemId: selectedItem.id, quantity: amount,
      serials: selectedItem.tracking === "serialized" ? serials : [],
    }]);
    setItemId("");
    setQuantity("1");
    setSerialText("");
  };

  const retryPendingCommand = async () => {
    if (!canStage || !pendingCommand || !pendingReady || stageMutation.isPending) return;
    try {
      const latest = await queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          const response = await apiRequest("GET", `/api/projects/${projectId}/work-orders/${workOrderId}/inventory`);
          return response.json();
        },
        staleTime: 0,
      }) as Snapshot;
      if (latest.stagingReceipts?.some(receipt => receipt.id === pendingCommand.operationId)) {
        clearPending();
        resetDraft();
        await queryClient.invalidateQueries({ queryKey });
        await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/inventory`] });
        toast({ title: "Move already recorded", description: "The matching receipt confirms the original move; no duplicate was sent." });
        return;
      }
    } catch {
      // The idempotent backend replay below is safer than a new command when outcome lookup is unavailable.
    }
    setPendingUnknown(false);
    stageMutation.mutate(pendingCommand);
  };

  const submit = async () => {
    if (!canStage || !pendingReady || stageMutation.isPending) return;
    if (pendingCommand) {
      await retryPendingCommand();
      return;
    }
    if (changedElsewhere || !sourceId || !destinationId || sourceId === destinationId ||
      !lines.length || reason.trim().length < 10 || !physicalConfirmed) return;
    let latest: Snapshot;
    try {
      latest = await queryClient.fetchQuery({
        queryKey,
        queryFn: async () => {
          const response = await apiRequest("GET", `/api/projects/${projectId}/work-orders/${workOrderId}/inventory`);
          return response.json();
        },
        staleTime: 0,
      });
    } catch {
      toast({ title: "Could not recheck work order", description: "Your staging lines remain here. Retry when inventory is available.", variant: "destructive" });
      return;
    }
    const latestRevision = latest.allocation?.revision ?? 0;
    if (latestRevision !== baseRevision) {
      setRevisionConflict(true);
      toast({ title: "Reservation changed elsewhere", description: "Your staging draft is preserved. Review the current reservation before retrying.", variant: "destructive" });
      return;
    }
    const command: PendingStageCommand = {
      operationId: crypto.randomUUID(),
      data: {
        workOrderId, revision: latestRevision, sourceId, destinationId,
        lines: lines.map(({ itemId: id, quantity: qty, serials: ids }) => ({ itemId: id, quantity: qty, serials: ids })),
        reason: reason.trim(), physicallyConfirmed: true,
      },
    };
    try {
      if (!pendingStorageKey) throw new Error("A signed-in user is required to safely stage stock.");
      window.sessionStorage.setItem(pendingStorageKey, JSON.stringify(command));
    } catch (error) {
      toast({ title: "Cannot safely stage yet", description: error instanceof Error
        ? `${error.message} Staging was not sent because its retry identity could not be saved.`
        : "Staging was not sent because its retry identity could not be saved.", variant: "destructive" });
      return;
    }
    setPendingCommand(command);
    setPendingUnknown(false);
    stageMutation.mutate(command);
  };

  const printReceipt = (id: string) => {
    const base = `/api/projects/${projectId}/inventory`;
    window.open(`${base}/print/receipt/${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
  };
  const warehouseName = (id: string) => {
    const warehouse = warehouses.find(value => value.id === id);
    return warehouse ? `${warehouse.code} · ${warehouse.name}` : id;
  };
  const receiptDate = (value: string) => inventoryDateTime(value, timezone || "UTC");

  return <section aria-label="Manual stock staging" className="space-y-4 rounded-lg border border-border/80 bg-card/60 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">Manual stage / move stock</h3><Badge variant="outline">Physical move</Badge></div>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Use this only after stock has physically moved from its source into a staging location or installer vehicle. It creates destination quantity holds and a printable receipt; it does not record installation or consumption.</p>
      </div>
    </div>

    {!!receipts.length && <div className="space-y-2">
      <h4 className="text-sm font-medium">Staging receipts for this work order</h4>
      <ul className="space-y-2">{receipts.map(receipt => <li key={receipt.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border p-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs">{receipt.id}</span><Badge variant="secondary">Staged at {warehouseName(receipt.warehouseId)}</Badge></div>
          <p className="text-xs text-muted-foreground">{receiptDate(receipt.occurredAt)} · {receipt.actor}</p>
          <p className="text-sm">{receipt.reason}</p>
          <ul className="text-xs text-muted-foreground">{receipt.lines.map((line, index) => {
            const item = items.find(value => value.id === line.itemId);
            return <li key={`${line.itemId}-${index}`}>{item?.name ?? line.itemId} · {line.quantity} {item?.unit ?? "units"}{line.serials.length ? ` · custody serials ${line.serials.join(", ")}` : ""}</li>;
          })}</ul>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => printReceipt(receipt.id)}><Printer className="mr-2 h-4 w-4" />Print receipt</Button>
      </li>)}</ul>
    </div>}

    {canStage ? <div className="space-y-4 border-t pt-4">
      {!pendingReady && <p role="status" className="rounded-md border p-3 text-sm text-muted-foreground">Preparing this user-scoped staging session. Staging stays disabled until its retry state is checked.</p>}
      {pendingCommand && <div role="alert" className="space-y-2 rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm">
        <p className="font-medium">{stageMutation.isPending ? "Submitting the saved physical move" : pendingUnknown ? "Move outcome is unknown" : "A physical move is awaiting confirmation"}</p>
        <p className="text-muted-foreground">The form is locked. “Check outcome / retry same move” first checks this work order’s receipts, then replays the exact saved command and operation ID if needed. It will never create a fresh movement ID for this pending move.</p>
        <p className="break-all font-mono text-xs">Operation {pendingCommand.operationId} · {warehouseName(pendingCommand.data.sourceId)} → {warehouseName(pendingCommand.data.destinationId)}</p>
        <ul className="text-xs text-muted-foreground">{pendingCommand.data.lines.map((line, index) => {
          const item = items.find(value => value.id === line.itemId);
          return <li key={`${line.itemId}-${index}`}>{item?.name ?? line.itemId} · {line.quantity}{line.serials.length ? ` · custody serials ${line.serials.join(", ")}` : ""}</li>;
        })}</ul>
      </div>}
      {changedElsewhere && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />This work order's reservation revision changed. Your staging draft is retained; recheck or discard before posting.</span>
        <Button type="button" size="sm" variant="outline" disabled={!!pendingCommand || stageMutation.isPending} onClick={resetDraft}>Discard staging draft</Button>
      </div>}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1"><Label htmlFor={`stage-source-${workOrderId}`}>Source location</Label>
          <Select value={sourceId} onValueChange={value => { beginEdit(); setSourceId(value); }} disabled={formLocked}><SelectTrigger id={`stage-source-${workOrderId}`}><SelectValue placeholder="Choose accessible source" /></SelectTrigger><SelectContent>
            {warehouses.filter(warehouse => warehouse.active).map(warehouse => <SelectItem key={warehouse.id} value={warehouse.id} disabled={warehouse.id === destinationId}>{warehouse.code} · {warehouse.name}</SelectItem>)}
          </SelectContent></Select>
        </div>
        <div className="space-y-1"><Label htmlFor={`stage-destination-${workOrderId}`}>Destination staging location / vehicle</Label>
          <Select value={destinationId} onValueChange={value => { beginEdit(); setDestinationId(value); }} disabled={formLocked}><SelectTrigger id={`stage-destination-${workOrderId}`}><SelectValue placeholder="Choose accessible destination" /></SelectTrigger><SelectContent>
            {warehouses.filter(warehouse => warehouse.active).map(warehouse => <SelectItem key={warehouse.id} value={warehouse.id} disabled={warehouse.id === sourceId}>{warehouse.code} · {warehouse.name}</SelectItem>)}
          </SelectContent></Select>
        </div>
      </div>

      <div className="space-y-2 rounded-md border border-dashed p-3">
        <h4 className="text-sm font-medium">Stock physically moved</h4>
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto] sm:items-end">
          <div className="space-y-1"><Label htmlFor={`stage-item-${workOrderId}`}>Item</Label>
            <Select value={itemId} onValueChange={value => {
              if (serialText.trim() && itemId && value !== itemId && !window.confirm("Change the item and clear custody serials captured for the previous item?")) return;
              beginEdit(); setItemId(value); if (itemId && value !== itemId) setSerialText("");
            }} disabled={formLocked}><SelectTrigger id={`stage-item-${workOrderId}`}><SelectValue placeholder="Choose inventory item" /></SelectTrigger><SelectContent>
              {activeItems.map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}
            </SelectContent></Select>
          </div>
          <div className="space-y-1"><Label htmlFor={`stage-qty-${workOrderId}`}>Quantity</Label><Input id={`stage-qty-${workOrderId}`} type="number" min="1" step="1" value={quantity} disabled={formLocked} onChange={event => { beginEdit(); setQuantity(event.target.value); }} /></div>
          <Button type="button" variant="outline" onClick={addLine} disabled={formLocked || !selectedItem || !Number.isInteger(Number(quantity)) || Number(quantity) < 1}><MoveRight className="mr-2 h-4 w-4" />Add moved line</Button>
        </div>
        {selectedItem?.tracking === "serialized" && <div className="space-y-1">
          <Label htmlFor={`stage-serials-${workOrderId}`}>Serials in physical custody transfer</Label>
          <SerialScanField id={`stage-serials-${workOrderId}`} expected={quantity} blockedSerials={lines.flatMap(line => line.serials)} value={serialText} disabled={formLocked} onChange={value => { beginEdit(); setSerialText(value); }} placeholder="Scan one serial per unit" />
          <p className="text-xs text-muted-foreground">These scans record custody during the move; they do not assign installed-meter identity to the work order.</p>
        </div>}
        {!!lines.length && <ul className="space-y-2">{lines.map(line => {
          const item = items.find(value => value.id === line.itemId);
          return <li key={line.key} className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-background/60 px-3 py-2">
            <span className="min-w-0 text-sm">{item?.name ?? line.itemId} · {line.quantity} {item?.unit ?? "units"}{line.serials.length ? <span className="block break-all text-xs text-muted-foreground">Custody serials: {line.serials.join(", ")}</span> : null}</span>
            <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${item?.name ?? "staging"} line`} disabled={formLocked} onClick={() => setLines(current => current.filter(entry => entry.key !== line.key))}><Trash2 className="h-4 w-4" /></Button>
          </li>;
        })}</ul>}
      </div>

      <div className="space-y-1"><Label htmlFor={`stage-reason-${workOrderId}`}>Move reason</Label>
        <Input id={`stage-reason-${workOrderId}`} value={reason} maxLength={500} disabled={formLocked} onChange={event => { beginEdit(); setReason(event.target.value); }} placeholder="Explain why this physical move is needed" />
        <p className="text-xs text-muted-foreground">Enter at least 10 characters. Inventory is held at the destination after this physical move.</p>
      </div>
      <label className="flex items-start gap-2 rounded-md border bg-muted/20 p-3 text-sm">
        <Checkbox checked={physicalConfirmed} disabled={formLocked} onCheckedChange={checked => { beginEdit(); setPhysicalConfirmed(checked === true); }} />
        <span><span className="font-medium">I confirm the stock has physically moved</span><span className="mt-1 block text-xs text-muted-foreground">Posting records an atomic move and receipt. Do not confirm a planned or future move.</span></span>
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-xs text-muted-foreground">Reserve-only preparation does not move stock. Actual usage is recorded later during changeout; this action only changes custody/location.</p>
        <Button type="button" onClick={() => void submit()} disabled={!canStage || !pendingReady || stageMutation.isPending ||
          (!pendingCommand && (changedElsewhere || !sourceId || !destinationId || sourceId === destinationId || !lines.length || reason.trim().length < 10 || !physicalConfirmed))}>
          {stageMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : pendingCommand ? <AlertTriangle className="mr-2 h-4 w-4" /> : <MoveRight className="mr-2 h-4 w-4" />}
          {pendingCommand ? "Check outcome / retry same move" : "Confirm physical move"}
        </Button>
      </div>
    </div> : <p className="border-t pt-4 text-sm text-muted-foreground">Manual staging requires accessible source and destination locations plus inventory transfer, receive, and assignment permissions. Use reserve-only preparation if no physical move has occurred.</p>}

    {!!allocation?.length && <p className="text-xs text-muted-foreground">Current work-order allocation revision: {allocationRevision}. Staging uses this revision so source holds can be relocated safely.</p>}
  </section>;
}
