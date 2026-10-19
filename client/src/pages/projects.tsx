import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTimezone } from "@/hooks/use-timezone";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/authUtils";
import { exportProjects, type ProjectExportFormat } from "@/lib/projects-export";
import type { Project } from "@shared/schema";
import {
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Pencil,
} from "lucide-react";

type ProjectSort = "newest" | "oldest" | "name-asc" | "name-desc";

const selectClass =
  "h-9 rounded-md border border-input bg-background px-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function Projects() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatDate } = useTimezone();
  const isMobile = useIsMobile();
  const isAdmin = user?.role === "admin";
  const [searchQuery, setSearchQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<ProjectSort>("newest");
  const [showMobileTools, setShowMobileTools] = useState(() => !(
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 767px), (orientation: landscape) and (pointer: coarse) and (max-height: 600px) and (max-width: 960px)").matches
  ));
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<number | null>(null);
  const [, navigate] = useLocation();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(1);
  const [workspaceElement, setWorkspaceElement] = useState<HTMLElement | null>(null);
  const [resultsElement, setResultsElement] = useState<HTMLDivElement | null>(null);
  const workspaceHeightRef = useRef(0);
  const resultsWidthRef = useRef(0);
  const resultsHeightRef = useRef(0);

  const projectsQuery = useQuery<Project[]>({ queryKey: ["/api/projects"] });
  const { data: projects, isLoading, isError } = projectsQuery;
  const { data: userPermissions = [] } = useQuery<string[]>({
    queryKey: ["/api/users", user?.id, "permissions"],
    queryFn: async () => {
      if (!user) return [];
      const response = await fetch(`/api/users/${user.id}/permissions`, { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!user,
  });

  const hasPermission = (permission: string) => isAdmin || userPermissions.includes(permission);
  const canCreateProject = hasPermission("projects.create");
  const canEditProject = hasPermission("projects.edit");
  const canDeleteProject = hasPermission("projects.delete");
  const canViewInactive = hasPermission("projects.viewInactive");
  const cleanups = useQuery<{ key: string; projectId: number; projectName: string; restore: boolean }[]>({
    queryKey: ["/api/project-deletion-cleanups"], enabled: canDeleteProject, refetchInterval: 30000,
  });
  const retryCleanup = useMutation({
    mutationFn: (key: string) => apiRequest("POST", `/api/project-deletion-cleanups/${key}/retry`, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/project-deletion-cleanups"] });
      toast({ title: "Project file cleanup/recovery completed" });
    },
    onError: () => toast({ title: "File cleanup/recovery is still pending",
      description: "Check Windows file locks and folder permissions, then retry.", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await apiRequest("DELETE", `/api/projects/${id}`);
      return response.status === 202 ? response.json() : null;
    },
    onSuccess: (result, id) => {
      queryClient.removeQueries({ predicate: query => {
        const [first, second] = query.queryKey;
        return typeof first === "string" && (first === `/api/projects/${id}` ||
          first.startsWith(`/api/projects/${id}/`) || first === "/api/projects" && second === id);
      } });
      void queryClient.invalidateQueries({ queryKey: ["/api/projects"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/project-deletion-cleanups"] });
      toast(result?.fileCleanupPending
        ? { title: "Project records deleted — file cleanup pending", description: result.message }
        : { title: "Success", description: "Project and associated records and files deleted successfully" });
      setDeleteDialogOpen(false);
      setProjectToDelete(null);
    },
    onError: (error: Error) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/project-deletion-cleanups"] });
      if (isUnauthorizedError(error)) {
        toast({
          title: "Unauthorized",
          description: "You are logged out. Logging in again...",
          variant: "destructive",
        });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      let message = error.message.replace(/^\d{3}:\s*/, "");
      try { message = JSON.parse(message).message || message; } catch {}
      toast({ title: "Project deletion failed", description: message || "Failed to delete project", variant: "destructive" });
    },
  });

  useEffect(() => {
    setShowMobileTools(!isMobile);
  }, [isMobile]);

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return (projects ?? [])
      .filter(project => {
        if (project.isActive === false && (!canViewInactive || !showInactive)) return false;
        if (!query) return true;
        return [
          String(project.id),
          project.name,
          project.description ?? "",
          project.customerEmail ?? "",
        ].some(value => value.toLocaleLowerCase().includes(query));
      })
      .sort((a, b) => {
        if (sort === "name-asc") return a.name.localeCompare(b.name);
        if (sort === "name-desc") return b.name.localeCompare(a.name);
        const aTime = new Date(a.createdAt ?? 0).getTime();
        const bTime = new Date(b.createdAt ?? 0).getTime();
        return sort === "oldest" ? aTime - bTime : bTime - aTime;
      });
  }, [projects, searchQuery, showInactive, canViewInactive, sort]);

  const pageCount = Math.max(1, Math.ceil(filteredProjects.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageProjects = useMemo(
    () => filteredProjects.slice(currentPage * pageSize, (currentPage + 1) * pageSize),
    [filteredProjects, currentPage, pageSize],
  );
  const start = filteredProjects.length ? currentPage * pageSize + 1 : 0;
  const end = Math.min(filteredProjects.length, (currentPage + 1) * pageSize);

  useEffect(() => {
    setPage(0);
    resultsElement?.scrollTo({ top: 0 });
  }, [searchQuery, showInactive, sort, resultsElement]);

  useEffect(() => {
    if (page !== currentPage) setPage(currentPage);
  }, [currentPage, page]);

  // Bound this workspace to the visible viewport without assuming the sidebar,
  // top banner, browser chrome, or mobile orientation has a fixed size.
  useEffect(() => {
    const workspace = workspaceElement;
    if (!workspace) return;
    const previousHeight = workspace.style.height;
    const previousOverflow = workspace.style.overflow;
    workspace.style.overflow = "hidden";
    const fitWorkspace = () => {
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const top = workspace.getBoundingClientRect().top - (viewport?.offsetTop ?? 0);
      const nextHeight = Math.max(0, viewportHeight - Math.max(0, top));
      if (Math.abs(nextHeight - workspaceHeightRef.current) > 2) {
        workspaceHeightRef.current = nextHeight;
        workspace.style.height = `${nextHeight}px`;
      }
    };
    const observer = new ResizeObserver(fitWorkspace);
    if (workspace.parentElement) observer.observe(workspace.parentElement);
    window.addEventListener("resize", fitWorkspace);
    window.visualViewport?.addEventListener("resize", fitWorkspace);
    window.visualViewport?.addEventListener("scroll", fitWorkspace);
    fitWorkspace();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fitWorkspace);
      window.visualViewport?.removeEventListener("resize", fitWorkspace);
      window.visualViewport?.removeEventListener("scroll", fitWorkspace);
      workspace.style.height = previousHeight;
      workspace.style.overflow = previousOverflow;
    };
  }, [workspaceElement]);

  // Fit a whole number of compact records into the real results viewport.
  // Geometry is based on the border-box width, not scrollbar-sensitive clientWidth.
  useEffect(() => {
    const container = resultsElement;
    if (!container) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = container.getBoundingClientRect().width;
        const height = container.clientHeight;
        const widthChanged = Math.abs(width - resultsWidthRef.current) > 2;
        const heightChanged = Math.abs(height - resultsHeightRef.current) > 2;
        resultsWidthRef.current = width;
        resultsHeightRef.current = height;
        if (widthChanged || heightChanged) {
          if (currentPage > 0) {
            setPage(0);
            container.scrollTo({ top: 0 });
            return;
          }
        }
        if (!height) return;
        const row = container.querySelector<HTMLElement>("[data-project-row]");
        const headerHeight = container.querySelector<HTMLElement>("[data-project-list-header]")?.getBoundingClientRect().height ?? 0;
        // Once paging starts, keep boundaries fixed. A later row can never
        // redefine the page size; genuine viewport/scope changes reset to page 1.
        if (currentPage > 0) return;
        const rowHeight = row?.getBoundingClientRect().height || (isMobile ? 62 : 40);
        const verticalInset = 18; // Results padding (16px) plus the list region border (2px).
        const fitted = Math.max(1, Math.floor(Math.max(0, height - headerHeight - verticalInset) / rowHeight));
        const nextSize = Math.min(100, Math.max(1, filteredProjects.length || fitted), fitted);
        setPageSize(previous => previous === nextSize ? previous : nextSize);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    const listHeader = container.querySelector<HTMLElement>("[data-project-list-header]");
    if (listHeader) observer.observe(listHeader);
    container.querySelectorAll("[data-project-row]").forEach(item => observer.observe(item));
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [resultsElement, pageProjects, filteredProjects.length, currentPage, isMobile, showMobileTools]);

  const exportFile = (format: ProjectExportFormat) => {
    if (!filteredProjects.length) return;
    const success = exportProjects(format, filteredProjects);
    if (!success) {
      toast({
        title: "Print view blocked",
        description: "Allow pop-ups in your browser to open the printable project list.",
        variant: "destructive",
      });
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setShowInactive(false);
    setSort("newest");
  };

  return (
    <section
      ref={setWorkspaceElement}
      className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-col px-3 sm:px-5"
      data-testid="projects-workspace"
      aria-label="Projects workspace"
    >
      <header className="sticky top-0 z-10 shrink-0 border-b bg-background pb-2 pt-2 sm:pb-3" data-testid="projects-workspace-header">
        {canDeleteProject && cleanups.isError && <p role="alert" className="mb-2 text-sm text-destructive">
          Pending project file cleanup could not be verified. Refresh before assuming deletion is complete.
        </p>}
        {!!cleanups.data?.length && <div className="mb-2 space-y-2 rounded-md border border-amber-400 p-3 text-sm" data-testid="project-deletion-cleanups">
          <h2 className="font-semibold">Project file cleanup / recovery pending</h2>
          {cleanups.data.map(job => <div key={job.key} className="flex flex-wrap items-center justify-between gap-2">
            <span>{job.projectName} · #{job.projectId} — {job.restore ? "Project retained; files need recovery" : "Records deleted; remaining files need removal"}</span>
            <Button type="button" size="sm" variant="outline" disabled={retryCleanup.isPending}
              onClick={() => retryCleanup.mutate(job.key)} data-testid={`retry-project-cleanup-${job.projectId}`}>
              {job.restore ? "Retry file recovery" : "Retry file cleanup"}
            </Button>
          </div>)}
        </div>}
        <div className="flex min-h-9 items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl" data-testid="text-projects-title">Projects</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">Customer projects and their work orders</p>
          </div>
          {canCreateProject && (
            <Link
              href="/projects/new"
              className={buttonVariants({ size: "sm" }) + " h-9 shrink-0"}
              data-testid="button-new-project"
            >
              <Plus aria-hidden="true" className="mr-1.5 h-4 w-4" />
              New Project
            </Link>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2">
          {isMobile && (
            <Button
              className="h-9 shrink-0"
              size="sm"
              variant="outline"
              aria-expanded={showMobileTools}
              aria-controls="projects-search-tools"
              onClick={() => setShowMobileTools(value => !value)}
              data-testid="button-toggle-project-tools"
            >
              {showMobileTools ? <ChevronUp aria-hidden="true" className="mr-1.5 h-4 w-4" /> : <ChevronDown aria-hidden="true" className="mr-1.5 h-4 w-4" />}
              Search &amp; Tools
            </Button>
          )}
          <p className="ml-auto whitespace-nowrap text-xs text-muted-foreground" aria-live="polite" data-testid="text-project-count">
            {filteredProjects.length} {filteredProjects.length === 1 ? "project" : "projects"}
          </p>
          <Button
            className="h-9 w-9 shrink-0 p-0"
            size="sm"
            variant="outline"
            aria-label="Refresh projects"
            title="Refresh projects"
            onClick={() => void projectsQuery.refetch()}
            disabled={projectsQuery.isFetching}
            data-testid="button-refresh-projects"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${projectsQuery.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {(!isMobile || showMobileTools) && (
          <div id="projects-search-tools" className="mt-2 space-y-2" data-testid="projects-search-tools">
            <div className="flex min-w-0 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-9 pl-9"
                  type="search"
                  autoComplete="off"
                  aria-label="Search projects by name, description, ID, or customer email"
                  placeholder="Name, description, ID or email"
                  value={searchQuery}
                  onChange={event => setSearchQuery(event.target.value)}
                  data-testid="input-search-projects"
                />
              </div>
              <label className="flex h-9 shrink-0 items-center gap-2 rounded-md border px-2 text-xs">
                <Switch
                  id="show-inactive"
                  checked={canViewInactive && showInactive}
                  onCheckedChange={setShowInactive}
                  disabled={!canViewInactive}
                  data-testid="switch-show-inactive"
                />
                <span className="hidden sm:inline">Inactive</span>
                <EyeOff aria-hidden="true" className="h-4 w-4 sm:hidden" />
                <span className="sr-only">Show inactive projects</span>
              </label>
              <label className="sr-only" htmlFor="projects-sort">Sort projects</label>
              <select
                id="projects-sort"
                className={`${selectClass} max-w-[136px]`}
                value={sort}
                onChange={event => setSort(event.target.value as ProjectSort)}
                aria-label="Sort projects"
                data-testid="select-project-sort"
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name-asc">Name A–Z</option>
                <option value="name-desc">Name Z–A</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">Export all filtered</span>
              <Button className="h-8" size="sm" variant="outline" aria-label="Export projects as CSV" title="CSV" disabled={!filteredProjects.length} onClick={() => exportFile("csv")} data-testid="button-export-projects-csv">
                <Download aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />CSV
              </Button>
              <Button className="h-8" size="sm" variant="outline" aria-label="Export projects as Excel" title="Excel" disabled={!filteredProjects.length} onClick={() => exportFile("xlsx")} data-testid="button-export-projects-xlsx">
                <FileSpreadsheet aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />Excel
              </Button>
              <Button className="h-8" size="sm" variant="outline" aria-label="Print projects or save as PDF" title="PDF / Print" disabled={!filteredProjects.length} onClick={() => exportFile("pdf")} data-testid="button-export-projects-pdf">
                <FileText aria-hidden="true" className="mr-1.5 h-3.5 w-3.5" />PDF / Print
              </Button>
              {canViewInactive && (
                <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                  {showInactive ? <Eye aria-hidden="true" className="h-3.5 w-3.5" /> : <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />}
                  {showInactive ? "Including inactive" : "Active only"}
                </span>
              )}
            </div>
          </div>
        )}
      </header>

      <div
        ref={setResultsElement}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2"
        data-testid="projects-results"
        data-page-size={pageSize}
        role="region"
        aria-label="Project records"
        tabIndex={0}
      >
        {isError ? (
          <div className="grid min-h-40 place-items-center rounded-md border border-dashed px-4 text-center" role="alert" data-testid="projects-error">
            <div><p className="font-medium">Projects could not be loaded</p><p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
              <Button className="mt-3" size="sm" variant="outline" onClick={() => void projectsQuery.refetch()} data-testid="button-retry-projects">Retry</Button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="space-y-1" role="status" aria-label="Loading projects" data-testid="projects-loading">
            {[...Array(6)].map((_, index) => <Skeleton key={index} className="h-[54px] rounded-md" />)}
          </div>
        ) : pageProjects.length ? (
          <div className="overflow-hidden rounded-md border bg-card" data-testid="projects-record-list">
            <div
              className="hidden h-8 grid-cols-[52px_minmax(0,1.15fr)_minmax(0,1.3fr)_minmax(0,1fr)_76px_auto] items-center gap-3 border-b bg-muted px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:grid"
              data-project-list-header
              aria-hidden="true"
            >
              <span>ID</span>
              <span>Project</span>
              <span>Description</span>
              <span>Customer email</span>
              <span>Created</span>
              <span className="text-right">Actions</span>
            </div>
            {pageProjects.map(project => (
              <article
                key={project.id}
                className="grid h-[62px] cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-b px-2.5 last:border-b-0 hover-elevate focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:h-10 sm:grid-cols-[52px_minmax(0,1.15fr)_minmax(0,1.3fr)_minmax(0,1fr)_76px_auto] sm:gap-3 sm:px-3"
                data-testid={`row-project-${project.id}`}
                data-project-row
                role="link"
                tabIndex={0}
                aria-label={`View details for ${project.name}`}
                onClick={event => {
                  const target = event.target as HTMLElement;
                  const control = target.closest('button, a, [role="button"], [role="menuitem"]');
                  if (control && control !== event.currentTarget) return;
                  navigate(`/projects/${project.id}/edit`);
                }}
                onKeyDown={event => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    navigate(`/projects/${project.id}/edit`);
                  }
                }}
              >
                <div className="min-w-0 sm:hidden">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Button
                      className="h-6 min-w-0 justify-start truncate px-0 text-sm font-medium"
                      variant="ghost"
                      onClick={() => navigate(`/projects/${project.id}/edit`)}
                      aria-label={`Project details for ${project.name}`}
                      data-testid={`button-project-details-${project.id}`}
                    ><span className="truncate">{project.name}</span></Button>
                    {project.isActive === false && <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px]">Inactive</Badge>}
                  </div>
                  <p className="truncate text-xs text-muted-foreground" title={`${project.customerEmail || ""}${project.description ? ` · ${project.description}` : ""}`}>
                    {project.customerEmail || project.description || "No contact details"}
                  </p>
                </div>
                <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:block">#{project.id}</span>
                <Button
                  className="hidden h-7 min-w-0 justify-start truncate px-0 text-sm font-medium sm:flex"
                  variant="ghost"
                  onClick={() => navigate(`/projects/${project.id}/edit`)}
                  aria-label={`Project details for ${project.name}`}
                  data-testid={`button-project-details-${project.id}`}
                ><span className="min-w-0 truncate">{project.name}</span>{project.isActive === false ? <Badge variant="secondary" className="ml-2 shrink-0 px-1.5 text-[10px]">Inactive</Badge> : null}</Button>
                <p className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block" title={project.description || ""}>{project.description || "—"}</p>
                <p className="hidden min-w-0 truncate text-xs sm:block" title={project.customerEmail || ""}>{project.customerEmail || "—"}</p>
                <time className="hidden whitespace-nowrap text-xs text-muted-foreground sm:block" dateTime={project.createdAt && !Number.isNaN(new Date(project.createdAt).getTime()) ? new Date(project.createdAt).toISOString() : undefined}>
                  {project.createdAt ? formatDate(project.createdAt) : "—"}
                </time>
                <div className="flex items-center justify-end gap-0.5">
                  <Link
                    href={`/projects/${project.id}/work-orders`}
                    className={buttonVariants({ variant: "ghost", size: "icon" }) + " h-8 w-8"}
                    aria-label={`View work orders for ${project.name}`}
                    title="View work orders"
                    data-testid={`button-view-${project.id}`}
                  >
                    <Eye aria-hidden="true" className="h-4 w-4" />
                  </Link>
                  {canEditProject && (
                    <Link
                      href={`/projects/${project.id}/edit`}
                      className={buttonVariants({ variant: "ghost", size: "icon" }) + " h-8 w-8"}
                      aria-label={`Edit ${project.name}`}
                      title="Edit project"
                      data-testid={`button-edit-${project.id}`}
                    >
                      <Pencil aria-hidden="true" className="h-4 w-4" />
                    </Link>
                  )}
                  {canDeleteProject && (
                    <Button
                      className="h-8 w-8"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${project.name}`}
                      title="Delete project"
                      onClick={() => { setProjectToDelete(project.id); setDeleteDialogOpen(true); }}
                      data-testid={`button-delete-${project.id}`}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-40 place-items-center rounded-md border border-dashed bg-muted/15 px-4 py-8 text-center" role="status" data-testid="projects-empty">
            <div className="max-w-sm">
              <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-full bg-muted"><FolderOpen aria-hidden="true" className="h-5 w-5 text-muted-foreground" /></div>
              <p className="font-medium">{projects?.length ? "No matching projects" : "No projects yet"}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {projects?.length ? "Try another search or include inactive projects." : "Create a project to keep customer work and orders together."}
              </p>
              {projects?.length ? (
                (searchQuery || showInactive || sort !== "newest") && <Button className="mt-3" size="sm" variant="outline" onClick={clearFilters} data-testid="button-clear-project-filters">Clear search and filters</Button>
              ) : canCreateProject && (
                <Link href="/projects/new" className={buttonVariants({ size: "sm" }) + " mt-3"} data-testid="button-create-first-project">
                  <Plus aria-hidden="true" className="mr-1.5 h-4 w-4" />Create Project
                </Link>
              )}
            </div>
          </div>
        )}
      </div>

      <nav className="flex shrink-0 flex-wrap items-center gap-2 border-t py-2" data-testid="projects-pagination" aria-label="Project pages">
        <p className="mr-auto text-xs text-muted-foreground" aria-live="polite" data-testid="text-project-page-range">
          {filteredProjects.length ? `${start}–${end} of ${filteredProjects.length} projects` : "0 projects"}
        </p>
        <Button
          size="sm"
          variant="outline"
          aria-label="Previous projects page"
          disabled={!projects || currentPage === 0}
          onClick={() => { setPage(Math.max(0, currentPage - 1)); resultsElement?.scrollTo({ top: 0 }); }}
          data-testid="button-projects-previous"
        >Previous</Button>
        <span className="min-w-16 text-center text-xs tabular-nums" data-testid="text-project-page-number">Page {currentPage + 1} / {pageCount}</span>
        <Button
          size="sm"
          variant="outline"
          aria-label="Next projects page"
          disabled={!projects || currentPage >= pageCount - 1}
          onClick={() => { setPage(currentPage + 1); resultsElement?.scrollTo({ top: 0 }); }}
          data-testid="button-projects-next"
        >Next</Button>
      </nav>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete this project and its work orders, inventory and inventory history
              (even when Inventory is disabled), routes, assignments, imports and files?
              Shared users and site-wide catalogs are not deleted. System security audit evidence is retained.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={event => {
                event.preventDefault();
                if (projectToDelete !== null && !deleteMutation.isPending) deleteMutation.mutate(projectToDelete);
              }}
              className="bg-destructive text-destructive-foreground"
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
