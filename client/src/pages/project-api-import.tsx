import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft, Cable, Check, ChevronDown, CircleAlert, Clock3, Code2, Eye,
  History, Loader2, Play, Plus, RefreshCw, RotateCcw, Save, ShieldCheck,
  Trash2, Waypoints,
} from "lucide-react";
import {
  importFields, safeUpdateFields,
  type ApiImportConfig, type ApiImportPreview, type ApiImportRun, type ApiImportSettings, type ImportField,
} from "@shared/customer-api-import";

const fieldLabels: Record<string, string> = {
  customerWoId: "Customer work-order ID", customerId: "Customer ID", customerName: "Customer name",
  address: "Address", city: "City", state: "State / region", zip: "ZIP / postal code", phone: "Phone",
  email: "Email", route: "Route", zone: "Zone", serviceType: "Service type", oldSystemId: "Old system ID",
  oldSystemReading: "Old system reading", oldGps: "Old GPS", oldSystemType: "Old system type",
  oldModuleId: "Old module ID", oldModuleRead: "Old module reading", oldModuleType: "Old module type",
  status: "Status", notes: "Notes",
  inventoryItems: "Inventory items (JSON array)",
};
const legacyAssetTypeTargets = ["oldSystemType", "newSystemType", "oldModuleType", "newModuleType"];
const cleanFieldMapping = (mapping: Record<string, string>, inventoryEnabled: boolean) =>
  Object.fromEntries(Object.entries(mapping).filter(([, target]) =>
    inventoryEnabled
      ? !legacyAssetTypeTargets.includes(target)
      : target !== "inventoryItems",
  ));
const defaults: ApiImportSettings = {
  name: "", endpoint: "", authType: "none", secretEnvVar: "", keyHeader: "X-API-Key",
  recordsPath: "", fieldMapping: { id: "customerWoId" }, queryParams: {}, pagination: "none",
  pageParam: "page", startPage: 1, pageSizeParam: "limit", pageSize: 100, nextPath: "",
  cursorParam: "cursor", resumeCursor: false, watermarkParam: "", intervalMinutes: 0,
  isEnabled: true, updateMode: "create_only", updateFields: [],
};
const settingsFrom = (config: ApiImportConfig): ApiImportSettings => ({
  name: config.name, endpoint: config.endpoint, authType: config.authType, secretEnvVar: config.secretEnvVar,
  keyHeader: config.keyHeader, recordsPath: config.recordsPath, fieldMapping: config.fieldMapping,
  queryParams: config.queryParams, pagination: config.pagination, pageParam: config.pageParam,
  startPage: config.startPage, pageSizeParam: config.pageSizeParam, pageSize: config.pageSize,
  nextPath: config.nextPath, cursorParam: config.cursorParam, resumeCursor: config.resumeCursor,
  watermarkParam: config.watermarkParam, intervalMinutes: config.intervalMinutes, isEnabled: config.isEnabled,
  updateMode: config.updateMode, updateFields: config.updateFields,
});

async function apiJson<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await apiRequest(method, url, body);
  if (response.status === 204) return undefined as T;
  return response.json();
}
function errorText(error: unknown) {
  const text = error instanceof Error ? error.message : "Something went wrong.";
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]).message || text;
  } catch { /* use response message */ }
  return text.replace(/^\d+:\s*/, "");
}
function prettyDate(value?: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
function statusTone(status: string) {
  if (["completed", "success", "succeeded"].includes(status.toLowerCase())) return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (["partial", "failed", "interrupted", "cancelled", "error"].includes(status.toLowerCase())) return "bg-rose-100 text-rose-800 border-rose-200";
  if (["queued", "running", "retrying", "pending"].includes(status.toLowerCase())) return "bg-amber-100 text-amber-900 border-amber-200";
  return "bg-muted text-muted-foreground";
}
const activeRunStatuses = ["queued", "running", "retrying"];
const retryableRunStatuses = ["partial", "failed", "interrupted", "cancelled"];

export default function ProjectApiImport({ projectId: explicitProjectId }: { projectId?: number } = {}) {
  const [, params] = useRoute("/projects/:projectId/api-import");
  const projectId = explicitProjectId ?? Number(params?.projectId);
  const [, navigate] = useLocation();
  const { user, hasPermission } = usePermissions();
  const { toast } = useToast();
  const canView = hasPermission("project.apiImport");
  const canConfigure = user?.role === "admin" || user?.subroleKey === "administrator";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<ApiImportSettings>(defaults);
  const [mappingText, setMappingText] = useState(JSON.stringify(defaults.fieldMapping, null, 2));
  const [paramsText, setParamsText] = useState("{}");
  const [editorError, setEditorError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ApiImportConfig | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ApiImportConfig | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<ApiImportPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [runningId, setRunningId] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);

  const { data: project, isLoading: projectLoading, error: projectError } = useQuery<any>({
    queryKey: ["/api/projects", projectId], enabled: !!projectId, retry: false,
  });
  const inventoryEnabled = Boolean(project?.inventoryEnabled);
  const availableFieldKeys = useMemo(() => {
    const fields = Object.keys(importFields);
    const withoutLegacyTypes = inventoryEnabled
      ? fields.filter(field => !legacyAssetTypeTargets.includes(field))
      : fields;
    return inventoryEnabled
      ? [...withoutLegacyTypes.filter(field => field !== "inventoryItems"), "inventoryItems"]
      : withoutLegacyTypes.filter(field => field !== "inventoryItems");
  }, [inventoryEnabled]);
  const { data: configs, isLoading: configsLoading, error: configsError, refetch: refetchConfigs } =
    useQuery<ApiImportConfig[]>({
      queryKey: [`/api/projects/${projectId}/api-import/configs`],
      enabled: !!projectId && canView && !projectError,
      refetchInterval: (query) => {
        const records = query.state.data as ApiImportConfig[] | undefined;
        return records?.some(c => c.lastRun && activeRunStatuses.includes(c.lastRun.status.toLowerCase())) ? 5000 : false;
      },
    });
  const { data: runs = [], isLoading: runsLoading, error: runsError, refetch: refetchRuns } = useQuery<ApiImportRun[]>({
    queryKey: [`/api/projects/${projectId}/api-import/runs`, 25, offset],
    queryFn: () => apiJson<ApiImportRun[]>("GET", `/api/projects/${projectId}/api-import/runs?limit=25&offset=${offset}`),
    enabled: !!projectId && canView && !projectError,
    refetchInterval: query => {
      const rows = query.state.data as ApiImportRun[] | undefined;
      return rows?.some(run => activeRunStatuses.includes(run.status.toLowerCase())) ? 5000 : false;
    },
  });
  const configsKey = [`/api/projects/${projectId}/api-import/configs`];
  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: configsKey });
    queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/api-import/runs`] });
  };
  const createMutation = useMutation({
    mutationFn: (settings: ApiImportSettings) => apiJson<ApiImportConfig>("POST", `/api/projects/${projectId}/api-import/configs`, settings),
    onSuccess: () => { refreshAll(); setDialogOpen(false); toast({ title: "API source created" }); },
    onError: error => toast({ title: "Could not create source", description: errorText(error), variant: "destructive" }),
  });
  const updateMutation = useMutation({
    mutationFn: ({ id, settings }: { id: number; settings: Partial<ApiImportSettings> }) =>
      apiJson<ApiImportConfig>("PATCH", `/api/projects/${projectId}/api-import/configs/${id}`, settings),
    onSuccess: () => { refreshAll(); setDialogOpen(false); toast({ title: "API source saved" }); },
    onError: error => toast({ title: "Could not save source", description: errorText(error), variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiJson("DELETE", `/api/projects/${projectId}/api-import/configs/${id}`),
    onSuccess: () => { refreshAll(); setDeleteTarget(null); toast({ title: "Source removed", description: "Existing work orders and import history were kept." }); },
    onError: error => toast({ title: "Could not remove source", description: errorText(error), variant: "destructive" }),
  });
  const runMutation = useMutation({
    mutationFn: (id: number) => apiJson<ApiImportRun>("POST", `/api/projects/${projectId}/api-import/configs/${id}/run`),
    onSuccess: () => { refreshAll(); toast({ title: "Import queued", description: "Progress will appear in run history." }); },
    onError: error => toast({ title: "Could not start import", description: errorText(error), variant: "destructive" }),
  });
  const retryMutation = useMutation({
    mutationFn: (runId: string) => apiJson<ApiImportRun>("POST", `/api/projects/${projectId}/api-import/runs/${runId}/retry`),
    onSuccess: () => { refreshAll(); toast({ title: "Retry queued" }); },
    onError: error => toast({ title: "Could not retry run", description: errorText(error), variant: "destructive" }),
  });
  const previewMutation = useMutation({
    mutationFn: (target: { kind: "saved"; configId: number } | { kind: "draft"; settings: ApiImportSettings }) =>
      target.kind === "saved"
        ? apiJson<ApiImportPreview>("POST", `/api/projects/${projectId}/api-import/configs/${target.configId}/preview`)
        : apiJson<ApiImportPreview>("POST", `/api/projects/${projectId}/api-import/preview`, target.settings),
    onSuccess: data => { setPreview(data); setPreviewError(""); },
    onError: error => { setPreview(null); setPreviewError(errorText(error)); },
  });
  const activeRuns = useMemo(() => runs.filter(r => activeRunStatuses.includes(r.status.toLowerCase())).length, [runs]);

  useEffect(() => {
    setOffset(0); setPreview(null); setPreviewError(""); setDialogOpen(false); setPreviewOpen(false);
    setEditingId(null); setDeleteTarget(null);
  }, [projectId]);
  function openCreate() {
    setEditingId(null); setDraft({ ...defaults, fieldMapping: { id: "customerWoId" } });
    setMappingText(JSON.stringify({ id: "customerWoId" }, null, 2)); setParamsText("{}");
    setEditorError(""); setDialogOpen(true);
  }
  function openEdit(config: ApiImportConfig) {
    const settings = settingsFrom(config);
    const fieldMapping = cleanFieldMapping(settings.fieldMapping as Record<string, string>, inventoryEnabled);
    setEditingId(config.id); setDraft({ ...settings, fieldMapping: fieldMapping as ApiImportSettings["fieldMapping"] });
    setMappingText(JSON.stringify(fieldMapping, null, 2));
    setParamsText(JSON.stringify(settings.queryParams, null, 2));
    setEditorError(""); setDialogOpen(true);
  }
  function getCompleteSettings(): ApiImportSettings | null {
    try {
      const parsedFieldMapping = JSON.parse(mappingText);
      const queryParams = JSON.parse(paramsText);
      if (!parsedFieldMapping || Array.isArray(parsedFieldMapping) || typeof parsedFieldMapping !== "object") throw new Error("Field mapping must be a JSON object.");
      if (!queryParams || Array.isArray(queryParams) || typeof queryParams !== "object") throw new Error("Query parameters must be a JSON object.");
      const fieldMapping = cleanFieldMapping(parsedFieldMapping as Record<string, string>, inventoryEnabled);
      const mandatoryTargets: ImportField[] = ["customerWoId", "customerId", "customerName", "address", "serviceType"];
      const mappedTargets = Object.values(fieldMapping);
      const missingTargets = mandatoryTargets.filter(target => !mappedTargets.includes(target));
      if (missingTargets.length) {
        throw new Error(`Map all required baseline fields before saving or previewing: ${missingTargets.map(target => fieldLabels[target]).join(", ")}.`);
      }
      if (draft.intervalMinutes !== 0 && draft.intervalMinutes < 15) throw new Error("Scheduled imports must be at least 15 minutes apart, or set to 0 for manual runs.");
      setEditorError("");
      return { ...draft, fieldMapping: fieldMapping as ApiImportSettings["fieldMapping"], queryParams };
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : "Fix the JSON before continuing.");
      return null;
    }
  }
  function save() {
    const settings = getCompleteSettings();
    if (!settings) return;
    if (editingId) updateMutation.mutate({ id: editingId, settings });
    else createMutation.mutate(settings);
  }
  function previewSettings() {
    const settings = getCompleteSettings();
    if (settings) {
      setPreviewTarget(null);
      setPreview(null);
      setPreviewError("");
      setPreviewOpen(true);
      previewMutation.mutate({ kind: "draft", settings });
    }
  }
  function runPreview(config: ApiImportConfig) {
    setPreviewTarget(config); setPreview(null); setPreviewError("");
    setPreviewOpen(true);
    previewMutation.mutate({ kind: "saved", configId: config.id });
  }
  function field<K extends keyof ApiImportSettings>(key: K, value: ApiImportSettings[K]) {
    setDraft(current => ({ ...current, [key]: value }));
  }
  const accessDenied = (error: unknown) => /403|forbidden|not assigned|404/i.test(errorText(error));

  if (!projectId || Number.isNaN(projectId)) {
    return <main className="mx-auto max-w-4xl p-8"><Alert variant="destructive"><CircleAlert className="h-4 w-4" /><AlertTitle>Invalid project</AlertTitle><AlertDescription>This API importer needs a valid project URL.</AlertDescription></Alert></main>;
  }
  if (projectLoading) return <main className="mx-auto max-w-6xl space-y-5 p-6"><Skeleton className="h-10 w-72" /><Skeleton className="h-36 w-full" /><Skeleton className="h-64 w-full" /></main>;
  if (projectError || !project || !canView) {
    const denied = !!projectError || !canView;
    return <main className="mx-auto max-w-3xl p-8"><Card className="border-rose-200 bg-rose-50/60"><CardHeader><CardTitle>{denied ? "Access to this project is unavailable" : "Project not found"}</CardTitle><CardDescription>{projectError ? errorText(projectError) : !canView ? "Your account does not have the project.apiImport permission. Project membership is also required." : "The requested project could not be found."}</CardDescription></CardHeader><CardContent><Button variant="outline" onClick={() => navigate("/projects")}><ArrowLeft className="mr-2 h-4 w-4" />Back to projects</Button></CardContent></Card></main>;
  }
  if (configsError && accessDenied(configsError)) {
    return <main className="mx-auto max-w-3xl p-8"><Alert variant="destructive"><CircleAlert className="h-4 w-4" /><AlertTitle>Project access denied</AlertTitle><AlertDescription>This project is not available to your account. Confirm your project membership or ask an administrator for access.</AlertDescription></Alert></main>;
  }

  return (
    <main className="min-h-[100dvh] bg-[hsl(var(--background))]">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-9">
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button variant="ghost" size="icon" className="mt-1" onClick={() => navigate(`/projects/${projectId}/work-orders`)} aria-label="Back to project"><ArrowLeft className="h-4 w-4" /></Button>
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"><Cable className="h-4 w-4 text-primary" />Project data source</div>
              <h1 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Customer API pull</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Bring work orders in from a customer endpoint. Preview mappings first; imports never write during a connection test.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full border bg-card px-3 py-2 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${activeRuns ? "animate-pulse bg-amber-500" : "bg-emerald-500"}`} />
            {activeRuns ? `${activeRuns} active run${activeRuns === 1 ? "" : "s"}` : "Importer standing by"}
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-[1.3fr_.7fr]">
          <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card">
            <CardContent className="flex flex-wrap items-center justify-between gap-5 p-5 md:p-7">
              <div className="max-w-xl">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"><ShieldCheck className="h-3.5 w-3.5" />Safe by default</div>
                <h2 className="font-display text-xl font-semibold">Create-only protects your existing work</h2>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">A stable customer work-order ID is required. Safe updates are opt-in and limited to an explicit field allowlist.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-xl border bg-background/80 px-4 py-3"><strong className="block font-mono text-2xl">{configs?.length ?? "—"}</strong><span className="text-xs text-muted-foreground">sources</span></div>
                <div className="rounded-xl border bg-background/80 px-4 py-3"><strong className="block font-mono text-2xl">{runs.length}</strong><span className="text-xs text-muted-foreground">recent runs</span></div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-dashed">
            <CardHeader className="pb-2"><CardTitle className="text-base">Security boundary</CardTitle><CardDescription>Credentials stay server-side.</CardDescription></CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground">Enter only an environment variable <em>name</em> for secrets. Secret values are never requested or shown here. Keep credentials out of URLs and query parameters.</CardContent>
          </Card>
        </div>

        {configsError && !accessDenied(configsError) && <Alert variant="destructive" className="mb-5"><CircleAlert className="h-4 w-4" /><AlertTitle>Sources could not load</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3">{errorText(configsError)}<Button size="sm" variant="outline" onClick={() => refetchConfigs()}><RefreshCw className="mr-2 h-3.5 w-3.5" />Try again</Button></AlertDescription></Alert>}

        <section className="mb-9">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">01 / Connections</p><h2 className="mt-1 font-display text-2xl font-semibold">Configured sources</h2></div>
            {canConfigure ? <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Add API source</Button> : <Badge variant="outline" className="py-1.5">View and run only · Administrator required to configure</Badge>}
          </div>
          {configsLoading ? <div className="grid gap-3">{[1, 2].map(n => <Skeleton key={n} className="h-40 w-full rounded-xl" />)}</div> :
            !configs?.length ? <Card className="border-dashed bg-card/70"><CardContent className="flex flex-col items-center px-5 py-12 text-center"><div className="mb-4 rounded-2xl bg-primary/10 p-4 text-primary"><Waypoints className="h-7 w-7" /></div><h3 className="font-display text-xl font-semibold">No customer APIs connected</h3><p className="mt-2 max-w-md text-sm text-muted-foreground">Create a source with an endpoint and field mapping. You can test the connection and inspect mapped records before any work order is created.</p>{canConfigure && <Button className="mt-5" onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Set up first source</Button>}</CardContent></Card> :
              <div className="space-y-3">{configs.map(config => <Card key={config.id} className="overflow-hidden">
                <CardContent className="p-0">
                  <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="font-display text-lg font-semibold">{config.name}</h3><Badge variant="outline" className={config.isEnabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "bg-muted text-muted-foreground"}>{config.isEnabled ? "Enabled" : "Disabled"}</Badge><Badge variant="outline">{config.authType === "none" ? "No auth" : config.authType.replace("_", " ")}</Badge><Badge variant="outline">{config.updateMode === "create_only" ? "Create-only" : "Safe update"}</Badge></div>
                      <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{config.endpoint}</p>
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>Schedule: {config.intervalMinutes ? `Every ${config.intervalMinutes} minutes` : "Manual"}</span><span>Pagination: {config.pagination.replace("_", " ")}</span><span>Next: {prettyDate(config.nextRunAt)}</span><span>Last run: {config.lastRun ? `${config.lastRun.status} · ${prettyDate(config.lastRun.completedAt || config.lastRun.startedAt)}` : "Never"}</span></div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {canConfigure && <div className="mr-1 flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={config.isEnabled} aria-label={`Enable ${config.name}`} onCheckedChange={checked => updateMutation.mutate({ id: config.id, settings: { isEnabled: checked } })} />{config.isEnabled ? "On" : "Off"}</div>}
                      <Button variant="outline" size="sm" onClick={() => runPreview(config)} disabled={previewMutation.isPending}><Eye className="mr-1.5 h-3.5 w-3.5" />Test / preview</Button>
                      <Button size="sm" onClick={() => runMutation.mutate(config.id)} disabled={!config.isEnabled || runMutation.isPending}><Play className="mr-1.5 h-3.5 w-3.5" />Pull now</Button>
                      {canConfigure && <><Button variant="ghost" size="icon" onClick={() => openEdit(config)} aria-label={`Edit ${config.name}`}><Code2 className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteTarget(config)} aria-label={`Remove ${config.name}`}><Trash2 className="h-4 w-4" /></Button></>}
                    </div>
                  </div>
                  {config.lastRun && <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/25 px-5 py-3 text-xs"><div className="flex flex-wrap items-center gap-3"><Badge variant="outline" className={statusTone(config.lastRun.status)}>{config.lastRun.status}</Badge><span>{config.lastRun.created} created</span><span>{config.lastRun.updated} updated</span><span>{config.lastRun.skipped} skipped</span><span className={config.lastRun.failed ? "font-medium text-destructive" : ""}>{config.lastRun.failed} failed</span><span>{config.lastRun.pages} pages · {config.lastRun.fetchAttempts} attempts</span></div>{canConfigure && retryableRunStatuses.includes(config.lastRun.status.toLowerCase()) && <Button variant="outline" size="sm" onClick={() => retryMutation.mutate(config.lastRun!.id)} disabled={retryMutation.isPending}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Retry run</Button>}</div>}
                </CardContent>
              </Card>)}</div>}
        </section>

        <section>
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">02 / Activity</p><h2 className="mt-1 font-display text-2xl font-semibold">Run history</h2></div><Button variant="outline" size="sm" onClick={() => { refetchRuns(); refetchConfigs(); }}><RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh</Button></div>
          <Card><CardContent className="p-0">
            {runsLoading ? <div className="space-y-3 p-5"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div> :
             runsError ? <div className="p-5"><Alert variant="destructive"><CircleAlert className="h-4 w-4" /><AlertTitle>Run history unavailable</AlertTitle><AlertDescription className="flex items-center justify-between gap-3">{errorText(runsError)}<Button size="sm" variant="outline" onClick={() => refetchRuns()}>Retry</Button></AlertDescription></Alert></div> :
             !runs.length ? <div className="flex flex-col items-center px-5 py-10 text-center"><History className="mb-3 h-6 w-6 text-muted-foreground" /><h3 className="font-medium">No runs yet</h3><p className="mt-1 text-sm text-muted-foreground">Queued imports and their outcomes will be listed here.</p></div> :
              <div className="divide-y">{runs.map(run => <RunRow key={run.id} run={run} canRetry={canConfigure && !!configs?.some(config => config.id === run.configId)} retrying={retryMutation.isPending} onRetry={() => retryMutation.mutate(run.id)} />)}</div>}
            {!!runs.length && <div className="flex items-center justify-between border-t px-4 py-3"><span className="text-xs text-muted-foreground">Showing {offset + 1}–{offset + runs.length} recent runs</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 25))}>Newer</Button><Button size="sm" variant="outline" disabled={runs.length < 25} onClick={() => setOffset(offset + 25)}>Older</Button></div></div>}
          </CardContent></Card>
        </section>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl">{editingId ? "Edit API source" : "Add customer API source"}</DialogTitle><DialogDescription>Configure request behavior and map customer record paths to MeterFlo fields. No secret values are accepted.</DialogDescription></DialogHeader>
          <div className="space-y-7 py-2">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Source name"><Input value={draft.name} maxLength={150} onChange={e => field("name", e.target.value)} placeholder="North district work orders" /></FormField>
              <FormField label="Endpoint URL"><Input value={draft.endpoint} maxLength={2000} onChange={e => field("endpoint", e.target.value)} placeholder="https://api.customer.example/v1/work-orders" /></FormField>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <h3 className="mb-3 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" />Authentication</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <FormField label="Method"><Select value={draft.authType} onValueChange={(value: ApiImportSettings["authType"]) => field("authType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="api_key">API key header</SelectItem><SelectItem value="bearer_token">Bearer token</SelectItem><SelectItem value="basic_auth">Basic authentication</SelectItem></SelectContent></Select></FormField>
                {draft.authType !== "none" && <FormField label="Server environment variable name" hint="Name only, e.g. CUSTOMER_API_TOKEN"><Input value={draft.secretEnvVar} maxLength={100} autoComplete="off" onChange={e => field("secretEnvVar", e.target.value.toUpperCase())} placeholder="CUSTOMER_API_TOKEN" /></FormField>}
                {draft.authType === "api_key" && <FormField label="Request header"><Input value={draft.keyHeader} maxLength={100} onChange={e => field("keyHeader", e.target.value)} placeholder="X-API-Key" /></FormField>}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">Never paste a token or password. Configure its value in the server environment; this form stores only the variable name.</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Records path" hint="Dot-separated path to the array; blank means response is an array. Example: data.items"><Input value={draft.recordsPath} maxLength={200} onChange={e => field("recordsPath", e.target.value)} placeholder="data.records" /></FormField>
              <div className="grid grid-cols-2 gap-3"><FormField label="Schedule (minutes)" hint="0 = manual; otherwise 15 minutes or more"><Input type="number" min={0} max={43200} value={draft.intervalMinutes} onChange={e => field("intervalMinutes", Number(e.target.value))} /></FormField><FormField label="Enabled"><div className="flex h-10 items-center gap-3 rounded-md border bg-background px-3"><Switch checked={draft.isEnabled} onCheckedChange={value => field("isEnabled", value)} /><span className="text-sm">{draft.isEnabled ? "Scheduled / runnable" : "Disabled"}</span></div></FormField></div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div className="space-y-3">
                <Alert className="border-primary/20 bg-primary/5"><ShieldCheck className="h-4 w-4 text-primary" /><AlertTitle>Open baseline work orders only</AlertTitle><AlertDescription>Imported records use the Open baseline status. Every mapping must include these required targets: customerWoId, customerId, customerName, address, and serviceType.</AlertDescription></Alert>
                <FormField label="Field mapping JSON" hint={inventoryEnabled
                  ? 'Each sourcePath maps to one MeterFlo target. Example: { "workOrder.id": "customerWoId", "stock": "inventoryItems" }. The stock source must be an array (or a JSON string) of { "warehouseId": "warehouse-id", "itemId": "item-id", "quantity": 2, "serials": [] }.'
                  : 'Each sourcePath maps to one unique MeterFlo target. Example: { "workOrder.id": "customerWoId", "customer.name": "customerName" }.'}>
                  <Textarea className="min-h-48 font-mono text-xs" value={mappingText} onChange={e => setMappingText(e.target.value)} spellCheck={false} />
                </FormField>
              </div>
              <div><FormField label="Query parameters JSON" hint="Static request query values only. Credential-like names are rejected. Example: { &quot;region&quot;: &quot;north&quot; }"><Textarea className="min-h-32 font-mono text-xs" value={paramsText} onChange={e => setParamsText(e.target.value)} spellCheck={false} /></FormField>
                <div className="mt-3"><FormField label="Watermark parameter (optional)" hint="Parameter name for incremental reads; do not use a credential name."><Input value={draft.watermarkParam} maxLength={100} onChange={e => field("watermarkParam", e.target.value)} placeholder="updated_since" /></FormField></div>
              </div>
            </div>
            <div className="rounded-xl border p-4">
              <h3 className="mb-1 font-semibold">Pagination</h3><p className="mb-4 text-xs text-muted-foreground">Choose how the remote API advances through result pages.</p>
              <div className="grid gap-4 md:grid-cols-3"><FormField label="Strategy"><Select value={draft.pagination} onValueChange={(value: ApiImportSettings["pagination"]) => field("pagination", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem><SelectItem value="page">Page number</SelectItem><SelectItem value="cursor">Cursor</SelectItem><SelectItem value="next_url">Next URL</SelectItem></SelectContent></Select></FormField>
                {draft.pagination === "page" && <><FormField label="Page parameter"><Input value={draft.pageParam} onChange={e => field("pageParam", e.target.value)} /></FormField><FormField label="First page"><Input type="number" value={draft.startPage} onChange={e => field("startPage", Number(e.target.value))} /></FormField><FormField label="Page size parameter"><Input value={draft.pageSizeParam} onChange={e => field("pageSizeParam", e.target.value)} /></FormField><FormField label="Page size"><Input type="number" min={1} max={1000} value={draft.pageSize} onChange={e => field("pageSize", Number(e.target.value))} /></FormField></>}
                {(draft.pagination === "cursor" || draft.pagination === "next_url") && <FormField label={draft.pagination === "cursor" ? "Cursor response path" : "Next URL response path"} hint="Dot-separated path to the next cursor / URL in a response."><Input value={draft.nextPath} onChange={e => field("nextPath", e.target.value)} placeholder="links.next" /></FormField>}
                {draft.pagination === "cursor" && <><FormField label="Cursor query parameter"><Input value={draft.cursorParam} onChange={e => field("cursorParam", e.target.value)} /></FormField><div className="flex items-center gap-2 self-end pb-2"><Switch checked={draft.resumeCursor} onCheckedChange={value => field("resumeCursor", value)} /><span className="text-sm">Resume saved cursor</span></div></>}
              </div>
            </div>
            <div className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-4">
              <div className="grid gap-4 md:grid-cols-2"><FormField label="Update behavior"><Select value={draft.updateMode} onValueChange={(value: ApiImportSettings["updateMode"]) => field("updateMode", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="create_only">Create-only (recommended)</SelectItem><SelectItem value="safe_update">Safe update selected fields</SelectItem></SelectContent></Select></FormField><div className="text-sm leading-relaxed text-amber-950/75">{draft.updateMode === "create_only" ? "Incoming records will not change existing work orders." : "Only the selected baseline fields can be updated. Work-order ID, status, and notes are never eligible."}</div></div>
              {draft.updateMode === "safe_update" && <div className="mt-4 flex flex-wrap gap-2">{safeUpdateFields.filter(key => !inventoryEnabled || !legacyAssetTypeTargets.includes(key)).map(key => <label key={key} className="flex cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs"><input type="checkbox" checked={draft.updateFields.includes(key)} onChange={e => field("updateFields", e.target.checked ? [...draft.updateFields, key] : draft.updateFields.filter(item => item !== key))} />{fieldLabels[key]}</label>)}</div>}
            </div>
            {editorError && <Alert variant="destructive"><CircleAlert className="h-4 w-4" /><AlertDescription>{editorError}</AlertDescription></Alert>}
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground"><strong>Available target fields:</strong> {availableFieldKeys.map(key => fieldLabels[key]).join(" · ")}</div>
          </div>
          <DialogFooter className="flex-wrap sm:justify-between">
            <Button variant="outline" onClick={previewSettings} disabled={previewMutation.isPending}><Eye className="mr-2 h-4 w-4" />Test & preview unsaved settings</Button>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={save} disabled={createMutation.isPending || updateMutation.isPending}>{createMutation.isPending || updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}{editingId ? "Save changes" : "Create source"}</Button></div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={open => { setPreviewOpen(open); if (!open) setPreviewTarget(null); }}>
        <DialogContent className="max-h-[85dvh] max-w-4xl overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display text-2xl">{previewTarget ? `Preview · ${previewTarget.name}` : "Connection test & mapping preview"}</DialogTitle><DialogDescription>Read-only test: no work orders, cursor, or history records are written.</DialogDescription></DialogHeader>
          {previewMutation.isPending ? <div className="space-y-3 py-5"><Skeleton className="h-8 w-1/2" /><Skeleton className="h-28 w-full" /><p className="text-sm text-muted-foreground">Contacting the endpoint and validating mapped records…</p></div> :
           previewError ? <Alert variant="destructive"><CircleAlert className="h-4 w-4" /><AlertTitle>Preview failed</AlertTitle><AlertDescription>{previewError}</AlertDescription></Alert> :
           preview ? <div className="space-y-4"><Alert><Check className="h-4 w-4" /><AlertTitle>{preview.message}</AlertTitle><AlertDescription>{preview.sampleCount} sampled · {preview.records.filter(row => row.valid).length} valid · {preview.records.filter(row => !row.valid).length} with validation errors{preview.hasMore ? " · more records available" : ""}</AlertDescription></Alert>
             <div className="space-y-3">{preview.records.map((row, index) => <Card key={index} className={row.valid ? "" : "border-rose-300"}><CardHeader className="flex-row items-center justify-between space-y-0 py-3"><CardTitle className="text-sm">Record {index + 1}</CardTitle><Badge variant="outline" className={row.valid ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}>{row.valid ? "Valid" : "Needs attention"}</Badge></CardHeader><CardContent className="space-y-2 pb-4">{row.errors.length > 0 && <ul className="list-inside list-disc text-xs text-destructive">{row.errors.map((err, i) => <li key={i}>{err}</li>)}</ul>}<pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(row.mapped, null, 2)}</pre></CardContent></Card>)}</div>
           </div> : <div className="py-8 text-center text-sm text-muted-foreground">Choose a source to begin a read-only preview.</div>}
          <DialogFooter><Button variant="outline" onClick={() => { setPreviewOpen(false); setPreviewTarget(null); setPreview(null); setPreviewError(""); }}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove {deleteTarget?.name}?</AlertDialogTitle><AlertDialogDescription>This removes the connection configuration only. Existing work orders and run history will not be deleted.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep source</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending}>{deleteMutation.isPending ? "Removing…" : "Remove source"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}{hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}</div>;
}

function RunRow({ run, canRetry, retrying, onRetry }: { run: ApiImportRun; canRetry: boolean; retrying: boolean; onRetry: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const failures = run.messages.filter(message => /error|fail/i.test(`${message.action} ${message.message}`));
  return <div>
    <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 px-4 py-4 md:px-5">
      <div className="flex min-w-[190px] flex-1 items-center gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><Clock3 className="h-4 w-4" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{run.configName}</span><Badge variant="outline" className={statusTone(run.status)}>{run.status}</Badge></div><p className="mt-0.5 text-xs text-muted-foreground">{prettyDate(run.startedAt)} · {run.triggeredBy}</p></div></div>
      <div className="flex flex-wrap items-center gap-4 text-xs"><span><strong>{run.created}</strong> created</span><span><strong>{run.updated}</strong> updated</span><span><strong>{run.skipped}</strong> skipped</span><span className={run.failed ? "font-semibold text-destructive" : ""}><strong>{run.failed}</strong> failed</span><span>{run.pages} pages</span><span>{run.fetchAttempts} attempts</span></div>
      <div className="flex items-center gap-1">{run.messages.length > 0 && <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>{failures.length ? `${failures.length} issues` : `${run.messages.length} notes`}<ChevronDown className={`ml-1 h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} /></Button>}{canRetry && retryableRunStatuses.includes(run.status.toLowerCase()) && <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Retry</Button>}</div>
    </div>
    {expanded && <div className="border-t bg-muted/30 px-5 py-3">{run.messages.length ? <div className="space-y-2">{run.messages.map((message, index) => <div key={index} className="flex flex-wrap gap-x-3 text-xs"><span className="font-mono text-muted-foreground">{[message.page && `page ${message.page}`, message.row && `row ${message.row}`].filter(Boolean).join(" · ")}</span><strong>{message.action}</strong><span>{message.message}</span></div>)}</div> : <p className="text-xs text-muted-foreground">No details recorded.</p>}{run.nextAttemptAt && <p className="mt-2 text-xs text-muted-foreground">Next retry: {prettyDate(run.nextAttemptAt)}</p>}</div>}
  </div>;
}
