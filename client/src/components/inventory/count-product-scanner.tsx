import { useRef, useState } from "react";
import type { InventoryItem } from "@shared/inventory";
import { resolveCountProductScan } from "@/lib/inventory-count-recovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScanBarcode } from "lucide-react";

export function CountProductScanner({ items, existingIds, onAdd, disabled, id, value, onValueChange }: {
  items: InventoryItem[]; existingIds: string[]; onAdd: (id: string) => void; disabled?: boolean; id: string;
  value?: string; onValueChange?: (value: string) => void;
}) {
  const [localCode, setLocalCode] = useState("");
  const code = value ?? localCode;
  const setCode = (next: string) => { setLocalCode(next); onValueChange?.(next); };
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const scan = () => {
    if (disabled) return;
    const result = resolveCountProductScan(items, code, existingIds);
    if ("item" in result && result.item) {
      onAdd(result.item.id);
      setMessage(`Added ${result.item.name}. Enter its actual quantity and any required serials separately.`);
      setCode("");
    } else setMessage(result.error ?? "Product could not be added.");
  };
  return <div className="min-w-0 space-y-1" data-testid={id}>
    <Label htmlFor={`${id}-input`}>Search products or scan barcode</Label>
    <div className="flex min-w-0 gap-2">
      <Input ref={input} id={`${id}-input`} value={code} disabled={disabled}
        autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={500}
        placeholder="Barcode, SKU, name or description"
        aria-describedby={`${id}-help`}
        onChange={event => { setCode(event.target.value); setMessage(""); }}
        onKeyDown={event => {
          if (!event.nativeEvent.isComposing && (event.key === "Enter" || (event.key === "Tab" && code.trim()))) {
            event.preventDefault(); scan();
          }
        }} />
      <Button type="button" variant="outline" className="h-10 shrink-0 gap-2" disabled={disabled || !code.trim()} onClick={scan}>
        <ScanBarcode className="h-4 w-4" aria-hidden="true" /><span>Add</span>
      </Button>
    </div>
    <p id={`${id}-help`} className="text-xs text-muted-foreground">Search narrows products and count entries. Enter or Tab adds an exact match or the only matching product; otherwise choose below. Product codes are not unit serials.</p>
    {message && <p role="status" className="break-words text-sm">{message}</p>}
  </div>;
}
