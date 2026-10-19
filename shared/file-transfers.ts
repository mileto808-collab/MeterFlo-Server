import { z } from "zod";
export const transferFrequencies = ["manual", "every_15_minutes", "every_30_minutes", "hourly", "every_2_hours", "every_6_hours", "every_12_hours", "daily", "weekly", "monthly", "custom"] as const;
export const transferSelection = z.object({
  mode: z.enum(["full", "changed"]).default("full"),
  allStatuses: z.boolean().default(true),
  statusIds: z.array(z.number().int().positive()).max(200).default([]),
  subStatusIds: z.array(z.string().uuid()).max(500).default([]),
});
export const exportConfigInput = transferSelection.extend({
  name: z.string().trim().min(1).max(150),
  format: z.enum(["csv", "xlsx", "json"]).default("csv"),
  filenameTemplate: z.string().trim().min(1).max(180).default("work_orders_{YYYY}{MM}{DD}_{HH}{mm}{ss}_{runId}"),
  columns: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/)).min(1).max(200),
  destination: z.enum(["local", "sftp"]).default("local"),
  remoteDirectory: z.string().trim().max(500).default(""),
  scheduleFrequency: z.enum(transferFrequencies).default("manual"),
  customCronExpression: z.string().trim().max(100).nullable().default(null),
  isEnabled: z.boolean().default(false),
});
export const exportRunInput = transferSelection.partial();
export const sftpConnectionInput = z.object({
  name: z.string().trim().min(1).max(150),
  host: z.string().trim().min(1).max(253).regex(/^[A-Za-z0-9.:[\]_-]+$/),
  port: z.number().int().min(1).max(65535).default(22),
  username: z.string().trim().min(1).max(200),
  hostFingerprint: z.string().trim().regex(/^SHA256:[A-Za-z0-9+/]{43}=?$/, "Use the SSH server's verified SHA256 host-key fingerprint."),
  authType: z.enum(["password", "privateKey"]),
  password: z.string().max(4096).optional(),
  privateKey: z.string().max(32768).optional(),
  passphrase: z.string().max(4096).optional(),
});
export type ExportConfigInput = z.infer<typeof exportConfigInput>;
export type ExportSelection = z.infer<typeof transferSelection>;
export type SftpPublic = Omit<z.infer<typeof sftpConnectionInput>, "password" | "privateKey" | "passphrase"> & { hasCredentials: boolean };
export type ExportConfig = ExportConfigInput & { id: string; projectId: number; nextRunAt: string | null; lastRunAt: string | null; lastRunStatus: string | null; lastRunMessage: string | null; createdAt: string };
export interface TransferContext {
  connection: SftpPublic | null; exports: ExportConfig[];
  statuses: { id: number; code: string; label: string }[];
  subStatuses: { id: string; label: string; parentStatusId: number }[];
  fields: string[]; timezone: string;
  permissions: { canImport: boolean; canExport: boolean; canManageConnection: boolean };
}
export interface TransferHistory {
  id: string; direction: "import" | "export"; configName: string; fileName: string | null;
  status: string; recordCount: number; recordsFailed: number; message: string | null;
  createdAt: string; completedAt: string | null; destination: string;
  exportRunId: string | null; attempts: number;
  attemptLog?: { status: string; message: string | null; startedAt: string; completedAt: string | null }[];
}
