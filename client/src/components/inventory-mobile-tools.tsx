import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type InventoryMobileToolsProps = {
  children: ReactNode;
  label?: string;
  tab: string;
};

export function InventoryMobileTools({ children, label = "Search & Tools", tab }: InventoryMobileToolsProps) {
  const [open, setOpen] = useState(() => typeof window !== "undefined" && window.innerWidth >= 768);

  return (
    <div className="shrink-0">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mb-2 flex h-9 w-full justify-between md:hidden"
        aria-expanded={open}
        aria-controls={`inventory-mobile-tools-${tab}`}
        data-testid={`inventory-mobile-tools-${tab}-toggle`}
        onClick={() => setOpen(value => !value)}
      >
        <span className="flex items-center gap-2">
          <Settings2 className="h-4 w-4" />
          {open ? `Hide ${label}` : `Show ${label}`}
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </Button>
      {/* Keep controls mounted while collapsed so filters, focus, and draft inputs survive. */}
      <div id={`inventory-mobile-tools-${tab}`} data-testid={`inventory-mobile-tools-${tab}`} className={`${open ? "block" : "hidden"} md:block`}>{children}</div>
    </div>
  );
}
