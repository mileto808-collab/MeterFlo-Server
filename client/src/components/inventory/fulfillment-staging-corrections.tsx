import { useEffect, useMemo, useRef, useState } from "react";
import { useWizardStepFocus } from "@/hooks/useWizardStepFocus";
import { AlertTriangle, ArrowLeft, Check, RotateCcw, Search, ShieldCheck } from "lucide-react";
import { fulfillmentCorrectSchema, fulfillmentInvestigateSchema, type StagedIssue } from "@shared/inventory-staging-corrections";
import type { InventoryState } from "@shared/inventory";
import type { FulfillmentBatch } from "@shared/inventory-fulfillment";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SerialScanField, SerialScanProgress, serialTokens } from "./serial-scan-field";

type Command = (action: string, payload: Record<string, unknown>, onSuccess: () => void, onError: (error: Error) => void) => void;
type Batch = FulfillmentBatch & { issues?: StagedIssue[]; pickupReady?: boolean };
type CountLine = { itemId: string; quantity: number; serials: string[] };
type Saved = {
  batchId: string; revision: number | null; step: "identify" | "verify" | "review"; edited: boolean;
  mode: "recording" | "exchange" | "missing"; reason: string; ready: boolean;
  returnItem: string;
  confirmed: boolean; sourceVerified: boolean; quantities: Record<string, string>; serials: Record<string, string>;
  returns: Record<string, string>; returnSerials: Record<string, string>;
  pending: { operationId: string; action: "fulfillmentCorrect" | "fulfillmentInvestigate"; data: Record<string, unknown> } | null;
  investigation: { issueId: string; outcome: "found" | "written_off" | ""; warehouseId: string } | null;
};
const fresh = (batchId = ""): Saved => ({ batchId, revision: null, step: "identify", edited: false, mode: "recording", reason: "", ready: false, returnItem: "", confirmed: false, sourceVerified: false, quantities: {}, serials: {}, returns: {}, returnSerials: {}, pending: null, investigation: null });
const tokens = serialTokens;
const unique = (values: string[]) => new Set(values).size === values.length;
function parseCommandError(error: Error) {
  const raw = error.message || "Command outcome is unknown.";
  const status = Number(raw.match(/^\s*(\d{3}):/)?.[1] ?? 0);
  const body = raw.replace(/^\s*\d{3}:\s*/, "");
  let message = body;
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown; details?: unknown };
    const candidate = parsed.message ?? parsed.error ?? parsed.details;
    if (typeof candidate === "string") message = candidate;
  } catch { /* Keep the server's plain-text message. */ }
  return { status, message: message || raw, stale: status === 409 && /batch changed|revision changed|refresh and review|revision conflict/i.test(message) };
}

export function FulfillmentStagingCorrections({ projectId, userId, storageKey, state, batches, activeBatchId, blockedBatchIds = [], canCorrect, onCommand, onBack }: {
  projectId: number; userId: string; storageKey: string; state: InventoryState; batches: Batch[]; activeBatchId?: string;
  blockedBatchIds?: string[]; canCorrect: boolean; onCommand: Command; onBack: () => void;
}) {
  const key = `meterflo:staging-corrections:${encodeURIComponent(userId)}:${projectId}`;
  const [saved, setSaved] = useState<Saved>(() => fresh());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("");
  const [remoteRevision, setRemoteRevision] = useState<number | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [queuedBatchId, setQueuedBatchId] = useState("");
  const [queuedIssueId, setQueuedIssueId] = useState("");
  const initializedSelection = useRef(false);
  const focusRoot = useRef<HTMLDivElement>(null);
  const focusBody = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    focusBody.current = focusRoot.current?.closest<HTMLDivElement>('[data-testid="fulfillment-step-body"]') ?? null;
  }, [ready, canCorrect]);
  useWizardStepFocus({
    open: true, ready: ready && canCorrect && !saving,
    stepKey: `${saved.batchId}:${saved.step}:${saved.investigation?.issueId ?? ""}`,
    rootRef: focusRoot, bodyRef: focusBody,
    chooseTarget: root => root.querySelector<HTMLElement>(saved.step === "verify"
      ? saved.reason.trim().length < 10 ? 'textarea:not(:disabled)' : 'input[type="checkbox"]:not(:checked)'
      : saved.step === "review"
        ? 'input[type="checkbox"]:not(:checked)'
        : 'textarea:not(:disabled),input[type="number"]:not(:disabled),[role="combobox"]:not(:disabled),h3'),
  });
  const active = batches.find(batch => batch.id === saved.batchId);
  const retrying = !!saved.pending;
  const revisionCurrent = !!active && saved.revision !== null && active.revision === saved.revision;
  const items = state.items.filter(item => item.kind !== "labor");
  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const waitingLines = useMemo(() => {
    if (!active) return [];
    const byItem = new Map<string, { quantity: number; serials: string[] }>();
    for (const row of active.lines) {
      const current = byItem.get(row.itemId) ?? { quantity: 0, serials: [] };
      current.quantity += row.stagedQuantity - row.deliveredQuantity;
      current.serials.push(...row.stagedSerials.filter(serial => !row.deliveredSerials.includes(serial)));
      byItem.set(row.itemId, current);
    }
    return [...byItem].map(([itemId, value]) => ({ itemId, ...value, planned: active.lines.filter(line => line.itemId === itemId)
      .reduce((sum, line) => sum + line.quantity - line.deliveredQuantity, 0), item: itemById.get(itemId) }))
      .sort((a, b) => (a.item?.name ?? a.itemId).localeCompare(b.item?.name ?? b.itemId));
  }, [active, itemById]);
  const correctionCandidates = batches.filter(batch => batch.status === "active" &&
    (blockedBatchIds.includes(batch.id) || batch.lines.some(line => line.stagedQuantity > line.deliveredQuantity) || batch.issues?.some(issue => issue.status === "open")));
  const investigations = batches.flatMap(batch => (batch.issues ?? []).filter(issue => issue.status === "investigating" && issue.category === "missing")
    .map(issue => ({ batch, issue })));
  const physicalLocations = state.warehouses.filter(location => location.active && location.type === "physical");

  useEffect(() => {
    try {
      const value = window.localStorage.getItem(key);
      if (value) setSaved({ ...fresh(), ...(JSON.parse(value) as Partial<Saved>) });
    } catch { setError("Saved correction inputs could not be read. Nothing was sent."); }
    setReady(true);
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    try {
      if (saved.edited || saved.pending || saved.investigation) window.localStorage.setItem(key, JSON.stringify(saved));
      else window.localStorage.removeItem(key);
    } catch { setError("Browser storage is unavailable. Corrections are disabled until this exact command can be saved."); }
  }, [saved, ready, key]);
  useEffect(() => {
    if (!active) return;
    const expectedRevision = saved.pending?.data.revision ?? saved.revision;
    if (expectedRevision !== null && expectedRevision !== undefined && active.revision !== Number(expectedRevision))
      setRemoteRevision(active.revision);
    else if (remoteRevision !== null && active.revision !== remoteRevision) setRemoteRevision(active.revision);
  }, [active?.revision, saved.pending, remoteRevision]);
  useEffect(() => {
    if (!ready || initializedSelection.current) return;
    initializedSelection.current = true;
    if (activeBatchId && !saved.batchId) chooseBatch(activeBatchId);
  }, [ready, activeBatchId, saved.batchId]);

  const update = (changes: Partial<Saved>, meaningful = true) => setSaved(current => {
    const evidenceChanged = ["mode", "quantities", "serials", "returns", "returnSerials", "returnItem"].some(key => key in changes);
    return { ...current, ...changes, ...(evidenceChanged ? { sourceVerified: false, confirmed: false } : {}),
      edited: meaningful ? true : changes.edited ?? current.edited };
  });
  const handleCommandError = (error: Error) => {
    setSaving(false);
    const parsed = parseCommandError(error);
    if (parsed.status >= 400 && parsed.status < 500 && parsed.status !== 403) update({ pending: null });
    if (parsed.stale) setRemoteRevision(active?.revision ?? null);
    setError(`${parsed.message} Your captured inputs are retained. ${parsed.stale
      ? "Compare the refreshed waiting-stock snapshot and explicitly review its revision before continuing."
      : parsed.status >= 400 && parsed.status < 500
        ? "Correct the rejected fields or restore access before preparing a new command."
        : "If the outcome is unknown, retry the exact saved command; do not start another correction."}`);
  };
  const chooseBatch = (id: string) => {
    const found = batches.find(batch => batch.id === id);
    if (!found) return;
    const next = fresh(id);
    next.revision = found.revision;
    for (const line of found.lines) {
      const waiting = line.stagedQuantity - line.deliveredQuantity;
      next.quantities[line.itemId] = String((Number(next.quantities[line.itemId]) || 0) + waiting);
      next.serials[line.itemId] = [...tokens(next.serials[line.itemId] ?? ""), ...line.stagedSerials.filter(serial => !line.deliveredSerials.includes(serial))].join("\n");
    }
    update(next, false); setError(""); setNotice(""); setRemoteRevision(null);
  };
  const requestBatch = (id: string) => {
    if (retrying) return;
    if (saved.edited) { setQueuedBatchId(id); setQueuedIssueId(""); setDiscardOpen(true); }
    else chooseBatch(id);
  };
  const requestInvestigation = (batchId: string, issueId: string) => {
    if (retrying) return;
    if (saved.edited) { setQueuedBatchId(batchId); setQueuedIssueId(issueId); setDiscardOpen(true); return; }
    beginInvestigation(batchId, issueId);
  };
  const beginInvestigation = (batchId: string, issueId: string) => {
    const batch = batches.find(entry => entry.id === batchId);
    if (!batch) return;
    update({ ...fresh(batchId), revision: batch.revision, investigation: { issueId, outcome: "", warehouseId: "" } });
    setError("");
  };
  const requestDiscard = () => {
    if (saved.pending || saving) return;
    if (saved.edited) setDiscardOpen(true);
    else update(fresh(), false);
  };
  const discardDraft = () => {
    update(fresh(), false); setDiscardOpen(false); setError(""); setNotice(""); setRemoteRevision(null);
    const nextBatch = queuedBatchId;
    setQueuedBatchId("");
    const issueId = queuedIssueId;
    setQueuedBatchId(""); setQueuedIssueId("");
    if (nextBatch && issueId) beginInvestigation(nextBatch, issueId);
    else if (nextBatch) chooseBatch(nextBatch);
  };
  const linesFor = (returns = false): CountLine[] => returns
    ? Object.entries(saved.returns).filter(([, quantity]) => Number(quantity) > 0).map(([itemId, quantity]) => ({
      itemId, quantity: Number(quantity), serials: itemById.get(itemId)?.tracking === "serialized" ? tokens(saved.returnSerials[itemId] ?? "") : [],
    }))
    : waitingLines.map(row => ({
      itemId: row.itemId, quantity: Number(saved.quantities[row.itemId] ?? "0"),
      serials: row.item?.tracking === "serialized" ? tokens(saved.serials[row.itemId] ?? "") : [],
    }));
  const validLines = (lines: CountLine[], returns = false) => lines.every(line => {
    const item = itemById.get(line.itemId);
    const row = waitingLines.find(entry => entry.itemId === line.itemId);
    const sourceStock = state.stock.filter(stock => stock.warehouseId === active?.sourceId && stock.itemId === line.itemId);
    const availableAtSource = sourceStock.reduce((sum, stock) => sum + stock.quantity, 0);
    const sourceSerials = sourceStock.flatMap(stock => stock.serials);
    return !!item && Number.isInteger(line.quantity) && line.quantity >= (returns ? 1 : 0) &&
      line.quantity <= (returns ? availableAtSource : row?.planned ?? 0) &&
      (item.tracking === "serialized" ? line.serials.length === line.quantity && unique(line.serials) &&
        (!returns || line.serials.every(serial => sourceSerials.includes(serial))) : line.serials.length === 0);
  }) && unique(lines.flatMap(line => line.serials));
  const blockedSerialsFor = (itemId: string, returned = false) => {
    const selectedElsewhere = returned
      ? Object.entries(saved.returnSerials).filter(([id]) => id !== itemId).flatMap(([, serials]) => tokens(serials))
      : Object.entries(saved.serials).filter(([id]) => id !== itemId).flatMap(([, serials]) => tokens(serials));
    const staged = waitingLines.filter(line => returned || line.itemId !== itemId).flatMap(line => line.serials);
    if (!returned) return [...staged, ...selectedElsewhere];
    return [...staged, ...selectedElsewhere];
  };
  const changeExists = () => {
    const after = linesFor();
    const before = waitingLines.map(row => ({ itemId: row.itemId, quantity: row.quantity, serials: row.serials }));
    return JSON.stringify(after) !== JSON.stringify(before) ||
      saved.mode === "exchange" && linesFor(true).some(line => line.quantity > 0) ||
      saved.mode === "recording" && !!active?.issues?.some(issue => issue.status === "open");
  };
  const missingOnlyRemoves = () => waitingLines.every(row => {
    const item = itemById.get(row.itemId);
    if (item?.tracking === "serialized") return tokens(saved.serials[row.itemId] ?? "").every(serial => row.serials.includes(serial));
    return Number(saved.quantities[row.itemId] ?? "0") <= row.quantity;
  });
  const validIdentify = !!active && revisionCurrent && validLines(linesFor()) && validLines(linesFor(true), true) &&
    changeExists() && (saved.mode !== "missing" || missingOnlyRemoves());
  const makeCorrection = () => {
    if (!active || !canCorrect || !ready || !storageKey || !saved.confirmed || !saved.sourceVerified ||
      !revisionCurrent || saved.reason.trim().length < 10 ||
      !validLines(linesFor()) || !validLines(linesFor(true), true) || !changeExists()) return;
    const data = fulfillmentCorrectSchema.parse({
      id: active.id, revision: saved.revision, mode: saved.mode, reason: saved.reason.trim(),
      lines: linesFor(), observedReturns: saved.mode === "exchange" ? linesFor(true).filter(line => line.quantity > 0) : [],
      confirmed: true, sourceVerified: true, ready: saved.ready,
    });
    const pending = { operationId: crypto.randomUUID(), action: "fulfillmentCorrect" as const, data };
    try { window.localStorage.setItem(key, JSON.stringify({ ...saved, pending })); }
    catch { setError("Could not persist the exact correction identity. Nothing was sent."); return; }
    update({ pending });
    window.setTimeout(() => {
      setSaving(true); setError("");
      onCommand(pending.action, { operationId: pending.operationId, ...pending.data },
        () => { setSaving(false); update(fresh(), false); setNotice("Correction recorded. Review the refreshed batch before another movement."); },
        handleCommandError);
    }, 0);
  };
  const retry = () => {
    if (!saved.pending || saving) return;
    setSaving(true); setError("");
    onCommand(saved.pending.action, { operationId: saved.pending.operationId, ...saved.pending.data },
      () => { setSaving(false); update(fresh(), false); setNotice("Saved command completed."); },
      handleCommandError);
  };
  const sendInvestigation = () => {
    const action = saved.investigation;
    if (!active || !action || !action.outcome || !saved.confirmed || !revisionCurrent ||
      saved.reason.trim().length < 10 || !canCorrect) return;
    const warehouseId = action.outcome === "found" ? action.warehouseId : undefined;
    if (action.outcome === "found" && !warehouseId) return;
    const data = fulfillmentInvestigateSchema.parse({ id: active.id, revision: saved.revision, issueId: action.issueId,
      outcome: action.outcome, ...(warehouseId ? { warehouseId } : {}), reason: saved.reason.trim(), confirmed: true });
    const pending = { operationId: crypto.randomUUID(), action: "fulfillmentInvestigate" as const, data };
    try { window.localStorage.setItem(key, JSON.stringify({ ...saved, pending })); }
    catch { setError("Could not persist the exact investigation identity. Nothing was sent."); return; }
    update({ pending });
    window.setTimeout(() => {
      setSaving(true);
      onCommand(pending.action, { operationId: pending.operationId, ...data },
        () => { setSaving(false); update(fresh(), false); setNotice("Investigation resolved."); },
        handleCommandError);
    }, 0);
  };
  const matching = correctionCandidates.filter(batch => !filter || `${batch.name} ${batch.id}`.toLowerCase().includes(filter.toLowerCase()));
  const refreshReviewedRevision = () => {
    if (!active || retrying || remoteRevision === null) return;
    update({ revision: active.revision, confirmed: false, sourceVerified: false, step: "verify" });
    setRemoteRevision(null); setError("");
  };
  if (!canCorrect && !saved.pending) return <div className="space-y-4" data-testid="fulfillment-corrections">
    <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button><h3 className="text-lg font-semibold">Staging corrections</h3></div>
    <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Correction access required</AlertTitle><AlertDescription>Corrections and investigations need fulfillment access plus inventory exception, maintenance, or configuration permission. Pickup reports do not require warehouse access.</AlertDescription></Alert>
    {saved.pending && <Alert><AlertTitle>Saved command awaits confirmation</AlertTitle><AlertDescription className="space-y-2"><p>The exact payload and retry identity are retained. Restore correction permissions before retrying.</p><Button data-testid="staging-correction-retry" disabled onClick={retry}>Retry exact saved command</Button></AlertDescription></Alert>}
  </div>;
  return <div ref={focusRoot} role="region" aria-label="Pickup corrections" className="min-w-0 max-w-full space-y-4 break-words" data-testid="fulfillment-corrections">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><Button variant="outline" size="sm" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button><div><h3 className="text-lg font-semibold">Pickup corrections</h3><p className="text-sm text-muted-foreground">Review stock still waiting at staging. Delivered units stay out of this count.</p></div></div>
      {active && <Button variant="ghost" size="sm" onClick={requestDiscard} disabled={!!saved.pending || saving} className="max-w-full whitespace-normal break-words">Choose another</Button>}
    </header>
    {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Needs attention</AlertTitle><AlertDescription className="space-y-2"><p>{error}</p>{retrying && <Button size="sm" variant="outline" onClick={retry} disabled={saving}><RotateCcw className="mr-2 h-4 w-4" />Retry exact saved command</Button>}</AlertDescription></Alert>}
    {saved.pending && <Alert data-testid="staging-correction-pending"><AlertTitle>Command outcome needs confirmation</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-2"><span>This exact operation remains saved across refresh. Do not replace its inputs until its outcome is known.</span><Button data-testid="staging-correction-retry" className="max-w-full whitespace-normal break-words" onClick={retry} disabled={saving || !canCorrect}><RotateCcw className="mr-2 h-4 w-4 shrink-0" />{saving ? "Checking…" : "Retry exact saved command"}</Button></AlertDescription></Alert>}
    {remoteRevision !== null && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Batch changed remotely</AlertTitle><AlertDescription className="space-y-2"><p>Your saved inputs have not been cleared. Compare the refreshed “Before” counts and serials with your captures before accepting the new revision. The next command stays blocked until you explicitly review this snapshot.</p><Button size="sm" variant="outline" disabled={retrying} onClick={refreshReviewedRevision}>Accept revision {remoteRevision} for explicit review · keep captures</Button></AlertDescription></Alert>}
    {notice && <Alert><Check className="h-4 w-4" /><AlertDescription>{notice}</AlertDescription></Alert>}
    {!active ? <div className="space-y-4">
      <div className="flex items-center gap-2"><Search className="h-4 w-4 text-muted-foreground" /><Input aria-label="Filter batches" placeholder="Find a batch" value={filter} onChange={event => setFilter(event.target.value)} /></div>
      <div className="rounded-xl border">
        <div className="border-b px-4 py-3"><p className="font-semibold">Blocked and review batches</p><p className="text-sm text-muted-foreground">Active batches blocked from resuming, with waiting stock, or unresolved pickup reports.</p></div>
        <div className="divide-y">{matching.length ? matching.map(batch => <button type="button" key={batch.id} data-testid={`staging-correction-batch-${batch.id}`} disabled={retrying} onClick={() => requestBatch(batch.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50">
          <span><span className="font-medium">{batch.name}</span><span className="ml-2 text-sm text-muted-foreground">{batch.lines.length} planned lines</span></span><span className="flex gap-2">{batch.issues?.some(issue => issue.status === "open") && <Badge variant="destructive">Pickup needs review</Badge>}<Badge variant="outline">{batch.status}</Badge></span>
        </button>) : <p className="px-4 py-6 text-center text-sm text-muted-foreground">No active batches need staging review.</p>}</div>
      </div>
      <div className="rounded-xl border">
        <div className="border-b px-4 py-3"><p className="font-semibold">Investigate missing stock</p><p className="text-sm text-muted-foreground">Includes missing-stock cases from completed batches. A recovery never assigns stock to the old batch.</p></div>
        <div className="divide-y">{investigations.length ? investigations.map(({ batch, issue }) => <div key={issue.id} className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{batch.name} · {itemById.get(issue.itemId)?.name ?? "Catalog item unavailable"}</p><p className="text-sm text-muted-foreground">{issue.quantity ?? 0} units · {issue.description}</p></div><Badge variant="outline">Investigating</Badge></div>
          <Button type="button" variant="outline" disabled={retrying} onClick={() => requestInvestigation(batch.id, issue.id)}>Investigate this missing stock</Button>
        </div>) : <p className="px-4 py-6 text-center text-sm text-muted-foreground">No outstanding missing-stock investigations.</p>}</div>
      </div>
    </div> : saved.investigation ? <div className="space-y-4">
      <div className="rounded-lg border bg-muted/20 p-3"><p className="font-semibold">{active?.name}</p><p className="text-sm text-muted-foreground">Missing-stock investigation · no assignment to the original batch</p></div>
      {(() => {
        const issue = active?.issues?.find(entry => entry.id === saved.investigation?.issueId);
        return <div className="space-y-3 rounded-lg border p-4">
          <div><p className="font-medium">{issue ? itemById.get(issue.itemId)?.name ?? "Catalog item unavailable" : "Missing stock"} · {issue?.quantity ?? 0} units</p><p className="text-sm text-muted-foreground">{issue?.description}</p></div>
          <div className="grid grid-cols-3 gap-1 text-center text-xs sm:gap-2">{(["identify", "verify", "review"] as const).map((step, index) => <div key={step} className={`rounded-md border px-2 py-2 ${saved.step === step ? "border-primary bg-primary/5 font-semibold" : ""}`}><span className="block text-muted-foreground">0{index + 1}</span>{step === "identify" ? "Identify" : step === "verify" ? "Verify" : "Review & confirm"}</div>)}</div>
          {saved.step === "identify" && <>
            <div><Label>Investigation outcome</Label><Select value={saved.investigation!.outcome} disabled={retrying || !revisionCurrent} onValueChange={(outcome: "found" | "written_off") => update({ investigation: { ...saved.investigation!, outcome, warehouseId: "" }, confirmed: false })}><SelectTrigger aria-label="Investigation outcome"><SelectValue placeholder="Choose outcome" /></SelectTrigger><SelectContent><SelectItem value="found">Found — recover stock</SelectItem><SelectItem value="written_off">Written off — add no stock</SelectItem></SelectContent></Select></div>
            <div className="flex flex-wrap justify-end gap-2"><Button data-testid="staging-investigation-back" variant="outline" disabled={retrying || saving} onClick={requestDiscard}>Back to investigations</Button><Button data-testid="staging-investigation-identify-next" className="max-w-full whitespace-normal break-words" onClick={() => update({ step: "verify" })} disabled={retrying || !saved.investigation!.outcome}>Continue to verification</Button></div>
          </>}
          {saved.step === "verify" && <>
            {saved.investigation!.outcome === "found" && <div><Label>Verified physical recovery warehouse</Label><Select value={saved.investigation!.warehouseId} disabled={retrying || !revisionCurrent} onValueChange={warehouseId => update({ investigation: { ...saved.investigation!, warehouseId } })}><SelectTrigger aria-label="Verified physical warehouse"><SelectValue placeholder="Choose physical warehouse" /></SelectTrigger><SelectContent>{physicalLocations.map(location => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent></Select></div>}
            <div><Label htmlFor="investigation-reason">Reason · minimum 10 characters</Label><Textarea id="investigation-reason" data-testid="staging-investigation-reason" value={saved.reason} disabled={retrying || !revisionCurrent} onChange={event => update({ reason: event.target.value })} placeholder="Document the physical search or accounting decision." /></div>
            <Alert><AlertTitle>Recovery is separate from fulfillment</AlertTitle><AlertDescription>Found stock returns to the selected physical warehouse only. It is not assigned to the old batch. Written off records no stock addition.</AlertDescription></Alert>
            <div className="flex flex-wrap justify-between gap-2"><Button data-testid="staging-investigation-verify-back" variant="outline" onClick={() => update({ step: "identify" })} disabled={retrying}>Back to identify</Button><Button data-testid="staging-investigation-verify-next" className="max-w-full whitespace-normal break-words" onClick={() => update({ step: "review", confirmed: false })} disabled={retrying || saved.reason.trim().length < 10 || (saved.investigation!.outcome === "found" && !saved.investigation!.warehouseId) || !revisionCurrent}>Continue to review</Button></div>
          </>}
          {saved.step === "review" && <>
            <div className="rounded-md border bg-muted/30 p-3 text-sm"><p><strong>Outcome:</strong> {saved.investigation!.outcome === "found" ? "Found and recovered" : "Written off — no stock added"}</p>{saved.investigation!.outcome === "found" && <p><strong>Warehouse:</strong> {physicalLocations.find(location => location.id === saved.investigation!.warehouseId)?.name ?? "Not selected"}</p>}<p><strong>Reason:</strong> {saved.reason}</p><p className="mt-2 text-muted-foreground">Recovery restores only the exact missing issue stock to the verified warehouse. It is not allocated to this batch.</p></div>
            <label className="flex items-start gap-2 text-sm"><input data-testid="staging-investigation-confirmed" type="checkbox" checked={saved.confirmed} disabled={retrying || !revisionCurrent} onChange={event => update({ confirmed: event.target.checked })} className="mt-1 shrink-0" />I verified the physical location or accounting outcome and confirm the disposition above.</label>
            <div className="flex flex-wrap justify-between gap-2"><Button data-testid="staging-investigation-review-back" variant="outline" onClick={() => update({ step: "verify", confirmed: false })} disabled={retrying}>Back to verification</Button>{!retrying && <Button data-testid="staging-investigation-submit" className="max-w-full whitespace-normal break-words" onClick={sendInvestigation} disabled={!canCorrect || !saved.confirmed || !revisionCurrent || saving}>Confirm resolution</Button>}</div>
          </>}
        </div>;
      })()}
    </div> : <div className="space-y-4">
      <div className="rounded-lg border bg-muted/20 p-3"><p className="font-semibold">{active.name}</p><p className="text-sm text-muted-foreground">Reviewed revision {saved.revision ?? "—"} · Current revision {active.revision} · {active.lines.length} planned rows · delivered quantities excluded</p></div>
      {active.issues?.filter(issue => issue.status === "open").map(issue => <Alert key={issue.id} className="border-amber-500/40 bg-amber-500/5"><AlertTriangle className="h-4 w-4" /><AlertTitle>Pickup needs review · {issue.category.replace("_", " ")}</AlertTitle><AlertDescription>{itemById.get(issue.itemId)?.name ?? "Catalog item unavailable"}: {issue.description}</AlertDescription></Alert>)}
      <div className="grid grid-cols-3 gap-1 text-center text-xs sm:gap-2" aria-label={`Correction step: ${saved.step}`}>
        {(["identify", "verify", "review"] as const).map((step, index) => <div key={step} className={`rounded-md border px-2 py-2 ${saved.step === step ? "border-primary bg-primary/5 font-semibold" : ""}`}><span className="block text-muted-foreground">0{index + 1}</span>{step === "identify" ? "Identify" : step === "verify" ? "Verify" : "Review & confirm"}</div>)}
      </div>
      {saved.step === "identify" && <>
        <div className="flex flex-wrap gap-2">
          {(["recording", "exchange", "missing"] as const).map(mode => <Button key={mode} type="button" variant={saved.mode === mode ? "default" : "outline"} className="max-w-full whitespace-normal break-words" onClick={() => update({ mode, confirmed: false })} disabled={retrying || !revisionCurrent}>{mode === "recording" ? "Recording only" : mode === "exchange" ? "Physical exchange" : "Missing stock"}</Button>)}
        </div>
        <p className="text-sm text-muted-foreground">{saved.mode === "recording" ? "No physical movement is claimed. Removed units are verified at source; replacement units are already at staging." : saved.mode === "exchange" ? "Use only after the physical exchange is complete. Optional returned items are evidence only, never a second stock credit." : "Remove only unlocated units. No replacements can be added in missing mode."}</p>
        <div className="space-y-3">
          <div className="hidden grid-cols-[minmax(0,1fr)_repeat(3,minmax(5rem,0.7fr))] gap-3 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:grid"><span>Required item</span><span>Before</span><span>After</span><span>Planned cap</span></div>
          {waitingLines.map(row => {
            const item = row.item;
            const afterQty = Number(saved.quantities[row.itemId] ?? "0");
            const max = row.planned;
            return <div key={row.itemId} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(5rem,0.7fr))] sm:items-start">
              <div className="min-w-0"><p className="font-medium">{item?.name ?? "Catalog item unavailable"}</p><p className="break-all font-mono text-xs text-muted-foreground">{item?.sku ?? "Unavailable SKU"} · {item?.unit ?? "units"}</p>
                {item?.tracking === "serialized" && <div className="mt-2"><Label htmlFor={`serial-${row.itemId}`} className="text-xs">After serials · scan or paste</Label>
                  <SerialScanField id={`serial-${row.itemId}`} data-testid={`staging-correction-serials-${row.itemId}`} rows={2}
                    value={saved.serials[row.itemId] ?? ""} expected={Number.isSafeInteger(afterQty) && afterQty >= 0 ? afterQty : null}
                    blockedSerials={blockedSerialsFor(row.itemId)} disabled={retrying || !revisionCurrent}
                    onChange={value => update({ serials: { ...saved.serials, [row.itemId]: value } })}
                    placeholder="Scan one serial per unit" />
                </div>}
              </div>
              <div className="text-sm sm:pt-2"><span className="text-muted-foreground sm:hidden">Before waiting: </span><span className="font-mono">{row.quantity}</span>{item?.tracking === "serialized" && <p className="mt-1 break-all text-xs text-muted-foreground">{row.serials.join(", ") || "No serials"}</p>}</div>
              <div><Label className="text-xs text-muted-foreground sm:hidden">After count</Label><Input data-testid={`staging-correction-quantity-${row.itemId}`} type="number" min="0" max={max} step="1" inputMode="numeric" aria-label={`${item?.name ?? "Item"} after quantity`} value={saved.quantities[row.itemId] ?? "0"} disabled={retrying || !revisionCurrent} onChange={event => update({ quantities: { ...saved.quantities, [row.itemId]: event.target.value } })} /></div>
              <div className="text-sm text-muted-foreground sm:pt-2"><span className="sm:hidden">Maximum: </span><span className="font-mono">{max}</span></div>
              <p className={`sm:col-span-4 text-xs ${afterQty > max ? "text-destructive" : "text-muted-foreground"}`}>After: {afterQty} of {max} required waiting units. SKU substitutions are not permitted.</p>
            </div>;
          })}
        </div>
        {saved.mode === "exchange" && <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
          <Label>Unexpected item already returned to original source (optional)</Label>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <Select value={saved.returnItem} disabled={retrying || !revisionCurrent} onValueChange={value => update({ returnItem: value, returns: { ...saved.returns, [value]: saved.returns[value] ?? "" } })}>
              <SelectTrigger aria-label="Unexpected returned item"><SelectValue placeholder="Choose returned catalog item" /></SelectTrigger>
              <SelectContent>{items.filter(item => item.active && !waitingLines.some(line => line.itemId === item.id)).map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent>
            </Select>
            {saved.returnItem && <Input data-testid="staging-correction-return-quantity" type="number" min="0" max={state.stock.filter(stock => stock.warehouseId === active.sourceId && stock.itemId === saved.returnItem).reduce((sum, stock) => sum + stock.quantity, 0)} step="1" inputMode="numeric" aria-label="Returned quantity" placeholder="Quantity at source" value={saved.returns[saved.returnItem] ?? ""} disabled={retrying || !revisionCurrent} onChange={event => update({ returns: { ...saved.returns, [saved.returnItem]: event.target.value } })} />}
          </div>
          {saved.returnItem && itemById.get(saved.returnItem)?.tracking === "serialized" && <div><Label htmlFor="observed-return-serials">Returned serials already at original source</Label><SerialScanField id="observed-return-serials" data-testid="staging-correction-return-serials" rows={2}
            value={saved.returnSerials[saved.returnItem] ?? ""} expected={Number(saved.returns[saved.returnItem] ?? "")}
            blockedSerials={blockedSerialsFor(saved.returnItem, true)} disabled={retrying || !revisionCurrent}
            onChange={value => update({ returnSerials: { ...saved.returnSerials, [saved.returnItem]: value } })} placeholder="Scan returned serials" />
            <p className="text-xs text-muted-foreground">Returned serials must already be present at the original source. Evidence only; no second credit.</p></div>}
          {Object.entries(saved.returns).filter(([, quantity]) => Number(quantity) > 0).map(([itemId, quantity]) => <p key={itemId} className="text-sm">{itemById.get(itemId)?.sku ?? "Unavailable SKU"}: {quantity} already present at source (evidence only)</p>)}
        </div>}
        {saved.mode === "missing" && <Alert><AlertTitle>Missing stock is not a return</AlertTitle><AlertDescription>Only unlocated units can be removed. This creates an investigation; add replacements separately with a physical exchange.</AlertDescription></Alert>}
        <div className="flex flex-wrap justify-end gap-2"><Button data-testid="staging-correction-identify-next" className="max-w-full whitespace-normal break-words" onClick={() => update({ step: "verify" })} disabled={!validIdentify || retrying}>Continue to verification</Button></div>
      </>}
      {saved.step === "verify" && <div className="space-y-4">
        <div><Label htmlFor="correction-reason">Reason · minimum 10 characters</Label><Textarea id="correction-reason" data-testid="staging-correction-reason" value={saved.reason} disabled={retrying || !revisionCurrent} onChange={event => update({ reason: event.target.value })} placeholder="Describe what was verified and why this count changes." /></div>
        <label className="flex items-start gap-2 text-sm"><input data-testid="staging-correction-source-verified" type="checkbox" checked={saved.sourceVerified} disabled={retrying || !revisionCurrent} onChange={event => update({ sourceVerified: event.target.checked })} className="mt-1 shrink-0" />I verified source custody: recording removals are physically at source and replacements at staging. Missing units were not located and receive no source credit. For an exchange, the final stock and any observed return are physically verified.</label>
        {saved.mode === "exchange" && <Alert><AlertTitle>No double stock credit</AlertTitle><AlertDescription>Unexpected returned stock is documented only if already physically present at the original source. It is not credited again.</AlertDescription></Alert>}
        <div className="flex flex-wrap justify-between gap-2"><Button data-testid="staging-correction-verify-back" variant="outline" onClick={() => update({ step: "identify" })} disabled={retrying}>Back to identify</Button><Button data-testid="staging-correction-verify-next" className="max-w-full whitespace-normal break-words" onClick={() => update({ step: "review", confirmed: false })} disabled={retrying || saved.reason.trim().length < 10 || !saved.sourceVerified || !validIdentify}>Continue to review</Button></div>
      </div>}
      {saved.step === "review" && <div className="space-y-4">
        <div className="rounded-lg border p-3">
          <p className="font-semibold">Before / after · reviewed revision {saved.revision}</p>
          <div className="mt-2 divide-y">{waitingLines.map(row => <div key={row.itemId} className="py-2 text-sm"><p className="break-words font-medium">{row.item?.sku ?? "Unavailable SKU"}: <span className="font-mono">{row.quantity} → {saved.quantities[row.itemId] ?? "0"} / cap {row.planned}</span></p>
            {row.item?.tracking === "serialized" && <p className="break-all text-xs text-muted-foreground">Before: {row.serials.join(", ") || "none"} · After: {tokens(saved.serials[row.itemId] ?? "").join(", ") || "none"}</p>}
          </div>)}</div>
          {saved.mode === "exchange" && Object.entries(saved.returns).filter(([, quantity]) => Number(quantity) > 0).map(([itemId, quantity]) => <p key={itemId} className="mt-2 break-words text-sm">Observed return evidence: {itemById.get(itemId)?.sku ?? "Unavailable SKU"} · {quantity} already at source, no stock credit.</p>)}
        </div>
        <label className="flex items-start gap-2 text-sm"><input data-testid="staging-correction-confirmed" type="checkbox" checked={saved.confirmed} disabled={retrying || !revisionCurrent} onChange={event => update({ confirmed: event.target.checked })} className="mt-1 shrink-0" />I reviewed every planned item once, the before/after quantities and serials, and confirm this correction matches physical and accounting evidence.</label>
        <label className="flex items-start gap-2 text-sm"><input data-testid="staging-correction-ready" type="checkbox" checked={saved.ready} disabled={retrying || !revisionCurrent} onChange={event => update({ ready: event.target.checked })} className="mt-1 shrink-0" />Mark pickup ready after correction</label>
        <div className="flex flex-wrap justify-between gap-2 border-t pt-3"><Button data-testid="staging-correction-review-back" variant="outline" onClick={() => update({ step: "verify", confirmed: false })} disabled={retrying}>Back to verification</Button>
          <Button data-testid="staging-correction-submit" className="max-w-full whitespace-normal break-words" onClick={makeCorrection} disabled={!canCorrect || !revisionCurrent || !saved.confirmed || !saved.sourceVerified || saved.reason.trim().length < 10 || !validLines(linesFor()) || !validLines(linesFor(true), true) || !changeExists() || saving}>
            <Check className="mr-2 h-4 w-4 shrink-0" />Confirm and record correction
          </Button>
        </div>
      </div>}
    </div>}
    <AlertDialog open={discardOpen} onOpenChange={open => {
      setDiscardOpen(open);
      if (!open) { setQueuedBatchId(""); setQueuedIssueId(""); }
    }}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-lg">
        <AlertDialogHeader><AlertDialogTitle>Replace captured correction inputs?</AlertDialogTitle>
          <AlertDialogDescription>Changing batches or returning to the issue list will discard the saved counts, scans, reason, and confirmations. No inventory command has been sent. Cancel to keep this draft.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter className="flex-wrap"><AlertDialogCancel disabled={retrying || saving}>Keep captures</AlertDialogCancel><AlertDialogAction disabled={retrying || saving} onClick={discardDraft}>Discard and continue</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
