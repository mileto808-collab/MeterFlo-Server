import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InventoryEditorSurface } from "@/components/inventory/inventory-editor-surface";
import { useUnsavedNavigation } from "@/hooks/use-unsaved-navigation";
import type { InventoryState } from "@shared/inventory";
import { locationTypeKey, type InventoryLocationType } from "@shared/inventory-location-types";

type Draft = Pick<InventoryLocationType, "name" | "kind" | "accessPolicy">;
type CommandAction = "locationType" | "locationTypeDelete";
type Props = {
  state: InventoryState;
  pending: boolean;
  authorized: boolean;
  portalHost: HTMLElement | null;
  onBack: () => void;
  onCommand: (action: CommandAction, payload: Record<string, unknown>, onSuccess: () => void, onError: (error: Error) => void) => void;
};
const newDraft = (): Draft => ({ name: "", kind: "physical", accessPolicy: "shared" });
const typeDraft = (type: InventoryLocationType): Draft => ({ name: type.name, kind: type.kind, accessPolicy: type.accessPolicy });
const referenceIds = (state: InventoryState, typeId: string) =>
  state.warehouses.filter(warehouse => warehouse.locationTypeId === typeId).map(warehouse => warehouse.id).sort();
const basisSignature = (state: InventoryState, typeId: string) => {
  const type = state.locationTypes?.find(value => value.id === typeId) ?? null;
  const locations = state.warehouses.filter(value => value.locationTypeId === typeId).map(value => ({
    id: value.id, active: value.active, kind: value.type, address: value.address,
    vin: value.vin, plate: value.plate, plateState: value.plateState,
  })).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify({ type, locations });
};
const typeTitle = (kind: Draft["kind"]) => kind === "vehicle" ? "Vehicle" : kind === "mobile" ? "Mobile" : "Physical";

export function LocationTypesManager({ state, pending, authorized, portalHost, onBack, onCommand }: Props) {
  const locationTypes = state.locationTypes ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [initialDraft, setInitialDraft] = useState("");
  const [baselineRevision, setBaselineRevision] = useState<number | null>(null);
  const [baselineBasis, setBaselineBasis] = useState("");
  const [stale, setStale] = useState(false);
  const [error, setError] = useState("");
  const [confirmedImpact, setConfirmedImpact] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<InventoryLocationType | null>(null);
  const [pendingExit, setPendingExit] = useState<(() => void) | null>(null);
  const dirty = !!draft && JSON.stringify(draft) !== initialDraft;
  const editing = editingId ? locationTypes.find(type => type.id === editingId) : undefined;
  const changedImpact = !!editing && !!draft &&
    (draft.kind !== editing.kind || draft.accessPolicy !== editing.accessPolicy);
  const affectedIds = editingId ? referenceIds(state, editingId) : [];
  const needsImpactConfirmation = changedImpact && affectedIds.length > 0;
  const duplicateName = !!draft && locationTypes.some(type =>
    type.id !== editingId && locationTypeKey(type.name) === locationTypeKey(draft.name));
  const canSave = authorized && !!draft && !pending && !stale && !duplicateName && !!draft.name.trim() &&
    (!needsImpactConfirmation || confirmedImpact);
  const title = editingId ? "Edit location type" : "Create location type";
  const pendingType = deleteTarget;
  const deleteReferences = pendingType ? referenceIds(state, pendingType.id).length : 0;
  const typeStats = useMemo(() => new Map(locationTypes.map(type => [type.id, referenceIds(state, type.id).length])), [locationTypes, state.warehouses]);

  useEffect(() => {
    if (!editingId || !draft) return;
    const latest = locationTypes.find(type => type.id === editingId);
    if (!latest) {
      setStale(true);
      return;
    }
    const nextBasis = basisSignature(state, editingId);
    if (nextBasis === baselineBasis) {
      setStale(false);
      return;
    }
    if (dirty) {
      setStale(true);
      return;
    }
    const nextDraft = typeDraft(latest);
    setDraft(nextDraft);
    setInitialDraft(JSON.stringify(nextDraft));
    setBaselineRevision(latest.revision);
    setBaselineBasis(nextBasis);
    setStale(false);
  }, [editingId, locationTypes, state.warehouses, baselineBasis, dirty, draft]);

  useUnsavedNavigation(dirty, transition => setPendingExit(current => current ?? transition));

  const beginCreate = () => {
    const value = newDraft();
    setEditingId(null);
    setDraft(value);
    setInitialDraft(JSON.stringify(value));
    setBaselineRevision(null);
    setBaselineBasis("");
    setStale(false);
    setError("");
    setConfirmedImpact(false);
  };
  const beginEdit = (type: InventoryLocationType) => {
    const value = typeDraft(type);
    setEditingId(type.id);
    setDraft(value);
    setInitialDraft(JSON.stringify(value));
    setBaselineRevision(type.revision);
    setBaselineBasis(basisSignature(state, type.id));
    setStale(false);
    setError("");
    setConfirmedImpact(false);
  };
  const startCreate = () => {
    if (dirty) setPendingExit(current => current ?? beginCreate);
    else beginCreate();
  };
  const startEdit = (type: InventoryLocationType) => {
    if (dirty) setPendingExit(current => current ?? (() => beginEdit(type)));
    else beginEdit(type);
  };
  const clearEditor = () => {
    setEditingId(null);
    setDraft(null);
    setInitialDraft("");
    setBaselineRevision(null);
    setBaselineBasis("");
    setStale(false);
    setError("");
    setConfirmedImpact(false);
  };
  const requestExit = () => {
    if (dirty) setPendingExit(() => onBack);
    else onBack();
  };
  const save = () => {
    if (!draft || !canSave) return;
    const id = editingId ?? crypto.randomUUID();
    setError("");
    onCommand("locationType", {
      id,
      name: draft.name.trim(),
      kind: draft.kind,
      accessPolicy: draft.accessPolicy,
      ...(editingId ? { expectedRevision: baselineRevision } : {}),
      ...(needsImpactConfirmation ? { confirmAffectedLocations: affectedIds } : {}),
    }, () => {
      clearEditor();
    }, failure => setError(failure.message || "Location type could not be saved."));
  };
  const remove = () => {
    if (!authorized || !deleteTarget || deleteReferences > 0 || pending) return;
    const target = deleteTarget;
    setError("");
    onCommand("locationTypeDelete", { id: target.id, expectedRevision: target.revision }, () => {
      setDeleteTarget(null);
      if (editingId === target.id) clearEditor();
    }, failure => setError(failure.message || "Location type could not be deleted."));
  };
  const setValue = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(current => current ? { ...current, [key]: value } : current);
    setConfirmedImpact(false);
    setError("");
  };

  return <>
    <InventoryEditorSurface inline portalHost={portalHost} title="Manage location types"
      testId="inventory-location-types-manager"
      description="Define the labels and access rules staff see when creating and finding locations."
      onBack={requestExit} onSave={save} saving={pending} saveDisabled={!canSave} saveLabel={draft ? "Save type" : "Save changes"}>
      {!authorized && <Alert variant="destructive"><AlertTitle>Location type access changed</AlertTitle><AlertDescription>Your unsaved details are retained, but your current permissions no longer allow changes. You can go back without posting.</AlertDescription></Alert>}
      <fieldset disabled={!authorized} className="grid min-h-0 gap-5 lg:grid-cols-[minmax(260px,0.85fr)_minmax(0,1.5fr)]">
        <section aria-labelledby="location-type-list-heading" className="min-w-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div><h2 id="location-type-list-heading" className="text-sm font-semibold">Project types</h2><p className="text-xs text-muted-foreground">{locationTypes.length} available</p></div>
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={startCreate}><Plus className="mr-1.5 h-4 w-4" />Add type</Button>
          </div>
          <div className="space-y-2">
            {locationTypes.map(type => {
              const used = typeStats.get(type.id) ?? 0;
              return <article key={type.id} data-location-type-id={type.id} className={`rounded-lg border p-3 ${editingId === type.id ? "border-primary/50 bg-primary/[0.04]" : "bg-card"}`}>
                <div className="flex items-start justify-between gap-3">
                  <button type="button" className="min-w-0 flex-1 text-left" disabled={pending} onClick={() => startEdit(type)}>
                    <span className="block break-words font-medium">{type.name}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{typeTitle(type.kind)} · {type.accessPolicy === "assigned" ? "Restricted" : "Shared"} · {used} {used === 1 ? "location" : "locations"}</span>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => startEdit(type)}>Edit</Button>
                    <Button type="button" size="icon" variant="ghost" aria-label={`Delete ${type.name}`} title={used ? `Used by ${used} locations` : "Delete unused type"} disabled={used > 0 || pending} onClick={() => { setError(""); setDeleteTarget(type); }}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </article>;
            })}
            {!locationTypes.length && <div className="rounded-lg border border-dashed p-5 text-center">
              <p className="font-medium">No location types yet</p><p className="mt-1 text-sm text-muted-foreground">Add a type before creating a location.</p>
            </div>}
          </div>
        </section>
        <section aria-labelledby="location-type-form-heading" className="min-w-0 rounded-lg border bg-card p-4 sm:p-5">
          {!draft ? <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <p id="location-type-form-heading" className="font-medium">Choose a type to edit</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">Or create a new type to control its label, location details and access policy.</p>
            <Button type="button" className="mt-4" variant="outline" onClick={startCreate}><Plus className="mr-2 h-4 w-4" />Create location type</Button>
          </div> : <div className="space-y-5">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{editingId ? "Type details" : "New type"}</p>
              <h2 id="location-type-form-heading" className="mt-1 text-lg font-semibold">{title}</h2>
            </div>
            {stale && <Alert variant="destructive"><AlertTitle>Type or affected locations changed</AlertTitle><AlertDescription>{editing ? "Your draft is intact, but the location type or its assigned locations changed in another session. Reload the latest values before saving." : "This type was deleted elsewhere. Your draft is intact but can no longer be saved."}</AlertDescription><div className="mt-3">{editing ? <Button type="button" size="sm" variant="outline" onClick={() => startEdit(editing)}>Reload current type</Button> : <Button type="button" size="sm" variant="outline" onClick={() => setPendingExit(() => clearEditor)}>Discard draft</Button>}</div></Alert>}
            {error && <Alert variant="destructive"><AlertTitle>Location type not saved</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
            <div className="space-y-2"><Label htmlFor="location-type-name">Display name</Label><Input id="location-type-name" disabled={pending} autoComplete="off" maxLength={200} value={draft.name} onChange={event => setValue("name", event.target.value)} placeholder="For example, Service depot" aria-invalid={duplicateName || !draft.name.trim()} />
              <p className="text-xs text-muted-foreground">Names are unique within this project, ignoring capitalization and surrounding spaces.</p>
              {duplicateName && <p className="text-xs text-destructive" role="alert">A location type with this name already exists.</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="location-type-kind">Location details</Label><Select value={draft.kind} disabled={pending} onValueChange={value => setValue("kind", value as Draft["kind"])}><SelectTrigger id="location-type-kind"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="physical">Physical location</SelectItem><SelectItem value="vehicle">Vehicle</SelectItem><SelectItem value="mobile">Mobile location</SelectItem></SelectContent></Select>
                <p className="text-xs leading-relaxed text-muted-foreground">{draft.kind === "physical" ? "Requires a street address." : draft.kind === "vehicle" ? "Uses the existing VIN and plate validation." : "No VIN or street address is required."}</p>
              </div>
              <div className="space-y-2"><Label htmlFor="location-type-access">Access policy</Label><Select value={draft.accessPolicy} disabled={pending} onValueChange={value => setValue("accessPolicy", value as Draft["accessPolicy"])}><SelectTrigger id="location-type-access"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="shared">Shared — available to authorized inventory staff</SelectItem><SelectItem value="assigned">Restricted — assigned users only</SelectItem></SelectContent></Select>
                <p className="text-xs leading-relaxed text-muted-foreground">{draft.accessPolicy === "shared" ? "Location assignments are not required for access." : "Each location of this type can be limited to a primary user and additional users."}</p>
              </div>
            </div>
            {needsImpactConfirmation && <Alert><AlertTitle>Existing locations will be affected</AlertTitle><AlertDescription>This change applies to {affectedIds.length} location{affectedIds.length === 1 ? "" : "s"}. Server validation checks all of them before saving.</AlertDescription>
              <label className="mt-3 flex min-h-10 cursor-pointer items-start gap-2 text-sm"><Checkbox checked={confirmedImpact} onCheckedChange={checked => setConfirmedImpact(checked === true)} /><span>I understand this updates the kind or access policy for all {affectedIds.length} affected locations.</span></label>
            </Alert>}
            <div className="flex flex-wrap items-center gap-2 border-t pt-4">
              <Button type="button" disabled={!canSave} onClick={save}>{pending ? "Saving…" : editingId ? "Save type" : "Create type"}</Button>
              <Button type="button" variant="outline" disabled={pending} onClick={() => dirty ? setPendingExit(() => clearEditor) : clearEditor()}>{dirty ? "Discard draft" : "Cancel"}</Button>
            </div>
          </div>}
        </section>
      </fieldset>
    </InventoryEditorSurface>
    <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open && !pending) setDeleteTarget(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Delete location type?</DialogTitle><DialogDescription>{deleteTarget?.name} can only be deleted when no location references it. This cannot be undone.</DialogDescription></DialogHeader>
        {error && <Alert variant="destructive"><AlertTitle>Location type not deleted</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {deleteReferences > 0 && <Alert variant="destructive"><AlertTitle>Type is in use</AlertTitle><AlertDescription>{deleteReferences} active or inactive location{deleteReferences === 1 ? "" : "s"} still use this type.</AlertDescription></Alert>}
        <DialogFooter><Button type="button" variant="outline" disabled={pending} onClick={() => setDeleteTarget(null)}>Cancel</Button><Button type="button" variant="destructive" disabled={!authorized || pending || deleteReferences > 0} onClick={remove}>{pending ? "Deleting…" : "Delete type"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!pendingExit} onOpenChange={open => { if (!open) setPendingExit(null); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Discard location type changes?</DialogTitle><DialogDescription>Your unsaved type details will be discarded.</DialogDescription></DialogHeader>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setPendingExit(null)}>Keep editing</Button><Button type="button" variant="destructive" onClick={() => { const exit = pendingExit; setPendingExit(null); clearEditor(); exit?.(); }}>Discard changes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
