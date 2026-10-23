import { z } from "zod";

export const backupTypes = ["recovery", "database", "clean", "files", "project"] as const;
export const backupTypeLabels = {
  recovery: "Complete recovery — database + project files",
  database: "Database + all project databases",
  clean: "Clean configuration database",
  files: "Web application source files",
  project: "Project documents and attachments",
} as const;
export const backupDestinationSchema = z.object({
  kind: z.enum(["local", "app_storage"]),
  path: z.string().trim().min(1).max(500),
  bucketId: z.string().trim().max(200).default(""),
}).refine(value => value.kind !== "app_storage" || value.bucketId.length > 0,
  { path: ["bucketId"], message: "Enter the private App Storage bucket ID." });
export const backupScheduleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  backupType: z.enum(backupTypes),
  cron: z.string().trim().min(5).max(120),
  timezone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
  }, "Choose a valid timezone."),
  enabled: z.boolean().default(false),
  retentionDays: z.number().int().min(1).max(3650),
  minimumCopies: z.number().int().min(1).max(100),
});
export type BackupDestination = z.infer<typeof backupDestinationSchema>;
export type BackupScheduleInput = z.infer<typeof backupScheduleSchema>;
export interface BackupSchedule extends BackupScheduleInput {
  id: string;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface BackupRun {
  id: string;
  scheduleId: string;
  scheduleName: string;
  backupType: typeof backupTypes[number];
  trigger: "scheduled" | "manual";
  status: "queued" | "running" | "succeeded" | "failed" | "interrupted" | "cancelled" | "expired";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  bytes: number | null;
  error: string | null;
  cleanupError: string | null;
  destination: BackupDestination;
}
export interface BackupDashboard {
  destination: BackupDestination | null;
  schedules: BackupSchedule[];
  defaultTimezone: string;
  localAllowed: boolean;
  hostingNotice: string;
}
