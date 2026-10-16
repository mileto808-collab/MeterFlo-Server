import { RotateCcw, Search } from "lucide-react";
import type { Vendor, Warehouse } from "@shared/inventory";
import { emptyOrderFilters, type OrderFilters } from "@shared/inventory-order-search";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type InventoryOrderFiltersProps = {
  filters: OrderFilters;
  onChange: (filters: OrderFilters) => void;
  warehouses: Warehouse[];
  vendors: Vendor[];
  timezone: string;
  resultCount: number;
  totalCount: number;
  showSearch?: boolean;
};

const ALL = "__all__";

export function InventoryOrderFilters({
  filters,
  onChange,
  warehouses,
  vendors,
  timezone,
  resultCount,
  totalCount,
  showSearch = true,
}: InventoryOrderFiltersProps) {
  const invalidDateRange = !!filters.from && !!filters.to && filters.from > filters.to;
  const update = (values: Partial<OrderFilters>) => onChange({ ...filters, ...values });
  const reset = () => onChange({ ...emptyOrderFilters });

  return (
    <section aria-label="Filter inventory orders" className="space-y-3 rounded-md border bg-card p-3 sm:p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {showSearch && <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
          <Label htmlFor="inventory-order-search">Search orders</Label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="inventory-order-search"
              value={filters.query}
              onChange={event => update({ query: event.target.value })}
              placeholder="Order number, reference, ID, product, vendor or location"
              className="pl-9"
              type="search"
              autoComplete="off"
            />
          </div>
        </div>}

        <div className="space-y-1.5">
          <Label htmlFor="inventory-order-type">Order type</Label>
          <Select value={filters.type || ALL} onValueChange={value => update({ type: value === ALL ? "" : value })}>
            <SelectTrigger id="inventory-order-type" aria-label="Order type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All types</SelectItem>
              <SelectItem value="purchase">Purchase</SelectItem>
              <SelectItem value="transfer">Transfer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-order-status">Order status</Label>
          <Select value={filters.status || ALL} onValueChange={value => update({ status: value === ALL ? "" : value })}>
            <SelectTrigger id="inventory-order-status" aria-label="Order status">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="released">Released</SelectItem>
              <SelectItem value="partial">Partially received</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-order-vendor">Vendor filter</Label>
          <Select value={filters.vendorId || ALL} onValueChange={value => update({ vendorId: value === ALL ? "" : value })}>
            <SelectTrigger id="inventory-order-vendor" aria-label="Vendor filter">
              <SelectValue placeholder="All vendors" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All vendors</SelectItem>
              {vendors.map(vendor => (
                <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-order-source">Source filter</Label>
          <Select value={filters.sourceId || ALL} onValueChange={value => update({ sourceId: value === ALL ? "" : value })}>
            <SelectTrigger id="inventory-order-source" aria-label="Source filter">
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All sources</SelectItem>
              {warehouses.map(warehouse => (
                <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-order-destination">Destination filter</Label>
          <Select value={filters.destinationId || ALL} onValueChange={value => update({ destinationId: value === ALL ? "" : value })}>
            <SelectTrigger id="inventory-order-destination" aria-label="Destination filter">
              <SelectValue placeholder="All destinations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All destinations</SelectItem>
              {warehouses.map(warehouse => (
                <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.code}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-order-from">From date</Label>
          <Input
            id="inventory-order-from"
            type="date"
            value={filters.from}
            onChange={event => update({ from: event.target.value })}
            aria-describedby="inventory-order-date-help"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-order-to">To date</Label>
          <Input
            id="inventory-order-to"
            type="date"
            value={filters.to}
            onChange={event => update({ to: event.target.value })}
            aria-describedby="inventory-order-date-help"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inventory-order-sort">Sort orders</Label>
          <Select value={filters.sort} onValueChange={value => update({ sort: value as OrderFilters["sort"] })}>
            <SelectTrigger id="inventory-order-sort" aria-label="Sort orders">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest first</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="number">Order number</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p id="inventory-order-date-help" className="text-xs text-muted-foreground">
        Dates use the configured timezone: {timezone}.
      </p>

      <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-sm" aria-live="polite">
          <span className="font-medium tabular-nums">{resultCount}</span>
          <span className="text-muted-foreground"> of {totalCount} orders</span>
          {invalidDateRange && (
            <span role="alert" className="ml-2 font-medium text-destructive">
              From date must be on or before the to date.
            </span>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={reset}>
          <RotateCcw aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
          Reset filters
        </Button>
      </div>
    </section>
  );
}
