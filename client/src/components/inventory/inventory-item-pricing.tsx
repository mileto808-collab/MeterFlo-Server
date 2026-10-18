import type { InventoryItem } from "@shared/inventory";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function InventoryItemPricing({ item, onChange }: { item: InventoryItem; onChange: (item: InventoryItem) => void }) {
  const labor = item.kind === "labor";
  return <>
    <div className="space-y-1.5">
      <Label htmlFor="item-kind">Item type</Label>
      <Select value={item.kind ?? "stock"} onValueChange={kind => onChange({ ...item, kind: kind as "stock" | "labor",
        unit: kind === "labor" && item.unit === "each" ? "hour" : item.unit })}>
        <SelectTrigger id="item-kind"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="stock">Physical stock</SelectItem>
          <SelectItem value="labor" disabled={!!item.components.length || item.tracking === "serialized" || item.equipment !== "none"}>Labor — non-stock service</SelectItem></SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Labor can be included in kits but is never received, counted, reserved or returned as stock. Item type changes are restricted once referenced.</p>
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="item-unit">{labor ? "Labor rate unit" : "Unit"}</Label>
      <Input id="item-unit" required maxLength={200} list={labor ? "labor-rate-units" : undefined} value={item.unit}
        onChange={event => onChange({ ...item, unit: event.target.value })} />
      <datalist id="labor-rate-units"><option value="hour">Hourly</option><option value="day">Daily</option><option value="week">Weekly</option><option value="job">Per job</option></datalist>
      <p className="text-xs text-muted-foreground">{labor ? "Choose or enter hour, day, week, job or another rate basis. Kit labor quantities support up to three decimal places." : "Rates are per unit, such as each or box. Physical inventory quantities remain whole numbers."}</p>
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="item-cost">Unit cost</Label>
      <Input id="item-cost" type="number" min="0" step="any" value={item.cost}
        onChange={event => onChange({ ...item, cost: Number(event.target.value) })} />
      <p className="text-xs text-muted-foreground">Your internal cost per {item.unit || "unit"}. Available for every item type.</p>
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="item-billing-rate">Billing rate</Label>
      <Input id="item-billing-rate" type="number" min="0" step="any" value={item.billingRate ?? 0}
        onChange={event => onChange({ ...item, billingRate: Number(event.target.value) })} />
      <p className="text-xs text-muted-foreground">Customer rate per {item.unit || "unit"}, independent of cost. Saving a rate does not create an invoice.</p>
    </div>
  </>;
}
