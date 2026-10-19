import { ChevronDown, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export const inventoryTabs = [
  { value: "stock", label: "Stock & search" },
  { value: "locations", label: "Locations" },
  { value: "items", label: "Items" },
  { value: "categories", label: "Categories" },
  { value: "vendors", label: "Vendors" },
  { value: "orders", label: "Orders" },
  { value: "exceptions", label: "Shipment exceptions" },
  { value: "counts", label: "Cycle counts" },
  { value: "returns", label: "Removed Equipment" },
  { value: "activity", label: "Activity" },
];

export function InventoryMobileMenu({ value, onValueChange, canManageCategories }: {
  value: string; onValueChange: (value: string) => void; canManageCategories: boolean;
}) {
  return <div className="inventory-mobile-menu min-w-0 flex-1 md:hidden">
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" className="h-9 w-full justify-between"
          aria-label={`Inventory sections, current: ${inventoryTabs.find(tab => tab.value === value)?.label ?? "Stock & search"}`}
          data-testid="inventory-mobile-menu">
          <span className="flex min-w-0 items-center gap-2"><Menu className="h-4 w-4 shrink-0" /><span className="truncate">{inventoryTabs.find(tab => tab.value === value)?.label ?? "Stock & search"}</span></span>
          <ChevronDown className="h-4 w-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(70dvh,30rem)] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
        {canManageCategories && <DropdownMenuItem onSelect={() => onValueChange("categories")}>Manage categories</DropdownMenuItem>}
        {inventoryTabs.map(tab => <DropdownMenuItem key={tab.value} aria-label={tab.label}
          data-testid={`inventory-mobile-menu-item-${tab.value}`} onSelect={() => onValueChange(tab.value)}>
          {tab.label}
        </DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

export function InventoryDesktopTabs() {
  return <TabsList className="inventory-desktop-tabs hidden h-auto w-full flex-wrap justify-start gap-1 md:flex">
    {inventoryTabs.map(tab => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>)}
  </TabsList>;
}
