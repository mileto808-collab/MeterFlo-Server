import { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryItem, InventoryOrder } from "@shared/inventory";
import { Check, ChevronLeft, ChevronRight, Search, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ShipmentAction, ShipmentEntry } from "@/lib/inventory-shipment-guidance";

type Bucket = "goodSerials" | "damagedSerials";
type Props = {
  item: InventoryItem;
  order: InventoryOrder;
  action: ShipmentAction;
  entry: ShipmentEntry;
  viewOnly: boolean;
  rawBuffers: Record<string, string>;
  expectedReferences: string[];
  validation: string;
  onRawChange: (key: string, value: string) => void;
  onCommit: (bucket: Bucket, input: HTMLInputElement) => boolean;
  onPatch: (change: Partial<ShipmentEntry>) => void;
  onClose: () => void;
};

const PAGE_SIZE = 50;

export function InventoryShipmentSerialDialog({
  item, order, action, entry, viewOnly, rawBuffers, expectedReferences, validation,
  onRawChange, onCommit, onPatch, onClose,
}: Props) {
  const initialBucket: Bucket = rawBuffers[`${item.id}-goodSerials`] ? "goodSerials" :
    rawBuffers[`${item.id}-damagedSerials`] ? "damagedSerials" :
    entry.goodSerials.length < Number(entry.goodQuantity) ? "goodSerials" :
    entry.damagedSerials.length < Number(entry.damagedQuantity) ? "damagedSerials" : "goodSerials";
  const [bucket, setBucket] = useState<Bucket>(initialBucket);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [referenceSearch, setReferenceSearch] = useState("");
  const [referencePage, setReferencePage] = useState(0);
  const [activeReferenceTab, setActiveReferenceTab] = useState(false);
  const inputRefs = useRef<Record<Bucket, HTMLInputElement | null>>({ goodSerials: null, damagedSerials: null });
  const doneRef = useRef<HTMLButtonElement | null>(null);
  const initialFocusPending = useRef(true);
  const keys: Record<Bucket, string> = {
    goodSerials: `${item.id}-goodSerials`,
    damagedSerials: `${item.id}-damagedSerials`,
  };
  const target = (key: Bucket) => Number(key === "goodSerials" ? entry.goodQuantity : entry.damagedQuantity);
  const serials = entry[bucket];
  const filtered = useMemo(() => serials
    .map((value, sourceIndex) => ({ value, sourceIndex }))
    .filter(({ value }) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [serials, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const effectivePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(effectivePage * PAGE_SIZE, (effectivePage + 1) * PAGE_SIZE);
  const availableReferences = useMemo(() => expectedReferences.filter(serial =>
    ((!entry.goodSerials.includes(serial) && !entry.damagedSerials.includes(serial)) || entry.expectedSerials.includes(serial)) &&
    serial.toLocaleLowerCase().includes(referenceSearch.trim().toLocaleLowerCase())), [expectedReferences, entry.expectedSerials, entry.goodSerials, entry.damagedSerials, referenceSearch]);
  const referencePageCount = Math.max(1, Math.ceil(availableReferences.length / PAGE_SIZE));
  const effectiveReferencePage = Math.min(referencePage, referencePageCount - 1);
  const visibleReferences = availableReferences.slice(effectiveReferencePage * PAGE_SIZE, (effectiveReferencePage + 1) * PAGE_SIZE);
  const currentOrderStage = action === "receive" ? "Purchase receipt" : action === "dispatch" ? "Transfer dispatch" : "Transfer arrival";

  useEffect(() => {
    setPage(current => Math.min(current, pageCount - 1));
  }, [pageCount]);
  useEffect(() => {
    setReferencePage(current => Math.min(current, referencePageCount - 1));
  }, [referencePageCount]);
  useEffect(() => {
    if (viewOnly || activeReferenceTab) return;
    if (initialFocusPending.current) {
      initialFocusPending.current = false;
      const incomplete = entry.goodSerials.length < Number(entry.goodQuantity) ||
        entry.damagedSerials.length < Number(entry.damagedQuantity);
      if (!incomplete) {
        doneRef.current?.focus();
        return;
      }
    }
    inputRefs.current[bucket]?.focus();
  }, [bucket, activeReferenceTab, viewOnly, entry.goodSerials.length, entry.damagedSerials.length, entry.goodQuantity, entry.damagedQuantity]);

  const commit = (selectedBucket: Bucket, input: HTMLInputElement) => {
    const before = entry[selectedBucket].length;
    if (!onCommit(selectedBucket, input)) return;
    const goal = target(selectedBucket);
    let nextBucket: Bucket | null = before + 1 < goal ? selectedBucket :
      selectedBucket === "goodSerials" && entry.damagedSerials.length < Number(entry.damagedQuantity) ? "damagedSerials" : null;
    if (nextBucket) {
      setBucket(nextBucket);
    } else {
      requestAnimationFrame(() => doneRef.current?.focus());
    }
  };

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent
      data-serial-child-dialog="true"
      className="flex max-h-[min(90dvh,780px)] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-3 overflow-hidden p-4 sm:w-full sm:p-6"
      onOpenAutoFocus={event => {
        // Radix's default first-button focus runs after mount effects. Establish
        // HID readiness here so category buttons cannot steal the initial scan.
        event.preventDefault();
        const pendingRaw = rawBuffers[keys[initialBucket]];
        if (!viewOnly && (pendingRaw || entry[initialBucket].length < target(initialBucket))) {
          inputRefs.current[initialBucket]?.focus();
        } else doneRef.current?.focus();
      }}
      onEscapeKeyDown={event => { event.preventDefault(); onClose(); }}
      onPointerDownOutside={event => { event.preventDefault(); onClose(); }}
    >
      <DialogHeader className="shrink-0 pr-7 text-left">
        <DialogTitle className="break-words text-base [overflow-wrap:anywhere] sm:text-lg" aria-label={`${viewOnly ? "View" : "Scan"} serials for ${item.name}`}>
          {viewOnly ? "View serials" : "Scan serials"} for {item.name}
        </DialogTitle>
        <DialogDescription className="break-words [overflow-wrap:anywhere]">
          {item.sku} · {currentOrderStage} · Order <span className="font-mono">{order.id}</span>
        </DialogDescription>
      </DialogHeader>

      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-md border bg-muted/40 p-2">
          <span className="block text-xs text-muted-foreground">Good target</span>
          <span className="font-mono text-sm font-semibold" aria-live="polite">{entry.goodSerials.length} / {entry.goodQuantity}</span>
        </div>
        <div className="rounded-md border bg-muted/40 p-2">
          <span className="block text-xs text-muted-foreground">Known damaged target</span>
          <span className="font-mono text-sm font-semibold" aria-live="polite">{entry.damagedSerials.length} / {entry.damagedQuantity}</span>
        </div>
        {action === "accept" && <div className="rounded-md border bg-muted/40 p-2">
          <span className="block text-xs text-muted-foreground">Unreadable references</span>
          <span className="font-mono text-sm font-semibold">{entry.expectedSerials.length} / {entry.unreadableQuantity}</span>
        </div>}
      </div>

      {!viewOnly && Object.entries(rawBuffers).some(([key, value]) => (key === keys.goodSerials || key === keys.damagedSerials) && !!value) &&
        <Alert className="shrink-0 py-2" role="status">
          <AlertTitle className="text-sm">Uncommitted scanner text</AlertTitle>
          <AlertDescription className="text-xs">Press Enter or Tab to commit it, or clear the field. This text is retained if you close this dialog and is not included in movement review.</AlertDescription>
        </Alert>}
      {!viewOnly && validation && <p className="shrink-0 text-sm text-destructive" role="alert">{validation}</p>}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Serial categories">
          {(["goodSerials", "damagedSerials"] as const).map((key) => {
            const label = key === "goodSerials" ? "Good" : "Known damaged";
            return <Button key={key} type="button" size="sm" variant={bucket === key && !activeReferenceTab ? "default" : "outline"}
              aria-pressed={bucket === key && !activeReferenceTab} onClick={() => { setPage(0); setBucket(key); setActiveReferenceTab(false); }}>
              {label} <Badge variant="secondary" className="ml-1">{entry[key].length}/{target(key)}</Badge>
            </Button>;
          })}
          {action === "accept" && <Button type="button" size="sm" variant={activeReferenceTab ? "default" : "outline"}
            aria-pressed={activeReferenceTab} onClick={() => setActiveReferenceTab(true)}>
            Unreadable references <Badge variant="secondary" className="ml-1">{entry.expectedSerials.length}/{entry.unreadableQuantity}</Badge>
          </Button>}
        </div>

        {activeReferenceTab && action === "accept" ? <fieldset className="space-y-2 rounded-md border p-3">
          <legend className="px-1 text-sm font-medium">Unresolved dispatched identities for unreadable damage</legend>
          <p className="text-xs text-muted-foreground">Select exactly the expected identities. These references are not verified scans and do not create replacement serials.</p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor={`${item.id}-expected-reference-search`} className="sr-only">Search expected references</Label>
            <div className="relative min-w-[12rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input id={`${item.id}-expected-reference-search`} className="h-9 pl-8 font-mono" value={referenceSearch} placeholder="Search expected identities"
                onChange={event => { setReferenceSearch(event.target.value); setReferencePage(0); }} />
            </div>
            <span className="text-xs text-muted-foreground">{availableReferences.length} available · {entry.expectedSerials.length} selected</span>
          </div>
          <div className="max-h-48 overflow-y-auto rounded border" aria-label="Expected serial references">
            {visibleReferences.length ? visibleReferences.map(serial => <label key={serial} className="flex min-h-9 items-center gap-2 border-b px-2 py-1 font-mono text-xs last:border-0">
              <input type="checkbox" checked={entry.expectedSerials.includes(serial)} disabled={viewOnly || (!entry.expectedSerials.includes(serial) && (entry.expectedSerials.length >= Number(entry.unreadableQuantity) || entry.goodSerials.includes(serial) || entry.damagedSerials.includes(serial)))}
                onChange={event => onPatch({ expectedSerials: event.target.checked ? [...entry.expectedSerials, serial] : entry.expectedSerials.filter(value => value !== serial) })} />
              <span className="break-all">{serial}</span>
            </label>) : <p className="p-3 text-xs text-muted-foreground">{referenceSearch ? "No matching unresolved identities." : "No available unresolved identities."}</p>}
          </div>
          <div className="flex items-center justify-between text-xs">
            <span>Page {effectiveReferencePage + 1} of {referencePageCount}</span>
            <div className="flex gap-1">
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Previous expected references page" disabled={effectiveReferencePage === 0} onClick={() => setReferencePage(value => Math.max(0, effectiveReferencePage - 1))}><ChevronLeft className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Next expected references page" disabled={effectiveReferencePage + 1 >= referencePageCount} onClick={() => setReferencePage(value => Math.min(referencePageCount - 1, effectiveReferencePage + 1))}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </fieldset> : <section className="space-y-2 rounded-md border p-3" aria-label={`${bucket === "goodSerials" ? "Good" : "Known damaged"} serial entry`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{bucket === "goodSerials" ? "Good serials" : "Known damaged serials"}</h3>
            <span className="font-mono text-xs text-muted-foreground">{serials.length} committed</span>
          </div>
          {!viewOnly && <div className="space-y-1">
            <Label htmlFor={`${item.id}-${bucket}`} className="sr-only">{bucket === "goodSerials" ? `Good serial scanner for ${item.name}` : `Known damaged serial scanner for ${item.name}`}</Label>
            <div className="flex gap-2">
              <Input
                ref={node => { inputRefs.current[bucket] = node; }}
                id={`${item.id}-${bucket}`}
                aria-label={bucket === "goodSerials" ? `Good serial scanner for ${item.name}` : `Known damaged serial scanner for ${item.name}`}
                className="h-10 min-w-0 font-mono"
                autoComplete="off"
                maxLength={256}
                value={rawBuffers[keys[bucket]] ?? ""}
                placeholder="Scan or type, then Enter / Tab"
                onChange={event => onRawChange(keys[bucket], event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter" || (event.key === "Tab" && event.currentTarget.value.length > 0)) {
                    event.preventDefault();
                    commit(bucket, event.currentTarget);
                  }
                }}
              />
              <Button type="button" size="sm" variant="outline" aria-label={`Commit ${bucket === "goodSerials" ? "Good" : "Known damaged"} serial`} onClick={() => {
                const input = inputRefs.current[bucket];
                if (input) commit(bucket, input);
              }}><Check className="h-4 w-4" /></Button>
            </div>
          </div>}
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={`${item.id}-${bucket}-search`} className="sr-only">Search committed serials</Label>
            <div className="relative min-w-[10rem] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input id={`${item.id}-${bucket}-search`} className="h-9 pl-8 font-mono" value={search} placeholder="Search committed serials" onChange={event => { setSearch(event.target.value); setPage(0); }} />
            </div>
            <span className="text-xs text-muted-foreground">{filtered.length} shown</span>
          </div>
          <ul className="max-h-52 overflow-y-auto rounded border" aria-label={`${bucket === "goodSerials" ? "Good" : "Known damaged"} committed serials`}>
            {visible.length ? visible.map(({ value: serial, sourceIndex }, index) => {
              const visibleIndex = effectivePage * PAGE_SIZE + index;
              return <li key={`${serial}-${sourceIndex}`} className="flex min-h-9 items-center justify-between gap-2 border-b px-2 py-1 font-mono text-xs last:border-0">
                <span className="min-w-0 break-all">{visibleIndex + 1}. {serial}</span>
                {!viewOnly && <button type="button" className="shrink-0 rounded p-1 hover:bg-muted" aria-label={`Remove serial ${serial}`}
                  onClick={() => onPatch({ [bucket]: entry[bucket].filter((_, serialIndex) => serialIndex !== sourceIndex) })}><Trash2 className="h-3.5 w-3.5" /></button>}
              </li>;
            }) : <li className="p-3 text-xs text-muted-foreground">{search ? "No matching serials." : "No committed serials yet."}</li>}
          </ul>
          <div className="flex items-center justify-between text-xs">
            <span>Page {effectivePage + 1} of {pageCount}</span>
            <div className="flex gap-1">
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Previous serials page" disabled={effectivePage === 0} onClick={() => setPage(value => Math.max(0, effectivePage - 1))}><ChevronLeft className="h-4 w-4" /></Button>
              <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Next serials page" disabled={effectivePage + 1 >= pageCount} onClick={() => setPage(value => Math.min(pageCount - 1, effectivePage + 1))}><ChevronRight className="h-4 w-4" /></Button>
            </div>
          </div>
        </section>}
      </div>

      <DialogFooter className="shrink-0 border-t pt-3">
        <Button ref={doneRef} type="button" onClick={onClose}>{viewOnly ? "Close" : "Done"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
