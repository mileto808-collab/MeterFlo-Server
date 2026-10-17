import { useMemo, useState } from "react";
import type { Allocation, InventoryItem, Warehouse } from "@shared/inventory";
import { AlertTriangle, Boxes, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ActualUseDraft = {
  key: string;
  itemId: string;
  warehouseId: string;
  quantity: string;
  serials: string;
  reserved: boolean;
  maxQuantity?: number;
  allowedSerials?: string[];
};

type Requirement = { itemId: string; quantity: number };

export function initialActualUse(allocation: { lines: Allocation[] } | null | undefined): ActualUseDraft[] {
  return (allocation?.lines ?? []).map((line, index) => ({
    key: `reserved-${line.warehouseId}-${line.itemId}-${index}`,
    itemId: line.itemId,
    warehouseId: line.warehouseId,
    quantity: "0",
    serials: "",
    reserved: true,
    maxQuantity: line.quantity,
    allowedSerials: line.serials,
  }));
}

export function actualUseLinesAreValid(lines: ActualUseDraft[], items: InventoryItem[]): boolean {
  return lines.every(line => {
    const quantity = Number(line.quantity);
    if (!Number.isInteger(quantity) || quantity < 0 || (line.reserved && quantity > (line.maxQuantity ?? 0))) return false;
    if (!quantity) return true;
    const item = items.find(value => value.id === line.itemId);
    if (item?.tracking !== "serialized") return true;
    const serials = line.serials.split(/[\n,;]/).map(value => value.trim()).filter(Boolean);
    if (serials.length !== quantity || new Set(serials).size !== serials.length) return false;
    return !line.reserved || serials.every(serial => (line.allowedSerials ?? []).includes(serial));
  });
}

function expandedComponents(itemId: string, quantity: number, items: InventoryItem[], ancestors = new Set<string>()): Array<{ label: string; quantity: number; depth: number }> {
  const item = items.find(value => value.id === itemId);
  if (!item?.components.length || ancestors.has(itemId)) return [];
  const nextAncestors = new Set(ancestors).add(itemId);
  return item.components.flatMap(component => {
    if (nextAncestors.has(component.itemId)) return [];
    const total = quantity * component.quantity;
    const child = items.find(value => value.id === component.itemId);
    const row = { label: child?.name ?? component.itemId, quantity: total, depth: nextAncestors.size };
    return [row, ...expandedComponents(component.itemId, total, items, nextAncestors)];
  });
}

function recipeItemIds(itemId: string, items: InventoryItem[], ancestors = new Set<string>()): Set<string> {
  if (ancestors.has(itemId)) return new Set();
  const item = items.find(value => value.id === itemId);
  if (!item) return new Set();
  const result = new Set<string>([itemId]);
  const nextAncestors = new Set(ancestors).add(itemId);
  item.components.forEach(component => recipeItemIds(component.itemId, items, nextAncestors).forEach(id => result.add(id)));
  return result;
}

export function ActualUseCollector({ value, onChange, items, warehouses, requirements = [], missing = [], disabled = false }: {
  value: ActualUseDraft[];
  onChange: (next: ActualUseDraft[]) => void;
  items: InventoryItem[];
  warehouses: Warehouse[];
  requirements?: Requirement[];
  missing?: Array<{ equipment: "system" | "module"; typeId: string }>;
  disabled?: boolean;
}) {
  const [newItem, setNewItem] = useState("");
  const [newWarehouse, setNewWarehouse] = useState("");
  const activeItems = useMemo(() => items.filter(item => item.active), [items]);
  const activeWarehouses = useMemo(() => warehouses.filter(warehouse => warehouse.active), [warehouses]);
  const overlappingLine = value.find(line => Number(line.quantity) > 0 && line.itemId !== newItem &&
    (recipeItemIds(newItem, items).has(line.itemId) || recipeItemIds(line.itemId, items).has(newItem)));
  const duplicateSameStockLine = value.some(line => line.itemId === newItem && line.warehouseId === newWarehouse && Number(line.quantity) > 0);
  const addLine = () => {
    if (!newItem || !newWarehouse || overlappingLine || duplicateSameStockLine) return;
    onChange([...value, { key: `actual-${crypto.randomUUID()}`, itemId: newItem, warehouseId: newWarehouse, quantity: "1", serials: "", reserved: false }]);
    setNewItem("");
  };
  const requirementsByItem = new Map<string, number>();
  requirements.forEach(line => requirementsByItem.set(line.itemId, (requirementsByItem.get(line.itemId) ?? 0) + line.quantity));

  return <div className="space-y-4">
    <section className="rounded-md border bg-muted/20 p-3" aria-label="Planned work-order requirements">
      <div className="mb-2 flex items-center gap-2"><Boxes className="h-4 w-4 text-primary" /><h4 className="text-sm font-semibold">Planned requirements</h4><Badge variant="outline">Not reserved</Badge></div>
      {requirementsByItem.size ? <ul className="space-y-2 text-sm">{[...requirementsByItem].map(([itemId, quantity]) => {
        const item = items.find(entry => entry.id === itemId);
        const components = expandedComponents(itemId, quantity, items);
        return <li key={itemId} className="rounded border bg-background px-2.5 py-2">
          <div className="flex justify-between gap-2"><span className="font-medium">{item?.name ?? itemId}</span><span className="tabular-nums">{quantity} {item?.unit ?? "units"}</span></div>
          {!!components.length && <ul className="mt-1 border-l pl-3 text-xs text-muted-foreground">{components.map((component, index) => <li key={`${itemId}-${index}`} className="py-0.5">{component.label} · {component.quantity} required</li>)}</ul>}
        </li>;
      })}</ul> : <p className="text-sm text-muted-foreground">No mapped items are required for the assigned equipment types.</p>}
      {!!missing.length && <div className="mt-2 flex gap-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-900 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>Some equipment types have no item mapping: {missing.map(row => `${row.equipment} type ${row.typeId}`).join(", ")}.</span></div>}
    </section>

    <section className="space-y-2" aria-label="Actual items used">
      <div><h4 className="text-sm font-semibold">Actual items used</h4><p className="text-xs text-muted-foreground">Choose stock from the vehicle or another accessible location. No reservation is created.</p></div>
      {value.map((line, index) => {
        const item = items.find(entry => entry.id === line.itemId);
        const warehouse = warehouses.find(entry => entry.id === line.warehouseId);
        const quantity = Number(line.quantity);
        const serialCount = line.serials.split(/[\n,;]/).map(serial => serial.trim()).filter(Boolean).length;
        const invalidSerials = item?.tracking === "serialized" && quantity > 0 && (serialCount !== quantity ||
          (line.reserved && line.serials.split(/[\n,;]/).map(serial => serial.trim()).filter(Boolean).some(serial => !(line.allowedSerials ?? []).includes(serial))));
        return <div key={line.key} className="rounded-md border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="break-words text-sm font-medium">{item?.name ?? line.itemId}</p><p className="text-xs text-muted-foreground">{warehouse?.code ?? line.warehouseId} · {line.reserved ? `Reserved · max ${line.maxQuantity}` : "Vehicle / accessible stock"}{item?.components.length ? " · kit" : ""}</p></div>
            {!line.reserved && <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${item?.name ?? "actual use line"}`} disabled={disabled} onClick={() => onChange(value.filter(entry => entry.key !== line.key))}><Trash2 className="h-4 w-4" /></Button>}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[130px_1fr]">
            <div className="space-y-1"><Label htmlFor={`actual-use-qty-${line.key}`}>Used quantity</Label><Input id={`actual-use-qty-${line.key}`} type="number" inputMode="numeric" min="0" max={line.reserved ? line.maxQuantity : undefined} value={line.quantity} disabled={disabled} onChange={event => onChange(value.map(entry => entry.key === line.key ? { ...entry, quantity: event.target.value } : entry))} /></div>
            {item?.tracking === "serialized" && <div className="space-y-1"><Label htmlFor={`actual-use-serials-${line.key}`}>Serials used</Label><Input id={`actual-use-serials-${line.key}`} value={line.serials} disabled={disabled} onChange={event => onChange(value.map(entry => entry.key === line.key ? { ...entry, serials: event.target.value } : entry))} placeholder={line.reserved ? "Reserved serials only" : "One serial per unit"} /><p className="text-xs text-muted-foreground">{line.reserved ? `Use only serials reserved here (${(line.allowedSerials ?? []).join(", ") || "none"}).` : "Separate serials with commas or new lines."}</p></div>}
          </div>
          {!!item?.components.length && <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted-foreground">View kit components</summary><ul className="mt-1 border-l pl-3 text-muted-foreground">{expandedComponents(item.id, Math.max(0, quantity || 0), items).map((component, componentIndex) => <li key={`${line.key}-component-${componentIndex}`} className="py-0.5">{component.label} · {component.quantity}</li>)}</ul></details>}
        {invalidSerials && <p role="alert" className="mt-2 text-xs text-destructive">{line.reserved ? "Enter only reserved serials, matching the quantity." : "Enter one unique serial for each unit used."}</p>}
        </div>;
      })}
      <div className="grid gap-2 rounded-md border border-dashed p-3 sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1"><Label htmlFor="actual-use-item">Add an item or preassembled kit</Label><Select value={newItem} onValueChange={setNewItem}><SelectTrigger id="actual-use-item"><SelectValue placeholder="Choose catalog item" /></SelectTrigger><SelectContent>{activeItems.map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}{item.components.length ? " · kit" : ""}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="actual-use-warehouse">Stock location</Label><Select value={newWarehouse} onValueChange={setNewWarehouse}><SelectTrigger id="actual-use-warehouse"><SelectValue placeholder="Vehicle or warehouse" /></SelectTrigger><SelectContent>{activeWarehouses.map(warehouse => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</SelectItem>)}</SelectContent></Select></div>
        <Button type="button" className="self-end" variant="outline" disabled={disabled || !newItem || !newWarehouse || !!overlappingLine || duplicateSameStockLine} onClick={addLine}><Plus className="mr-1 h-4 w-4" />Add</Button>
      </div>
      {(overlappingLine || duplicateSameStockLine) && <p role="status" className="text-xs text-amber-800 dark:text-amber-200">This item overlaps an existing kit recipe or stock line. Edit that line instead to avoid counting the same physical components twice.</p>}
    </section>
  </div>;
}
