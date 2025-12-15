import { parseISO } from "date-fns";
import { toZonedTime, format as formatTz } from "date-fns-tz";

let cachedTimezone: string | null = null;

const DEFAULT_TIMEZONE = "America/Denver";

export async function getConfiguredTimezone(): Promise<string> {
  if (cachedTimezone) {
    return cachedTimezone;
  }
  
  try {
    const res = await fetch("/api/settings/timezone", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      const tz = data.timezone || DEFAULT_TIMEZONE;
      cachedTimezone = tz;
      return tz;
    }
  } catch (error) {
    console.error("Failed to fetch timezone setting:", error);
  }
  
  return DEFAULT_TIMEZONE;
}

export function clearTimezoneCache(): void {
  cachedTimezone = null;
}

export function formatInTimezone(
  date: string | Date | null | undefined,
  timezone: string,
  formatStr: string = "MM/dd/yyyy hh:mm a"
): string {
  if (!date) return "";
  
  try {
    const dateObj = typeof date === "string" ? parseISO(date) : date;
    const zonedDate = toZonedTime(dateObj, timezone);
    return formatTz(zonedDate, formatStr, { timeZone: timezone });
  } catch (error) {
    console.error("Error formatting date:", error);
    return typeof date === "string" ? date : String(date);
  }
}

export function formatDateInTimezone(
  date: string | Date | null | undefined,
  timezone: string
): string {
  return formatInTimezone(date, timezone, "MM/dd/yyyy");
}

export function formatDateTimeInTimezone(
  date: string | Date | null | undefined,
  timezone: string
): string {
  return formatInTimezone(date, timezone, "MM/dd/yyyy hh:mm a");
}

export function formatTimeInTimezone(
  date: string | Date | null | undefined,
  timezone: string
): string {
  return formatInTimezone(date, timezone, "hh:mm a");
}

export function formatISOInTimezone(
  date: string | Date | null | undefined,
  timezone: string
): string {
  return formatInTimezone(date, timezone, "yyyy-MM-dd'T'HH:mm:ss");
}

export function formatForExport(
  date: string | Date | null | undefined,
  timezone: string
): string {
  return formatInTimezone(date, timezone, "yyyy-MM-dd HH:mm:ss");
}
