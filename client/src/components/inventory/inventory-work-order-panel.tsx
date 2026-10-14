import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Allocation, InventoryItem, Warehouse, WorkAllocation } from "@shared/inventory";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, PackageCheck, Plus, Trash2 } from "lucide-react";

type WorkInventorySnapshot = { enabled: boolean; allocation: WorkAllocation | null; items: InventoryItem[]; warehouses: Warehouse[] };
type DraftLine = Allocation;

export function InventoryWorkOrderPanel({ projectId, workOrderId, readingOnly = false }: {
  projectId: string | number; workOrderId: number; readingOnly?: boolean;
}) {
  const { hasPermission } = usePermissions();
  const { toast } = useToast();
  const key = ["/api/projects", projectId, "work-orders", workOrderId, "inventory"];
  const projectInventoryKey = [`/api/projects/${projectId}/inventory`];
  const { data, isLoading, isError, refetch } = useQuery<WorkInventorySnapshot>({ queryKey: key });
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [serials, setSerials] = useState("");
  const [used, setUsed] = useState<Record<string, number>>({});
  const [usedSerials, setUsedSerials] = useState<Record<string, string>>({});
  const [disposition, setDisposition] = useState<Record<string, string>>({});
  const [returnWarehouse, setReturnWarehouse] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [mode, setMode] = useState<"changeout" | "reading_only">(readingOnly ? "reading_only" : "changeout");
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [reconcileReason, setReconcileReason] = useState("");
  const [restoreUsedStock, setRestoreUsedStock] = useState(false);
  const canAssign = hasPermission("inventory.assign");

  const mutation = useMutation({
    mutationFn: async ({ action, payload }: { action: string; payload: Record<string, unknown> }) => {
      const response = await apiRequest("POST", `/api/projects/${projectId}/inventory/commands`, {
        operationId: crypto.randomUUID(), action, data: payload,
      });
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: projectInventoryKey });
      toast({ title: "Inventory updated", description: "Work-order stock has been refreshed." });
    },
    onError: (error: Error) => toast({ title: "Could not update inventory", description: error.message, variant: "destructive" }),
  });
  const items = data?.items ?? [];
  const warehouses = data?.warehouses ?? [];
  const selectedItem = items.find(item => item.id === itemId);
  const availableWarehouses = useMemo(() => warehouses.filter(warehouse => warehouse.active), [warehouses]);

  if (isLoading) return <Card><CardContent className="p-5 space-y-3"><div className="h-5 w-40 animate-pulse rounded bg-muted" /><div className="h-12 animate-pulse rounded bg-muted" /></CardContent></Card>;
  if (isError) return <Card><CardContent className="p-5"><p className="text-sm text-destructive">Inventory assignments could not load.</p><Button className="mt-3" variant="outline" onClick={() => refetch()}>Retry</Button></CardContent></Card>;
  if (!data?.enabled) return null;

  const addLine = () => {
    const qty = Number(quantity);
    const scanned = serials.split(/[\n,;]/).map(value => value.trim()).filter(Boolean);
    if (!itemId || !warehouseId || !Number.isInteger(qty) || qty < 1) return;
    if (selectedItem?.tracking === "serialized" && scanned.length !== qty) {
      toast({ title: "Scan each meter", description: `Expected ${qty} unique serial number${qty === 1 ? "" : "s"}.`, variant: "destructive" }); return;
    }
    const line = { itemId, warehouseId, quantity: qty, serials: selectedItem?.tracking === "serialized" ? scanned : [] };
    setLines(current => {
      const at = current.findIndex(existing => existing.itemId === itemId && existing.warehouseId === warehouseId);
      return at < 0 ? [...current, line] : current.map((entry, index) => index === at ? {
        ...entry, quantity: entry.quantity + qty, serials: [...entry.serials, ...line.serials],
      } : entry);
    });
    setSerials(""); setQuantity("1");
  };
  const assigned = data.allocation?.lines ?? [];
  const saveAssignment = () => {
    const next = new Map<string, Allocation>();
    assigned.filter(line => `${line.warehouseId}/${line.itemId}` !== editingKey).forEach(line => next.set(`${line.warehouseId}/${line.itemId}`, line));
    lines.forEach(line => {
      const key = `${line.warehouseId}/${line.itemId}`;
      const prior = next.get(key);
      next.set(key, prior ? { ...prior, quantity: prior.quantity + line.quantity, serials: [...prior.serials, ...line.serials] } : line);
    });
    mutation.mutate({ action: "assign", payload: { workOrderId, lines: [...next.values()] } }, {
      onSuccess: () => { setLines([]); setEditingKey(null); },
    });
  };
  const submitReview = () => {
    const allocation = data.allocation;
    if (!allocation) return;
    let invalid = false;
    const usedLines: Allocation[] = mode === "reading_only" ? [] : allocation.lines.flatMap(line => {
      const key = `${line.warehouseId}/${line.itemId}`;
      const qty = used[key] ?? line.quantity;
      if (qty <= 0) return [];
      const ids = line.serials.length ? usedSerials[key]?.split(/[\n,;]/).map(value => value.trim()).filter(Boolean) ?? [] : [];
      if (line.serials.length && (ids.length !== qty || ids.some(id => !line.serials.includes(id)))) {
        toast({ title: "Scan assigned serials", description: `Enter ${qty} serial${qty === 1 ? "" : "s"} reserved to this work order.`, variant: "destructive" });
        invalid = true;
        return [];
      }
      return [{ ...line, quantity: qty, serials: ids }];
    });
    const dispositions = mode === "reading_only" ? [] : (["system", "module"] as const).flatMap(equipment => {
      const selected = disposition[equipment];
      return selected ? [{
        equipment, serial: disposition[`${equipment}-serial`] ?? "",
        disposition: selected as "returned" | "scrapped" | "left_onsite",
        warehouseId: selected === "returned" ? returnWarehouse || null : null,
      }] : [];
    });
    if (invalid) return;
    mutation.mutate({ action: "prepareUse", payload: { workOrderId, revision: allocation.revision, mode, used: usedLines, dispositions } }, {
      onSuccess: () => setReviewing(false),
    });
  };

  return <Card className="border-l-4 border-l-primary/60">
    <CardHeader className="pb-3"><div className="flex items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-base"><PackageCheck className="h-4 w-4 text-primary" />Inventory for this visit</CardTitle>
      {data.allocation && <Badge variant={data.allocation.mode ? "default" : "outline"}>{data.allocation.status === "consumed" ? "Used reviewed" : data.allocation.mode ? "Review complete" : "Reserved"}</Badge>}</div>
      <p className="text-sm text-muted-foreground">Reserved stock stays tied to this work order; scan meter serials before saving.</p></CardHeader>
    <CardContent className="space-y-4">
      {assigned.length > 0 ? <div className="space-y-2">{assigned.map(line => {
        const item = items.find(value => value.id === line.itemId);
        const warehouse = warehouses.find(value => value.id === line.warehouseId);
        return <div key={`${line.warehouseId}/${line.itemId}`} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3">
          <div><div className="font-medium">{item?.name ?? line.itemId} <span className="font-mono text-xs text-muted-foreground">{item?.sku}</span></div>
            <div className="text-xs text-muted-foreground">{warehouse?.code ?? line.warehouseId} · {line.quantity} {item?.unit ?? "units"}{line.serials.length > 0 ? ` · ${line.serials.join(", ")}` : ""}</div></div>
          {canAssign && data.allocation?.status === "reserved" && <div className="flex gap-1"><Button aria-label={`Edit ${item?.name ?? "item"} reservation`} variant="ghost" size="sm" onClick={() => {
            setEditingKey(`${line.warehouseId}/${line.itemId}`);
            setItemId(line.itemId); setWarehouseId(line.warehouseId); setQuantity(String(line.quantity)); setSerials(line.serials.join("\n")); setLines([]);
          }}>Edit</Button><Button aria-label={`Remove ${item?.name ?? "item"} reservation`} variant="ghost" size="icon" onClick={() => {
            const remaining = assigned.filter(other => other !== line);
            mutation.mutate({ action: "assign", payload: { workOrderId, lines: remaining } });
          }}><Trash2 className="h-4 w-4" /></Button></div>}
        </div>;
      })}</div> : <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No stock is reserved for this work order.</div>}

      {canAssign && data.allocation?.status !== "consumed" && <div className="space-y-3 rounded-md bg-muted/40 p-3">
        {!data.allocation && <Button type="button" variant="outline" onClick={() => mutation.mutate({ action: "assign", payload: { workOrderId, lines: [] } })} disabled={mutation.isPending}>Create empty assignment</Button>}
        <p className="text-sm font-medium">Add reserved stock</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor={`wo-item-${workOrderId}`}>Meter / item</Label><Select value={itemId} onValueChange={setItemId}><SelectTrigger id={`wo-item-${workOrderId}`}><SelectValue placeholder="Select item" /></SelectTrigger><SelectContent>{items.filter(item => item.active).map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label htmlFor={`wo-warehouse-${workOrderId}`}>Stock location</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger id={`wo-warehouse-${workOrderId}`}><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{availableWarehouses.map(warehouse => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label htmlFor={`wo-qty-${workOrderId}`}>Quantity</Label><Input id={`wo-qty-${workOrderId}`} inputMode="numeric" type="number" min="1" value={quantity} onChange={event => setQuantity(event.target.value)} /></div>
        </div>
        {selectedItem?.tracking === "serialized" && <div className="space-y-1"><Label htmlFor={`wo-serials-${workOrderId}`}>Scan serials (one per line or comma)</Label><Input id={`wo-serials-${workOrderId}`} value={serials} onChange={event => setSerials(event.target.value)} placeholder="Scan or enter serial numbers" /></div>}
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={addLine} disabled={!itemId || !warehouseId}><Plus className="mr-1 h-4 w-4" />{editingKey ? "Stage updated line" : "Add line"}</Button>
          <Button type="button" onClick={saveAssignment} disabled={!lines.length || mutation.isPending}><PackageCheck className="mr-1 h-4 w-4" />Save reservations</Button></div>
        {lines.length > 0 && <p className="text-xs text-muted-foreground">{lines.length} line{lines.length === 1 ? "" : "s"} ready to reserve. Availability is validated by the project inventory service.</p>}
      </div>}

      {data.allocation?.status === "reserved" && <div className="border-t pt-4">
        {!reviewing ? <Button type="button" variant="outline" disabled={!canAssign} onClick={() => { setMode(readingOnly ? "reading_only" : "changeout"); setReviewing(true); }}>
          Review use & removed meter
        </Button> : <div className="space-y-4">
          <div><Label>Work type</Label><Select value={mode} disabled={readingOnly} onValueChange={value => setMode(value as "changeout" | "reading_only")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="changeout">Meter changeout</SelectItem><SelectItem value="reading_only">Reading only</SelectItem></SelectContent></Select></div>
          {mode === "reading_only" ? <p className="text-sm text-muted-foreground">Reading-only visits use no replacement stock and have no removed-meter disposition.</p> : <>
            {assigned.map(line => {
              const item = items.find(value => value.id === line.itemId);
              const key = `${line.warehouseId}/${line.itemId}`;
              return <div key={key} className="grid gap-2 sm:grid-cols-[1fr_140px] sm:items-center"><div className="text-sm">{item?.name ?? line.itemId} · {line.quantity} reserved{line.serials.length ? ` · ${line.serials.join(", ")}` : ""}</div><div className="space-y-1"><Label htmlFor={`used-${key}`}>Used quantity</Label><Input id={`used-${key}`} type="number" min="0" max={line.quantity} value={used[key] ?? line.quantity} onChange={event => setUsed(current => ({ ...current, [key]: Math.min(line.quantity, Math.max(0, Number(event.target.value) || 0)) }))} /></div></div>;
            })}
            {assigned.filter(line => line.serials.length > 0).map(line => {
              const key = `${line.warehouseId}/${line.itemId}`;
              return <div key={key} className="space-y-1"><Label htmlFor={`used-serial-${line.itemId}`}>Scan serials used · {items.find(item => item.id === line.itemId)?.name}</Label><Input id={`used-serial-${line.itemId}`} value={usedSerials[key] ?? ""} onChange={event => setUsedSerials(current => ({ ...current, [key]: event.target.value }))} placeholder="Reserved serials only" /></div>;
            })}
            {(["system", "module"] as const).map(equipment => <div key={equipment} className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor={`disp-${equipment}`}>Removed {equipment} meter serial</Label><Input id={`disp-${equipment}`} value={disposition[`${equipment}-serial`] ?? ""} onChange={event => setDisposition(current => ({ ...current, [`${equipment}-serial`]: event.target.value }))} placeholder="Scan removed serial" /></div>
              <div className="space-y-1"><Label>Condition / disposition</Label><Select value={disposition[equipment] ?? ""} onValueChange={value => setDisposition(current => ({ ...current, [equipment]: value }))}><SelectTrigger><SelectValue placeholder="Select disposition" /></SelectTrigger><SelectContent><SelectItem value="returned">Return to warehouse</SelectItem><SelectItem value="scrapped">Scrapped</SelectItem><SelectItem value="left_onsite">Left onsite</SelectItem></SelectContent></Select></div>
            </div>)}
            {Object.values(disposition).includes("returned") && <div className="space-y-1"><Label>Return warehouse</Label><Select value={returnWarehouse} onValueChange={setReturnWarehouse}><SelectTrigger><SelectValue placeholder="Choose return location" /></SelectTrigger><SelectContent>{availableWarehouses.map(warehouse => <SelectItem value={warehouse.id} key={warehouse.id}>{warehouse.code} · {warehouse.name}</SelectItem>)}</SelectContent></Select></div>}
            <p className="text-xs text-muted-foreground">Only a serial entered with a disposition is posted as removed equipment.</p>
          </>}
          <div className="flex gap-2"><Button type="button" onClick={submitReview} disabled={mutation.isPending || !canAssign}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm inventory review</Button><Button type="button" variant="ghost" onClick={() => setReviewing(false)}>Cancel</Button></div>
        </div>}
      </div>}
      {data.allocation?.status === "consumed" && hasPermission("inventory.count") && <div className="border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/40 p-3">
          <div><p className="text-sm font-medium">Inventory reconciliation</p><p className="text-xs text-muted-foreground">Use only when this completed work order is being reset, reopened, or removed.</p></div>
          <Button type="button" variant="outline" onClick={() => setReconcileOpen(true)}>Reconcile consumed stock</Button>
        </div>
      </div>}
    </CardContent>
    <Dialog open={reconcileOpen} onOpenChange={setReconcileOpen}><DialogContent><DialogHeader><DialogTitle>Reconcile work-order inventory</DialogTitle><DialogDescription>Record why the completed inventory use is being reversed. Choose whether physically used stock is actually returning.</DialogDescription></DialogHeader>
      <div className="space-y-3"><div className="space-y-1"><Label htmlFor={`reconcile-reason-${workOrderId}`}>Required reason</Label><Input id={`reconcile-reason-${workOrderId}`} value={reconcileReason} onChange={event => setReconcileReason(event.target.value)} placeholder="Explain reset, reopen, or deletion" /></div>
        <label className="flex items-start gap-2 rounded-md border p-3 text-sm"><Checkbox checked={restoreUsedStock} onCheckedChange={checked => setRestoreUsedStock(checked === true)} /><span><span className="font-medium">Restore used quantities to stock</span><span className="mt-1 block text-xs text-muted-foreground">Only check if the physical meters are confirmed back in the selected inventory location.</span></span></label>
      </div><DialogFooter><Button variant="outline" onClick={() => setReconcileOpen(false)}>Keep inventory as posted</Button><Button variant="destructive" disabled={!reconcileReason.trim() || mutation.isPending} onClick={() => mutation.mutate({ action: "reconcileWorkOrder", payload: { workOrderId, reason: reconcileReason.trim(), restoreUsedStock } }, { onSuccess: () => { setReconcileOpen(false); setReconcileReason(""); setRestoreUsedStock(false); } })}>Confirm reconciliation</Button></DialogFooter>
    </DialogContent></Dialog>
  </Card>;
}
