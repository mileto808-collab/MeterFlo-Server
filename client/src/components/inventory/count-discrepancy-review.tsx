import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardCheck } from "lucide-react";
import type { InventoryCountSerialChange } from "@shared/inventory-count-review";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SERIAL_PAGE_SIZE = 80;
const ITEM_PAGE_SIZE = 4;

function SerialList({ title, serials, pageKey }: { title: string; serials: string[]; pageKey: string }) {
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [pageKey]);
  if (!serials.length) return null;
  const pageCount = Math.max(1, Math.ceil(serials.length / SERIAL_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = serials.slice(currentPage * SERIAL_PAGE_SIZE, (currentPage + 1) * SERIAL_PAGE_SIZE);
  return <section className="min-w-0 rounded-md border bg-background/70 p-3" aria-label={title}>
    <h4 className="text-sm font-semibold">{title} <span className="font-normal text-muted-foreground">({serials.length})</span></h4>
    <ul className="mt-2 grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2" aria-live="polite">
      {visible.map((serial, index) => <li key={`${currentPage}:${index}:${serial}`} className="break-all font-mono text-xs" title={serial}>{serial}</li>)}
    </ul>
    {pageCount > 1 && <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" aria-label={`Previous ${title.toLowerCase()} page`}
        disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
        <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />Previous
      </Button>
      <span className="text-xs tabular-nums" aria-live="polite">Page {currentPage + 1} of {pageCount}</span>
      <Button type="button" variant="outline" size="sm" aria-label={`Next ${title.toLowerCase()} page`}
        disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>
        Next<ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
      </Button>
    </div>}
  </section>;
}

export type CountDiscrepancyReviewPayload = {
  countId: string;
  draftRevision: number;
  lines: ReadonlyArray<{ itemId: string; quantity: number; serials: string[] }>;
  reason: string;
  identity: string;
  changes: InventoryCountSerialChange[];
};

type CountDiscrepancyReviewProps = {
  review: CountDiscrepancyReviewPayload | null;
  staleReason: string | null;
  posting: boolean;
  onDismiss: () => void;
  onConfirm: (review: CountDiscrepancyReviewPayload) => void;
};

export function CountDiscrepancyReview({ review, staleReason, posting, onDismiss, onConfirm }: CountDiscrepancyReviewProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [itemPage, setItemPage] = useState(0);
  useEffect(() => {
    setAcknowledged(false);
    setItemPage(0);
  }, [review?.identity]);

  const changes = review?.changes ?? [];
  const pageCount = Math.max(1, Math.ceil(changes.length / ITEM_PAGE_SIZE));
  const currentPage = Math.min(itemPage, pageCount - 1);
  const visibleChanges = changes.slice(currentPage * ITEM_PAGE_SIZE, (currentPage + 1) * ITEM_PAGE_SIZE);

  return <Dialog open={!!review} onOpenChange={open => { if (!open && !posting) onDismiss(); }}>
    <DialogContent
      data-testid="inventory-count-discrepancy-review"
      className="flex max-h-[calc(100dvh-0.75rem)] w-[calc(100vw-0.75rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)]"
      onOpenAutoFocus={event => {
        event.preventDefault();
        titleRef.current?.focus();
      }}
      onEscapeKeyDown={event => { if (posting) event.preventDefault(); }}
      onPointerDownOutside={event => { if (posting) event.preventDefault(); }}
    >
      <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12 text-left sm:px-6">
        <DialogTitle ref={titleRef} tabIndex={-1} className="flex items-center gap-2 text-lg outline-none">
          <ClipboardCheck className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          Review serial discrepancies
        </DialogTitle>
        <DialogDescription>
          Confirm what is physically present before this count changes inventory. No stock changes until you confirm and post.
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6">
        <Alert>
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Review each serial change</AlertTitle>
          <AlertDescription>
            Missing serials will be removed from this location only. They are not automatically installed or transferred.
            Unexpected serials will be added and remain subject to existing custody checks.
          </AlertDescription>
        </Alert>
        {staleReason && <Alert variant="destructive" role="alert">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>This review is no longer current</AlertTitle>
          <AlertDescription>{staleReason} Go back to the count and start a fresh review. Your quantities, scans, and reason are retained.</AlertDescription>
        </Alert>}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">{changes.length} serialized {changes.length === 1 ? "product" : "products"} with changes</p>
          {pageCount > 1 && <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" aria-label="Previous discrepancy products page"
              disabled={currentPage === 0} onClick={() => setItemPage(currentPage - 1)}>
              <ChevronLeft className="mr-1 h-4 w-4" aria-hidden="true" />Previous products
            </Button>
            <span className="text-xs tabular-nums" aria-live="polite">Products {currentPage * ITEM_PAGE_SIZE + 1}–{Math.min((currentPage + 1) * ITEM_PAGE_SIZE, changes.length)} of {changes.length}</span>
            <Button type="button" variant="outline" size="sm" aria-label="Next discrepancy products page"
              disabled={currentPage >= pageCount - 1} onClick={() => setItemPage(currentPage + 1)}>
              Next products<ChevronRight className="ml-1 h-4 w-4" aria-hidden="true" />
            </Button>
          </div>}
        </div>

        <div className="space-y-3">
          {visibleChanges.map((change, index) => <article key={change.itemId} className="space-y-3 rounded-lg border bg-muted/20 p-3 sm:p-4">
            <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 className="min-w-0 font-semibold">{change.itemName}</h3>
              <span className="font-mono text-xs text-muted-foreground">{change.sku}</span>
            </header>
            <p className="text-sm tabular-nums">
              Expected <strong>{change.expectedQuantity}</strong>
              <span className="px-2 text-muted-foreground" aria-hidden="true">→</span>
              Actual <strong>{change.actualQuantity}</strong>
              {change.unchangedSerialCount > 0 && <span className="ml-2 text-xs text-muted-foreground">
                {change.unchangedSerialCount} {change.unchangedSerialCount === 1 ? "serial" : "serials"} unchanged
              </span>}
            </p>
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              <SerialList title="Missing serials — will be removed" serials={change.missingSerials} pageKey={`${change.itemId}:missing:${index}`} />
              <SerialList title="Unexpected serials — will be added" serials={change.unexpectedSerials} pageKey={`${change.itemId}:unexpected:${index}`} />
            </div>
          </article>)}
        </div>
      </div>

      <DialogFooter className="shrink-0 border-t bg-background px-4 py-3 sm:px-6">
        <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={acknowledged} disabled={posting || !!staleReason}
              onCheckedChange={value => setAcknowledged(value === true)} />
            <span>I reviewed the serial changes</span>
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" className="min-h-10" disabled={posting} onClick={onDismiss}>Back to count</Button>
            <Button type="button" className="min-h-10" disabled={!review || !acknowledged || !!staleReason || posting}
              onClick={() => { if (review && acknowledged && !staleReason) onConfirm(review); }}>
              {posting ? "Posting…" : "Confirm and post count"}
            </Button>
          </div>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
