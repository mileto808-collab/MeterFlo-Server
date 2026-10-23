import { useEffect, useRef, useState } from "react";
import type { InventoryState } from "@shared/inventory";
import { inventoryDateTime } from "@shared/inventory-date-time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Posting = { operationId: string; data: Record<string, unknown> };
export function CustomerHandoffDialog({ open, onClose, initialIds, state, timezone, workOrderLabels, post, print }: {
  open: boolean; onClose: () => void; initialIds: string[]; state: InventoryState; timezone: string;
  workOrderLabels: Record<string, string>;
  post: (data: Record<string, unknown>, operationId: string) => Promise<unknown>;
  print: (id: string) => void;
}) {
  const [warehouseId, setWarehouse] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<"visual" | "scan">("visual");
  const [inspected, setInspected] = useState(false);
  const [scans, setScans] = useState<string[]>([]);
  const [scan, setScan] = useState("");
  const [recipient, setRecipient] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Posting | null>(null);
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [historyLimit, setHistoryLimit] = useState(20);
  const scanRef = useRef<HTMLInputElement>(null);
  const initialKey = initialIds.join("\0");
  useEffect(() => {
    if (!open || pending) return;
    const targets = state.returns.filter(record => initialIds.includes(record.id) && record.status === "customer_pending");
    const source = targets[0]?.warehouseId ?? state.returns.find(record => record.status === "customer_pending")?.warehouseId ?? "";
    setWarehouse(source);
    setSelected(Object.fromEntries(targets.filter(record => record.warehouseId === source).map(record => [record.id, record.history?.at(-1)?.operationId ?? ""])));
    setScans([]); setInspected(false); setError(""); setPosted(""); setSearch("");
    // Opening a new handoff initializes selection; live refreshes must not replace local verification.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialKey]);
  const eligible = state.returns.filter(record => record.status === "customer_pending");
  const locations = state.warehouses.filter(warehouse => eligible.some(record => record.warehouseId === warehouse.id));
  const matching = eligible.filter(record => record.warehouseId === warehouseId &&
    `${record.serial} ${record.equipment} ${workOrderLabels[String(record.workOrderId)] ?? record.workOrderId}`.toLowerCase().includes(search.toLowerCase()));
  const selectedRecords = state.returns.filter(record => selected[record.id] !== undefined);
  const count = Object.keys(selected).length;
  const stale = selectedRecords.length !== count || selectedRecords.some(record =>
    record.status !== "customer_pending" || record.warehouseId !== warehouseId || record.history?.at(-1)?.operationId !== selected[record.id]);
  const verified = mode === "visual" ? inspected : count > 0 && scans.length === count;
  const resetVerification = () => { setScans([]); setInspected(false); setScan(""); setError(""); };
  const addScan = () => {
    const value = scan.trim();
    if (!value) return;
    if (scans.includes(value)) setError("This serial has already been scanned.");
    else if (selectedRecords.filter(record => record.serial.trim() === value).length !== 1)
      setError("Serial does not uniquely match selected equipment. Check the selection and equipment label.");
    else { setScans(current => [...current, value]); setError(""); }
    setScan("");
  };
  const submit = async () => {
    const posting = pending ?? {
      operationId: crypto.randomUUID(),
      data: { warehouseId, recipient, reference, reason: notes, verification: mode, visuallyVerified: mode === "visual" && inspected,
        entries: Object.entries(selected).map(([id, expectedOperationId]) => ({ id, expectedOperationId })), scannedSerials: mode === "scan" ? scans : [] },
    };
    setPending(posting); setBusy(true); setError("");
    try {
      await post(posting.data, posting.operationId);
      setPosted(posting.operationId); setPending(null); setSelected({}); resetVerification();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Handoff could not be confirmed.";
      const status = Number(message.match(/^(\d{3}):/)?.[1]);
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) setPending(null);
      setError(message);
    } finally { setBusy(false); }
  };
  const history = [...state.customerHandoffs ?? []].reverse().filter(handoff =>
    `${handoff.id} ${handoff.recipient} ${handoff.reference} ${handoff.lines.map(line => line.serial).join(" ")}`.toLowerCase().includes(historySearch.toLowerCase()));
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" onInteractOutside={event => event.preventDefault()}>
      <DialogHeader><DialogTitle>Customer handoff &amp; manifests</DialogTitle>
        <DialogDescription>Verify the old equipment serials and confirm only after actual customer collection or dispatch. Stock is not released.</DialogDescription></DialogHeader>
      {posted && <div role="status" className="rounded border p-3">Customer handoff recorded. <Button type="button" variant="outline" onClick={() => print(posted)}>Print this manifest</Button></div>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {pending && !busy && <p className="text-sm">The outcome is unconfirmed. Retry the same handoff below; its posting identity and verification are retained, even if you close this dialog.</p>}
      <fieldset disabled={busy || !!pending} className="min-w-0 space-y-3">
        <div><Label htmlFor="handoff-location">Handoff warehouse / location</Label><select id="handoff-location" className="h-10 w-full rounded-md border bg-background px-2" value={warehouseId} onChange={event => { setWarehouse(event.target.value); setSelected({}); resetVerification(); }}>
          <option value="">Choose a location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>
        <Input aria-label="Find customer-return equipment" placeholder="Find serial or customer work order" value={search} onChange={event => setSearch(event.target.value)} />
        <div className="flex flex-wrap items-center gap-2 text-sm"><span>{count} selected · {matching.length} matching</span>
          <Button type="button" size="sm" variant="outline" onClick={() => { setSelected(Object.fromEntries(matching.slice(0, 500).map(record => [record.id, record.history?.at(-1)?.operationId ?? ""]))); resetVerification(); }}>Select {matching.length > 500 ? "first 500 matching" : "all matching"}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setSelected({}); resetVerification(); }}>Clear selection</Button></div>
        <div className="max-h-48 overflow-y-auto rounded border p-2">
          {matching.slice(0, 500).map(record => <label key={record.id} className="flex items-start gap-2 border-b py-2 text-sm last:border-0">
            <input type="checkbox" aria-label={`Select serial ${record.serial}`} checked={selected[record.id] !== undefined} onChange={event => {
              setSelected(current => { const next = { ...current }; if (event.target.checked) next[record.id] = record.history?.at(-1)?.operationId ?? ""; else delete next[record.id]; return next; }); resetVerification();
            }} /><span className="min-w-0 break-all"><strong>{record.serial || "Serial missing"}</strong> · {record.equipment} · WO {workOrderLabels[String(record.workOrderId)] ?? record.workOrderId}</span></label>)}
          {!matching.length && <p className="text-sm">No equipment awaiting customer handoff matches this location and search.</p>}
        </div>
        <div><Label htmlFor="handoff-verification">Serial verification</Label><select id="handoff-verification" className="h-10 w-full rounded-md border bg-background px-2" value={mode} onChange={event => { setMode(event.target.value as "visual" | "scan"); resetVerification(); }}>
          <option value="visual">Visually inspect recorded serials</option><option value="scan">Scan every serial</option></select>
          <p className="mt-1 text-xs text-muted-foreground">Changing the selection or verification method clears verification. Maximum 500 entries per handoff.</p></div>
        {mode === "visual" ? <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={inspected} onChange={event => setInspected(event.target.checked)} />I visually verified every selected equipment serial against its recorded serial.</label> :
          <div className="space-y-2"><Label htmlFor="handoff-scan">Scan equipment serial</Label><div className="flex gap-2"><Input id="handoff-scan" ref={scanRef} value={scan} autoComplete="off" onChange={event => setScan(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addScan(); } }} /><Button type="button" variant="outline" onClick={addScan}>Add scan</Button></div>
            <p role="status" className="text-sm">{scans.length} of {count} serials scanned</p>
            {!!scans.length && <details><summary>Verified scans</summary><ol className="max-h-32 overflow-y-auto text-sm">{scans.map(serial => <li key={serial} className="break-all">{serial}</li>)}</ol></details>}</div>}
        {stale && !pending && <p role="alert" className="text-sm text-destructive">Selected custody changed. Clear and reselect the current equipment before continuing.</p>}
        <div><Label htmlFor="batch-customer-recipient">Customer recipient / collected by</Label><Input id="batch-customer-recipient" maxLength={200} value={recipient} onChange={event => setRecipient(event.target.value)} /></div>
        <div><Label htmlFor="batch-customer-reference">Handoff / shipping reference (optional)</Label><Input id="batch-customer-reference" maxLength={200} value={reference} onChange={event => setReference(event.target.value)} /></div>
        <div><Label htmlFor="batch-handoff-notes">Handoff notes</Label><Input id="batch-handoff-notes" maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></div>
      </fieldset>
      <Button type="button" disabled={busy || (!pending && (!count || count > 500 || stale || !verified || !recipient.trim() || !notes.trim()))} onClick={() => void submit()}>
        {busy ? "Recording handoff…" : pending ? "Retry this handoff" : `Confirm customer handoff (${count})`}</Button>
      <details className="min-w-0 border-t pt-3"><summary className="cursor-pointer font-medium">Completed handoffs ({state.customerHandoffs?.length ?? 0})</summary>
        <Input className="my-2" aria-label="Find completed handoffs" placeholder="Find recipient, reference, serial or manifest" value={historySearch} onChange={event => { setHistorySearch(event.target.value); setHistoryLimit(20); }} />
        {history.slice(0, historyLimit).map(handoff => <div key={handoff.id} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b py-2 text-sm">
          <span className="min-w-0 break-words">{handoff.recipient} · {handoff.lines.length} entries · {inventoryDateTime(handoff.occurredAt, timezone)} · {handoff.verification === "scan" ? "Scanned" : "Visually inspected"}</span>
          <Button type="button" size="sm" variant="outline" aria-label={`Print manifest ${handoff.id}`} onClick={() => print(handoff.id)}>Print manifest</Button></div>)}
        {history.length > historyLimit && <Button type="button" variant="ghost" onClick={() => setHistoryLimit(value => value + 20)}>Show more handoffs</Button>}
      </details>
    </DialogContent>
  </Dialog>;
}
