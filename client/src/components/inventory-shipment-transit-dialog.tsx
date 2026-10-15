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
  state: InventoryState; order: InventoryOrder; items: InventoryItem[]; busy?: boolean;
  onPost: (payload: Record<string, unknown>) => Promise<boolean>; onClose: () => void; onDirtyChange: (dirty: boolean) => void;
};

export function InventoryShipmentTransitDialog({ state, order, items, busy = false, onPost, onClose, onDirtyChange }: Props) {
  const rows = useMemo(() => order.lines.map(line => ({
    item: items.find(item => item.id === line.itemId),
    quantity: orderLineProgress(state, order, line.itemId).inTransit,
    serials: order.dispatched.filter(value => value.itemId === line.itemId).flatMap(value => value.serials)
      .filter(serial => !order.received.filter(value => value.itemId === line.itemId).flatMap(value => value.serials).includes(serial) &&
        !(order.losses ?? []).filter(value => value.itemId === line.itemId).flatMap(value => value.serials).includes(serial)),
  })).filter(row => row.item && row.quantity > 0), [state, order, items]);
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
    if (Object.values(serialDraft).some(value => value.trim())) return { error: "Commit or clear every unfinished identity before review." };
    for (const row of rows) {
      const item = row.item!;
      const text = quantities[item.id] ?? "0";
      const quantity = Number(text);
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > Math.min(1_000_000, row.quantity))
        return { error: `${item.name}: quantity must be a whole number within the ${row.quantity} in-transit units.` };
      const serials = scanned[item.id] ?? [];
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
    const built = buildLines();
    if (!("lines" in built)) { setError(built.error); setReview(false); return; }
    if (!review) { setReview(true); return; }
    const payload = { orderId: order.id, lines: built.lines, reason: reason.trim() };
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
      <DialogHeader><DialogTitle>Resolve in-transit loss · <span className="font-mono">{orderLabel(order)}</span></DialogTitle><DialogDescription>Explicitly write off dispatched stock that will not arrive. This does not create a destination receipt or restock the source.</DialogDescription></DialogHeader>
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
      {!discard && <DialogFooter><Button variant="outline" disabled={busy} onClick={() => review ? setReview(false) : requestClose()}>{review ? "Back to entries" : "Cancel"}</Button><Button variant={review ? "destructive" : "default"} disabled={busy || !rows.length} onClick={() => void submit()}>{busy ? "Recording…" : review ? "Confirm transit loss" : "Review write-off"}</Button></DialogFooter>}
    </DialogContent>
  </Dialog>;
}
