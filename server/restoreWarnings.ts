import type { RequestHandler } from "express";

// Restore diagnostics can contain SQL values or connection credentials. Share
// the same safe text with the administrator and the logs, never the SQL script.
export function safeRestoreWarning(warning: string): string {
  return warning
    .replace(/\b(?:postgres(?:ql)?|https?):\/\/[^\s]+/gi, "[connection URL redacted]")
    .replace(/\b(?:password|passwd|pwd|token|secret|api[_-]?key)\s*[:=]\s*(?:'[^']*'|"[^"]*"|[^\s;,]+)/gi, "[credential redacted]")
    .replace(/\b(?:SCRAM-SHA-256\$[^\s]+|\$2[aby]\$[^\s]+)/g, "[credential hash redacted]")
    .replace(/'(?:[^']|'')*'/g, "'[value redacted]'")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

/** Only system-restore responses pass through this diagnostic boundary. */
export const recordRestoreWarnings: RequestHandler = (req, res, next) => {
  const sendJson = res.json.bind(res);
  res.json = ((body: any) => {
    if (body && Array.isArray(body.warnings)) {
      const warnings = body.warnings
        .filter((warning: unknown): warning is string => typeof warning === "string" && warning.trim().length > 0)
        .map(safeRestoreWarning);
      // JSON encoding prevents multiline diagnostics from forging log entries.
      warnings.forEach((warning: string, index: number) =>
        console.warn("[Restore] warning", JSON.stringify({
          path: req.route?.path,
          status: res.statusCode,
          warningNumber: index + 1,
          warningCount: warnings.length,
          warning,
        })));
      return sendJson({ ...body, warnings });
    }
    return sendJson(body);
  }) as typeof res.json;
  next();
};
