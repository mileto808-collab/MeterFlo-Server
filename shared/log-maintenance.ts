import { z } from "zod";

export const logCategories = ["errorArchives", "activeError", "customerApi", "apiImports", "databaseImports", "fileImports"] as const;
export type LogCategory = typeof logCategories[number];
export const logPolicySchema = z.object({
  automatic: z.boolean(),
  rotationMiB: z.number().int().min(1).max(100),
  archiveDays: z.number().int().min(1).max(3650),
  archiveBudgetMiB: z.number().int().min(10).max(10000),
  historyDays: z.number().int().min(1).max(3650),
}).strict();
export type LogPolicy = z.infer<typeof logPolicySchema>;
export const defaultLogPolicy: LogPolicy = { automatic: false, rotationMiB: 10, archiveDays: 30, archiveBudgetMiB: 200, historyDays: 90 };
export const cleanupFilterSchema = z.object({
  categories: z.array(z.enum(logCategories)).min(1).max(6),
  projectId: z.number().int().positive().optional(),
  before: z.string().datetime(),
}).strict();
export type CleanupFilter = z.infer<typeof cleanupFilterSchema>;
export interface LogInventory {
  category: LogCategory;
  count: number;
  bytes: number;
  protectedCount: number;
  oldest: string | null;
  newest: string | null;
}
export interface CleanupResult {
  action?: "cleanup" | "policySaved";
  at: string;
  actor: string;
  removed: number;
  skipped: number;
  bytes: number;
  errors: string[];
}
export interface LogSummary {
  policy: LogPolicy;
  inventory: LogInventory[];
  projects: { id: number; name: string }[];
  history: CleanupResult[];
  protectedBytes: number;
  warnings: string[];
}
export interface CleanupPreview {
  token: string;
  expiresAt: string;
  count: number;
  bytes: number;
  limited: boolean;
  filter: CleanupFilter;
}
