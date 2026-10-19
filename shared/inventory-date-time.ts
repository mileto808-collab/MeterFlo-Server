/** Human-facing inventory timestamps; stored timestamps remain unchanged. */
export function inventoryDateTime(value: string | Date | null | undefined, timezone = "UTC"): string {
  if (!value) return "Not recorded";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Invalid date";
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZoneName: "short",
    });
  } catch {
    return `${inventoryDateTime(date, "UTC")} (project timezone unavailable)`;
  }
  return formatter.format(date);
}
