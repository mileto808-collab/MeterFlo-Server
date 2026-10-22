import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { inventoryDateTime } from "@shared/inventory-date-time";
import type { SavedVehicleTransferDraft } from "./use-vehicle-transfer-drafts";

type Props = {
  drafts: SavedVehicleTransferDraft[];
  loading: boolean;
  error: boolean;
  timezone: string;
  sourceName: (id: string) => string;
  destinationName: (id: string) => string;
  onResume: (draft: SavedVehicleTransferDraft) => void;
  onDelete: (draft: SavedVehicleTransferDraft) => void;
  onRetry: () => void;
};

export function VehicleTransferDraftList({
  drafts, loading, error, timezone, sourceName, destinationName, onResume, onDelete, onRetry,
}: Props) {
  return <section data-testid="vehicle-transfer-draft-list" className="space-y-2 rounded-lg border bg-muted/20 p-3" aria-label="Shared handover drafts">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold">Shared handover drafts</h3>
        <p className="text-xs text-muted-foreground">Unsubmitted details are visible to authorized warehouse users.</p>
      </div>
      <Badge variant="outline">{drafts.length}</Badge>
    </div>
    {loading && <div data-testid="transfer-drafts-loading" className="space-y-2" aria-label="Loading saved drafts">
      <div className="h-12 animate-pulse rounded-md bg-muted" /><div className="h-12 animate-pulse rounded-md bg-muted" />
    </div>}
    {error && <Alert variant="destructive">
      <AlertTitle>Draft list unavailable</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
        <span>Shared drafts could not be loaded. Your current capture remains available.</span>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry draft list</Button>
      </AlertDescription>
    </Alert>}
    {!loading && !error && drafts.length === 0 && <p data-testid="transfer-drafts-empty" className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
      No saved handovers yet. Meaningful entries save automatically.
    </p>}
    {!loading && drafts.length > 0 && <ul className="max-h-44 space-y-2 overflow-y-auto">
      {drafts.map(draft => <li key={draft.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-background p-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="secondary">{draft.capture.mode === "stock" ? "Stock only" : "Work + stock"}</Badge>
            {draft.status === "submitting" && <Badge variant="outline">Outcome pending</Badge>}
          </div>
          <p className="mt-1 truncate text-sm font-medium">
            {sourceName(draft.capture.sourceId)} <span className="text-muted-foreground">→</span> {destinationName(draft.capture.destinationId)}
          </p>
          <p className="text-xs text-muted-foreground">Saved {inventoryDateTime(draft.savedAt, timezone)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button type="button" size="sm" variant="outline" data-testid="transfer-draft-resume" data-draft-id={draft.id}
            onClick={() => onResume(draft)} aria-label={`Resume ${draft.capture.mode === "stock" ? "stock" : "work"} handover`}>
            {draft.status === "submitting" ? <><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Resolve</> : <><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Resume</>}
          </Button>
          <Button type="button" size="icon" variant="ghost" data-testid="transfer-draft-delete" data-draft-id={draft.id}
            onClick={() => onDelete(draft)} aria-label="Delete shared handover draft" title="Delete draft">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </li>)}
    </ul>}
  </section>;
}

export function VehicleTransferDraftSaveStatus({ status, error }: {
  status: "idle" | "saving" | "saved" | "error" | "conflict";
  error: string;
}) {
  const labels = {
    idle: "Draft not started", saving: "Saving draft…", saved: "Draft saved", error: "Draft not synced",
    conflict: "Draft has newer shared edits",
  };
  return <div data-testid="transfer-draft-save-status" data-status={status} role="status" aria-live="polite"
    className={`flex min-h-8 items-center gap-2 text-xs ${status === "error" || status === "conflict" ? "text-destructive" : "text-muted-foreground"}`}>
    {status === "saving" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
    <span>{labels[status]}</span>
    {error && <span className="sr-only">{error}</span>}
  </div>;
}
