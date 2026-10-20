import { z } from "zod";

export const databaseLogCategories = ["customerApi", "apiImports", "databaseImports", "fileImports", "fileExports", "sftpActivity", "httpsActivity"] as const;
const originalHistoryCategories = ["customerApi", "apiImports", "databaseImports", "fileImports"] as const;
export const importHistoryCategories = ["apiImports", "databaseImports", "fileImports"] as const;
export const logCategories = ["errorArchives", "activeError", ...databaseLogCategories] as const;
export type LogCategory = typeof logCategories[number];
export const logCategoryLabels: Record<LogCategory, string> = {
  errorArchives: "Archived error reports", activeError: "Active error reports",
  customerApi: "Customer API attempt history", apiImports: "API import history",
  databaseImports: "External database import history", fileImports: "File import history (manual & scheduled)",
  fileExports: "File export attempt history", sftpActivity: "SFTP activity", httpsActivity: "HTTPS transfer activity",
};
export const logCategoryDescriptions: Record<LogCategory, string> = {
  errorArchives: "Rotated MeterFlo error-log files only.",
  activeError: "Manual only: clears an unchanged active error.log without replacing its file. Never cleared automatically.",
  customerApi: "Resolved delivery attempts only. Pending/failed/retryable deliveries and their payloads stay protected.",
  apiImports: "Completed API import runs. Latest completed diagnostics and unsuccessful configured runs with retry checkpoints stay protected; detached failed/partial histories are manual-only.",
  databaseImports: "Completed external database imports. Latest completed diagnostics per configuration stay protected.",
  fileImports: "Completed manual and scheduled file imports. Latest completed scheduled diagnostics stay protected.",
  fileExports: "Attempt details from older successful export runs only. Latest runs, failed/retryable runs, files and checkpoints are retained.",
  sftpActivity: "Connection, authentication and file-operation event history, including past failures. Accounts and files are not removed.",
  httpsActivity: "HTTPS file-transfer event history. Credentials, stored files, receipts and replay protection are not removed.",
};
export const logPolicySchema = z.object({
  automatic: z.boolean(),
  rotationMiB: z.number().int().min(1).max(100),
  archiveDays: z.number().int().min(1).max(3650),
  archiveBudgetMiB: z.number().int().min(10).max(10000),
  historyDays: z.number().int().min(1).max(3650),
  // Older saved policies retain exactly their previous category scope.
  historyCategories: z.array(z.enum(databaseLogCategories)).max(databaseLogCategories.length)
    .refine(values => new Set(values).size === values.length, "Choose each category once.")
    .default([...originalHistoryCategories]),
}).strict();
export type LogPolicy = z.infer<typeof logPolicySchema>;
export const defaultLogPolicy: LogPolicy = { automatic: false, rotationMiB: 10, archiveDays: 30, archiveBudgetMiB: 200, historyDays: 90, historyCategories: [...originalHistoryCategories] };
export const cleanupFilterSchema = z.object({
  categories: z.array(z.enum(logCategories)).min(1).max(logCategories.length)
    .refine(values => new Set(values).size === values.length, "Choose each category once."),
  projectId: z.number().int().positive().optional(),
  before: z.string().datetime(),
  includeFailedImports: z.boolean().optional(),
}).strict();
export type CleanupFilter = z.infer<typeof cleanupFilterSchema>;
export interface LogInventory {
  category: LogCategory;
  count: number;
  bytes: number;
  protectedCount: number;
  manualOnlyCount?: number;
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
  categories?: LogCategory[];
  includeFailedImports?: boolean;
  projectId?: number;
  before?: string;
}
export interface LogSummary {
  policy: LogPolicy;
  inventory: LogInventory[];
  projects: { id: number; name: string }[];
  history: CleanupResult[];
  protectedBytes: number;
  warnings: string[];
  auditInventory?: { count:number;bytes:number;oldest:string|null;newest:string|null };
}
export interface CleanupPreview {
  token: string;
  expiresAt: string;
  count: number;
  bytes: number;
  limited: boolean;
  filter: CleanupFilter;
}
