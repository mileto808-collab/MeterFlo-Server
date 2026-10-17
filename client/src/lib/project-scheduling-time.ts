export function localInputForTimezone(value: string | null | undefined, timezone: string): string {
  if (!value) return "";
  // Keep rejected local input visible so the form can block submission rather
  // than silently submitting the previous valid instant.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function isoFromZonedInput(value: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid local date and time.");
  const [, ys, mos, ds, hs, mins] = match;
  const [year, month, day, hour, minute] = [ys, mos, ds, hs, mins].map(Number);
  const wallTime = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map(part => [part.type, Number(part.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instant;
  };
  const offsets = new Set<number>();
  for (let delta = -36; delta <= 36; delta += 6) offsets.add(offsetAt(wallTime + delta * 60 * 60 * 1000));
  const candidates = [...offsets].map(offset => wallTime - offset).filter(instant =>
    localInputForTimezone(new Date(instant).toISOString(), timezone) === value
  );
  if (!candidates.length) throw new Error("This local time does not exist because of a time-zone clock change.");
  if (candidates.length > 1) throw new Error("This local time occurs twice because of a time-zone clock change. Choose an unambiguous time.");
  // ISO UTC suffix is an explicit offset and preserves the chosen project-zone instant.
  return new Date(candidates[0]).toISOString();
}

export function formatProjectTimestamp(value: string | null | undefined, timezone: string): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone, year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date);
}
