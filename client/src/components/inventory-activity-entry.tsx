import { useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { InventoryActivityGroup } from "@shared/inventory-activity-groups";
import { inventoryActivityActionLabel } from "@shared/inventory-activity-groups";
import type { OperationsRow } from "@/lib/inventory-operations-data";
import type { InventoryReceipt, InventoryState } from "@shared/inventory";
import { removalStatusLabel } from "@shared/inventory-removal-display";
import { ReceiptPalletHistory } from "@/components/inventory/receipt-pallet-history";

type Props = { group: InventoryActivityGroup; row: OperationsRow; state: InventoryState;
  receiptSummary: (receipt: InventoryReceipt) => string; print: (kind: "receipt" | "count" | "activity", id: string) => void };

export function InventoryActivityEntry({ group, row, state, receiptSummary, print }: Props) {
  const [expanded, setExpanded] = useState(false);
  const statuses = [...new Set(state.returns.filter(record => group.returnIds.includes(record.id)).map(record => removalStatusLabel(record.status)))];
  const receipts = new Map(group.receipts.map(receipt => [receipt.id, receipt]));
  return <article className="min-w-0 rounded-md border bg-card px-3 py-3 sm:px-4" data-testid="inventory-activity-group">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <h3 className="break-words font-medium" data-testid="inventory-activity-title">{group.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{group.batch ? "Batch · " : ""}{group.receipts.length} {group.receipts.length === 1 ? "transaction" : "transactions"} · Last activity: {row.cells.date}</p>
        {!!statuses.length && <p className="mt-1 break-words text-xs">Current status: {statuses.join("; ")}</p>}
      </div>
      <Button size="sm" variant="outline" onClick={() => print("activity", group.id)}><Printer className="mr-2 h-4 w-4" />Print history</Button>
    </div>
    <details className="mt-3 min-w-0" onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary className="cursor-pointer text-sm">View transaction history ({group.receipts.length})</summary>
      {expanded && <div className="mt-2 space-y-3">
        <p className="text-xs text-muted-foreground">Complete related history, including transactions outside the current filters. Quantities are per transaction, not summed across the history.</p>
        <ol className="space-y-3">
          {(row.children ?? []).map(entry => {
            const receipt = receipts.get(entry.id);
            if (!receipt) return null;
            return <li key={entry.id} className="min-w-0 border-l-2 pl-3" data-testid="inventory-activity-transaction">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="break-words text-sm font-medium">{entry.cells.receipt} · {inventoryActivityActionLabel(receipt.action)}</p>
                <Button size="sm" variant="ghost" onClick={() => print(receipt.action.startsWith("count") ? "count" : "receipt", receipt.action.startsWith("count") ? receipt.reference : receipt.id)}>Print transaction</Button>
              </div>
              <p className="break-words text-xs text-muted-foreground">{entry.cells.date} · {entry.cells.actor} · {entry.cells.location}</p>
              <p className="mt-1 break-words text-xs">{entry.cells.reference}</p>
              <p className="mt-1 break-words text-xs">{receiptSummary(receipt)}</p>
              {!!receipt.pallets?.length && <ReceiptPalletHistory pallets={receipt.pallets} state={state} />}
              {(["items", "componentsOut", "componentsIn", "missingComponents", "inspectionSerials", "reason", "resolution",
                "externalReference", "fieldDisposition", "warehouseDisposition", "custodyEvent"] as const).map(key =>
                !!entry.cells[key] && <p key={key} className="mt-1 break-words text-xs"><span className="font-medium">{
                  ({ items: "Items", componentsOut: "Components consumed", componentsIn: "Components returned", missingComponents: "Missing components",
                    inspectionSerials: "Inspection serials", reason: "Notes", resolution: "Resolution", externalReference: "External reference",
                    fieldDisposition: "Field disposition (as recorded)", warehouseDisposition: "Warehouse decision (as recorded)", custodyEvent: "Custody event" })[key]
                }:</span> {entry.cells[key]}</p>)}
            </li>;
          })}
        </ol>
      </div>}
    </details>
  </article>;
}
