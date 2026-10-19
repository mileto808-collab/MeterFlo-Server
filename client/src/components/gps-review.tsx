import { useState } from "react";
import type { FormEvent } from "react";
import type { GpsFix } from "@shared/gps-capture";
import { MapPin, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type GpsReviewProps = {
  fix: GpsFix | null;
  status: "idle" | "capturing" | "success" | "error";
  error: string | null;
  coordinates: string;
  timezone?: string | null;
  accuracyLimit?: number | null;
  onRetry: () => void;
  onReuse?: () => void;
  onManual?: (value: string) => void;
  disabled?: boolean;
};

function sourceLabel(fix: GpsFix | null): string | null {
  if (!fix) return null;

  switch (fix.source) {
    case "native":
      return fix.receiver === "external" ? "External GNSS receiver" : "Native device location";
    case "browser":
      return "Browser location (hardware not identified)";
    case "manual":
      return "Manually entered";
    case "existing":
      return "Saved position";
    case "geocode":
      return "Address-derived location";
  }
}

function formatCaptureTime(value: string, timezone?: string | null) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const preferredZone = timezone?.trim() || "UTC";
  let formatted: string;
  let usedZone = preferredZone;
  try {
    formatted = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: preferredZone,
    }).format(date);
  } catch {
    usedZone = "UTC";
    formatted = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date);
  }

  const ageMs = Date.now() - date.getTime();
  const age = ageMs < 0
    ? "in the future"
    : ageMs < 60_000
      ? "just now"
      : ageMs < 3_600_000
        ? `${Math.floor(ageMs / 60_000)} min ago`
        : ageMs < 86_400_000
          ? `${Math.floor(ageMs / 3_600_000)} hr ago`
          : `${Math.floor(ageMs / 86_400_000)} days ago`;

  return { formatted, age, timezone: usedZone };
}

function formatAccuracy(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${value < 10 ? value.toFixed(1) : Math.round(value)} m`
    : null;
}

export function GpsReview({
  fix,
  status,
  error,
  coordinates,
  timezone,
  accuracyLimit,
  onRetry,
  onReuse,
  onManual,
  disabled = false,
}: GpsReviewProps) {
  const [manualValue, setManualValue] = useState(coordinates);
  const displayCoordinates = fix?.coordinates || coordinates;
  const captureTime = fix?.capturedAt && fix.source !== "manual" && fix.source !== "existing"
    ? formatCaptureTime(fix.capturedAt, timezone)
    : null;
  const accuracy = fix && fix.source !== "manual" && fix.source !== "existing"
    ? formatAccuracy(fix.accuracy)
    : null;
  const configuredLimit = formatAccuracy(accuracyLimit);

  const submitManual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = manualValue.trim();
    if (value && !disabled) onManual?.(value);
  };

  const statusText = status === "capturing"
    ? "Capturing location…"
    : status === "error"
      ? "Location unavailable"
      : fix
        ? fix.source === "manual" ? "Manual entry" : fix.source === "existing" ? "Saved position—not a fresh capture" : "Location captured"
        : displayCoordinates
          ? "Saved position—not a fresh capture"
        : "Location not captured";

  return (
    <section aria-label="GPS location review" className="space-y-3 border-t pt-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <MapPin aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h4 className="text-sm font-semibold">GPS location</h4>
              <span className="text-xs text-muted-foreground" role="status">{statusText}</span>
            </div>
            {displayCoordinates ? (
              <p className="mt-1 break-all font-mono text-sm">{displayCoordinates}</p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {status === "capturing" ? "Waiting for a location fix." : "No coordinates available."}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          {onReuse && (
            <Button type="button" variant="outline" size="sm" onClick={onReuse} disabled={disabled || status === "capturing"}>
              <RotateCcw aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
              Reuse
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={disabled || status === "capturing"}>
            <MapPin aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
            {status === "capturing" ? "Capturing…" : "Retry"}
          </Button>
        </div>
      </div>

      {(fix || displayCoordinates || configuredLimit || error) && (
        <dl className="grid grid-cols-1 gap-x-5 gap-y-1 pl-[26px] text-xs sm:grid-cols-2">
          {(fix || displayCoordinates) && (
            <div className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 text-muted-foreground">Source</dt>
              <dd>{sourceLabel(fix) || "Saved coordinates"}</dd>
            </div>
          )}
          {fix && ["native", "browser"].includes(fix.source) && (
            <div className="flex gap-1.5">
              <dt className="shrink-0 text-muted-foreground">Reported accuracy</dt>
              <dd>{accuracy || "Unknown (not reported)"}</dd>
            </div>
          )}
          {captureTime && (
            <div className="flex flex-wrap gap-x-1.5">
              <dt className="shrink-0 text-muted-foreground">Captured</dt>
              <dd>{captureTime.formatted} ({captureTime.timezone}) · {captureTime.age}</dd>
            </div>
          )}
          {configuredLimit && (
            <div className="flex gap-1.5">
              <dt className="shrink-0 text-muted-foreground">Accuracy target</dt>
              <dd>≤ {configuredLimit}</dd>
            </div>
          )}
          {error && (
            <div className="text-destructive sm:col-span-2" role="alert">{error}</div>
          )}
        </dl>
      )}

      {onManual && (
        <details className="pl-[26px] text-sm">
          <summary className="w-fit cursor-pointer text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground">
            Enter coordinates manually
          </summary>
          <form onSubmit={submitManual} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="gps-review-manual">Latitude, longitude</Label>
              <Input
                id="gps-review-manual"
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
                placeholder="e.g. 40.7128, -74.0060"
                autoComplete="off"
                disabled={disabled}
              />
            </div>
            <Button type="submit" variant="outline" size="sm" disabled={disabled || !manualValue.trim()}>
              <Save aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />
              Use coordinates
            </Button>
          </form>
        </details>
      )}
    </section>
  );
}

export default GpsReview;
