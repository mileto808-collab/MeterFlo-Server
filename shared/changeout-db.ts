import { pgTable, uuid, integer, text, jsonb, timestamp, bigserial, primaryKey, index, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { projects } from "./schema";

// Captures are temporary editing snapshots, not a parallel work-order ledger.
export const changeoutDrafts = pgTable("changeout_drafts", {
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }), workOrderId: integer("work_order_id").notNull(),
  userId: text("user_id").notNull(), submissionId: uuid("submission_id").notNull(),
  assignmentVersion: integer("assignment_version").notNull(), revision: integer("revision").notNull(),
  step: text("step").notNull(), capture: jsonb("capture").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [primaryKey({ columns: [t.projectId, t.workOrderId, t.userId, t.submissionId] })]);

// The accepted evidence is immutable. Only the processing/review fields change.
export const changeoutCompletions = pgTable("changeout_completions", {
  id: uuid("id").primaryKey(), projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }), workOrderId: integer("work_order_id").notNull(),
  actorId: text("actor_id").notNull(), actorLabel: text("actor_label").notNull(), fingerprint: text("fingerprint").notNull(),
  assignmentVersion: integer("assignment_version").notNull(), evidence: jsonb("evidence").notNull(),
  status: text("status").notNull(), attempts: integer("attempts").default(0).notNull(),
  error: text("error"), nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedUsage: jsonb("reviewed_usage"), reviewedBy: text("reviewed_by"), reviewReason: text("review_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, t => [index("changeout_completion_queue").on(t.status, t.nextAttemptAt),
  index("changeout_completion_project_history").on(t.projectId, t.createdAt)]);

// Short-lived exclusivity for accepted installations while inventory catches up.
export const changeoutInstallationClaims = pgTable("changeout_installation_claims", {
  projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }), itemId: text("item_id").notNull(), serial: text("serial").notNull(),
  workOrderId: integer("work_order_id").notNull(), completionId: uuid("completion_id").notNull().references(() => changeoutCompletions.id, { onDelete: "cascade" }),
  active: boolean("active").default(true).notNull(),
}, t => [primaryKey({ columns: [t.projectId, t.itemId, t.serial] })]);

export const changeoutEvents = pgTable("changeout_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(), projectId: integer("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  workOrderId: integer("work_order_id"), type: text("type").notNull(), actorId: text("actor_id"),
  operationId: text("operation_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [uniqueIndex("changeout_event_operation").on(t.projectId, t.workOrderId, t.type, t.operationId)]);
