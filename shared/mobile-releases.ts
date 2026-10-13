import { z } from "zod";

export const APK_CHUNK_SIZE = 5 * 1024 * 1024;
export const APK_MAX_SIZE = 512 * 1024 * 1024;
export const apkMetadataSchema = z.object({
  version: z.string().trim().min(1).max(64).regex(/^[^\x00-\x1f\x7f]+$/, "Version cannot contain control characters"),
  buildCode: z.number().int().min(1).max(2100000000).nullable().optional().default(null),
  notes: z.string().trim().max(5000).optional().default(""),
}).strict();
export const apkUploadSchema = z.object({
  fileName: z.string().min(5).max(180).regex(/^[a-zA-Z0-9][a-zA-Z0-9._ ()-]*\.apk$/i, "Use an APK filename without path separators or special characters"),
  totalSize: z.number().int().positive().max(APK_MAX_SIZE),
  totalChunks: z.number().int().positive().max(Math.ceil(APK_MAX_SIZE / APK_CHUNK_SIZE)),
  metadata: apkMetadataSchema,
}).strict().refine(input => input.totalChunks === Math.ceil(input.totalSize / APK_CHUNK_SIZE), {
  message: "Chunk count must match the file size",
});
export type ApkMetadata = z.infer<typeof apkMetadataSchema>;
export interface MobileRelease {
  id: string;
  version: string;
  buildCode: number | null;
  notes: string;
  fileName: string;
  size: number;
  sha256: string;
  uploadedAt: string;
  publishedAt: string | null;
}
export interface MobileReleaseList {
  releases: MobileRelease[];
  latestId: string | null;
  pendingCleanup: number;
  storage: { provider: string; available: boolean; message: string; maxSizeMB: number };
}
