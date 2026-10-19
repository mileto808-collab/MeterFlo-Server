import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, FileSpreadsheet, FileText, Filter, RefreshCw, Search } from "lucide-react";
import { InventoryMobileTools } from "@/components/inventory-mobile-tools";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { filterOperationsRows, type OperationsDataset, type OperationsKind, type OperationsRow } from "@/lib/inventory-operations-data";
import { downloadInventoryOperations } from "@/lib/inventory-operations-export";

type Props = {
  kind: OperationsKind;
  title: string;
  description: string;
  dataset: OperationsDataset;
  projectName: string;
  timezone: string;
  onRefresh: () => void;
  renderRow: (row: OperationsRow) => ReactNode;
  headerAction?: ReactNode;
  persistentHeaderAction?: ReactNode;
};
const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const nouns: Record<OperationsKind, string> = { locations: "locations", exceptions: "exceptions", returns: "returns", activity: "activity", categories: "categories", counts: "counts" };

export function InventoryRecordsWorkspace({ kind, title, description, dataset, projectName, timezone, onRefresh, renderRow, headerAction, persistentHeaderAction }: Props) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [sort, setSort] = useState(dataset.defaultSort);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const invalidDateRange = !!from && !!to && from > to;
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(1);
  const [resultsElement, setResultsElement] = useState<HTMLDivElement | null>(null);
  const rowHeightRef = useRef(0);
  const containerWidthRef = useRef(0);
  const containerHeightRef = useRef(0);
  const matchingRows = useMemo(() => filterOperationsRows(dataset, query, selected, sort, { from, to, timezone }),
    [dataset, query, selected, sort, from, to, timezone]);
  const activeFilterCount = dataset.filters.reduce((count, filter) => count + Number(!!selected[filter.key] && selected[filter.key] !== "all"), 0) +
    Number(sort !== dataset.defaultSort) + Number(!!from) + Number(!!to) +
    (dataset.searchFilters ?? []).filter(filter => selected[filter.key]?.trim()).length;
  const lastPage = Math.max(0, Math.ceil(matchingRows.length / rowsPerPage) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageCount = Math.max(1, Math.ceil(matchingRows.length / rowsPerPage));
  const visibleRows = matchingRows.slice(currentPage * rowsPerPage, (currentPage + 1) * rowsPerPage);
  useEffect(() => { setPage(0); rowHeightRef.current = 0; }, [kind, query, selected, sort, dataset, from, to]);
  useEffect(() => { setPage(current => Math.min(current, lastPage)); }, [lastPage]);
  useEffect(() => {
    const main = resultsElement?.closest("main");
    if (!main) return;
    const previousHeight = main.style.height;
    const fit = () => {
      const viewport = window.visualViewport;
      main.style.height = `${Math.max(0, (viewport?.height ?? window.innerHeight) -
        Math.max(0, main.getBoundingClientRect().top - (viewport?.offsetTop ?? 0)))}px`;
    };
    const observer = new ResizeObserver(fit);
    if (main.parentElement) observer.observe(main.parentElement);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    fit();
    return () => {
      observer.disconnect(); window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit); main.style.height = previousHeight;
    };
  }, [resultsElement]);
  useEffect(() => {
    const container = resultsElement;
    if (!container) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = container.clientWidth;
        if (Math.abs(width - containerWidthRef.current) > 2 ||
            Math.abs(container.clientHeight - containerHeightRef.current) > 2) rowHeightRef.current = 0;
        containerWidthRef.current = width;
        containerHeightRef.current = container.clientHeight;
        const rows = [...container.querySelectorAll<HTMLElement>("[data-operations-row]")];
        const height = rows.reduce((maximum, row) => {
          // Expanded evidence stays scrollable without permanently reducing page capacity.
          const expanded = [...row.querySelectorAll<HTMLDetailsElement>("details[open]")]
            .filter(detail => !detail.parentElement?.closest("details[open]"))
            .reduce((total, detail) => total + Math.max(0, detail.getBoundingClientRect().height -
              (detail.querySelector("summary")?.getBoundingClientRect().height ?? 0)), 0);
          return Math.max(maximum, row.getBoundingClientRect().height - expanded);
        }, 0);
        if (height > 0) rowHeightRef.current = Math.max(rowHeightRef.current, height);
        const next = Math.max(1, Math.min(100, Math.floor((container.clientHeight - 8) / ((rowHeightRef.current || 112) + 8))));
        setRowsPerPage(current => current === next ? current : next);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll("[data-operations-row]").forEach(row => observer.observe(row));
    window.addEventListener("resize", measure); measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [resultsElement, matchingRows, currentPage, filtersOpen, rowsPerPage]);
  const reset = () => { setSelected({}); setSort(dataset.defaultSort); setFrom(""); setTo(""); };
  const exportFile = async (format: "csv" | "xlsx" | "pdf") => {
    try { await downloadInventoryOperations(format, { project: projectName, timezone }, kind, dataset, matchingRows); }
    catch (error) { toast({ title: `${format === "xlsx" ? "Excel" : format.toUpperCase()} export failed`, description: error instanceof Error ? error.message : "Try again.", variant: "destructive" }); }
  };
  const placeholder: Record<OperationsKind, string> = {
    locations: "Name, code, address or assigned crew",
    exceptions: "Order, item, serial or location",
    returns: "Serial, equipment, work order or location",
    activity: "Receipt, movement, actor, order or serial",
    categories: "Category name or item usage",
    counts: "Count reference, location, status or reason",
  };
  return <section className="flex min-h-0 flex-1 flex-col" aria-label={title}>
    <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Filter {nouns[kind]}</DialogTitle><DialogDescription>Refine the matching records. Exports include every result, not only this page.
          {(kind === "returns" || kind === "activity") && " Disposition filters use current project names; history keeps the names recorded at the time."}
        </DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {(dataset.searchFilters ?? []).map(filter => <div className="space-y-2" key={filter.key}>
            <Label htmlFor={`operations-${kind}-${filter.key}`}>{filter.label}</Label>
            <Input id={`operations-${kind}-${filter.key}`} type="search" autoComplete="off"
              placeholder={`Enter ${filter.label.toLocaleLowerCase()}`} value={selected[filter.key] ?? ""}
              onChange={event => setSelected(current => ({ ...current, [filter.key]: event.target.value }))} />
          </div>)}
          {dataset.filters.map(filter => <div className="space-y-2" key={filter.key}>
            <Label htmlFor={`operations-${kind}-${filter.key}`}>{filter.label}</Label>
            <select id={`operations-${kind}-${filter.key}`} className={selectClass} value={selected[filter.key] ?? "all"} onChange={event => setSelected(current => ({ ...current, [filter.key]: event.target.value }))}>
              <option value="all">All {filter.label.toLocaleLowerCase()}</option>{filter.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>)}
          {dataset.dateFilterLabel && <>
            <div className="space-y-2"><Label htmlFor={`operations-${kind}-from`}>From date</Label>
              <Input id={`operations-${kind}-from`} type="date" value={from} max={to || undefined} aria-invalid={invalidDateRange}
                aria-describedby={`operations-${kind}-date-help`} onChange={event => setFrom(event.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor={`operations-${kind}-to`}>To date</Label>
              <Input id={`operations-${kind}-to`} type="date" value={to} min={from || undefined} aria-invalid={invalidDateRange}
                aria-describedby={`operations-${kind}-date-help`} onChange={event => setTo(event.target.value)} /></div>
            <p id={`operations-${kind}-date-help`} className="text-xs text-muted-foreground sm:col-span-2">
              {dataset.dateFilterLabel} · {timezone}. Both dates are inclusive. A record matches if any recorded event falls within the range.
              Records without a recorded date are excluded while a date range is active.</p>
            {invalidDateRange && <p role="alert" className="text-sm text-destructive sm:col-span-2">From date must be on or before the to date.</p>}
          </>}
          <div className="space-y-2 sm:col-span-2"><Label htmlFor={`operations-${kind}-sort`}>Sort by</Label>
            <select id={`operations-${kind}-sort`} className={selectClass} value={sort} onChange={event => setSort(event.target.value)}>
              {dataset.sorts.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </div>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">{matchingRows.length} matching {nouns[kind]} of {dataset.rows.length}</p>
        <DialogFooter className="flex-row justify-between sm:justify-between"><Button variant="ghost" onClick={reset}>Clear filters</Button><Button onClick={() => setFiltersOpen(false)}>Show {matchingRows.length} {nouns[kind]}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <header className="sticky top-0 z-10 shrink-0 border-b bg-background px-1 pb-2 sm:pb-3" data-testid={`inventory-${kind}-subheader`}>
      <div className="flex min-h-8 items-center justify-between gap-2">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold tracking-tight sm:text-lg">{title}</h2></div><p className="hidden text-xs text-muted-foreground sm:block">{description}</p></div>
        {persistentHeaderAction}
      </div>
      <InventoryMobileTools tab={kind}>
        <div className="space-y-2 rounded-md border bg-card p-2 md:rounded-none md:border-0 md:bg-transparent md:p-0">
          <div className="flex flex-wrap items-center gap-1.5" data-testid={`inventory-${kind}-action-toolbar`}>
            {headerAction}
            <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label={`Refresh ${nouns[kind]}`} title={`Refresh ${nouns[kind]}`} onClick={onRefresh}><RefreshCw className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Refresh</span></Button>
            <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="CSV" title="CSV" disabled={!matchingRows.length} onClick={() => void exportFile("csv")}><Download className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">CSV</span></Button>
            <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="Excel" title="Excel" disabled={!matchingRows.length} onClick={() => void exportFile("xlsx")}><FileSpreadsheet className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Excel</span></Button>
            <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="PDF / Print" title="PDF / Print" disabled={!matchingRows.length} onClick={() => void exportFile("pdf")}><FileText className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">PDF / Print</span></Button>
            <p className="ml-auto basis-full shrink-0 text-right text-xs text-muted-foreground sm:basis-auto" aria-live="polite">{matchingRows.length} {nouns[kind]}</p>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="relative min-w-0 flex-1"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input aria-label={`Search ${nouns[kind]}`} className="h-9 pl-9" type="search" autoComplete="off" placeholder={placeholder[kind]} value={query} onChange={event => setQuery(event.target.value)} />
            </div>
            <Button size="sm" variant="outline" aria-label={`Filter ${nouns[kind]}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}><Filter className="mr-1.5 h-4 w-4" />Filters{activeFilterCount > 0 && <Badge variant="secondary" className="ml-1">{activeFilterCount}</Badge>}</Button>
          </div>
        </div>
      </InventoryMobileTools>
    </header>
    <div ref={setResultsElement} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2" data-testid={`inventory-${kind}-results`} data-page-size={rowsPerPage} role="region" aria-label={title} tabIndex={0}>
      {visibleRows.length ? <div className="space-y-2">{visibleRows.map(row => <div key={row.id} data-operations-row>{renderRow(row)}</div>)}</div> :
        <div className="grid min-h-40 place-items-center rounded-md border border-dashed bg-muted/15 px-4 py-8 text-center" role="status"><div className="max-w-md">
          <p className="font-medium">{dataset.rows.length ? `No matching ${nouns[kind]}` : `No ${nouns[kind]} recorded`}</p>
          <p className="mt-1 text-sm text-muted-foreground">{dataset.rows.length ? "Try another search or clear filters to see matching records." : description}</p>
          {dataset.rows.length > 0 && (query || activeFilterCount > 0) && <Button className="mt-3" size="sm" variant="outline" onClick={() => { setQuery(""); reset(); }}>Clear search and filters</Button>}
        </div></div>}
    </div>
    <nav className="flex shrink-0 flex-wrap items-center gap-2 border-t px-1 py-2" data-testid={`inventory-${kind}-pagination`} aria-label={`${title} pages`}>
      <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">{matchingRows.length ? `${currentPage * rowsPerPage + 1}–${Math.min(matchingRows.length, (currentPage + 1) * rowsPerPage)} of ${matchingRows.length} ${nouns[kind]}` : `0 ${nouns[kind]}`}</p>
      <Button size="sm" variant="outline" aria-label={`Previous ${nouns[kind]} page`} disabled={currentPage === 0} onClick={() => { setPage(Math.max(0, currentPage - 1)); resultsElement?.scrollTo({ top: 0 }); }}>Previous</Button>
      <span className="min-w-16 text-center text-xs tabular-nums">Page {currentPage + 1} / {pageCount}</span>
      <Button size="sm" variant="outline" aria-label={`Next ${nouns[kind]} page`} disabled={currentPage >= pageCount - 1} onClick={() => { setPage(currentPage + 1); resultsElement?.scrollTo({ top: 0 }); }}>Next</Button>
    </nav>
  </section>;
}
