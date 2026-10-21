import { useMemo, useState } from "react";
import type { InventoryState } from "@shared/inventory";
import type { StockDiscrepancy } from "@shared/inventory-stock-discrepancies";
import { resolveStockDiscrepancySchema, stockDiscrepancyLabel } from "@shared/inventory-stock-discrepancies";
import { inventoryActorLabel, inventoryReceiptLabel, type InventoryActorLabel } from "@shared/inventory-display-labels";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Download, FileSpreadsheet, Printer, Search, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { InventoryMobileTools } from "@/components/inventory-mobile-tools";
import { ChangeoutReconciliationJobs } from "@/components/changeout-reconciliation-jobs";

type ResolveInput = { id: string; method: "apply_stock" | "documented_adjustment"; reason: string; evidence: string; receiptIds: string[] };
type Props = {
  projectId: number | string; state: InventoryState; canResolve: boolean; busy?: boolean; timezone: string; projectName: string;
  actors: InventoryActorLabel[]; workOrderLabels: Record<string, string>;
  workOrderIdentifiers?: Record<string, { customerWoId: string; equipmentIds: string[] }>;
  onResolve: (payload: ResolveInput) => Promise<boolean>; onNavigate: (tab: string) => void;
};

const dateLabel = (value: string, timezone: string) => new Date(value).toLocaleString(undefined, { timeZone: timezone });
const receiptActionLabel = (action: string) => ({
  receive: "Purchase received", accept: "Transfer received", assemble: "Kit assembled",
  countPost: "Cycle count posted", returnRelease: "Return released", resolveHold: "Hold resolved",
}[action] ?? "Inventory receipt");
const safeCell = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const csvCell = (value: unknown) => {
  const text = String(value ?? "");
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

export function InventoryStockDiscrepancies({ projectId, state, canResolve, busy = false, timezone, projectName, actors, workOrderLabels, workOrderIdentifiers, onResolve, onNavigate }: Props) {
  const [status, setStatus] = useState<"open" | "resolved" | "all">("open");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<StockDiscrepancy | null>(null);
  const [method, setMethod] = useState<ResolveInput["method"]>("apply_stock");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [receiptIds, setReceiptIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const rows = useMemo(() => (state.stockDiscrepancies ?? []).filter(row => status === "all" || row.status === status)
    .filter(row => {
      const query = search.trim().toLocaleLowerCase();
      if (!query) return true;
      const label = workOrderLabels[String(row.workOrderId)] ?? "";
      const customer = workOrderIdentifiers?.[String(row.workOrderId)]?.customerWoId ?? "";
      const actor = inventoryActorLabel(row.actor, actors);
      return [row.itemSku, row.itemName, row.locationName, label, customer, actor, row.reason, row.evidence,
        stockDiscrepancyLabel(state, row.id)].some(value => String(value ?? "").toLocaleLowerCase().includes(query));
    }).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [state.stockDiscrepancies, status, search, workOrderLabels, workOrderIdentifiers, actors]);
  const openCount = (state.stockDiscrepancies ?? []).filter(row => row.status === "open").length;
  const orderText = (row: StockDiscrepancy) => workOrderIdentifiers?.[String(row.workOrderId)]?.customerWoId?.trim()
    || workOrderLabels[String(row.workOrderId)]?.trim() || `Work order ${row.workOrderId}`;
  const linkedReceipts = (row: StockDiscrepancy) => {
    const sourcePosition = state.receipts.findIndex(receipt => receipt.id === row.sourceReceiptId);
    if (sourcePosition < 0) return [];
    return state.receipts.filter((receipt, position) => position > sourcePosition &&
      ["receive", "accept", "assemble", "countPost", "returnRelease", "resolveHold"].includes(receipt.action) &&
      receipt.warehouseId === row.warehouseId && receipt.lines.some(line => line.itemId === row.itemId));
  };
  const receiptChoices = selected ? linkedReceipts(selected) : [];
  const currentSelected = selected ? (state.stockDiscrepancies ?? []).find(row => row.id === selected.id) : undefined;
  const resolvedElsewhere = !!selected && currentSelected?.status === "resolved";
  const beginResolve = (row: StockDiscrepancy) => {
    setSelected(row); setMethod("apply_stock"); setReason(""); setEvidence(""); setReceiptIds([]); setError("");
  };
  const resolve = async () => {
    if (!selected) return;
    if (resolvedElsewhere) {
      setError("This discrepancy has already been resolved elsewhere. Refresh the list before taking another action.");
      return;
    }
    const parsed = resolveStockDiscrepancySchema.safeParse({ id: selected.id, method, reason, evidence,
      receiptIds: method === "apply_stock" ? receiptIds : [] });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Review the resolution details."); return; }
    if (method === "apply_stock" && !receiptIds.length) { setError("Link the receipt that supports the stock debit."); return; }
    try {
      const confirmed = await onResolve(parsed.data);
      if (confirmed) setSelected(null);
      else setError("The resolution was not confirmed. The discrepancy remains open; refresh before retrying.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The resolution could not be confirmed.");
    }
  };
  const exportRows = async (format: "csv" | "xlsx" | "pdf") => {
    const columns = ["Reference", "Status", "Work order", "SKU", "Item", "Location", "Missing quantity", "Used quantity", "Available when recorded", "Serials", "Reported by", "Occurred at", "Method", "Resolved by", "Resolved at", "Reason", "Evidence", "Receipts"];
    const values = rows.map(row => [stockDiscrepancyLabel(state, row.id), row.status, orderText(row), row.itemSku, row.itemName, row.locationName, row.quantity, row.usedQuantity, row.recordedAvailable, row.serials.join(", "), inventoryActorLabel(row.actor, actors), dateLabel(row.occurredAt, timezone), row.method ?? "", row.resolvedBy ? inventoryActorLabel(row.resolvedBy, actors) : "", row.resolvedAt ? dateLabel(row.resolvedAt, timezone) : "", row.reason ?? "", row.evidence ?? "", (row.receiptIds ?? []).map(id => inventoryReceiptLabel(state.receipts, id)).join(", ")]);
    if (!values.length) return;
    if (format === "csv") {
      const blob = new Blob(["\uFEFF", [columns, ...values].map(line => line.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${projectName.replace(/[^a-z0-9_-]+/gi, "-")}-stock-discrepancies.csv`; anchor.click(); URL.revokeObjectURL(url); return;
    }
    if (format === "xlsx") {
      const XLSX = await import("xlsx"); const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([columns, ...values]), "Stock discrepancies");
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Project", projectName], ["Timezone", timezone], ["Scope", `${rows.length} matching records`]]), "Export details");
      XLSX.writeFile(book, `${projectName.replace(/[^a-z0-9_-]+/gi, "-")}-stock-discrepancies.xlsx`); return;
    }
    const popup = window.open("", "_blank");
    if (!popup) { setError("Allow pop-ups to open the print view."); return; }
    popup.opener = null;
    popup.document.write(`<!doctype html><html><head><title>${safeCell(projectName)} — Stock discrepancies</title><style>body{font:12px sans-serif;margin:24px;color:#25333b}h1{font-size:22px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #aeb9bb;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}button{padding:9px}@page{size:landscape;margin:12mm}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print / Save PDF</button><h1>Stock discrepancies</h1><p>${safeCell(projectName)} · ${rows.length} matching records · ${safeCell(timezone)}</p><table><thead><tr>${columns.map(cell => `<th>${safeCell(cell)}</th>`).join("")}</tr></thead><tbody>${values.map(line => `<tr>${line.map(cell => `<td>${safeCell(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`);
    popup.document.close();
  };
  return <section data-testid="stock-discrepancies" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pb-3">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">Stock discrepancies</h2><Badge variant={openCount ? "outline" : "secondary"}>{openCount} open</Badge></div>
      <p className="text-xs text-muted-foreground">Field-reported shortages awaiting warehouse review</p>
    </div>
    <ChangeoutReconciliationJobs projectId={projectId} state={state} canResolve={canResolve} projectName={projectName} timezone={timezone} onNavigate={onNavigate} />
    <InventoryMobileTools tab="stock-discrepancies">
      <div className="space-y-3 pb-1">
        <div className="flex flex-wrap gap-2" data-testid="stock-discrepancy-exports">
          <Button type="button" size="sm" variant="outline" disabled={!rows.length} onClick={() => void exportRows("csv")}><Download className="mr-1.5 h-4 w-4" />CSV</Button>
          <Button type="button" size="sm" variant="outline" disabled={!rows.length} onClick={() => void exportRows("xlsx")}><FileSpreadsheet className="mr-1.5 h-4 w-4" />Excel</Button>
          <Button type="button" size="sm" variant="outline" disabled={!rows.length} onClick={() => void exportRows("pdf")}><Printer className="mr-1.5 h-4 w-4" />Print / PDF</Button>
        </div>
        <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Only the pending shortage is in this queue</AlertTitle><AlertDescription>Actual use already debited available stock at completion. A resolution either applies this missing quantity from a matching posted receipt or records an explicit evidenced accounting adjustment for already-used stock without changing current stock. The adjustment is not proof that a PO or transfer exists. It never consumes the full work-order usage again.</AlertDescription></Alert>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search discrepancies" data-testid="stock-discrepancy-search" className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search item, location, work order or user" /></div>
          <Select value={status} onValueChange={value => setStatus(value as typeof status)}><SelectTrigger className="w-full sm:w-44" aria-label="Discrepancy status" data-testid="stock-discrepancy-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Open</SelectItem><SelectItem value="resolved">Resolved</SelectItem><SelectItem value="all">All statuses</SelectItem></SelectContent></Select>
        </div>
        <div className="flex flex-wrap gap-2 rounded-md border bg-muted/20 p-2" aria-label="Inventory correction workflows">
          <span className="self-center px-1 text-xs font-medium text-muted-foreground">Correct the source record:</span>
          <Button size="sm" variant="outline" onClick={() => onNavigate("orders")} data-testid="discrepancy-orders-link">Orders</Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate("items")} data-testid="discrepancy-items-link">Items / kit assembly</Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate("counts")} data-testid="discrepancy-counts-link">Cycle counts</Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate("locations")} data-testid="discrepancy-locations-link">Locations</Button>
          <span className="self-center text-xs text-muted-foreground">Fix receipt, transfer, assembly or count history before attributing the shortage.</span>
        </div>
      </div>
    </InventoryMobileTools>
    {!rows.length ? <div data-testid="stock-discrepancy-empty" className="rounded-lg border border-dashed bg-card px-5 py-10 text-center"><p className="font-medium">{(state.stockDiscrepancies ?? []).length ? "No discrepancies match this view" : "No stock shortages recorded"}</p><p className="mt-1 text-sm text-muted-foreground">{(state.stockDiscrepancies ?? []).length ? "Change the status or search terms to widen the results." : "When recorded actual use exceeds available stock, the missing portion appears here for warehouse review."}</p></div> :
      <div className="space-y-2">{rows.map(row => {
        const workOrderRoute = `/work-orders/${row.workOrderId}`;
        return <article key={row.id} data-testid={`stock-discrepancy-${row.id}`} className="rounded-md border bg-card px-3 py-3 sm:px-4">
          <div className="flex min-w-0 flex-col justify-between gap-3 md:flex-row md:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-semibold">{row.itemName}</h3><span className="break-all font-mono text-xs text-muted-foreground">{row.itemSku}</span><Badge variant={row.status === "open" ? "outline" : "secondary"}>{row.status}</Badge></div>
              <p className="mt-1 break-words text-xs text-muted-foreground">{stockDiscrepancyLabel(state, row.id)} · {row.locationName} · missing {row.quantity} · used {row.usedQuantity} · available when recorded {row.recordedAvailable}</p>
              <p className="mt-1 text-xs text-muted-foreground">Work order: <Link href={workOrderRoute} className="font-medium underline underline-offset-2" data-testid={`discrepancy-work-order-${row.id}`}>{orderText(row)}</Link> · Reported by {inventoryActorLabel(row.actor, actors)} · {dateLabel(row.occurredAt, timezone)} ({timezone})</p>
              {row.serials.length > 0 && <details className="mt-2 text-xs"><summary className="cursor-pointer font-medium">Installed serial identities · {row.serials.length}</summary><p className="mt-1 max-h-24 overflow-y-auto break-all font-mono text-muted-foreground">{row.serials.join(", ")}</p><p className="mt-1 text-muted-foreground">An installed serial cannot be received into available stock a second time. Investigate custody and attach supporting evidence.</p></details>}
              {(row.status === "resolved" || row.reason || row.evidence || row.sourceReceiptId || (row.receiptIds?.length ?? 0) > 0) && <details className="mt-2 border-t pt-2 text-xs" open={row.status === "resolved"}><summary className="cursor-pointer font-medium">Resolution and audit details</summary><div className="mt-2 space-y-1 text-muted-foreground">
                {row.sourceReceiptId && <p>Original usage: {inventoryReceiptLabel(state.receipts, row.sourceReceiptId)}{(() => { const source = state.receipts.find(receipt => receipt.id === row.sourceReceiptId); return source ? ` · ${source.action} · ${dateLabel(source.occurredAt, timezone)} (${timezone})` : " · source receipt unavailable"; })()}</p>}
                {row.status === "resolved" && <p>Resolved by {inventoryActorLabel(row.resolvedBy, actors)} · {row.resolvedAt ? dateLabel(row.resolvedAt, timezone) : "time unavailable"} ({timezone}) · {row.method === "apply_stock" ? "Apply matched receipt stock" : "Evidenced accounting adjustment"}</p>}
                {row.reason && <p className="break-words"><span className="font-medium text-foreground">Reason:</span> {row.reason}</p>}
                {row.evidence && <p className="break-words"><span className="font-medium text-foreground">Supporting reference:</span> {row.evidence}</p>}
                {(row.receiptIds ?? []).map(id => <p key={id}>Linked {inventoryReceiptLabel(state.receipts, id)}</p>)}
              </div></details>}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2"><Link href={workOrderRoute} className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent" data-testid={`discrepancy-open-work-order-${row.id}`}>Work order</Link>{row.status === "open" && canResolve && <Button size="sm" disabled={busy} onClick={() => beginResolve(row)} data-testid={`resolve-stock-discrepancy-${row.id}`}>Resolve</Button>}</div>
          </div>
        </article>;
      })}</div>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open && !busy) setSelected(null); }}>
      <DialogContent data-testid="stock-discrepancy-resolution-dialog" className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Resolve pending stock shortage</DialogTitle><DialogDescription>Choose the evidence-backed correction for this discrepancy. The server rechecks authority, status, receipt compatibility and current stock atomically.</DialogDescription></DialogHeader>
        {selected && <div className="space-y-3">
          {resolvedElsewhere && <Alert variant="destructive" data-testid="stock-discrepancy-resolved-elsewhere"><AlertTriangle className="h-4 w-4" /><AlertTitle>Already resolved elsewhere</AlertTitle><AlertDescription>Your reason, evidence and receipt selection remain in this form, but another session has resolved this discrepancy. No further debit can be submitted.</AlertDescription></Alert>}
          <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>{selected.itemName} · {selected.quantity} pending</AlertTitle><AlertDescription>{selected.locationName} · {orderText(selected)}. This pending quantity is separate from the actual-use debit already posted. Original usage: {inventoryReceiptLabel(state.receipts, selected.sourceReceiptId)}.</AlertDescription></Alert>
          <div className="space-y-1"><Label htmlFor="discrepancy-method">Resolution method</Label><Select value={method} onValueChange={value => { setMethod(value as ResolveInput["method"]); setReceiptIds([]); }}><SelectTrigger id="discrepancy-method" data-testid="discrepancy-method"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="apply_stock">Apply stock from a posted receipt</SelectItem><SelectItem value="documented_adjustment">Document evidenced accounting adjustment</SelectItem></SelectContent></Select></div>
          {method === "apply_stock" ? <div className="space-y-2 rounded-md border p-3 text-sm"><p className="font-medium">Receipt-backed pending debit</p><p className="text-xs text-muted-foreground">First post the missing receipt, transfer, assembly or count correction in its normal workflow. Then link its receipt below. It must be posted after the original usage receipt and contain this item at this location. Resolution debits only the shortage from current available stock; it does not consume full work-order usage a second time.</p>
            {!receiptChoices.length ? <p className="text-xs text-destructive">No matching later receipt choices are available. Post and refresh a supported receipt for this item and location before applying stock.</p> : <fieldset className="space-y-1"><legend className="text-xs font-medium">Matching later receipts (select at least one)</legend>{receiptChoices.map(receipt => <label key={receipt.id} className="flex min-w-0 items-start gap-2 rounded-sm px-1 py-1 text-sm"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" checked={receiptIds.includes(receipt.id)} onChange={event => setReceiptIds(current => event.target.checked ? [...current, receipt.id] : current.filter(id => id !== receipt.id))} /><span className="min-w-0 break-words">{inventoryReceiptLabel(state.receipts, receipt.id)} · {receiptActionLabel(receipt.action)} · {selected.itemSku} · {selected.locationName} · {dateLabel(receipt.occurredAt, timezone)} ({timezone})</span></label>)}</fieldset>}
          </div> : <Alert><ShieldCheck className="h-4 w-4" /><AlertTitle>Explicit evidenced accounting adjustment — no stock movement</AlertTitle><AlertDescription>An authorized reviewer attests to an evidenced accounting adjustment for stock already used. This is not proof that a PO or transfer exists, does not create available stock, and does not change physical stock. Unknown serialized items already installed must be investigated; they cannot be received into stock again.</AlertDescription></Alert>}
          <div className="space-y-1"><Label htmlFor="discrepancy-reason">Resolution reason <span className="text-muted-foreground">(at least 10 characters)</span></Label><Textarea id="discrepancy-reason" data-testid="discrepancy-resolution-reason" rows={3} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} placeholder="Describe what was checked and why this correction is appropriate" /></div>
          <div className="space-y-1"><Label htmlFor="discrepancy-evidence">Supporting document or investigation reference <span className="text-muted-foreground">(at least 3 characters)</span></Label><Input id="discrepancy-evidence" data-testid="discrepancy-resolution-evidence" maxLength={1000} value={evidence} onChange={event => setEvidence(event.target.value)} placeholder="Document number, case, transfer, count or investigation reference" /></div>
          {error && <p role="alert" data-testid="discrepancy-resolution-error" className="text-sm text-destructive">{error}</p>}
        </div>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button><Button type="button" data-testid="submit-stock-discrepancy-resolution" disabled={busy || !canResolve || resolvedElsewhere || (method === "apply_stock" && !receiptIds.length)} onClick={() => void resolve()}>{resolvedElsewhere ? "Already resolved" : busy ? "Resolving…" : "Record resolution"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
