import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, FileSpreadsheet, FileText, Filter, RefreshCw, Search } from "lucide-react";
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
};
const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const nouns: Record<OperationsKind, string> = { locations: "locations", exceptions: "exceptions", returns: "returns", activity: "activity" };

export function InventoryRecordsWorkspace({ kind, title, description, dataset, projectName, timezone, onRefresh, renderRow, headerAction }: Props) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [sort, setSort] = useState(dataset.defaultSort);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(1);
  const [resultsElement, setResultsElement] = useState<HTMLDivElement | null>(null);
  const rowHeightRef = useRef(0);
  const containerWidthRef = useRef(0);
  const matchingRows = useMemo(() => filterOperationsRows(dataset, query, selected, sort), [dataset, query, selected, sort]);
  const activeFilterCount = dataset.filters.reduce((count, filter) => count + Number(!!selected[filter.key] && selected[filter.key] !== "all"), 0) +
    Number(sort !== dataset.defaultSort);
  const lastPage = Math.max(0, Math.ceil(matchingRows.length / rowsPerPage) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageCount = Math.max(1, Math.ceil(matchingRows.length / rowsPerPage));
  const visibleRows = matchingRows.slice(currentPage * rowsPerPage, (currentPage + 1) * rowsPerPage);
  useEffect(() => { setPage(0); rowHeightRef.current = 0; }, [kind, query, selected, sort, dataset]);
  useEffect(() => { setPage(current => Math.min(current, lastPage)); }, [lastPage]);
  useEffect(() => {
    const main = resultsElement?.closest("main");
    if (!main) return;
    const previousHeight = main.style.height;
    const fit = () => { main.style.height = `${Math.max(0, window.innerHeight - Math.max(0, main.getBoundingClientRect().top))}px`; };
    const observer = new ResizeObserver(fit);
    if (main.parentElement) observer.observe(main.parentElement);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    fit();
    return () => {
      observer.disconnect(); window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit); main.style.height = previousHeight;
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
        if (containerWidthRef.current && Math.abs(width - containerWidthRef.current) > 2) rowHeightRef.current = 0;
        containerWidthRef.current = width;
        const rows = [...container.querySelectorAll<HTMLElement>("[data-operations-row]")];
        const height = rows.reduce((maximum, row) => Math.max(maximum, row.getBoundingClientRect().height), 0);
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
  const reset = () => { setSelected({}); setSort(dataset.defaultSort); };
  const exportFile = async (format: "csv" | "xlsx" | "pdf") => {
    try { await downloadInventoryOperations(format, { project: projectName, timezone }, kind, dataset, matchingRows); }
    catch (error) { toast({ title: `${format === "xlsx" ? "Excel" : format.toUpperCase()} export failed`, description: error instanceof Error ? error.message : "Try again.", variant: "destructive" }); }
  };
  const placeholder: Record<OperationsKind, string> = {
    locations: "Name, code, address or assigned crew",
    exceptions: "Order, item, serial or location",
    returns: "Serial, equipment, work order or location",
    activity: "Receipt, movement, actor, order or serial",
  };
  return <section className="flex min-h-0 flex-1 flex-col" aria-label={title}>
    <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Filter {nouns[kind]}</DialogTitle><DialogDescription>Refine the matching records. Exports include every result, not only this page.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          {dataset.filters.map(filter => <div className="space-y-2" key={filter.key}>
            <Label htmlFor={`operations-${kind}-${filter.key}`}>{filter.label}</Label>
            <select id={`operations-${kind}-${filter.key}`} className={selectClass} value={selected[filter.key] ?? "all"} onChange={event => setSelected(current => ({ ...current, [filter.key]: event.target.value }))}>
              <option value="all">All {filter.label.toLocaleLowerCase()}</option>{filter.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>)}
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
    <header className="sticky top-0 z-10 shrink-0 border-b bg-background px-1 pb-3" data-testid={`inventory-${kind}-subheader`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold tracking-tight">{title}</h2>{headerAction}</div><p className="hidden text-xs text-muted-foreground sm:block">{description}</p></div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="outline" aria-label={`Refresh ${nouns[kind]}`} onClick={onRefresh}><RefreshCw className="mr-1.5 hidden h-4 w-4 sm:block" />Refresh</Button>
          <Button size="sm" variant="outline" aria-label="CSV" disabled={!matchingRows.length} onClick={() => void exportFile("csv")}><Download className="mr-1.5 hidden h-4 w-4 sm:block" />CSV</Button>
          <Button size="sm" variant="outline" aria-label="Excel" disabled={!matchingRows.length} onClick={() => void exportFile("xlsx")}><FileSpreadsheet className="mr-1.5 hidden h-4 w-4 sm:block" />Excel</Button>
          <Button size="sm" variant="outline" aria-label="PDF / Print" disabled={!matchingRows.length} onClick={() => void exportFile("pdf")}><FileText className="mr-1.5 hidden h-4 w-4 sm:block" />PDF / Print</Button>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:min-w-64"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label={`Search ${nouns[kind]}`} className="h-9 pl-9" type="search" autoComplete="off" placeholder={placeholder[kind]} value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <Button size="sm" variant="outline" aria-label={`Filter ${nouns[kind]}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}><Filter className="mr-1.5 h-4 w-4" />Filters{activeFilterCount > 0 && <Badge variant="secondary" className="ml-1">{activeFilterCount}</Badge>}</Button>
        <p className="hidden text-xs text-muted-foreground sm:block" aria-live="polite">{matchingRows.length} {nouns[kind]}</p>
      </div>
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
