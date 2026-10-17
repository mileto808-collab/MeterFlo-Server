import { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryItem, InventoryOrder, InventoryState, StockLine } from "@shared/inventory";
import { orderLineProgress } from "@shared/inventory-shipment-model";
import { orderLabel } from "@shared/inventory-order-labels";
import { AlertTriangle, PackageX, ScanLine, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  state: InventoryState; liveState?: InventoryState; order: InventoryOrder; items: InventoryItem[]; busy?: boolean;
  onPost: (payload: Record<string, unknown>) => Promise<boolean>; onClose: () => void; onDirtyChange: (dirty: boolean) => void;
  onRecheck?: (order: InventoryOrder) => void;
};

const transitOrderFingerprint = (order: InventoryOrder) => JSON.stringify({
  status: order.status, lines: order.lines, dispatched: order.dispatched,
  received: order.received, losses: order.losses ?? [],
});

export function InventoryShipmentTransitDialog({ state, liveState, order, items, busy = false, onPost, onClose, onDirtyChange, onRecheck }: Props) {
  const basisState = liveState ?? state;
  const currentOrder = basisState.orders.find(value => value.id === order.id);
  const orderChanged = !currentOrder || transitOrderFingerprint(currentOrder) !== transitOrderFingerprint(order);
  const visibleOrder = currentOrder ?? order;
  const rows = useMemo(() => visibleOrder.lines.map(line => ({
    item: items.find(item => item.id === line.itemId),
    quantity: orderLineProgress(basisState, visibleOrder, line.itemId).inTransit,
    serials: visibleOrder.dispatched.filter(value => value.itemId === line.itemId).flatMap(value => value.serials)
      .filter(serial => !visibleOrder.received.filter(value => value.itemId === line.itemId).flatMap(value => value.serials).includes(serial) &&
        !(visibleOrder.losses ?? []).filter(value => value.itemId === line.itemId).flatMap(value => value.serials).includes(serial)),
  })).filter(row => row.item && row.quantity > 0), [basisState, visibleOrder, items]);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [serialDraft, setSerialDraft] = useState<Record<string, string>>({});
  const [scanned, setScanned] = useState<Record<string, string[]>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState(false);
  const [discard, setDiscard] = useState(false);
  const scanRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const dirty = Object.values(quantities).some(value => value !== "0") ||
    Object.values(serialDraft).some(Boolean) || Object.values(scanned).some(list => list.length > 0) || !!reason;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const requestClose = () => { if (dirty) setDiscard(true); else onClose(); };
  const liveRowIds = new Set(rows.map(row => row.item?.id).filter((id): id is string => !!id));
  const orphanedCaptureIds = [...new Set([
    ...Object.entries(quantities).filter(([, value]) => value !== "0").map(([id]) => id),
    ...Object.entries(serialDraft).filter(([, value]) => !!value.trim()).map(([id]) => id),
    ...Object.entries(scanned).filter(([, values]) => values.length > 0).map(([id]) => id),
  ].filter(id => !liveRowIds.has(id)))];
  const lineFor = (id: string) => rows.find(row => row.item?.id === id);
  const addScan = (itemId: string) => {
    const value = serialDraft[itemId] ?? "";
    const serial = value.trim();
    const row = lineFor(itemId);
    const committed = scanned[itemId] ?? [];
    if (!serial || serial.length > 100) { setError("Enter a nonblank serial up to 100 characters."); return false; }
    if (!row?.serials.includes(serial) || committed.includes(serial) ||
        Object.values(scanned).some(list => list.includes(serial))) {
      setError("Only a distinct, unresolved identity actually dispatched on this order can be written off."); return false;
    }
    if (committed.length >= Math.min(10000, Number(quantities[itemId] ?? "0"))) {
      setError("The lost quantity is already fully identified; adjust it explicitly before adding another serial."); return false;
    }
    setScanned(current => ({ ...current, [itemId]: [...committed, serial] }));
    setSerialDraft(current => ({ ...current, [itemId]: "" }));
    setError("");
    if (committed.length + 1 >= Number(quantities[itemId] ?? "0")) {
      const index = rows.findIndex(candidate => candidate.item?.id === itemId);
      const next = rows.slice(index + 1).find(candidate => candidate.item?.tracking === "serialized" &&
        (scanned[candidate.item.id]?.length ?? 0) < Number(quantities[candidate.item.id] ?? "0"));
      if (next?.item) requestAnimationFrame(() => scanRefs.current[next.item!.id]?.focus());
    } else requestAnimationFrame(() => scanRefs.current[itemId]?.focus());
    return true;
  };
  const buildLines = () => {
    const result: StockLine[] = [];
    if (orphanedCaptureIds.length) return { error: `Captured lines are no longer in the current transfer: ${orphanedCaptureIds.join(", ")}. Review and explicitly discard those line entries before posting.` };
    if (Object.values(serialDraft).some(value => value.trim())) return { error: "Commit or clear every unfinished identity before review." };
    for (const row of rows) {
      const item = row.item!;
      const text = quantities[item.id] ?? "0";
      const quantity = Number(text);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > Math.min(1_000_000, row.quantity))
        return { error: `${item.name}: quantity must be a whole number within the ${row.quantity} in-transit units.` };
      const serials = scanned[item.id] ?? [];
      if (serials.some(serial => !row.serials.includes(serial)))
        return { error: `${item.name}: one or more captured identities are no longer unresolved in the current transfer. Remove or review those scans before posting.` };
      if (item.tracking === "serialized" && quantity > 10000)
        return { error: `${item.name}: at most 10,000 serial identities can be resolved on one line.` };
      if (item.tracking === "serialized" && quantity !== serials.length)
        return { error: `${item.name}: select ${quantity} actual unresolved serials before recording this loss.` };
      if (item.tracking !== "serialized" && serials.length) return { error: `${item.name} is quantity tracked; remove serial entries.` };
      if (quantity > 0) result.push({ itemId: item.id, quantity, serials });
    }
    if (!result.length) return { error: "Select at least one explicitly lost in-transit unit." };
    if (!reason.trim()) return { error: "A reason is required for this write-off." };
    return { lines: result };
  };
  const submit = async () => {
    if (orderChanged) {
      setError(currentOrder
        ? "Transfer changed elsewhere. Recheck the current transfer before reviewing or posting; your entries are retained."
        : "Transfer is unavailable. Your entries are retained and cannot be posted against the old order.");
      setReview(false);
      return;
    }
    const built = buildLines();
    if (!("lines" in built)) { setError(built.error); setReview(false); return; }
    if (!review) { setReview(true); return; }
    const payload = { orderId: visibleOrder.id, lines: built.lines, reason: reason.trim() };
    setError("");
    try {
      if (await onPost(payload)) { onDirtyChange(false); onClose(); }
      else setError("The write-off was not confirmed. Entries remain; retrying unchanged reuses the operation identity.");
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "Request failed."} Entries are retained for the same-identity retry.`);
    }
  };
  return <Dialog open onOpenChange={open => { if (!open && !busy) requestClose(); }}>
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" onEscapeKeyDown={event => { event.preventDefault(); requestClose(); }} onPointerDownOutside={event => { event.preventDefault(); requestClose(); }}>
      <DialogHeader><DialogTitle>Resolve in-transit loss · <span className="font-mono">{orderLabel(visibleOrder)}</span></DialogTitle><DialogDescription>Explicitly write off dispatched stock that will not arrive. This does not create a destination receipt or restock the source.</DialogDescription></DialogHeader>
      {orderChanged && <Alert data-testid="inventory-external-change" variant={!currentOrder ? "destructive" : "default"}>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{currentOrder ? "Transfer changed elsewhere" : "Transfer is no longer available"}</AlertTitle>
        <AlertDescription className="space-y-2">
          <span>{currentOrder
            ? `Current order, received identities, or prior loss custody changed. Your entries remain intact.${orphanedCaptureIds.length ? ` Captures for ${orphanedCaptureIds.join(", ")} are retained but no longer match an open line.` : ""} Recheck the current transfer before continuing.`
            : "This transfer was removed or is no longer available. Quantities, scans and reason remain retained and cannot be posted against the old order."}</span>
          {currentOrder && onRecheck && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { onRecheck(currentOrder); setReview(false); setError(""); }}>Recheck current transfer</Button>}
          {orphanedCaptureIds.length > 0 && <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => {
            if (!window.confirm(`Discard captured quantities and serials for ${orphanedCaptureIds.join(", ")}?`)) return;
            setQuantities(current => { const next = { ...current }; orphanedCaptureIds.forEach(id => delete next[id]); return next; });
            setSerialDraft(current => { const next = { ...current }; orphanedCaptureIds.forEach(id => delete next[id]); return next; });
            setScanned(current => { const next = { ...current }; orphanedCaptureIds.forEach(id => delete next[id]); return next; });
          }}>Discard unavailable line captures</Button>}
        </AlertDescription>
      </Alert>}
      {discard ? <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>Discard loss resolution entries?</AlertTitle><AlertDescription>This write-off has not been recorded.</AlertDescription><div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={() => setDiscard(false)}>Stay</Button><Button variant="destructive" onClick={() => { onDirtyChange(false); onClose(); }}>Discard</Button></div></Alert> :
      !rows.length ? <Alert><PackageX className="h-4 w-4" /><AlertTitle>No unresolved transit quantities</AlertTitle><AlertDescription>Every dispatched unit is received or already resolved.</AlertDescription></Alert> :
      review ? <div className="max-h-[44dvh] space-y-2 overflow-y-auto">{rows.filter(row => Number(quantities[row.item!.id] ?? "0") > 0).map(row => <div key={row.item!.id} className="rounded-md border p-3"><p className="font-medium">{row.item!.name} · lost {quantities[row.item!.id]}</p>{(scanned[row.item!.id] ?? []).length > 0 && <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{scanned[row.item!.id].join(", ")}</p>}</div>)}<Alert><PackageX className="h-4 w-4" /><AlertTitle>Explicit transit write-off</AlertTitle><AlertDescription>{reason}</AlertDescription></Alert></div> :
        <div className="max-h-[44dvh] space-y-2 overflow-y-auto">{rows.map(row => {
          const item = row.item!;
          const qty = Number(quantities[item.id] ?? "0");
          return <section key={item.id} className="space-y-2 rounded-md border p-3">
            <div className="flex justify-between gap-2"><div><p className="font-medium">{item.name}</p><p className="font-mono text-xs text-muted-foreground">{item.sku}</p></div><p className="text-xs text-muted-foreground">{row.quantity} in transit</p></div>
            <div className="max-w-32 space-y-1"><Label htmlFor={`loss-qty-${item.id}`} className="text-xs">Lost quantity</Label><Input id={`loss-qty-${item.id}`} className="h-9 text-center font-mono" type="number" min="0" max={row.quantity} value={quantities[item.id] ?? "0"} onChange={event => setQuantities(current => ({ ...current, [item.id]: event.target.value }))} /></div>
            {item.tracking === "serialized" && qty > 0 && <div className="space-y-1"><Label htmlFor={`loss-scan-${item.id}`} className="text-xs">Actual unresolved serials · {(scanned[item.id] ?? []).length}/{qty}</Label><div className="flex gap-2"><Input ref={node => { scanRefs.current[item.id] = node; }} id={`loss-scan-${item.id}`} className="h-9 font-mono" maxLength={100} value={serialDraft[item.id] ?? ""} placeholder="Scan dispatched identity" onChange={event => setSerialDraft(current => ({ ...current, [item.id]: event.target.value }))} onKeyDown={event => {
              if (event.key === "Enter") { event.preventDefault(); addScan(item.id); return; }
              if (event.key === "Tab" && (serialDraft[item.id] ?? "").length > 0) { event.preventDefault(); addScan(item.id); }
            }} /><Button size="sm" variant="outline" aria-label={`Commit lost serial for ${item.name}`} onClick={() => addScan(item.id)}><ScanLine className="h-4 w-4" /></Button></div>
              <ul className="flex flex-wrap gap-1">{(scanned[item.id] ?? []).map(serial => <li key={serial} className="flex items-center gap-1 rounded bg-muted px-2 py-1 font-mono text-xs">{serial}<button type="button" aria-label={`Remove ${serial} from loss resolution`} onClick={() => setScanned(current => ({ ...current, [item.id]: current[item.id].filter(value => value !== serial) }))}><Trash2 className="h-3 w-3" /></button></li>)}</ul>
            </div>}
            {item.tracking === "serialized" && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Dispatched identities available to resolve</summary><p className="mt-1 break-all font-mono">{row.serials.join(", ") || "No unresolved dispatched serials"}</p></details>}
          </section>;
        })}</div>}
      {!discard && <div className="space-y-1"><Label htmlFor="transit-loss-reason">Loss resolution reason</Label><Textarea id="transit-loss-reason" maxLength={1000} rows={3} value={reason} disabled={review} onChange={event => setReason(event.target.value)} placeholder="Confirmed carrier loss, field incident or other evidence" /></div>}
      {error && <p role="alert" className="text-sm text-destructive"><AlertTriangle className="mr-1 inline h-4 w-4" />{error}</p>}
       {!discard && <DialogFooter><Button variant="outline" disabled={busy} onClick={() => review ? setReview(false) : requestClose()}>{review ? "Back to entries" : "Cancel"}</Button><Button variant={review ? "destructive" : "default"} disabled={busy || orderChanged || !rows.length} onClick={() => void submit()}>{busy ? "Recording…" : review ? "Confirm transit loss" : "Review write-off"}</Button></DialogFooter>}
    </DialogContent>
  </Dialog>;
}
