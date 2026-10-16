import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Info, Shield } from "lucide-react";
import type { AuditEvent, AuditList, AuditOptions } from "@shared/audit";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { AuditRetention } from "@/components/audit-retention";
import { AuditEventDetails, AuditWorkspace, AuditWorkspaceDialog, type AuditFilters } from "@/components/audit-workspace";
import type { ReadableAuditEvent } from "@/lib/audit-export";
import { downloadAuditExport } from "@/lib/audit-export";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

const emptyFilters: AuditFilters = { from: "", to: "", actorId: "", projectId: "", action: "", entityType: "", entityId: "", outcome: "", q: "" };

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
  return response.json();
}

function localTimeToIso(value: string, timezone: string): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return undefined;
  const fields = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0)];
  const target = Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5]);
  let candidate = target;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map(part => [part.type, Number(part.value)]));
      const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      const adjustment = target - represented;
      candidate += adjustment;
      if (adjustment === 0) break;
    }
    return new Date(candidate).toISOString();
  } catch { return undefined; }
}

function formatFilterScope(filters: AuditFilters) {
  const labels: [keyof AuditFilters, string][] = [
    ["from", "From"], ["to", "To"], ["actorId", "Actor"], ["projectId", "Project"],
    ["action", "Action"], ["entityType", "Entity type"], ["entityId", "Entity ID"], ["outcome", "Outcome"], ["q", "Search"],
  ];
  const selected = labels.filter(([key]) => filters[key]).map(([key, label]) => `${label}: ${filters[key]}`);
  return selected.length ? `All matching authorized events · ${selected.join(" · ")}` : "All matching authorized events · no filters";
}

export default function AuditLogs() {
  const shellRef = useRef<HTMLElement | null>(null);
  const { hasPermission, isLoading: permissionLoading } = usePermissions();
  const { toast } = useToast();
  const canView = hasPermission("audit.view");
  const canViewAll = hasPermission("audit.viewAllProjects");
  const [draft, setDraft] = useState<AuditFilters>(emptyFilters);
  const [applied, setApplied] = useState<AuditFilters>(emptyFilters);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(8);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const optionsQuery = useQuery<AuditOptions>({
    queryKey: ["/api/audit/options"],
    queryFn: () => getJson<AuditOptions>("/api/audit/options"),
    enabled: canView && !permissionLoading,
  });
  const timezone = optionsQuery.data?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    const from = localTimeToIso(applied.from, timezone);
    const to = localTimeToIso(applied.to, timezone);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    (["actorId", "projectId", "action", "entityType", "entityId", "outcome", "q"] as const).forEach(key => {
      if (applied[key]) params.set(key, applied[key]);
    });
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    return `/api/audit?${params.toString()}`;
  }, [applied, offset, limit, timezone]);
  const eventsQuery = useQuery<AuditList>({
    queryKey: ["/api/audit", applied, offset, limit, timezone],
    queryFn: () => getJson<AuditList>(listUrl),
    enabled: canView && !permissionLoading,
  });
  const detailQuery = useQuery<ReadableAuditEvent>({
    queryKey: ["/api/audit/detail", selectedId],
    queryFn: () => getJson<AuditEvent>(`/api/audit/${encodeURIComponent(selectedId || "")}`) as Promise<ReadableAuditEvent>,
    enabled: Boolean(selectedId),
  });

  const updateDraft = (key: keyof AuditFilters, value: string) => setDraft(current => ({ ...current, [key]: value }));
  const applyFilters = () => { setOffset(0); setApplied({ ...draft }); };
  const clearFilters = () => { setDraft(emptyFilters); setApplied(emptyFilters); setOffset(0); };
  const events = (eventsQuery.data?.events ?? []) as ReadableAuditEvent[];
  const total = eventsQuery.data?.total ?? 0;
  const options = optionsQuery.data;
  const canManageRetention = Boolean(options?.canManage && options.canViewAll && canViewAll);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const oldHeight = shell.style.height;
    const fit = () => {
      const viewport = window.visualViewport;
      const top = Math.max(0, shell.getBoundingClientRect().top - (viewport?.offsetTop ?? 0));
      shell.style.height = `${Math.max(0, (viewport?.height ?? window.innerHeight) - top)}px`;
    };
    const observer = new ResizeObserver(fit);
    if (shell.parentElement) observer.observe(shell.parentElement);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
      shell.style.height = oldHeight;
    };
  }, []);

  const onExport = async (format: "csv" | "xlsx" | "pdf") => {
    if (!total) return;
    const printWindow = format === "pdf" ? window.open("", "_blank") : undefined;
    if (format === "pdf" && !printWindow) {
      toast({ title: "PDF export failed", description: "The browser blocked the print window. Allow pop-ups and try again.", variant: "destructive" });
      return;
    }
    setExporting(true);
    try {
      const params = new URLSearchParams();
      const from = localTimeToIso(applied.from, timezone);
      const to = localTimeToIso(applied.to, timezone);
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      (["actorId", "projectId", "action", "entityType", "entityId", "outcome", "q"] as const).forEach(key => {
        if (applied[key]) params.set(key, applied[key]);
      });
      const response = await fetch(`/api/audit/export?${params.toString()}`, { credentials: "include" });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(response.status === 413
          ? "This filtered export exceeds the server export limit. Narrow the applied filters and try again; no partial file was created."
          : detail || `Export request failed (${response.status}).`);
      }
      const result = await response.json() as AuditList;
      if (!Array.isArray(result.events) || result.events.length !== result.total) {
        throw new Error("The server did not return the complete matching result set. No partial file was created.");
      }
      if (result.total === 0) throw new Error("There are no matching events to export.");
      await downloadAuditExport(format, result.events as ReadableAuditEvent[], { timezone, scope: formatFilterScope(applied) }, printWindow);
    } catch (error) {
      printWindow?.close();
      toast({ title: `${format === "xlsx" ? "Excel" : format.toUpperCase()} export failed`, description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally { setExporting(false); }
  };

  if (permissionLoading) return <div className="audit-page-shell mx-auto flex min-h-[100dvh] max-w-[1600px] flex-col gap-4 p-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-64 w-full" /></div>;
  if (!canView) return <div className="audit-page-shell mx-auto max-w-4xl p-4 md:p-8"><Alert><Shield className="h-4 w-4" /><AlertTitle>Audit access required</AlertTitle><AlertDescription>Your account does not have permission to view audit events.</AlertDescription></Alert></div>;

  return <main ref={shellRef} className="audit-page-shell mx-auto flex h-[100dvh] min-h-0 w-full max-w-[1600px] flex-col px-2 pb-1 pt-2 sm:px-4">
    <div className="mb-1 flex justify-end">
      <details className="audit-coverage-note max-w-2xl text-right">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[10px] text-muted-foreground"><Info className="h-3 w-3" />Coverage and scope</summary>
        <p className="mt-1 rounded-md border border-[hsl(var(--audit-line))] bg-[hsl(var(--audit-paper))] p-2 text-left text-xs text-muted-foreground">MeterFlo records supported application activity from deployment onward. Direct SQL changes and external scripts are not monitored.</p>
      </details>
    </div>
    {optionsQuery.isError && <Alert variant="destructive" className="mb-2"><AlertCircle className="h-4 w-4" /><AlertTitle>Audit filters are unavailable</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{optionsQuery.error instanceof Error ? optionsQuery.error.message : "Could not load audit options."}</span><Button size="sm" variant="outline" onClick={() => optionsQuery.refetch()}>Retry options</Button></AlertDescription></Alert>}
    <AuditWorkspace
      draft={draft} applied={applied} options={options} events={events} total={total} timezone={timezone}
      loading={eventsQuery.isLoading || eventsQuery.isFetching} error={eventsQuery.isError ? eventsQuery.error : undefined}
      exporting={exporting} offset={offset} onDraftChange={updateDraft} onApply={applyFilters} onClear={clearFilters}
      onPage={(direction, pageSize) => setOffset(current => Math.max(0, current + direction * pageSize))}
      onPageSizeChange={next => { setLimit(next); setOffset(0); }}
      onRefresh={() => { void optionsQuery.refetch(); void eventsQuery.refetch(); }}
      onRetry={() => { void eventsQuery.refetch(); }} onExport={format => void onExport(format)}
      onSelect={id => setSelectedId(id)} onRetention={canManageRetention ? () => setRetentionOpen(true) : undefined}
    />
    <Dialog open={Boolean(selectedId)} onOpenChange={open => { if (!open) setSelectedId(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Audit event</DialogTitle><DialogDescription>Readable event evidence. Internal identifiers and original payloads are available only in the collapsed evidence section.</DialogDescription></DialogHeader>
        {detailQuery.isLoading ? <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-28 w-full" /><Skeleton className="h-24 w-full" /></div>
          : detailQuery.isError ? <Alert variant="destructive"><AlertTitle>Could not load event details</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{detailQuery.error instanceof Error ? detailQuery.error.message : "The event request failed."}</span><Button size="sm" variant="outline" onClick={() => detailQuery.refetch()}>Retry</Button></AlertDescription></Alert>
          : detailQuery.data ? <AuditEventDetails event={detailQuery.data} timezone={timezone} /> : null}
      </DialogContent>
    </Dialog>
    <AuditWorkspaceDialog open={retentionOpen} onOpenChange={setRetentionOpen} title="Audit retention" description="Administrative retention and cleanup controls; global scope across projects.">
      <AuditRetention timezone={timezone} />
    </AuditWorkspaceDialog>
  </main>;
}
