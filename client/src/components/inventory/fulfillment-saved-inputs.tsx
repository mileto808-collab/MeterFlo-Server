import type { InventoryItem } from "@shared/inventory";
import type { SavedFulfillmentInputs } from "@/lib/fulfillment-draft-reconciliation";

export function FulfillmentSavedInputs({ draft, items }: { draft: SavedFulfillmentInputs; items: InventoryItem[] }) {
  const itemMap = new Map(items.map(item => [item.id, item]));
  const keys = [...new Set([...Object.keys(draft.quantities), ...Object.keys(draft.serialText)])];
  return <div className="space-y-3 rounded-md border p-3 text-sm" data-testid="fulfillment-retained-inputs">
    <p className="font-medium">Local unrecorded inputs — for review only</p>
    <p className="text-muted-foreground">These inputs were not submitted by this device. Compare them with the batch receipt before starting another workflow. They will not be posted automatically.</p>
    {keys.filter(key => draft.quantities[key]?.trim() || draft.serialText[key]?.trim()).map(key => {
      const item = itemMap.get(key.slice(key.indexOf(":") + 1));
      return <div key={key} className="space-y-1 border-t pt-2">
        <p className="font-medium">{key.startsWith("stage:") ? "Staging" : "Vehicle handoff"} · {item ? `${item.name} · ${item.sku}` : "Item no longer available"}</p>
        <p>Saved quantity: {draft.quantities[key] || "Not entered"}</p>
        {draft.serialText[key]?.trim() && <p className="whitespace-pre-wrap break-words">Saved serials: {draft.serialText[key]}</p>}
      </div>;
    })}
    {draft.reason && <p className="break-words">Move reason: {draft.reason}</p>}
    {draft.closeReason && <p className="break-words">Release reason: {draft.closeReason}</p>}
    {draft.physicallyConfirmed && <p>Physical movement confirmation was checked locally.</p>}
  </div>;
}
