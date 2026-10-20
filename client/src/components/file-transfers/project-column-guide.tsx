import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileSpreadsheet, FileText, Info, Rows3 } from "lucide-react";
import type { WorkOrderColumnGuide, TransferContext } from "@shared/file-transfers";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export type ColumnGuideMode = "manualCsv" | "manualJson" | "scheduled" | "export";

const routeNames = [
  ["manualCsv", "Manual CSV / Excel"],
  ["manualJson", "Manual JSON"],
  ["scheduled", "Scheduled"],
  ["exportable", "Export"],
] as const;
const requirementLabels: Record<WorkOrderColumnGuide["columns"][number]["requirement"], string> = {
  required: "App-required",
  conditional: "Conditional",
  generated: "Generated / recommended",
  optional: "Optional",
  managed: "Managed",
};

function routeSupport(column: WorkOrderColumnGuide["columns"][number]) {
  return routeNames.filter(([key]) => column[key]).map(([, label]) => label);
}

export function ProjectColumnGuide({ projectId, mode, guide: suppliedGuide }: { projectId?: number; mode: ColumnGuideMode; guide?: WorkOrderColumnGuide }) {
  const [open, setOpen] = useState(false);
  const route = mode === "export" ? "exportable" : mode;
  const queryKey = [`/api/projects/${projectId}/file-transfers`];
  const query = useQuery<TransferContext>({
    queryKey,
    queryFn: async () => {
      const response = await apiRequest("GET", queryKey[0] as string);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Could not load the project column guide.");
      return response.json();
    },
    enabled: !suppliedGuide && Boolean(projectId),
  });
  const guide = suppliedGuide || query.data?.columnGuide;
  const title = mode === "export" ? "Export field guide" : mode === "scheduled" ? "Scheduled import field guide" : mode === "manualJson" ? "Manual JSON field guide" : "Manual CSV / Excel field guide";
  const columns = guide?.columns.filter(column => mode === "export" ? column.exportable : column[route]) || [];
  const byRequirement = columns.reduce<Record<string, number>>((counts, column) => {
    counts[column.requirement] = (counts[column.requirement] || 0) + 1;
    return counts;
  }, {});
  const serviceTypes = guide?.serviceTypes || [];

  if (query.isLoading && !guide) return <div className="space-y-2 rounded-md border p-3"><Skeleton className="h-5 w-44" /><Skeleton className="h-4 w-full" /></div>;
  if (query.isError && !guide) return <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">Column guide unavailable: {query.error instanceof Error ? query.error.message : "Try again later."}</div>;
  if (!guide) return <div className="rounded-md border p-3 text-sm text-muted-foreground">Column guide is not available.</div>;

  return <section className="min-w-0 rounded-md border bg-card" aria-label={title}>
    <div className="flex flex-wrap items-start justify-between gap-2 p-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Info className="h-4 w-4 shrink-0 text-primary" />{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {columns.length} supported fields · {mode === "export" ? "choose at least one; no specific field required" : `${byRequirement.required || 0} app-required`} · checked against {guide.checkedAgainst}.
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(value => !value)} className="shrink-0">
        {open ? "Hide details" : "View fields & database"}<ChevronDown className={`ml-1.5 h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>
    </div>
    {mode === "export" && <div className="mx-3 mb-3 rounded border border-primary/15 bg-primary/5 p-2.5 text-xs leading-relaxed">
      No particular export columns are required; select at least one. <strong>customerWoId</strong> is a useful identity field. Full vs. changed-only export is independent from the selected parent/sub-status scope. Deliver to local storage, SFTP, or HTTPS outbox. Filename date tokens are supported; runId is added when omitted. The changed-data checkpoint advances only after delivery succeeds; retry sends the same saved snapshot.
    </div>}
    {mode === "scheduled" && <div className="mx-3 mb-3 rounded border border-muted bg-muted/30 p-2.5 text-xs leading-relaxed text-muted-foreground">
      <p><strong className="text-foreground">Source behavior:</strong> Local uses the newest matching file uploaded to Project FTP Files; SFTP and HTTPS select the oldest eligible matching file, up to 25 per run. Remote SFTP and HTTPS sources require a filename pattern. Configure source, pattern, mappings, enabled state, frequency, and project timezone here. Manual-frequency schedules run only when requested. Known file hashes prevent repeat processing; failed work can be retried on a later schedule execution. Manual runs report imported/failed counts, and the row retains the latest run date/status.</p>
    </div>}
    {(mode === "manualCsv" || mode === "manualJson") && <div className="mx-3 mb-3 rounded border border-amber-700/15 bg-amber-50/60 p-2.5 text-xs leading-relaxed text-amber-950">
      App-required means validation at import time; it is separate from legacy database nullability. A nullable database column can still be required by the import route. Work-order ID is generated when omitted by the runtime guide; including it is recommended, not required.
      {mode === "manualCsv" && <span> The legacy CSV mapper still shows compatibility controls beyond this route’s accepted keys. createdBy is importer-managed; scheduledBy, completedBy, and completedAt are not accepted by manual import and may be ignored if mapped.</span>}
      {mode === "manualJson" && <span> createdBy is importer-managed; scheduledBy, completedBy, and completedAt are not accepted by manual import, even if supplied in the JSON object.</span>}
    </div>}
    {open && <div className="border-t p-3">
      {mode === "export" ? <p className="mb-3 text-xs text-muted-foreground">All fields below are the exportable names supplied by the project runtime. These are the exact column keys to select in an export configuration. To make files downloadable through the standalone built-in SFTP Server, select Server local folder as the destination; customers download completed files from /outgoing.</p> : <p className="mb-3 text-xs text-muted-foreground">Transfer methods do not change required or optional columns. Standalone SFTP Server uploads to /incoming enter Project FTP Files only after completion. Process them with a LOCAL import configuration and filename pattern; remote SFTP connections and HTTPS inboxes remain separate sources.</p>}
      {mode === "manualJson" && <div className="mb-3 rounded border bg-muted/30 p-2.5 text-xs leading-relaxed text-muted-foreground"><FileText className="mr-1 inline h-3.5 w-3.5" />JSON accepts the fields below plus JSON-specific values such as <code>newSystemId</code>, <code>newSystemReading</code>, <code>newGps</code>, and <code>attachments</code>. Reading text aliases are supported in JSON; they are not CSV mapping columns. Fields not in the route list are not assumed accepted.</div>}
      {mode === "manualCsv" && <p className="mb-3 text-xs text-muted-foreground"><FileSpreadsheet className="mr-1 inline h-3.5 w-3.5" />Required CSV keys for customer identity are customerId, customerName, and address. A configured project service type is required: one configured type may be used by default; with multiple types, supply the matching value. customerWoId is generated if omitted and recommended as a stable external identity.</p>}
      {mode === "manualJson" && <p className="mb-3 text-xs text-muted-foreground">Configure at least one project service type before manual imports. One project type can be applied when omitted; with multiple configured types, provide one of the project’s service type codes.</p>}
      {(mode === "manualCsv" || mode === "manualJson") && <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs"><span className="font-medium">Configured project service types:</span>{serviceTypes.length ? serviceTypes.map(item => <Badge key={item.code} variant="secondary">{item.label} <code className="ml-1">{item.code}</code></Badge>) : <span className="text-muted-foreground">None configured. Add a project service type before using manual import.</span>}</div>}
      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
        {columns.map(column => <article key={column.field} className="min-w-0 rounded border p-2.5">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <code className="break-all text-xs font-semibold">{column.field}</code>
            <Badge variant={mode !== "export" && column.requirement === "required" ? "default" : column.requirement === "managed" ? "secondary" : "outline"} className="text-[10px]">{mode === "export" ? "Selectable" : requirementLabels[column.requirement]}</Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{column.note}</p>
          <div className="mt-2 flex flex-wrap gap-1">{routeSupport(column).map(label => <span key={label} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{label}</span>)}</div>
          <details className="mt-2 border-t pt-2">
            <summary className="cursor-pointer text-xs font-medium text-primary">Database comparison</summary>
            <dl className="mt-2 grid min-w-0 grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">DB column</dt><dd className="break-all font-mono">{column.databaseColumn}</dd>
              <dt className="text-muted-foreground">Type</dt><dd className="break-words">{column.dataType}</dd>
              <dt className="text-muted-foreground">Nullability</dt><dd>{column.databaseNullable ? "Nullable" : "NOT NULL"}</dd>
              <dt className="text-muted-foreground">DB default</dt><dd>{column.databaseDefault ? "Configured" : "None"}</dd>
            </dl>
          </details>
        </article>)}
      </div>
      <div className="mt-3 rounded border border-amber-700/15 bg-amber-50/60 p-2.5 text-xs leading-relaxed text-amber-950">
        <Rows3 className="mr-1 inline h-3.5 w-3.5" /><strong>Database nullability is not import validation.</strong> Required/conditional/generated/managed labels describe this route’s application behavior. Managed fields are supplied by MeterFlo; generated values may be filled when omitted; export-only/internal columns are not import inputs. Database defaults and nullable flags describe the installed schema only.
      </div>
      <details className="mt-3 rounded-md border">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold">Compare all {guide.columns.length} runtime schema fields, including managed and export-only columns</summary>
        <p className="px-3 pb-2 text-xs text-muted-foreground">This view compares the complete runtime guide to the installed work-order schema. Field support varies by route; a database column existing does not make it an accepted import field.</p>
        <div className="grid min-w-0 gap-2 border-t p-3 sm:grid-cols-2">
          {guide.columns.map(column => <article key={`schema-${column.field}`} className="min-w-0 rounded border p-2">
            <div className="flex flex-wrap items-center justify-between gap-1"><code className="break-all text-xs font-semibold">{column.field}</code><Badge variant={mode !== "export" && column.requirement === "required" ? "default" : column.requirement === "managed" ? "secondary" : "outline"} className="text-[10px]">{mode === "export" ? "Input: " + requirementLabels[column.requirement] : requirementLabels[column.requirement]}</Badge></div>
            <p className="mt-1 break-words text-[11px] text-muted-foreground">{column.databaseColumn} · {column.dataType} · {column.databaseNullable ? "Nullable" : "NOT NULL"} · {column.databaseDefault ? "DB default" : "No DB default"}</p>
            <div className="mt-1 flex flex-wrap gap-1">{routeSupport(column).map(label => <span key={label} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{label}</span>)}{!routeSupport(column).length && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">No external route input</span>}</div>
          </article>)}
        </div>
      </details>
    </div>}
  </section>;
}
