import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { systemRestoreStore, useSystemRestore } from "@/lib/system-restore-state";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export function SystemRestoreBoundary({ children }: { children: ReactNode }) {
  const restore = useSystemRestore();
  const [leaving, setLeaving] = useState(false);
  const pending = restore?.phase === "uploading" || restore?.phase === "processing";
  useEffect(() => {
    if (!pending) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  const signIn = async () => {
    setLeaving(true);
    try {
      // End any restored/stale session before requesting a fresh sign-in.
      const response = await fetch("/api/logout", { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("Logout unavailable");
    } catch {
      // The database may still be unavailable. Login can be retried once it is ready.
    }
    queryClient.clear();
    systemRestoreStore.clearMarkerForNavigation();
    window.location.assign("/login");
  };
  const title = pending ? "Restore in progress" : restore?.phase === "complete"
    ? "Restore completed" : restore?.phase === "incomplete" ? "Restore incomplete" : "Restore completion not confirmed";
  return (
    <>
      <div hidden={!!restore} ref={node => node?.toggleAttribute("inert", !!restore)}>{children}</div>
      {restore && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background p-5"
          data-testid="system-restore-screen">
          <section className="max-h-[calc(100dvh-2.5rem)] w-full max-w-lg space-y-5 overflow-y-auto overscroll-contain rounded-lg border bg-card p-6 text-card-foreground shadow-sm"
            aria-labelledby="restore-screen-title" aria-busy={pending}>
            {pending ? <RefreshCw className="h-6 w-6 animate-spin text-primary" aria-hidden="true" />
              : restore.phase === "complete" ? <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden="true" />
              : <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />}
            <div role="status" aria-live="polite" className="space-y-2">
              <h1 id="restore-screen-title" className="text-xl font-semibold">{title}</h1>
              <p className="text-sm text-muted-foreground">{restore.message}</p>
            </div>
            {!!restore.warnings?.length && (
              <section aria-labelledby="restore-warnings-title" className="space-y-2">
                <h2 id="restore-warnings-title" className="text-sm font-semibold">
                  Restore warnings ({restore.warnings.length})
                </h2>
                <ul aria-label={`${restore.warnings.length} restore warnings`}
                  className="max-h-[min(40dvh,20rem)] space-y-2 overflow-y-auto overscroll-contain rounded-md border bg-muted/40 p-3 text-sm">
                  {restore.warnings.map((warning, index) => (
                    <li key={`${index}-${warning}`} className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {warning}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {pending ? (
              <>
                {restore.phase === "uploading" && <Progress value={restore.percent ?? 0} aria-label="Backup upload progress" />}
                <p className="text-sm text-muted-foreground">
                  Keep this page open. Access checks may fail while database tables and login sessions are restored.
                  Sign in again when complete.
                </p>
                <p className="text-sm text-muted-foreground">
                  Leaving this page will not cancel a restore already running on the server.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {restore.phase === "complete" ? "Sign in again to load the restored accounts and permissions."
                    : "Do not start another restore until the outcome has been checked. Sign in again when the database is available."}
                </p>
                <Button onClick={signIn} disabled={leaving} data-testid="restore-sign-in">
                  {leaving ? "Opening sign in…" : "Sign in again"}
                </Button>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
