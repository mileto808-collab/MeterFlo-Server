import { AlertTriangle, Check, Printer, RefreshCw, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SerialScanField, serialTokens } from "@/components/inventory/serial-scan-field";
import { inventoryDateTime } from "@shared/inventory-date-time";
import type { SavedVehicleReturnDraft, VehicleReturnCapture, VehicleReturnKind, VehicleReturnEvidence } from "@shared/inventory-vehicle-returns";
import type { ReturnEquipment, VehicleReturnLine, VehicleReturnStep, WorkflowData } from "@/components/inventory/vehicle-return-workflow-types";

type Props = {
  kind: VehicleReturnKind;
  step: VehicleReturnStep;
  restoreReady: boolean;
  capture: VehicleReturnCapture;
  draft: SavedVehicleReturnDraft | null;
  data: WorkflowData | undefined;
  sourceVehicle: WorkflowData["vehicles"][number] | undefined;
  destinations: WorkflowData["destinations"];
  items: WorkflowData["items"];
  selectedEquipment: ReturnEquipment[];
  equipmentGroups: Array<[string, ReturnEquipment[]]>;
  selectedLines: VehicleReturnLine[];
  vehicleStockItemIds: string[];
  scope: "selected" | "all";
  addItemId: string;
  physicallyConfirmed: boolean;
  prepared: boolean;
  receiptId: string;
  receiptEvidence: Pick<VehicleReturnEvidence, "needsReview" | "countId"> | null;
  message: string;
  syncError: string;
  conflictDraft: SavedVehicleReturnDraft | null;
  queryError: boolean;
  canKeepLocalSeparate: boolean;
  canOpenSharedDraft: boolean;
  onRetryContext: () => void;
  onRetrySync: () => void;
  onUseLatestDraft: () => void;
  onKeepLocalAsSeparateDraft: () => void;
  onSourceChange: (sourceId: string) => void;
  onDestinationChange: (destinationId: string) => void;
  updateCapture: (value: Partial<VehicleReturnCapture>) => void;
  toggleItem: (itemId: string, checked: boolean) => void;
  verifyScans: (key: string, serials: string[]) => Promise<{ status: "verified" | "invalid"; message: string; rejectedSerials?: string[] }>;
  setScope: (scope: "selected" | "all") => void;
  setAddItemId: (itemId: string) => void;
  addItem: () => void;
  baselineFor: (itemId: string) => SavedVehicleReturnDraft["baseline"][number] | undefined;
  onOpenDraft: (draft: SavedVehicleReturnDraft) => void;
  onPhysicallyConfirm: (confirmed: boolean) => void;
  onPrint: () => void;
  onClose: () => void;
};

export function VehicleReturnWizardSteps(props: Props) {
  const {
    kind, step, restoreReady, capture, draft, data, sourceVehicle, destinations, items,
    selectedEquipment, equipmentGroups, selectedLines, vehicleStockItemIds, scope, addItemId,
    physicallyConfirmed, prepared, receiptId, receiptEvidence, message, syncError, conflictDraft,
    queryError, canKeepLocalSeparate, canOpenSharedDraft, onRetryContext, onRetrySync, onUseLatestDraft, onKeepLocalAsSeparateDraft,
    onSourceChange, onDestinationChange, updateCapture, toggleItem, setScope, setAddItemId, addItem,
    baselineFor, onOpenDraft, onPhysicallyConfirm, onPrint, onClose,
  } = props;
  return <>
    {queryError && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Vehicle context unavailable</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">No capture was submitted. Refresh the authorized inventory context to continue.
        <Button variant="outline" size="sm" onClick={onRetryContext}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></AlertDescription></Alert>}
    {syncError && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Draft sync needs attention</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">{syncError}<span className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onRetrySync}>Retry sync</Button>
        {canKeepLocalSeparate && <Button variant="outline" size="sm" onClick={onKeepLocalAsSeparateDraft}>Keep local separately</Button>}
      </span></AlertDescription></Alert>}
    {conflictDraft && <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>Another worker has a newer draft</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">Your current entries are retained and have not been replaced.
        <span className="flex flex-wrap gap-2">{conflictDraft.status !== "deleted" && <Button variant="outline" size="sm" onClick={onUseLatestDraft}>Review exact shared draft</Button>}
          {(conflictDraft.status === "editing" || conflictDraft.status === "deleted") && canKeepLocalSeparate &&
            <Button variant="outline" size="sm" onClick={onKeepLocalAsSeparateDraft}>Keep local as separate draft</Button>}</span></AlertDescription></Alert>}
    {message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}
    {!restoreReady && <div className="space-y-3" aria-label="Restoring saved inventory work"><div className="h-5 w-48 animate-pulse rounded bg-muted" /><div className="h-24 animate-pulse rounded-lg bg-muted" /></div>}
    {restoreReady && step === "setup" && <div className="space-y-5">
      <section className="rounded-xl border bg-card p-4 sm:p-5">
        <h2 className="font-semibold">Where is this work coming from?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose the vehicle being physically checked. Current context will be refreshed before preparation.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>Source vehicle</Label><Select value={capture.sourceId || undefined} onValueChange={onSourceChange}>
            <SelectTrigger data-wizard-needs-input={!sourceVehicle ? "true" : undefined}><SelectValue placeholder="Select vehicle" /></SelectTrigger><SelectContent>
              {(data?.vehicles ?? []).map(value => <SelectItem key={value.id} value={value.id}>{value.name} · {value.code}</SelectItem>)}
            </SelectContent></Select></div>
          {kind !== "count" && <div className="space-y-2"><Label>{kind === "equipment" ? "Quarantine / return destination" : "Return destination"}</Label>
            <Select value={capture.destinationId || undefined} onValueChange={onDestinationChange}>
              <SelectTrigger data-wizard-needs-input={!destinations.some(value => value.id === capture.destinationId) ? "true" : undefined}><SelectValue placeholder="Select destination" /></SelectTrigger><SelectContent>
                {destinations.map(value => <SelectItem key={value.id} value={value.id}>{value.name} · {value.code}</SelectItem>)}
              </SelectContent></Select></div>}
        </div>
        {sourceVehicle && <p className="mt-3 text-xs text-muted-foreground">Selected vehicle: {sourceVehicle.name}. {kind === "equipment" ? "Accepted equipment remains quarantined and is not usable stock." : kind === "count" ? "A mismatch creates an open cycle count for authorized review; no quantity is silently adjusted." : "Protected unload checks are enforced by the server before stock moves."}</p>}
      </section>
      <section className="rounded-xl border border-dashed p-4 sm:p-5">
        <h2 className="font-semibold">Resume shared work</h2>
        <p className="mt-1 text-sm text-muted-foreground">Existing authorized drafts are restored automatically. Preparation and final posting remain separate steps.</p>
        {data?.drafts.filter(value => value.capture.kind === kind && value.status !== "deleted").length ? <div className="mt-3 space-y-2">
          {data.drafts.filter(value => value.capture.kind === kind && value.status !== "deleted").map(value => <div key={value.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/40 p-3 text-sm">
            <span className="min-w-0 break-words"><strong>
              {kind === "equipment" ? "Equipment return" : kind === "count" ? "Vehicle count" : "Stock return"}
              {" — "}{data.vehicles.find(vehicle => vehicle.id === value.capture.sourceId)?.name ||
                (value.capture.sourceId ? "Vehicle unavailable" : "Vehicle not selected")}
            </strong> · {inventoryDateTime(value.savedAt, data.timezone)} · {value.status}</span>
            <Button size="sm" variant="outline" onClick={() => onOpenDraft(value)} disabled={!canOpenSharedDraft}>Open draft</Button>
          </div>)}
        </div> : <p className="mt-3 text-sm text-muted-foreground">No saved workflow draft for this task.</p>}
      </section>
    </div>}
    {restoreReady && step === "select" && <div className="space-y-4">
      {kind === "equipment" ? <section className="rounded-xl border bg-card p-4 sm:p-5">
        <h2 className="font-semibold">Select pending removed equipment</h2>
        <p className="mt-1 text-sm text-muted-foreground">Only existing pending returns are selectable. Expected vehicle is a cue, not a restriction; verify each unit physically.</p>
        <div className="mt-4 space-y-2">
          {(data?.equipment ?? []).length ? data!.equipment.map(row => <label key={row.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/30">
            <Checkbox data-wizard-needs-input={capture.returnIds.length === 0 ? "true" : undefined} checked={capture.returnIds.includes(row.id)} onCheckedChange={checked => updateCapture({ returnIds: checked === true ? [...capture.returnIds, row.id] : capture.returnIds.filter(id => id !== row.id) })} />
            <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 font-medium">{row.equipment}<Badge variant="outline">{row.serial}</Badge></span>
              <span className="mt-1 block text-xs text-muted-foreground">{row.label} · WO {row.workOrderId} · expected vehicle {row.expectedVehicleId || "not recorded"}</span>
              {row.expectedVehicleId === capture.sourceId ? <span className="mt-1 block text-xs text-primary">Expected on this vehicle</span> : <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">Different expected vehicle — physically verify before accepting</span>}</span>
          </label>) : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No pending equipment returns are available for this vehicle.</p>}
        </div>
      </section> : <section className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Set the count scope</h2>
          <p className="mt-1 text-sm text-muted-foreground">Count actual physical units. Unexpected serials/items are discrepancy evidence, not auto-adjustments.</p></div>
          {kind === "count" && <div className="flex rounded-lg border p-1">
            <Button size="sm" variant={scope === "selected" ? "secondary" : "ghost"} onClick={() => setScope("selected")}>Selected items</Button>
            <Button size="sm" variant={scope === "all" ? "secondary" : "ghost"} onClick={() => { setScope("all"); updateCapture({ itemIds: vehicleStockItemIds }); }}>All physical stock</Button>
          </div>}
        </div>
        {scope === "selected" && <div className="mt-4 space-y-2">
          {items.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 hover:bg-muted/30">
            <Checkbox data-wizard-needs-input={capture.itemIds.length === 0 ? "true" : undefined} checked={capture.itemIds.includes(item.id)} onCheckedChange={checked => toggleItem(item.id, checked === true)} />
            <span className="min-w-0 flex-1"><span className="font-medium">{item.name}</span><span className="ml-2 text-xs text-muted-foreground">{item.sku || item.id} · {item.unit}</span></span>
            <Badge variant="outline">{item.tracking === "serialized" ? "Serialized" : "Bulk"}</Badge>
          </label>)}
          {!items.length && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No active physical items are available.</p>}
        </div>}
        {scope === "all" && <p className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">All {capture.itemIds.length} items with recorded vehicle stock are selected. You may add an unexpected physical item as evidence using the control below.</p>}
        {kind === "count" && <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1 space-y-2"><Label>Add another physical item as discrepancy evidence</Label><Select value={addItemId || undefined} onValueChange={setAddItemId}><SelectTrigger><SelectValue placeholder="Choose item" /></SelectTrigger><SelectContent>
            {items.filter(item => !capture.itemIds.includes(item.id)).map(item => <SelectItem key={item.id} value={item.id}>{item.name} · {item.sku || item.id}</SelectItem>)}
          </SelectContent></Select></div><Button type="button" variant="outline" onClick={addItem} disabled={!addItemId}>Add item</Button>
        </div>}
      </section>}
    </div>}
    {restoreReady && step === "capture" && <div className="space-y-4">
      {kind === "equipment" ? <section className="rounded-xl border bg-card p-4 sm:p-5">
        <h2 className="font-semibold">Scan selected returns by system / module</h2>
        <p className="mt-1 text-sm text-muted-foreground">Each group must contain exactly the selected pending serials. Partial barcode text is retained but is not accepted until committed.</p>
        <div className="mt-4 space-y-5">
          {equipmentGroups.map(([label, rows], groupIndex) => {
            const selected = rows.filter(row => capture.returnIds.includes(row.id));
            if (!selected.length) return null;
            return <div key={label} className="space-y-2 rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><Label>{label}</Label><span className="text-xs text-muted-foreground">{selected.map(row => row.serial).join(" · ")}</span></div>
              <SerialScanField id={`return-scan-${label}`} value={capture.scans[label] ?? ""} onChange={value => updateCapture({ scans: { [label]: value } })}
                verifyCommittedScans={serials => props.verifyScans(label, serials)}
                expected={selected.length} preserveUncommittedTail blockedSerials={rows.filter(row => !capture.returnIds.includes(row.id)).map(row => row.serial)}
                data-return-focus={groupIndex === 0 ? "" : undefined} aria-label={`Scan selected ${label} serials`} />
            </div>;
          })}
          {!selectedEquipment.length && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Select at least one pending return before scanning.</p>}
        </div>
        <div className="mt-5 space-y-2"><Label htmlFor="equipment-return-reason">Condition and return reason <span className="text-muted-foreground">(required)</span></Label>
          <Textarea id="equipment-return-reason" data-wizard-needs-input={capture.reason.trim().length < 10 ? "true" : undefined} value={capture.reason} onChange={event => updateCapture({ reason: event.target.value })} placeholder="Record observed condition and why the equipment was removed." rows={3} /></div>
      </section> : <section className="space-y-3">
        <div className="rounded-xl border bg-card p-4"><h2 className="font-semibold">{kind === "count" ? "Record actual physical quantities" : "Record usable stock to unload"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{kind === "count" ? "The baseline comes from the saved server draft. A mismatch opens a cycle count for authorized investigation." : "Only the selected serials currently in this vehicle can be returned. Stock protection is checked by the server."}</p></div>
        {selectedLines.map(({ itemId, item, quantityText }) => {
          if (!item) return null;
          const baseline = baselineFor(itemId);
          return <section key={itemId} className="space-y-3 rounded-xl border bg-card p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{item.name}</h3><p className="text-xs text-muted-foreground">{item.sku || item.id} · {item.unit} · {item.tracking}</p></div>
              {kind === "count" && <Badge variant="outline">Expected {baseline?.quantity ?? 0}</Badge>}</div>
            <div className="max-w-xs space-y-2"><Label htmlFor={`quantity-${itemId}`}>{kind === "count" ? "Actual quantity" : "Quantity to return"}</Label>
              <Input required data-wizard-needs-input={!quantityText.trim() || !Number.isSafeInteger(Number(quantityText)) || Number(quantityText) < (kind === "stock" ? 1 : 0) ? "true" : undefined} id={`quantity-${itemId}`} type="number" min={kind === "stock" ? "1" : "0"} max={kind === "stock" ? data?.stock.find(row => row.itemId === itemId)?.available ?? 0 : 1000000} step="1" inputMode="numeric" value={quantityText} onChange={event => {
                const value = event.target.value;
                const limit = kind === "stock" ? data?.stock.find(row => row.itemId === itemId)?.available ?? 0 : 1000000;
                if (value !== "" && (!/^\d+$/.test(value) || Number(value) > limit)) return;
                updateCapture({ quantities: { [itemId]: value } });
              }} /></div>
            {item.tracking === "serialized" && <div className="space-y-2"><Label>Serials physically present</Label>
              <SerialScanField id={`serials-${itemId}`} value={capture.scans[itemId] ?? ""} onChange={value => updateCapture({ scans: { [itemId]: value } })}
                blockedSerials={selectedLines.filter(line => line.itemId !== itemId).flatMap(line => line.serials)}
                verifyCommittedScans={kind === "stock" ? serials => props.verifyScans(itemId, serials) : undefined}
                expected={quantityText} preserveUncommittedTail requireTarget aria-label={`Scan ${item.name} serials`} />
              {kind === "count" && <p className="text-xs text-muted-foreground">Expected serials: {baseline?.serials.join(", ") || "none recorded"}</p>}
            </div>}
            {kind === "count" && baseline && <p className="text-xs text-muted-foreground">Baseline quantity {baseline.quantity} from the saved draft; count actual independently. Unexpected serials remain discrepancy evidence.</p>}
          </section>;
        })}
      </section>}
      {kind !== "equipment" && <div className="space-y-2 rounded-xl border bg-card p-4"><Label htmlFor="return-reason">Count / return reason <span className="text-muted-foreground">(10 characters minimum)</span></Label>
        <Textarea id="return-reason" data-wizard-needs-input={capture.reason.trim().length < 10 ? "true" : undefined} value={capture.reason} onChange={event => updateCapture({ reason: event.target.value })} placeholder={kind === "count" ? "Note the count context or discrepancy observations." : "Why is this usable stock returning from the vehicle?"} rows={3} /></div>}
    </div>}
    {restoreReady && step === "review" && <div className="space-y-4">
      <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Physical review before preparation</AlertTitle>
        <AlertDescription>{kind === "equipment" ? "Accepted returns stay in quarantine and cannot be used as ordinary stock." : kind === "count" ? "Count mismatches open a cycle count for authorized investigation. No silent adjustment will occur." : "The server checks protected stock before unloading."} Preparing freezes a command but does not move inventory.</AlertDescription></Alert>
      <section className="rounded-xl border bg-card p-4 sm:p-5"><h2 className="font-semibold">Review details</h2>
        <dl className="mt-3 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Vehicle</dt><dd className="font-medium">{sourceVehicle?.name ?? capture.sourceId}</dd></div>
          {kind !== "count" && <div><dt className="text-muted-foreground">Destination</dt><dd className="font-medium">{destinations.find(value => value.id === capture.destinationId)?.name ?? capture.destinationId}</dd></div>}
          <div><dt className="text-muted-foreground">Selected</dt><dd className="font-medium">{kind === "equipment" ? `${selectedEquipment.length} pending equipment unit(s)` : `${capture.itemIds.length} physical item(s)`}</dd></div>
          <div><dt className="text-muted-foreground">Reason</dt><dd className="font-medium">{capture.reason}</dd></div></dl>
      </section>
      {kind === "equipment" ? <section className="rounded-xl border bg-card p-4"><h3 className="font-semibold">Pending equipment</h3><ul className="mt-2 space-y-2 text-sm">{selectedEquipment.map(row => <li key={row.id} className="flex flex-wrap justify-between gap-2"><span>{row.equipment} · {row.serial}</span><span className="text-muted-foreground">Expected vehicle {row.expectedVehicleId || "not recorded"}</span></li>)}</ul></section>
        : <section className="rounded-xl border bg-card p-4"><h3 className="font-semibold">{kind === "count" ? "Count comparison" : "Return lines"}</h3>
          <div className="mt-3 space-y-3">{selectedLines.map(line => {
            const baseline = baselineFor(line.itemId);
            const missing = (baseline?.serials ?? []).filter(serial => !line.serials.includes(serial));
            const unexpected = line.serials.filter(serial => !(baseline?.serials ?? []).includes(serial));
            return <div key={line.itemId} className="rounded-lg bg-muted/30 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{line.item?.name ?? line.itemId}</strong>
              <span>{kind === "count" ? `${baseline?.quantity ?? 0} expected → ${line.quantity} actual` : `${line.quantity} ${line.item?.unit ?? "units"}`}</span></div>
              {kind === "count" && (baseline?.quantity !== line.quantity || missing.length || unexpected.length) && <p className="mt-1 text-amber-700 dark:text-amber-400">Discrepancy · missing serials: {missing.join(", ") || "none"} · unexpected: {unexpected.join(", ") || "none"}</p>}
              {line.serials.length > 0 && <p className="mt-1 text-xs text-muted-foreground">Scanned: {line.serials.join(", ")}</p>}
            </div>;
          })}</div></section>}
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
        <Checkbox data-wizard-needs-input={!physicallyConfirmed ? "true" : undefined} checked={physicallyConfirmed} onCheckedChange={value => onPhysicallyConfirm(value === true)} />
        <span className="text-sm"><strong>I physically verified the selected vehicle, units, quantities, and destination.</strong><span className="mt-1 block text-muted-foreground">This confirmation is fresh for this review. Resuming an editable draft requires confirming again.</span></span>
      </label>
      {prepared && <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>Exact operation awaiting outcome</AlertTitle>
        <AlertDescription>Do not change this request or create a new operation. Retry the same frozen command, or ask the server to atomically unlock it before editing.</AlertDescription></Alert>}
    </div>}
    {restoreReady && step === "receipt" && <section className="space-y-4">
      <div className="rounded-xl border bg-card p-5 sm:p-7"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary"><Check className="h-5 w-5" /></span>
        <div><p className="text-sm text-muted-foreground">Physical operation recorded</p><h2 className="text-xl font-semibold">Receipt {receiptId || draft?.receiptId || "available"}</h2></div></div>
        {kind === "count" && <div className="mt-5 rounded-lg border p-4 text-sm">{receiptEvidence?.needsReview
          ? <><strong>Cycle count requires review.</strong><p className="mt-1 text-muted-foreground">Open Counts and resolve cycle count {receiptEvidence.countId ? `#${receiptEvidence.countId}` : ""}. Changes are not applied until an authorized reviewer resolves it.</p></>
          : <><strong>Vehicle count recorded.</strong><p className="mt-1 text-muted-foreground">Review any count evidence in Counts before making stock adjustments.</p></>}</div>}
        {kind === "equipment" && <p className="mt-4 text-sm text-muted-foreground">Returned equipment remains in quarantine. It is not available as usable stock until separately resolved.</p>}
        {kind === "stock" && <p className="mt-4 text-sm text-muted-foreground">Returned stock is recorded at the selected destination. Protected-stock validation was enforced by the server.</p>}
        <div className="mt-5 flex flex-wrap gap-2">{receiptId && <Button variant="outline" onClick={onPrint}><Printer className="mr-2 h-4 w-4" />Print receipt</Button>}
          <Button onClick={onClose}>Return to tasks</Button></div></div>
    </section>}
  </>;
}
