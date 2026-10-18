import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import type { AccessLock } from "@shared/access-locks";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { queryClient } from "@/lib/queryClient";

type Props = { scope: "site" | "project"; projectId?: number };
type AccessLockDto = AccessLock & { canManage?: boolean };

const statusKey = (scope: Props["scope"], projectId?: number) =>
  ["access-lock", scope, scope === "project" ? projectId : null] as const;

function lockEndpoint(scope: Props["scope"], projectId?: number) {
  return scope === "site" ? "/api/access-locks/site" : `/api/projects/${projectId}/access-lock`;
}

export function AccessLockControl({ scope, projectId }: Props) {
  const [message, setMessage] = useState("");
  const [messageEdited, setMessageEdited] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryKey = statusKey(scope, projectId);
  const enabled = scope === "site" || Number.isFinite(projectId);
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<AccessLockDto>({
    queryKey,
    enabled,
    queryFn: async () => {
      const response = await fetch(lockEndpoint(scope, projectId), { credentials: "include" });
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
      return response.json();
    },
  });

  useEffect(() => {
    if (data && !messageEdited) setMessage(data.message ?? "");
  }, [data?.updatedAt, data?.locked, data?.message, messageEdited]);

  const saveMutation = useMutation({
    mutationFn: async (locked: boolean) => {
      const response = await fetch(lockEndpoint(scope, projectId), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locked,
          message: message.trim(),
          expectedUpdatedAt: data?.updatedAt ?? null,
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        const failure = new Error(detail || `Request failed (${response.status})`);
        Object.assign(failure, { status: response.status });
        throw failure;
      }
      return response.json() as Promise<AccessLockDto>;
    },
    onSuccess: updated => {
      queryClient.setQueryData(queryKey, updated);
      queryClient.invalidateQueries({ queryKey: ["/api/access-locks/status"] });
      setMessage(updated.message ?? "");
      setMessageEdited(false);
      setConfirmOpen(false);
    },
    onError: () => setConfirmOpen(false),
  });

  if (!enabled || (data && data.canManage === false)) return null;
  if (isError && error instanceof Error && error.message.startsWith("403:")) return null;

  const nextLocked = !data?.locked;
  const errorStatus = (saveMutation.error as (Error & { status?: number }) | null)?.status;

  return (
    <Card data-testid={scope === "site" ? "access-lock-site" : "access-lock-project"} className="border-border/80">
      <CardHeader className="pb-4">
        <div className="flex items-start gap-3">
          <div className={`mt-0.5 rounded-md p-2 ${data?.locked ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
            {data?.locked ? <LockKeyhole className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle className="text-base">{scope === "site" ? "Site access lock" : "Project access lock"}</CardTitle>
            <CardDescription className="mt-1">
              Pause access without changing permissions or removing project work.
            </CardDescription>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${data?.locked ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-border bg-muted/50 text-muted-foreground"}`}>
            {isLoading ? "Checking" : data?.locked ? "Locked" : "Unlocked"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-2" aria-label="Loading access lock status">
            <div className="h-4 w-2/5 animate-pulse rounded bg-muted" />
            <div className="h-20 w-full animate-pulse rounded-md bg-muted" />
          </div>
        ) : isError ? (
          <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="text-destructive">{error instanceof Error ? error.message : "Could not load access lock status."}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" />Retry
            </Button>
          </div>
        ) : data ? (
          <>
            <div className="rounded-md bg-muted/40 px-3 py-2.5">
              <p className="text-sm leading-relaxed">{data.locked ? data.message : "Access is open for authorized users."}</p>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {data.updatedAt
                  ? `Last changed ${new Date(data.updatedAt).toLocaleString()}${data.updatedBy ? ` by ${data.updatedBy}` : ""}`
                  : "No access lock changes recorded"}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`access-lock-message-${scope}-${projectId ?? "site"}`}>
                {data.locked ? "Lock message" : "Message (required to lock)"}
              </Label>
              <Textarea
                id={`access-lock-message-${scope}-${projectId ?? "site"}`}
                data-testid="access-lock-message"
                value={message}
                onChange={event => { setMessage(event.target.value.slice(0, 1000)); setMessageEdited(true); }}
                maxLength={1000}
                rows={3}
                placeholder="Explain why access is paused and who to contact."
                aria-describedby={`access-lock-message-help-${scope}-${projectId ?? "site"}`}
              />
              <p id={`access-lock-message-help-${scope}-${projectId ?? "site"}`} className="text-xs text-muted-foreground">
                {message.length}/1000 characters. This note is shown to users whose access is paused.
              </p>
            </div>
            {saveMutation.isError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {errorStatus === 409 ? (
                  <>
                    This lock changed since you loaded it. Reload the status and review it before trying again; no changes were saved.{" "}
                    <button type="button" className="font-medium underline underline-offset-2" onClick={() => refetch()}>
                      Reload status
                    </button>
                  </>
                ) : saveMutation.error instanceof Error ? saveMutation.error.message : "Could not save access lock. Your message is still here."}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">
                {data.locked
                  ? "Unlocking restores access; it does not alter permissions or stored work."
                  : "Locking pauses access at the next request. Existing sessions are affected on their next web, mobile, or API request."}
              </p>
              <Button type="button" variant={data.locked ? "outline" : "destructive"} data-testid="access-lock-toggle"
                disabled={saveMutation.isPending || isLoading} onClick={() => setConfirmOpen(true)}>
                {data.locked ? "Unlock access" : "Lock access"}
              </Button>
            </div>
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{nextLocked ? "Pause access?" : "Restore access?"}</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2">
                      <p>{nextLocked
                        ? "People will lose access on their next request across web, mobile, and API. In-flight work will not be interrupted."
                        : "People will be able to access this scope again according to their existing permissions."}</p>
                      <p>Stored data and permissions will not change. Offline cached data may remain on devices. No access lock is applied automatically.</p>
                      {nextLocked && <p className="font-medium text-foreground">Message shown to users: {message.trim() || "A lock message is required."}</p>}
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel type="button" data-testid="access-lock-cancel" disabled={saveMutation.isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction type="button" data-testid="access-lock-confirm" disabled={saveMutation.isPending || (nextLocked && !message.trim())}
                    onClick={event => { event.preventDefault(); saveMutation.mutate(nextLocked); }}>
                    {saveMutation.isPending ? "Saving…" : nextLocked ? "Confirm lock" : "Confirm unlock"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
