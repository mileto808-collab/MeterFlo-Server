import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Eye, FileSpreadsheet, FileText, Filter, PackageCheck, PackageMinus, Plus, RefreshCw, Search } from "lucide-react";
import { InventoryMobileTools } from "@/components/inventory-mobile-tools";
import type { InventoryItem, Vendor } from "@shared/inventory";
import { downloadInventoryCatalog } from "@/lib/inventory-catalog-export";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type CatalogKind = "items" | "vendors";
type Props = {
  kind: CatalogKind;
  items: InventoryItem[];
  vendors: Vendor[];
  projectName: string;
  timezone: string;
  canMaintain: boolean;
  canAssemble?: boolean;
  canInspectKits?: boolean;
  onRefresh: () => void;
  onAdd: () => void;
  onAssemble?: () => void;
  onDisassemble?: () => void;
  onInspectKits?: () => void;
  onEditItem: (item: InventoryItem) => void;
  onCopyItem?: (item: InventoryItem) => void;
  onEditVendor: (vendor: Vendor) => void;
};

type ItemFilters = { status: "all" | "active" | "inactive"; category: string; tracking: "all" | "regular" | "serialized"; equipment: "all" | "none" | "system" | "module"; vendor: string; kit: "all" | "kit" | "standalone"; sort: "name-asc" | "name-desc" | "sku-asc" | "category-asc" };
type VendorFilters = { status: "all" | "active" | "inactive"; contact: "all" | "available" | "missing"; sort: "name-asc" | "name-desc" };
const initialItemFilters: ItemFilters = { status: "all", category: "all", tracking: "all", equipment: "all", vendor: "all", kit: "all", sort: "name-asc" };
const initialVendorFilters: VendorFilters = { status: "all", contact: "all", sort: "name-asc" };
const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const sameOriginImage = (value: string) => {
  try { return new URL(value, window.location.origin).origin === window.location.origin ? value : null; }
  catch { return null; }
};

export function InventoryCatalogWorkspace({ kind, items, vendors, projectName, timezone, canMaintain, canAssemble = false, canInspectKits = false, onRefresh, onAdd, onAssemble, onDisassemble, onInspectKits, onEditItem, onCopyItem, onEditVendor }: Props) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [itemFilters, setItemFilters] = useState<ItemFilters>(initialItemFilters);
  const [vendorFilters, setVendorFilters] = useState<VendorFilters>(initialVendorFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(1);
  const [resultsElement, setResultsElement] = useState<HTMLDivElement | null>(null);
  const rowHeightRef = useRef(0);
  const containerWidthRef = useRef(0);
  const containerHeightRef = useRef(0);
  const isItems = kind === "items";
  const categories = useMemo(() => [...new Set(items.map(item => item.category.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [items]);
  const matchingItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = items.filter(item => {
      const vendorName = vendors.find(vendor => vendor.id === item.vendorId)?.name ?? "";
      const haystack = [item.name, item.sku, item.description, item.category, item.unit, item.tracking, item.equipment, item.barcode, item.manufacturer, item.model, vendorName].join(" ").toLocaleLowerCase();
      return (!needle || haystack.includes(needle)) &&
        (itemFilters.status === "all" || (itemFilters.status === "active") === item.active) &&
        (itemFilters.category === "all" || item.category.trim() === itemFilters.category) &&
        (itemFilters.tracking === "all" || item.tracking === itemFilters.tracking) &&
        (itemFilters.equipment === "all" || item.equipment === itemFilters.equipment) &&
        (itemFilters.vendor === "all" || item.vendorId === itemFilters.vendor) &&
        (itemFilters.kit === "all" || (itemFilters.kit === "kit") === (item.components.length > 0));
    });
    return filtered.sort((a, b) => itemFilters.sort === "name-desc" ? b.name.localeCompare(a.name) :
      itemFilters.sort === "sku-asc" ? a.sku.localeCompare(b.sku) :
      itemFilters.sort === "category-asc" ? a.category.localeCompare(b.category) || a.name.localeCompare(b.name) : a.name.localeCompare(b.name));
  }, [items, vendors, query, itemFilters]);
  const matchingVendors = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return vendors.filter(vendor => {
      const haystack = [vendor.name, vendor.contact, vendor.address, vendor.phone, vendor.email, vendor.reference].join(" ").toLocaleLowerCase();
      const hasContact = !!(vendor.contact.trim() || vendor.phone.trim() || vendor.email.trim());
      return (!needle || haystack.includes(needle)) &&
        (vendorFilters.status === "all" || (vendorFilters.status === "active") === vendor.active) &&
        (vendorFilters.contact === "all" || (vendorFilters.contact === "available") === hasContact);
    }).sort((a, b) => vendorFilters.sort === "name-desc" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name));
  }, [vendors, query, vendorFilters]);
  const matchingRows = isItems ? matchingItems : matchingVendors;
  const sourceCount = isItems ? items.length : vendors.length;
  const itemFilterCount = Number(itemFilters.status !== "all") + Number(itemFilters.category !== "all") +
    Number(itemFilters.tracking !== "all") + Number(itemFilters.equipment !== "all") + Number(itemFilters.vendor !== "all") +
    Number(itemFilters.kit !== "all") + Number(itemFilters.sort !== "name-asc");
  const vendorFilterCount = Number(vendorFilters.status !== "all") + Number(vendorFilters.contact !== "all") + Number(vendorFilters.sort !== "name-asc");
  const activeFilterCount = isItems ? itemFilterCount : vendorFilterCount;
  const lastPage = Math.max(0, Math.ceil(matchingRows.length / rowsPerPage) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageCount = Math.max(1, Math.ceil(matchingRows.length / rowsPerPage));
  const visibleRows = matchingRows.slice(currentPage * rowsPerPage, (currentPage + 1) * rowsPerPage);

  useEffect(() => { setPage(0); rowHeightRef.current = 0; }, [kind, query, itemFilters, vendorFilters, items, vendors]);
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
        const width = container.clientWidth;
        if (Math.abs(width - containerWidthRef.current) > 2 ||
            Math.abs(container.clientHeight - containerHeightRef.current) > 2) rowHeightRef.current = 0;
        containerWidthRef.current = width;
        containerHeightRef.current = container.clientHeight;
        const mountedRows = [...container.querySelectorAll<HTMLElement>("[data-catalog-row]")];
        const height = mountedRows.reduce((maximum, row) => Math.max(maximum, row.getBoundingClientRect().height), 0);
        if (height > 0) rowHeightRef.current = Math.max(rowHeightRef.current, height);
        const next = Math.max(1, Math.min(100, Math.floor((container.clientHeight - 8) / ((rowHeightRef.current || 112) + 8))));
        setRowsPerPage(current => current === next ? current : next);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll("[data-catalog-row]").forEach(row => observer.observe(row));
    window.addEventListener("resize", measure);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [resultsElement, matchingRows, currentPage, filtersOpen, rowsPerPage]);

  const resetFilters = () => { setItemFilters(initialItemFilters); setVendorFilters(initialVendorFilters); };
  const exportFile = async (format: "csv" | "xlsx" | "pdf") => {
    try {
      await downloadInventoryCatalog(format, { project: projectName, timezone }, kind, matchingRows as (InventoryItem | Vendor)[], vendors);
    } catch (error) {
      toast({ title: `${format === "xlsx" ? "Excel" : format.toUpperCase()} export failed`, description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    }
  };

  return <section className="flex min-h-0 flex-1 flex-col" aria-label={isItems ? "Items catalog" : "Vendors"}>
    <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Filter {isItems ? "items" : "vendors"}</DialogTitle><DialogDescription>{isItems ? "Refine the project catalog by status, category, tracking, equipment, vendor, and kit recipe." : "Refine project vendors by status and contact availability."}</DialogDescription></DialogHeader>
        {isItems ? <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="catalog-item-status">Status</Label><select id="catalog-item-status" className={selectClass} value={itemFilters.status} onChange={event => setItemFilters(value => ({ ...value, status: event.target.value as ItemFilters["status"] }))}><option value="all">All items</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          <div className="space-y-2"><Label htmlFor="catalog-item-category">Category</Label><select id="catalog-item-category" className={selectClass} value={itemFilters.category} onChange={event => setItemFilters(value => ({ ...value, category: event.target.value }))}><option value="all">All categories</option>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="catalog-item-tracking">Tracking</Label><select id="catalog-item-tracking" className={selectClass} value={itemFilters.tracking} onChange={event => setItemFilters(value => ({ ...value, tracking: event.target.value as ItemFilters["tracking"] }))}><option value="all">All tracking types</option><option value="regular">Quantity tracked</option><option value="serialized">Serial tracked</option></select></div>
          <div className="space-y-2"><Label htmlFor="catalog-item-equipment">Equipment</Label><select id="catalog-item-equipment" className={selectClass} value={itemFilters.equipment} onChange={event => setItemFilters(value => ({ ...value, equipment: event.target.value as ItemFilters["equipment"] }))}><option value="all">All equipment types</option><option value="none">None</option><option value="system">System</option><option value="module">Module</option></select></div>
          <div className="space-y-2"><Label htmlFor="catalog-item-vendor">Vendor</Label><select id="catalog-item-vendor" className={selectClass} value={itemFilters.vendor} onChange={event => setItemFilters(value => ({ ...value, vendor: event.target.value }))}><option value="all">All vendors</option>{vendors.map(vendor => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></div>
          <div className="space-y-2"><Label htmlFor="catalog-item-kit">Kit recipe</Label><select id="catalog-item-kit" className={selectClass} value={itemFilters.kit} onChange={event => setItemFilters(value => ({ ...value, kit: event.target.value as ItemFilters["kit"] }))}><option value="all">All items</option><option value="kit">Kits</option><option value="standalone">Standalone items</option></select></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="catalog-item-sort">Sort items</Label><select id="catalog-item-sort" className={selectClass} value={itemFilters.sort} onChange={event => setItemFilters(value => ({ ...value, sort: event.target.value as ItemFilters["sort"] }))}><option value="name-asc">Name · ascending</option><option value="name-desc">Name · descending</option><option value="sku-asc">SKU · ascending</option><option value="category-asc">Category · ascending</option></select></div>
        </div> : <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="catalog-vendor-status">Status</Label><select id="catalog-vendor-status" className={selectClass} value={vendorFilters.status} onChange={event => setVendorFilters(value => ({ ...value, status: event.target.value as VendorFilters["status"] }))}><option value="all">All vendors</option><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          <div className="space-y-2"><Label htmlFor="catalog-vendor-contact">Contact availability</Label><select id="catalog-vendor-contact" className={selectClass} value={vendorFilters.contact} onChange={event => setVendorFilters(value => ({ ...value, contact: event.target.value as VendorFilters["contact"] }))}><option value="all">Any contact status</option><option value="available">Contact details available</option><option value="missing">No contact details</option></select></div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="catalog-vendor-sort">Sort vendors</Label><select id="catalog-vendor-sort" className={selectClass} value={vendorFilters.sort} onChange={event => setVendorFilters(value => ({ ...value, sort: event.target.value as VendorFilters["sort"] }))}><option value="name-asc">Name · ascending</option><option value="name-desc">Name · descending</option></select></div>
        </div>}
        <p className="text-sm text-muted-foreground" aria-live="polite">{matchingRows.length} matching {kind} of {sourceCount}</p>
        <DialogFooter className="flex-row justify-between sm:justify-between"><Button variant="ghost" onClick={resetFilters}>Clear filters</Button><Button onClick={() => setFiltersOpen(false)}>Show {matchingRows.length} {kind}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <header className="sticky top-0 z-10 shrink-0 border-b bg-background px-1 pb-2 sm:pb-3" data-testid={`inventory-${kind}-subheader`}>
      <div className="min-h-8">
        <h2 className="text-base font-semibold tracking-tight sm:text-lg">{isItems ? "Item catalog" : "Project vendors"}</h2>
        <p className="hidden text-xs text-muted-foreground sm:block">{isItems ? "Serialized meters, kit recipes, and reorder points for this project." : "Vendor contacts and purchasing references for this project."}</p>
      </div>
      <InventoryMobileTools tab={kind}>
        <div className="space-y-2 rounded-md border bg-card p-2 md:rounded-none md:border-0 md:bg-transparent md:p-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {canMaintain && <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" aria-label={`Add ${isItems ? "item" : "vendor"}`} title={`Add ${isItems ? "item" : "vendor"}`} onClick={onAdd}><Plus className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Add {isItems ? "item" : "vendor"}</span></Button>}
            {isItems && canAssemble && <><Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="Assemble kit" title="Assemble kit" onClick={onAssemble}><PackageCheck className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Assemble kit</span></Button><Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="Disassemble kit" title="Disassemble kit" onClick={onDisassemble}><PackageMinus className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Disassemble kit</span></Button></>}
            {isItems && canInspectKits && <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="Inspect kit holds" title="Inspect kit holds" onClick={onInspectKits}><Eye className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Inspect kits</span></Button>}
            <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label={`Refresh ${kind}`} title={`Refresh ${kind}`} onClick={onRefresh}><RefreshCw className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Refresh</span></Button>
            <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="CSV" title="CSV" disabled={!matchingRows.length} onClick={() => void exportFile("csv")}><Download className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">CSV</span></Button>
            <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="Excel" title="Excel" disabled={!matchingRows.length} onClick={() => void exportFile("xlsx")}><FileSpreadsheet className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Excel</span></Button>
            <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="PDF / Print" title="PDF / Print" disabled={!matchingRows.length} onClick={() => void exportFile("pdf")}><FileText className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">PDF / Print</span></Button>
            <p className="ml-auto basis-full shrink-0 text-right text-xs text-muted-foreground sm:basis-auto" aria-live="polite">{matchingRows.length} {kind}</p>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="relative min-w-0 flex-1"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label={`Search ${kind}`} className="h-9 pl-9" type="search" autoComplete="off" placeholder={isItems ? "Name, SKU, barcode, maker or vendor" : "Vendor, contact, phone, email or reference"} value={query} onChange={event => setQuery(event.target.value)} /></div>
            <Button size="sm" variant="outline" aria-label={`Filter ${kind}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen(true)}><Filter className="mr-1.5 h-4 w-4" />Filters{activeFilterCount > 0 && <Badge variant="secondary" className="ml-1">{activeFilterCount}</Badge>}</Button>
          </div>
        </div>
      </InventoryMobileTools>
    </header>
    <div ref={setResultsElement} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2" data-testid={`inventory-${kind}-results`} data-page-size={rowsPerPage} role="region" aria-label={isItems ? "Catalog items" : "Vendors"} tabIndex={0}>
      {visibleRows.length ? <div className="space-y-2">{isItems ? (visibleRows as InventoryItem[]).map(item => {
        const image = item.images[0] ? sameOriginImage(item.images[0]) : null;
        const vendor = vendors.find(value => value.id === item.vendorId);
        return <article key={item.id} data-catalog-row className="min-w-0 rounded-md border bg-card px-2.5 py-2 sm:px-4 sm:py-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 sm:gap-3">
            <div className="flex min-w-0 items-center gap-3">{image && <img src={image} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />}
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-1.5"><h3 className="break-words font-medium">{item.name}</h3><span className="break-all font-mono text-xs text-muted-foreground">{item.sku}</span>{!item.active && <Badge variant="secondary">Inactive</Badge>}</div>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">{item.category || "Uncategorized"} · {item.tracking === "serialized" ? "Serial tracked" : "Quantity tracked"} · {item.unit}{item.equipment !== "none" ? ` · ${item.equipment}` : ""}{item.components.length ? ` · Kit of ${item.components.length}` : ""}</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">{vendor ? `Vendor · ${vendor.name}` : "No vendor assigned"}{item.manufacturer ? ` · ${item.manufacturer}${item.model ? ` ${item.model}` : ""}` : ""}{item.barcode ? ` · Barcode ${item.barcode}` : ""}</p>
              </div>
            </div>
             <div className="flex flex-wrap items-center gap-2">{item.reorderPoint > 0 && <Badge variant="outline">Reorder at {item.reorderPoint}</Badge>}{canMaintain && <Button size="sm" variant="outline" onClick={() => onEditItem(item)}>Edit</Button>}{canMaintain && onCopyItem && <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label={`Copy item ${item.name}`} title={`Copy item ${item.name}`} onClick={() => onCopyItem(item)}><Copy className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Copy</span></Button>}</div>
          </div>
        </article>;
      }) : (visibleRows as Vendor[]).map(vendor => <article key={vendor.id} data-catalog-row className="min-w-0 rounded-md border bg-card px-2.5 py-2 sm:px-4 sm:py-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-medium">{vendor.name}</h3>{!vendor.active && <Badge variant="secondary">Inactive</Badge>}</div>
          <p className="mt-1 break-words text-sm text-muted-foreground">{vendor.contact || "No contact name"}{vendor.phone ? ` · ${vendor.phone}` : ""}{vendor.email ? ` · ${vendor.email}` : ""}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{vendor.address || "No address"}{vendor.reference ? ` · Reference ${vendor.reference}` : ""}</p>
        </div>{canMaintain && <Button size="sm" variant="outline" onClick={() => onEditVendor(vendor)}>Edit</Button>}</div>
      </article>)}</div> : <div className="grid min-h-40 place-items-center rounded-md border border-dashed bg-muted/15 px-4 py-8 text-center" role="status"><div className="max-w-md"><p className="font-medium">{sourceCount ? `No matching ${kind}` : `No ${kind} in this project`}</p><p className="mt-1 text-sm text-muted-foreground">{sourceCount ? "Try another search or clear filters to see matching records." : isItems ? "Add the meter catalog, barcode identifiers, tracking type, and kit recipes." : "Vendor details are optional for internal stock moves and required when creating purchase orders."}</p>{sourceCount > 0 && (query || activeFilterCount > 0) && <Button className="mt-3" size="sm" variant="outline" onClick={() => { setQuery(""); resetFilters(); }}>Clear search and filters</Button>}</div></div>}
    </div>
    <nav className="flex shrink-0 flex-wrap items-center gap-2 border-t px-1 py-2" data-testid={`inventory-${kind}-pagination`} aria-label={`${isItems ? "Item" : "Vendor"} pages`}>
      <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">{matchingRows.length ? `${currentPage * rowsPerPage + 1}–${Math.min(matchingRows.length, (currentPage + 1) * rowsPerPage)} of ${matchingRows.length} ${kind}` : `0 ${kind}`}</p>
      <Button size="sm" variant="outline" aria-label={`Previous ${isItems ? "item" : "vendor"} page`} disabled={currentPage === 0} onClick={() => { setPage(Math.max(0, currentPage - 1)); resultsElement?.scrollTo({ top: 0 }); }}>Previous</Button>
      <span className="min-w-16 text-center text-xs tabular-nums">Page {currentPage + 1} / {pageCount}</span>
      <Button size="sm" variant="outline" aria-label={`Next ${isItems ? "item" : "vendor"} page`} disabled={currentPage >= pageCount - 1} onClick={() => { setPage(currentPage + 1); resultsElement?.scrollTo({ top: 0 }); }}>Next</Button>
    </nav>
  </section>;
}
