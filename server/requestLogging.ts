import type { RequestHandler } from "express";

export function requestLogging(log: (message: string) => void): RequestHandler {
  return (req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      if (!req.path.startsWith("/api")) return;
      // Never capture request/response bodies, headers, or query strings. Omitting
      // the whole payload also protects nested secrets and unlabelled free text.
      // Use the registered route template, not user-supplied path parameters.
      const route = typeof req.route?.path === "string" ? req.route.path : "/api/[unmatched]";
      log(`${req.method} ${route} ${res.statusCode} in ${Date.now() - start}ms`);
    });
    next();
  };
}
