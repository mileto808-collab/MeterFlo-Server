import { useRef, useState } from "react";
import { ListOrdered, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { InventoryItem } from "@shared/inventory";

type CountSerialsDialogProps = {
  item: InventoryItem;
  actualQuantity: string;
  serials: string;
  open: boolean;
  disabled: boolean;
  onOpenChange: (open: boolean) => void;
  onSerialsChange: (serials: string) => void;
};

function enteredSerialCount(value: string) {
  return value.split(/[\n,;]/).filter(serial => serial.trim().length > 0).length;
}

export function CountSerialsDialog({
  item, actualQuantity, serials, open, disabled, onOpenChange, onSerialsChange,
}: CountSerialsDialogProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const scanInputRef = useRef<HTMLInputElement>(null);
  const serialsRef = useRef<HTMLTextAreaElement>(null);
  const [scanValue, setScanValue] = useState("");
  const count = enteredSerialCount(serials);

  const addSerial = () => {
    if (!scanValue.length || disabled) return;
    const separator = serials.length > 0 && !/\n$/.test(serials) ? "\n" : "";
    onSerialsChange(`${serials}${separator}${scanValue}\n`);
    setScanValue("");
    requestAnimationFrame(() => {
      if (serialsRef.current) serialsRef.current.scrollTop = serialsRef.current.scrollHeight;
      scanInputRef.current?.focus();
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="inventory-count-serials-dialog"
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)]"
        onOpenAutoFocus={event => {
          event.preventDefault();
          headingRef.current?.focus();
        }}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left sm:px-6">
          <DialogTitle ref={headingRef} tabIndex={-1} className="text-lg outline-none">
            Review serials
          </DialogTitle>
          <DialogDescription>
            {item.name} <span className="font-mono">· {item.sku}</span>
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-sm">
            <span className="font-semibold tabular-nums">{count} entered</span>
            <span className="text-muted-foreground">{actualQuantity.trim() ? `of ${actualQuantity} actual units` : "Actual quantity not entered"}</span>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
          <div className="space-y-2">
            <label htmlFor={`serial-review-${item.id}`} className="text-sm font-medium">Serials, one per line</label>
            <Textarea
              ref={serialsRef}
              id={`serial-review-${item.id}`}
              aria-label="Serials, one per line"
              value={serials}
              disabled={disabled}
              onChange={event => onSerialsChange(event.target.value)}
              className="min-h-44 resize-y font-mono text-sm leading-6"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
            />
            <p className="text-xs text-muted-foreground">Paste or edit the full list here. Duplicates and quantity mismatches are checked before posting. Save the count draft on the count page to keep your entries.</p>
          </div>

          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <ListOrdered className="h-4 w-4" aria-hidden="true" />
              Scan one serial
            </div>
            <div className="flex min-w-0 gap-2">
              <Input
                ref={scanInputRef}
                aria-label="Scan serial number"
                value={scanValue}
                disabled={disabled}
                onChange={event => setScanValue(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter" || event.key === "\r") {
                    event.preventDefault();
                    addSerial();
                  }
                }}
                placeholder="Scan or type a serial"
                className="min-w-0 font-mono"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <Button type="button" onClick={addSerial} disabled={disabled || !scanValue.length} className="shrink-0">
                <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Add serial
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">HID scanners: use an Enter suffix. Each scan adds a new line and leaves this field ready for the next scan.</p>
          </div>
        </div>

        <DialogFooter className="shrink-0 border-t bg-background px-5 py-3 sm:px-6">
          <Button type="button" onClick={() => onOpenChange(false)} disabled={disabled} className="min-h-11 w-full sm:w-auto">
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
