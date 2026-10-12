import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Archive, CalendarClock, Check, Clock3, FileWarning, HardDrive, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import type { CleanupFilter, CleanupPreview, CleanupResult, LogCategory, LogPolicy, LogSummary } from "@shared/log-maintenance";
import { logCategories } from "@shared/log-maintenance";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { usePermissions } from "@/hooks/usePermissions";
import { apiRequest, queryClient } from "@/lib/queryClient";

const categoryLabels: Record<LogCategory, string> = {
  errorArchives: "Archived error reports",
  activeError: "Active error reports",
  customerApi: "Customer API attempt history",
  apiImports: "API imports",
  databaseImports: "Database imports",
  fileImports: "File imports",
};
const globalFileCategories: LogCategory[] = ["errorArchives", "activeError"];
const defaultPolicy: LogPolicy = { automatic: false, rotationMiB: 10, archiveDays: 30, archiveBudgetMiB: 200, historyDays: 90 };

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
  return response.json();
}

async function sendJson<T>(method: string, url: string, body: unknown): Promise<T> {
  const response = await apiRequest(method, url, body);
  return response.json();
}

export function LogMaintenance() {
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const allowed = !permissionsLoading && hasPermission("maintenance.logManagement");
  const { data: summary, isLoading, isError, error, refetch } = useQuery<LogSummary>({
    queryKey: ["/api/maintenance/logs"],
    queryFn: () => fetchJson<LogSummary>("/api/maintenance/logs"),
    enabled: allowed,
  });
  const [policy, setPolicy] = useState<LogPolicy>(defaultPolicy);
  const [policyInitialized, setPolicyInitialized] = useState(false);
  const [categories, setCategories] = useState<LogCategory[]>([]);
  const [projectId, setProjectId] = useState("");
  const [before, setBefore] = useState("");
  const [preview, setPreview] = useState<CleanupPreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  useEffect(() => {
    if (summary && !policyInitialized) {
      setPolicy(summary.policy);
      setPolicyInitialized(true);
    }
  }, [summary, policyInitialized]);

  const hasGlobalFileCategory = categories.some((category) => globalFileCategories.includes(category));
  const setCategory = (category: LogCategory, checked: boolean) => {
    setCategories((current) => checked ? [...current, category] : current.filter((item) => item !== category));
    setPreview(null);
    setActionError("");
  };

  const savePolicy = useMutation({
    mutationFn: (nextPolicy: LogPolicy) => sendJson<LogPolicy>("PUT", "/api/maintenance/logs/policy", nextPolicy),
    onSuccess: (savedPolicy) => {
      setPolicy(savedPolicy);
      setPreview(null);
      setPolicyInitialized(true);
      setActionError("");
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/logs"] });
    },
    onError: (err: Error) => setActionError(err.message || "Could not save log policy."),
  });
  const createPreview = useMutation({
    mutationFn: (filter: CleanupFilter) => sendJson<CleanupPreview>("POST", "/api/maintenance/logs/preview", filter),
    onSuccess: (nextPreview) => {
      setPreview(nextPreview);
      setActionError("");
    },
    onError: (err: Error) => {
      setPreview(null);
      setActionError(err.message || "Could not create cleanup preview.");
    },
  });
  const cleanup = useMutation({
    mutationFn: (token: string) => sendJson<CleanupResult>("POST", "/api/maintenance/logs/cleanup", { token, confirm: true }),
    onSuccess: async () => {
      setConfirmOpen(false);
      setPreview(null);
      setCategories([]);
      setProjectId("");
      setBefore("");
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: ["/api/maintenance/logs"] });
    },
    onError: (err: Error) => setActionError(err.message || "Cleanup failed."),
  });

  const buildFilter = (): CleanupFilter | null => {
    if (!categories.length || !before) {
      setActionError("Choose at least one category and a cutoff date before previewing.");
      return null;
    }
    const cutoff = new Date(before);
    if (Number.isNaN(cutoff.getTime())) {
      setActionError("Enter a valid cutoff date.");
      return null;
    }
    return {
      categories,
      ...(projectId ? { projectId: Number(projectId) } : {}),
      before: cutoff.toISOString(),
    };
  };

  const inventory = summary?.inventory ?? [];
  if (!allowed) return <div id="log-maintenance" />;

  return (
    <section id="log-maintenance" className="scroll-mt-6 space-y-5" aria-labelledby="log-maintenance-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-primary" />
            <h2 id="log-maintenance-title" className="text-xl font-semibold">Log maintenance</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Review operational log storage, set retention behavior, and selectively clean up old records.</p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isLoading} aria-label="Refresh log summary">
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {summary?.warnings?.length ? (
        <div className="space-y-2">
          {summary.warnings.map((warning, index) => (
            <Alert key={`${index}-${warning}`} variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Storage notice</AlertTitle>
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}
        </div>
      ) : null}
      <Alert>
        <FileWarning className="h-4 w-4" />
        <AlertTitle>Managed log records only</AlertTitle>
        <AlertDescription>
          Externally managed stdout and PM2 files are unsupported and protected. Protected payloads account for {formatBytes(summary?.protectedBytes ?? 0)}; they are not eligible for cleanup.
        </AlertDescription>
      </Alert>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-28 w-full rounded-lg" />)}
        </div>
      ) : isError ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Could not load log inventory</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>{error instanceof Error ? error.message : "The log summary request failed."}</span>
            <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
          </AlertDescription>
        </Alert>
      ) : summary ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {logCategories.map((category) => {
              const item = inventory.find((entry) => entry.category === category);
              return (
                <Card key={category} className="border-border/80">
                  <CardContent className="flex items-start justify-between gap-3 p-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{categoryLabels[category]}</p>
                      <p className="mt-2 text-2xl font-semibold tabular-nums">{(item?.count ?? 0).toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground">records · {formatBytes(item?.bytes ?? 0)}</p>
                    </div>
                    <Badge variant={item?.protectedCount ? "secondary" : "outline"} className="shrink-0">
                      {item?.protectedCount ?? 0} protected
                    </Badge>
                  </CardContent>
                  <div className="px-4 pb-4 text-xs text-muted-foreground">
                    <span>Oldest: {formatDate(item?.oldest)}</span>
                    <span className="mx-2">·</span>
                    <span>Newest: {formatDate(item?.newest)}</span>
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="grid gap-5 lg:grid-cols-[0.88fr_1.12fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CalendarClock className="h-5 w-5" />Retention policy</CardTitle>
                <CardDescription>Automatic cleanup is off by default. Saving policy settings never deletes records.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <Label htmlFor="log-auto-retention">Automatic cleanup</Label>
                    <p className="text-xs text-muted-foreground">Leave disabled to require manual previews and confirmation.</p>
                  </div>
                  <Switch id="log-auto-retention" checked={policy.automatic} onCheckedChange={(automatic) => setPolicy((current) => ({ ...current, automatic }))} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {([
                    ["rotationMiB", "Rotation size (MiB)", 1, 100],
                    ["archiveDays", "Archive retention (days)", 1, 3650],
                    ["archiveBudgetMiB", "Archive budget (MiB)", 10, 10000],
                    ["historyDays", "History retention (days)", 1, 3650],
                  ] as const).map(([key, label, min, max]) => (
                    <div key={key} className="space-y-2">
                      <Label htmlFor={`policy-${key}`}>{label}</Label>
                      <Input
                        id={`policy-${key}`}
                        type="number"
                        min={min}
                        max={max}
                        step="1"
                        value={policy[key]}
                        onChange={(event) => setPolicy((current) => ({ ...current, [key]: Number(event.target.value) }))}
                      />
                      <p className="text-xs text-muted-foreground">Allowed: {min.toLocaleString()}–{max.toLocaleString()}</p>
                    </div>
                  ))}
                </div>
                <Button
                  onClick={() => savePolicy.mutate(policy)}
                  disabled={savePolicy.isPending || !summary}
                >
                  {savePolicy.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                  Save policy
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Trash2 className="h-5 w-5" />Manual cleanup</CardTitle>
                <CardDescription>Preview a precise, capped batch before any records are removed.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">Log categories</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {logCategories.map((category) => {
                      const isGlobal = globalFileCategories.includes(category);
                      const disabled = Boolean(projectId) && isGlobal;
                      return (
                        <label key={category} className={`flex items-center gap-2 rounded-md border p-2.5 text-sm ${disabled ? "opacity-50" : "cursor-pointer hover:bg-muted/50"}`}>
                          <Checkbox
                            checked={categories.includes(category)}
                            disabled={disabled}
                            onCheckedChange={(checked) => setCategory(category, checked === true)}
                          />
                          <span>{categoryLabels[category]}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">Error-report file categories are global and cannot be combined with a project filter.</p>
                </fieldset>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="cleanup-project">Project (optional)</Label>
                    <select
                      id="cleanup-project"
                      value={projectId}
                      onChange={(event) => {
                        const value = event.target.value;
                        setProjectId(value);
                        if (value) setCategories((current) => current.filter((category) => !globalFileCategories.includes(category)));
                        setPreview(null);
                        setActionError("");
                      }}
                      disabled={hasGlobalFileCategory}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="">All projects / global</option>
                      {summary.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cleanup-before">Delete records older than</Label>
                    <Input id="cleanup-before" type="datetime-local" value={before} onChange={(event) => { setBefore(event.target.value); setPreview(null); setActionError(""); }} />
                    <p className="text-xs text-muted-foreground">Your selected local time is converted to UTC before sending.</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    disabled={createPreview.isPending || categories.length === 0 || !before}
                    onClick={() => {
                      const filter = buildFilter();
                      if (filter) createPreview.mutate(filter);
                    }}
                  >
                    {createPreview.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Preview cleanup
                  </Button>
                  <span className="text-xs text-muted-foreground">Maximum 500 records per batch.</span>
                </div>
                {preview && (
                  <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4" role="status">
                    <div className="flex items-start gap-3">
                      <HardDrive className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-400" />
                      <div>
                        <p className="font-medium">Preview ready</p>
                        <p className="text-sm text-muted-foreground">{preview.count.toLocaleString()} records · {formatBytes(preview.bytes)} estimated</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Expires {formatDate(preview.expiresAt)} · {preview.limited ? "Batch capped at 500; run another preview for remaining eligible records." : "No batch limit reached."}
                        </p>
                      </div>
                    </div>
                    <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={preview.count === 0}>Review irreversible cleanup</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Clock3 className="h-5 w-5" />Recent cleanup history</CardTitle>
              <CardDescription>Most recent 20 cleanup attempts and policy changes, including partial failures.</CardDescription>
            </CardHeader>
            <CardContent>
              {summary.history.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="font-medium">No cleanup activity yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">Completed and partial cleanup attempts will appear here.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {summary.history.slice(0, 20).map((entry, index) => (
                    <div key={`${entry.at}-${entry.actor}-${index}`} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{entry.actor}</span>
                          {entry.action === "policySaved" && <Badge variant="outline">Policy saved</Badge>}
                          <Badge variant={entry.errors.length ? "destructive" : "secondary"}>{entry.errors.length ? `${entry.errors.length} error${entry.errors.length === 1 ? "" : "s"}` : "Complete"}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{formatDate(entry.at)}</p>
                        {entry.errors.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-destructive">{entry.errors.map((message, errorIndex) => <li key={`${errorIndex}-${message}`}>{message}</li>)}</ul>}
                      </div>
                      <div className="shrink-0 text-sm sm:text-right">
                        <p>{entry.removed.toLocaleString()} removed · {entry.skipped.toLocaleString()} skipped</p>
                        <p className="text-muted-foreground">{formatBytes(entry.bytes)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {actionError && (
        <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Action could not be completed</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      <Dialog open={confirmOpen} onOpenChange={(open) => { if (!cleanup.isPending) setConfirmOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />Confirm irreversible cleanup</DialogTitle>
            <DialogDescription>
              This will permanently remove {preview?.count.toLocaleString() ?? 0} selected log records (about {formatBytes(preview?.bytes ?? 0)}). This action cannot be undone. Backup and recovery data are not part of this cleanup and will be preserved. The preview token expires 10 minutes after creation.
            </DialogDescription>
          </DialogHeader>
          {preview?.limited && <Alert><AlertDescription>This batch is limited to 500 records. Remaining records are not included and require a new preview.</AlertDescription></Alert>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={cleanup.isPending}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => preview && cleanup.mutate(preview.token)}
              disabled={!preview || cleanup.isPending}
            >
              {cleanup.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Permanently clean selected logs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
