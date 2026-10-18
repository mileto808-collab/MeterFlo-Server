import { useMemo, useState } from "react";
import type { Allocation, InventoryItem, Warehouse } from "@shared/inventory";
import { inventoryComponentDetails as expandedComponents } from "@shared/inventory-component-details";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { plannedUseDrafts, plannedInventoryLabels, type PlannedStockMode, type ActualUseDraft } from "@shared/inventory-wizard-use";
export { initialActualUse, actualUseLinesAreValid, type ActualUseDraft } from "@shared/inventory-wizard-use";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Requirement = { itemId: string; quantity: number };

function recipeItemIds(itemId: string, items: InventoryItem[], ancestors = new Set<string>()): Set<string> {
  if (ancestors.has(itemId)) return new Set();
  const item = items.find(value => value.id === itemId);
  if (!item) return new Set();
  const result = new Set<string>([itemId]);
  const nextAncestors = new Set(ancestors).add(itemId);
  item.components.forEach(component => recipeItemIds(component.itemId, items, nextAncestors).forEach(id => result.add(id)));
  return result;
}

export function ActualUseCollector({ value, onChange, items, warehouses, requirements = [], missing = [], reservations = [], disabled = false }: {
  value: ActualUseDraft[];
  onChange: (next: ActualUseDraft[]) => void;
  items: InventoryItem[];
  warehouses: Warehouse[];
  requirements?: Requirement[];
  missing?: Array<{ equipment: "system" | "module"; typeId: string }>;
  reservations?: Allocation[];
  disabled?: boolean;
}) {
  const [newItem, setNewItem] = useState("");
  const [newWarehouse, setNewWarehouse] = useState("");
  const [newKitMode, setNewKitMode] = useState<PlannedStockMode>("components");
  const activeItems = useMemo(() => items.filter(item => item.active && item.kind !== "labor"), [items]);
  const activeWarehouses = useMemo(() => warehouses.filter(warehouse => warehouse.active), [warehouses]);
  const overlappingLine = value.find(line => Number(line.quantity) > 0 && line.itemId !== newItem &&
    (recipeItemIds(newItem, items).has(line.itemId) || recipeItemIds(line.itemId, items).has(newItem)));
  const duplicateSameStockLine = value.some(line => line.itemId === newItem && line.warehouseId === newWarehouse && Number(line.quantity) > 0);
  const addLine = () => {
    if (!newItem || !newWarehouse || overlappingLine || duplicateSameStockLine) return;
    const added = plannedUseDrafts([{ itemId: newItem, quantity: 1 }], items, newWarehouse, newKitMode, reservations);
    const combined = value.map(line => ({ ...line }));
    for (const line of added) {
      const prior = combined.find(row => row.itemId === line.itemId && row.warehouseId === line.warehouseId);
      if (prior) prior.quantity = String(Number(prior.quantity) + Number(line.quantity));
      else combined.push({ ...line, key: `actual-${crypto.randomUUID()}` });
    }
    onChange(combined.map(line => ({ ...line })));
    setNewItem("");
  };
  const planned = requirements.length > 0;
  const labels = plannedInventoryLabels(requirements, items);
  const kitMode: PlannedStockMode = value.some(line => items.find(item => item.id === line.itemId)?.components.length) ? "kits" : "components";
  const sources = [...new Set(value.map(line => line.warehouseId).filter(Boolean))];
  const source = sources.length === 1 && value.every(line => !!line.warehouseId) ? sources[0] : "";
  const changePlan = (warehouseId: string, mode: PlannedStockMode) =>
    onChange(plannedUseDrafts(requirements, items, warehouseId, mode, reservations));

  return <div className="space-y-4">
    {(planned || !!missing.length) && <section className="space-y-2" aria-label="Planned work-order requirements">
      <Label className="text-sm font-semibold">Inventory</Label>
      {!!labels.length && <ul className="space-y-1 text-sm">{labels.map(row => <li key={row.itemId} className="flex items-start justify-between gap-3">
        <span className="min-w-0 break-words">{row.label}{row.labor && <span className="text-xs text-muted-foreground"> · Labor (non-stock)</span>}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{row.quantity} {row.unit}</span>
      </li>)}</ul>}
      {!!missing.length && <div className="mt-2 flex gap-2 rounded border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-900 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>Some equipment types have no item mapping: {missing.map(row => `${row.equipment} type ${row.typeId}`).join(", ")}.</span></div>}
      {planned && <div className="grid gap-3 pt-2 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="planned-use-warehouse">Stock location</Label>
          <Select value={source} onValueChange={id => changePlan(id, kitMode)} disabled={disabled}>
            <SelectTrigger id="planned-use-warehouse"><SelectValue placeholder={sources.length > 1 ? "Using reserved locations" : "Choose vehicle or warehouse"} /></SelectTrigger>
            <SelectContent>{activeWarehouses.map(warehouse => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</SelectItem>)}</SelectContent>
          </Select>
          {sources.length > 1 && <p className="text-xs text-muted-foreground">{sources.map(id => warehouses.find(w => w.id === id)?.name ?? id).join(", ")}</p>}
        </div>
        {requirements.some(row => items.find(item => item.id === row.itemId)?.components.length) && <div className="space-y-1"><Label htmlFor="planned-stock-mode">Use stock as</Label>
          <Select value={kitMode} onValueChange={mode => changePlan(source, mode as PlannedStockMode)} disabled={disabled}>
            <SelectTrigger id="planned-stock-mode"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="components">Loose components</SelectItem><SelectItem value="kits">Preassembled kits</SelectItem></SelectContent>
          </Select>
        </div>}
      </div>}
      {value.filter(line => {
        const item = items.find(item => item.id === line.itemId);
        return item?.tracking === "serialized" && (!!item.components.length || item.equipment === "none");
      }).map(line => <div key={line.key} className="space-y-1">
          <Label htmlFor={`planned-kit-serial-${line.key}`}>{items.find(item => item.id === line.itemId)?.components.length ? "Kit serial" : `${items.find(item => item.id === line.itemId)?.name} serials`}</Label>
          <Input id={`planned-kit-serial-${line.key}`} value={line.serials} disabled={disabled} placeholder="Scan the assembled kit label"
            onChange={event => onChange(value.map(row => row.key === line.key ? { ...row, serials: event.target.value } : row))} />
        </div>)}
      {planned && <p className="text-xs text-muted-foreground">Stock is deducted at completion, not reserved here. Scan the new system/module serial in the next wizard step.</p>}
      {planned && value.some(line => line.reserved && Number(line.quantity) > (line.maxQuantity ?? 0)) &&
        <p role="alert" className="text-xs text-destructive">Planned quantity exceeds the reservation at this location. Update the reservation or choose another stock location.</p>}
    </section>}

    {!planned && !missing.length && <section className="space-y-2" aria-label="Actual items used">
      <div><h4 className="text-sm font-semibold">Actual items used</h4><p className="text-xs text-muted-foreground">Choose stock from the vehicle or another accessible location. No reservation is created.</p></div>
      {value.map((line, index) => {
        const item = items.find(entry => entry.id === line.itemId);
        const warehouse = warehouses.find(entry => entry.id === line.warehouseId);
        const quantity = Number(line.quantity);
        const serialCount = line.serials.split(/[\n,;]/).map(serial => serial.trim()).filter(Boolean).length;
         const wizardEquipmentScan = item?.tracking === "serialized" && !item.components.length && ["system", "module"].includes(item.equipment);
         const invalidSerials = !wizardEquipmentScan && item?.tracking === "serialized" && quantity > 0 && (serialCount !== quantity ||
          (line.reserved && line.serials.split(/[\n,;]/).map(serial => serial.trim()).filter(Boolean).some(serial => !(line.allowedSerials ?? []).includes(serial))));
        return <div key={line.key} className="rounded-md border p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><p className="break-words text-sm font-medium">{item?.name ?? line.itemId}</p><p className="text-xs text-muted-foreground">{warehouse?.code ?? line.warehouseId} · {line.reserved ? `Reserved · max ${line.maxQuantity}` : "Vehicle / accessible stock"}{item?.components.length ? " · kit" : ""}</p></div>
            {!line.reserved && <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${item?.name ?? "actual use line"}`} disabled={disabled} onClick={() => onChange(value.filter(entry => entry.key !== line.key))}><Trash2 className="h-4 w-4" /></Button>}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[130px_1fr]">
            <div className="space-y-1"><Label htmlFor={`actual-use-qty-${line.key}`}>Used quantity</Label><Input id={`actual-use-qty-${line.key}`} type="number" inputMode="numeric" min="0" max={line.reserved ? line.maxQuantity : undefined} value={line.quantity} disabled={disabled} onChange={event => onChange(value.map(entry => entry.key === line.key ? { ...entry, quantity: event.target.value } : entry))} /></div>
             {item?.tracking === "serialized" && (!item.components.length && ["system", "module"].includes(item.equipment)
               ? <p className="self-center text-xs text-muted-foreground">Scan the new {item.equipment} serial in the next wizard step.</p>
               : <div className="space-y-1"><Label htmlFor={`actual-use-serials-${line.key}`}>{item.components.length ? "Kit serial" : "Serials used"}</Label><Input id={`actual-use-serials-${line.key}`} value={line.serials} disabled={disabled} onChange={event => onChange(value.map(entry => entry.key === line.key ? { ...entry, serials: event.target.value } : entry))} placeholder={line.reserved ? "Reserved serials only" : "One serial per unit"} /><p className="text-xs text-muted-foreground">{line.reserved ? `Use only serials reserved here (${(line.allowedSerials ?? []).join(", ") || "none"}).` : "Separate serials with commas or new lines."}</p></div>)}
          </div>
          {!!item?.components.length && <details className="mt-2 text-xs"><summary className="cursor-pointer text-muted-foreground">View kit components</summary><ul className="mt-1 border-l pl-3 text-muted-foreground">{expandedComponents(item.id, Math.max(0, quantity || 0), items).map((component, componentIndex) => <li key={`${line.key}-component-${componentIndex}`} className="py-0.5">{component.label} · {component.quantity}</li>)}</ul></details>}
        {invalidSerials && <p role="alert" className="mt-2 text-xs text-destructive">{line.reserved ? "Enter only reserved serials, matching the quantity." : "Enter one unique serial for each unit used."}</p>}
         {wizardEquipmentScan && quantity > 1 && <p role="alert" className="mt-2 text-xs text-destructive">Use one serialized {item?.equipment} per changeout.</p>}
        </div>;
      })}
      <div className="grid gap-2 rounded-md border border-dashed p-3 sm:grid-cols-[1fr_1fr_auto]">
         <div className="space-y-1"><Label htmlFor="actual-use-item">Add an item or kit</Label><Select value={newItem} onValueChange={setNewItem} disabled={disabled}><SelectTrigger id="actual-use-item"><SelectValue placeholder="Choose catalog item" /></SelectTrigger><SelectContent>{activeItems.map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}{item.components.length ? " · kit" : ""}</SelectItem>)}</SelectContent></Select></div>
        <div className="space-y-1"><Label htmlFor="actual-use-warehouse">Stock location</Label><Select value={newWarehouse} onValueChange={setNewWarehouse}><SelectTrigger id="actual-use-warehouse"><SelectValue placeholder="Vehicle or warehouse" /></SelectTrigger><SelectContent>{activeWarehouses.map(warehouse => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</SelectItem>)}</SelectContent></Select></div>
        <Button type="button" className="self-end" variant="outline" disabled={disabled || !newItem || !newWarehouse || !!overlappingLine || duplicateSameStockLine} onClick={addLine}><Plus className="mr-1 h-4 w-4" />Add</Button>
      </div>
       {!!items.find(item => item.id === newItem)?.components.length && <div className="space-y-1"><Label htmlFor="manual-kit-mode">Use selected kit as</Label>
         <Select value={newKitMode} onValueChange={mode => setNewKitMode(mode as PlannedStockMode)} disabled={disabled}>
           <SelectTrigger id="manual-kit-mode"><SelectValue /></SelectTrigger>
           <SelectContent><SelectItem value="components">Loose components</SelectItem><SelectItem value="kits">Preassembled kit</SelectItem></SelectContent>
         </Select>
       </div>}
      {(overlappingLine || duplicateSameStockLine) && <p role="status" className="text-xs text-amber-800 dark:text-amber-200">This item overlaps an existing kit recipe or stock line. Edit that line instead to avoid counting the same physical components twice.</p>}
    </section>}
  </div>;
}
