import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Allocation, InventoryItem, Warehouse, WorkAllocation, WorkRequirements } from "@shared/inventory";
import { locationTypeFor, locationTypeLabel, warehouseAccessible, type InventoryLocationType } from "@shared/inventory-location-types";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useInventoryEvents } from "@/hooks/useInventoryEvents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, PackageCheck, Plus, Trash2 } from "lucide-react";

type WorkInventorySnapshot = {
  enabled: boolean; allocation: WorkAllocation | null; items: InventoryItem[]; warehouses: Warehouse[];
  locationTypes?: InventoryLocationType[]; requirements?: WorkRequirements; canSelect?: boolean;
};
type DraftLine = Allocation;

export function InventoryWorkOrderPanel({ projectId, workOrderId, readingOnly = false }: {
  projectId: string | number; workOrderId: number; readingOnly?: boolean;
}) {
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const { toast } = useToast();
  const inventoryEvents = useInventoryEvents(projectId);
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
  const draftBase = useRef<string | null>(null);
  const draftLocationTypes = useRef(new Map<string, string>());
  const draftEditEpoch = useRef(0);
  const [draftTouched, setDraftTouched] = useState(false);
  const [staleAllocation, setStaleAllocation] = useState(false);
  const canAssign = hasPermission("inventory.assign") && data?.canSelect !== false;

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
  const locationState = { locationTypes: data?.locationTypes ?? [] };
  const allocationSignature = JSON.stringify(data?.allocation ?? null);
  const locationTypeSignature = (id: string) => {
    const warehouse = warehouses.find(value => value.id === id);
    const type = warehouse ? locationTypeFor(locationState, warehouse) : undefined;
    return JSON.stringify({ id, active: warehouse?.active ?? false, type: type
      ? { id: type.id, revision: type.revision, kind: type.kind, accessPolicy: type.accessPolicy }
      : null });
  };
  const signatureInSnapshot = (snapshot: WorkInventorySnapshot, id: string) => {
    const warehouse = snapshot.warehouses.find(value => value.id === id);
    const type = warehouse ? locationTypeFor({ locationTypes: snapshot.locationTypes ?? [] }, warehouse) : undefined;
    return JSON.stringify({ id, active: warehouse?.active ?? false, type: type
      ? { id: type.id, revision: type.revision, kind: type.kind, accessPolicy: type.accessPolicy }
      : null });
  };
  const typeBasisChangedIn = (snapshot: WorkInventorySnapshot) => draftLocationIds.some(id =>
    draftLocationTypes.current.has(id) && draftLocationTypes.current.get(id) !== signatureInSnapshot(snapshot, id));
  const captureLocationTypes = (ids: string[]) => {
    ids.filter(Boolean).forEach(id => {
      if (!draftLocationTypes.current.has(id)) draftLocationTypes.current.set(id, locationTypeSignature(id));
    });
  };
  const draftLocationIds = [...new Set([
    ...lines.map(line => line.warehouseId),
    ...(data?.allocation?.lines ?? []).map(line => line.warehouseId),
    warehouseId, returnWarehouse,
  ].filter(Boolean))];
  const locationTypeConflict = draftLocationIds.some(id =>
    draftLocationTypes.current.has(id) && draftLocationTypes.current.get(id) !== locationTypeSignature(id));
  const allocationDraftActive = lines.length > 0 || draftTouched || reviewing;
  const allocationConflict = !mutation.isPending && allocationDraftActive && (staleAllocation ||
    draftBase.current !== null && draftBase.current !== allocationSignature || locationTypeConflict);
  const selectedItem = items.find(item => item.id === itemId);
  const availableWarehouses = useMemo(() => warehouses.filter(warehouse =>
    warehouseAccessible(locationState, warehouse, user?.id, user?.role === "admin")),
  [warehouses, data?.locationTypes, user?.id, user?.role]);
  const beginDraft = () => {
    if (draftBase.current === null) {
      draftBase.current = allocationSignature;
      captureLocationTypes([...lines.map(line => line.warehouseId), ...(data?.allocation?.lines ?? []).map(line => line.warehouseId), warehouseId, returnWarehouse]);
    }
    draftEditEpoch.current++;
    setDraftTouched(true);
  };
  const createEmptyAssignment = async () => {
    if (mutation.isPending) return;
    const checked = await refetch();
    if (checked.isError || !checked.data) {
      toast({ title: "Could not recheck allocation", description: "Retry after the current work-order inventory loads.", variant: "destructive" });
      return;
    }
    if (checked.data.allocation) return;
    mutation.mutate({ action: "assign", payload: { workOrderId, lines: [] } });
  };
  const removeReservation = async (line: Allocation) => {
    if (mutation.isPending) return;
    const checked = await refetch();
    if (checked.isError || !checked.data) {
      toast({ title: "Could not recheck allocation", description: "The reservation was not removed. Retry after inventory loads.", variant: "destructive" });
      return;
    }
    if (JSON.stringify(checked.data.allocation ?? null) !== allocationSignature) {
      draftBase.current = allocationSignature;
      captureLocationTypes([...lines.map(value => value.warehouseId), ...(data?.allocation?.lines ?? []).map(value => value.warehouseId), warehouseId, returnWarehouse]);
      setDraftTouched(true);
      setStaleAllocation(true);
      return;
    }
    const remaining = (checked.data.allocation?.lines ?? []).filter(other =>
      !(other.warehouseId === line.warehouseId && other.itemId === line.itemId));
    mutation.mutate({ action: "assign", payload: { workOrderId, lines: remaining } });
  };

  if (isLoading) return <Card><CardContent className="p-5 space-y-3"><div className="h-5 w-40 animate-pulse rounded bg-muted" /><div className="h-12 animate-pulse rounded bg-muted" /></CardContent></Card>;
  if (isError) return <Card><CardContent className="p-5"><p className="text-sm text-destructive">Inventory assignments could not load.</p><Button className="mt-3" variant="outline" onClick={() => refetch()}>Retry</Button></CardContent></Card>;
  if (!data?.enabled) return null;

  const addLine = () => {
    beginDraft();
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
  const saveAssignment = async () => {
    if (allocationConflict || mutation.isPending) return;
    const epoch = draftEditEpoch.current;
    let latest: WorkInventorySnapshot | undefined;
    try {
      const checked = await refetch();
      if (checked.isError || !checked.data) throw new Error("Current allocation could not be checked. Your staged lines are retained.");
      latest = checked.data;
    } catch (error) {
      toast({ title: "Could not recheck allocation", description: error instanceof Error ? error.message : "Your staged lines are retained.", variant: "destructive" });
      return;
    }
    if (epoch !== draftEditEpoch.current) return;
    const latestSignature = JSON.stringify(latest.allocation ?? null);
    if ((draftBase.current !== null && latestSignature !== draftBase.current) || typeBasisChangedIn(latest)) {
      setStaleAllocation(true);
      return;
    }
    const next = new Map<string, Allocation>();
    (latest.allocation?.lines ?? []).filter(line => `${line.warehouseId}/${line.itemId}` !== editingKey).forEach(line => next.set(`${line.warehouseId}/${line.itemId}`, line));
    lines.forEach(line => {
      const key = `${line.warehouseId}/${line.itemId}`;
      const prior = next.get(key);
      next.set(key, prior ? { ...prior, quantity: prior.quantity + line.quantity, serials: [...prior.serials, ...line.serials] } : line);
    });
    mutation.mutate({ action: "assign", payload: { workOrderId, lines: [...next.values()] } }, {
      onSuccess: () => { setLines([]); setEditingKey(null); setDraftTouched(false); setStaleAllocation(false); draftBase.current = null; draftLocationTypes.current.clear(); },
    });
  };
  const submitReview = async () => {
    if (allocationConflict || mutation.isPending) return;
    const epoch = draftEditEpoch.current;
    let latest: WorkInventorySnapshot | undefined;
    try {
      const checked = await refetch();
      if (checked.isError || !checked.data) throw new Error("Current allocation could not be checked. Your review entries are retained.");
      latest = checked.data;
    } catch (error) {
      toast({ title: "Could not recheck allocation", description: error instanceof Error ? error.message : "Your review entries are retained.", variant: "destructive" });
      return;
    }
    if (epoch !== draftEditEpoch.current) return;
    const latestSignature = JSON.stringify(latest.allocation ?? null);
    if ((draftBase.current !== null && latestSignature !== draftBase.current) || typeBasisChangedIn(latest)) {
      setStaleAllocation(true);
      return;
    }
    const allocation = latest.allocation;
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
      onSuccess: () => { setReviewing(false); setDraftTouched(false); setStaleAllocation(false); draftBase.current = null; draftLocationTypes.current.clear(); },
    });
  };

  return <Card className="border-l-4 border-l-primary/60">
    <CardHeader className="pb-3"><div className="flex items-center justify-between gap-2"><CardTitle className="flex items-center gap-2 text-base"><PackageCheck className="h-4 w-4 text-primary" />Inventory for this visit</CardTitle>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span data-testid="inventory-live-indicator" aria-live="polite" className="text-[11px] text-muted-foreground">
          {inventoryEvents.status === "live" ? "Live inventory" : inventoryEvents.status === "reconnecting" ? "Reconnecting" : inventoryEvents.status === "unavailable" ? "Live unavailable" : "Connecting"}
        </span>
        {inventoryEvents.status === "unavailable" && <Button type="button" size="sm" variant="outline" aria-label="Retry live inventory updates" onClick={inventoryEvents.reconnect}>Retry</Button>}
        {data.allocation && <Badge variant={data.allocation.mode ? "default" : "outline"}>{data.allocation.status === "consumed" ? "Used reviewed" : data.allocation.mode ? "Review complete" : "Reserved"}</Badge>}
      </div></div>
      <p className="text-sm text-muted-foreground">Planned requirements are separate from reserved stock. Technicians record what they actually use from an accessible stock location during installation.</p></CardHeader>
    <CardContent className="space-y-4">
      <section className="rounded-md border bg-muted/20 p-3" aria-label="Planned requirements">
        <p className="mb-2 text-sm font-medium">Planned requirements <span className="ml-1 text-xs font-normal text-muted-foreground">No reservation created</span></p>
        {(data.requirements?.lines ?? []).length ? <ul className="space-y-1.5 text-sm">
          {(data.requirements?.lines ?? []).map((line, index) => {
            const item = items.find(value => value.id === line.itemId);
            return <li key={`${line.itemId}-${index}`} className="flex justify-between gap-3"><span className="min-w-0 break-words">{item?.name ?? line.itemId}{item?.components.length ? " · kit" : ""}</span><span className="shrink-0 tabular-nums">{line.quantity} {item?.unit ?? "units"}</span></li>;
          })}
        </ul> : <p className="text-xs text-muted-foreground">No items are mapped to the assigned equipment types.</p>}
        {!!data.requirements?.missing.length && <p className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-900 dark:text-amber-200">Unmapped equipment types: {data.requirements.missing.map(row => `${row.equipment} ${row.typeId}`).join(", ")}</p>}
      </section>
      {allocationConflict && <div data-testid="inventory-external-change" role="alert" className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <p className="font-medium">Work-order allocation or location access changed elsewhere</p>
        <p className="text-muted-foreground">Your staged lines and scanner text remain local. Saving or confirming this review is paused so it cannot silently apply to a different allocation or location policy.</p>
        <Button type="button" size="sm" variant="outline" onClick={() => {
          if (!window.confirm("Discard staged allocation and review edits, then use the current server allocation?")) return;
          setLines([]); setEditingKey(null); setItemId(""); setWarehouseId(""); setQuantity("1"); setSerials("");
          setUsed({}); setUsedSerials({}); setDisposition({}); setReturnWarehouse(""); setReviewing(false);
          setDraftTouched(false); setStaleAllocation(false); draftBase.current = null; draftLocationTypes.current.clear(); draftEditEpoch.current++;
        }}>Discard staged edits and use current allocation</Button>
      </div>}
      {itemId && !selectedItem && <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <p className="font-medium">Selected inventory item is no longer available</p>
        <p className="mt-1 text-muted-foreground">The selected catalog record is missing. Captured serial text has been retained: <span className="break-all font-mono">{serials || "none"}</span>. Choose a current item only after reviewing that capture.</p>
      </div>}
      {warehouseId && !availableWarehouses.some(warehouse => warehouse.id === warehouseId) && <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <p className="font-medium">Selected stock location is no longer available</p>
        <p className="mt-1 text-muted-foreground">The location is missing, inactive, or its access changed. Any serial text remains captured locally and will not be submitted until you choose an accessible location.</p>
      </div>}
      {assigned.length > 0 ? <div className="space-y-2">{assigned.map(line => {
        const item = items.find(value => value.id === line.itemId);
        const warehouse = warehouses.find(value => value.id === line.warehouseId);
        return <div key={`${line.warehouseId}/${line.itemId}`} className="flex flex-wrap items-start justify-between gap-2 rounded-md border p-3">
          <div><div className="font-medium">{item?.name ?? line.itemId} <span className="font-mono text-xs text-muted-foreground">{item?.sku}</span></div>
            <div className="text-xs text-muted-foreground">{warehouse?.code ?? line.warehouseId}{warehouse ? ` · ${locationTypeLabel(locationState, warehouse)}` : ""} · {line.quantity} {item?.unit ?? "units"}{line.serials.length > 0 ? ` · ${line.serials.join(", ")}` : ""}</div></div>
          {canAssign && data.allocation?.status === "reserved" && <div className="flex gap-1"><Button aria-label={`Edit ${item?.name ?? "item"} reservation`} variant="ghost" size="sm" onClick={() => {
            draftBase.current = allocationSignature; captureLocationTypes([line.warehouseId, ...(data.allocation?.lines ?? []).map(value => value.warehouseId)]); setDraftTouched(true); draftEditEpoch.current++;
            setEditingKey(`${line.warehouseId}/${line.itemId}`);
            setItemId(line.itemId); setWarehouseId(line.warehouseId); setQuantity(String(line.quantity)); setSerials(line.serials.join("\n")); setLines([]);
          }}>Edit</Button><Button aria-label={`Remove ${item?.name ?? "item"} reservation`} variant="ghost" size="icon" disabled={mutation.isPending} onClick={() => void removeReservation(line)}><Trash2 className="h-4 w-4" /></Button></div>}
        </div>;
      })}</div> : <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No stock is reserved for this work order.</div>}

      {canAssign && data.allocation?.status !== "consumed" && <div className="space-y-3 rounded-md bg-muted/40 p-3">
        {!data.allocation && <Button type="button" variant="outline" onClick={() => void createEmptyAssignment()} disabled={mutation.isPending}>Create empty assignment</Button>}
        <p className="text-sm font-medium">Add reserved stock</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1"><Label htmlFor={`wo-item-${workOrderId}`}>Meter / item</Label><Select value={itemId} onValueChange={value => { if (serials.trim() && itemId && value !== itemId && !window.confirm("Change the item and clear the serial text captured for the previous item?")) return; beginDraft(); if (itemId && value !== itemId) setSerials(""); setItemId(value); }}><SelectTrigger id={`wo-item-${workOrderId}`}><SelectValue placeholder="Select item" /></SelectTrigger><SelectContent>{items.filter(item => item.active).map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label htmlFor={`wo-warehouse-${workOrderId}`}>Stock location</Label><Select value={warehouseId} onValueChange={value => { if (serials.trim() && warehouseId && value !== warehouseId && !window.confirm("Change stock location and clear the serial text captured for the previous location?")) return; beginDraft(); captureLocationTypes([value]); if (warehouseId && value !== warehouseId) setSerials(""); setWarehouseId(value); }}><SelectTrigger id={`wo-warehouse-${workOrderId}`}><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{availableWarehouses.map(warehouse => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name} · {locationTypeLabel(locationState, warehouse)}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label htmlFor={`wo-qty-${workOrderId}`}>Quantity</Label><Input id={`wo-qty-${workOrderId}`} inputMode="numeric" type="number" min="1" value={quantity} onChange={event => { beginDraft(); setQuantity(event.target.value); }} /></div>
        </div>
        {selectedItem?.tracking === "serialized" && <div className="space-y-1"><Label htmlFor={`wo-serials-${workOrderId}`}>Scan serials (one per line or comma)</Label><Input id={`wo-serials-${workOrderId}`} value={serials} onChange={event => { beginDraft(); setSerials(event.target.value); }} placeholder="Scan or enter serial numbers" /></div>}
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={addLine} disabled={!itemId || !warehouseId}><Plus className="mr-1 h-4 w-4" />{editingKey ? "Stage updated line" : "Add line"}</Button>
          <Button type="button" onClick={saveAssignment} disabled={!lines.length || mutation.isPending || allocationConflict}><PackageCheck className="mr-1 h-4 w-4" />Save reservations</Button></div>
        {lines.length > 0 && <p className="text-xs text-muted-foreground">{lines.length} line{lines.length === 1 ? "" : "s"} ready to reserve. Availability is validated by the project inventory service.</p>}
      </div>}

      {data.allocation?.status === "reserved" && <div className="border-t pt-4">
        {!reviewing ? <Button type="button" variant="outline" disabled={!canAssign} onClick={() => { draftBase.current = allocationSignature; captureLocationTypes((data.allocation?.lines ?? []).map(value => value.warehouseId)); setDraftTouched(true); draftEditEpoch.current++; setMode(readingOnly ? "reading_only" : "changeout"); setReviewing(true); }}>
          Review use & removed equipment
        </Button> : <div className="space-y-4">
          <div><Label>Work type</Label><Select value={mode} disabled={readingOnly} onValueChange={value => { beginDraft(); setMode(value as "changeout" | "reading_only"); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="changeout">Meter changeout</SelectItem><SelectItem value="reading_only">Reading only</SelectItem></SelectContent></Select></div>
          {mode === "reading_only" ? <p className="text-sm text-muted-foreground">Reading-only visits use no replacement stock and have no removed-meter disposition.</p> : <>
            {assigned.map(line => {
              const item = items.find(value => value.id === line.itemId);
              const key = `${line.warehouseId}/${line.itemId}`;
              return <div key={key} className="grid gap-2 sm:grid-cols-[1fr_140px] sm:items-center"><div className="text-sm">{item?.name ?? line.itemId} · {line.quantity} reserved{line.serials.length ? ` · ${line.serials.join(", ")}` : ""}</div><div className="space-y-1"><Label htmlFor={`used-${key}`}>Used quantity</Label><Input id={`used-${key}`} type="number" min="0" max={line.quantity} value={used[key] ?? line.quantity} onChange={event => { beginDraft(); setUsed(current => ({ ...current, [key]: Math.min(line.quantity, Math.max(0, Number(event.target.value) || 0)) })); }} /></div></div>;
            })}
            {assigned.filter(line => line.serials.length > 0).map(line => {
              const key = `${line.warehouseId}/${line.itemId}`;
              return <div key={key} className="space-y-1"><Label htmlFor={`used-serial-${line.itemId}`}>Scan serials used · {items.find(item => item.id === line.itemId)?.name}</Label><Input id={`used-serial-${line.itemId}`} value={usedSerials[key] ?? ""} onChange={event => { beginDraft(); setUsedSerials(current => ({ ...current, [key]: event.target.value })); }} placeholder="Reserved serials only" /></div>;
            })}
            {(["system", "module"] as const).map(equipment => <div key={equipment} className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor={`disp-${equipment}`}>Removed {equipment} meter serial</Label><Input id={`disp-${equipment}`} value={disposition[`${equipment}-serial`] ?? ""} onChange={event => { beginDraft(); setDisposition(current => ({ ...current, [`${equipment}-serial`]: event.target.value })); }} placeholder="Scan removed serial" /></div>
              <div className="space-y-1"><Label>Condition / disposition</Label><Select value={disposition[equipment] ?? ""} onValueChange={value => { beginDraft(); setDisposition(current => ({ ...current, [equipment]: value })); }}><SelectTrigger><SelectValue placeholder="Select disposition" /></SelectTrigger><SelectContent><SelectItem value="returned">Return to warehouse</SelectItem><SelectItem value="scrapped">Scrapped</SelectItem><SelectItem value="left_onsite">Left onsite</SelectItem></SelectContent></Select></div>
            </div>)}
            {Object.values(disposition).includes("returned") && <div className="space-y-1"><Label>Return warehouse</Label><Select value={returnWarehouse} onValueChange={value => { beginDraft(); captureLocationTypes([value]); setReturnWarehouse(value); }}><SelectTrigger><SelectValue placeholder="Choose return location" /></SelectTrigger><SelectContent>{availableWarehouses.map(warehouse => <SelectItem value={warehouse.id} key={warehouse.id}>{warehouse.code} · {warehouse.name} · {locationTypeLabel(locationState, warehouse)}</SelectItem>)}</SelectContent></Select></div>}
            <p className="text-xs text-muted-foreground">Only a serial entered with a disposition is posted as removed equipment.</p>
          </>}
          <div className="flex gap-2"><Button type="button" onClick={() => void submitReview()} disabled={mutation.isPending || !canAssign || allocationConflict}>{mutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirm inventory review</Button><Button type="button" variant="ghost" onClick={() => { draftEditEpoch.current++; setReviewing(false); }}>Cancel</Button></div>
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
