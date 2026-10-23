import { z } from "zod";
import { gpsFixDto } from "./gps-capture";
import { schedulingDto } from "./visitScheduling";
import { withExactReadings } from "./exact-readings";
import { replacementVisitDto } from "./defective-replacement";

const integerQuery = (min: number, max: number) => z.string().regex(/^\d+$/)
  .transform(Number).pipe(z.number().int().min(min).max(max));

// Keep legacy query additions (including ignored includeCompleted) compatible.
export const mobileDownloadQuerySchema = z.object({
  lastSyncTimestamp: z.string().datetime({ offset: true }).optional(),
  assignedUserId: z.string().min(1).max(200).optional(),
  assignedGroupId: z.string().min(1).max(200).optional(),
  status: z.string().min(1).max(120).optional(),
  limit: integerQuery(1, 10000).optional(),
  offset: integerQuery(0, Number.MAX_SAFE_INTEGER).optional(),
}).passthrough();

export type MobileDownloadQuery = z.infer<typeof mobileDownloadQuerySchema>;

export function mobileVisibilitySnapshot(query: MobileDownloadQuery, scope: {
  projectId: number; userId: string; fieldTechnician: boolean;
}, snapshotId: string, startedAt: string) {
  const paged = query.limit !== undefined || (query.offset ?? 0) > 0;
  return {
    contractVersion: 1,
    mode: query.lastSyncTimestamp ? "delta" as const : "full" as const,
    // Pages cannot be reconciled as a complete set, even if this page is empty.
    complete: !query.lastSyncTimestamp && !paged,
    snapshotId, startedAt,
    scope: {
      projectId: scope.projectId, userId: scope.userId, activeOnly: true,
      status: query.status ?? null,
      assignedUserId: scope.fieldTechnician ? null : query.assignedUserId ?? null,
      assignedGroupId: scope.fieldTechnician ? null : query.assignedGroupId ?? null,
    },
    page: { limit: query.limit ?? null, offset: query.offset ?? 0 },
    since: query.lastSyncTimestamp ?? null,
    // IDs identify this response, not a cursor or a cross-request pagination lease.
    consistency: "request" as const,
  };
}

/** Preserve legacy snake/camel fields while adding a consistent read contract. */
export function mobileWorkOrderDto<T extends Record<string, any>>(row: T) {
  return {
    ...withExactReadings(row),
    assignmentVersion: row.assignmentVersion ?? row.assignment_version ?? 0,
    subStatusId: row.subStatusId ?? row.sub_status_id ?? null,
    inventoryDispatch: row.inventoryDispatch ?? null,
    replacementVisit: row.replacementVisit ?? replacementVisitDto(row),
    ...schedulingDto({
      service_duration_minutes: row.service_duration_minutes ?? row.serviceDurationMinutes,
      appointment_window_start: row.appointment_window_start ?? row.appointmentWindowStart,
      appointment_window_end: row.appointment_window_end ?? row.appointmentWindowEnd,
    }),
    ...(Object.hasOwn(row, "gpsCapture") ? { gpsCapture: row.gpsCapture } : gpsFixDto(row)),
  };
}
