import { useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, MapPin, RotateCw, X } from "lucide-react";
import type { Project } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type UserProjectsDialogUser = {
  id: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
} | null;

type UserProjectsDialogProps = {
  user: UserProjectsDialogUser;
  onClose: () => void;
};

function getDisplayName(user: NonNullable<UserProjectsDialogUser>) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return name || user.username || "Selected user";
}

export function UserProjectsDialog({ user, onClose }: UserProjectsDialogProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const userId = user?.id;
  const [viewportBounds, setViewportBounds] = useState<{ top: number; maxHeight: number }>();

  useLayoutEffect(() => {
    if (!userId) return;
    const viewport = window.visualViewport;
    const fit = () => {
      const offset = viewport?.offsetTop ?? 0;
      // Hosting chrome may reserve space above the app without reducing 100dvh.
      const appTop = document.getElementById("root")?.getBoundingClientRect().top ?? 0;
      const top = Math.max(offset, appTop);
      const available = Math.max(0, offset + (viewport?.height ?? window.innerHeight) - top);
      setViewportBounds({ top: top + available / 2, maxHeight: Math.min(available * 0.84, 672) });
    };
    fit();
    window.addEventListener("resize", fit);
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    return () => {
      window.removeEventListener("resize", fit);
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
    };
  }, [userId]);

  const {
    data: projects,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<Project[]>({
    queryKey: ["/api/users", userId, "projects"],
    queryFn: async () => {
      if (!userId) throw new Error("A user is required to load projects.");
      const response = await fetch(`/api/users/${encodeURIComponent(userId)}/projects`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Unable to load this user's projects.");

      const payload: unknown = await response.json();
      const result = Array.isArray(payload)
        ? payload
        : payload && typeof payload === "object" && "projects" in payload
          ? (payload as { projects?: unknown }).projects
          : undefined;

      if (!Array.isArray(result)) {
        throw new Error("The project response was not valid.");
      }
      return result as Project[];
    },
    enabled: Boolean(userId),
    retry: false,
  });

  return (
    <Dialog
      open={Boolean(user)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        data-testid="user-projects-dialog"
        style={viewportBounds}
        className="flex max-h-[min(84dvh,42rem)] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden rounded-xl border-border/80 bg-background p-0 shadow-xl sm:w-full"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-5 py-4 pr-14 text-left sm:px-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FolderKanban className="h-[18px] w-[18px]" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle
                ref={titleRef}
                tabIndex={-1}
                className="break-words text-base font-semibold leading-5 outline-none"
              >
                Assigned projects
              </DialogTitle>
              <DialogDescription className="mt-1 break-words text-sm leading-5">
                {user ? getDisplayName(user) : "Projects for this user"}
              </DialogDescription>
            </div>
            {projects && !isError && (
              <span className="mt-0.5 shrink-0 rounded-full bg-muted px-2.5 py-1 font-mono text-xs tabular-nums text-muted-foreground">
                {projects.length}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6 sm:py-4">
          {isLoading && (
            <div className="space-y-2.5" aria-label="Loading assigned projects" aria-busy="true">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="flex items-center gap-3 rounded-lg border border-border/60 px-3.5 py-3"
                >
                  <Skeleton className="h-8 w-8 shrink-0 rounded-md" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-3 w-2/5" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!isLoading && isError && (
            <div
              className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-5 text-center"
              role="alert"
            >
              <p className="text-sm font-medium text-foreground">Projects couldn’t be loaded</p>
              <p className="mx-auto mt-1.5 max-w-xs text-sm leading-5 text-muted-foreground">
                Access may be limited, or the request may have failed. Try again to check this assignment list.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="user-projects-retry"
                className="mt-4 gap-2"
                disabled={isFetching}
                onClick={() => void refetch()}
              >
                <RotateCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} aria-hidden="true" />
                {isFetching ? "Retrying…" : "Retry"}
              </Button>
            </div>
          )}

          {!isLoading && !isError && projects?.length === 0 && (
            <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-border/80 bg-muted/25 px-5 py-8 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FolderKanban className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">No assigned projects</p>
              <p className="mt-1 max-w-xs text-sm leading-5 text-muted-foreground">
                There are no projects attached to this user.
              </p>
            </div>
          )}

          {!isLoading && !isError && Boolean(projects?.length) && (
            <ul className="space-y-2" aria-label="Assigned projects">
              {projects?.map((project) => (
                <li
                  key={project.id}
                  data-testid={`user-projects-entry-${project.id}`}
                  className="flex min-w-0 items-start gap-3 rounded-lg border border-border/70 bg-card px-3.5 py-3 transition-colors"
                >
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/70 text-accent-foreground">
                    <MapPin className="h-4 w-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium leading-5 text-foreground">
                      {project.name || "Unnamed project"}
                    </p>
                    {project.isActive !== null && project.isActive !== undefined && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {project.isActive ? "Active" : "Inactive"}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-border/70 px-4 py-3 sm:px-6">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={onClose}>
            <X className="mr-2 h-4 w-4" aria-hidden="true" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default UserProjectsDialog;
