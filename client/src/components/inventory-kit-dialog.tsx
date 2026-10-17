import { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryItem, InventoryState, StockLine } from "@shared/inventory";
import { kitAssemblyOptions, kitAvailable, kitDisassemblyContents, remainingKitHold } from "@shared/inventory-kits";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, PackageCheck, ScanLine, Trash2 } from "lucide-react";

type Mode = "assemble" | "disassemble" | "inspect";
type Props = { state: InventoryState; projectId: string; mode: Mode; canResolve: boolean; onClose: () => void; onSaved: () => Promise<unknown>; onDirtyChange?: (dirty: boolean) => void; onOperationPending?: (pending: boolean) => void };
type RecoveryDraft = { usable: string; damaged: string; missing: string; usableSerials: string[]; damagedSerials: string[]; missingSerials: string[]; reason: string };
type HoldSelection = { quantity: string; serials: string[] };
type InspectionHold = {
  id: string; assemblyId: string; receiptId: string; itemId: string; warehouseId: string;
  quantity: number; serials: string[]; reason: string; status: "held" | "released" | "scrapped" | "resolved";
  actor: string; occurredAt: string;
  resolution?: { operationId: string; actor: string; occurredAt: string; reason: string };
  dispositions?: { operationId: string; actor: string; occurredAt: string; reason: string; outcome: "released" | "scrapped"; quantity: number; serials: string[] }[];
};
const newId = () => crypto.randomUUID();
const validCount = (value: string, minimum = 0) => value.trim() !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= minimum && Number(value) <= 1_000_000;
const unique = (values: string[]) => new Set(values).size === values.length;
const phone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px), (pointer: coarse)").matches;
const blankRecovery = (line: StockLine): RecoveryDraft => ({ usable: String(line.quantity), damaged: "0", missing: "0", usableSerials: [], damagedSerials: [], missingSerials: [], reason: "" });
const SERIAL_PAGE_SIZE = 40;
const kitRelevantFingerprint = (state: InventoryState, mode: Mode, warehouseId: string, itemId: string, assemblyId: string) => {
  if (mode === "inspect") return JSON.stringify(state.kitHolds ?? []);
  if (!warehouseId || !itemId) return "";
  const item = state.items.find(value => value.id === itemId);
  const itemIds = new Set([itemId, ...(item?.components.map(component => component.itemId) ?? [])]);
  const stock = state.stock.filter(line => line.warehouseId === warehouseId && itemIds.has(line.itemId));
  const allocations = state.allocations.filter(value => value.status === "reserved").map(value => ({
    workOrderId: value.workOrderId, revision: value.revision,
    lines: value.lines.filter(line => line.warehouseId === warehouseId && itemIds.has(line.itemId)),
  })).filter(value => value.lines.length);
  const assemblies = (state.kitAssemblies ?? []).filter(value => value.itemId === itemId &&
    value.warehouseId === warehouseId && (!assemblyId || value.id === assemblyId));
  const assemblyIds = new Set(assemblies.map(value => value.id));
  const holds = (state.kitHolds ?? []).filter(value => value.warehouseId === warehouseId &&
    (value.itemId === itemId || assemblyIds.has(value.assemblyId)));
  const provenanceReceipts = state.receipts.filter(receipt => receipt.action === "assemble" &&
    receipt.warehouseId === warehouseId && receipt.lines.some(line => line.itemId === itemId));
  return JSON.stringify({ item, stock, allocations, assemblies, holds, provenanceReceipts });
};

function MissingSerialPicker({ serials, missing, recovered, disabled, onToggle }: {
  serials: string[]; missing: string[]; recovered: string[]; disabled: boolean; onToggle: (serial: string, checked: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const matches = serials.filter(serial => serial.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(matches.length / SERIAL_PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const visible = matches.slice(current * SERIAL_PAGE_SIZE, (current + 1) * SERIAL_PAGE_SIZE);
  return <div className="space-y-1 rounded border p-2">
    <p className="text-xs font-medium">Known original references · mark only identities not recovered</p>
    <Input className="h-8 font-mono text-xs" aria-label="Search original component serial references" value={search} placeholder="Search known serials" onChange={event => { setSearch(event.target.value); setPage(0); }} />
    <div className="max-h-36 overflow-auto rounded border px-2">
      {visible.map(serial => {
        const hasRecoveryScan = recovered.includes(serial);
        const isMissing = missing.includes(serial);
        return <label key={serial} className="flex min-h-8 items-center gap-2 border-b py-1 last:border-0"><input type="checkbox" checked={isMissing} disabled={disabled || hasRecoveryScan} onChange={event => onToggle(serial, event.target.checked)} /><span className="break-all font-mono text-xs">{serial}</span><span className="ml-auto shrink-0 text-xs text-muted-foreground">{hasRecoveryScan ? "scanned" : isMissing ? "missing" : "not classified"}</span></label>;
      })}
      {!visible.length && <p className="p-2 text-xs text-muted-foreground">No matching original serials.</p>}
    </div>
    <div className="flex items-center justify-between text-xs"><span>{matches.length} identities · page {current + 1} of {pages}</span><div className="flex gap-1"><Button type="button" size="icon" variant="outline" className="h-7 w-7" aria-label="Previous original serial page" disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft className="h-4 w-4" /></Button><Button type="button" size="icon" variant="outline" className="h-7 w-7" aria-label="Next original serial page" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}><ChevronRight className="h-4 w-4" /></Button></div></div>
  </div>;
}

function SerialScanner({ label, serials, target, disabled, onAdd, onRemove, onPending, allowedSerials, takenSerials }: {
  label: string; serials: string[]; target: number; disabled: boolean; onAdd: (serial: string) => void; onRemove: (index: number) => void; onPending: (value: boolean) => void;
  allowedSerials?: string[]; takenSerials?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const commit = () => {
    const serial = value.trim();
    if (!serial) return;
    if (allowedSerials && !allowedSerials.includes(serial)) { setError(`${serial} is not in the recorded identity set.`); return; }
    if (serials.includes(serial) || takenSerials?.includes(serial)) { setError(`${serial} is already committed in this set.`); return; }
    if (serials.length >= target) { setError("The required serial count is complete."); return; }
    onAdd(serial); setValue(""); setError(""); onPending(false);
  };
  useEffect(() => {
    if (open && !phone()) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);
  return <section className="space-y-2 rounded-md border p-2.5">
    <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-medium">{label}</h4><Badge variant={serials.length === target ? "default" : "outline"} className="font-mono tabular-nums">{serials.length}/{target}</Badge></div>
    <Button type="button" size="sm" variant="outline" disabled={disabled || serials.length >= target} onClick={() => { setError(""); setOpen(true); }}><ScanLine className="mr-2 h-4 w-4" />Scan serials</Button>
    {!!serials.length && <ul className="max-h-24 space-y-1 overflow-auto rounded border bg-muted/20 p-2" aria-label={`${label} committed serials`}>
      {serials.slice(-50).map((serial, index) => { const sourceIndex = serials.length - Math.min(serials.length, 50) + index; return <li key={`${serial}-${sourceIndex}`} className="flex items-center justify-between gap-2 font-mono text-xs"><span className="break-all">{sourceIndex + 1}. {serial}</span><button type="button" disabled={disabled} aria-label={`Remove serial ${serial}`} className="rounded p-1 hover:bg-muted" onClick={() => onRemove(sourceIndex)}><Trash2 className="h-3.5 w-3.5" /></button></li>; })}
    </ul>}
    <Dialog open={open} onOpenChange={next => { if (!next && value.trim()) { setError("Commit this scan or explicitly discard it before closing."); return; } if (!next) setOpen(false); }}>
      <DialogContent className="flex max-h-[min(88dvh,580px)] w-[calc(100vw-1rem)] max-w-lg flex-col gap-3 p-4 sm:p-6" onOpenAutoFocus={event => { event.preventDefault(); if (!phone()) requestAnimationFrame(() => inputRef.current?.focus()); }} onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); if (value.trim()) setError("Commit this scan or explicitly discard it before closing."); else setOpen(false); }} onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>{label} scanner</DialogTitle><DialogDescription>Scan one identity at a time. Enter or Tab commits the current scan; uncommitted text is not counted.</DialogDescription></DialogHeader>
        <p className="rounded border bg-muted/30 p-2 font-mono text-sm tabular-nums" aria-live="polite">{serials.length} of {target} committed</p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Label htmlFor="inventory-kit-serial" className="sr-only">{label} serial</Label>
        <Input ref={inputRef} id="inventory-kit-serial" className="h-12 font-mono" autoComplete="off" maxLength={100} value={value} placeholder="Tap to scan or type serial" onChange={event => { setValue(event.target.value); setError(""); onPending(!!event.target.value); }} onKeyDown={event => {
          if ((event.key === "Enter" || event.key === "Tab") && event.currentTarget.value.trim()) { event.preventDefault(); commit(); }
        }} />
        <div className="min-h-0 flex-1 overflow-auto rounded border"><p className="sticky top-0 border-b bg-background px-2 py-1 text-xs text-muted-foreground">Recent scans</p><ol className="space-y-1 p-2 font-mono text-xs">{serials.slice(-40).map((serial, index) => <li key={`${serial}-${index}`}>{serials.length - Math.min(40, serials.length) + index + 1}. {serial}</li>)}</ol></div>
        <DialogFooter className="flex-wrap"><Button type="button" variant="outline" disabled={!value.trim()} onClick={commit}><Check className="mr-2 h-4 w-4" />Commit scan</Button>{value.trim() && <Button type="button" variant="destructive" onClick={() => { setValue(""); setError(""); onPending(false); setOpen(false); }}>Discard uncommitted</Button>}<Button type="button" disabled={!!value.trim()} onClick={() => setOpen(false)}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}

export function InventoryKitDialog({ state, projectId, mode, canResolve, onClose, onSaved, onDirtyChange, onOperationPending }: Props) {
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [kitSerials, setKitSerials] = useState<string[]>([]);
  const [componentSerials, setComponentSerials] = useState<Record<string, string[]>>({});
  const [assemblyId, setAssemblyId] = useState("");
  const [recovery, setRecovery] = useState<Record<string, RecoveryDraft>>({});
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [scannerPending, setScannerPending] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [holdSelections, setHoldSelections] = useState<Record<string, HoldSelection>>({});
  const [operationNotice, setOperationNotice] = useState("");
  const [refreshWarning, setRefreshWarning] = useState("");
  const [pendingFieldChange, setPendingFieldChange] = useState<{ field: "warehouse" | "item" | "assembly" | "quantity"; value: string } | null>(null);
  const [attempt, setAttempt] = useState<{ fingerprint: string; operationId: string; payload: Record<string, unknown>; action: string } | null>(null);
  const busyRef = useRef(false);
  const relevantFingerprint = kitRelevantFingerprint(state, mode, warehouseId, itemId, assemblyId);
  const acceptedFingerprint = useRef(relevantFingerprint);
  const [externalChange, setExternalChange] = useState(false);
  useEffect(() => {
    if (relevantFingerprint === acceptedFingerprint.current) return;
    if (busyRef.current || attempt) {
      acceptedFingerprint.current = relevantFingerprint;
      return;
    }
    setExternalChange(true);
  }, [relevantFingerprint, attempt]);
  const items = useMemo(() => state.items.filter(item => item.active && item.components.length > 0), [state.items]);
  const selectedItem = items.find(item => item.id === itemId);
  const locations = state.warehouses.filter(location => location.active);
  const available = warehouseId && itemId ? kitAvailable(state, warehouseId, itemId) : 0;
  const reservedSerialsFor = (targetWarehouse: string, targetItem: string) => state.allocations
    .filter(allocation => allocation.status === "reserved").flatMap(allocation => allocation.lines)
    .filter(line => line.warehouseId === targetWarehouse && line.itemId === targetItem).flatMap(line => line.serials);
  const options = useMemo(() => warehouseId && itemId ? kitAssemblyOptions(state, warehouseId, itemId) : [], [state, warehouseId, itemId]);
  const source = options.find(option => option.assemblyId === assemblyId);
  const contents = useMemo(() => {
    if (mode !== "disassemble" || !source || !validCount(quantity, 1)) return [];
    try { return kitDisassemblyContents(state, assemblyId, Number(quantity), kitSerials); } catch { return []; }
  }, [mode, state, source, assemblyId, quantity, kitSerials]);
  const isDirty = scannerPending || !!(warehouseId || itemId || assemblyId || reason || holdReason || kitSerials.length ||
    Object.values(componentSerials).some(values => values.length) || Object.keys(recovery).length || quantity !== "1") ||
    Object.values(holdSelections).some(value => value.quantity !== "" || value.serials.length > 0);
  useEffect(() => { onDirtyChange?.(isDirty); }, [isDirty, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); onOperationPending?.(false); }, [onDirtyChange, onOperationPending]);
  const serialsDuplicated = !unique(kitSerials) || Object.values(componentSerials).some(values => !unique(values)) ||
    Object.values(recovery).some(value => !unique([...value.usableSerials, ...value.damagedSerials, ...value.missingSerials]));
  const capturedDraft = scannerPending || !!reason || !!holdReason || kitSerials.length > 0 ||
    Object.values(componentSerials).some(values => values.length > 0) || Object.keys(recovery).length > 0 ||
    Object.values(holdSelections).some(value => value.quantity !== "" || value.serials.length > 0);
  const setRecoveryLine = (line: StockLine, patch: Partial<RecoveryDraft>) => setRecovery(current => ({
    ...current, [line.itemId]: { ...(current[line.itemId] ?? recoveryFor(line)), ...patch },
  }));
  const recoveryFor = (line: StockLine) => {
    const saved = recovery[line.itemId];
    if (saved) return saved;
    const item = state.items.find(value => value.id === line.itemId);
    return item?.tracking === "serialized" ? { ...blankRecovery(line), usable: "0", damaged: "0", missing: "0", usableSerials: [] } : blankRecovery(line);
  };

  const applyFieldChange = (change: NonNullable<typeof pendingFieldChange>) => {
    setPendingFieldChange(null);
    const nextWarehouse = change.field === "warehouse" ? change.value : warehouseId;
    const nextItem = change.field === "item" ? change.value : itemId;
    const nextAssembly = change.field === "warehouse" || change.field === "item" ? "" :
      change.field === "assembly" ? change.value : assemblyId;
    if (change.field === "warehouse") { setWarehouseId(change.value); setAssemblyId(""); }
    if (change.field === "item") { setItemId(change.value); setAssemblyId(""); }
    if (change.field === "assembly") setAssemblyId(change.value);
    if (change.field === "quantity") setQuantity(change.value);
    setKitSerials([]); setComponentSerials({}); setRecovery({}); setReason(""); setHoldReason(""); setScannerPending(false);
    setReviewing(false); setError(""); setRefreshWarning(""); setOperationNotice("");
    acceptedFingerprint.current = kitRelevantFingerprint(state, mode, nextWarehouse, nextItem, nextAssembly);
    setExternalChange(false);
  };
  const requestFieldChange = (field: "warehouse" | "item" | "assembly" | "quantity", value: string) => {
    const current = field === "warehouse" ? warehouseId : field === "item" ? itemId : field === "assembly" ? assemblyId : quantity;
    if (value === current) return;
    const change = { field, value };
    if (capturedDraft) setPendingFieldChange(change);
    else applyFieldChange(change);
  };

  const makePayload = (): Record<string, unknown> => {
    if (externalChange) throw new Error("Inventory changed elsewhere. Recheck current availability before reviewing this operation.");
    if (scannerPending) throw new Error("Commit or explicitly discard uncommitted scanner text before reviewing this operation.");
    if (!warehouseId) throw new Error("Choose a stock location.");
    if (!validCount(quantity, 1)) throw new Error("Quantity must be a whole number from 1 to 1,000,000.");
    if (serialsDuplicated) throw new Error("A serial is duplicated within its item custody.");
    if (mode === "assemble") {
      if (!selectedItem) throw new Error("Choose a defined kit.");
      const components = selectedItem.components.map(recipe => {
        const item = state.items.find(value => value.id === recipe.itemId);
        if (!item) throw new Error("A kit component is missing from the catalog.");
        const required = recipe.quantity * Number(quantity);
        const stock = state.stock.find(line => line.itemId === item.id && line.warehouseId === warehouseId);
        const availableQuantity = kitAvailable(state, warehouseId, item.id);
        const reservedSerials = reservedSerialsFor(warehouseId, item.id);
        const scans = componentSerials[item.id] ?? [];
        if (availableQuantity < required) throw new Error(`${item.name}: ${availableQuantity} unreserved available; ${required} required.`);
        if (item.tracking === "serialized" && (scans.length !== required || !unique(scans) || !scans.every(serial => stock?.serials.includes(serial) && !reservedSerials.includes(serial)))) throw new Error(`${item.name}: scan exactly ${required} unreserved serials held at this location.`);
        if (item.tracking !== "serialized" && scans.length) throw new Error(`${item.name} is quantity tracked and must not have serial scans.`);
        return { itemId: item.id, quantity: required, serials: item.tracking === "serialized" ? scans : [] };
      });
      if (selectedItem.tracking === "serialized" && kitSerials.length !== Number(quantity)) throw new Error(`Scan exactly ${quantity} finished kit serials.`);
      if (selectedItem.tracking !== "serialized" && kitSerials.length) throw new Error("This kit is quantity tracked; remove finished serial scans.");
      return { warehouseId, itemId, quantity: Number(quantity), serials: selectedItem.tracking === "serialized" ? kitSerials : [], components };
    }
    if (!source) throw new Error("Choose trusted recorded assembly provenance. Externally supplied or ambiguous legacy kits cannot be disassembled.");
    if (source.availableQuantity < Number(quantity)) throw new Error(`Only ${source.availableQuantity} kits from this assembly are available here.`);
    if (!contents.length) throw new Error("Original component provenance is unavailable for this assembly quantity.");
    if (selectedItem?.tracking === "serialized" && kitSerials.length !== Number(quantity)) throw new Error(`Scan exactly ${quantity} source kit serials.`);
    if (!reason.trim()) throw new Error("Enter the disassembly reason.");
    const components = contents.map(line => {
      const item = state.items.find(value => value.id === line.itemId);
      if (!item) throw new Error("An original component is missing from the catalog.");
      const result = recoveryFor(line);
      if (![result.usable, result.damaged, result.missing].every(value => validCount(value))) throw new Error(`${item.name}: dispositions must be whole numbers.`);
      const usableQuantity = Number(result.usable), damagedQuantity = Number(result.damaged), missingQuantity = Number(result.missing);
      if (usableQuantity + damagedQuantity + missingQuantity !== line.quantity) throw new Error(`${item.name}: usable, damaged and missing must total ${line.quantity}.`);
      if (item.tracking === "serialized") {
        const serials = [...result.usableSerials, ...result.damagedSerials, ...result.missingSerials];
        if (serials.length !== line.quantity || !unique(serials) || !serials.every(serial => line.serials.includes(serial))) throw new Error(`${item.name}: scan and partition every original serial exactly once.`);
        if (result.usableSerials.length !== usableQuantity || result.damagedSerials.length !== damagedQuantity || result.missingSerials.length !== missingQuantity) throw new Error(`${item.name}: serial counts must match each disposition quantity.`);
      }
      if ((damagedQuantity || missingQuantity) && !result.reason.trim()) throw new Error(`${item.name}: enter a reason for damaged or missing components.`);
      return { itemId: line.itemId, usableQuantity, damagedQuantity, missingQuantity, usableSerials: result.usableSerials,
        damagedSerials: result.damagedSerials, missingSerials: result.missingSerials, reason: result.reason.trim() };
    });
    return { warehouseId, assemblyId, quantity: Number(quantity), serials: selectedItem?.tracking === "serialized" ? kitSerials : [], components, reason: reason.trim() };
  };

  const post = async (action: string, payload: Record<string, unknown>, closeOnReceipt = true) => {
    if (busyRef.current || refreshWarning) return;
    const fingerprint = JSON.stringify({ action, payload });
    const selected = attempt?.fingerprint === fingerprint ? attempt : { fingerprint, operationId: newId(), payload, action };
    setAttempt(selected); onOperationPending?.(true); busyRef.current = true; setBusy(true); setError(""); setRefreshWarning(""); setOperationNotice("");
    try {
      const response = await fetch(`/api/projects/${projectId}/inventory/commands`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: selected.operationId, action, data: selected.payload }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        // A later permission/validation rejection cannot prove an earlier unknown
        // attempt did not commit. Keep that attempt locked until receipt confirmation.
        const definitiveRejection = !attempt && [400, 403, 409].includes(response.status);
        if (definitiveRejection) {
          setAttempt(null);
          onOperationPending?.(false);
        }
        const rejection = body?.message ?? body?.error ?? `Command rejected (HTTP ${response.status}).`;
        throw new Error(definitiveRejection ? rejection : `${rejection} Outcome may be unknown; retry reuses the same operation identity.`);
      }
      const result = await response.json().catch(() => null);
      const confirmed = result?.receipt?.id === selected.operationId ||
        result?.state?.receipts?.some((receipt: { id?: string }) => receipt.id === selected.operationId);
      if (!confirmed) throw new Error("No receipt confirmed this operation. Retry the unchanged operation; do not submit a new one.");
      setAttempt(null);
      onOperationPending?.(false);
      if (action === "resolveKitHold") {
        const resolvedId = String(selected.payload.id ?? "");
        setHoldSelections(current => { const next = { ...current }; delete next[resolvedId]; return next; });
        setHoldReason("");
      }
      try {
        const refreshed = await onSaved() as { isError?: boolean; data?: { state?: InventoryState } };
        if (refreshed?.isError) throw new Error("Refresh request failed.");
        acceptedFingerprint.current = kitRelevantFingerprint(refreshed.data?.state ?? state, mode, warehouseId, itemId, assemblyId);
        setExternalChange(false);
        if (closeOnReceipt) { onDirtyChange?.(false); onClose(); }
        else setOperationNotice("Inspection hold resolution receipt confirmed.");
      } catch {
        setRefreshWarning("Receipt confirmed. Inventory refresh failed; retry refresh or close and verify the ledger before starting another conversion.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Outcome unknown. Retry with the same operation identity.");
    } finally { busyRef.current = false; setBusy(false); }
  };
  const review = () => { setError(""); try { makePayload(); setReviewing(true); } catch (cause) { setError(cause instanceof Error ? cause.message : "Check required fields."); } };
  const submit = () => {
    try { void post(mode === "assemble" ? "assemble" : "disassemble", attempt?.payload ?? makePayload()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Check required fields."); setReviewing(false); }
  };
  const close = () => { if (busyRef.current || attempt) return; if (refreshWarning) { onDirtyChange?.(false); onClose(); } else if (isDirty) setDiscardOpen(true); else onClose(); };
  const retryRefresh = async () => {
    setBusy(true); setError("");
    try {
      const refreshed = await onSaved() as { isError?: boolean; data?: { state?: InventoryState } };
      if (refreshed?.isError) throw new Error("Refresh request failed.");
      acceptedFingerprint.current = kitRelevantFingerprint(refreshed.data?.state ?? state, mode, warehouseId, itemId, assemblyId);
      setExternalChange(false);
      setRefreshWarning("");
      if (mode !== "inspect") { onDirtyChange?.(false); onClose(); }
    } catch { setRefreshWarning("Receipt confirmed. Inventory refresh still failed; close and verify the ledger before continuing."); }
    finally { setBusy(false); }
  };
  const resolveHold = (hold: InspectionHold, outcome: "released" | "scrapped", remainingQuantity: number, remainingSerials: string[]) => {
    if (refreshWarning) return;
    const product = state.items.find(item => item.id === hold.itemId);
    const selection = holdSelections[hold.id] ?? { quantity: "", serials: [] };
    if (!holdReason.trim()) { setError("Enter an inspection resolution reason."); return; }
    if (product?.tracking === "serialized") {
      if (remainingSerials.length !== remainingQuantity) {
        setError("This hold does not have a complete known serial set. No unidentified or missing serials can be selected.");
        return;
      }
      const serials = selection.serials.filter(serial => remainingSerials.includes(serial));
      if (!serials.length) { setError("Select at least one known remaining serial."); return; }
      void post("resolveKitHold", { id: hold.id, outcome, reason: holdReason.trim(), quantity: serials.length, serials }, false);
      return;
    }
    if (!validCount(selection.quantity, 1) || Number(selection.quantity) > remainingQuantity) {
      setError(`Select a whole quantity from 1 to ${remainingQuantity}.`);
      return;
    }
    void post("resolveKitHold", { id: hold.id, outcome, reason: holdReason.trim(), quantity: Number(selection.quantity), serials: [] }, false);
  };
  const holds = mode !== "assemble" ? ((state.kitHolds ?? []) as unknown as InspectionHold[]).filter(hold =>
    mode === "inspect" || (hold.status === "held" && (!assemblyId || hold.assemblyId === assemblyId))) : [];

  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="flex max-h-[min(94dvh,860px)] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-3 overflow-hidden p-3 sm:p-6" onOpenAutoFocus={event => event.preventDefault()} onEscapeKeyDown={event => { event.preventDefault(); close(); }} onPointerDownOutside={event => event.preventDefault()}>
      <DialogHeader className="shrink-0 text-left"><DialogTitle>{mode === "assemble" ? "Assemble kit" : mode === "inspect" ? "Kit batch inspection" : "Disassemble kit"}</DialogTitle><DialogDescription>{mode === "assemble" ? "Scan exact component custody and finished kit identity." : mode === "inspect" ? "Review damaged recovered components and resolve held stock." : "Use trusted assembly provenance and account for every original component."}</DialogDescription></DialogHeader>
      {externalChange && !attempt && <Alert data-testid="inventory-external-change">
        <AlertTriangle className="h-4 w-4" /><AlertTitle>Inventory changed elsewhere</AlertTitle>
        <AlertDescription className="space-y-2"><span>Your scans and dispositions are retained. Review the refreshed stock and custody before continuing; stale conversion or hold commands are paused.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => { acceptedFingerprint.current = relevantFingerprint; setExternalChange(false); setReviewing(false); setError(""); }}>Recheck current availability</Button>
        </AlertDescription>
      </Alert>}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {holds.length > 0 && <section className="min-w-0 space-y-2 rounded-md border border-amber-500/40 bg-amber-50/40 p-3 dark:bg-amber-950/10" aria-label="Kit component inspection holds">
          <div><h3 className="font-medium">Kit inspection · component custody</h3><p className="text-xs text-muted-foreground">Select only known components still held. Each decision is recorded as an append-only inspection event.</p></div>
          {canResolve && holds.some(hold => hold.status === "held") && <div className="space-y-1"><Label htmlFor="kit-hold-reason">Inspection resolution reason</Label><Input id="kit-hold-reason" aria-label="Inspection resolution reason" value={holdReason} disabled={busy || !!attempt} onChange={event => { setHoldReason(event.target.value); setError(""); }} placeholder="Required audit reason" maxLength={1000} /></div>}
          {holds.map(hold => {
            let remaining: { quantity: number; serials: string[] };
            try { remaining = remainingKitHold(hold as Parameters<typeof remainingKitHold>[0]); }
            catch { remaining = { quantity: hold.status === "held" ? hold.quantity : 0, serials: hold.status === "held" ? hold.serials : [] }; }
            const product = state.items.find(item => item.id === hold.itemId);
            const location = state.warehouses.find(value => value.id === hold.warehouseId);
            const assembly = state.kitAssemblies?.find(value => value.id === hold.assemblyId);
            const assemblyItem = assembly ? state.items.find(value => value.id === assembly.itemId) : undefined;
            const assemblyReceipt = state.receipts.find(receipt => receipt.id === hold.assemblyId);
            const assemblyNumber = assemblyReceipt ? `#${state.receipts.indexOf(assemblyReceipt) + 1}` : hold.assemblyId.slice(0, 12);
            const selection = holdSelections[hold.id] ?? { quantity: "", serials: [] };
            const open = hold.status === "held" && remaining.quantity > 0;
            const history = hold.dispositions?.length ? hold.dispositions : hold.resolution ? [{
              ...hold.resolution, outcome: hold.status === "scrapped" ? "scrapped" as const : "released" as const,
              quantity: hold.quantity, serials: hold.serials,
            }] : [];
            return <article key={hold.id} className="min-w-0 space-y-2 rounded border bg-background p-2 text-sm">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1"><p className="break-words font-medium">{product?.sku} · {product?.name ?? hold.itemId}</p>
                  <p className="text-xs text-muted-foreground">Original quantity <span className="font-mono">{hold.quantity}</span> · Remaining held <span className="font-mono">{remaining.quantity}</span></p>
                  <p className="break-words text-xs text-muted-foreground">{location?.code} · {location?.name ?? hold.warehouseId} · From {assemblyItem?.sku} {assemblyItem?.name ?? "source kit"} · Assembly {assemblyNumber}{assembly ? ` · ${assembly.occurredAt.slice(0, 10)}` : ""}</p>
                  <p className="mt-1 break-words text-xs">{hold.reason}</p><p className="break-all font-mono text-[11px] text-muted-foreground">{hold.id}</p>
                </div>
                <Badge variant={open ? "outline" : "secondary"}>{remaining.quantity === hold.quantity && open ? "Held" : remaining.quantity ? "Partially resolved" : "Resolved"}</Badge>
              </div>
              {open && canResolve && !refreshWarning && <div className="min-w-0 space-y-2 rounded-md border border-dashed p-2">
                {product?.tracking === "serialized" ? <fieldset className="min-w-0 space-y-1">
                  <legend className="text-xs font-medium">Select known remaining serials · {selection.serials.length} selected</legend>
                  {remaining.serials.length === remaining.quantity ? <div className="max-h-48 overflow-y-auto rounded border">
                    {remaining.serials.map(serial => {
                      const checked = selection.serials.includes(serial);
                      return <label key={serial} className="flex min-h-10 min-w-0 items-center gap-2 border-b px-2 py-1 last:border-0">
                        <input type="checkbox" className="h-4 w-4 shrink-0" aria-label={`Select serial ${serial} from hold ${hold.id}`} checked={checked} disabled={busy || !!attempt} onChange={event => {
                          setHoldSelections(current => ({ ...current, [hold.id]: { quantity: "", serials: event.target.checked ? [...selection.serials, serial] : selection.serials.filter(value => value !== serial) } }));
                          setError("");
                        }} />
                        <span className="min-w-0 break-all font-mono text-xs">{serial}</span>
                      </label>;
                    })}
                  </div> : <p role="alert" className="break-words text-xs text-destructive">Known serial custody is incomplete; no unidentified or missing serials may be selected.</p>}
                </fieldset> : <div className="max-w-xs space-y-1">
                  <Label htmlFor={`hold-quantity-${hold.id}`}>Quantity to decide (1–{remaining.quantity})</Label>
                  <Input id={`hold-quantity-${hold.id}`} aria-label={`Quantity to decide for hold ${hold.id}`} type="number" inputMode="numeric" min="1" max={remaining.quantity} step="1" value={selection.quantity} disabled={busy || !!attempt} onChange={event => { setHoldSelections(current => ({ ...current, [hold.id]: { ...selection, quantity: event.target.value } })); setError(""); }} />
                </div>}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" className="w-full" disabled={busy || !!attempt || !holdReason.trim() || (product?.tracking === "serialized" ? selection.serials.length === 0 || remaining.serials.length !== remaining.quantity : !validCount(selection.quantity, 1) || Number(selection.quantity) > remaining.quantity)} onClick={() => resolveHold(hold, "released", remaining.quantity, remaining.serials)}>Release selected to stock</Button>
                  <Button type="button" variant="destructive" className="w-full" disabled={busy || !!attempt || !holdReason.trim() || (product?.tracking === "serialized" ? selection.serials.length === 0 || remaining.serials.length !== remaining.quantity : !validCount(selection.quantity, 1) || Number(selection.quantity) > remaining.quantity)} onClick={() => resolveHold(hold, "scrapped", remaining.quantity, remaining.serials)}>Scrap selected</Button>
                </div>
              </div>}
              {open && !canResolve && <p className="text-xs text-muted-foreground">Resolution permission required.</p>}
              {!!history.length && <section className="min-w-0 rounded bg-muted/30 p-2" aria-label={`Resolution history for hold ${hold.id}`}>
                <h4 className="mb-1 text-xs font-semibold">Inspection history</h4>
                <ol className="space-y-2">
                  {history.map((entry, index) => <li key={`${entry.operationId}-${index}`} className="min-w-0 border-t pt-2 first:border-0 first:pt-0">
                    <p className="break-words text-xs"><strong>{entry.outcome === "released" ? "Released" : "Scrapped"}</strong> · {entry.quantity} · {new Date(entry.occurredAt).toLocaleString()} · {entry.actor}</p>
                    <p className="break-words text-xs text-muted-foreground">{entry.reason}</p>
                    {!!entry.serials.length && <p className="break-all font-mono text-[11px] text-muted-foreground" aria-label="Resolved serials">{entry.serials.join(", ")}</p>}
                    <p className="break-all font-mono text-[10px] text-muted-foreground">{entry.operationId}</p>
                  </li>)}
                </ol>
              </section>}
            </article>;
          })}
        </section>}
        {mode === "inspect" && holds.length === 0 && <div className="grid min-h-32 place-items-center rounded-md border border-dashed p-4 text-center"><div><h3 className="font-medium">No held kit components</h3><p className="text-sm text-muted-foreground">Damaged recovered components from kit batches will appear here.</p></div></div>}
        {mode !== "inspect" && !refreshWarning && (!reviewing ? <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="kit-location">Stock location</Label><select id="kit-location" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={warehouseId} disabled={busy || !!attempt} onChange={event => requestFieldChange("warehouse", event.target.value)}><option value="">Choose location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.code} · {location.name}</option>)}</select></div>
            <div className="space-y-1"><Label htmlFor="kit-item">Kit item</Label><select id="kit-item" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={itemId} disabled={busy || !!attempt} onChange={event => requestFieldChange("item", event.target.value)}><option value="">Choose kit</option>{items.map((item: InventoryItem) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></div>
          </div>
          {mode === "disassemble" && <div className="space-y-1"><Label htmlFor="kit-assembly">Recorded source assembly</Label><select id="kit-assembly" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={assemblyId} disabled={!warehouseId || !itemId || busy || !!attempt} onChange={event => requestFieldChange("assembly", event.target.value)}><option value="">Choose trusted assembly</option>{options.map(option => <option key={option.assemblyId} value={option.assemblyId}>{option.label} · {option.availableQuantity} available</option>)}</select><p className="text-xs text-muted-foreground">{options.length ? "Only available, recorded assembly provenance is listed." : "No trusted assembly available. Externally supplied or ambiguous legacy kits cannot be disassembled."}</p></div>}
          <div className="grid gap-2 sm:grid-cols-[minmax(10rem,1fr)_2fr] sm:items-end"><div className="space-y-1"><Label htmlFor="kit-quantity">Kit quantity</Label><Input id="kit-quantity" type="number" min="1" max="1000000" step="1" value={quantity} disabled={busy || !!attempt} onChange={event => requestFieldChange("quantity", event.target.value)} /></div>{mode === "assemble" && <p className="rounded border bg-muted/30 p-2 text-sm">Finished kits currently available: <span className="font-mono font-semibold">{available}</span></p>}</div>
          {mode === "assemble" && selectedItem && <section className="space-y-2 rounded-md border p-3"><div><h3 className="font-medium">Required components</h3><p className="text-xs text-muted-foreground">Required and available quantities are checked at the selected location.</p></div>
            {selectedItem.components.map(recipe => {
              const item = state.items.find(value => value.id === recipe.itemId);
              const required = recipe.quantity * (validCount(quantity, 1) ? Number(quantity) : 1);
              const componentAvailable = warehouseId ? kitAvailable(state, warehouseId, recipe.itemId) : 0;
              const stock = state.stock.find(line => line.itemId === recipe.itemId && line.warehouseId === warehouseId);
              if (!item) return <Alert key={recipe.itemId} variant="destructive"><AlertTitle>Component missing</AlertTitle><AlertDescription>Catalog item {recipe.itemId} is unavailable.</AlertDescription></Alert>;
              const reserved = reservedSerialsFor(warehouseId, item.id);
              return <div key={item.id} className="grid gap-2 rounded border p-2 sm:grid-cols-[1fr_1.5fr] sm:items-center"><div><p className="font-medium">{item.sku} · {item.name}</p><p className="text-xs text-muted-foreground">Required {required} · Unreserved available {componentAvailable}{item.tracking === "serialized" && reserved.length > 0 ? ` · ${reserved.length} serials reserved` : ""}</p></div>{item.tracking === "serialized" ? <SerialScanner label={item.name} serials={componentSerials[item.id] ?? []} target={required} disabled={busy || !!attempt} allowedSerials={stock?.serials ?? []} takenSerials={reserved} onPending={setScannerPending} onAdd={serial => setComponentSerials(current => ({ ...current, [item.id]: [...(current[item.id] ?? []), serial] }))} onRemove={index => setComponentSerials(current => ({ ...current, [item.id]: (current[item.id] ?? []).filter((_, i) => i !== index) }))} /> : <p className="text-sm text-muted-foreground">Quantity tracked</p>}</div>;
            })}
          </section>}
          {mode === "assemble" && selectedItem?.tracking === "serialized" && <SerialScanner label="Finished kit serials" serials={kitSerials} target={validCount(quantity, 1) ? Number(quantity) : 0} disabled={busy || !!attempt} onPending={setScannerPending} onAdd={serial => setKitSerials(current => [...current, serial])} onRemove={index => setKitSerials(current => current.filter((_, i) => i !== index))} />}
          {mode === "disassemble" && selectedItem?.tracking === "serialized" && source && <SerialScanner label="Source kit serials" serials={kitSerials} target={validCount(quantity, 1) ? Number(quantity) : 0} allowedSerials={source.serials} disabled={busy || !!attempt} onPending={setScannerPending} onAdd={serial => setKitSerials(current => [...current, serial])} onRemove={index => setKitSerials(current => current.filter((_, i) => i !== index))} />}
          {mode === "disassemble" && source && <section className="space-y-2 rounded-md border p-3"><h3 className="font-medium">Original component contents</h3>
            {contents.map(line => {
              const item = state.items.find(value => value.id === line.itemId);
              const draft = recoveryFor(line);
              return <div key={line.itemId} className="space-y-2 rounded border p-2"><div><p className="font-medium">{item?.sku} · {item?.name}</p><p className="text-xs text-muted-foreground">Original quantity {line.quantity}</p></div>
                {item?.tracking === "serialized" ? <fieldset className="space-y-2"><legend className="text-xs font-medium">Original serial custody · scan recovered identities</legend>
                  <p className="text-xs text-muted-foreground">Scanned usable + damaged: {draft.usableSerials.length + draft.damagedSerials.length} · marked missing: {draft.missingSerials.length} · total {line.serials.length}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <SerialScanner label={`${item.name} · usable recovered`} serials={draft.usableSerials} target={Math.max(0, line.serials.length - draft.damagedSerials.length - draft.missingSerials.length)} disabled={busy || !!attempt}
                      allowedSerials={line.serials} takenSerials={[...draft.damagedSerials, ...draft.missingSerials]} onPending={setScannerPending}
                      onAdd={serial => setRecoveryLine(line, { usableSerials: [...draft.usableSerials, serial], usable: String(draft.usableSerials.length + 1) })}
                      onRemove={index => setRecoveryLine(line, { usableSerials: draft.usableSerials.filter((_, i) => i !== index), usable: String(Math.max(0, draft.usableSerials.length - 1)) })} />
                    <SerialScanner label={`${item.name} · damaged recovered`} serials={draft.damagedSerials} target={Math.max(0, line.serials.length - draft.usableSerials.length - draft.missingSerials.length)} disabled={busy || !!attempt}
                      allowedSerials={line.serials} takenSerials={[...draft.usableSerials, ...draft.missingSerials]} onPending={setScannerPending}
                      onAdd={serial => setRecoveryLine(line, { damagedSerials: [...draft.damagedSerials, serial], damaged: String(draft.damagedSerials.length + 1) })}
                      onRemove={index => setRecoveryLine(line, { damagedSerials: draft.damagedSerials.filter((_, i) => i !== index), damaged: String(Math.max(0, draft.damagedSerials.length - 1)) })} />
                  </div>
                  <MissingSerialPicker serials={line.serials} missing={draft.missingSerials}
                    recovered={[...draft.usableSerials, ...draft.damagedSerials]} disabled={busy || !!attempt}
                    onToggle={(serial, checked) => {
                      const serials = checked ? [...draft.missingSerials, serial] : draft.missingSerials.filter(value => value !== serial);
                      setRecoveryLine(line, { missingSerials: serials, missing: String(serials.length) });
                    }} />
                  <div className="grid grid-cols-3 gap-2 text-xs"><p>Usable <strong className="font-mono">{draft.usableSerials.length}</strong></p><p>Damaged <strong className="font-mono">{draft.damagedSerials.length}</strong></p><p>Missing <strong className="font-mono">{draft.missingSerials.length}</strong></p></div>
                </fieldset> : <div className="grid grid-cols-3 gap-2">{(["usable", "damaged", "missing"] as const).map(key => <div key={key} className="space-y-1"><Label className="text-xs capitalize" htmlFor={`${line.itemId}-${key}`}>{key}</Label><Input id={`${line.itemId}-${key}`} type="number" min="0" max={line.quantity} step="1" disabled={busy || !!attempt} value={draft[key]} onChange={event => setRecoveryLine(line, { [key]: event.target.value })} /></div>)}</div>}
                {(Number(draft.damaged) > 0 || Number(draft.missing) > 0) && <div className="space-y-1"><Label htmlFor={`${line.itemId}-reason`}>Damage / shortage reason</Label><Input id={`${line.itemId}-reason`} disabled={busy || !!attempt} value={draft.reason} onChange={event => setRecoveryLine(line, { reason: event.target.value })} /></div>}
              </div>;
            })}
            <div className="space-y-1"><Label htmlFor="kit-disassembly-reason">Disassembly reason</Label><Textarea id="kit-disassembly-reason" maxLength={1000} disabled={busy || !!attempt} value={reason} onChange={event => setReason(event.target.value)} placeholder="Required audit note" /></div>
          </section>}
          {mode === "disassemble" && source && contents.length === 0 && <Alert><AlertTitle>Contents not available</AlertTitle><AlertDescription>Choose a valid quantity and scan the exact kit identities recorded in this assembly.</AlertDescription></Alert>}
        </> : <section className="space-y-3 rounded-md border p-3" aria-label="Kit operation review">
          <div className="flex items-center gap-2"><PackageCheck className="h-5 w-5" /><h3 className="font-semibold">Review stock directions</h3></div>
          <p className="text-sm">{mode === "assemble" ? "Component stock is consumed and finished kits are added." : "Finished kits are removed. Usable components return to stock; damaged components enter inspection hold; missing components are recorded as shortage."}</p>
          {mode === "assemble" ? <><p className="rounded border px-2 py-1 text-sm">{quantity} × {selectedItem?.name} → finished stock added</p>{selectedItem?.components.map(recipe => <p key={recipe.itemId} className="rounded border px-2 py-1 text-sm">{recipe.quantity * Number(quantity)} × {state.items.find(item => item.id === recipe.itemId)?.name ?? recipe.itemId} → consumed</p>)}</> :
            contents.map(line => { const result = recoveryFor(line); return <p key={line.itemId} className="rounded border px-2 py-1 text-sm">{state.items.find(item => item.id === line.itemId)?.name ?? line.itemId}: {result.usable} usable → stock · {result.damaged} damaged → hold · {result.missing} missing → shortage</p>; })}
          <p className="rounded border bg-muted/30 p-2 text-sm">Location: {locations.find(location => location.id === warehouseId)?.name} · Kits: {quantity}</p>
          {mode === "disassemble" && <p className="text-sm"><strong>Reason:</strong> {reason}</p>}
        </section>)}
        {refreshWarning && <Alert variant="destructive"><AlertTitle>Receipt confirmed; refresh needed</AlertTitle><AlertDescription>{refreshWarning}</AlertDescription></Alert>}
        {operationNotice && <p role="status" className="text-sm text-muted-foreground">{operationNotice}</p>}
        {error && <Alert variant="destructive" role="alert"><AlertTitle>Operation not confirmed</AlertTitle><AlertDescription>{error}{attempt && <span className="mt-1 block">Retry keeps operation <span className="font-mono">{attempt.operationId}</span> and its exact payload.</span>}</AlertDescription></Alert>}
      </div>
      <DialogFooter className="shrink-0 border-t pt-3 sm:justify-between">
        <Button type="button" variant="outline" disabled={busy || !!attempt} onClick={close}>Close</Button>
        {refreshWarning ? <div className="flex gap-2"><Button type="button" variant="outline" disabled={busy} onClick={() => void retryRefresh()}>Retry refresh</Button><Button type="button" disabled={busy} onClick={close}>Close</Button></div> :
        attempt?.action === "resolveKitHold" ? <Button type="button" disabled={busy} onClick={() => void post(attempt.action, attempt.payload, false)}>{busy ? "Submitting…" : "Retry hold resolution"}</Button> :
        mode === "inspect" ? null :
          reviewing ? <div className="flex gap-2"><Button type="button" variant="outline" disabled={busy || !!attempt} onClick={() => { setReviewing(false); setError(""); }}>Back to edit</Button><Button type="button" disabled={busy || (!attempt && !warehouseId)} onClick={submit}>{busy ? "Submitting…" : attempt ? "Retry same operation" : mode === "assemble" ? "Confirm assembly" : "Confirm disassembly"}</Button></div> :
            <Button type="button" disabled={busy || !!attempt || (mode === "disassemble" && !source)} onClick={review}>Review operation</Button>}
      </DialogFooter>
    </DialogContent>
    <Dialog open={!!pendingFieldChange} onOpenChange={open => { if (!open) setPendingFieldChange(null); }}>
      <DialogContent className="max-w-md" onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>Reset captured kit entries?</DialogTitle><DialogDescription>Changing the {pendingFieldChange?.field === "warehouse" ? "location" : pendingFieldChange?.field === "item" ? "kit item" : pendingFieldChange?.field === "assembly" ? "source assembly" : "quantity"} changes the required stock and serial identities. Existing scans, dispositions, and reasons will be cleared.</DialogDescription></DialogHeader>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setPendingFieldChange(null)}>Keep current selection</Button><Button type="button" variant="destructive" onClick={() => pendingFieldChange && applyFieldChange(pendingFieldChange)}>Clear entries and change</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
      <DialogContent className="max-w-md" onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>Discard kit operation draft?</DialogTitle><DialogDescription>Scans and dispositions have not been posted. Discard the local work and close?</DialogDescription></DialogHeader>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setDiscardOpen(false)}>Keep editing</Button><Button type="button" variant="destructive" disabled={!!attempt} onClick={() => { setDiscardOpen(false); onDirtyChange?.(false); onClose(); }}>Discard draft</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Dialog>;
}
