import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, Clock3, Download, FileSpreadsheet, Loader2, PackageCheck, Printer, RefreshCw, Search, Warehouse as WarehouseIcon } from "lucide-react";
import type { InventoryState } from "@shared/inventory";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "wouter";

type UsageLine = { itemId: string; warehouseId: string; quantity: number; serials: string[] };
type Disposition = { equipment: string; serial: string; disposition: string; warehouseId: string | null;
  ruleId?: string | null; ruleRevision?: number | null; policyRevision?: number | null };
type UsageSnapshot = { mode: "changeout" | "reading_only"; used: UsageLine[]; dispositions: Disposition[] };
type Job = {
  id: string; workOrderId: number; customerWoId: string | null;
  status: "pending" | "failed" | "succeeded"; attempts: number; error: string | null;
  createdAt: string; finishedAt: string | null; actorLabel: string | null; usage: UsageSnapshot;
  reviewedUsage: UsageSnapshot | null; reviewReason: string | null; newSystemId: string | null; newModuleId: string | null;
};
type EditLine = { itemId: string; warehouseId: string; quantity: string; serials: string };
type EditDisposition = { equipment: string; serial: string; disposition: string; warehouseId: string; ruleId: string; ruleRevision: string; policyRevision: string };
type EditUsage = { mode: "changeout" | "reading_only"; used: EditLine[]; dispositions: EditDisposition[] };
const keyFor = (projectId: number | string) => ["/api/projects", projectId, "changeout-reconciliation"];
const labelDate = (value: string, timezone: string) => new Date(value).toLocaleString(undefined, { timeZone: timezone });
const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};
const safeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const editSnapshot = (usage: UsageSnapshot): EditUsage => ({
  mode: usage.mode,
  used: (usage.used ?? []).map(line => ({ itemId: line.itemId ?? "", warehouseId: line.warehouseId ?? "",
    quantity: String(line.quantity ?? ""), serials: (line.serials ?? []).join("\n") })),
  dispositions: (usage.dispositions ?? []).map(line => ({ equipment: line.equipment ?? "system", serial: line.serial ?? "",
    disposition: line.disposition ?? "", warehouseId: line.warehouseId ?? "", ruleId: line.ruleId ?? "",
    ruleRevision: line.ruleRevision == null ? "" : String(line.ruleRevision),
    policyRevision: line.policyRevision == null ? "" : String(line.policyRevision) })),
});
const payloadSnapshot = (draft: EditUsage): UsageSnapshot => ({
  mode: draft.mode,
  used: draft.used.map(line => ({ itemId: line.itemId, warehouseId: line.warehouseId,
    quantity: Number(line.quantity), serials: line.serials.split(/[\n,;]/).map(value => value.trim()).filter(Boolean) })),
  dispositions: draft.dispositions.map(line => ({ equipment: line.equipment, serial: line.serial.trim(),
    disposition: line.disposition, warehouseId: line.warehouseId || null,
    ruleId: line.ruleId || null, ruleRevision: line.ruleRevision ? Number(line.ruleRevision) : null,
    policyRevision: line.policyRevision ? Number(line.policyRevision) : null })),
});

export function ChangeoutReconciliationJobs({ projectId, state, canResolve, projectName, timezone = "UTC", onNavigate }: {
  projectId: number | string; state: InventoryState; canResolve: boolean; projectName: string; timezone?: string; onNavigate: (tab: string) => void;
}) {
  const queryClient = useQueryClient();
  const jobKey = keyFor(projectId);
  const { data, isLoading, isError, refetch, isFetching } = useQuery<{ jobs: Job[] }>({
    queryKey: jobKey,
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/changeout-reconciliation`, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load changeout reconciliation jobs.");
      return response.json();
    },
    enabled: !!projectId,
  });
  const [statusFilter, setStatusFilter] = useState<"open" | "all">("open");
  const [search, setSearch] = useState("");
  const [edits, setEdits] = useState<Record<string, EditUsage>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notices, setNotices] = useState<Record<string, string>>({});
  const jobs = data?.jobs ?? [];
  const rows = useMemo(() => jobs.filter(job => statusFilter === "all" || job.status !== "succeeded")
    .filter(job => [job.customerWoId, job.workOrderId, job.status, job.actorLabel, job.error, job.newSystemId, job.newModuleId,
      ...(job.usage?.used ?? []).flatMap(line => [line.itemId, line.warehouseId, line.quantity, ...(line.serials ?? [])]),
      ...(job.usage?.dispositions ?? []).flatMap(line => [line.equipment, line.serial, line.disposition, line.warehouseId])]
      .some(value => String(value ?? "").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [jobs, statusFilter, search]);
  const displayReference = (job: Job) => job.customerWoId?.trim() || `Work order ${job.workOrderId}`;
  const getEdit = (job: Job) => edits[job.id] ?? editSnapshot(job.reviewedUsage ?? job.usage);
  const setEdit = (id: string, updater: (current: EditUsage) => EditUsage) =>
    setEdits(current => ({ ...current, [id]: updater(current[id] ?? editSnapshot(jobs.find(job => job.id === id)?.reviewedUsage ?? jobs.find(job => job.id === id)?.usage ?? { mode: "changeout", used: [], dispositions: [] })) }));
  const retryJob = async (job: Job) => {
    const reason = (reasons[job.id] ?? "").trim();
    if (reason.length < 10) { setErrors(current => ({ ...current, [job.id]: "Explain the correction or retry in at least 10 characters." })); return; }
    const corrected = edits[job.id];
    const usage = corrected ? payloadSnapshot(corrected) : undefined;
    if (usage?.used.some(line => !line.itemId || !line.warehouseId || !Number.isFinite(line.quantity) || line.quantity <= 0)) {
      setErrors(current => ({ ...current, [job.id]: "Each usage line needs a catalog item, location, and positive quantity." })); return;
    }
    setBusyId(job.id);
    setErrors(current => ({ ...current, [job.id]: "" }));
    try {
      const response = await fetch(`/api/projects/${projectId}/changeout-reconciliation/${job.id}/retry`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, ...(usage ? { usage } : {}) }),
      });
      const body = await response.json().catch(() => ({}));
      if (response.status === 409) {
        setErrors(current => ({ ...current, [job.id]: body.message || "This reconciliation job changed elsewhere. Your edits are preserved; review the refreshed status before retrying." }));
        await queryClient.invalidateQueries({ queryKey: jobKey });
        return;
      }
      if (!response.ok) throw new Error(body.message || "Retry could not be queued. Your correction remains in this form.");
      setNotices(current => ({ ...current, [job.id]: body.queued === true
        ? "Retry queued. Warehouse stock remains pending until the job succeeds."
        : "Retry accepted. Refresh the job status to confirm the warehouse posting." }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: jobKey }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "inventory"] }),
      ]);
    } catch (error) {
      setErrors(current => ({ ...current, [job.id]: error instanceof Error ? error.message : "Retry failed. Your correction remains in this form." }));
    } finally { setBusyId(null); }
  };
  const exportRows = async (format: "csv" | "xlsx" | "pdf") => {
    const columns = ["Work order", "Status", "Attempts", "Created", "Finished", "Reported by", "Error", "New system ID", "New module ID", "Usage mode", "Used lines", "Disposition lines", "Review reason"];
    const values = rows.map(job => [displayReference(job), job.status, job.attempts, labelDate(job.createdAt, timezone),
      job.finishedAt ? labelDate(job.finishedAt, timezone) : "", job.actorLabel ?? "", job.error ?? "", job.newSystemId ?? "", job.newModuleId ?? "",
      (job.reviewedUsage ?? job.usage).mode, (job.reviewedUsage ?? job.usage).used.map(line => `${line.quantity} × ${state.items.find(item => item.id === line.itemId)?.sku ?? line.itemId} @ ${state.warehouses.find(warehouse => warehouse.id === line.warehouseId)?.code ?? line.warehouseId} [${(line.serials ?? []).join(", ")}]`).join("; "),
      (job.reviewedUsage ?? job.usage).dispositions.map(line => `${line.equipment} ${line.serial} · ${line.disposition}`).join("; "), job.reviewReason ?? ""]);
    if (!values.length) return;
    const fileBase = `${projectName.replace(/[^a-z0-9_-]+/gi, "-")}-changeout-reconciliation`;
    if (format === "csv") {
      const blob = new Blob(["\uFEFF", [columns, ...values].map(line => line.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${fileBase}.csv`; anchor.click(); URL.revokeObjectURL(url); return;
    }
    if (format === "xlsx") {
      const XLSX = await import("xlsx"); const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([columns, ...values]), "Reconciliation jobs");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Project", projectName], ["Timezone", timezone], ["Scope", `${rows.length} matching jobs`]]), "Export details");
      XLSX.writeFile(book, `${fileBase}.xlsx`); return;
    }
    const popup = window.open("", "_blank");
    if (!popup) return;
    popup.opener = null;
    popup.document.write(`<!doctype html><html><head><title>${safeHtml(projectName)} — Changeout reconciliation</title><style>body{font:12px sans-serif;margin:24px;color:#24333a}table{width:100%;border-collapse:collapse}th,td{border:1px solid #b9c5c7;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}@page{size:landscape;margin:12mm}</style></head><body><button onclick="window.print()">Print / Save PDF</button><h1>Changeout reconciliation jobs</h1><p>${safeHtml(projectName)} · ${rows.length} matching jobs · ${safeHtml(timezone)}</p><table><thead><tr>${columns.map(value => `<th>${safeHtml(value)}</th>`).join("")}</tr></thead><tbody>${values.map(line => `<tr>${line.map(value => `<td>${safeHtml(value)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`);
    popup.document.close();
  };

  return <details className="rounded-lg border border-amber-900/15 bg-amber-50/40 px-3 dark:bg-amber-950/10" data-testid="changeout-reconciliation-jobs">
    <summary className="cursor-pointer py-2 text-sm font-medium" data-testid="changeout-reconciliation-toggle">
      Changeout posting · {jobs.filter(job => job.status === "pending").length} pending · {jobs.filter(job => job.status === "failed").length} failed
    </summary>
    <div className="pb-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2"><PackageCheck className="h-4 w-4 shrink-0 text-amber-800" /><div><h3 className="font-semibold">Changeout reconciliation jobs</h3><p className="text-xs text-muted-foreground">All unresolved jobs remain available. Posted history shows the latest 500; full stock history is in Activity.</p></div>
        <Badge variant="outline">{jobs.filter(job => job.status !== "succeeded").length} open</Badge></div>
      <Button type="button" size="sm" variant="outline" disabled={isFetching} onClick={() => void refetch()} data-testid="button-refresh-changeout-reconciliation"><RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />Refresh</Button>
    </div>
    <details className="mt-2 text-xs text-muted-foreground"><summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-foreground"><ChevronDown className="h-3.5 w-3.5" />How to clear a failed job</summary>
      <p className="mt-1 pl-5">First correct the source record in the normal Inventory item, location, or work-order workflow when possible. Then review the captured usage, select the corrected item/location/quantity/serials if mapping is missing, enter a reason, and queue a retry. Captured usage is immutable audit evidence; correction is recorded separately. A queued retry is not a completed stock posting.</p>
      <div className="mt-2 flex flex-wrap gap-1 pl-5"><Button type="button" size="sm" variant="outline" onClick={() => onNavigate("items")}>Items / kits</Button><Button type="button" size="sm" variant="outline" onClick={() => onNavigate("locations")}>Locations</Button></div>
    </details>
    <details className="mt-2 rounded border bg-background/60 px-2">
      <summary className="cursor-pointer py-2 text-xs font-medium">Search, filter and export reconciliation jobs</summary>
      <div className="flex flex-col gap-2 pb-1 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" aria-label="Search reconciliation jobs" placeholder="Search work order, ID, or error" value={search} onChange={event => setSearch(event.target.value)} data-testid="changeout-reconciliation-search" /></div>
        <Select value={statusFilter} onValueChange={value => setStatusFilter(value as typeof statusFilter)}><SelectTrigger className="w-full sm:w-40" aria-label="Reconciliation status filter"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Pending & failed</SelectItem><SelectItem value="all">Include recent posted</SelectItem></SelectContent></Select>
        <div className="flex gap-1.5" data-testid="changeout-reconciliation-exports">
          <Button type="button" size="sm" variant="outline" disabled={!rows.length} onClick={() => void exportRows("csv")}><Download className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">CSV</span></Button>
          <Button type="button" size="sm" variant="outline" disabled={!rows.length} onClick={() => void exportRows("xlsx")}><FileSpreadsheet className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Excel</span></Button>
          <Button type="button" size="sm" variant="outline" disabled={!rows.length} onClick={() => void exportRows("pdf")}><Printer className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Print</span></Button>
        </div>
      </div>
    </details>
    {isLoading ? <div className="space-y-2 py-2" data-testid="changeout-reconciliation-loading">{[0, 1].map(key => <div key={key} className="h-12 animate-pulse rounded-md bg-muted/70" />)}</div> :
      isError ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Reconciliation jobs unavailable</AlertTitle><AlertDescription className="flex items-center justify-between gap-2">The inventory exception queue is still available. Retry loading these jobs.<Button size="sm" variant="outline" onClick={() => void refetch()} data-testid="button-retry-changeout-jobs-load">Retry</Button></AlertDescription></Alert> :
      !rows.length ? <div className="rounded-md border border-dashed bg-background/70 px-3 py-4 text-center text-sm" data-testid="changeout-reconciliation-empty">{jobs.length && statusFilter === "all" ? "No jobs match this search." : jobs.some(job => job.status === "succeeded") ? "All listed changeout postings have succeeded." : jobs.length ? "No jobs match this search." : "No pending or failed changeout postings."}</div> :
      <div className="mt-2 max-h-[44dvh] space-y-2 overflow-y-auto overscroll-contain pr-1">
        {rows.map(job => {
          const currentUsage = job.reviewedUsage ?? job.usage;
          const edit = getEdit(job);
          const editable = canResolve && job.status !== "succeeded";
          const busy = busyId === job.id;
          return <article key={job.id} className="rounded-md border bg-background p-3" data-testid={`changeout-job-${job.id}`}>
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><h4 className="font-semibold">{displayReference(job)}</h4>
                  <Badge variant={job.status === "failed" ? "destructive" : job.status === "pending" ? "outline" : "secondary"}>{job.status}</Badge>
                  <span className="text-xs text-muted-foreground">Attempt {job.attempts}</span></div>
                <p className="mt-1 text-xs text-muted-foreground"><Link href={`/work-orders/${job.workOrderId}`} className="underline underline-offset-2">Open work order</Link> · {job.actorLabel || "Technician"} · {labelDate(job.createdAt, timezone)} ({timezone})</p>
                {job.error && <p className="mt-1 break-words text-sm text-destructive" data-testid={`changeout-job-error-${job.id}`}>{job.error}</p>}
              </div>
              {job.status === "succeeded" && job.finishedAt && <span className="text-xs text-muted-foreground">Posted {labelDate(job.finishedAt, timezone)}</span>}
            </div>
            <details className="mt-2 border-t pt-2 text-sm">
              <summary className="cursor-pointer text-xs font-medium">Captured usage, equipment IDs and review</summary>
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-2 gap-2 rounded bg-muted/30 p-2 text-xs">
                  <span className="text-muted-foreground">New system ID</span><span className="break-all font-mono">{job.newSystemId || "—"}</span>
                  <span className="text-muted-foreground">New module ID</span><span className="break-all font-mono">{job.newModuleId || "—"}</span>
                  <span className="text-muted-foreground">Captured mode</span><span>{job.usage.mode}</span>
                </div>
                <h5 className="text-xs font-semibold">Original captured usage (read-only)</h5>
                {!job.usage.used.length && !job.usage.dispositions.length ? <p className="text-xs text-muted-foreground">No mapped usage lines were captured. Use the correction editor below if mapping was omitted.</p> :
                  <ul className="space-y-1 text-xs">{job.usage.used.map((line, index) => <li key={`use-${index}`}>{line.quantity} × {state.items.find(item => item.id === line.itemId)?.name ?? line.itemId} · {state.warehouses.find(warehouse => warehouse.id === line.warehouseId)?.code ?? line.warehouseId} · {(line.serials ?? []).join(", ") || "no serials"}</li>)}
                    {job.usage.dispositions.map((line, index) => <li key={`disp-${index}`}>Removed {line.equipment}: {line.serial || "no serial"} · {line.disposition || "unmapped"}{line.warehouseId ? ` · ${state.warehouses.find(warehouse => warehouse.id === line.warehouseId)?.code ?? line.warehouseId}` : ""}</li>)}</ul>}
                {job.reviewedUsage && <div className="rounded border border-teal-900/15 bg-teal-50/40 p-2 text-xs dark:bg-teal-950/20"><p className="font-semibold">Latest reviewed correction</p><p>{job.reviewReason || "Reason not available"}</p><p>{job.reviewedUsage.used.length} usage line(s), {job.reviewedUsage.dispositions.length} disposition(s)</p></div>}
                {editable && <div className="space-y-3 rounded-md border border-amber-800/20 p-2">
                  <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold">Review and queue retry</p><p className="text-xs text-muted-foreground">Corrections are retained here after errors and conflicts. Retry only after fixing the source item/location if needed.</p></div><WarehouseIcon className="h-4 w-4 shrink-0 text-muted-foreground" /></div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2"><Label className="text-xs">Usage lines</Label><Button type="button" size="sm" variant="outline" onClick={() => setEdit(job.id, current => ({ ...current, used: [...current.used, { itemId: "", warehouseId: "", quantity: "1", serials: "" }] }))} data-testid={`add-usage-line-${job.id}`}>Add line</Button></div>
                    {!edit.used.length && <p className="text-xs text-muted-foreground">No mapped usage. Add a line to map captured field use to inventory.</p>}
                    {edit.used.map((line, index) => <div key={index} className="grid grid-cols-1 gap-2 rounded border bg-muted/20 p-2 sm:grid-cols-2">
                      <div className="space-y-1"><Label className="text-xs">Catalog item</Label><Select value={line.itemId || "unmapped"} onValueChange={value => setEdit(job.id, current => ({ ...current, used: current.used.map((item, row) => row === index ? { ...item, itemId: value === "unmapped" ? "" : value } : item) }))}><SelectTrigger aria-label={`Usage line ${index + 1} item`}><SelectValue placeholder="Select item" /></SelectTrigger><SelectContent>{!line.itemId && <SelectItem value="unmapped">Choose item</SelectItem>}{state.items.filter(item => item.active || item.id === line.itemId).map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label className="text-xs">Warehouse / location</Label><Select value={line.warehouseId || "unmapped"} onValueChange={value => setEdit(job.id, current => ({ ...current, used: current.used.map((item, row) => row === index ? { ...item, warehouseId: value === "unmapped" ? "" : value } : item) }))}><SelectTrigger aria-label={`Usage line ${index + 1} location`}><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{!line.warehouseId && <SelectItem value="unmapped">Choose location</SelectItem>}{state.warehouses.filter(warehouse => warehouse.active || warehouse.id === line.warehouseId).map(warehouse => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label className="text-xs">Quantity</Label><Input type="number" min="0.001" step="any" value={line.quantity} onChange={event => setEdit(job.id, current => ({ ...current, used: current.used.map((item, row) => row === index ? { ...item, quantity: event.target.value } : item) }))} /></div>
                      <div className="space-y-1"><Label className="text-xs">Serials, one per line</Label><Textarea rows={2} value={line.serials} onChange={event => setEdit(job.id, current => ({ ...current, used: current.used.map((item, row) => row === index ? { ...item, serials: event.target.value } : item) }))} /></div>
                      <Button type="button" size="sm" variant="ghost" className="sm:col-span-2 sm:justify-self-end" onClick={() => setEdit(job.id, current => ({ ...current, used: current.used.filter((_, row) => row !== index) }))}>Remove usage line</Button>
                    </div>)}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2"><Label className="text-xs">Removed equipment dispositions</Label><Button type="button" size="sm" variant="outline" onClick={() => setEdit(job.id, current => ({ ...current, dispositions: [...current.dispositions, { equipment: "system", serial: "", disposition: "", warehouseId: "", ruleId: "", ruleRevision: "", policyRevision: "" }] }))} data-testid={`add-disposition-${job.id}`}>Add disposition</Button></div>
                    {edit.dispositions.map((line, index) => <div key={index} className="grid grid-cols-1 gap-2 rounded border bg-muted/20 p-2 sm:grid-cols-2">
                      <div className="space-y-1"><Label className="text-xs">Equipment</Label><Select value={line.equipment} onValueChange={value => setEdit(job.id, current => ({ ...current, dispositions: current.dispositions.map((item, row) => row === index ? { ...item, equipment: value } : item) }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="system">System</SelectItem><SelectItem value="module">Module</SelectItem></SelectContent></Select></div>
                      <div className="space-y-1"><Label className="text-xs">Removed serial</Label><Input value={line.serial} onChange={event => setEdit(job.id, current => ({ ...current, dispositions: current.dispositions.map((item, row) => row === index ? { ...item, serial: event.target.value } : item) }))} /></div>
                      <div className="space-y-1"><Label className="text-xs">Disposition</Label><Select value={line.disposition || "unmapped"} onValueChange={value => setEdit(job.id, current => ({ ...current, dispositions: current.dispositions.map((item, row) => row === index ? { ...item, disposition: value === "unmapped" ? "" : value } : item) }))}><SelectTrigger><SelectValue placeholder="Select disposition" /></SelectTrigger><SelectContent>{!line.disposition && <SelectItem value="unmapped">Choose disposition</SelectItem>}<SelectItem value="returned">Returned to stock</SelectItem><SelectItem value="recycled">Recycled</SelectItem><SelectItem value="left_onsite">Left onsite</SelectItem></SelectContent></Select></div>
                      <div className="space-y-1"><Label className="text-xs">Return location (if applicable)</Label><Select value={line.warehouseId || "none"} onValueChange={value => setEdit(job.id, current => ({ ...current, dispositions: current.dispositions.map((item, row) => row === index ? { ...item, warehouseId: value === "none" ? "" : value } : item) }))}><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent><SelectItem value="none">No warehouse</SelectItem>{state.warehouses.filter(warehouse => warehouse.active || warehouse.id === line.warehouseId).map(warehouse => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</SelectItem>)}</SelectContent></Select></div>
                      <div className="space-y-1"><Label className="text-xs">Rule ID (optional)</Label><Input value={line.ruleId} onChange={event => setEdit(job.id, current => ({ ...current, dispositions: current.dispositions.map((item, row) => row === index ? { ...item, ruleId: event.target.value } : item) }))} /></div>
                      <div className="space-y-1"><Label className="text-xs">Rule revision (optional)</Label><Input inputMode="numeric" value={line.ruleRevision} onChange={event => setEdit(job.id, current => ({ ...current, dispositions: current.dispositions.map((item, row) => row === index ? { ...item, ruleRevision: event.target.value } : item) }))} /></div>
                      <div className="space-y-1"><Label className="text-xs">Policy revision (optional)</Label><Input inputMode="numeric" value={line.policyRevision} onChange={event => setEdit(job.id, current => ({ ...current, dispositions: current.dispositions.map((item, row) => row === index ? { ...item, policyRevision: event.target.value } : item) }))} /></div>
                      <Button type="button" size="sm" variant="ghost" className="sm:col-span-2 sm:justify-self-end" onClick={() => setEdit(job.id, current => ({ ...current, dispositions: current.dispositions.filter((_, row) => row !== index) }))}>Remove disposition</Button>
                    </div>)}
                  </div>
                  <div className="space-y-1"><Label htmlFor={`reconciliation-reason-${job.id}`}>Review reason <span className="text-muted-foreground">(10 characters minimum)</span></Label><Textarea id={`reconciliation-reason-${job.id}`} rows={2} maxLength={2000} value={reasons[job.id] ?? ""} onChange={event => setReasons(current => ({ ...current, [job.id]: event.target.value }))} data-testid={`changeout-reason-${job.id}`} /></div>
                  {errors[job.id] && <p role="alert" className="text-sm text-destructive" data-testid={`changeout-retry-error-${job.id}`}>{errors[job.id]}</p>}
                  {notices[job.id] && <p role="status" className="text-sm text-teal-800">{notices[job.id]}</p>}
                  <Button type="button" disabled={!canResolve || busy || reasonLength(reasons[job.id]) < 10} onClick={() => void retryJob(job)} data-testid={`retry-changeout-job-${job.id}`}>
                    {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Queuing retry…</> : <><Check className="mr-2 h-4 w-4" />Queue retry</>}
                  </Button>
                  {!canResolve && <p className="text-xs text-muted-foreground">You need inventory exception-resolution permission to retry jobs.</p>}
                </div>}
                {job.status === "pending" && <p className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />Queued for warehouse reconciliation. Stock posting is not yet confirmed.</p>}
              </div>
            </details>
          </article>;
        })}
      </div>}
    </div>
  </details>;
}

function reasonLength(value: string | undefined) { return (value ?? "").trim().length; }
