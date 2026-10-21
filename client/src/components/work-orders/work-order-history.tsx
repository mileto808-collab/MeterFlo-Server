import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Search, Download, Printer, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePermissions } from "@/hooks/usePermissions";
import { formatDateTimeInTimezone } from "@/lib/timezone";
import {
  historyActionLabel,
  historyDisplayText,
  historyFieldLabel,
} from "@shared/work-order-history-display";

type HistoryChange = { field: string; before: unknown; after: unknown };
type HistoryEvent = {
  id: string; occurredAt: string; actorLabel: string; source: string; action: string;
  entityId?: string | number | null; entityLabel?: string | null; outcome?: string | null;
  changes?: HistoryChange[]; metadata?: Record<string, unknown> | null;
  entityReference?: string; eventReference?: string; operationReference?: string;
  displayChanges?: HistoryChange[]; displayMetadata?: Record<string, unknown> | null;
};
type HistoryGroup = { operationId: string; operationReference?: string; workOrderReference?: string | null; occurredAt: string; actorLabel: string; source: string; outcome?: string | null; events: HistoryEvent[] };
type HistoryResponse = { groups: HistoryGroup[]; total: number; timezone: string; projectName: string };

const humanize = (value: string) => value.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const redactUuids = (value: string) => value.replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/ig, "linked record");
const workOrderReferenceFromMetadata = (metadata?: Record<string, unknown> | null) => {
  if (!metadata) return undefined;
  const value = metadata.customerWoId ?? metadata.customerWorkOrderId ?? metadata.customerWorkOrderNumber ??
    metadata.customerWoNumber ?? metadata.workOrderNumber ?? metadata.workOrderLabel;
  return value == null || value === "" || isUuid(value) ? undefined : value;
};
const technicalValue = (value: unknown) => value == null || value === "" ? "—" : String(value);
const readableName = (value: unknown) => !value || isUuid(value) ? "Unknown user" : redactUuids(String(value));
const readableHistoryValue = (value: unknown, key: string, timezone: string): string => {
  return redactUuids(historyDisplayText(value, key, timezone));
};

export function WorkOrderHistory({ projectId, projectTimezone = "UTC", workOrderId, projectName, workOrderLabel }: {
  projectId: number | string; projectTimezone?: string; workOrderId?: number | string; projectName?: string; workOrderLabel?: string;
}) {
  const { hasPermission } = usePermissions();
  const canView = hasPermission("audit.view");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [action, setAction] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const filters = useMemo(() => ({ q: q.trim(), action: action === "all" ? "" : action, from, to, page, pageSize: 20 }), [q, action, from, to, page]);
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (workOrderId) params.set("workOrderId", String(workOrderId));
    Object.entries(filters).forEach(([key, value]) => { if (value !== "") params.set(key, String(value)); });
    return params.toString();
  }, [workOrderId, filters]);
  const { data, isLoading, isError, refetch } = useQuery<HistoryResponse>({
    queryKey: ["/api/projects", projectId, "work-order-history", queryString],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/work-order-history?${queryString}`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load work-order history");
      return response.json();
    },
    enabled: open && canView,
  });
  const root = `/api/projects/${projectId}/work-order-history?${queryString}`;
  const headerWorkOrderLabel = workOrderLabel && !isUuid(workOrderLabel)
    ? redactUuids(workOrderLabel)
    : workOrderId && !isUuid(workOrderId) ? workOrderId : "details";
  const exportHistory = (format: "csv" | "print") => {
    const url = `${root}&format=${format}`;
    if (format === "print") window.open(url, "_blank", "noopener,noreferrer");
    else {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "";
      anchor.rel = "noopener";
      anchor.click();
    }
  };

  if (!canView) return null;
  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="button-work-order-history">
      <History className="mr-2 h-4 w-4" />History
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[92dvh] w-[min(96vw,62rem)] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b bg-muted/30 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-7">
            <div><DialogTitle>{workOrderId ? `History · Work order ${headerWorkOrderLabel}` : "Work-order history"}</DialogTitle>
              <DialogDescription className="mt-1">{projectName || data?.projectName || "Project"} · timestamps shown in {data?.timezone || projectTimezone}</DialogDescription>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => exportHistory("csv")}><Download className="mr-2 h-4 w-4" />CSV</Button>
              <Button type="button" variant="outline" size="sm" onClick={() => exportHistory("print")}><Printer className="mr-2 h-4 w-4" />Print</Button>
            </div>
          </div>
        </DialogHeader>
        <div className="grid gap-3 border-b bg-background p-4 sm:grid-cols-[minmax(12rem,1fr)_10rem_9rem_9rem] sm:items-end">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={event => { setQ(event.target.value); setPage(1); }} placeholder="Search customer or work order" className="pl-9" aria-label="Search work-order history" /></div>
          <div className="space-y-1"><Label htmlFor="history-action">Action</Label>
            <Select value={action} onValueChange={value => { setAction(value); setPage(1); }}><SelectTrigger id="history-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                <SelectItem value="workOrder.close">Manually closed</SelectItem>
                <SelectItem value="workOrder.autoClose">Automatically closed</SelectItem>
                <SelectItem value="workOrder.reopen">Reopened</SelectItem>
                <SelectItem value="workOrder.closingPolicyChanged">Closing policy changed</SelectItem>
                <SelectItem value="workOrder.changeBlocked">Change blocked</SelectItem>
                <SelectItem value="workOrder.evidenceAdded">Evidence added</SelectItem>
                <SelectItem value="workOrder.evidenceRemoved">Evidence removed</SelectItem>
                <SelectItem value="inventory.workOrderCompleted">{historyActionLabel("inventory.workOrderCompleted")}</SelectItem>
                <SelectItem value="inventory.WorkOrderCompleted">{historyActionLabel("inventory.WorkOrderCompleted")}</SelectItem>
                <SelectItem value="created">Created</SelectItem>
                <SelectItem value="updated">Updated</SelectItem>
                <SelectItem value="deleted">Deleted</SelectItem>
              </SelectContent>
            </Select></div>
          <div className="space-y-1"><Label htmlFor="history-from">From</Label><Input id="history-from" type="date" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} /></div>
          <div className="space-y-1"><Label htmlFor="history-to">Through</Label><Input id="history-to" type="date" value={to} onChange={event => { setTo(event.target.value); setPage(1); }} /></div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto overscroll-contain p-4 sm:p-6">
          {isLoading ? <div className="space-y-3" aria-label="Loading work-order history">{[0, 1, 2].map(item => <div key={item} className="h-20 animate-pulse rounded-lg bg-muted" />)}</div>
            : isError ? <div className="flex flex-col items-center gap-3 py-12 text-center"><AlertCircle className="h-8 w-8 text-destructive" /><p className="text-sm text-muted-foreground">History could not be loaded.</p><Button variant="outline" onClick={() => refetch()}>Try again</Button></div>
              : !data?.groups.length ? <div className="rounded-xl border border-dashed bg-muted/20 px-5 py-12 text-center"><History className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">No matching work-order history</p><p className="mt-1 text-sm text-muted-foreground">Adjust the search or date range to look further back.</p></div>
                : <div className="space-y-3">{data.groups.map(group => {
                  const isExpanded = expanded[group.operationId] ?? false;
                  const timezone = data?.timezone || projectTimezone;
                  const customerReference = group.workOrderReference ?? group.events.map(event => workOrderReferenceFromMetadata(event.displayMetadata))
                    .find(value => value !== undefined);
                  const referenceEvent = group.events.find(event => event.entityReference && !isUuid(event.entityReference));
                  const primary = group.events.find(event => workOrderReferenceFromMetadata(event.displayMetadata) !== undefined) ||
                    referenceEvent || group.events[0];
                  const referenceText = customerReference !== undefined
                    ? readableHistoryValue(customerReference, "customerWoId", timezone)
                    : undefined;
                  const woLabel = referenceText
                    ? (/\bWO\b|work\s*orders?/i.test(referenceText) ? referenceText : `WO ${referenceText}`)
                    : referenceEvent?.entityReference ? redactUuids(referenceEvent.entityReference) : (workOrderId ? `WO ${headerWorkOrderLabel}` : "");
                  const auditFallback = group.events.find(event => !isUuid(event.id))?.id;
                  const operationReference = group.operationReference && !isUuid(group.operationReference)
                    ? redactUuids(group.operationReference)
                    : auditFallback != null ? `Operation · Audit #${auditFallback}` : "Operation · Audit event";
                  return <article key={group.operationId} className="overflow-hidden rounded-xl border bg-card">
                    <button type="button" className="flex w-full items-start gap-3 p-4 text-left hover:bg-muted/40 sm:items-center" onClick={() => setExpanded(current => ({ ...current, [group.operationId]: !isExpanded }))} aria-expanded={isExpanded}>
                      <span className="mt-0.5 text-muted-foreground">{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2"><strong className="text-sm">{historyActionLabel(primary?.action || "activity")}</strong>
                          {woLabel && <Badge variant="secondary">{woLabel}</Badge>}<Badge variant="outline">{group.events.length} {group.events.length === 1 ? "event" : "events"}</Badge></span>
                        <span className="mt-1 block text-xs text-muted-foreground">{formatDateTimeInTimezone(group.occurredAt, timezone)} · {readableName(group.actorLabel)} · {humanize(group.source || "web")}</span>
                      </span>
                      <span className="hidden max-w-48 shrink-0 truncate text-[10px] text-muted-foreground md:block" title={operationReference}>{operationReference}</span>
                    </button>
                    {isExpanded && <div className="space-y-4 border-t bg-muted/10 p-4 sm:p-5">
                      {group.events.map(event => {
                        const changes = event.displayChanges?.length ? event.displayChanges : event.changes || [];
                        const metadata = event.displayMetadata || event.metadata || {};
                        const metadataEntries = Object.entries(metadata);
                        return <div key={event.id} className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                        <div className="text-xs text-muted-foreground"><p className="font-medium text-foreground">{historyActionLabel(event.action)}</p>
                          <p className="mt-1">{formatDateTimeInTimezone(event.occurredAt, timezone)}</p><p>{readableName(event.actorLabel)} · {humanize(event.source || "web")}</p></div>
                        <div className="min-w-0">
                          {event.entityReference && !isUuid(event.entityReference) && <p className="mb-2 text-sm font-medium">{redactUuids(event.entityReference)}</p>}
                          {changes.length > 0 && <div className="overflow-x-auto rounded-lg border bg-background"><table className="w-full min-w-[26rem] text-left text-xs"><thead className="bg-muted/70 text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Field</th><th className="px-3 py-2 font-medium">Before</th><th className="px-3 py-2 font-medium">After</th></tr></thead>
                            <tbody>{changes.map((change, index) => <tr key={`${change.field}-${index}`} className="border-t"><td className="px-3 py-2 font-medium">{historyFieldLabel(change.field)}</td><td className="max-w-[12rem] break-words px-3 py-2">{readableHistoryValue(change.before, change.field, timezone)}</td><td className="max-w-[12rem] break-words px-3 py-2">{readableHistoryValue(change.after, change.field, timezone)}</td></tr>)}</tbody></table></div>}
                          {metadataEntries.length > 0 && <dl className="mt-3 divide-y rounded-lg border bg-background text-xs">
                            {metadataEntries.map(([key, value]) => <div key={key} className="grid gap-1 px-3 py-2 sm:grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)]">
                              <dt className="font-medium text-muted-foreground">{historyFieldLabel(key)}</dt>
                              <dd className="break-words">{readableHistoryValue(value, key, timezone)}</dd>
                            </div>)}
                          </dl>}
                          {!changes.length && !metadataEntries.length && <p className="text-sm text-muted-foreground">{readableHistoryValue(event.outcome || "Recorded", "outcome", timezone)}</p>}
                          <details className="mt-3 rounded-lg border bg-background/70 px-3 py-2 text-xs">
                            <summary className="cursor-pointer font-medium text-muted-foreground">Raw evidence (technical identifiers)</summary>
                            <div className="mt-2 space-y-1 break-all text-muted-foreground">
                              <p>Event ID: {technicalValue(event.id)}</p>
                              <p>Operation ID: {technicalValue(group.operationId)}</p>
                              <p>Entity ID: {technicalValue(event.entityId)}</p>
                              <p>Event reference: {technicalValue(event.eventReference)}</p>
                              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-2">{JSON.stringify({ changes: event.changes, metadata: event.metadata }, null, 2)}</pre>
                            </div>
                          </details>
                        </div>
                      </div>;
                      })}
                    </div>}
                  </article>;
                })}</div>}
        </div>
        <div className="flex items-center justify-between border-t bg-muted/20 px-4 py-3 text-sm sm:px-6">
          <span className="text-muted-foreground">{data ? `${data.total} operations` : ""}</span>
          <div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page <= 1 || isLoading} onClick={() => setPage(value => value - 1)}>Previous</Button>
            <span className="min-w-16 text-center text-xs text-muted-foreground">Page {page}</span>
            <Button variant="outline" size="sm" disabled={!data || page * filters.pageSize >= data.total || isLoading} onClick={() => setPage(value => value + 1)}>Next</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
