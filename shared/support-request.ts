export const SUPPORT_ATTACHMENT_LIMITS = {
  maxFiles: 5, maxFileBytes: 5 * 1024 * 1024, maxTotalBytes: 15 * 1024 * 1024,
} as const;

export const SUPPORT_ATTACHMENT_TYPES: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif",
  ".pdf": "application/pdf", ".txt": "text/plain", ".log": "text/plain", ".csv": "text/csv",
  ".json": "application/json", ".zip": "application/zip",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export const SUPPORT_ATTACHMENT_ACCEPT = Object.keys(SUPPORT_ATTACHMENT_TYPES).join(",");
export function supportAttachmentName(name: string): string {
  return (name.split(/[\\/]/).pop() || "").replace(/[\x00-\x1f\x7f]/g, "").slice(0, 180);
}
export function supportAttachmentType(name: string): string | undefined {
  const clean = supportAttachmentName(name);
  return SUPPORT_ATTACHMENT_TYPES[clean.slice(clean.lastIndexOf(".")).toLowerCase()];
}
export function validateSupportAttachments(files: Array<{ name: string; size: number }>): string | null {
  const limits = SUPPORT_ATTACHMENT_LIMITS;
  if (files.length > limits.maxFiles) return "Attach up to 5 files.";
  for (const file of files) {
    if (!supportAttachmentType(file.name)) return "Unsupported attachment type. Use screenshots, PDFs, text/logs, CSV/JSON, Word/Excel files, or ZIP archives.";
    if (!Number.isSafeInteger(file.size) || file.size < 0) return "Invalid attachment size.";
    if (file.size > limits.maxFileBytes) return "Each attachment must be 5 MB or smaller.";
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > limits.maxTotalBytes) return "Attachments must total 15 MB or less.";
  return null;
}
