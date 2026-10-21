import { useEffect, useState } from "react";
import type { ShipmentEntry } from "@/lib/inventory-shipment-guidance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function ReceivingPallets({ entry, viewOnly, onPatch, viewPalletId, onViewPalletChange, onSelected }: {
  entry: ShipmentEntry; viewOnly: boolean; onPatch: (change: Partial<ShipmentEntry>) => void;
  viewPalletId?: string | null; onViewPalletChange?: (id: string | null) => void; onSelected?: () => void;
}) {
  const pallets = entry.pallets ?? [];
  const [label, setLabel] = useState("");
  const [expected, setExpected] = useState("50");
  const [existing, setExisting] = useState("");
  const [error, setError] = useState("");
  const activeId = (viewOnly ? viewPalletId : entry.activePalletId) ?? "none";
  const active = pallets.find(pallet => pallet.id === activeId);
  const [expectedEdit, setExpectedEdit] = useState(String(active?.expectedQuantity ?? ""));
  useEffect(() => { setExpectedEdit(String(active?.expectedQuantity ?? "")); setError(""); setExisting(""); }, [active?.id, active?.expectedQuantity]);
  const prefix = `${entry.itemId}-pallet`;
  return <details className="space-y-2 rounded-md border p-2" open={pallets.length > 0 ? true : undefined}>
    <summary className="cursor-pointer text-sm font-medium">Pallet groups (optional) · {pallets.length}</summary>
    <p className="text-xs text-muted-foreground">Groups belong to this item and receipt only. Counts include good and known-damaged serials. They do not change stock quantities or follow later transfers. Set receiving quantities before scanning.</p>
    {!viewOnly && <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_100px_auto] sm:items-end">
      <div className="min-w-0 space-y-1"><Label htmlFor={`${prefix}-label`} className="text-xs">New pallet ID / label</Label>
        <Input id={`${prefix}-label`} value={label} maxLength={100} placeholder="Scan pallet barcode or enter label"
          onChange={event => setLabel(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); document.getElementById(`${prefix}-expected`)?.focus(); } }} /></div>
      <div className="space-y-1"><Label htmlFor={`${prefix}-expected`} className="text-xs">Expected serials</Label>
        <Input id={`${prefix}-expected`} type="number" min={1} max={10000} step={1} value={expected} onChange={event => setExpected(event.target.value)} /></div>
      <Button type="button" size="sm" variant="outline" onClick={() => {
        const count = Number(expected);
        if (!label.trim() || !Number.isInteger(count) || count < 1 || count > 10000) { setError("Enter a pallet label and 1–10,000 expected serials."); return; }
        if (pallets.length >= 200) { setError("A product line supports up to 200 pallet groups."); return; }
        if (pallets.some(pallet => pallet.label.toLowerCase() === label.trim().toLowerCase())) { setError("This pallet label is already in this item’s receiving draft."); return; }
        const id = crypto.randomUUID();
        onPatch({ pallets: [...pallets, { id, label: label.trim(), expectedQuantity: count, serials: [], exceptionReason: "" }], activePalletId: id });
        setLabel(""); setError(""); onSelected?.();
      }}>Create pallet</Button>
    </div>}
    {!!pallets.length && <>
      <div className="space-y-1"><Label htmlFor={`${prefix}-active`} className="text-xs">{viewOnly ? "Inspect pallet" : "Scan into / view pallet"}</Label>
        <Select value={activeId} onValueChange={id => {
          if (viewOnly) onViewPalletChange?.(id === "none" ? null : id);
          else onPatch({ activePalletId: id === "none" ? null : id });
          onSelected?.();
        }}>
          <SelectTrigger id={`${prefix}-active`}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="none">No pallet · show all serials</SelectItem>
            {pallets.map(pallet => <SelectItem key={pallet.id} value={pallet.id}>{pallet.label} · {pallet.serials.length} / {pallet.expectedQuantity}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <div className="space-y-1" aria-label="Pallet counts">
        {pallets.map(pallet => {
          const difference = pallet.expectedQuantity - pallet.serials.length;
          return <p key={pallet.id} className={`break-words text-xs ${difference ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
            {pallet.label}: {pallet.serials.length} / {pallet.expectedQuantity} scanned
            {difference > 0 ? ` · ${difference} missing` : difference < 0 ? ` · ${-difference} extra` : " · Complete"}
            {difference !== 0 && pallet.exceptionReason.trim().length >= 10 ? " · Count discrepancy documented" : ""}
          </p>;
        })}
      </div>
      {active && !viewOnly && <div className="space-y-2 rounded border p-2">
        <div className="space-y-1"><Label htmlFor={`${prefix}-edit-expected`} className="text-xs">Expected count for {active.label}</Label>
          <Input id={`${prefix}-edit-expected`} type="number" min={1} max={10000} step={1} value={expectedEdit}
            onChange={event => setExpectedEdit(event.target.value)} onBlur={() => {
              const count = Number(expectedEdit);
              if (!Number.isInteger(count) || count < 1 || count > 10000) { setError("Expected count must be 1–10,000. The prior saved value is unchanged."); return; }
              onPatch({ pallets: pallets.map(pallet => pallet.id === active.id ? { ...pallet, expectedQuantity: count } : pallet) }); setError("");
            }} /></div>
        <div className="space-y-1"><Label htmlFor={`${prefix}-exception`} className="text-xs">Count-discrepancy reason (required if counts differ)</Label>
          <Textarea id={`${prefix}-exception`} rows={2} maxLength={1000} placeholder="Recounted pallet; one meter physically missing…"
            value={active.exceptionReason} onChange={event => onPatch({ pallets: pallets.map(pallet => pallet.id === active.id ? { ...pallet, exceptionReason: event.target.value } : pallet) })} />
          <p className="text-xs text-muted-foreground">At least 10 characters. A discrepancy records the expected and actual counts; it never invents serials or receives missing units.</p>
        </div>
        <div className="space-y-1"><Label htmlFor={`${prefix}-attach`} className="text-xs">Attach an already-captured serial to {active.label}</Label>
          <div className="flex gap-2"><Input id={`${prefix}-attach`} className="min-w-0 font-mono" value={existing} onChange={event => setExisting(event.target.value)} />
            <Button type="button" size="sm" variant="outline" onClick={() => {
              const serial = existing.trim();
              if (![...entry.goodSerials, ...entry.damagedSerials].includes(serial)) { setError("That serial has not been captured for this item."); return; }
              if (pallets.some(pallet => pallet.serials.includes(serial))) { setError("That serial already belongs to a pallet group."); return; }
              onPatch({ pallets: pallets.map(pallet => pallet.id === active.id ? { ...pallet, serials: [...pallet.serials, serial] } : pallet) });
              setExisting(""); setError("");
            }}>Attach</Button></div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => {
          if (active.serials.length && !window.confirm(`Remove pallet group "${active.label}"? Captured serials will remain as ungrouped serials.`)) return;
          onPatch({ pallets: pallets.filter(pallet => pallet.id !== active.id), activePalletId: null });
        }}>Remove pallet group</Button>
      </div>}
      {viewOnly && active?.exceptionReason && <p className="break-words text-xs">Count discrepancy: {active.exceptionReason}</p>}
    </>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </details>;
}
