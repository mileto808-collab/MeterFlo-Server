import { sql } from "drizzle-orm";
import { pgTable, integer, text, uuid, timestamp, bigint, boolean, index, check } from "drizzle-orm/pg-core";
export const backupDestination = pgTable("backup_destination", {
  id: integer("id").primaryKey(), kind: text("kind").notNull(), path: text("path").notNull(),
  bucketId: text("bucket_id").notNull().default(""), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [check("backup_destination_id_check", sql`${t.id}=1`),
  check("backup_destination_kind_check", sql`${t.kind} IN ('local','app_storage')`)]);
export const backupSchedules = pgTable("backup_schedules", {
  id: uuid("id").primaryKey(), name: text("name").notNull(), backupType: text("backup_type").notNull(),
  cron: text("cron").notNull(), timezone: text("timezone").notNull(), enabled: boolean("enabled").notNull().default(false),
  retentionDays: integer("retention_days").notNull(), minimumCopies: integer("minimum_copies").notNull(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }), deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [check("backup_schedules_backup_type_check", sql`${t.backupType} IN ('recovery','database','clean','files','project')`),
  check("backup_schedules_retention_days_check", sql`${t.retentionDays} BETWEEN 1 AND 3650`),
  check("backup_schedules_minimum_copies_check", sql`${t.minimumCopies} BETWEEN 1 AND 100`),
  index("backup_schedules_due").on(t.nextRunAt).where(sql`${t.enabled} AND ${t.deletedAt} IS NULL`)]);
export const backupRuns = pgTable("backup_runs", {
  id: uuid("id").primaryKey(), scheduleId: uuid("schedule_id").notNull().references(() => backupSchedules.id),
  scheduleName: text("schedule_name").notNull(), backupType: text("backup_type").notNull(), trigger: text("trigger").notNull(),
  status: text("status").notNull(), destinationKind: text("destination_kind").notNull(), destinationPath: text("destination_path").notNull(),
  bucketId: text("bucket_id").notNull().default(""), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp("started_at", { withTimezone: true }), completedAt: timestamp("completed_at", { withTimezone: true }),
  bytes: bigint("bytes", { mode: "number" }), error: text("error"), cleanupError: text("cleanup_error"),
}, t => [check("backup_runs_backup_type_check", sql`${t.backupType} IN ('recovery','database','clean','files','project')`),
  check("backup_runs_trigger_check", sql`${t.trigger} IN ('scheduled','manual')`),
  check("backup_runs_status_check", sql`${t.status} IN ('queued','running','succeeded','failed','interrupted','cancelled','expired')`),
  check("backup_runs_destination_kind_check", sql`${t.destinationKind} IN ('local','app_storage')`),
  index("backup_runs_history").on(t.createdAt.desc()), index("backup_runs_schedule").on(t.scheduleId, t.completedAt.desc())]);
