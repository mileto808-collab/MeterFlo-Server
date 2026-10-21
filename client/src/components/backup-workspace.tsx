import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Archive, CalendarClock, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Cloud, Download, FileDown, Filter, HardDrive, History, Loader2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTimezone } from "@/hooks/use-timezone";
import { useIsMobile } from "@/hooks/use-mobile";
import { InventoryMobileTools } from "@/components/inventory-mobile-tools";
import { backupTypeLabels, backupTypes } from "@shared/backup-schedules";
import type { BackupDashboard, BackupDestination, BackupRun, BackupSchedule, BackupScheduleInput } from "@shared/backup-schedules";
import { downloadCsv, exportBackupRuns } from "@/lib/backup-export";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Section = "backup" | "system" | "projects" | "files";
type Tab = "schedules" | "history" | "manual" | "projects" | "files";
type Status = BackupRun["status"];
type ExportFormat = "csv" | "xlsx" | "print";

interface RunsResponse {
  rows: BackupRun[];
  total: number;
}

interface Props {
  active: boolean;
  canManage: boolean;
  onSectionChange: (section: Section) => void;
  showSystemManual: boolean;
  showProjects: boolean;
  renderManual: (section: "system" | "projects" | "files") => ReactNode;
}

const PAGE_SIZE = 25;
const statuses: Status[] = ["queued", "running", "succeeded", "failed", "interrupted", "cancelled", "expired"];
const presetCrons: Record<string, string> = {
  hourly: "0 * * * *",
  daily: "0 2 * * *",
  weekly: "0 2 * * 0",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

async function jsonRequest<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await apiRequest(method, url, body);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function statusVariant(status: Status): "default" | "secondary" | "destructive" | "outline" {
  if (status === "succeeded") return "default";
  if (status === "failed" || status === "interrupted") return "destructive";
  if (status === "running" || status === "queued") return "secondary";
  return "outline";
}

function statusLabel(status: Status) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatBytes(bytes: number | null) {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 1; size >= 1024 && index < units.length; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size.toFixed(size < 10 ? 1 : 0)} ${unit}`;
}

function StatusMark({ status }: { status: Status }) {
  if (status === "succeeded") return <CheckCircle2 className="h-4 w-4 text-emerald-700" aria-hidden="true" />;
  if (status === "failed" || status === "interrupted") return <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />;
  if (status === "running" || status === "queued") return <Clock3 className="h-4 w-4 text-amber-700" aria-hidden="true" />;
  return <AlertCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />;
}

function ScheduleEditor({
  open, onOpenChange, initial, timezone, onSave, saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: BackupSchedule | null;
  timezone: string;
  onSave: (input: BackupScheduleInput) => void;
  saving: boolean;
}) {
  const [name, setName] = useState("");
  const [backupType, setBackupType] = useState<BackupScheduleInput["backupType"]>("database");
  const [cronPreset, setCronPreset] = useState("daily");
  const [cron, setCron] = useState(presetCrons.daily);
  const [scheduleTimezone, setScheduleTimezone] = useState(timezone || "UTC");
  const [enabled, setEnabled] = useState(true);
  const [retentionDays, setRetentionDays] = useState("30");
  const [minimumCopies, setMinimumCopies] = useState("3");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(initial?.name || "");
    setBackupType(initial?.backupType || "database");
    const knownPreset = Object.entries(presetCrons).find(([, value]) => value === initial?.cron)?.[0];
    setCronPreset(knownPreset || "custom");
    setCron(initial?.cron || presetCrons.daily);
    setScheduleTimezone(initial?.timezone || timezone || "UTC");
    setEnabled(initial?.enabled ?? true);
    setRetentionDays(String(initial?.retentionDays ?? 30));
    setMinimumCopies(String(initial?.minimumCopies ?? 3));
    setFormError("");
  }, [open, initial, timezone]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const days = Number(retentionDays);
    const copies = Number(minimumCopies);
    const selectedCron = cronPreset === "custom" ? cron.trim() : presetCrons[cronPreset];
    if (!name.trim()) return setFormError("Enter a schedule name.");
    if (!selectedCron || selectedCron.split(/\s+/).length !== 5) return setFormError("Use a valid five-field cron expression.");
    if (!Number.isInteger(days) || days < 1 || days > 3650) return setFormError("Retention must be between 1 and 3,650 days.");
    if (!Number.isInteger(copies) || copies < 1 || copies > 100) return setFormError("Keep at least 1 and no more than 100 successful copies.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: scheduleTimezone });
    } catch {
      return setFormError("Enter a valid IANA timezone, such as America/Denver.");
    }
    setFormError("");
    onSave({ name: name.trim(), backupType, cron: selectedCron, timezone: scheduleTimezone, enabled, retentionDays: days, minimumCopies: copies });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit backup schedule" : "New backup schedule"}</DialogTitle>
          <DialogDescription>Set the backup content, run time and retention policy for this schedule.</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="backup-schedule-name">Schedule name</Label>
            <Input id="backup-schedule-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="backup-type">Backup type</Label>
              <select id="backup-type" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={backupType} onChange={event => setBackupType(event.target.value as BackupScheduleInput["backupType"])}>
                {backupTypes.map(type => <option key={type} value={type}>{backupTypeLabels[type]}</option>)}
              </select>
              {backupType === "clean" && <p className="text-xs text-muted-foreground">
                For fresh installations. Includes base configuration and a fresh default admin, not project data, files, logs or audit history.
                Creating a backup does not delete source data.
                Change the default admin password before exposing the new server.
              </p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="backup-frequency">Frequency</Label>
              <select id="backup-frequency" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={cronPreset} onChange={event => setCronPreset(event.target.value)}>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily at 2:00 AM</option>
                <option value="weekly">Weekly, Sunday at 2:00 AM</option>
                <option value="custom">Custom cron</option>
              </select>
            </div>
          </div>
          {cronPreset === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="backup-cron">Five-field cron</Label>
              <Input id="backup-cron" value={cron} onChange={event => setCron(event.target.value)} placeholder="0 2 * * 1-5" />
              <p className="text-xs text-muted-foreground">Minute · hour · day of month · month · day of week.</p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="backup-timezone">Timezone</Label>
            <Input id="backup-timezone" value={scheduleTimezone} onChange={event => setScheduleTimezone(event.target.value)} placeholder="America/Denver" required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="backup-retention">Retention days</Label>
              <Input id="backup-retention" type="number" min={1} max={3650} value={retentionDays} onChange={event => setRetentionDays(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="backup-copies">Minimum successful copies</Label>
              <Input id="backup-copies" type="number" min={1} max={100} value={minimumCopies} onChange={event => setMinimumCopies(event.target.value)} />
            </div>
          </div>
          <div className="rounded-md border border-amber-300/70 bg-amber-50/60 p-3 text-sm text-amber-950">
            Retention removes only tracked backups created by this schedule. At least {minimumCopies || "1"} successful copies are always kept.
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-md border p-3 text-sm">
            <input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="h-4 w-4 accent-primary" />
            <span><span className="block font-medium">Schedule enabled</span><span className="text-muted-foreground">Turn off to pause future automatic runs.</span></span>
          </label>
          {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : initial ? "Save changes" : "Create schedule"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function BackupWorkspace({
  active, canManage, onSectionChange, showSystemManual, showProjects, renderManual,
}: Props) {
  const { toast } = useToast();
  const { formatDateTime } = useTimezone();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>("schedules");
  const [editing, setEditing] = useState<BackupSchedule | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BackupSchedule | null>(null);
  const [destinationKind, setDestinationKind] = useState<BackupDestination["kind"]>("app_storage");
  const [destinationPath, setDestinationPath] = useState("");
  const [bucketId, setBucketId] = useState("");
  const [search, setSearch] = useState("");
  const [scheduleSearch, setScheduleSearch] = useState("");
  const [scheduleTypeFilter, setScheduleTypeFilter] = useState("");
  const [scheduleEnabledFilter, setScheduleEnabledFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [scheduleFilter, setScheduleFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);

  const dashboardQuery = useQuery<BackupDashboard>({
    queryKey: ["/api/maintenance/backups"],
    enabled: active && canManage,
  });
  const dashboard = dashboardQuery.data;
  const matchingSchedules = useMemo(() => (dashboard?.schedules || []).filter(schedule => {
    const query = scheduleSearch.trim().toLocaleLowerCase();
    const matchesSearch = !query || `${schedule.name} ${schedule.cron} ${schedule.timezone} ${backupTypeLabels[schedule.backupType]}`.toLocaleLowerCase().includes(query);
    const matchesType = !scheduleTypeFilter || schedule.backupType === scheduleTypeFilter;
    const matchesEnabled = !scheduleEnabledFilter || (scheduleEnabledFilter === "enabled" ? schedule.enabled : !schedule.enabled);
    return matchesSearch && matchesType && matchesEnabled;
  }), [dashboard?.schedules, scheduleSearch, scheduleTypeFilter, scheduleEnabledFilter]);

  useEffect(() => {
    if (!dashboard) return;
    setDestinationKind(dashboard.destination?.kind || (dashboard.localAllowed ? "local" : "app_storage"));
    setDestinationPath(dashboard.destination?.path || "");
    setBucketId(dashboard.destination?.bucketId || "");
  }, [dashboard]);

  const filterParams = useMemo(() => ({
    search: search.trim(),
    status: statusFilter,
    backupType: typeFilter,
    scheduleId: scheduleFilter,
    from,
    to,
  }), [search, statusFilter, typeFilter, scheduleFilter, from, to]);
  const runQueryString = useMemo(() => {
    const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
    Object.entries(filterParams).forEach(([key, value]) => { if (value) params.set(key, value); });
    return params.toString();
  }, [filterParams, offset]);
  const runsQuery = useQuery<RunsResponse>({
    queryKey: ["/api/maintenance/backups/runs", runQueryString],
    queryFn: async () => jsonRequest<RunsResponse>("GET", `/api/maintenance/backups/runs?${runQueryString}`),
    enabled: active && canManage && tab === "history",
    refetchInterval: active && canManage && tab === "history" ? 10_000 : false,
  });

  useEffect(() => { setOffset(0); }, [filterParams]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/backups"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/maintenance/backups/runs"] }),
    ]);
  };

  const saveDestination = useMutation({
    mutationFn: (destination: BackupDestination) => jsonRequest<BackupDestination>("PUT", "/api/maintenance/backups/destination", destination),
    onSuccess: async saved => {
      setDestinationKind(saved.kind);
      setDestinationPath(saved.path);
      setBucketId(saved.bucketId || "");
      await queryClient.invalidateQueries({ queryKey: ["/api/maintenance/backups"] });
      toast({ title: "Destination saved", description: "MeterFlo confirmed access to the backup destination." });
    },
    onError: error => toast({ title: "Could not save destination", description: errorMessage(error), variant: "destructive" }),
  });
  const createSchedule = useMutation({
    mutationFn: (input: BackupScheduleInput) => jsonRequest<BackupSchedule>("POST", "/api/maintenance/backups/schedules", input),
    onSuccess: async () => { setEditorOpen(false); await invalidate(); toast({ title: "Schedule created" }); },
    onError: error => toast({ title: "Could not create schedule", description: errorMessage(error), variant: "destructive" }),
  });
  const updateSchedule = useMutation({
    mutationFn: ({ id, input }: { id: string; input: BackupScheduleInput }) => jsonRequest<BackupSchedule>("PATCH", `/api/maintenance/backups/schedules/${encodeURIComponent(id)}`, input),
    onSuccess: async () => { setEditorOpen(false); setEditing(null); await invalidate(); toast({ title: "Schedule updated" }); },
    onError: error => toast({ title: "Could not update schedule", description: errorMessage(error), variant: "destructive" }),
  });
  const deleteSchedule = useMutation({
    mutationFn: (id: string) => jsonRequest<void>("DELETE", `/api/maintenance/backups/schedules/${encodeURIComponent(id)}`),
    onSuccess: async () => { setDeleteTarget(null); await invalidate(); toast({ title: "Schedule removed", description: "Saved backup files and run history were retained." }); },
    onError: error => toast({ title: "Could not remove schedule", description: errorMessage(error), variant: "destructive" }),
  });
  const runNow = useMutation({
    mutationFn: (id: string) => jsonRequest<BackupRun>("POST", `/api/maintenance/backups/schedules/${encodeURIComponent(id)}/run`),
    onSuccess: async () => { setTab("history"); await invalidate(); toast({ title: "Backup queued", description: "The run will appear in history as it progresses." }); },
    onError: error => toast({ title: "Could not start backup", description: errorMessage(error), variant: "destructive" }),
  });

  const saveSchedule = (input: BackupScheduleInput) => {
    if (editing) updateSchedule.mutate({ id: editing.id, input });
    else createSchedule.mutate(input);
  };
  const openCreate = () => { setEditing(null); setEditorOpen(true); };
  const openEdit = (schedule: BackupSchedule) => { setEditing(schedule); setEditorOpen(true); };
  const handleDestinationSave = (event: FormEvent) => {
    event.preventDefault();
    saveDestination.mutate({ kind: destinationKind, path: destinationPath.trim(), bucketId: destinationKind === "app_storage" ? bucketId.trim() : "" });
  };

  const downloadRun = async (run: BackupRun) => {
    try {
      const response = await apiRequest("GET", `/api/maintenance/backups/runs/${encodeURIComponent(run.id)}/download`);
      if (!response.ok) {
        let message = "Could not download this backup.";
        try { message = (await response.json()).message || message; } catch { /* fallback */ }
        throw new Error(message);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1]?.replaceAll('"', "") || `backup-${run.id}.zip`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = decodeURIComponent(filename);
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast({ title: "Download failed", description: errorMessage(error), variant: "destructive" });
    }
  };
  const handleExport = async (format: ExportFormat) => {
    try {
      await exportBackupRuns(format, filterParams);
    } catch (error) {
      toast({ title: "Export failed", description: errorMessage(error), variant: "destructive" });
    }
  };
  const exportSchedules = () => {
    downloadCsv("meterflo-backup-schedules.csv",
      ["Name", "Backup type", "Schedule", "Timezone", "Status", "Next run", "Retention days", "Minimum copies"],
      matchingSchedules.map(schedule => [
        schedule.name, backupTypeLabels[schedule.backupType], schedule.cron, schedule.timezone,
        schedule.enabled ? "Enabled" : "Paused", schedule.nextRunAt || "",
        schedule.retentionDays, schedule.minimumCopies,
      ]));
  };
  const refresh = async () => {
    await Promise.all([dashboardQuery.refetch(), runsQuery.refetch()]);
  };

  const availableTabs: { key: Tab; label: string; icon: typeof Archive; enabled: boolean }[] = [
    { key: "schedules", label: "Schedules", icon: CalendarClock, enabled: canManage },
    { key: "history", label: "Run history", icon: History, enabled: canManage },
    { key: "manual", label: "Manual system", icon: Archive, enabled: showSystemManual },
    { key: "projects", label: "Projects", icon: HardDrive, enabled: showProjects },
    { key: "files", label: "Project files", icon: HardDrive, enabled: showProjects },
  ];
  const safeTab = availableTabs.find(item => item.key === tab && item.enabled) ? tab : (canManage ? "schedules" : showSystemManual ? "manual" : showProjects ? "projects" : "schedules");

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const selectTab = (next: Tab) => {
    setTab(next);
    const sections: Record<Tab, Section> = { schedules: "backup", history: "backup", manual: "system", projects: "projects", files: "files" };
    onSectionChange(sections[next]);
  };
  const pageCount = Math.max(1, Math.ceil((runsQuery.data?.total || 0) / PAGE_SIZE));
  const runs = runsQuery.data?.rows || [];

  return (
    <div className="space-y-4" data-testid="backup-workspace" data-screen-mode={isMobile ? "compact" : "full"}>
      <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <ShieldCheck className="h-4 w-4" /> Data protection
          </div>
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Backup &amp; Restore</h2>
          <p className="mt-1 text-sm text-muted-foreground">Schedules, saved backups and restore controls.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={dashboardQuery.isFetching || runsQuery.isFetching} aria-label="Refresh backup workspace">
            <RefreshCw className={`mr-2 h-4 w-4 ${dashboardQuery.isFetching || runsQuery.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {isMobile ? (
        <select aria-label="Backup section" value={safeTab} onChange={event => selectTab(event.target.value as Tab)}
          className="h-10 w-full rounded-md border bg-background px-3 text-sm">
          {availableTabs.filter(item => item.enabled).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      ) : (
      <div role="tablist" aria-label="Backup and restore sections" className="flex max-w-full gap-1 overflow-x-auto border-b">
        {availableTabs.filter(item => item.enabled).map(item => {
          const Icon = item.icon;
          const selected = safeTab === item.key;
          return (
            <button key={item.key} type="button" role="tab" aria-selected={selected} onClick={() => selectTab(item.key)} className={`flex min-w-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${selected ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              <Icon className="h-4 w-4" />{item.label}
            </button>
          );
        })}
      </div>)}

      {safeTab === "schedules" && canManage && (
        <div className="space-y-4" role="tabpanel" aria-label="Backup schedules">
          {dashboardQuery.isLoading ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_1.35fr]">
              <Skeleton className="h-52 w-full" /><Skeleton className="h-52 w-full" />
            </div>
          ) : dashboardQuery.isError ? (
            <Card className="border-destructive/40">
              <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3"><AlertCircle className="mt-0.5 h-5 w-5 text-destructive" /><div><p className="font-medium">Backup settings could not load</p><p className="text-sm text-muted-foreground">{errorMessage(dashboardQuery.error)}</p></div></div>
                <Button variant="outline" onClick={() => dashboardQuery.refetch()}>Try again</Button>
              </CardContent>
            </Card>
          ) : dashboard && (
            <>
              <div className={`grid gap-4 ${isMobile ? "grid-cols-1" : "lg:grid-cols-[0.85fr_1.15fr]"}`}>
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base"><Cloud className="h-4 w-4 text-primary" /> Saved destination</CardTitle>
                    <CardDescription>Backups are stored on the server destination you configure here.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleDestinationSave} className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="destination-kind">Destination type</Label>
                        <select id="destination-kind" value={destinationKind} onChange={event => setDestinationKind(event.target.value as BackupDestination["kind"])} className="h-10 w-full rounded-md border bg-background px-3 text-sm">
                          <option value="local" disabled={!dashboard.localAllowed}>Server folder</option>
                          <option value="app_storage">Application storage</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="destination-path">{destinationKind === "local" ? "Server folder path" : "Storage prefix"}</Label>
                        <Input id="destination-path" value={destinationPath} onChange={event => setDestinationPath(event.target.value)} placeholder={destinationKind === "local" ? "/var/backups/meterflo" : "meterflo/backups"} required maxLength={500} />
                        <p className="text-xs text-muted-foreground">Enter a path on the server. Browsers cannot choose a server folder.</p>
                      </div>
                      {destinationKind === "app_storage" && (
                        <div className="space-y-1.5">
                          <Label htmlFor="destination-bucket">Private App Storage bucket ID</Label>
                          <Input id="destination-bucket" value={bucketId} onChange={event => setBucketId(event.target.value)} placeholder="Enter the bucket ID" maxLength={200} required />
                          <p className="text-xs text-muted-foreground">Create or attach a <strong>private</strong> App Storage bucket, then enter its ID. This pins future backups to that bucket instead of an implicit default.</p>
                        </div>
                      )}
                      {!dashboard.localAllowed && <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{dashboard.hostingNotice || "Server-folder backups are unavailable on this host."}</p>}
                      <div className="flex items-center justify-between gap-3 pt-1">
                        <p className="text-xs text-muted-foreground">{dashboard.destination ? `Current: ${dashboard.destination.path}` : "No destination saved yet."}</p>
                        <Button type="submit" size="sm" disabled={saveDestination.isPending || !destinationPath.trim() || (destinationKind === "local" && !dashboard.localAllowed) || (destinationKind === "app_storage" && !bucketId.trim())}>
                          {saveDestination.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />} Save &amp; test
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
                    <div><CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="h-4 w-4 text-primary" /> Backup schedules</CardTitle><CardDescription>Automatic copies with an explicit retention floor.</CardDescription></div>
                    <Button size="sm" onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" /> New schedule</Button>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <InventoryMobileTools tab="backup-schedules">
                      <div className="space-y-2 rounded-md border bg-card p-2 sm:flex sm:flex-wrap sm:items-center">
                        <div className="relative min-w-0 w-full basis-full">
                          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                          <Input aria-label="Search schedules" type="search" autoComplete="off" placeholder="Search schedules" value={scheduleSearch} onChange={event => setScheduleSearch(event.target.value)} className="pl-9" />
                        </div>
                        <select aria-label="Filter schedules by backup type" value={scheduleTypeFilter} onChange={event => setScheduleTypeFilter(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-auto">
                          <option value="">All backup types</option>{backupTypes.map(type => <option key={type} value={type}>{backupTypeLabels[type]}</option>)}
                        </select>
                        <select aria-label="Filter schedules by enabled state" value={scheduleEnabledFilter} onChange={event => setScheduleEnabledFilter(event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm sm:w-auto">
                          <option value="">Enabled and paused</option><option value="enabled">Enabled</option><option value="paused">Paused</option>
                        </select>
                        <Button type="button" size="sm" variant="outline" onClick={exportSchedules} disabled={!matchingSchedules.length}><Download className="mr-1.5 h-4 w-4" /> Export CSV</Button>
                        <p className="w-full text-right text-xs text-muted-foreground sm:w-auto sm:ml-auto" aria-live="polite">{matchingSchedules.length} schedule{matchingSchedules.length === 1 ? "" : "s"}</p>
                      </div>
                    </InventoryMobileTools>
                    {dashboard.schedules.length === 0 ? (
                      <div className="rounded-md border border-dashed px-4 py-8 text-center">
                        <CalendarClock className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
                        <p className="font-medium">No schedules yet</p>
                        <p className="mb-3 mt-1 text-sm text-muted-foreground">Create a cadence for database, files or project documents.</p>
                        <Button variant="outline" size="sm" onClick={openCreate}><Plus className="mr-1.5 h-4 w-4" /> Add a schedule</Button>
                      </div>
                    ) : matchingSchedules.length === 0 ? (
                      <div className="rounded-md border border-dashed px-4 py-7 text-center">
                        <p className="font-medium">No matching schedules</p>
                        <p className="mt-1 text-sm text-muted-foreground">Adjust the search or filters to show schedules.</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {matchingSchedules.map(schedule => (
                          <div key={schedule.id} className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium">{schedule.name}</p><Badge variant={schedule.enabled ? "default" : "secondary"}>{schedule.enabled ? "Enabled" : "Paused"}</Badge></div>
                              <p className="mt-1 text-xs text-muted-foreground">{backupTypeLabels[schedule.backupType]} · {schedule.cron} · {schedule.timezone}</p>
                              <p className="mt-1 text-xs text-muted-foreground">Next run: {schedule.enabled && schedule.nextRunAt ? formatDateTime(schedule.nextRunAt) : "Not scheduled"} · Keep {schedule.minimumCopies} copies / {schedule.retentionDays} days</p>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-1">
                              <Button size="sm" onClick={() => runNow.mutate(schedule.id)} disabled={runNow.isPending} aria-label={`Run ${schedule.name} now`}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Run now</Button>
                              <Button size="icon" variant="ghost" onClick={() => openEdit(schedule)} aria-label={`Edit ${schedule.name}`}><Pencil className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDeleteTarget(schedule)} aria-label={`Delete ${schedule.name}`}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
              <Card className="border-primary/15 bg-primary/[0.035]">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><ShieldCheck className="h-5 w-5" /></div>
                  <p className="text-sm text-muted-foreground">Retention only removes tracked backup files from MeterFlo. The minimum successful copies setting is honored even when they are older than the retention window.</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      )}

      {safeTab === "history" && canManage && (
        <div className="space-y-4" role="tabpanel" aria-label="Backup run history">
          <Card>
            <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-end sm:justify-between">
              <div><CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4 text-primary" /> Run history</CardTitle><CardDescription>All scheduled and on-demand backup attempts. Updates every 10 seconds while open.</CardDescription></div>
            </CardHeader>
            <CardContent className="space-y-3">
              <InventoryMobileTools tab="backup-history">
                <div className="grid gap-2 rounded-md border bg-card p-2 sm:grid-cols-2 lg:grid-cols-6">
                  <div className="relative lg:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search backup history" placeholder="Search name or error" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" /></div>
                  <select aria-label="Filter by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="">Any status</option>{statuses.map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select>
                  <select aria-label="Filter by backup type" value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="">Any backup type</option>{backupTypes.map(type => <option key={type} value={type}>{backupTypeLabels[type]}</option>)}</select>
                  <select aria-label="Filter by schedule" value={scheduleFilter} onChange={event => setScheduleFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="">Any schedule</option>{dashboard?.schedules.map(schedule => <option key={schedule.id} value={schedule.id}>{schedule.name}</option>)}</select>
                  <div className="flex gap-2"><Input aria-label="From date" type="date" value={from} onChange={event => setFrom(event.target.value)} /><Input aria-label="To date" type="date" value={to} onChange={event => setTo(event.target.value)} /></div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleExport("csv")}><FileDown className="mr-1.5 h-4 w-4" /> CSV</Button>
                    <Button variant="outline" size="sm" onClick={() => handleExport("xlsx")}><FileDown className="mr-1.5 h-4 w-4" /> Excel</Button>
                    <Button variant="outline" size="sm" onClick={() => handleExport("print")} aria-label="Print all matching backup records">Print</Button>
                  </div>
                </div>
              </InventoryMobileTools>
              {runsQuery.isError && <div role="alert" className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><span>{errorMessage(runsQuery.error)}</span><Button size="sm" variant="outline" onClick={() => runsQuery.refetch()}>Retry</Button></div>}
              {runsQuery.isLoading ? (
                <div className="space-y-2">{[1, 2, 3, 4].map(index => <Skeleton key={index} className="h-12 w-full" />)}</div>
              ) : runs.length === 0 ? (
                <div className="rounded-md border border-dashed px-4 py-10 text-center">
                  <Filter className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
                  <p className="font-medium">No matching backup runs</p>
                  <p className="mt-1 text-sm text-muted-foreground">{filterParams.search || filterParams.status || filterParams.backupType || filterParams.scheduleId || from || to ? "Adjust or clear filters to broaden this history." : "Runs will appear here after a scheduled or manual backup starts."}</p>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Run</TableHead><TableHead>Backup</TableHead><TableHead>Status</TableHead><TableHead>Started</TableHead><TableHead>Size</TableHead><TableHead className="text-right">File</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {runs.map(run => (
                        <TableRow key={run.id}>
                          <TableCell className="min-w-[170px]"><p className="font-medium">{run.scheduleName || "Manual backup"}</p><p className="text-xs text-muted-foreground">{run.trigger === "manual" ? "On demand" : "Scheduled"}</p></TableCell>
                          <TableCell className="min-w-[160px]">{backupTypeLabels[run.backupType]}</TableCell>
                          <TableCell className="min-w-[150px]"><div className="flex items-center gap-2"><StatusMark status={run.status} /><Badge variant={statusVariant(run.status)}>{statusLabel(run.status)}</Badge></div>
                            {(run.error || run.cleanupError) && <p className="mt-1 max-w-[260px] text-xs text-destructive" title={[run.error, run.cleanupError].filter(Boolean).join(" · ")}>{run.error || `Cleanup warning: ${run.cleanupError}`}</p>}
                            {run.error && run.cleanupError && <p className="mt-1 max-w-[260px] text-xs text-amber-800">Cleanup warning: {run.cleanupError}</p>}
                          </TableCell>
                          <TableCell className="min-w-[160px]">{formatDateTime(run.startedAt || run.createdAt)}</TableCell>
                          <TableCell>{formatBytes(run.bytes)}</TableCell>
                          <TableCell className="text-right">{run.status === "succeeded" ? <Button variant="outline" size="sm" onClick={() => downloadRun(run)}><Download className="mr-1.5 h-4 w-4" /> Download</Button> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
              <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">{runsQuery.data ? `${runsQuery.data.total.toLocaleString()} matching runs` : "History"}{runsQuery.isFetching && <span className="ml-2">Updating…</span>}</p>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <span className="text-sm text-muted-foreground">Page {currentPage} of {pageCount}</span>
                  <Button variant="outline" size="icon" aria-label="Previous page" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}><ChevronLeft className="h-4 w-4" /></Button>
                  <Button variant="outline" size="icon" aria-label="Next page" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={!runsQuery.data || offset + PAGE_SIZE >= runsQuery.data.total}><ChevronRight className="h-4 w-4" /></Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {safeTab === "manual" && showSystemManual && <div role="tabpanel" aria-label="Manual system backup and restore">{renderManual("system")}</div>}
      {safeTab === "projects" && showProjects && <div role="tabpanel" aria-label="Project database backup and restore">{renderManual("projects")}</div>}
      {safeTab === "files" && showProjects && <div role="tabpanel" aria-label="Project files backup and restore">{renderManual("files")}</div>}

      <ScheduleEditor open={editorOpen} onOpenChange={open => { setEditorOpen(open); if (!open) setEditing(null); }} initial={editing} timezone={dashboard?.defaultTimezone || "UTC"} onSave={saveSchedule} saving={createSchedule.isPending || updateSchedule.isPending} />
      <Dialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Remove this schedule?</DialogTitle><DialogDescription>“{deleteTarget?.name}” will stop running. This does not delete saved backup files or any run history; retention rules for these existing copies are not changed.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>Keep schedule</Button><Button variant="destructive" onClick={() => deleteTarget && deleteSchedule.mutate(deleteTarget.id)} disabled={deleteSchedule.isPending}>{deleteSchedule.isPending ? "Removing…" : "Remove schedule"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
