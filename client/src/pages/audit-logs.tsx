import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, ChevronRight, Clock3, FileSearch, Filter, RefreshCw, Search, Shield, X } from "lucide-react";
import type { AuditEvent, AuditList, AuditOptions } from "@shared/audit";
import { usePermissions } from "@/hooks/usePermissions";
import { apiRequest } from "@/lib/queryClient";
import { AuditRetention } from "@/components/audit-retention";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type FilterState = {
  from: string;
  to: string;
  actorId: string;
  projectId: string;
  action: string;
  entityType: string;
  entityId: string;
  outcome: string;
  q: string;
};

const emptyFilters: FilterState = {
  from: "", to: "", actorId: "", projectId: "", action: "", entityType: "", entityId: "", outcome: "", q: "",
};
const pageSize = 25;
const inputClass = "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
  return response.json();
}

function toIso(value: string, timezone: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return undefined;
  const desired = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0)];
  const targetUtc = Date.UTC(desired[0], desired[1] - 1, desired[2], desired[3], desired[4], desired[5]);
  let candidate = targetUtc;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, Number(part.value)]));
      const representedUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      const adjustment = targetUtc - representedUtc;
      candidate += adjustment;
      if (adjustment === 0) break;
    }
    return new Date(candidate).toISOString();
  } catch {
    return undefined;
  }
}

function formatDate(value: string | null | undefined, timezone?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium", timeStyle: "short", ...(timezone ? { timeZone: timezone } : {}),
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function pretty(value: unknown): string {
  if (value === undefined) return "Not recorded";
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function FilterSelect({ id, label, value, onChange, options, placeholder }: {
  id: string; label: string; value: string; onChange: (value: string) => void;
  options: { value: string; label: string }[]; placeholder: string;
}) {
  return <div className="min-w-0 space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    <select id={id} value={value} onChange={(event) => onChange(event.target.value)} className={inputClass}>
      <option value="">{placeholder}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </div>;
}

export default function AuditLogs() {
  const { hasPermission, isLoading: permissionLoading } = usePermissions();
  const canView = hasPermission("audit.view");
  const canViewAll = hasPermission("audit.viewAllProjects");
  const [draft, setDraft] = useState<FilterState>(emptyFilters);
  const [applied, setApplied] = useState<FilterState>(emptyFilters);
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const optionsQuery = useQuery<AuditOptions>({
    queryKey: ["/api/audit/options"],
    queryFn: () => getJson<AuditOptions>("/api/audit/options"),
    enabled: canView && !permissionLoading,
  });
  const timezone = optionsQuery.data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    const from = toIso(applied.from, timezone);
    const to = toIso(applied.to, timezone);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    (["actorId", "projectId", "action", "entityType", "entityId", "outcome", "q"] as const).forEach((key) => {
      if (applied[key]) params.set(key, applied[key]);
    });
    params.set("limit", String(pageSize));
    params.set("offset", String(offset));
    return `/api/audit?${params.toString()}`;
  }, [applied, offset, timezone]);
  const eventsQuery = useQuery<AuditList>({
    queryKey: ["/api/audit", applied, offset, timezone],
    queryFn: () => getJson<AuditList>(listUrl),
    enabled: canView && !permissionLoading && !optionsQuery.isError,
  });
  const detailQuery = useQuery<AuditEvent>({
    queryKey: ["/api/audit", selectedId],
    queryFn: () => getJson<AuditEvent>(`/api/audit/${encodeURIComponent(selectedId || "")}`),
    enabled: Boolean(selectedId),
  });

  const updateDraft = (key: keyof FilterState, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const applyFilters = () => {
    setOffset(0);
    setApplied({ ...draft });
  };
  const clearFilters = () => {
    setDraft(emptyFilters);
    setApplied(emptyFilters);
    setOffset(0);
  };

  if (permissionLoading) {
    return <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-7"><Skeleton className="h-10 w-72" /><Skeleton className="h-36 w-full" /><Skeleton className="h-80 w-full" /></div>;
  }
  if (!canView) {
    return <div className="mx-auto max-w-4xl p-4 md:p-8"><Alert><Shield className="h-4 w-4" /><AlertTitle>Audit access required</AlertTitle><AlertDescription>Your account does not have permission to view audit events.</AlertDescription></Alert></div>;
  }

  const events = eventsQuery.data?.events ?? [];
  const total = eventsQuery.data?.total ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + pageSize, total);
  const activeFilterCount = Object.values(applied).filter(Boolean).length;
  const options = optionsQuery.data;
  const formatTime = (value: string) => formatDate(value, timezone);

  return (
    <div className="min-h-[100dvh] bg-muted/20">
      <div className="mx-auto max-w-7xl space-y-6 p-4 md:p-7">
        <div className="flex flex-col justify-between gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              <Shield className="h-4 w-4" /> Governance / Activity ledger
            </div>
            <h1 className="text-3xl font-semibold tracking-tight" data-testid="text-audit-title">Audit logs</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">A traceable record of changes made inside MeterFlo.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5"><Clock3 className="h-3.5 w-3.5" />{timezone}</span>
            <Button variant="outline" size="sm" onClick={() => { void optionsQuery.refetch(); void eventsQuery.refetch(); }} disabled={eventsQuery.isFetching || optionsQuery.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${eventsQuery.isFetching || optionsQuery.isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>

        <Alert className="border-primary/20 bg-primary/[0.035]">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Coverage begins at deployment</AlertTitle>
          <AlertDescription>MeterFlo records supported application activity from the time audit logging is deployed. It does not monitor direct SQL changes or external scripts.</AlertDescription>
        </Alert>

        {optionsQuery.isError && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Audit filters are unavailable</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{optionsQuery.error instanceof Error ? optionsQuery.error.message : "Could not load audit options."}</span><Button size="sm" variant="outline" onClick={() => optionsQuery.refetch()}>Try again</Button></AlertDescription></Alert>}

        <Card className="overflow-hidden border-border/80 shadow-sm">
          <CardHeader className="border-b bg-background/70 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><CardTitle className="flex items-center gap-2 text-lg"><Filter className="h-4 w-4 text-primary" />Filter the ledger</CardTitle><CardDescription className="mt-1">Narrow events by time, actor, project, action, or entity.</CardDescription></div>
              <div className="flex gap-2">
                {activeFilterCount > 0 && <Button variant="ghost" size="sm" onClick={clearFilters}><X className="mr-1.5 h-4 w-4" />Clear {activeFilterCount}</Button>}
                <Button size="sm" onClick={applyFilters}><Search className="mr-2 h-4 w-4" />Apply filters</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-x-4 gap-y-4 bg-background p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5"><Label htmlFor="audit-from">From</Label><Input id="audit-from" type="datetime-local" value={draft.from} onChange={(e) => updateDraft("from", e.target.value)} /></div>
            <div className="space-y-1.5"><Label htmlFor="audit-to">To</Label><Input id="audit-to" type="datetime-local" value={draft.to} onChange={(e) => updateDraft("to", e.target.value)} /></div>
            <FilterSelect id="audit-actor" label="Actor" value={draft.actorId} onChange={(value) => updateDraft("actorId", value)} placeholder="Any actor" options={(options?.actors ?? []).map((actor) => ({ value: actor.id, label: actor.label }))} />
            <FilterSelect id="audit-project" label="Project" value={draft.projectId} onChange={(value) => updateDraft("projectId", value)} placeholder={canViewAll ? "All projects" : "Assigned projects"} options={(options?.projects ?? []).map((project) => ({ value: String(project.id), label: project.name }))} />
            <FilterSelect id="audit-action" label="Action" value={draft.action} onChange={(value) => updateDraft("action", value)} placeholder="Any action" options={(options?.actions ?? []).map((action) => ({ value: action, label: action }))} />
            <FilterSelect id="audit-entity-type" label="Entity type" value={draft.entityType} onChange={(value) => updateDraft("entityType", value)} placeholder="Any entity" options={(options?.entityTypes ?? []).map((entityType) => ({ value: entityType, label: entityType }))} />
            <div className="space-y-1.5"><Label htmlFor="audit-entity-id">Entity ID</Label><Input id="audit-entity-id" value={draft.entityId} onChange={(e) => updateDraft("entityId", e.target.value)} placeholder="Exact identifier" /></div>
            <div className="space-y-1.5"><Label htmlFor="audit-outcome">Outcome</Label><Input id="audit-outcome" value={draft.outcome} onChange={(e) => updateDraft("outcome", e.target.value)} placeholder="Exact outcome" /></div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-4"><Label htmlFor="audit-search">Search events</Label><Input id="audit-search" value={draft.q} onChange={(e) => updateDraft("q", e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyFilters(); }} placeholder="Search target label, record ID, or batch ID…" /></div>
            <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">Dates are interpreted in {timezone}; requests include explicit ISO timestamps.</p>
            <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">Project and action choices include authorized projects and supported actions with no recorded events. A choice does not imply past activity.</p>
          </CardContent>
        </Card>

        <Card className="overflow-hidden border-border/80 shadow-sm">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b bg-background/70 py-4">
            <div><CardTitle className="text-lg">Event history</CardTitle><CardDescription>{total.toLocaleString()} matching {total === 1 ? "event" : "events"}</CardDescription></div>
            <div className="flex items-center gap-2"><Badge variant="outline">Page size {pageSize}</Badge><span className="text-xs tabular-nums text-muted-foreground">{pageStart}–{pageEnd} of {total.toLocaleString()}</span></div>
          </CardHeader>
          <CardContent className="p-0">
            {eventsQuery.isLoading ? <div className="space-y-3 p-4">{[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-[68px] w-full" />)}</div>
              : eventsQuery.isError ? <div className="p-4"><Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Could not load audit events</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{eventsQuery.error instanceof Error ? eventsQuery.error.message : "The audit request failed."}</span><Button size="sm" variant="outline" onClick={() => eventsQuery.refetch()}>Retry</Button></AlertDescription></Alert></div>
              : events.length === 0 ? <div className="m-4 rounded-lg border border-dashed bg-muted/20 px-5 py-12 text-center"><FileSearch className="mx-auto h-9 w-9 text-muted-foreground/70" /><h3 className="mt-3 font-medium">No events match these filters</h3><p className="mt-1 text-sm text-muted-foreground">Adjust the search or clear filters to see more activity.</p><Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>Clear filters</Button></div>
              : <div className="divide-y">
                <div className="hidden grid-cols-[minmax(180px,1.2fr)_minmax(140px,1fr)_minmax(130px,1fr)_minmax(125px,.8fr)_minmax(100px,.6fr)] gap-3 bg-muted/35 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
                  <span>Event</span><span>Actor</span><span>Entity</span><span>Project</span><span>Outcome</span>
                </div>
                {events.map((event) => (
                  <button key={event.id} type="button" onClick={() => setSelectedId(event.id)} className="grid w-full gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary md:grid-cols-[minmax(180px,1.2fr)_minmax(140px,1fr)_minmax(130px,1fr)_minmax(125px,.8fr)_minmax(100px,.6fr)] md:items-center md:gap-3">
                    <span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="font-medium">{event.action}</span><span className="font-mono text-[10px] text-muted-foreground">{event.source}</span></span><span className="mt-1 block text-xs text-muted-foreground">{formatTime(event.occurredAt)}</span></span>
                    <span className="min-w-0"><span className="block truncate text-sm">{event.actorLabel || "Unknown actor"}</span><span className="block text-xs text-muted-foreground">{event.actorKind}</span></span>
                    <span className="min-w-0"><span className="block truncate text-sm">{event.entityLabel || event.entityId}</span><span className="block truncate text-xs text-muted-foreground">{event.entityType} · {event.entityId}</span></span>
                    <span className="truncate text-sm text-muted-foreground">{event.projectLabel || (event.projectId ? `Project ${event.projectId}` : "Global")}</span>
                    <span><Badge variant={event.outcome.toLowerCase() === "success" ? "secondary" : "destructive"}>{event.outcome}</Badge></span>
                  </button>
                ))}
              </div>}
          </CardContent>
          <div className="flex items-center justify-between border-t bg-background/70 px-4 py-3">
            <p className="text-xs text-muted-foreground">Showing {pageStart}–{pageEnd} records</p>
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setOffset((value) => Math.max(0, value - pageSize))} disabled={offset === 0 || eventsQuery.isFetching}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" onClick={() => setOffset((value) => value + pageSize)} disabled={offset + pageSize >= total || eventsQuery.isFetching}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div>
          </div>
        </Card>

        {options?.canManage && options.canViewAll && canViewAll && <AuditRetention timezone={timezone} />}

        <Dialog open={Boolean(selectedId)} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader><DialogTitle>Audit event</DialogTitle><DialogDescription>Complete record of this activity and its recorded changes.</DialogDescription></DialogHeader>
            {detailQuery.isLoading ? <div className="space-y-3 py-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div>
              : detailQuery.isError ? <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertTitle>Could not load event details</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{detailQuery.error instanceof Error ? detailQuery.error.message : "The event request failed."}</span><Button size="sm" variant="outline" onClick={() => detailQuery.refetch()}>Retry</Button></AlertDescription></Alert>
              : detailQuery.data ? <EventDetails event={detailQuery.data} timezone={timezone} /> : null}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

function EventDetails({ event, timezone }: { event: AuditEvent; timezone: string }) {
  const fields: [string, string][] = [
    ["Occurred", formatDate(event.occurredAt, timezone)], ["Actor", `${event.actorLabel} (${event.actorKind})`],
    ["Action", event.action], ["Source", event.source], ["Entity", `${event.entityType} · ${event.entityLabel} · ${event.entityId}`],
    ["Project", event.projectLabel ? `${event.projectLabel} · ${event.projectId}` : "Global"],
    ["Outcome", event.outcome], ["Operation ID", event.operationId],
  ];
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0 rounded-md border bg-muted/15 p-3"><p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm">{value || "—"}</p></div>)}</div>
    <section><h3 className="mb-2 text-sm font-semibold">Recorded changes</h3>{event.changes.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No field changes were recorded for this event.</p> : <div className="space-y-2">{event.changes.map((change, index) => <div key={`${change.field}-${index}`} className="rounded-md border p-3"><p className="mb-2 font-medium">{change.field}</p><div className="grid gap-2 sm:grid-cols-2"><div className="min-w-0"><p className="mb-1 text-xs text-muted-foreground">Before</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-xs">{pretty(change.before)}</pre></div><div className="min-w-0"><p className="mb-1 text-xs text-muted-foreground">After</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-xs">{pretty(change.after)}</pre></div></div></div>)}</div>}</section>
    <section><h3 className="mb-2 text-sm font-semibold">Metadata</h3><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-xs">{pretty(event.metadata)}</pre></section>
  </div>;
}
