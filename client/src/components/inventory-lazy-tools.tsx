import { lazy, Suspense, type ComponentProps } from "react";

const Catalog = lazy(() => import("./inventory-catalog-workspace").then(module => ({ default: module.InventoryCatalogWorkspace })));
const Serials = lazy(() => import("./inventory-stock-serial-dialog").then(module => ({ default: module.InventoryStockSerialDialog })));
const Kits = lazy(() => import("./inventory-kit-dialog").then(module => ({ default: module.InventoryKitDialog })));
const VendorKits = lazy(() => import("./inventory-vendor-kit-dialog").then(module => ({ default: module.InventoryVendorKitDialog })));

export function InventoryCatalogWorkspace(props: ComponentProps<typeof Catalog>) {
  return <Suspense fallback={<p role="status">Loading catalog tools…</p>}><Catalog {...props} /></Suspense>;
}
export function InventoryStockSerialDialog(props: ComponentProps<typeof Serials>) {
  return <Suspense fallback={<p role="status">Loading serial tools…</p>}><Serials {...props} /></Suspense>;
}
export function InventoryKitDialog(props: ComponentProps<typeof Kits>) {
  return <Suspense fallback={<p role="status">Loading kit tools…</p>}><Kits {...props} /></Suspense>;
}
export function InventoryVendorKitDialog(props: ComponentProps<typeof VendorKits>) {
  return <Suspense fallback={<p role="status">Loading vendor kit inspection…</p>}><VendorKits {...props} /></Suspense>;
}
