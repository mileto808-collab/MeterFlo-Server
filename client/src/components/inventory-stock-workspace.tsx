import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Filter, ListOrdered, PackageCheck, RefreshCw, Search } from "lucide-react";
import { InventoryMobileTools } from "@/components/inventory-mobile-tools";
import type { StockBalanceRow } from "@/lib/inventory-stock-export";
import { downloadInventoryStock } from "@/lib/inventory-stock-export";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { collectStockExport, fetchStock, stockUrl, type StockPage } from "@/lib/inventory-stock-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { initialStockFilters as initialFilters, type InventoryStockFilters } from "@/lib/inventory-stock-search";
const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type InventoryStockWorkspaceProps = {
  base: string;
  projectName: string;
  timezone: string;
  onRefresh: () => void;
  onViewSerials: (row: StockBalanceRow) => void;
  canVerifyVendorKit?: boolean;
  onVerifyVendorKit?: () => void;
};

export function InventoryStockWorkspace({ base, projectName, timezone, onRefresh, onViewSerials, canVerifyVendorKit = false, onVerifyVendorKit }: InventoryStockWorkspaceProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<InventoryStockFilters>(initialFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [optionSearch, setOptionSearch] = useState("");
  const [resultsElement, setResultsElement] = useState<HTMLDivElement | null>(null);
  const containerWidthRef = useRef(0);
  const containerHeightRef = useRef(0);
  const capacityLockRef = useRef<number | null>(null);

  const params = { q: query, ...filters, offset: page * rowsPerPage, limit: rowsPerPage };
  const url = stockUrl(base, "", params);
  const stock = useQuery<StockPage>({ queryKey: [base, "stock", url], queryFn: ({ signal }) => fetchStock(url, signal) });
  const optionsUrl = stockUrl(base, "/options", { q: optionSearch });
  const options = useQuery<{ categories: string[]; warehouses: Array<{ id: string; name: string; code: string }> }>({
    queryKey: [base, "stock", optionsUrl], queryFn: ({ signal }) => fetchStock(optionsUrl, signal), enabled: filtersOpen,
  });
  const categories = options.data?.categories ?? [];
  const warehouses = options.data?.warehouses ?? [];
  const total = stock.data?.total ?? 0;
  const matchingCount = stock.data?.filtered ?? 0;
  const visibleRows = stock.data?.rows ?? [];
  const lastPage = Math.max(0, Math.ceil(matchingCount / rowsPerPage) - 1);
  const currentPage = stock.data ? Math.floor(stock.data.offset / rowsPerPage) : page;
  const pageCount = Math.max(1, Math.ceil(matchingCount / rowsPerPage));
  const exportCount = matchingCount;
  const activeFilterCount = Number(filters.warehouse !== "all") + Number(filters.category !== "all") +
    Number(filters.tracking !== "all") + Number(filters.availability !== "all") + Number(filters.sort !== "item-asc");

  useEffect(() => {
    capacityLockRef.current = null;
    resultsElement?.scrollTo({ top: 0 });
  }, [query, filters, resultsElement]);
  useEffect(() => {
    resultsElement?.scrollTo({ top: 0 });
  }, [page, resultsElement]);
  useEffect(() => {
    if (stock.data) setPage(current => Math.min(current, lastPage));
  }, [lastPage, stock.data]);

  useEffect(() => {
    const main = resultsElement?.closest("main");
    if (!main) return;
    const previousHeight = main.style.height;
    const fit = () => {
      const viewport = window.visualViewport;
      const available = Math.max(0, (viewport?.height ?? window.innerHeight) -
        Math.max(0, main.getBoundingClientRect().top - (viewport?.offsetTop ?? 0)));
      main.style.height = `${available}px`;
    };
    const observer = new ResizeObserver(fit);
    if (main.parentElement) observer.observe(main.parentElement);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
      main.style.height = previousHeight;
    };
  }, [resultsElement]);

  useEffect(() => {
    const container = resultsElement;
    if (!container) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // clientWidth changes when the vertical scrollbar appears; that is
        // content chrome, not a viewport reflow, and must not release a
        // capacity lock after an overshoot.
        const width = container.getBoundingClientRect().width;
        const height = container.clientHeight;
        const widthChanged = Math.abs(width - containerWidthRef.current) > 2;
        const heightChanged = Math.abs(height - containerHeightRef.current) > 2;
        if (widthChanged || heightChanged) capacityLockRef.current = null;
        containerWidthRef.current = width;
        containerHeightRef.current = height;
        if ((widthChanged || heightChanged) && currentPage > 0) {
          // Page boundaries are tied to the server limit. Reflow capacity
          // from page one after a real viewport change rather than changing
          // the limit under an in-progress page and shifting its offset.
          container.scrollTo({ top: 0 });
          setPage(0);
          return;
        }

        const mountedRows = [...container.querySelectorAll<HTMLElement>("[data-stock-row]")];
        const measured = mountedRows.map(row => {
          const rowHeight = row.getBoundingClientRect().height;
          return { row, rowHeight };
        }).filter(entry => entry.rowHeight > 0);

        // A query-size request can briefly remove the rows from the DOM. Wait
        // for the matching page rather than using an empty/stale-row fallback.
        if (!stock.data || !matchingCount || !measured.length || height <= 0) return;

        const contentOrigin = 8; // results scroller's vertical padding
        const usableBottom = height - 8;
        let fittedCount = 0;
        let fittedBottom = contentOrigin;
        const scrollTop = container.scrollTop;
        for (const { row } of measured) {
          const bottomInContent = row.getBoundingClientRect().bottom -
            container.getBoundingClientRect().top + scrollTop;
          if (bottomInContent > usableBottom) break;
          fittedCount += 1;
          fittedBottom = bottomInContent;
        }

        const offset = stock.data.offset;
        const requestedCount = Math.max(1, Math.min(100, rowsPerPage));
        const rowsExpectedOnPage = Math.min(requestedCount, Math.max(0, matchingCount - offset));
        const canFitEveryFetchedRow = fittedCount === measured.length &&
          measured.length >= rowsExpectedOnPage;

        if (!canFitEveryFetchedRow) {
          // A newly fetched tall row can invalidate a size inferred from its
          // shorter neighbours. Settle at the actual complete-row prefix and
          // hold that size until the viewport or data scope changes, avoiding
          // a 3 → 4 → 3 request loop. One row may scroll when it alone is too
          // tall for a short landscape viewport.
          const settled = Math.max(1, Math.min(requestedCount, fittedCount || 1));
          if (requestedCount > settled && currentPage === 0) {
            capacityLockRef.current = settled;
            setRowsPerPage(current => current === settled ? current : settled);
          } else if (fittedCount === 0 && currentPage === 0) {
            capacityLockRef.current = requestedCount;
          }
          return;
        }

        // Keep page boundaries fixed after leaving the first page. Changing a
        // server limit while page > 0 also changes `offset = page * limit`,
        // which would silently move records and make Previous land elsewhere.
        if (capacityLockRef.current !== null || currentPage !== 0) return;
        const remainingRecords = Math.max(0, matchingCount - offset);
        if (measured.length < rowsExpectedOnPage || remainingRecords <= requestedCount) return;

        const measuredHeights = measured.map(entry => entry.rowHeight);
        const nextRowProbe = Math.min(...measuredHeights) || 112;
        const remainingHeight = Math.max(0, usableBottom - fittedBottom);
        const additionalRows = Math.floor(remainingHeight / (nextRowProbe + 8));
        const next = Math.min(100, remainingRecords, requestedCount + additionalRows);
        if (next > requestedCount) setRowsPerPage(current => current === requestedCount ? next : current);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll("[data-stock-row]").forEach(row => observer.observe(row));
    window.addEventListener("resize", measure);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [resultsElement, visibleRows, currentPage, filtersOpen, rowsPerPage, stock.data, matchingCount]);

  const exportFile = async (format: "csv" | "xlsx" | "pdf") => {
    if (!exportCount || exporting || !stock.data) return;
    setExporting(true);
    const printWindow = format === "pdf" ? window.open("", "_blank") : null;
    try {
      if (format === "pdf" && !printWindow) throw new Error("Allow pop-ups to open the printable view.");
      if (printWindow) { printWindow.opener = null; printWindow.document.body.textContent = "Preparing stock export…"; }
      const rows = await collectStockExport(base, "", { q: query, ...filters }, "rows");
      await downloadInventoryStock(format, { project: projectName, timezone }, rows, printWindow ?? undefined);
    } catch (error) {
      printWindow?.close();
      toast({ title: `${format === "xlsx" ? "Excel" : format.toUpperCase()} export failed`, description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally { setExporting(false); }
  };

  const resetFilters = () => { setPage(0); setFilters(initialFilters); };
  const updateFilters: typeof setFilters = update => { setPage(0); setFilters(update); };
  const emptyDescription = total
    ? "Try another search or clear filters to see matching inventory."
    : "No balances have been recorded yet. Set up a warehouse or service vehicle, add catalog items, then receive a purchase or accept a transfer to establish on-hand stock.";

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="On hand by location">
      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Filter stock</DialogTitle>
            <DialogDescription>Refine stock balances by location, catalog category, tracking, and availability.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Find filter choices" placeholder="Find locations or categories (up to 200 choices)" value={optionSearch} onChange={event => setOptionSearch(event.target.value)} />
          {options.isError && <p role="alert">Filter choices could not be loaded. <Button variant="ghost" onClick={() => void options.refetch()}>Retry</Button></p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="stock-filter-warehouse">Warehouse or vehicle</Label>
              <select id="stock-filter-warehouse" className={selectClass} value={filters.warehouse} onChange={event => updateFilters(current => ({ ...current, warehouse: event.target.value }))}>
                <option value="all">All locations</option>
                {filters.warehouse !== "all" && !warehouses.some(w => w.id === filters.warehouse) && <option value={filters.warehouse}>Selected location</option>}
                {warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stock-filter-category">Category</Label>
              <select id="stock-filter-category" className={selectClass} value={filters.category} onChange={event => updateFilters(current => ({ ...current, category: event.target.value }))}>
                <option value="all">All categories</option>
                {filters.category !== "all" && !categories.includes(filters.category) && <option value={filters.category}>{filters.category}</option>}
                {categories.map(category => <option key={category} value={category}>{category}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stock-filter-tracking">Tracking</Label>
              <select id="stock-filter-tracking" className={selectClass} value={filters.tracking} onChange={event => updateFilters(current => ({ ...current, tracking: event.target.value }))}>
                <option value="all">All tracking types</option><option value="regular">Quantity tracked</option><option value="serialized">Serial tracked</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="stock-filter-availability">Availability</Label>
              <select id="stock-filter-availability" className={selectClass} value={filters.availability} onChange={event => updateFilters(current => ({ ...current, availability: event.target.value as InventoryStockFilters["availability"] }))}>
                <option value="all">All balances</option><option value="in-stock">In stock</option><option value="available">Available</option><option value="reserved">Reserved</option><option value="out-of-stock">Out of stock</option>
              </select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="stock-filter-sort">Sort balances</Label>
              <select id="stock-filter-sort" className={selectClass} value={filters.sort} onChange={event => updateFilters(current => ({ ...current, sort: event.target.value as InventoryStockFilters["sort"] }))}>
                <option value="item-asc">Item · ascending</option><option value="item-desc">Item · descending</option>
                <option value="location-asc">Location · ascending</option><option value="location-desc">Location · descending</option>
                <option value="available-asc">Available · ascending</option><option value="available-desc">Available · descending</option>
              </select>
            </div>
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">{matchingCount} matching {matchingCount === 1 ? "balance" : "balances"} of {total}</p>
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button variant="ghost" onClick={resetFilters}>Clear filters</Button>
            <Button onClick={() => setFiltersOpen(false)}>Show {matchingCount} {matchingCount === 1 ? "balance" : "balances"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <header id="inventory-stock-subheader" className="sticky top-0 z-10 shrink-0 border-b bg-background px-1 pb-2 sm:pb-3" data-testid="inventory-stock-subheader">
        <div className="flex min-h-8 items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight sm:text-lg">On hand by location</h2>
            <p className="hidden text-xs text-muted-foreground sm:block">Reserved units are excluded from available stock. Serial identity stays with its bin.</p>
          </div>
        </div>
        <InventoryMobileTools tab="stock">
          <div className="space-y-2 rounded-md border bg-card p-2 md:rounded-none md:border-0 md:bg-transparent md:p-0">
            <div className="flex items-center gap-1.5">
              <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="Refresh stock" title="Refresh stock" onClick={() => { void queryClient.invalidateQueries({ queryKey: [base, "stock"] }); onRefresh(); }}><RefreshCw className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Refresh</span></Button>
              {canVerifyVendorKit && <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="Inspect vendor kit" title="Inspect vendor kit" onClick={onVerifyVendorKit}><PackageCheck className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Vendor kit</span></Button>}
              <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="CSV" title="CSV" disabled={!exportCount || exporting || !stock.data} onClick={() => void exportFile("csv")}><Download className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">CSV</span></Button>
              <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="Excel" title="Excel" disabled={!exportCount || exporting || !stock.data} onClick={() => void exportFile("xlsx")}><FileSpreadsheet className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Excel</span></Button>
              <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="PDF / Print" title="PDF / Print" disabled={!exportCount || exporting || !stock.data} onClick={() => void exportFile("pdf")}><FileText className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">PDF / Print</span></Button>
              <p className="ml-auto whitespace-nowrap text-xs text-muted-foreground" aria-live="polite">{matchingCount} {matchingCount === 1 ? "balance" : "balances"}</p>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="Search inventory" className="h-9 pl-9" type="search" autoComplete="off" placeholder="SKU, meter, location or serial number"
                  value={query} onChange={event => { setPage(0); setQuery(event.target.value); }} />
              </div>
              <Button size="sm" variant="outline" aria-label="Filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}>
                <Filter className="mr-1.5 h-4 w-4" />Filters{activeFilterCount > 0 && <Badge variant="secondary" className="ml-1">{activeFilterCount}</Badge>}
              </Button>
            </div>
          </div>
        </InventoryMobileTools>
      </header>

      <div id="inventory-stock-results" ref={setResultsElement} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2" data-testid="inventory-stock-results" data-page-size={rowsPerPage}
        role="region" aria-label="Stock balances" tabIndex={0}>
        {stock.isError ? <div role="alert">Stock could not be loaded. <Button onClick={() => void stock.refetch()}>Retry</Button></div> : stock.isLoading ? <p role="status">Loading stock…</p> : visibleRows.length ? <div className="space-y-2">
          {visibleRows.map(row => {
            const available = row.quantity - row.reserved;
            return <article key={`${row.warehouseId}/${row.itemId}`} data-stock-row data-stock-key={`${row.warehouseId}/${row.itemId}`} className="inventory-stock-card min-w-0 rounded-md border bg-card px-2.5 py-2 sm:px-4 sm:py-3">
              <div className="inventory-stock-card-layout grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
                <div className="inventory-stock-item min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="break-words font-medium">{row.item.name}</h3>
                    {row.item.tracking === "serialized" && <Badge variant="outline" className="inventory-stock-serial-badge">Serial tracked</Badge>}
                  </div>
                  <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">{row.item.sku}</p>
                  {row.item.category && <p className="inventory-stock-category mt-1 break-words text-xs text-muted-foreground">{row.item.category}</p>}
                </div>
                <div className="inventory-stock-location min-w-0 sm:border-l sm:pl-4">
                  <p className="break-words text-sm">{row.warehouse.name}</p>
                  <p className="break-all font-mono text-xs text-muted-foreground">{row.warehouse.code}</p>
                  {(row.serialCount ?? row.serials.length) > 0 && <div className="inventory-stock-serial-action-mobile">
                    <Button className="h-11 w-11 p-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" size="icon" variant="outline"
                      aria-label={`View serials (${row.serialCount ?? row.serials.length}) for ${row.item.sku} at ${row.warehouse.code}`}
                      title={`View serials (${row.serialCount ?? row.serials.length})`} onClick={() => onViewSerials(row)}>
                      <ListOrdered aria-hidden="true" className="h-4 w-4" />
                    </Button>
                  </div>}
                </div>
                <div className="inventory-stock-quantity min-w-0">
                  <div className="inventory-stock-quantity-values grid grid-cols-3 gap-2 border-t pt-2 text-left sm:min-w-48 sm:border-0 sm:pt-0">
                    <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">On hand</p><p className="font-mono tabular-nums">{row.quantity}</p></div>
                    <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Reserved</p><p className="font-mono tabular-nums">{row.reserved}</p></div>
                    <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Available</p><p className="font-mono font-semibold tabular-nums">{available}</p></div>
                  </div>
                  {(row.serialCount ?? row.serials.length) > 0 && <div className="inventory-stock-serial-action inventory-stock-serial-action-legacy mt-2 border-t pt-2 sm:mt-3">
                    <Button size="sm" variant="outline" aria-label={`View serials (${row.serialCount ?? row.serials.length}) for ${row.item.sku} at ${row.warehouse.code}`}
                      title={`View serials (${row.serialCount ?? row.serials.length})`} onClick={() => onViewSerials(row)}>
                      View serials ({row.serialCount ?? row.serials.length})
                    </Button>
                  </div>}
                </div>
              </div>
            </article>;
          })}
        </div> : <div className="grid min-h-40 place-items-center rounded-md border border-dashed bg-muted/15 px-4 py-8 text-center" role="status">
          <div className="max-w-md"><p className="font-medium">{total ? "No matching stock balances" : "No stock balances yet"}</p><p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p>
            {total > 0 && (query || activeFilterCount > 0) && <Button className="mt-3" size="sm" variant="outline" onClick={() => { setQuery(""); resetFilters(); }}>Clear search and filters</Button>}
          </div>
        </div>}
      </div>
      <nav id="inventory-stock-pagination" className="flex shrink-0 flex-wrap items-center gap-2 border-t px-1 py-2" data-testid="inventory-stock-pagination" aria-label="Stock pages">
        <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">{matchingCount ? `${currentPage * rowsPerPage + 1}–${Math.min(matchingCount, (currentPage + 1) * rowsPerPage)} of ${matchingCount} balances` : "0 balances"}</p>
        <Button size="sm" variant="outline" aria-label="Previous stock page" disabled={!stock.data || currentPage === 0} onClick={() => { setPage(Math.max(0, currentPage - 1)); resultsElement?.scrollTo({ top: 0 }); }}>Previous</Button>
        <span className="min-w-16 text-center text-xs tabular-nums">Page {currentPage + 1} / {pageCount}</span>
        <Button size="sm" variant="outline" aria-label="Next stock page" disabled={!stock.data || currentPage >= pageCount - 1} onClick={() => { setPage(currentPage + 1); resultsElement?.scrollTo({ top: 0 }); }}>Next</Button>
      </nav>
    </section>
  );
}
