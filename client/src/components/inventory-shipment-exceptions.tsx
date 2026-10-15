import { useEffect, useMemo, useState } from "react";
import type { InventoryItem, InventoryOrder, InventoryState } from "@shared/inventory";
import { orderLabel, orderReference } from "@shared/inventory-order-labels";
import { holdDispositions, holdStatus, remainingHold, type ShipmentHold } from "@shared/inventory-shipment-model";
import { holdDispositionCommandSchema, selectHoldDisposition, type HoldDispositionCommand } from "@shared/inventory-hold-disposition";
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
  onResolve: (payload: HoldDispositionCommand) => Promise<boolean>;
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
  const [quantity, setQuantity] = useState("");
  const [selectedSerials, setSelectedSerials] = useState<string[]>([]);
  const [unidentifiedQuantity, setUnidentifiedQuantity] = useState("");
  const [selectedExpectedSerials, setSelectedExpectedSerials] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const remaining = selected ? remainingHold(selected) : null;
  const isSerialized = !!selected && (selected.serials.length > 0 || selected.expectedSerials.length > 0 || selected.unidentifiedQuantity > 0);
  const sameValues = (left: string[], right: string[]) => left.length === right.length && left.every(value => right.includes(value));
  const dirty = !!selected && (!!reason || !!reference || !!verifiedText || outcome !== "released" ||
    quantity !== String(remaining?.quantity ?? "") ||
    !sameValues(selectedSerials, remaining?.serials ?? []) ||
    unidentifiedQuantity !== String(remaining?.unidentifiedQuantity ?? "") ||
    !sameValues(selectedExpectedSerials, remaining?.expectedSerials ?? []));
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  const requestClose = () => { if (busy) return; if (dirty) setDiscard(true); else setSelected(null); };
  const holds = state.shipmentHolds ?? [];
  const visible = useMemo(() => holds.filter(hold => {
    if (warehouse !== "all" && hold.warehouseId !== warehouse) return false;
    const item = items.find(value => value.id === hold.itemId);
    const order = orders.find(value => value.id === hold.orderId);
    const location = state.warehouses.find(value => value.id === hold.warehouseId);
    return `${item?.sku ?? hold.itemId} ${item?.name ?? ""} ${hold.orderId} ${order ? `${orderLabel(order)} ${orderReference(order)}` : ""} ${hold.receiptId} ${location?.code ?? ""} ${location?.name ?? ""} ${hold.serials.join(" ")} ${hold.expectedSerials.join(" ")}`.toLowerCase().includes(query.toLowerCase().trim());
  }), [holds, items, orders, state.warehouses, warehouse, query]);
  const openResolution = (hold: ShipmentHold) => {
    const stillHeld = remainingHold(hold);
    setSelected(hold); setOutcome("released"); setReason(""); setReference("");
    setVerifiedText(""); setQuantity(String(stillHeld.quantity));
    setSelectedSerials(stillHeld.serials); setUnidentifiedQuantity(String(stillHeld.unidentifiedQuantity));
    setSelectedExpectedSerials(stillHeld.expectedSerials);
    setError(""); setDiscard(false);
  };
  const submit = async () => {
    if (!selected) return;
    const verifiedSerials = outcome === "released" ? verifiedText.split(/[\n,;]/).map(value => value.trim()).filter(Boolean) : [];
    try {
      const parsed = holdDispositionCommandSchema.safeParse({
        id: selected.id, outcome, reason, reference, verifiedSerials,
        quantity: Number(quantity),
        serials: isSerialized ? selectedSerials : [],
        unidentifiedQuantity: isSerialized ? Number(unidentifiedQuantity) : 0,
        expectedSerials: isSerialized ? selectedExpectedSerials : [],
      });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Check the disposition details and try again.");
        return;
      }
      selectHoldDisposition(selected, isSerialized, parsed.data);
      const confirmed = await onResolve(parsed.data);
      if (confirmed) setSelected(null);
      else setError("Resolution was not confirmed. The exception remains open; retry without changing this batch.");
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "Request failed."} The original hold remains unchanged; retry this disposition or adjust it after review.`);
    }
  };
  const activeWarehouses = state.warehouses.filter(value => value.active);
  const orderTitle = (id: string) => { const order = orders.find(order => order.id === id); return order ? orderLabel(order) : id; };
  const openHolds = holds.filter(value => remainingHold(value).quantity > 0).length;
  return <section className="space-y-3 rounded-lg border p-4" aria-labelledby="shipment-exceptions-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="shipment-exceptions-title" className="font-semibold">Shipment holds & exceptions</h3><p className="text-sm text-muted-foreground">Damaged arrivals remain quarantined until an authorized, reasoned batch disposition.</p></div><Badge variant={openHolds ? "outline" : "secondary"}>{openHolds} held</Badge></div>
    <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
      <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input disabled={busy} className="pl-9" aria-label="Search shipment exceptions" placeholder="Search order, item, serial or location" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <Select disabled={busy} value={warehouse} onValueChange={setWarehouse}><SelectTrigger aria-label="Filter exceptions by location"><SelectValue placeholder="All locations" /></SelectTrigger><SelectContent><SelectItem value="all">All locations</SelectItem>{activeWarehouses.map(value => <SelectItem key={value.id} value={value.id}>{value.code} · {value.name}</SelectItem>)}</SelectContent></Select>
    </div>
    {!visible.length ? <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">{holds.length ? "No shipment exceptions match this search and location." : "No shipment holds have been recorded."}</div> :
      <div className="max-h-80 space-y-2 overflow-y-auto">{visible.map(hold => {
        const item = items.find(value => value.id === hold.itemId);
        const order = orders.find(value => value.id === hold.orderId);
        const location = state.warehouses.find(value => value.id === hold.warehouseId);
        const stillHeld = remainingHold(hold);
        const history = holdDispositions(hold);
        const status = holdStatus(hold);
        return <div key={hold.id} data-testid={`shipment-hold-${hold.id}`} className="flex flex-col justify-between gap-2 rounded-md border p-3 sm:flex-row sm:items-start">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-medium">{item?.name ?? hold.itemId}<span className="font-mono text-xs text-muted-foreground">{item?.sku ?? hold.itemId}</span><Badge variant={stillHeld.quantity > 0 ? "outline" : "secondary"}>{status}</Badge></div>
            <p className="mt-1 text-xs text-muted-foreground">Order <span className="font-mono">{order ? orderLabel(order) : hold.orderId}</span>{order && orderReference(order) ? ` · ${orderReference(order)}` : ""} · Receipt <span className="font-mono">{hold.receiptId}</span> · {location?.code ?? hold.warehouseId} · {stillHeld.quantity} held</p>
            <p className="mt-1 text-xs text-muted-foreground">Received by {hold.actor} · {new Date(hold.occurredAt).toLocaleString()}</p>
            <p className="mt-1 text-xs">{hold.reason}</p>
            {(hold.serials.length > 0 || hold.expectedSerials.length > 0) && <p className="mt-1 break-all font-mono text-xs text-muted-foreground">Still held — known: {stillHeld.serials.join(", ") || "none"}{stillHeld.expectedSerials.length ? ` · Unverified dispatch refs: ${stillHeld.expectedSerials.join(", ")}` : ""}{stillHeld.unidentifiedQuantity ? ` · ${stillHeld.unidentifiedQuantity} unidentified` : ""}</p>}
            {history.length > 0 && <div className="mt-2 space-y-2 border-t pt-2">
              {history.map(disposition => <div key={disposition.operationId} className="rounded-sm bg-muted/40 px-2 py-1.5 text-xs">
                <p className="font-medium">{disposition.outcome} · {disposition.quantity} units · {disposition.actor} · {new Date(disposition.occurredAt).toLocaleString()}</p>
                <p className="mt-0.5 break-words text-muted-foreground">Reason: {disposition.reason}{disposition.reference ? ` · Reference: ${disposition.reference}` : ""}</p>
                {(disposition.serials.length > 0 || disposition.expectedSerials.length > 0 || disposition.unidentifiedQuantity > 0) && <p className="mt-0.5 break-all font-mono text-muted-foreground">Known: {disposition.serials.join(", ") || "none"} · Unidentified: {disposition.unidentifiedQuantity}{disposition.expectedSerials.length ? ` · Dispatch refs: ${disposition.expectedSerials.join(", ")}` : ""}{disposition.verifiedSerials.length ? ` · Verified: ${disposition.verifiedSerials.join(", ")}` : ""}</p>}
                <Button className="mt-1 h-7 px-2" size="sm" variant="ghost" onClick={() => onPrintReceipt(disposition.operationId)}>Print disposition receipt</Button>
              </div>)}
            </div>}
          </div>
          <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" disabled={!order || busy} onClick={() => order && onPrintOrder(order.id)}>Order</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => onPrintReceipt(hold.receiptId)}>Receipt</Button>{stillHeld.quantity > 0 && canResolve && <Button size="sm" disabled={busy} onClick={() => openResolution(hold)}>Resolve</Button>}</div>
        </div>;
      })}</div>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) requestClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onEscapeKeyDown={event => { event.preventDefault(); requestClose(); }} onPointerDownOutside={event => { event.preventDefault(); requestClose(); }}>
        <DialogHeader><DialogTitle>Resolve shipment hold</DialogTitle><DialogDescription>Record one disposition for the selected units. Any units you leave unselected stay quarantined. This records custody; it does not create a vendor credit or carrier claim.</DialogDescription></DialogHeader>
        {selected && <div className="space-y-3">
          <Alert><ShieldAlert className="h-4 w-4" /><AlertTitle>{items.find(item => item.id === selected.itemId)?.name ?? selected.itemId} · {remaining?.quantity} remaining units</AlertTitle><AlertDescription>Order {orderTitle(selected.orderId)} · receipt {selected.receiptId} · {remaining?.serials.length} known serials, {remaining?.unidentifiedQuantity} unidentified. {holdDispositions(selected).length} disposition(s) already recorded.</AlertDescription></Alert>
          <div className="space-y-1"><Label>Disposition</Label><Select disabled={busy} value={outcome} onValueChange={value => setOutcome(value as typeof outcome)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="released">Release after inspection</SelectItem><SelectItem value="returned">Record physical return</SelectItem><SelectItem value="scrapped">Scrap / write off</SelectItem></SelectContent></Select></div>
          {isSerialized && <fieldset className="space-y-2 rounded-md border p-3" disabled={busy}>
            <legend className="px-1 text-sm font-medium">Partial disposition selection</legend>
            <div className="space-y-1"><Label htmlFor="shipment-disposition-quantity">Units to disposition (of {remaining?.quantity} still held)</Label><Input id="shipment-disposition-quantity" type="number" min={1} max={remaining?.quantity} step={1} value={quantity} onChange={event => setQuantity(event.target.value)} /><p className="text-xs text-muted-foreground">Choose just the units covered by this action. For serialized goods, selected known serials plus unidentified units must equal this quantity; unselected units remain held.</p></div>
            {remaining?.serials.length ? <fieldset className="space-y-1"><legend className="text-sm font-medium">Still-held known serials to disposition</legend><div className="grid max-h-28 gap-1 overflow-y-auto rounded border p-2 sm:grid-cols-2">{remaining.serials.map(serial => <label key={serial} className="flex min-w-0 items-center gap-2 text-xs"><input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={selectedSerials.includes(serial)} onChange={event => setSelectedSerials(current => event.target.checked ? [...current, serial] : current.filter(value => value !== serial))} /><span className="break-all font-mono">{serial}</span></label>)}</div><p className="text-xs text-muted-foreground">Check only the known units in this disposition. Example: select two serials and enter a quantity of 2.</p></fieldset> : null}
            {remaining?.unidentifiedQuantity ? <div className="space-y-1"><Label htmlFor="shipment-unidentified-quantity">Unidentified units to disposition (of {remaining.unidentifiedQuantity})</Label><Input id="shipment-unidentified-quantity" type="number" min={0} max={remaining.unidentifiedQuantity} step={1} value={unidentifiedQuantity} onChange={event => setUnidentifiedQuantity(event.target.value)} /><p className="text-xs text-muted-foreground">Use this for unreadable or not-yet-identified units. Example: one selected serial plus one unidentified unit requires quantity 2.</p></div> : null}
            {remaining?.expectedSerials.length ? <fieldset className="space-y-1"><legend className="text-sm font-medium">Dispatch reference IDs for unidentified transfer units</legend><p className="text-xs text-muted-foreground">Select exactly one still-held reference per unidentified transfer unit being dispositioned.</p><div className="grid max-h-28 gap-1 overflow-y-auto rounded border p-2 sm:grid-cols-2">{remaining.expectedSerials.map(serial => <label key={serial} className="flex min-w-0 items-center gap-2 text-xs"><input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={selectedExpectedSerials.includes(serial)} onChange={event => setSelectedExpectedSerials(current => event.target.checked ? [...current, serial] : current.filter(value => value !== serial))} /><span className="break-all font-mono">{serial}</span></label>)}</div></fieldset> : null}
          </fieldset>}
          {!isSerialized && <div className="space-y-1"><Label htmlFor="shipment-disposition-quantity">Units to disposition (of {remaining?.quantity} still held)</Label><Input id="shipment-disposition-quantity" type="number" min={1} max={remaining?.quantity} step={1} value={quantity} disabled={busy} onChange={event => setQuantity(event.target.value)} /><p className="text-xs text-muted-foreground">Enter a subset quantity to leave the rest quarantined, or keep {remaining?.quantity} to disposition all remaining units.</p></div>}
          {outcome === "returned" && <div className="space-y-1"><Label htmlFor="shipment-return-reference">Return destination / reference</Label><Input id="shipment-return-reference" disabled={busy} maxLength={500} value={reference} onChange={event => setReference(event.target.value)} placeholder="Carrier, vendor, destination or shipment reference" /></div>}
          {outcome === "released" && isSerialized && <div className="space-y-1"><Label htmlFor="shipment-verified-serials">Verified serial identities</Label><Textarea id="shipment-verified-serials" disabled={busy} rows={3} maxLength={1_000_000} value={verifiedText} onChange={event => setVerifiedText(event.target.value)} placeholder="Scan/type each physical identity, one per line" /><p className="text-xs text-muted-foreground">Enter exactly one unique verified identity per selected serialized unit. Keep every selected known serial; each unreadable transfer unit must match its selected dispatch reference.</p></div>}
          <div className="space-y-1"><Label htmlFor="shipment-resolution-reason">Resolution reason</Label><Textarea id="shipment-resolution-reason" disabled={busy} rows={3} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Inspection result and custody decision" /></div>
          {error && <p role="alert" className="text-sm text-destructive"><AlertTriangle className="mr-1 inline h-4 w-4" />{error}</p>}
        </div>}
        {discard && <Alert><AlertTitle>Discard inspection edits?</AlertTitle><AlertDescription>Your partial selection, verified identities and inspection notes have not been posted.</AlertDescription><div className="mt-2 flex gap-2"><Button disabled={busy} variant="outline" onClick={() => setDiscard(false)}>Stay</Button><Button disabled={busy} variant="destructive" onClick={() => { setDiscard(false); setSelected(null); }}>Discard</Button></div></Alert>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={requestClose}>Cancel</Button><Button disabled={busy || !reason.trim()} onClick={() => void submit()}>{busy ? "Recording…" : "Record disposition"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
