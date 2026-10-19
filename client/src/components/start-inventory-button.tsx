import { Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";

export function StartInventoryButton({ mobile = false }: { mobile?: boolean }) {
  return <Button type="button" size={mobile ? "default" : "sm"} disabled
    title="Inventory guided workflows will be added in a later step."
    aria-description="Inventory guided workflows are not available yet."
    data-testid={`button-start-inventory-${mobile ? "mobile" : "desktop"}`}
    className={mobile
      ? "inventory-start-mobile flex w-full shrink-0 bg-green-600 text-white dark:bg-green-600 md:hidden"
      : "inventory-start-desktop hidden shrink-0 bg-green-600 text-white dark:bg-green-600 md:inline-flex"}>
    <Boxes className={mobile ? "mr-1.5 h-4 w-4" : "mr-1 h-3.5 w-3.5"} />
    <span className={mobile ? "text-base font-bold" : undefined}>Start Inventory</span>
  </Button>;
}
