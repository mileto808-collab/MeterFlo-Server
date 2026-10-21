import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { InventoryItem } from "@shared/inventory";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

export function OrderItemPicker({ id, items, value, onValueChange }: {
  id: string; items: InventoryItem[]; value: string; onValueChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = items.find(item => item.id === value);
  const words = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matching = items.filter(item => item.active && item.kind !== "labor" && words.every(word =>
    [item.sku, item.name, item.description, item.category, item.barcode, item.manufacturer, item.model, item.unit]
      .filter(Boolean).join(" ").toLocaleLowerCase().includes(word)));
  return <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setSearch(""); }}>
    <PopoverTrigger asChild>
      <Button id={id} type="button" variant="outline" role="combobox" aria-label="Item"
        aria-expanded={open} className="w-full min-w-0 justify-between font-normal">
        <span className={`truncate ${selected ? "" : "text-muted-foreground"}`}>
          {selected ? `${selected.sku} · ${selected.name}` : "Select item"}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" collisionPadding={8} className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] p-0">
      <Command shouldFilter={false}>
        <CommandInput value={search} onValueChange={setSearch} aria-label="Search order items"
          placeholder="Search SKU, name, description…" />
        <CommandList className="max-h-[min(18rem,calc(var(--radix-popover-content-available-height)-3.5rem))]">
          <CommandEmpty>No matching items.</CommandEmpty>
          {matching.map(item => <CommandItem key={item.id} value={item.id}
            onSelect={() => { onValueChange(item.id); setOpen(false); setSearch(""); }}>
            <Check className={`mr-2 h-4 w-4 shrink-0 ${item.id === value ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
            <span className="min-w-0">
              <span className="block break-words">{item.sku} · {item.name}</span>
              {item.description && <span className="block break-words text-xs text-muted-foreground">{item.description}</span>}
            </span>
          </CommandItem>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}
