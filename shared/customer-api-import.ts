import { z } from "zod";

export const importFields = {
  customerWoId: 100, customerId: 100, customerName: 100, address: 500,
  city: 100, state: 50, zip: 20, phone: 50, email: 100, route: 100, zone: 100,
  serviceType: 50, oldSystemId: 100, oldSystemReading: 100, oldGps: 100,
  oldSystemType: 100, oldModuleId: 100, oldModuleRead: 100, oldModuleType: 100,
  newSystemType: 100, newModuleType: 100,
  status: 50, notes: 10000,
  inventoryItems: 100000,
} as const;
export type ImportField = keyof typeof importFields;
export const safeUpdateFields = Object.keys(importFields).filter(
  field => !["customerWoId", "status", "notes", "inventoryItems"].includes(field),
) as ImportField[];
const path = z.string().max(200).regex(/^(?:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)?$/, "Use dot-separated property names");
const parameter = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const noSecrets = (key: string) => !/password|secret|token|api.?key|authorization|credential/i.test(key);
export const apiImportConfigSchema = z.object({
  name: z.string().trim().min(1).max(150),
  endpoint: z.string().max(2000).url().superRefine((value, ctx) => {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) {
      ctx.addIssue({ code: "custom", message: "Use HTTP(S) without embedded credentials or fragments" });
    }
    if (Array.from(url.searchParams.keys()).some(key => !noSecrets(key))) {
      ctx.addIssue({ code: "custom", message: "Credentials belong in server environment variables, not URL parameters" });
    }
  }),
  authType: z.enum(["none", "api_key", "bearer_token", "basic_auth"]).default("none"),
  secretEnvVar: z.string().max(100).regex(/^(?:[A-Z_][A-Z0-9_]*)?$/).default(""),
  keyHeader: z.string().max(100).regex(/^(?:[A-Za-z0-9-]+)?$/).default("X-API-Key"),
  recordsPath: path.default(""),
  fieldMapping: z.record(path.refine(value => !!value), z.enum(Object.keys(importFields) as [ImportField, ...ImportField[]]))
    .refine(mapping => ["customerWoId", "customerId", "customerName", "address", "serviceType"].every(field => Object.values(mapping).includes(field as ImportField)),
      "Map customerWoId, customerId, customerName, address, and serviceType")
    .refine(mapping => new Set(Object.values(mapping)).size === Object.values(mapping).length, "Map each target field only once"),
  queryParams: z.record(parameter, z.string().max(1000)).default({})
    .refine(params => Object.keys(params).every(noSecrets), "Query parameters cannot contain credentials"),
  pagination: z.enum(["none", "page", "cursor", "next_url"]).default("none"),
  pageParam: parameter.default("page"),
  startPage: z.number().int().min(0).max(1000000).default(1),
  pageSizeParam: parameter.default("limit"),
  pageSize: z.number().int().min(1).max(1000).default(100),
  nextPath: path.default(""),
  cursorParam: parameter.default("cursor"),
  resumeCursor: z.boolean().default(false),
  watermarkParam: z.string().max(100).regex(/^(?:[A-Za-z0-9_-]+)?$/).default(""),
  intervalMinutes: z.number().int().min(0).max(43200).default(0)
    .refine(value => value === 0 || value >= 15, "Schedules must be at least 15 minutes apart"),
  isEnabled: z.boolean().default(true),
  updateMode: z.enum(["create_only", "safe_update"]).default("create_only"),
  updateFields: z.array(z.enum(safeUpdateFields as [ImportField, ...ImportField[]])).max(20).default([]),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (value.authType !== "none" && !value.secretEnvVar) issue("Choose a server secret-variable name for authentication");
  if (value.authType === "api_key" && (!value.keyHeader || /^(authorization|host|cookie|connection|content-length|accept|content-type|proxy-authorization)$/i.test(value.keyHeader))) issue("Choose a non-reserved API key header");
  if (["cursor", "next_url"].includes(value.pagination) && !value.nextPath) issue("Cursor/next URL pagination needs a next-value response path");
  if (value.resumeCursor && value.pagination !== "cursor") issue("Saved cursors require cursor pagination");
  if (value.watermarkParam && !noSecrets(value.watermarkParam)) issue("Watermark parameter cannot be a credential");
  if (value.updateMode === "safe_update" && !value.updateFields.length) issue("Select baseline fields eligible for safe updates");
});
export type ApiImportSettings = z.infer<typeof apiImportConfigSchema>;
export type ApiImportConfig = ApiImportSettings & {
  id: number; projectId: number; nextRunAt: string | null; watermark: string | null;
  cursor: string | null; lastRun: ApiImportRun | null;
};
export type ImportMessage = { page?: number; row?: number; action: string; message: string };
export type ApiImportRun = {
  id: string; configId: number | null; configName: string; status: string; triggeredBy: string;
  created: number; updated: number; skipped: number; failed: number; pages: number;
  fetchAttempts: number; messages: ImportMessage[]; startedAt: string; completedAt: string | null;
  nextAttemptAt: string | null;
};
export type ApiImportPreview = {
  records: { mapped: Record<string, string | null>; valid: boolean; errors: string[] }[];
  sampleCount: number; hasMore: boolean; message: string;
};
