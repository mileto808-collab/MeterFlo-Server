import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, FileSpreadsheet, FileText, Filter, RefreshCw, Search, Settings2, Shield, X } from "lucide-react";
import type { AuditOptions, AuditChange } from "@shared/audit";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ReadableAuditEvent } from "@/lib/audit-export";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export type AuditFilters = {
  from: string; to: string; actorId: string; projectId: string; action: string;
  entityType: string; entityId: string; outcome: string; q: string;
};

type Props = {
  draft: AuditFilters;
  applied: AuditFilters;
  options?: AuditOptions;
  events: ReadableAuditEvent[];
  total: number;
  timezone: string;
  loading: boolean;
  error?: unknown;
  exporting: boolean;
  offset: number;
  onDraftChange: (key: keyof AuditFilters, value: string) => void;
  onApply: () => void;
  onClear: () => void;
  onPage: (direction: -1 | 1, pageSize: number) => void;
  onPageSizeChange: (size: number) => void;
  onRefresh: () => void;
  onRetry: () => void;
  onExport: (format: "csv" | "xlsx" | "pdf") => void;
  onSelect: (id: string) => void;
  onRetention?: () => void;
  active?: boolean;
};

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const readable = (event: ReadableAuditEvent) => event.displayChanges ?? event.changes ?? [];
const dateText = (value: string, timezone: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(date); }
  catch { return date.toLocaleString(); }
};

function Field({ id, label, value, options, placeholder, onChange }: {
  id: string; label: string; value: string; options: { value: string; label: string }[];
  placeholder: string; onChange: (value: string) => void;
}) {
  return <div className="min-w-0 space-y-1.5"><Label htmlFor={id}>{label}</Label>
    <select id={id} className={selectClass} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">{placeholder}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </div>;
}

function FilterDialog({ open, onOpenChange, draft, options, timezone, onDraftChange, onApply, onClear, suppressCloseFocus }: {
  open: boolean; onOpenChange: (open: boolean) => void; draft: AuditFilters; options?: AuditOptions;
  timezone: string; onDraftChange: Props["onDraftChange"]; onApply: () => void; onClear: () => void;
  suppressCloseFocus: boolean;
}) {
  const apply = () => { onApply(); onOpenChange(false); };
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent onCloseAutoFocus={event => { if (suppressCloseFocus) event.preventDefault(); }} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Filter audit events</DialogTitle><DialogDescription>Filters apply across authorized matching events and exports. Local date and time values use {timezone}.</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="audit-from">From</Label><Input id="audit-from" type="datetime-local" value={draft.from} onChange={event => onDraftChange("from", event.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="audit-to">To</Label><Input id="audit-to" type="datetime-local" value={draft.to} onChange={event => onDraftChange("to", event.target.value)} /></div>
        <Field id="audit-actor" label="Actor" value={draft.actorId} onChange={value => onDraftChange("actorId", value)} placeholder="Any actor" options={(options?.actors ?? []).map(item => ({ value: item.id, label: item.label }))} />
        <Field id="audit-project" label="Project" value={draft.projectId} onChange={value => onDraftChange("projectId", value)} placeholder={options?.canViewAll ? "All projects" : "Assigned projects"} options={(options?.projects ?? []).map(item => ({ value: String(item.id), label: item.name }))} />
        <Field id="audit-action" label="Action" value={draft.action} onChange={value => onDraftChange("action", value)} placeholder="Any action" options={(options?.actions ?? []).map(value => ({ value, label: value }))} />
        <Field id="audit-entity-type" label="Entity type" value={draft.entityType} onChange={value => onDraftChange("entityType", value)} placeholder="Any entity type" options={(options?.entityTypes ?? []).map(value => ({ value, label: value }))} />
        <div className="space-y-1.5"><Label htmlFor="audit-entity-id">Entity ID</Label><Input id="audit-entity-id" value={draft.entityId} onChange={event => onDraftChange("entityId", event.target.value)} placeholder="Exact identifier" /></div>
        <div className="space-y-1.5"><Label htmlFor="audit-outcome">Outcome</Label><Input id="audit-outcome" value={draft.outcome} onChange={event => onDraftChange("outcome", event.target.value)} placeholder="Exact outcome" /></div>
      </div>
      <DialogFooter className="flex-row justify-between sm:justify-between"><Button variant="ghost" onClick={onClear}><X className="mr-1.5 h-4 w-4" />Clear filters</Button><Button onClick={apply}>Apply filters</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function EventRow({ event, timezone, onSelect }: { event: ReadableAuditEvent; timezone: string; onSelect: () => void }) {
  const entityName = event.entityReference || event.entityLabel || "Recorded entity";
  const projectName = event.projectReference || event.projectLabel || (event.projectId ? "Project" : "Global");
  const changes = readable(event);
  return <button type="button" data-audit-row={event.id} data-testid="audit-record" onClick={onSelect}
    className="audit-event-row group grid w-full gap-x-3 gap-y-1.5 px-3 py-2.5 text-left transition-colors hover:bg-[hsl(var(--audit-wash))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:items-center sm:gap-3 sm:px-4">
    <span className="min-w-0"><span className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-semibold">{event.action}</span><span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{event.source}</span></span><span className="mt-1 block truncate text-xs text-muted-foreground">{dateText(event.occurredAt, timezone)}</span></span>
    <span className="row-outcome flex items-center justify-end sm:justify-start"><Badge variant={event.outcome.toLowerCase() === "success" ? "secondary" : "destructive"}>{event.outcome}</Badge></span>
    <span className="min-w-0"><span className="block truncate text-sm">{event.actorLabel || "Unknown actor"}</span><span className="hidden truncate text-xs text-muted-foreground sm:block">{event.actorKind}</span></span>
    <span className="min-w-0"><span className="block truncate text-sm">{entityName}</span><span className="hidden truncate text-xs text-muted-foreground sm:block">{event.entityType}{changes.length ? ` · ${changes.length} ${changes.length === 1 ? "change" : "changes"}` : ""}</span></span>
    <span className="truncate text-xs text-muted-foreground sm:text-sm">{projectName}</span>
  </button>;
}

export function AuditWorkspace(props: Props) {
  const { draft, applied, options, events, total, timezone, loading, error, exporting, offset } = props;
  const [filterOpen, setFilterOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(() => typeof window !== "undefined" && !window.matchMedia("(max-width: 767px), (orientation: landscape) and (pointer: coarse) and (max-height: 600px) and (max-width: 960px)").matches);
  const [pageSize, setPageSize] = useState(8);
  const capacity = useRef(8);
  const [resultsElement, setResultsElement] = useState<HTMLDivElement | null>(null);
  const rowHeight = useRef(0);
  const mobile = useIsMobile();
  const pageSizeChangeRef = useRef(props.onPageSizeChange);
  pageSizeChangeRef.current = props.onPageSizeChange;
  const activeCount = Object.values(applied).filter(Boolean).length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.floor(offset / pageSize);
  const first = total ? offset + 1 : 0;
  const last = Math.min(total, offset + events.length);
  useEffect(() => { setToolsOpen(!mobile); }, [mobile]);
  useEffect(() => { if (props.active === false) setFilterOpen(false); }, [props.active]);

  useEffect(() => {
    if (!resultsElement) return;
    const measure = () => {
      const rows = [...resultsElement.querySelectorAll<HTMLElement>("[data-audit-row]")];
      if (rows.length) rowHeight.current = Math.max(56, rows.reduce((max, row) => Math.max(max, row.getBoundingClientRect().height), 0));
      const available = resultsElement.clientHeight;
      const columnHeading = resultsElement.querySelector<HTMLElement>("[data-audit-columns]")?.getBoundingClientRect().height ?? 0;
      if (available > 0) {
        const next = Math.max(1, Math.min(100, Math.floor((available - columnHeading - 6) / (rowHeight.current || (mobile ? 91 : 66)))));
        if (capacity.current !== next) {
          capacity.current = next;
          setPageSize(next);
          pageSizeChangeRef.current(next);
        }
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(resultsElement);
    resultsElement.querySelectorAll("[data-audit-row]").forEach(row => observer.observe(row));
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); window.visualViewport?.removeEventListener("resize", measure); };
  }, [resultsElement, mobile, events, toolsOpen]);

  useEffect(() => { rowHeight.current = 0; }, [mobile]);
  const applySearch = () => props.onApply();
  return <section className="audit-workspace flex min-h-0 flex-1 flex-col" data-testid="audit-workspace" aria-label="Audit logs">
    <FilterDialog open={filterOpen} onOpenChange={setFilterOpen} draft={draft} options={options} timezone={timezone} onDraftChange={props.onDraftChange} onApply={props.onApply} onClear={props.onClear} suppressCloseFocus={props.active === false} />
    <header className="audit-subheader sticky top-0 z-20 shrink-0 border-b border-[hsl(var(--audit-line))] bg-[hsl(var(--audit-paper))] px-3 pb-2 pt-2 sm:px-5" data-testid="audit-subheader">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[hsl(var(--audit-ink))] text-[hsl(var(--audit-paper))]"><Shield className="h-4 w-4" /></span>
          <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate font-display text-lg font-semibold tracking-tight sm:text-xl" data-testid="text-audit-title">Audit logs</h1><span className="hidden rounded-full border border-[hsl(var(--audit-line))] px-2 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">{timezone}</span></div><p className="hidden text-xs text-muted-foreground sm:block">MeterFlo activity ledger</p></div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {props.onRetention && <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3" onClick={props.onRetention} aria-label="Audit retention settings"><Archive className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Retention</span></Button>}
          <Button variant="outline" size="sm" className="h-8 px-2 sm:px-3" onClick={props.onRefresh} disabled={loading} aria-label="Refresh audit events"><RefreshCw className={`h-4 w-4 sm:mr-1.5 ${loading ? "animate-spin" : ""}`} /><span className="hidden sm:inline">Refresh</span></Button>
        </div>
      </div>
      {mobile && <div className="mt-2">
        <Button type="button" variant="outline" size="sm" className="h-8 w-full justify-between" aria-expanded={toolsOpen} aria-controls="audit-mobile-tools" data-testid="audit-mobile-tools-toggle" onClick={() => setToolsOpen(open => !open)}>
          <span className="flex items-center gap-2"><Settings2 className="h-4 w-4" />{toolsOpen ? "Hide Search & Tools" : "Show Search & Tools"}</span>{toolsOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>}
      <div id="audit-mobile-tools" data-open={toolsOpen} className={`audit-tools-content ${!mobile || toolsOpen ? "block" : "hidden"}`}>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <div className="relative min-w-[min(100%,200px)] flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search audit events" className="h-9 pl-8 pr-2" value={draft.q} onChange={event => props.onDraftChange("q", event.target.value)} onKeyDown={event => { if (event.key === "Enter") applySearch(); }} placeholder="Search events…" />
          </div>
          <Button variant="outline" size="sm" className="h-9" onClick={() => setFilterOpen(true)} aria-label="Filter audit events"><Filter className="mr-1.5 h-4 w-4" />Filters{activeCount > 0 && <Badge variant="secondary" className="ml-1">{activeCount}</Badge>}</Button>
          <Button size="sm" className="h-9 px-2 sm:px-3" onClick={applySearch} aria-label="Apply audit search"><Search className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Search</span></Button>
          <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground">{total.toLocaleString()} events</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <Button variant="outline" size="sm" className="h-8 flex-1" aria-label="Export CSV" disabled={exporting || !total || loading} onClick={() => props.onExport("csv")}><Download className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">CSV</span></Button>
          <Button variant="outline" size="sm" className="h-8 flex-1" aria-label="Export Excel" disabled={exporting || !total || loading} onClick={() => props.onExport("xlsx")}><FileSpreadsheet className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Excel</span></Button>
          <Button variant="outline" size="sm" className="h-8 flex-1" aria-label="Export PDF / Print" disabled={exporting || !total || loading} onClick={() => props.onExport("pdf")}><FileText className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">PDF / Print</span></Button>
          {activeCount > 0 && <Button variant="ghost" size="sm" className="h-8 px-2" onClick={props.onClear} aria-label="Clear filters"><X className="h-4 w-4" /></Button>}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">Dates interpreted in {timezone}; server-side filters apply to all matching results.</p>
      </div>
    </header>

    <div className="audit-results-heading flex shrink-0 items-center justify-between gap-2 px-3 py-2 sm:px-5">
      <div className="min-w-0"><h2 className="font-display text-sm font-semibold">Event history</h2><p className="text-[11px] text-muted-foreground">{total.toLocaleString()} matching {total === 1 ? "event" : "events"} · page capacity {pageSize}</p></div>
      <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{first}–{last} / {total.toLocaleString()}</span>
    </div>
    <div ref={setResultsElement} className="audit-results min-h-0 flex-1 overflow-y-auto overscroll-contain border-y border-[hsl(var(--audit-line))]" data-testid="audit-results" data-page-size={pageSize} role="region" aria-label="Audit results" tabIndex={0}>
      {loading ? <div className="space-y-2 p-3">{Array.from({ length: Math.min(pageSize, 7) }, (_, index) => <Skeleton key={index} className="h-[62px] w-full" />)}</div>
        : error ? <div className="grid min-h-48 place-items-center p-4"><Alert variant="destructive" className="max-w-2xl"><AlertTitle>Could not load audit events</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{error instanceof Error ? error.message : "The audit request failed."}</span><Button size="sm" variant="outline" onClick={props.onRetry}>Retry</Button></AlertDescription></Alert></div>
        : !events.length ? <div className="grid min-h-48 place-items-center px-4 py-8 text-center"><div className="max-w-md"><div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-[hsl(var(--audit-wash))] text-[hsl(var(--audit-ink))]"><Search className="h-5 w-5" /></div><h3 className="mt-3 font-semibold">No matching audit events</h3><p className="mt-1 text-sm text-muted-foreground">{activeCount ? "Change the applied search or filters to broaden the results." : "No audit activity is available in this authorized scope."}</p>{activeCount > 0 && <Button className="mt-3" size="sm" variant="outline" onClick={props.onClear}>Clear applied filters</Button>}</div></div>
        : <div className="divide-y divide-[hsl(var(--audit-line))]">
          <div data-audit-columns className="hidden grid-cols-[minmax(170px,1.05fr)_minmax(110px,.8fr)_minmax(120px,.9fr)_minmax(100px,.7fr)_auto] gap-3 bg-[hsl(var(--audit-wash))] px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground sm:grid"><span>Event</span><span>Actor</span><span>Entity</span><span>Project</span><span>Outcome</span></div>
          {events.map(event => <EventRow key={event.id} event={event} timezone={timezone} onSelect={() => props.onSelect(event.id)} />)}
        </div>}
    </div>
    <nav className="audit-pagination flex shrink-0 flex-wrap items-center gap-2 px-3 py-2 sm:px-5" data-testid="audit-pagination" aria-label="Audit event pages">
      <p className="mr-auto text-[11px] text-muted-foreground" aria-live="polite">{first}–{last} of {total.toLocaleString()}</p>
      <Button variant="outline" size="sm" className="h-8" disabled={page <= 0 || loading} onClick={() => props.onPage(-1, pageSize)}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button>
      <span className="min-w-16 text-center text-xs tabular-nums">Page {Math.min(page + 1, pageCount)} / {pageCount}</span>
      <Button variant="outline" size="sm" className="h-8" disabled={offset + events.length >= total || loading} onClick={() => props.onPage(1, pageSize)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button>
    </nav>
  </section>;
}

export function AuditEventDetails({ event, timezone }: { event: ReadableAuditEvent; timezone: string }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const changes = (event.displayChanges ?? event.changes ?? []) as AuditChange[];
  const fields: [string, string][] = [
    ["Occurred", dateText(event.occurredAt, timezone)],
    ["Actor", `${event.actorLabel || "Unknown actor"} · ${event.actorKind}`],
    ["Action", event.action],
    ["Source", event.source],
    ["Entity", `${event.entityType} · ${event.entityReference || event.entityLabel || "Recorded entity"}`],
    ["Project", event.projectReference || event.projectLabel || (event.projectId ? "Project" : "Global")],
    ["Outcome", event.outcome],
    ["Event reference", event.eventReference || "Recorded event"],
  ];
  const pretty = (value: unknown) => value === undefined ? "Not recorded" : typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return <div className="space-y-4">
    <div className="grid gap-2 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="min-w-0 rounded-md border border-[hsl(var(--audit-line))] bg-[hsl(var(--audit-paper))] p-3"><p className="text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">{label}</p><p className="mt-1 break-words text-sm">{value || "—"}</p></div>)}</div>
    <section><h3 className="mb-2 text-sm font-semibold">Recorded changes</h3>{changes.length === 0 ? <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No field changes were recorded for this event.</p> : <div className="space-y-2">{changes.map((change, index) => <div key={`${change.field}-${index}`} className="rounded-md border border-[hsl(var(--audit-line))] p-3"><p className="mb-2 font-medium text-sm">{change.field}</p><div className="grid gap-2 sm:grid-cols-2"><div><p className="mb-1 text-[11px] text-muted-foreground">Before</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-xs">{pretty(change.before)}</pre></div><div><p className="mb-1 text-[11px] text-muted-foreground">After</p><pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/50 p-2 text-xs">{pretty(change.after)}</pre></div></div></div>)}</div>}</section>
    <details className="rounded-md border border-dashed border-[hsl(var(--audit-line))] p-3" open={internalOpen} onToggle={event => setInternalOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer text-sm font-medium">Internal identifiers and raw evidence</summary>
      <div className="mt-3 space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">{[["Event ID", event.id], ["Entity ID", event.entityId], ["Project ID", event.projectId], ["Actor ID", event.actorId], ["Operation ID", event.operationId]].map(([label, value]) => <div key={label} className="min-w-0"><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p><p className="break-all font-mono text-xs">{value ?? "—"}</p></div>)}</div>
        <div><h4 className="text-xs font-semibold">Original changes</h4><pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs">{pretty(event.changes)}</pre></div>
        <div><h4 className="text-xs font-semibold">Raw metadata</h4><pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs">{pretty(event.metadata)}</pre></div>
        {event.displayMetadata && <div><h4 className="text-xs font-semibold">Readable metadata</h4><pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs">{pretty(event.displayMetadata)}</pre></div>}
      </div>
    </details>
  </div>;
}

export function AuditWorkspaceDialog({ children, open, onOpenChange, title, description, suppressCloseFocus = false }: {
  children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; suppressCloseFocus?: boolean;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent onCloseAutoFocus={event => { if (suppressCloseFocus) event.preventDefault(); }} className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>{children}</DialogContent></Dialog>;
}
