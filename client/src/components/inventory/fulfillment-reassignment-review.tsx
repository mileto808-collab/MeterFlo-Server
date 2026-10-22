import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type { FulfillmentReassignmentReview as Review } from "@shared/inventory-fulfillment-reassignment";
import { apiRequest } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function FulfillmentReassignmentReview({
  projectId, batchId, canApply, blocked, onApply, onReviewRelease,
  vehicleId, reason, onVehicleChange, onReasonChange,
}: {
  projectId: number; batchId: string; canApply: boolean; blocked: boolean;
  onApply: (review: Review, vehicleId: string, reason: string) => void;
  onReviewRelease: () => void;
  vehicleId: string; reason: string; onVehicleChange: (value: string) => void; onReasonChange: (value: string) => void;
}) {
  const query = useQuery<Review>({
    queryKey: [`/api/projects/${projectId}/inventory/fulfillment/${batchId}/reassignment`],
    queryFn: async () => (await apiRequest("GET", `/api/projects/${projectId}/inventory/fulfillment/${encodeURIComponent(batchId)}/reassignment`)).json(),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 10_000,
  });
  const review = query.data;
  const options = review?.vehicles ?? [];
  const allowed = !!review?.canApply && canApply && !blocked && !!vehicleId &&
    options.some(option => option.id === vehicleId) && reason.trim().length >= 10 && !query.isError;
  const formatDate = (value: string | null) => {
    if (!value) return "Not recorded";
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
    const parsed = new Date(dateOnly ? `${value}T12:00:00Z` : value);
    if (!Number.isFinite(parsed.getTime())) return value;
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        ...(dateOnly ? { timeZone: "UTC" } : { timeZone: review?.timezone || "UTC" }),
      }).format(parsed);
    } catch {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(parsed);
    }
  };
  return <section data-testid="fulfillment-reassignment-review" data-reassignment-batch={batchId} className="min-w-0 w-full space-y-4" aria-labelledby="reassignment-heading">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-amber-800">Guided Review</p>
      <h3 id="reassignment-heading" data-wizard-reassignment tabIndex={-1} className="mt-1 text-xl font-semibold">Review reassignment</h3>
      <p className="mt-1 text-sm text-muted-foreground">Compare the saved assignment with the current scheduled installer, then confirm the correct handoff vehicle. Reuse compatible staged stock; pull only what remains. This does not move inventory or change any work-order assignment.</p>
      </div>
      <Button type="button" size="sm" variant="outline" className="min-w-0 max-w-full whitespace-normal" data-testid="reassignment-refresh" disabled={query.isFetching} onClick={() => void query.refetch()}>
        <RefreshCw className={`mr-2 h-4 w-4${query.isFetching ? " animate-spin" : ""}`} />Refresh review
      </Button>
    </div>
    {query.isLoading && <div data-testid="reassignment-loading" className="min-w-0 space-y-3 rounded-lg border p-4" aria-label="Loading reassignment review">
      <div className="h-4 w-2/3 animate-pulse rounded bg-muted" /><div className="h-4 w-full animate-pulse rounded bg-muted" /><div className="h-20 animate-pulse rounded bg-muted" />
    </div>}
    {query.isError && <Alert variant="destructive" data-testid="reassignment-error">
      <AlertTriangle className="h-4 w-4" /><AlertTitle>Could not load a current review</AlertTitle>
      <AlertDescription className="flex min-w-0 flex-wrap items-center justify-between gap-3"><span className="min-w-0 break-words">Nothing has been changed. Retry to check current assignments and vehicle access.</span>
        <Button type="button" size="sm" variant="outline" className="min-w-0 max-w-full whitespace-normal" onClick={() => void query.refetch()}><RefreshCw className="mr-2 h-4 w-4 shrink-0" />Retry review</Button></AlertDescription>
    </Alert>}
    {review && <>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 rounded-lg border p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Current vehicle / crew</p>
          <p className="mt-1 font-medium">{review.previousVehicle.name}</p><p className="text-sm text-muted-foreground">{review.previousVehicle.crew.length ? review.previousVehicle.crew.join(", ") : "No crew snapshot recorded"}</p>
          <p className="mt-2 text-xs text-muted-foreground">Staging: {review.staging.name}</p></div>
        <div className="min-w-0 rounded-lg border p-3"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Installer</p>
          <p className="mt-1 font-medium">{review.installer?.name ?? "No current installer assigned"}</p>
          <p className="text-sm text-muted-foreground">Current scheduled installer. Historical installer snapshots, when available, are shown per order below.</p></div>
      </div>
      {review.blockers.length > 0 && <Alert variant="destructive" data-testid="reassignment-blockers">
        <AlertTriangle className="h-4 w-4" /><AlertTitle>Reassignment is blocked</AlertTitle>
        <AlertDescription><ul className="list-disc space-y-1 pl-5">{review.blockers.map((blocker, index) => <li key={`${index}-${blocker}`}>{blocker}</li>)}</ul>
          <p className="mt-2">Resolve the listed condition or use Review / release remainder. Already-delivered stock cannot be reassigned here; use the physical transfer or reservation review process.</p></AlertDescription>
      </Alert>}
      {!review.canApply && review.blockers.length === 0 && <Alert variant="destructive" data-testid="reassignment-unavailable">
        <AlertTriangle className="h-4 w-4" /><AlertTitle>This batch cannot be reassigned right now</AlertTitle>
        <AlertDescription>Use Review / release remainder below, or resolve the batch through the existing physical transfer or reservation review process. Refresh to check whether the condition has changed.</AlertDescription>
      </Alert>}
      {review.warnings.length > 0 && <Alert data-testid="reassignment-warnings"><AlertTriangle className="h-4 w-4" /><AlertTitle>Review before proceeding</AlertTitle>
        <AlertDescription><ul className="list-disc pl-5">{review.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></AlertDescription></Alert>}
      <div className="min-w-0 rounded-lg border">
        <div className="border-b px-3 py-2"><h4 className="font-semibold">Current work-order assignments</h4></div>
        <div className="divide-y">{review.orders.map(order => <div key={order.workOrderId} data-testid={`reassignment-order-${order.workOrderId}`} className="grid min-w-0 gap-1 px-3 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0 break-words"><p className="font-medium break-words">{order.label}</p><p className="text-muted-foreground">Status: {order.status}</p></div>
          <div className="min-w-0 break-words text-muted-foreground"><p>Old installer snapshot: {order.previousInstaller ?? "Not recorded"}</p><p>Current / after reassignment installer: {order.currentInstaller} (unchanged)</p>
            <p>Schedule: {formatDate(order.previousScheduledDate)} → {formatDate(order.currentScheduledDate)}</p></div>
        </div>)}</div>
      </div>
      <div className="min-w-0 rounded-lg border">
        <div className="border-b px-3 py-2"><h4 className="font-semibold">Reusable staged quantities</h4><p className="text-xs text-muted-foreground">Staged material stays in the staging location; delivered material is not eligible for reassignment.</p></div>
        <div className="divide-y">{review.items.map(item => <div key={item.itemId} data-testid={`reassignment-item-${item.itemId}`} className="min-w-0 px-3 py-3 text-sm">
          <p className="break-words font-medium">{item.name} <span className="break-all font-normal text-muted-foreground">· {item.sku}</span></p>
          <p className="text-muted-foreground">Required {item.required} {item.unit} · waiting at staging {item.staged - item.delivered} · delivered {item.delivered} · outstanding pull {item.remaining}</p>
          <p className="break-all text-muted-foreground">Staged serials: {item.serials.length ? item.serials.join(", ") : "None recorded"}</p>
        </div>)}</div>
      </div>
      {options.length === 0 && <Alert data-testid="reassignment-no-vehicles"><AlertTitle>No compatible accessible vehicle</AlertTitle>
        <AlertDescription>Assign an installer under Inventory → Locations, then refresh this review. Only compatible vehicles you can access are listed here.</AlertDescription></Alert>}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1"><Label htmlFor="reassignment-vehicle">New handoff vehicle</Label>
          <Select value={vehicleId} onValueChange={onVehicleChange} disabled={!options.length || query.isFetching}>
          <SelectTrigger id="reassignment-vehicle" data-testid="reassignment-vehicle-select"><SelectValue placeholder="Choose a compatible vehicle" /></SelectTrigger>
            <SelectContent>{options.map(vehicle => <SelectItem key={vehicle.id} value={vehicle.id}>{vehicle.name}</SelectItem>)}</SelectContent>
          </Select></div>
        <div className="min-w-0 space-y-1"><Label htmlFor="reassignment-reason">Reason for reassignment</Label>
          <Textarea className="min-w-0 max-w-full" id="reassignment-reason" data-testid="reassignment-reason" maxLength={1000} rows={3} value={reason} onChange={event => onReasonChange(event.target.value)} placeholder="Explain why the staged batch needs a new handoff destination" />
          <p className="text-xs text-muted-foreground">At least 10 characters. Your entry is preserved if live review data refreshes.</p></div>
      </div>
      {blocked && <Alert data-testid="reassignment-local-block"><AlertTriangle className="h-4 w-4" /><AlertTitle>Resolve saved movement work first</AlertTitle>
        <AlertDescription>Record or discard local movement captures and resolve any pending command outcome before confirming reassignment. No draft or inventory movement will be sent from this review.</AlertDescription></Alert>}
      <div className="flex min-w-0 flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <Button type="button" variant="outline" className="min-w-0 max-w-full whitespace-normal sm:w-auto" data-testid="reassignment-review-release" onClick={onReviewRelease}>Review / release remainder</Button>
        <Button type="button" className="h-auto min-h-10 min-w-0 w-full whitespace-normal text-left leading-tight sm:w-auto sm:max-w-full" data-testid="reassignment-confirm" disabled={!allowed || query.isFetching} onClick={() => review && onApply(review, vehicleId, reason.trim())}>
          {query.isFetching ? <Loader2 className="mr-2 h-4 w-4 shrink-0 animate-spin" /> : null}<span className="min-w-0 whitespace-normal">Confirm reassignment and reuse staged stock</span>
        </Button>
      </div>
    </>}
  </section>;
}
