import { useMemo } from "react";
import type { InventoryState } from "@shared/inventory";
import type { FulfillmentBatch } from "@shared/inventory-fulfillment";
import { buildOperationsDataset } from "@/lib/inventory-operations-data";
import { InventoryRecordsWorkspace } from "@/components/inventory-records-workspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export function FulfillmentBatchHistory({ state, batches, timezone, projectName, onRefresh, onPrint }: {
  state: InventoryState; batches: FulfillmentBatch[]; timezone: string; projectName: string;
  onRefresh: () => void; onPrint: (id: string) => void;
}) {
  const dataset = useMemo(() => buildOperationsDataset("fulfillment", { ...state, fulfillmentBatches: batches }, [], [], timezone),
    [state, batches, timezone]);
  return <div className="flex min-h-0 flex-1 flex-col" data-testid="fulfillment-batch-history">
    <InventoryRecordsWorkspace kind="fulfillment" title="Completed batches"
      description="Completed physical staging and vehicle handoffs. Search work orders, batch names, items, locations or custody serials. Exports include all matching batches."
      dataset={dataset} projectName={projectName} timezone={timezone} onRefresh={onRefresh}
      renderRow={row => <article className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h4 className="break-words font-semibold">{row.cells.name} <Badge variant="secondary">Completed</Badge></h4>
            <p className="mt-1 text-xs text-muted-foreground">{row.cells.mode} · {row.cells.orderCount} work orders · {row.cells.completed}</p></div>
          <Button type="button" size="sm" variant="outline" onClick={() => onPrint(row.id)}>
            <Printer className="mr-2 h-4 w-4" />Print combined receipt
          </Button>
        </div>
        <p className="text-sm">Source: {row.cells.source} → Staging: {row.cells.staging} → Vehicle: {row.cells.vehicle}</p>
        <p className="text-sm">Staged {row.cells.staged} / {row.cells.quantity} · Handed off {row.cells.delivered} / {row.cells.quantity}</p>
        <details className="text-sm"><summary className="cursor-pointer">Work orders and items</summary>
          <p className="mt-2 break-words">Work orders: {row.cells.workOrders}</p><p className="mt-1 break-words">Items: {row.cells.items}</p>
          {!!row.cells.serials && <p className="mt-1 break-words">Custody serials: {row.cells.serials}</p>}
        </details>
      </article>} />
  </div>;
}
