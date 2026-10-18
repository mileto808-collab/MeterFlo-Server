import type { InventoryItem } from "@shared/inventory";
import { kitRecipeRates, isLaborItem } from "@shared/inventory-pricing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function InventoryItemComponents({ item, items, onChange }: {
  item: InventoryItem; items: InventoryItem[]; onChange: (item: InventoryItem) => void;
}) {
  if (isLaborItem(item)) return null;
  const rates = kitRecipeRates(item, items);
  return <section className="space-y-2 sm:col-span-2" aria-label="Kit components">
    <Label>Kit components</Label>
    <p className="text-xs text-muted-foreground">Leave empty for a standalone item. A stock kit needs at least one physical component.
      Add labor in its configured units (for example 1.5 hours); physical components require whole quantities. Up to 100 lines, maximum 1,000,000 units each.
      Existing custody restrictions still apply to recipe changes.</p>
    {item.components.map((component, index) => {
      const child = items.find(value => value.id === component.itemId), labor = isLaborItem(child);
      return <div className="flex flex-wrap items-start gap-2 rounded-md border p-2" key={`${component.itemId}-${index}`}>
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`kit-component-${index}`}>Component {index + 1}</Label>
          <Select value={component.itemId} onValueChange={itemId => onChange({ ...item, components: item.components.map((entry, i) => i === index ? { ...entry, itemId } : entry) })}>
            <SelectTrigger id={`kit-component-${index}`}><SelectValue placeholder="Choose component" /></SelectTrigger>
            <SelectContent>{items.filter(value => value.id !== item.id && (value.active || value.id === component.itemId)).map(value =>
              <SelectItem value={value.id} key={value.id}>{value.sku} · {value.name}{isLaborItem(value) ? ` · Labor / ${value.unit}` : ""}</SelectItem>)}</SelectContent>
          </Select>
          {child && <p className="text-xs text-muted-foreground">Cost {child.cost.toFixed(2)} · Billed {(child.billingRate ?? 0).toFixed(2)} / {child.unit}{labor ? " · No stock required" : ""}</p>}
        </div>
        <div className="w-28 space-y-1">
          <Label htmlFor={`kit-quantity-${index}`}>{child?.unit || "Quantity"}</Label>
          <Input id={`kit-quantity-${index}`} aria-label={`Quantity for component ${index + 1}`} type="number" min={labor ? "0.001" : "1"} max="1000000" step={labor ? "0.001" : "1"} value={component.quantity}
            onChange={event => onChange({ ...item, components: item.components.map((entry, i) => i === index ? { ...entry, quantity: Number(event.target.value) } : entry) })} />
        </div>
        <Button type="button" variant="ghost" aria-label={`Remove component ${index + 1}`} onClick={() => onChange({ ...item, components: item.components.filter((_, i) => i !== index) })}>Remove</Button>
      </div>;
    })}
    <Button type="button" variant="outline" disabled={item.components.length >= 100 || !items.some(value => value.active && value.id !== item.id)}
      onClick={() => onChange({ ...item, components: [...item.components, { itemId: items.find(value => value.active && value.id !== item.id)!.id, quantity: 1 }] })}>Add component</Button>
    {item.components.length > 0 && <div className="space-y-2 rounded-md border bg-muted/20 p-3" data-testid="kit-recipe-rates">
      <p className="text-sm">Recipe estimate per kit: cost <strong>{rates.cost.toFixed(2)}</strong> · billed <strong>{rates.billingRate.toFixed(2)}</strong></p>
      <p className="text-xs text-muted-foreground">Includes physical items and labor at current component rates. Configured kit rates stay independent unless you apply these estimates.</p>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...item, cost: Math.round(rates.cost * 100) / 100 })}>Use recipe cost</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange({ ...item, billingRate: Math.round(rates.billingRate * 100) / 100 })}>Use recipe billing rate</Button></div>
    </div>}
  </section>;
}
