import { useState } from "react";
import { AlertTriangle, ExternalLink, MapPin, Wrench } from "lucide-react";
import type { AddressReview } from "@shared/workOrderRouting";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

type AddressMatchReviewPanelProps = {
  reviews: AddressReview[];
  busy: boolean;
  onConfirm: (tokens: string[]) => void;
  onCancel: () => void;
  onCorrectWorkOrder?: (id: number) => void;
};

export function AddressMatchReviewPanel({
  reviews,
  busy,
  onConfirm,
  onCancel,
  onCorrectWorkOrder,
}: AddressMatchReviewPanelProps) {
  const reviewTokensKey = JSON.stringify(reviews.map(review => review.token));
  const [confirmationState, setConfirmationState] = useState<{ key: string; tokens: Set<string> }>(() => ({
    key: reviewTokensKey,
    tokens: new Set(),
  }));
  const confirmed = confirmationState.key === reviewTokensKey ? confirmationState.tokens : new Set<string>();

  const allConfirmed = reviews.length > 0 && reviews.every(review => confirmed.has(review.token));

  const setReviewConfirmed = (token: string, checked: boolean) => {
    setConfirmationState(current => {
      const selected = current.key === reviewTokensKey ? current.tokens : new Set<string>();
      const next = new Set(selected);
      if (checked) next.add(token);
      else next.delete(token);
      return { key: reviewTokensKey, tokens: next };
    });
  };

  const confirmAll = () => {
    if (!busy && allConfirmed) onConfirm(reviews.map(review => review.token));
  };

  return (
    <section className="w-full min-w-0 space-y-4" data-testid="address-match-review">
      <header className="space-y-2">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 text-amber-800">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold leading-6">Review matched locations</h2>
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              Check each address against the submitted location before continuing. Nothing is confirmed until you approve every match.
            </p>
          </div>
        </div>
        <div role="note" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm leading-5 text-amber-950">
          Provider confidence is only a suggestion. It does not prove this is the correct property or service location.
        </div>
      </header>

      <div className="space-y-3">
        {reviews.map((review, index) => {
          const mapsSearch = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${review.point.lat},${review.point.lng}`)}`;
          const checkboxId = `address-match-confirm-${review.id}`;

          return (
            <article
              key={`${review.id}-${review.token}`}
              className="min-w-0 rounded-lg border bg-card p-3 sm:p-4"
              data-testid={`address-review-${review.id}`}
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b pb-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {review.kind === "origin" ? "Starting location" : `Stop ${index + 1}`}
                  </p>
                  <h3 className="mt-0.5 break-words text-sm font-semibold">{review.label}</h3>
                </div>
                {review.kind === "stop" && review.workOrderId !== undefined && onCorrectWorkOrder && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-9 max-w-full shrink-0"
                    onClick={() => onCorrectWorkOrder(review.workOrderId!)}
                    data-testid={`address-correct-${review.id}`}
                  >
                    <Wrench className="mr-2 h-4 w-4" aria-hidden="true" />
                    Correct work order
                  </Button>
                )}
              </div>

              <div className="grid min-w-0 gap-3 py-3 sm:grid-cols-2 sm:gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">Submitted address</p>
                  <p className="mt-1 break-words text-sm leading-5">{review.submittedAddress || "No address provided"}</p>
                </div>
                <div className="min-w-0 border-t pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
                  <p className="text-xs font-medium text-muted-foreground">Provider-matched address</p>
                  <p className="mt-1 break-words text-sm font-medium leading-5">{review.resolvedAddress || "No matched address returned"}</p>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-2 border-t pt-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-2 text-sm">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Matched coordinates</p>
                    <p className="mt-0.5 break-all font-mono text-xs leading-5">
                      {review.point.lat}, {review.point.lng}
                    </p>
                  </div>
                </div>
                <a
                  href={mapsSearch}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-9 w-fit max-w-full items-center gap-1.5 rounded-md text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  aria-label={`Inspect coordinates for ${review.label} in Google Maps`}
                >
                  Inspect in Google Maps
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </a>
              </div>

              <div className="mt-3 min-w-0 rounded-md bg-muted/60 px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground">Why this match needs review</p>
                {review.reasons.length > 0 ? (
                  <ul className="mt-1 space-y-1 text-sm leading-5">
                    {review.reasons.map((reason, reasonIndex) => (
                      <li key={`${reasonIndex}-${reason}`} className="break-words">{reason}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">No additional reasons were provided.</p>
                )}
              </div>

              <div className="mt-3 border-t pt-3">
                <div className="flex min-w-0 items-start gap-3">
                  <Checkbox
                    id={checkboxId}
                    checked={confirmed.has(review.token)}
                    onCheckedChange={value => setReviewConfirmed(review.token, value === true)}
                    disabled={busy}
                    className="mt-0.5 h-5 w-5"
                    data-testid={`address-confirm-${review.id}`}
                    aria-label={`Confirm the matched location for ${review.label}`}
                  />
                  <label htmlFor={checkboxId} className="min-w-0 cursor-pointer text-sm leading-5">
                    I checked this address and coordinates; this is the location intended for <span className="font-medium">{review.label}</span>.
                  </label>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <footer className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="outline"
          className="min-h-10 w-full sm:w-auto"
          onClick={onCancel}
          data-testid="address-review-cancel"
        >
          Back to setup
        </Button>
        <div className="flex min-w-0 flex-col gap-2 sm:items-end">
          <p className="text-xs text-muted-foreground sm:text-right" aria-live="polite">
            {allConfirmed ? "All locations reviewed." : `${reviews.filter(review => confirmed.has(review.token)).length} of ${reviews.length} locations reviewed`}
          </p>
          <Button
            type="button"
            className="min-h-10 w-full sm:w-auto"
            disabled={!allConfirmed || busy}
            onClick={confirmAll}
            data-testid="address-review-submit"
          >
            {busy ? "Confirming locations…" : "Confirm all locations"}
          </Button>
        </div>
      </footer>
    </section>
  );
}

export default AddressMatchReviewPanel;
