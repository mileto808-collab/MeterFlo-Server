import { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryItem, InventoryOrder, InventoryState } from "@shared/inventory";
import { canonicalInventoryJson } from "@shared/inventory-engine";
import type { ShipmentCapture } from "@shared/inventory-shipment-draft-model";
import { orderLineProgress } from "@shared/inventory-shipment-model";
import { AlertTriangle, Check, PackageCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { buildShipmentPayload, blankShipmentEntry, shipmentCapacity, unresolvedTransferSerials, validateShipmentEntry, type ShipmentAction, type ShipmentEntry } from "@/lib/inventory-shipment-guidance";
import { InventoryShipmentSerialDialog } from "@/components/inventory-shipment-serial-dialog";

type Props = {
  state: InventoryState; order: InventoryOrder; action: ShipmentAction; items: InventoryItem[];
  canCloseRemainder: boolean; busy?: boolean;
  initialCapture?: ShipmentCapture; savedFingerprint?: string;
  onSaveDraft?: (capture: ShipmentCapture) => Promise<boolean>;
  externalMessage?: string;
  onPost: (data: Record<string, unknown>, capture?: ShipmentCapture) => Promise<boolean>;
  onClose: () => void; onDirtyChange: (dirty: boolean) => void;
};

export function InventoryShipmentGuidedDialog({ state: openingState, order, action, items, canCloseRemainder, busy = false, initialCapture, savedFingerprint, onSaveDraft, onPost, onClose, onDirtyChange, externalMessage }: Props) {
  // A lost response may refresh stock after the server committed. Keep this
  // editor's opening snapshot so client-side availability does not block its
  // same-operation retry; the server still validates every fresh posting.
  const [state] = useState(openingState);
  const initialEntries = initialCapture?.entries ?? {};
  const initialBuffers = initialCapture?.scanBuffers ?? {};
  const [entries, setEntries] = useState<Record<string, ShipmentEntry>>(() => initialCapture?.entries ?? {});
  const [reason, setReason] = useState(initialCapture?.reason ?? "");
  const [review, setReview] = useState(false);
  const [closeRemainder, setCloseRemainder] = useState(initialCapture?.closeRemainder ?? false);
  const [validation, setValidation] = useState("");
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const [scanBuffers, setScanBuffers] = useState<Record<string, string>>(initialCapture?.scanBuffers ?? {});
  const [savedBase, setSavedBase] = useState(savedFingerprint ?? canonicalInventoryJson({
    entries: Object.fromEntries(Object.entries(initialEntries).sort(([a], [b]) => a.localeCompare(b))),
    scanBuffers: Object.fromEntries(Object.entries(initialBuffers).sort(([a], [b]) => a.localeCompare(b))),
    reason: initialCapture?.reason ?? "", closeRemainder: initialCapture?.closeRemainder ?? false,
  }));
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const eligible = useMemo(() => {
    const ids = new Set(order.lines.map(line => line.itemId));
    Object.entries(entries).forEach(([id, row]) => {
      if (row.goodQuantity !== "0" || row.damagedQuantity !== "0" || row.unreadableQuantity !== "0" ||
        row.goodSerials.length || row.damagedSerials.length || row.expectedSerials.length || row.damageReason ||
        Object.entries(scanBuffers).some(([key, value]) => key.startsWith(`${id}-`) && !!value)) ids.add(id);
    });
    Object.entries(scanBuffers).forEach(([key, value]) => {
      const id = key.endsWith("-goodSerials") ? key.slice(0, -"-goodSerials".length) :
        key.endsWith("-damagedSerials") ? key.slice(0, -"-damagedSerials".length) : "";
      if (id && value) ids.add(id);
    });
    return [...ids].map(id => items.find(item => item.id === id)).filter((item): item is InventoryItem => !!item);
  }, [order, items, entries, scanBuffers]);
  const missingSavedItems = useMemo(() => Object.keys(entries).filter(id => !items.some(item => item.id === id) &&
    (entries[id].goodQuantity !== "0" || entries[id].damagedQuantity !== "0" || entries[id].unreadableQuantity !== "0" ||
      entries[id].goodSerials.length || entries[id].damagedSerials.length || entries[id].expectedSerials.length ||
      entries[id].damageReason || Object.entries(scanBuffers).some(([key, value]) => key.startsWith(`${id}-`) && !!value))),
    [entries, items, scanBuffers]);
  const missingBufferItems = useMemo(() => Object.entries(scanBuffers).filter(([, value]) => !!value).map(([key]) =>
    key.endsWith("-goodSerials") ? key.slice(0, -"-goodSerials".length) :
      key.endsWith("-damagedSerials") ? key.slice(0, -"-damagedSerials".length) : "").filter(id => !!id && !items.some(item => item.id === id)),
    [scanBuffers, items]);
  const capture: ShipmentCapture = { entries, scanBuffers, reason, closeRemainder };
  const fingerprint = canonicalInventoryJson(capture);
  const [serialDialog, setSerialDialog] = useState<{ itemId: string; viewOnly: boolean } | null>(null);
  const serialDialogOpenRef = useRef(false);
  serialDialogOpenRef.current = !!serialDialog;
  const serialOpenerRef = useRef<HTMLElement | null>(null);
  const dirty = fingerprint !== savedBase;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  const values = (itemId: string) => entries[itemId] ?? blankShipmentEntry(itemId);
  const patch = (itemId: string, change: Partial<ShipmentEntry>) => {
    setEntries(current => ({ ...current, [itemId]: { ...values(itemId), ...change } }));
    setValidation("");
  };
  const close = () => { if (busy || savingDraft) return; if (dirty) setDiscard(true); else onClose(); };
  const scannedTotal = Object.values(entries).reduce((sum, row) => sum + row.goodSerials.length + row.damagedSerials.length, 0);
  const unavailableSerialReason = (serial: string) => {
    if (state.stock.some(stock => stock.serials.includes(serial))) return "This serial is already in current stock.";
    if ((state.shipmentHolds ?? []).some(hold => hold.status === "held" &&
      (hold.serials.includes(serial) || hold.expectedSerials.includes(serial)))) return "This serial is already held for inspection.";
    if ((state.serialOccupancy ?? []).some(occupancy => occupancy.serial === serial))
      return "This serial is currently installed or occupied by a work order.";
    if (state.returns.some(returned => returned.serial === serial && (returned.status === "pending" || returned.status === "quarantine")))
      return "This serial is part of a pending equipment return.";
    if (state.receipts.some(receipt => receipt.action === "assemble" && receipt.components?.some(line => line.serials.includes(serial))))
      return "This serial is already recorded as a kit component.";
    const foreignTransit = state.orders.some(other => other.id !== order.id && other.type === "transfer" &&
      other.dispatched.some(line => line.serials.includes(serial) && unresolvedTransferSerials(state, other, line.itemId).includes(serial)));
    if (foreignTransit) return "This serial is unresolved in another transfer.";
    return "";
  };
  const scanCommit = (item: InventoryItem, bucket: "goodSerials" | "damagedSerials", raw: string) => {
    const serial = raw.trim();
    const row = values(item.id), all = [...row.goodSerials, ...row.damagedSerials];
    const allMovementSerials = Object.values(entries).flatMap(entry => [...entry.goodSerials, ...entry.damagedSerials]);
    const targetQty = Number(bucket === "goodSerials" ? row.goodQuantity : row.damagedQuantity);
    const available = action === "accept" ? unresolvedTransferSerials(state, order, item.id) : [];
    const reservedSerials = action === "dispatch" ? state.allocations.filter(allocation => allocation.status === "reserved")
      .flatMap(allocation => allocation.lines.filter(line => line.warehouseId === order.sourceId && line.itemId === item.id).flatMap(line => line.serials)) : [];
    const sourceSerials = action === "dispatch" ? state.stock.filter(stock => stock.warehouseId === order.sourceId && stock.itemId === item.id)
      .flatMap(stock => stock.serials).filter(value => !reservedSerials.includes(value)) : [];
    const legacyAllowed = order.lines.find(line => line.itemId === item.id)?.serials ?? [];
    const unavailable = action === "receive" || action === "accept" ? unavailableSerialReason(serial) : "";
    const issue = !serial ? "Scan is blank." : serial.length > 100 ? "Serials are limited to 100 characters." :
      allMovementSerials.includes(serial) ? "This serial is already in the movement." :
      all.length >= 10000 ? "This product line is limited to 10,000 identified serials." :
      row[bucket].length >= targetQty ? "The selected quantity is already fully scanned." :
      action === "accept" && !available.includes(serial) ? "This identity was not dispatched or is already resolved." :
      unavailable ? unavailable :
      action === "dispatch" && item.tracking === "serialized" && !sourceSerials.includes(serial) ? "This serial is not available in the transfer source location." :
      action === "dispatch" && legacyAllowed.length > 0 && !legacyAllowed.includes(serial) ? "This order retains a legacy serial restriction; choose an allowed identity." : "";
    if (issue) { setValidation(issue); return false; }
    patch(item.id, { [bucket]: [...row[bucket], serial] });
    setValidation("");
    return true;
  };
  const commitChildScannerInput = (item: InventoryItem, bucket: "goodSerials" | "damagedSerials", input: HTMLInputElement) => {
    if (!scanCommit(item, bucket, input.value)) return false;
    setScanBuffers(current => ({ ...current, [`${item.id}-${bucket}`]: "" }));
    return true;
  };
  const openSerialDialog = (item: InventoryItem, viewOnly: boolean, opener: HTMLElement) => {
    serialOpenerRef.current = opener;
    setSerialDialog({ itemId: item.id, viewOnly });
  };
  const closeSerialDialog = () => {
    setSerialDialog(null);
    requestAnimationFrame(() => serialOpenerRef.current?.focus());
  };
  const isChildPortalEvent = (event: Event) => {
    const target = (event as CustomEvent).detail?.originalEvent?.target as Element | undefined;
    return !!target?.closest?.("[data-serial-child-dialog]");
  };
  const validateAll = () => {
    if (missingSavedItems.length || missingBufferItems.length) {
      setValidation(`Saved product identities are unavailable: ${[...new Set([...missingSavedItems, ...missingBufferItems])].join(", ")}. Restore the product/order line or discard the saved draft.`);
      setReview(false);
      return false;
    }
    if (Object.values(scanBuffers).some(buffer => buffer.length > 0)) {
      setValidation("Commit each scanner entry with Enter / Tab, or clear the raw scanner text before review.");
      setReview(false);
      return false;
    }
    const rows = eligible.map(item => values(item.id));
    for (const item of eligible) {
      const row = values(item.id);
      const issue = validateShipmentEntry(row, item.tracking === "serialized", action,
        action === "accept" ? unresolvedTransferSerials(state, order, item.id) : []);
      if (issue) { setValidation(`${item.name} (${item.sku}): ${issue}`); setReview(false); return false; }
      const capturedSerials = [...row.goodSerials, ...row.damagedSerials];
      if ((capturedSerials.length || Number(row.goodQuantity) || Number(row.damagedQuantity)) && !item.active) {
        setValidation(`${item.name}: this product is inactive. Reactivate it or correct the saved entry; scans have been retained.`);
        setReview(false); return false;
      }
      for (const serial of capturedSerials) {
        let conflict = "";
        if (action === "dispatch") {
          const reservedSerials = state.allocations.filter(a => a.status === "reserved")
            .flatMap(a => a.lines.filter(l => l.warehouseId === order.sourceId && l.itemId === item.id).flatMap(l => l.serials));
          const onHand = state.stock.some(b => b.warehouseId === order.sourceId && b.itemId === item.id && b.serials.includes(serial));
          const restricted = order.lines.find(l => l.itemId === item.id)?.serials ?? [];
          if (!onHand || reservedSerials.includes(serial)) conflict = "This identity is no longer available and unreserved at the source.";
          else if (restricted.length && !restricted.includes(serial)) conflict = "This identity is not allowed by the order's serial restriction.";
        } else conflict = unavailableSerialReason(serial);
        if (conflict) {
          setValidation(`${item.name} · ${serial}: ${conflict} Correct this saved scan before posting.`);
          setReview(false); return false;
        }
      }
      const total = Number(row.goodQuantity) + Number(row.damagedQuantity) + Number(row.unreadableQuantity);
      if (total > shipmentCapacity(state, order, action, item.id)) {
        setValidation(`${item.name}: movement quantity is above the remaining amount.`); setReview(false); return false;
      }
      if (action === "dispatch") {
        const reserved = state.allocations.filter(allocation => allocation.status === "reserved")
          .flatMap(allocation => allocation.lines).filter(line => line.warehouseId === order.sourceId && line.itemId === item.id)
          .reduce((sum, line) => sum + line.quantity, 0);
        const onHand = state.stock.filter(stock => stock.warehouseId === order.sourceId && stock.itemId === item.id)
          .reduce((sum, stock) => sum + stock.quantity, 0);
        if (total > Math.max(0, onHand - reserved)) {
          setValidation(`${item.name}: only ${Math.max(0, onHand - reserved)} unreserved units are in the transfer source snapshot.`); setReview(false); return false;
        }
      }
    }
    const { lines, damaged } = buildShipmentPayload(rows, action);
    if (!lines.length && !damaged.length && !closeRemainder) { setValidation("Enter at least one movement quantity or choose close remainder."); return false; }
    if (closeRemainder && !reason.trim()) { setValidation("Enter a reason before closing the order remainder."); return false; }
    if (lines.length > 500 || damaged.length > 500) { setValidation("A shipment is limited to 500 product lines."); return false; }
    const allScanned = rows.flatMap(row => [...row.goodSerials, ...row.damagedSerials]);
    if (new Set(allScanned).size !== allScanned.length) {
      setValidation("Scans must be unique across the entire movement."); return false;
    }
    for (const item of eligible) {
      const row = values(item.id);
      if (item.tracking === "serialized" && row.goodSerials.length + row.damagedSerials.length + row.expectedSerials.length > 10000) {
        setValidation(`${item.name}: identified and expected serials are limited to 10,000 combined per product line.`); return false;
      }
    }
    setValidation("");
    return true;
  };
  const submit = async () => {
    if (!validateAll()) return;
    const payload = buildShipmentPayload(eligible.map(item => values(item.id)), action);
    setError("");
    try {
      const confirmed = await onPost({ orderId: order.id, lines: payload.lines, damaged: payload.damaged, reason: reason.trim(), ...(closeRemainder ? { closeRemainder: true } : {}) }, capture);
      if (confirmed) { onDirtyChange(false); onClose(); }
      else setError("The posting was not confirmed. Your quantities and scans are still here; retry without changing them.");
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : "The request failed."} Your entries are retained; retrying unchanged will reuse the same operation identity.`);
    }
  };
  const heading = action === "receive" ? "Receive purchase" : action === "dispatch" ? "Dispatch transfer" : "Accept transfer arrival";
  return <Dialog open onOpenChange={open => { if (!open && !serialDialogOpenRef.current) close(); }}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl"
        onEscapeKeyDown={event => { event.preventDefault(); if (!serialDialogOpenRef.current) close(); }}
        onPointerDownOutside={event => { event.preventDefault(); if (!serialDialogOpenRef.current && !isChildPortalEvent(event)) close(); }}
        onInteractOutside={event => { if (serialDialogOpenRef.current || isChildPortalEvent(event)) event.preventDefault(); }}>
      <fieldset disabled={busy || savingDraft} className="contents">
      <DialogHeader><DialogTitle>{heading} · <span className="font-mono">{order.id}</span></DialogTitle><DialogDescription>
        {action === "dispatch" ? "Scan actual serialized identities leaving the source location." : action === "accept" ? "Scan newly received identities. Unreadable damaged units must reference unresolved dispatched identities." : "Record physical units received. Damaged units are held for inspection, not available stock."}
      </DialogDescription></DialogHeader>
      {discard ? <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>Discard movement edits?</AlertTitle><AlertDescription>Your scans and quantities have not been posted.</AlertDescription><div className="mt-3 flex justify-end gap-2"><Button variant="outline" onClick={() => setDiscard(false)}>Stay</Button><Button variant="destructive" onClick={() => { onDirtyChange(false); onClose(); }}>Discard</Button></div></Alert> : <>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded border p-2"><span className="text-muted-foreground">Order</span><p className="font-mono font-medium">{order.id}</p></div>
          <div className="rounded border p-2"><span className="text-muted-foreground">Movement</span><p className="font-medium">{heading}</p></div>
          <div className="rounded border p-2"><span className="text-muted-foreground">Scan count</span><p className="font-mono font-medium" aria-live="polite">{scannedTotal} committed</p></div>
          <div className="rounded border p-2"><span className="text-muted-foreground">Rows</span><p className="font-mono font-medium">{eligible.length} retained</p></div>
        </div>
        {(missingSavedItems.length > 0 || missingBufferItems.length > 0) && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Saved product is missing</AlertTitle><AlertDescription>Restore the missing product or order line before posting, or discard the saved draft: {[...new Set([...missingSavedItems, ...missingBufferItems])].join(", ")}. Captured quantities and scans remain stored.</AlertDescription></Alert>}
        {!eligible.length ? <Alert><PackageCheck className="h-4 w-4" /><AlertTitle>No remaining lines</AlertTitle><AlertDescription>All lines are settled for this movement.</AlertDescription></Alert> :
          review ? <div className="max-h-[44dvh] space-y-2 overflow-y-auto pr-1" aria-label="Movement review">
            {eligible.filter(item => {
              const row = values(item.id);
              return Number(row.goodQuantity) || Number(row.damagedQuantity) || Number(row.unreadableQuantity) ||
                row.goodSerials.length || row.damagedSerials.length || row.expectedSerials.length || !!row.damageReason;
            }).map(item => {
              const row = values(item.id);
              return <section key={item.id} className="rounded-md border p-3">
                <div className="flex justify-between gap-2"><div className="font-medium">{item.name}<span className="ml-2 font-mono text-xs text-muted-foreground">{item.sku}</span></div><span className="font-mono text-sm">Good {row.goodQuantity} · Damaged {Number(row.damagedQuantity) + Number(row.unreadableQuantity)}</span></div>
                {item.tracking === "serialized" && <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">Good {row.goodSerials.length}/{row.goodQuantity} · Known damaged {row.damagedSerials.length}/{row.damagedQuantity}{action === "accept" ? ` · Unreadable refs ${row.expectedSerials.length}/${row.unreadableQuantity}` : ""}</span>
                  <Button type="button" size="sm" variant="outline" aria-label={`View serials for ${item.name}`} onClick={event => openSerialDialog(item, true, event.currentTarget)}>View serials</Button>
                </div>}
                {(Number(row.damagedQuantity) + Number(row.unreadableQuantity)) > 0 && <p className="mt-1 text-xs">Condition: {row.damageReason}</p>}
              </section>;
            })}
            {closeRemainder && <section className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
              <h3 className="text-sm font-semibold">Outstanding amounts to close</h3>
              <ul className="mt-2 space-y-1 text-xs">{order.lines.map(line => {
                const item = items.find(value => value.id === line.itemId);
                const progress = orderLineProgress(state, order, line.itemId);
                const entry = values(line.itemId);
                const receivedNow = Number(entry.goodQuantity) + Number(entry.damagedQuantity) + Number(entry.unreadableQuantity);
                const remaining = Math.max(0, progress.ordered - progress.received - receivedNow);
                return remaining > 0 ? <li key={line.itemId} className="flex justify-between gap-3"><span>{item?.name ?? line.itemId} <span className="font-mono">{item?.sku}</span></span><span className="font-mono">{remaining} unfulfilled</span></li> : null;
              })}</ul>
              <p className="mt-2 text-xs text-muted-foreground">Final closed-short includes all units not physically received, including previously recorded losses.</p>
            </section>}
            <Alert><Check className="h-4 w-4" /><AlertTitle>{closeRemainder ? "Close with exceptions" : "Review before posting"}</AlertTitle><AlertDescription>{reason.trim()} {closeRemainder ? "Outstanding quantities will be written to the closure record, not received as stock." : "Posting updates the stock ledger immediately."}</AlertDescription></Alert>
          </div> :
          <div className="max-h-[44dvh] space-y-2 overflow-y-auto pr-1">
            {eligible.map(item => {
              const row = values(item.id), progress = orderLineProgress(state, order, item.id);
              const capacity = shipmentCapacity(state, order, action, item.id);
              return <section key={item.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-medium">{item.name}</div><div className="font-mono text-xs text-muted-foreground">{item.sku} · {item.tracking === "serialized" ? "serialized" : "quantity tracked"}</div></div>
                  <Badge variant="outline">Remaining {capacity}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Ordered {progress.ordered} · Dispatched {progress.dispatched} · Earlier received {progress.received} · Usable {progress.usable} · Damaged {progress.damaged} · Lost {progress.lost}</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {([["goodQuantity", "Good"], ["damagedQuantity", "Known damaged"], ["unreadableQuantity", "Unreadable"]] as const)
                    .filter(([key]) => key !== "unreadableQuantity" || item.tracking === "serialized").map(([key, label]) =>
                    <div key={key} className="space-y-1"><Label htmlFor={`${item.id}-${key}`} className="text-xs">{label}</Label><Input id={`${item.id}-${key}`} className="h-9 px-2 text-center tabular-nums" type="number" min="0" max={capacity} step="1" value={row[key]} disabled={action === "dispatch" && key !== "goodQuantity"} onChange={event => patch(item.id, { [key]: event.target.value })} /></div>)}
                </div>
                {item.tracking === "serialized" && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/35 px-2.5 py-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    Good {row.goodSerials.length}/{row.goodQuantity} · Damaged {row.damagedSerials.length}/{row.damagedQuantity}
                    {action === "accept" ? ` · Refs ${row.expectedSerials.length}/${row.unreadableQuantity}` : ""}
                  </span>
                  <Button type="button" size="sm" variant="outline" aria-label={`Scan / edit serials for ${item.name}`}
                    onClick={event => openSerialDialog(item, false, event.currentTarget)}>Scan / edit serials</Button>
                </div>}
                {Number(row.damagedQuantity) + Number(row.unreadableQuantity) > 0 && <div className="mt-2 space-y-1"><Label htmlFor={`${item.id}-damage-reason`} className="text-xs">Damage condition / reason</Label><Textarea id={`${item.id}-damage-reason`} rows={2} maxLength={1000} value={row.damageReason} onChange={event => patch(item.id, { damageReason: event.target.value })} placeholder="Describe observed condition" /></div>}
                {Number(row.goodQuantity) + Number(row.damagedQuantity) + Number(row.unreadableQuantity) > capacity && <p className="mt-1 text-xs text-destructive" role="alert">Total exceeds the {capacity} eligible units.</p>}
              </section>;
            })}
          </div>}
        <div className="space-y-2"><Label htmlFor="shipment-reason">Movement note / exception reason</Label><Textarea id="shipment-reason" maxLength={1000} rows={2} value={reason} disabled={review} onChange={event => { setReason(event.target.value); setValidation(""); }} placeholder="Why is this movement partial or what was observed?" /></div>
        {canCloseRemainder && action !== "dispatch" && <label className="flex items-start gap-2 rounded-md border p-3 text-sm"><input type="checkbox" className="mt-1" checked={closeRemainder} disabled={review} onChange={event => setCloseRemainder(event.target.checked)} /><span><span className="font-medium">Close the order remainder</span><span className="mt-0.5 block text-xs text-muted-foreground">Explicitly close outstanding quantities as unfulfilled; this does not record stock. A reason and confirmation are required.</span></span></label>}
        {validation && <p className="text-sm text-destructive" role="alert">{validation}</p>}
        {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Posting not confirmed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {draftMessage && <p className="text-sm" role="status">{draftMessage}</p>}
        {externalMessage && <p className="text-sm" role="status">{externalMessage}</p>}
        <DialogFooter className="flex-col sm:flex-row">
          <Button variant="outline" disabled={busy} onClick={close}>Cancel</Button>
          {onSaveDraft && <Button variant="outline" disabled={busy || savingDraft || !dirty} onClick={async () => {
            setSavingDraft(true); setDraftMessage("");
            try {
              const ok = await onSaveDraft(capture);
              if (ok) { setSavedBase(fingerprint); setDraftMessage("Draft saved. You can cancel and resume it later."); }
              else setDraftMessage("Draft save was not confirmed. Your local capture is still open.");
            } finally { setSavingDraft(false); }
          }}>{savingDraft ? "Saving draft…" : "Save draft"}</Button>}
          {!review ? <Button disabled={busy || !eligible.length} onClick={() => { if (validateAll()) setReview(true); }}>Review movement</Button> :
            <><Button variant="outline" disabled={busy} onClick={() => setReview(false)}>Back to entries</Button>
            <Button disabled={busy} onClick={() => closeRemainder && !window.confirm(`Close order ${order.id} with the outstanding amounts shown? This cannot be undone.`) ? undefined : void submit()}>{busy ? "Posting…" : closeRemainder ? "Confirm & post close" : "Post movement"}</Button></>}
        </DialogFooter>
      </>}
      </fieldset>
    </DialogContent>
    {serialDialog && (() => {
      const item = items.find(value => value.id === serialDialog.itemId);
      if (!item) return null;
      const row = values(item.id);
      return <InventoryShipmentSerialDialog
        key={`${item.id}-${serialDialog.viewOnly ? "view" : "edit"}`}
        item={item}
        order={order}
        action={action}
        entry={row}
        viewOnly={serialDialog.viewOnly}
        rawBuffers={scanBuffers}
        expectedReferences={action === "accept" ? unresolvedTransferSerials(state, order, item.id) : []}
        validation={validation}
        onRawChange={(key, value) => setScanBuffers(current => ({ ...current, [key]: value }))}
        onCommit={(bucket, input) => commitChildScannerInput(item, bucket, input)}
        onPatch={change => patch(item.id, change)}
        onClose={closeSerialDialog}
      />;
    })()}
  </Dialog>;
}
