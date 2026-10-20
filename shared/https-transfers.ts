import { z } from "zod";
export const httpsCredentialInput = z.object({
  name: z.string().trim().min(1).max(120),
  canUpload: z.boolean().default(true), canDownload: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(365).default(90),
}).refine(v => v.canUpload || v.canDownload, "Choose upload or download access.");
export const httpsSettingsInput = z.object({
  enabled: z.boolean(), location: z.string().trim().max(500).default(""),
  retentionDays: z.number().int().min(1).max(3650).default(30),
});
export interface HttpsCredential {
  id: string; name: string; canUpload: boolean; canDownload: boolean; tokenPrefix: string;
  expiresAt: string; revokedAt: string | null; createdAt: string; lastUsedAt: string | null;
}
export interface HttpsFile {
  id: string; direction: "inbox" | "outbox"; fileName: string; size: number; sha256: string;
  status: string; message: string | null; credentialName: string | null; exportRunId: string | null;
  createdAt: string; processedAt: string | null; acknowledgedAt: string | null;
}
export interface HttpsContext {
  settings: { enabled: boolean; provider: "local" | "app_storage"; location: string; retentionDays: number };
  storage: { available: boolean; message: string };
  credentials: HttpsCredential[]; timezone: string; apiPath: string;
  maxUploadMB: number; canManage: boolean; canImport: boolean; canExport: boolean;
}
export interface HttpsFilePage { rows: HttpsFile[]; total: number; timezone: string }
export interface HttpsEvent {
  id: string; action: string; fileName: string | null; credentialName: string | null;
  message: string; createdAt: string;
}
