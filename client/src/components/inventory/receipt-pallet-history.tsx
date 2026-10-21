import { useState } from "react";
import type { ReceiptPallet } from "@shared/inventory-receiving-pallets";
import type { InventoryState } from "@shared/inventory";
import { Input } from "@/components/ui/input";

export function ReceiptPalletHistory({ pallets, state }: { pallets: ReceiptPallet[]; state: InventoryState }) {
  const [search, setSearch] = useState("");
  return <details className="mt-2 rounded border p-2">
    <summary className="cursor-pointer text-sm">Receiving pallets ({pallets.length})</summary>
    <p className="my-2 text-xs text-muted-foreground">As received. These are historical scan groups, not current stock containers.</p>
    <Input aria-label="Search receiving pallet serials" placeholder="Search pallet or serial" value={search} onChange={event => setSearch(event.target.value)} />
    <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
      {pallets.filter(pallet => [pallet.label, ...pallet.serials].some(value => value.toLowerCase().includes(search.trim().toLowerCase()))).map(pallet => {
        const item = state.items.find(item => item.id === pallet.itemId);
        const matching = pallet.label.toLowerCase().includes(search.trim().toLowerCase()) ? pallet.serials :
          pallet.serials.filter(serial => serial.toLowerCase().includes(search.trim().toLowerCase()));
        return <details key={pallet.id} className="rounded border p-2">
          <summary className="cursor-pointer break-words text-xs font-medium">{pallet.label} · {item ? `${item.sku} · ${item.name}` : "Item unavailable"} · {pallet.serials.length} / {pallet.expectedQuantity} scanned</summary>
          {pallet.exceptionReason && <p className="mt-1 break-words text-xs">Count discrepancy: {pallet.exceptionReason}</p>}
          <p className="mt-1 text-xs text-muted-foreground">{matching.length} matching serials · complete serial list is included in Print transaction / Print history.</p>
          <ul className="mt-1 max-h-40 overflow-y-auto font-mono text-xs">{matching.slice(0, 100).map(serial => <li key={serial} className="break-all">{serial}</li>)}</ul>
          {matching.length > 100 && <p className="text-xs">First 100 shown. Search to narrow this pallet.</p>}
        </details>;
      })}
    </div>
  </details>;
}
