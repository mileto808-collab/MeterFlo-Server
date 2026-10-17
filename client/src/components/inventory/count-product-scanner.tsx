import { useRef, useState } from "react";
import type { InventoryItem } from "@shared/inventory";
import { resolveCountProductScan } from "@/lib/inventory-count-recovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScanBarcode } from "lucide-react";

export function CountProductScanner({ items, existingIds, onAdd, disabled, id }: {
  items: InventoryItem[]; existingIds: string[]; onAdd: (id: string) => void; disabled?: boolean; id: string;
}) {
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const scan = () => {
    if (disabled) return;
    const result = resolveCountProductScan(items, code, existingIds);
    if ("item" in result && result.item) {
      onAdd(result.item.id);
      setMessage(`Added ${result.item.name}. Enter its actual quantity and any required serials separately.`);
    } else setMessage(result.error ?? "Product could not be added.");
    setCode("");
    input.current?.focus();
  };
  return <div className="min-w-0 space-y-1" data-testid={id}>
    <Label htmlFor={`${id}-input`}>Scan product barcode or SKU</Label>
    <div className="flex min-w-0 gap-2">
      <Input ref={input} id={`${id}-input`} value={code} disabled={disabled}
        autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={500}
        placeholder="Tap here, then scan a product"
        aria-describedby={`${id}-help`}
        onChange={event => setCode(event.target.value)}
        onKeyDown={event => {
          if (!event.nativeEvent.isComposing && (event.key === "Enter" || (event.key === "Tab" && code.trim()))) {
            event.preventDefault(); scan();
          }
        }} />
      <Button type="button" variant="outline" className="h-10 shrink-0 gap-2" disabled={disabled || !code.trim()} onClick={scan}>
        <ScanBarcode className="h-4 w-4" aria-hidden="true" /><span>Add</span>
      </Button>
    </div>
    <p id={`${id}-help`} className="text-xs text-muted-foreground">USB/Bluetooth keyboard scanners: Enter or Tab adds a product and keeps scanning ready. Product codes are not unit serials.</p>
    {message && <p role="status" className="break-words text-sm">{message}</p>}
  </div>;
}
