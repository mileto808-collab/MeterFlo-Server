import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { downloadStockSerials } from "@/lib/inventory-stock-serial-export";
import { MOBILE_MEDIA_QUERY } from "@/hooks/use-mobile";

type ExportContext = {
  project: string;
  sku: string;
  item: string;
  location: string;
  locationCode: string;
};

type ExportFormat = "xlsx" | "csv" | "pdf";
type ExportScope = "all" | "filtered";

type InventoryStockSerialDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  sku: string;
  locationName: string;
  locationCode: string;
  project: string;
  serials: readonly string[];
};

const PAGE_SIZE = 50;

export function InventoryStockSerialDialog({
  open,
  onOpenChange,
  itemName,
  sku,
  locationName,
  locationCode,
  project,
  serials,
}: InventoryStockSerialDialogProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [scope, setScope] = useState<ExportScope>("all");
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [exportError, setExportError] = useState("");
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { toast } = useToast();

  const filteredSerials = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return needle ? serials.filter(serial => serial.toLocaleLowerCase().includes(needle)) : [...serials];
  }, [serials, search]);
  const pageCount = Math.max(1, Math.ceil(filteredSerials.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageSerials = filteredSerials.slice(pageStart, pageStart + PAGE_SIZE);
  const exportSerials = scope === "all" ? serials : filteredSerials;
  const context: ExportContext = { project, sku, item: itemName, location: locationName, locationCode };

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setPage(0);
    setScope("all");
    setExportError("");
  }, [open, project, sku, locationCode]);

  useEffect(() => {
    setPage(0);
  }, [search]);

  const exportFile = async (format: ExportFormat) => {
    if (exporting || exportSerials.length === 0) return;
    setExporting(format);
    setExportError("");
    try {
      await downloadStockSerials(format, context, exportSerials);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please retry the export.";
      const description = `Could not export ${exportSerials.length} ${exportSerials.length === 1 ? "serial" : "serials"}: ${message}`;
      setExportError(description);
      toast({ title: "Serial export failed", description, variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,52rem)] w-[calc(100%-1rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:w-full"
        onOpenAutoFocus={event => {
          if (window.matchMedia(MOBILE_MEDIA_QUERY).matches || window.matchMedia("(pointer: coarse)").matches) {
            // Keep focus inside the dialog without opening a touch keyboard.
            event.preventDefault();
            titleRef.current?.focus({ preventScroll: true });
          }
        }}>
        <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 sm:px-6">
          <DialogTitle ref={titleRef} tabIndex={-1}>Stock serials</DialogTitle>
          <DialogDescription className="mt-2 space-y-1 text-left">
            <span className="block font-medium text-foreground">{itemName}</span>
            <span className="block font-mono text-xs">{sku}</span>
            <span className="block">{locationName} <span className="font-mono text-xs">· {locationCode}</span></span>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
          <div className="space-y-2">
            <Label htmlFor="stock-serial-search">Search serials</Label>
            <Input
              id="stock-serial-search"
              aria-label="Search serials"
              autoComplete="off"
              placeholder="Find a serial number"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="font-medium" aria-live="polite">
              {search ? `${filteredSerials.length} of ${serials.length} serials` : `${serials.length} serials`}
            </p>
            {filteredSerials.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredSerials.length)}
              </p>
            )}
          </div>

          {pageSerials.length ? (
            <ol
              aria-label="Stock serial list"
              className="max-h-[min(40dvh,24rem)] min-h-24 divide-y overflow-y-auto rounded-md border bg-muted/20"
            >
              {pageSerials.map((serial, index) => (
                <li key={`${pageStart + index}-${serial}`} className="flex min-h-10 items-center gap-3 px-3 py-2">
                  <span className="w-8 shrink-0 text-right font-mono text-[11px] text-muted-foreground">{pageStart + index + 1}</span>
                  <code className="min-w-0 break-all font-mono text-sm text-foreground">{serial}</code>
                </li>
              ))}
            </ol>
          ) : (
            <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed bg-muted/20 px-4 text-center text-sm text-muted-foreground" role="status">
              {serials.length ? "No serials match this search." : "No serials are recorded for this stock row."}
            </div>
          )}

          {filteredSerials.length > PAGE_SIZE && (
            <nav aria-label="Serial list pages" className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">Page {currentPage + 1} of {pageCount}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0}>Previous</Button>
                <Button size="sm" variant="outline" onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1}>Next</Button>
              </div>
            </nav>
          )}

          <section aria-label="Export serials" className="space-y-3 rounded-md border bg-card p-3 sm:p-4">
            <div className="space-y-1">
              <Label htmlFor="stock-serial-export-scope">Export scope</Label>
              <select
                id="stock-serial-export-scope"
                aria-label="Export scope"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                value={scope}
                onChange={event => setScope(event.target.value as ExportScope)}
              >
                <option value="all">All serials ({serials.length})</option>
                <option value="filtered">Filtered matches ({filteredSerials.length})</option>
              </select>
              <p className="text-xs text-muted-foreground">
                {scope === "all"
                  ? `Exports all ${serials.length} serials for this location, regardless of search or page.`
                  : `Exports all ${filteredSerials.length} matching serials, regardless of page.`}
              </p>
            </div>
            {exportError && (
              <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{exportError}</span>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Button variant="outline" onClick={() => void exportFile("xlsx")} disabled={exporting !== null || exportSerials.length === 0}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />{exporting === "xlsx" ? "Preparing…" : "Excel"}
              </Button>
              <Button variant="outline" onClick={() => void exportFile("csv")} disabled={exporting !== null || exportSerials.length === 0}>
                <Download className="mr-2 h-4 w-4" />{exporting === "csv" ? "Preparing…" : "CSV"}
              </Button>
              <Button variant="outline" onClick={() => void exportFile("pdf")} disabled={exporting !== null || exportSerials.length === 0}>
                <Printer className="mr-2 h-4 w-4" />{exporting === "pdf" ? "Preparing…" : "PDF / Print"}
              </Button>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Download className="h-3.5 w-3.5 shrink-0" />
              PDF / Print opens a printable view. Select Print / Save PDF there to save a PDF.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
