import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { AlertTriangle, ArrowLeft, LockKeyhole, LogOut, RefreshCw } from "lucide-react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import type { AccessLockStatus } from "@shared/access-locks";
import { AlertDialog, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

function routeProjectId(path: string): number | undefined {
  const match = path.match(/^\/projects\/(\d+)(?:\/|$)/);
  return match ? Number(match[1]) : undefined;
}

export function AccessLockGate({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [location] = useLocation();
  const projectId = routeProjectId(location);
  const routeKey = projectId === undefined ? "site" : `project:${projectId}`;
  const queryKey = ["/api/access-locks/status", projectId ?? null] as const;
  const statusQuery = useQuery<AccessLockStatus>({
    queryKey,
    enabled: isAuthenticated,
    queryFn: async () => {
      const suffix = projectId ? `?projectId=${projectId}` : "";
      const response = await fetch(`/api/access-locks/status${suffix}`, { credentials: "include" });
      if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
      return response.json();
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: isAuthenticated ? 10_000 : false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  // A route change must verify even cached project status before exposing the new route.
  // On the same route, background polls do not hide an editor or interrupt local drafts.
  const [checkedRoute, setCheckedRoute] = useState<string | null>(null);
  const refetchRef = useRef(statusQuery.refetch);
  refetchRef.current = statusQuery.refetch;
  useEffect(() => {
    if (!isAuthenticated) {
      setCheckedRoute(routeKey);
      return;
    }
    let active = true;
    setCheckedRoute(null);
    void refetchRef.current().finally(() => {
      if (active) setCheckedRoute(routeKey);
    });
    return () => { active = false; };
  }, [isAuthenticated, routeKey]);

  const responseProjectId = statusQuery.data?.project?.projectId;
  const statusMatchesRoute = projectId === undefined
    ? statusQuery.data?.project == null
    : responseProjectId === projectId;
  const waiting = checkedRoute !== routeKey || statusQuery.isLoading || (!statusQuery.isError && !statusMatchesRoute);
  const blocked = statusQuery.data?.blocked ?? null;
  const hideProtectedContent = isAuthenticated && (waiting || statusQuery.isError || !!blocked);
  const showGate = isAuthenticated && hideProtectedContent;

  return (
    <AlertDialog open={showGate} onOpenChange={() => {}}>
      <div hidden={hideProtectedContent} ref={node => { node?.toggleAttribute("inert", hideProtectedContent); }}>
        {children}
      </div>

      {showGate && (
        <AlertDialogPortal>
          <AlertDialogOverlay
            className="bg-background"
            style={{ zIndex: 100, backgroundColor: "hsl(var(--background))" }}
          />
          <AlertDialogPrimitive.Content
            className="fixed left-1/2 top-1/2 z-[101] grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-background p-6 shadow-xl outline-none"
            style={{ zIndex: 101 }}
            onEscapeKeyDown={event => event.preventDefault()}
          >
            <div className="space-y-4">
              {waiting && !statusQuery.isError ? (
                <>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-foreground">
                    <LockKeyhole className="h-5 w-5" />
                  </div>
                  <AlertDialogTitle className="text-lg font-semibold">Checking access</AlertDialogTitle>
                  <AlertDialogDescription>
                    Verifying whether this site or project is currently locked…
                  </AlertDialogDescription>
                </>
              ) : statusQuery.isError ? (
                <>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-foreground">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                  </div>
                  <AlertDialogTitle className="text-lg font-semibold">Access status unavailable</AlertDialogTitle>
                  <AlertDialogDescription>
                    We could not verify access, so protected content is hidden.{" "}
                    {statusQuery.error instanceof Error ? statusQuery.error.message : ""}
                  </AlertDialogDescription>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button type="button" onClick={() => statusQuery.refetch()} disabled={statusQuery.isFetching}>
                      <RefreshCw className="mr-2 h-4 w-4" />Retry
                    </Button>
                    <Button type="button" variant="outline" onClick={() => { window.location.href = "/api/logout"; }}>
                      <LogOut className="mr-2 h-4 w-4" />Log out
                    </Button>
                  </div>
                </>
              ) : blocked ? (
                <>
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                    <LockKeyhole className="h-5 w-5" />
                  </div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-destructive">
                    {blocked.scope === "site" ? "Site access paused" : "Project access paused"}
                  </p>
                  <AlertDialogTitle className="text-xl font-semibold">Access is temporarily locked</AlertDialogTitle>
                  <AlertDialogDescription className="whitespace-pre-wrap rounded-md bg-muted/50 p-4 leading-relaxed">
                    {blocked.message}
                  </AlertDialogDescription>
                  <p className="text-sm text-muted-foreground">
                    Contact your site administrator if you need access. Your work and permissions have not been changed.
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button type="button" variant="outline" onClick={() => statusQuery.refetch()} disabled={statusQuery.isFetching}>
                      <RefreshCw className="mr-2 h-4 w-4" />Retry
                    </Button>
                    {blocked.scope === "project" && (
                      <Button type="button" variant="outline" asChild>
                        <Link href="/projects" className="inline-flex items-center">
                          <ArrowLeft className="mr-2 h-4 w-4" />Back to projects
                        </Link>
                      </Button>
                    )}
                    <Button type="button" onClick={() => { window.location.href = "/api/logout"; }}>
                      <LogOut className="mr-2 h-4 w-4" />Log out
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPortal>
      )}
    </AlertDialog>
  );
}
