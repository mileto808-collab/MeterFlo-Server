export function LiveConnectionIndicator({ status, label, testId }: {
  status: "connecting" | "live" | "reconnecting";
  label: string;
  testId: string;
}) {
  const text = status === "live" ? "Live" : status === "reconnecting" ? "Reconnecting" : "Connecting";
  return <span role="status" aria-live="polite" aria-label={`${label} connection ${status}`}
    title={status === "live" ? `Live ${label.toLowerCase()} updates are connected` : `${label} updates: ${text.toLowerCase()}`}
    data-testid={testId} data-status={status}
    className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium text-muted-foreground sm:px-2.5 sm:text-xs">
    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${status === "live" ? "bg-emerald-600" : status === "reconnecting" ? "bg-amber-600" : "bg-muted-foreground"}`} />
    <span aria-hidden="true" className="hidden sm:inline">{text}</span>
    <span className="sr-only">{label} updates: {text}</span>
  </span>;
}
