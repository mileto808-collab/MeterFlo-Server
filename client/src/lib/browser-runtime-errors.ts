const resizeDeliveryNotices = new Set([
  "ResizeObserver loop completed with undelivered notifications.",
  "ResizeObserver loop limit exceeded",
]);

export function isResizeDeliveryNotice(event: Pick<ErrorEvent, "message" | "error">): boolean {
  return event.error == null && resizeDeliveryNotices.has(event.message);
}

export function runtimeError(value: unknown, fallback: string): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value) return new Error(value);
  if (value && typeof value === "object") {
    // Do not stringify arbitrary rejection payloads; they may contain private data.
    try {
      const details = value as { message?: unknown; stack?: unknown };
      if (typeof details.message === "string" && details.message) {
        const error = new Error(details.message);
        if (typeof details.stack === "string") error.stack = details.stack;
        return error;
      }
    } catch { /* An opaque cross-origin object must not break the error handler. */ }
  }
  return new Error(fallback);
}

/** Preserve browser diagnostics before the development overlay's bubble listeners. */
export function installBrowserRuntimeErrors(target: Window): () => void {
  const reportedNotices = new Set<string>();
  const onError = (event: ErrorEvent) => {
    if (isResizeDeliveryNotice(event)) {
      // This browser delivery notice has no exception and the next frame resumes
      // observation. Keep it visible in the console, not as a fatal app overlay.
      if (!reportedNotices.has(event.message)) {
        reportedNotices.add(event.message);
        console.warn(`[Layout notice] ${event.message}`);
      }
      event.stopImmediatePropagation();
      return;
    }
    const error = runtimeError(event.error, event.message || "Browser error without exception details");
    if (error !== event.error) {
      if (event.filename && event.lineno > 0)
        error.stack = `${error.name}: ${error.message}\n    at ${event.filename}:${event.lineno}:${event.colno}`;
      Object.defineProperty(event, "error", { value: error, configurable: true });
    }
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const error = runtimeError(event.reason, "Unhandled promise rejection without Error details");
    if (error !== event.reason) Object.defineProperty(event, "reason", { value: error, configurable: true });
  };
  target.addEventListener("error", onError, true);
  target.addEventListener("unhandledrejection", onRejection, true);
  return () => {
    target.removeEventListener("error", onError, true);
    target.removeEventListener("unhandledrejection", onRejection, true);
  };
}
