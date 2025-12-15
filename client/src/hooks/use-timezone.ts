import { useQuery } from "@tanstack/react-query";
import { formatInTimezone, formatDateInTimezone, formatDateTimeInTimezone, formatForExport } from "@/lib/timezone";

const DEFAULT_TIMEZONE = "America/Denver";

export function useTimezone() {
  const { data: timezoneData } = useQuery<{ timezone: string }>({
    queryKey: ["/api/settings/timezone"],
    staleTime: 5 * 60 * 1000,
  });

  const timezone = timezoneData?.timezone || DEFAULT_TIMEZONE;

  const formatDate = (date: string | Date | null | undefined): string => {
    return formatDateInTimezone(date, timezone);
  };

  const formatDateTime = (date: string | Date | null | undefined): string => {
    return formatDateTimeInTimezone(date, timezone);
  };

  const formatCustom = (date: string | Date | null | undefined, formatStr: string): string => {
    return formatInTimezone(date, timezone, formatStr);
  };

  const formatExport = (date: string | Date | null | undefined): string => {
    return formatForExport(date, timezone);
  };

  return {
    timezone,
    formatDate,
    formatDateTime,
    formatCustom,
    formatExport,
  };
}
