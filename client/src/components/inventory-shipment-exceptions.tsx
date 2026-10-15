import { useEffect, useMemo, useState } from "react";
import type { InventoryItem, InventoryOrder, InventoryState } from "@shared/inventory";
import type { ShipmentHold } from "@shared/inventory-shipment-model";
import { AlertTriangle, Search, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  state: InventoryState; items: InventoryItem[]; orders: InventoryOrder[];
  canResolve: boolean; busy?: boolean;
  onResolve: (payload: { id: string; outcome: "released" | "returned" | "scrapped"; reason: string; reference: string; verifiedSerials: string[] }) => Promise<boolean>;
  onPrintOrder: (id: string) => void; onPrintReceipt: (id: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export function InventoryShipmentExceptions({ state, items, orders, canResolve, busy = false, onResolve, onPrintOrder, onPrintReceipt, onDirtyChange }: Props) {
  const [query, setQuery] = useState("");
  const [warehouse, setWarehouse] = useState("all");
  const [selected, setSelected] = useState<ShipmentHold | null>(null);
  const [outcome, setOutcome] = useState<"released" | "returned" | "scrapped">("released");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");
  const [verifiedText, setVerifiedText] = useState("");
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const dirty = !!selected && (!!reason || !!reference || !!verifiedText || outcome !== "released");
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const requestClose = () => { if (busy) return; if (dirty) setDiscard(true); else setSelected(null); };
  const holds = state.shipmentHolds ?? [];
  const visible = useMemo(() => holds.filter(hold => {
    if (warehouse !== "all" && hold.warehouseId !== warehouse) return false;
    const item = items.find(value => value.id === hold.itemId);
    const order = orders.find(value => value.id === hold.orderId);
    const location = state.warehouses.find(value => value.id === hold.warehouseId);
    return `${item?.sku ?? hold.itemId} ${item?.name ?? ""} ${hold.orderId} ${hold.receiptId} ${location?.code ?? ""} ${location?.name ?? ""} ${hold.serials.join(" ")} ${hold.expectedSerials.join(" ")}`.toLowerCase().includes(query.toLowerCase().trim());
  }), [holds, items, orders, state.warehouses, warehouse, query]);
  const openResolution = (hold: ShipmentHold) => {
    setSelected(hold); setOutcome("released"); setReason(""); setReference("");
    setVerifiedText(""); setError(""); setDiscard(false);
  };
  const submit = async () => {
    if (!selected) return;
    const verifiedSerials = outcome === "released" ? verifiedText.split(/[\n,;]/).map(value => value.trim()).filter(Boolean) : [];
    if (!reason.trim()) { setError("A resolution reason is required."); return; }
    if (outcome === "returned" && !reference.trim()) { setError("A physical return destination/reference is required."); return; }
    if (outcome === "released" && selected.serials.length + selected.unidentifiedQuantity + selected.expectedSerials.length > 0) {
      if (verifiedSerials.length !== new Set(verifiedSerials).size) { setError("Verified identities must be unique."); return; }
      if (selected.serials.some(serial => !verifiedSerials.includes(serial))) { setError("Verify every known serial before releasing this batch."); return; }
      if (selected.expectedSerials.some(serial => !verifiedSerials.includes(serial))) { setError("Verified serials must match the dispatched identities recorded for unreadable units."); return; }
      if (verifiedSerials.length !== selected.serials.length + selected.unidentifiedQuantity) { setError("Enter exactly one verified identity for every serialized unit in this hold."); return; }
    }
    try {
      const confirmed = await onResolve({ id: selected.id, outcome, reason: reason.trim(), reference: reference.trim(), verifiedSerials });
      if (confirmed) setSelected(null);
      else setError("Resolution was not confirmed. The exception remains open; retry without changing this batch.");
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "Request failed."} The batch remains available for the same-identity retry.`);
    }
  };
  const activeWarehouses = state.warehouses.filter(value => value.active);
  const openHolds = holds.filter(value => value.status === "held").length;
  return <section className="space-y-3 rounded-lg border p-4" aria-labelledby="shipment-exceptions-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="shipment-exceptions-title" className="font-semibold">Shipment holds & exceptions</h3><p className="text-sm text-muted-foreground">Damaged arrivals remain quarantined until an authorized, reasoned batch disposition.</p></div><Badge variant={openHolds ? "outline" : "secondary"}>{openHolds} held</Badge></div>
    <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
      <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" aria-label="Search shipment exceptions" placeholder="Search order, item, serial or location" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <Select value={warehouse} onValueChange={setWarehouse}><SelectTrigger aria-label="Filter exceptions by location"><SelectValue placeholder="All locations" /></SelectTrigger><SelectContent><SelectItem value="all">All locations</SelectItem>{activeWarehouses.map(value => <SelectItem key={value.id} value={value.id}>{value.code} · {value.name}</SelectItem>)}</SelectContent></Select>
    </div>
    {!visible.length ? <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{holds.length ? "No shipment exceptions match this search and location." : "No shipment holds have been recorded."}</div> :
      <div className="max-h-80 space-y-2 overflow-y-auto">{visible.map(hold => {
        const item = items.find(value => value.id === hold.itemId);
        const order = orders.find(value => value.id === hold.orderId);
        const location = state.warehouses.find(value => value.id === hold.warehouseId);
        return <div key={hold.id} data-testid={`shipment-hold-${hold.id}`} className="flex flex-col justify-between gap-2 rounded-md border p-3 sm:flex-row sm:items-start">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-medium">{item?.name ?? hold.itemId}<span className="font-mono text-xs text-muted-foreground">{item?.sku ?? hold.itemId}</span><Badge variant={hold.status === "held" ? "outline" : "secondary"}>{hold.status}</Badge></div>
            <p className="mt-1 text-xs text-muted-foreground">Order <span className="font-mono">{hold.orderId}</span> · Receipt <span className="font-mono">{hold.receiptId}</span> · {location?.code ?? hold.warehouseId} · {hold.quantity} held</p>
            <p className="mt-1 text-xs text-muted-foreground">Received by {hold.actor} · {new Date(hold.occurredAt).toLocaleString()}</p>
            <p className="mt-1 text-xs">{hold.reason}</p>
            {(hold.serials.length > 0 || hold.expectedSerials.length > 0) && <p className="mt-1 break-all font-mono text-xs text-muted-foreground">Known: {hold.serials.join(", ") || "none"}{hold.expectedSerials.length ? ` · Expected identities: ${hold.expectedSerials.join(", ")}` : ""}</p>}
            {hold.resolution && <p className="mt-1 text-xs text-muted-foreground">Disposition: {hold.status} · resolved by {hold.resolution.actor} · {new Date(hold.resolution.occurredAt).toLocaleString()} · {hold.resolution.reference} · {hold.resolution.reason}</p>}
          </div>
          <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" disabled={!order} onClick={() => order && onPrintOrder(order.id)}>Order</Button><Button size="sm" variant="outline" onClick={() => onPrintReceipt(hold.receiptId)}>Receipt</Button>{hold.status === "held" && canResolve && <Button size="sm" onClick={() => openResolution(hold)}>Resolve</Button>}</div>
        </div>;
      })}</div>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onEscapeKeyDown={event => { event.preventDefault(); requestClose(); }} onPointerDownOutside={event => { event.preventDefault(); requestClose(); }}>
        <DialogHeader><DialogTitle>Resolve shipment hold</DialogTitle><DialogDescription>Resolve the whole batch once. This records its custody disposition; it does not create a vendor credit or carrier claim.</DialogDescription></DialogHeader>
        {selected && <div className="space-y-3">
          <Alert><ShieldAlert className="h-4 w-4" /><AlertTitle>{items.find(item => item.id === selected.itemId)?.name ?? selected.itemId} · {selected.quantity} units</AlertTitle><AlertDescription>Order {selected.orderId} · receipt {selected.receiptId} · {selected.serials.length} known identities, {selected.unidentifiedQuantity} unidentified.</AlertDescription></Alert>
          <div className="space-y-1"><Label>Disposition</Label><Select value={outcome} onValueChange={value => setOutcome(value as typeof outcome)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="released">Release after inspection</SelectItem><SelectItem value="returned">Record physical return</SelectItem><SelectItem value="scrapped">Scrap / write off</SelectItem></SelectContent></Select></div>
          {outcome === "returned" && <div className="space-y-1"><Label htmlFor="shipment-return-reference">Return destination / reference</Label><Input id="shipment-return-reference" maxLength={200} value={reference} onChange={event => setReference(event.target.value)} placeholder="Carrier, vendor or destination reference" /></div>}
          {outcome === "released" && (selected.serials.length > 0 || selected.unidentifiedQuantity > 0) && <div className="space-y-1"><Label htmlFor="shipment-verified-serials">Verified serial identities</Label><Textarea id="shipment-verified-serials" rows={3} maxLength={1_000_000} value={verifiedText} onChange={event => setVerifiedText(event.target.value)} placeholder="Scan/type each physical identity, one per line" /><p className="text-xs text-muted-foreground">Known IDs must match; unreadable units require exact physical verification before release.</p></div>}
          <div className="space-y-1"><Label htmlFor="shipment-resolution-reason">Resolution reason</Label><Textarea id="shipment-resolution-reason" rows={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Inspection result and custody decision" /></div>
          {error && <p role="alert" className="text-sm text-destructive"><AlertTriangle className="mr-1 inline h-4 w-4" />{error}</p>}
        </div>}
        {discard && <Alert><AlertTitle>Discard inspection edits?</AlertTitle><AlertDescription>Your verified identities and inspection notes have not been posted.</AlertDescription><div className="mt-2 flex gap-2"><Button variant="outline" onClick={() => setDiscard(false)}>Stay</Button><Button variant="destructive" onClick={() => { setDiscard(false); setSelected(null); }}>Discard</Button></div></Alert>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={requestClose}>Cancel</Button><Button disabled={busy || !reason.trim()} onClick={() => void submit()}>{busy ? "Recording…" : "Record disposition"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
