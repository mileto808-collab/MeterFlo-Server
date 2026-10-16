import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedNavigation } from "@/hooks/use-unsaved-navigation";
import { emptyInventory, type InventoryCommand, type InventoryCount, type InventoryItem, type InventoryOrder, type InventoryState, type StockLine, type Vendor, type Warehouse } from "@shared/inventory";
import type { SavedShipmentDraft } from "@shared/inventory-shipment-draft-model";
import { orderLineProgress } from "@shared/inventory-shipment-model";
import { inventoryCountReference } from "@shared/inventory-count-reference";
import { orderLabel, orderReference, uuidOrderId } from "@shared/inventory-order-labels";
import { inventoryActorLabel, inventoryHoldLabel, type InventoryActorLabel } from "@shared/inventory-display-labels";
import { emptyOrderFilters, searchOrders } from "@shared/inventory-order-search";
import { InventoryOrderFilters } from "@/components/inventory-order-filters";
import { downloadInventoryOrders } from "@/lib/inventory-order-export";
import { COUNT_MAX_LINES, COUNT_PAGE_SIZE } from "@shared/inventory-count-limits";
import { inventoryCountRows, inventoryCountLines } from "@/lib/inventory-count-form";
import { inventoryResourceFailure, validateInventoryResource } from "@/lib/inventory-resource-save";
import { orderSaveAttempt, type OrderSaveAttempt } from "@/lib/inventory-order-save";
import { shipmentFingerprint, type ShipmentAction } from "@/lib/inventory-shipment-guidance";
import { InventoryShipmentSession } from "@/components/inventory-shipment-session";
import { InventoryShipmentDraftsPanel } from "@/components/inventory-shipment-drafts-panel";
import { refreshShipmentInventory } from "@/components/inventory-shipment-draft-api";
import { InventoryShipmentExceptions } from "@/components/inventory-shipment-exceptions";
import { InventoryShipmentTransitDialog } from "@/components/inventory-shipment-transit-dialog";
import { InventoryStockSerialDialog } from "@/components/inventory-stock-serial-dialog";
import { InventoryStockWorkspace } from "@/components/inventory-stock-workspace";
import { InventoryCatalogWorkspace } from "@/components/inventory-catalog-workspace";
import { InventoryRecordsWorkspace } from "@/components/inventory-records-workspace";
import { InventoryCategoryCreateAction } from "@/components/inventory-category-create-action";
import { InventoryMobileTools } from "@/components/inventory-mobile-tools";
import { buildOperationsDataset } from "@/lib/inventory-operations-data";
import type { StockBalanceRow } from "@/lib/inventory-stock-export";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ArrowLeftRight, BarChart3, Boxes, ChevronDown, ChevronUp, ClipboardList, Download, FileSpreadsheet, FileText, Filter, Loader2, Menu, Package, Plus, Printer, RefreshCw, Search, Warehouse as WarehouseIcon } from "lucide-react";

type Snapshot = { enabled: boolean; projectName: string; timezone: string; state: InventoryState; permissions: string[]; users: Array<{ id: string; username: string }>; actors?: InventoryActorLabel[] };
type ResourceKind = "warehouse" | "vendor" | "item";
const blankWarehouse = (): Warehouse => ({ id: "", code: "", name: "", type: "physical", active: true, address: "", city: "", state: "", zip: "", contact: "", phone: "", location: "", vin: "", plate: "", plateState: "", make: "", model: "", year: null, assignedUserId: null, userIds: [] });
const blankVendor = (): Vendor => ({ id: "", name: "", contact: "", address: "", phone: "", email: "", reference: "", active: true });
const blankItem = (): InventoryItem => ({ id: "", sku: "", name: "", description: "", category: "", categoryId: null, unit: "each", tracking: "regular", equipment: "none", barcode: "", manufacturer: "", model: "", vendorId: null, cost: 0, reorderPoint: 0, active: true, images: [], components: [] });
const freshId = () => crypto.randomUUID();
const csv = (value: string) => value.split(/[\n,;]/).map(part => part.trim()).filter(Boolean);
const inventoryTabs = [
  { value: "stock", label: "Stock & search" },
  { value: "locations", label: "Locations" },
  { value: "items", label: "Items" },
  { value: "categories", label: "Categories" },
  { value: "vendors", label: "Vendors" },
  { value: "orders", label: "Orders" },
  { value: "exceptions", label: "Shipment exceptions" },
  { value: "counts", label: "Counts & assembly" },
  { value: "returns", label: "Removed Equipment" },
  { value: "activity", label: "Activity" },
];
const sameOriginImage = (value: string) => {
  try { return new URL(value, window.location.origin).origin === window.location.origin ? value : null; }
  catch { return null; }
};

export default function ProjectInventory() {
  const [, params] = useRoute("/projects/:projectId/inventory");
  const projectId = params?.projectId;
  if (!projectId) return <div className="p-6">Project not found.</div>;
  // Route changes must not carry one project's drafts into another project's commands.
  return <ProjectInventoryWorkspace key={projectId} projectId={projectId} />;
}

function ProjectInventoryWorkspace({ projectId }: { projectId: string }) {
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const { toast } = useToast();
  const base = `/api/projects/${projectId}/inventory`;
  const queryKey = [base];
  const { data, isLoading, isError, refetch } = useQuery<Snapshot>({ queryKey, enabled: !!projectId });
  const [showInventoryStats, setShowInventoryStats] = useState(false);
  const [inventoryTab, setInventoryTab] = useState("stock");
  const inventoryMainRef = useRef<HTMLElement>(null);
  const [selectedStockKey, setSelectedStockKey] = useState<string | null>(null);
  const [resource, setResource] = useState<ResourceKind | null>(null);
  const [warehouseForm, setWarehouseForm] = useState<Warehouse>(blankWarehouse());
  const [vendorForm, setVendorForm] = useState<Vendor>(blankVendor());
  const [itemForm, setItemForm] = useState<InventoryItem>(blankItem());
  const [imageBusy, setImageBusy] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const resourceErrorRef = useRef<HTMLDivElement>(null);
  const resourceId = useRef("");
  const resourceAttempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const resourceSaving = useRef(false);
  useEffect(() => { if (resourceError) resourceErrorRef.current?.focus(); }, [resourceError]);
  const [orderType, setOrderType] = useState<"purchase" | "transfer">("purchase");
  const [orderEditorOpen, setOrderEditorOpen] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [editingOrderId, setEditingOrderId] = useState("");
  const [orderFilters, setOrderFilters] = useState(emptyOrderFilters);
  const timezone = data?.timezone ?? "UTC";
  const [orderDestination, setOrderDestination] = useState("");
  const [orderSource, setOrderSource] = useState("");
  const [orderVendor, setOrderVendor] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [replacementFor, setReplacementFor] = useState("");
  const [orderLines, setOrderLines] = useState<StockLine[]>([]);
  const [orderLineQuantities, setOrderLineQuantities] = useState<Record<string, string>>({});
  // The order's unadded line is independent of the movement scanner.
  const [orderLineItem, setOrderLineItem] = useState("");
  const [orderLineQty, setOrderLineQty] = useState("1");
  const orderValues = { orderType, orderId, orderDestination, orderSource, orderVendor, orderNotes, replacementFor, orderLines,
    orderLineQuantities, orderLineItem, orderLineQty };
  const [savedOrderValues, setSavedOrderValues] = useState(() => JSON.stringify(orderValues));
  const orderDirty = JSON.stringify(orderValues) !== savedOrderValues;
  const orderSaving = useRef(false);
  const orderAttempt = useRef<OrderSaveAttempt | null>(null);
  const [orderMessage, setOrderMessage] = useState("");
  const [pendingOrderTransition, setPendingOrderTransition] = useState<(() => void) | null>(null);
  const [pendingMovementTransition, setPendingMovementTransition] = useState<(() => void) | null>(null);
  const [movementDirty, setMovementDirty] = useState(false);
  const [movementCheckpointBusy, setMovementCheckpointBusy] = useState(false);
  const movementAttempts = useRef(new Map<string, string>());
  const [orderToClose, setOrderToClose] = useState<InventoryOrder | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [showClearedOrders, setShowClearedOrders] = useState(false);
  const [orderFiltersOpen, setOrderFiltersOpen] = useState(false);
  const [shipmentDraftsOpen, setShipmentDraftsOpen] = useState(false);
  const [orderPage, setOrderPage] = useState(0);
  const [orderResultsElement, setOrderResultsElement] = useState<HTMLDivElement | null>(null);
  const orderRowHeightRef = useRef(0);
  const orderContainerWidthRef = useRef(0);
  const orderContainerHeightRef = useRef(0);
  const [orderRowsPerPage, setOrderRowsPerPage] = useState(1);
  const [orderToClear, setOrderToClear] = useState<InventoryOrder | null>(null);
  const requestOrderTransition = (transition: () => void) => {
    if (orderSaving.current || command.isPending) return;
    if (orderDirty) setPendingOrderTransition(current => current ?? transition);
    else transition();
  };
  const requestMovementTransition = (transition: () => void) => {
    if (command.isPending) return;
    if (movementDirty || movementCheckpointBusy) setPendingMovementTransition(current => current ?? transition);
    else transition();
  };
  const [operationOrder, setOperationOrder] = useState<InventoryOrder | null>(null);
  const [sessionState, setSessionState] = useState<InventoryState | null>(null);
  const [sessionDraft, setSessionDraft] = useState<SavedShipmentDraft | undefined>();
  const [transitOrder, setTransitOrder] = useState<InventoryOrder | null>(null);
  const [operation, setOperation] = useState<"receive" | "dispatch" | "accept">("receive");
  const [countWarehouse, setCountWarehouse] = useState("");
  const [activeCount, setActiveCount] = useState<InventoryCount | null>(null);
  const [countQuantities, setCountQuantities] = useState<Record<string, string>>({});
  const [countSerials, setCountSerials] = useState<Record<string, string>>({});
  const [countReason, setCountReason] = useState("");
  const [countDraftId, setCountDraftId] = useState<string | null>(null);
  const [countDraftRevision, setCountDraftRevision] = useState(0);
  const [countDraftMessage, setCountDraftMessage] = useState("");
  const [countPage, setCountPage] = useState(0);
  const [countSearch, setCountSearch] = useState("");
  const [countProductSearch, setCountProductSearch] = useState("");
  const [countProduct, setCountProduct] = useState("");
  const [pendingCountTransition, setPendingCountTransition] = useState<(() => void) | null>(null);
  const [savedCountValues, setSavedCountValues] = useState("");
  const countSaving = useRef(false);
  const countRows = activeCount ? inventoryCountRows(activeCount, data?.state.items ?? [], countQuantities, countSerials) : [];
  const countValues = JSON.stringify({ reason: countReason,
    rows: countRows.map(({ itemId, quantity, serials }) => ({ itemId, quantity, serials })).sort((a, b) => a.itemId.localeCompare(b.itemId)) });
  const countDirty = !!activeCount && countValues !== savedCountValues;
  const requestCountTransition = (transition: () => void) => {
    if (countSaving.current || command.isPending) return;
    if (countDirty) setPendingCountTransition(current => current ?? transition);
    else transition();
  };
  // Register a single navigation guard: both editors can have unsaved values.
  // A count choice must not silently discard an unrelated order draft.
  const completeSavedNavigation = useUnsavedNavigation(countDirty || orderDirty || movementDirty || movementCheckpointBusy,
    transition => requestCountTransition(() => requestOrderTransition(() => requestMovementTransition(transition))));
  const [assembleItem, setAssembleItem] = useState("");
  const [assembleWarehouse, setAssembleWarehouse] = useState("");
  const [assembleQty, setAssembleQty] = useState("1");
  const [assembleSerials, setAssembleSerials] = useState("");
  const [componentScan, setComponentScan] = useState<Record<string, string>>({});
  const [returnInspect, setReturnInspect] = useState<Record<string, { itemId: string; reason: string }>>({});

  const state = data?.state;
  const locationsDataset = useMemo(() => buildOperationsDataset("locations", state ?? emptyInventory(), data?.actors ?? [], data?.users ?? [], timezone), [state, data?.actors, data?.users, timezone]);
  const returnsDataset = useMemo(() => buildOperationsDataset("returns", state ?? emptyInventory(), data?.actors ?? [], data?.users ?? [], timezone), [state, data?.actors, data?.users, timezone]);
  const activityDataset = useMemo(() => buildOperationsDataset("activity", state ?? emptyInventory(), data?.actors ?? [], data?.users ?? [], timezone), [state, data?.actors, data?.users, timezone]);
  const categoriesDataset = useMemo(() => buildOperationsDataset("categories", state ?? emptyInventory(), data?.actors ?? [], data?.users ?? [], timezone), [state]);
  const categoryCatalog = state?.categoryCatalog ?? [];
  const can = (permission: string) => hasPermission(permission);
  const command = useMutation({
    mutationFn: async ({ action, data: payload, operationId }: { action: InventoryCommand["action"]; data: Record<string, unknown>; operationId?: string }) => {
      const response = await apiRequest("POST", `${base}/commands`, { operationId: operationId ?? freshId(), action, data: payload } satisfies InventoryCommand);
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      toast({ title: "Inventory saved", description: "The project stock ledger is up to date." });
    },
    onError: (error: Error) => toast({ title: "Inventory action failed", description: error.message, variant: "destructive" }),
  });
  const postWithStableIdentity = async (action: InventoryCommand["action"], payload: Record<string, unknown>) => {
    const fingerprint = shipmentFingerprint(action, payload);
    let operationId = movementAttempts.current.get(fingerprint);
    if (!operationId) {
      operationId = freshId();
      movementAttempts.current.set(fingerprint, operationId);
    }
    const result = await command.mutateAsync({ action, data: payload, operationId }) as {
      operationId?: string; operation?: unknown; receipt?: unknown; state?: InventoryState;
    };
    const confirmed = result?.operationId === operationId ||
      !!result?.state?.receipts?.some(receipt => receipt.id === operationId);
    if (confirmed) movementAttempts.current.delete(fingerprint);
    return confirmed;
  };
  const resourceSave = useMutation({
    mutationFn: async (payload: InventoryCommand) => {
      let response: Response;
      try {
        response = await fetch(`${base}/commands`, { method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } catch { throw new Error(inventoryResourceFailure(0, null)); }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(inventoryResourceFailure(response.status, body));
      }
      const result = await response.json().catch(() => null);
      if (!result?.state) throw new Error(inventoryResourceFailure(0, null));
      return result;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      setResource(null);
      setResourceError(null);
      toast({ title: "Inventory saved", description: "The project stock ledger is up to date." });
    },
    onError: (error: Error) => setResourceError(error.message),
    onSettled: () => { resourceSaving.current = false; },
  });
  const resourceBusy = resourceSave.isPending || imageBusy;
  const warehouses = state?.warehouses ?? [];
  const vendors = state?.vendors ?? [];
  const items = state?.items ?? [];
  const orderItems = state?.orders ?? [];
  const visibleOrders = useMemo(() => state ? searchOrders(state, orderFilters, showClearedOrders, timezone) : [],
    [state, orderFilters, showClearedOrders, timezone]);
  useEffect(() => { setOrderPage(0); orderRowHeightRef.current = 0; }, [orderFilters, showClearedOrders]);
  useEffect(() => {
    const main = orderResultsElement?.closest("main");
    if (!main) return;
    const previousHeight = main.style.height;
    const fit = () => {
      // The real top includes app chrome and any hosting preview banner.
      // A fixed viewport subtraction can put the pager below the screen.
      const viewport = window.visualViewport;
      const available = Math.max(0, (viewport?.height ?? window.innerHeight) -
        Math.max(0, main.getBoundingClientRect().top - (viewport?.offsetTop ?? 0)));
      main.style.height = `${available}px`;
    };
    const observer = new ResizeObserver(fit);
    if (main.parentElement) observer.observe(main.parentElement);
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("scroll", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("scroll", fit);
      main.style.height = previousHeight;
    };
  }, [orderResultsElement]);
  useEffect(() => {
    const container = orderResultsElement;
    if (!container) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = container.clientWidth;
        if (Math.abs(width - orderContainerWidthRef.current) > 2 ||
            Math.abs(container.clientHeight - orderContainerHeightRef.current) > 2) {
          orderRowHeightRef.current = 0;
        }
        orderContainerWidthRef.current = width;
        orderContainerHeightRef.current = container.clientHeight;
        const rows = [...container.querySelectorAll<HTMLElement>("[data-order-id]")];
        const rowHeight = rows.reduce((height, row) => {
          const details = row.querySelector<HTMLDetailsElement>("details[open]");
          const expanded = details ? details.getBoundingClientRect().height -
            (details.querySelector("summary")?.getBoundingClientRect().height ?? 0) - 7 : 0;
          return Math.max(height, row.getBoundingClientRect().height - Math.max(0, expanded));
        }, 0);
        if (rowHeight > 0) orderRowHeightRef.current = Math.max(orderRowHeightRef.current, rowHeight);
        const measuredRow = orderRowHeightRef.current || 72;
        // Account for results padding and the gap between collapsed records.
        // Expanded details scroll locally, rather than permanently reducing capacity.
        const next = Math.max(1, Math.min(100, Math.floor((container.clientHeight - 8) / (measuredRow + 8))));
        setOrderRowsPerPage(current => current === next ? current : next);
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    container.querySelectorAll("[data-order-id]").forEach(row => observer.observe(row));
    window.addEventListener("resize", measure);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", measure); };
  }, [orderResultsElement, inventoryTab, showInventoryStats, orderFiltersOpen, visibleOrders.length, orderPage, orderRowsPerPage]);
  useEffect(() => {
    const lastPage = Math.max(0, Math.ceil(visibleOrders.length / orderRowsPerPage) - 1);
    setOrderPage(current => Math.min(current, lastPage));
  }, [visibleOrders.length, orderRowsPerPage]);
  const orderPageCount = Math.max(1, Math.ceil(visibleOrders.length / orderRowsPerPage));
  const currentOrderPage = Math.min(orderPage, orderPageCount - 1);
  const pagedOrders = visibleOrders.slice(currentOrderPage * orderRowsPerPage, (currentOrderPage + 1) * orderRowsPerPage);
  const orderTitle = (id: string) => { const order = orderItems.find(order => order.id === id); return order ? orderLabel(order) : "Order reference unavailable"; };
  const activeWarehouses = warehouses.filter(value => value.active);
  const allStockRows = useMemo<StockBalanceRow[]>(() => (state?.stock ?? []).map(stock => ({
    ...stock, item: items.find(value => value.id === stock.itemId), warehouse: warehouses.find(value => value.id === stock.warehouseId),
    reserved: state?.allocations.filter(allocation => allocation.status === "reserved").flatMap(allocation => allocation.lines)
      .filter(line => line.itemId === stock.itemId && line.warehouseId === stock.warehouseId).reduce((total, line) => total + line.quantity, 0) ?? 0,
  })).filter((row): row is StockBalanceRow => !!row.item && !!row.warehouse), [state, items, warehouses]);
  const selectedStockRow = selectedStockKey
    ? allStockRows.find(row => `${row.itemId}/${row.warehouseId}` === selectedStockKey)
    : undefined;
  useEffect(() => {
    if (selectedStockKey && (!can("inventory.view") || !selectedStockRow)) setSelectedStockKey(null);
  }, [selectedStockKey, selectedStockRow, hasPermission]);
  useEffect(() => {
    const main = inventoryMainRef.current;
    if (!main) return;
    // Inventory owns its record scrollers. Letting the app-level scroller move
    // as a phone rotates can strand the section menu above the viewport.
    const host = main.parentElement;
    const previousOverflow = host?.style.overflow;
    if (host) {
      host.scrollTop = 0;
      host.style.overflow = "hidden";
    }
    const viewport = window.visualViewport;
    const fit = () => {
      if (host) host.scrollTop = 0;
      const height = viewport?.height ?? window.innerHeight;
      const viewportTop = viewport?.offsetTop ?? 0;
      const actualTop = main.getBoundingClientRect().top;
      main.style.height = `${Math.max(0, height - Math.max(0, actualTop - viewportTop))}px`;
    };
    const observer = new ResizeObserver(fit);
    if (main.parentElement) observer.observe(main.parentElement);
    window.addEventListener("resize", fit);
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    fit();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      if (host) host.style.overflow = previousOverflow ?? "";
    };
  }, [isLoading]);

  if (!projectId) return <div className="p-6">Project not found.</div>;
  if (isLoading) return <main className="mx-auto max-w-7xl p-4 md:p-7 space-y-5"><div className="h-8 w-64 animate-pulse rounded bg-muted" /><div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />)}</div><div className="h-80 animate-pulse rounded-lg bg-muted" /></main>;
  if (!data) return <main className="mx-auto max-w-4xl p-6"><Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Inventory unavailable</AlertTitle><AlertDescription>Project inventory could not be loaded. Your work is safe; retry the connection.</AlertDescription></Alert><Button className="mt-4" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></main>;
  if (!state) return <main className="mx-auto max-w-4xl p-6"><Alert variant="destructive"><AlertTitle>Inventory snapshot is incomplete</AlertTitle><AlertDescription>Refresh the project inventory before continuing.</AlertDescription></Alert><Button className="mt-4" onClick={() => refetch()}>Retry</Button></main>;
  if (!data.enabled) return <main className="mx-auto max-w-3xl p-6"><Card><CardHeader><CardTitle>Inventory is not enabled</CardTitle><CardDescription>Ask a project administrator to enable inventory control in project settings.</CardDescription></CardHeader></Card></main>;
  const hasAny = !!(state?.warehouses.length || state?.items.length || state?.vendors.length);
  if (!can("inventory.view")) return <main className="mx-auto max-w-3xl p-6"><Card><CardHeader><CardTitle>Inventory access required</CardTitle><CardDescription>Your account does not have permission to view this project’s stock.</CardDescription></CardHeader></Card></main>;

  const openResource = (kind: ResourceKind, existing?: Warehouse | Vendor | InventoryItem) => {
    if (resourceSaving.current || imageBusy) return;
    resourceId.current = existing?.id || freshId();
    resourceAttempt.current = null;
    setResourceError(null);
    setResource(kind);
    if (kind === "warehouse") setWarehouseForm(existing as Warehouse ?? blankWarehouse());
    if (kind === "vendor") setVendorForm(existing as Vendor ?? blankVendor());
    if (kind === "item") {
      const item = existing as InventoryItem | undefined;
      setItemForm(item ? { ...item, images: item.images.filter(image => !!sameOriginImage(image)) } : blankItem());
    }
  };
  const saveResource = () => {
    if (!resource || resourceSaving.current || imageBusy || command.isPending || !can("inventory.maintain")) return;
    setResourceError(null);
    let payload: Record<string, unknown>;
    try {
      const draft = resource === "warehouse" ? warehouseForm : resource === "vendor" ? vendorForm : itemForm;
      payload = validateInventoryResource(resource, { ...draft, id: resourceId.current });
    } catch (error) {
      setResourceError(error instanceof Error ? error.message : "Check the required fields.");
      return;
    }
    const fingerprint = JSON.stringify({ action: resource, data: payload });
    if (resourceAttempt.current?.fingerprint !== fingerprint)
      resourceAttempt.current = { fingerprint, operationId: freshId() };
    resourceSaving.current = true;
    resourceSave.mutate({ action: resource, data: payload, operationId: resourceAttempt.current!.operationId });
  };
  const addLine = () => {
    const item = items.find(value => value.id === orderLineItem);
    const quantity = Number(orderLineQty);
    if (!item || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000000) {
      toast({ title: "Check draft quantity", description: "Enter a whole quantity from 1 to 1,000,000.", variant: "destructive" }); return;
    }
    const existingDraftLine = orderLines.find(line => line.itemId === item.id);
    if (existingDraftLine && !orderQuantitiesValid) {
      toast({ title: "Fix draft quantities first", description: "Every added line needs a whole quantity from 1 to 1,000,000.", variant: "destructive" });
      return;
    }
    setOrderLines(current => {
      const match = current.findIndex(line => line.itemId === item.id);
      return match < 0 ? [...current, { itemId: item.id, quantity, serials: [] }] :
        current.map((line, index) => index === match ? { ...line,
          quantity: Number(orderLineQuantities[line.itemId] ?? line.quantity) + quantity, serials: [] } : line);
    });
    setOrderLineQuantities(current => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setOrderLineItem(""); setOrderLineQty("1");
  };
  const orderHasPendingLine = !!orderLineItem || orderLineQty !== "1";
  const orderQuantitiesValid = orderLines.every(line => {
    const value = orderLineQuantities[line.itemId] ?? String(line.quantity);
    const quantity = Number(value);
    return value.trim() !== "" && Number.isInteger(quantity) && quantity >= 1 && quantity <= 1000000;
  });
  const canSaveOrder = !!orderDestination && !!orderLines.length && orderQuantitiesValid && !orderHasPendingLine &&
    (orderType === "purchase" ? !!orderVendor && can("inventory.purchase") : !!orderSource && can("inventory.transfer"));
  const resetOrderDraft = () => {
    const next = { orderType: can("inventory.purchase") ? "purchase" as const : "transfer" as const,
      orderId: "", orderDestination: "", orderSource: "", orderVendor: "", orderNotes: "", replacementFor: "",
      orderLines: [] as StockLine[], orderLineQuantities: {}, orderLineItem: "", orderLineQty: "1" };
    orderAttempt.current = null;
    setOrderType(next.orderType); setOrderId(next.orderId); setEditingOrderId("");
    setOrderDestination(next.orderDestination); setOrderSource(next.orderSource); setOrderVendor(next.orderVendor);
    setOrderNotes(next.orderNotes); setReplacementFor(next.replacementFor); setOrderLines(next.orderLines);
    setOrderLineQuantities({}); setOrderLineItem(""); setOrderLineQty("1"); setOrderMessage("");
    setSavedOrderValues(JSON.stringify(next));
  };
  const closeOrderEditor = () => requestOrderTransition(() => {
    resetOrderDraft();
    setOrderEditorOpen(false);
  });
  const saveOrderDraft = (afterSave?: () => void) => {
    if (!canSaveOrder || command.isPending || orderSaving.current) return;
    orderSaving.current = true;
    setOrderMessage("");
    const payload = { type: orderType, destinationId: orderDestination,
      sourceId: orderType === "transfer" ? orderSource : null, vendorId: orderType === "purchase" ? orderVendor : null,
      lines: orderLines.map(line => ({ ...line, quantity: Number(orderLineQuantities[line.itemId] ?? line.quantity), serials: [] })), notes: orderNotes, reference: orderId,
      ...(replacementFor ? { replacementFor } : {}) };
    const attempt = orderSaveAttempt(orderAttempt.current, base, editingOrderId, payload, freshId);
    orderAttempt.current = attempt;
    const id = attempt.id;
    command.mutate({ action: "order", data: { ...payload, id }, operationId: attempt.operationId }, {
      onSuccess: result => {
        const saved = (result.state as InventoryState | undefined)?.orders.find(order => order.id === id);
        if (!saved) {
          setOrderMessage("Draft save could not be confirmed. Your entries were kept.");
          return;
        }
        orderAttempt.current = null;
        setOrderLines([]); setOrderLineQuantities({}); setOrderId(""); setEditingOrderId(""); setOrderNotes(""); setReplacementFor("");
        setSavedOrderValues(JSON.stringify({ ...orderValues, orderLines: [], orderLineQuantities: {}, orderId: "", orderNotes: "", replacementFor: "" }));
        setOrderMessage(`Order ${orderLabel(saved)}${orderReference(saved) ? ` · Reference ${orderReference(saved)}` : ""} saved as a draft. Stock has not changed.`);
        orderSaving.current = false;
        if (afterSave) {
          setPendingOrderTransition(null);
          completeSavedNavigation(afterSave);
        } else setOrderEditorOpen(false);
      },
      onError: () => setOrderMessage("Order draft not saved or not confirmed. Your entries are still here; retry before leaving. An unchanged retry reuses the same order and request IDs."),
      onSettled: () => { orderSaving.current = false; },
    });
  };
  const editOrderDraft = (order: InventoryOrder) => requestOrderTransition(() => {
    orderAttempt.current = null;
    setOrderId(orderReference(order)); setEditingOrderId(order.id); setOrderType(order.type); setOrderDestination(order.destinationId);
    setOrderSource(order.sourceId || ""); setOrderVendor(order.vendorId || "");
    setReplacementFor(order.replacementFor ?? "");
    setOrderLines(order.lines); setOrderNotes(order.notes);
    setOrderLineItem(""); setOrderLineQty("1"); setOrderLineQuantities({});
    setOrderMessage("");
    setSavedOrderValues(JSON.stringify({ orderType: order.type, orderId: orderReference(order),
      orderDestination: order.destinationId, orderSource: order.sourceId || "", orderVendor: order.vendorId || "",
      orderNotes: order.notes, replacementFor: order.replacementFor ?? "", orderLines: order.lines, orderLineQuantities: {}, orderLineItem: "", orderLineQty: "1" }));
    setOrderEditorOpen(true);
  });
  const startNewOrderDraft = () => requestOrderTransition(() => {
    resetOrderDraft();
    setOrderEditorOpen(true);
  });
  const openOrderOperation = (order: InventoryOrder, action: "receive" | "dispatch" | "accept") => {
    setMovementDirty(false);
    setSessionState(state);
    setSessionDraft(undefined);
    setOperationOrder(order); setOperation(action);
  };
  const resumeShipmentDraft = async (draft: SavedShipmentDraft, snapshot?: InventoryState): Promise<boolean> => {
    try {
      const freshState = snapshot ?? (await refreshShipmentInventory(base)).state;
      const order = freshState.orders.find(value => value.id === draft.orderId);
      if (!order) {
        toast({ title: "Order unavailable", description: "Restore the order before resuming this saved capture.", variant: "destructive" });
        return false;
      }
      const currentDraft = freshState.shipmentDrafts?.find(value => value.id === draft.id);
      if (!currentDraft) throw new Error("Saved shipment draft is no longer available to your account. Refresh inventory.");
      setShipmentDraftsOpen(false);
      setMovementDirty(false);
      setSessionState(freshState);
      setSessionDraft(currentDraft);
      setOperation(draft.stage);
      setOperationOrder(order);
      return true;
    } catch (error) {
      toast({ title: "Could not refresh shipment draft", description: error instanceof Error ? error.message : "Reconnect and retry.", variant: "destructive" });
      return false;
    }
  };
  const startReplacementOrder = (order: InventoryOrder) => requestOrderTransition(() => {
    const replacementLines = order.lines.map(line => {
      const progress = orderLineProgress(state, order, line.itemId);
      return { itemId: line.itemId, quantity: Math.max(0, progress.ordered - progress.usable), serials: [] };
    }).filter(line => line.quantity > 0);
    if (!replacementLines.length) {
      toast({ title: "No outstanding quantity", description: "This order has no remaining units to replace.", variant: "destructive" });
      return;
    }
    const next = {
      orderType: order.type, orderId: "", orderDestination: order.destinationId,
      orderSource: order.sourceId ?? "", orderVendor: order.vendorId ?? "",
      orderNotes: `Replacement for order ${orderLabel(order)}`, replacementFor: order.id,
      orderLines: replacementLines, orderLineQuantities: {}, orderLineItem: "", orderLineQty: "1",
    };
    orderAttempt.current = null;
    setOrderType(next.orderType); setOrderId(next.orderId); setEditingOrderId(""); setOrderDestination(next.orderDestination);
    setOrderSource(next.orderSource); setOrderVendor(next.orderVendor); setOrderNotes(next.orderNotes);
    setReplacementFor(next.replacementFor); setOrderLines(next.orderLines); setOrderLineQuantities({});
    setOrderLineItem(""); setOrderLineQty("1"); setOrderMessage("");
    setSavedOrderValues(JSON.stringify({ ...next, orderNotes: "", replacementFor: "" }));
    setOrderEditorOpen(true);
  });
  const confirmCloseOrder = async () => {
    if (!orderToClose || !closeReason.trim() || !can("inventory.closeOrders")) return;
    const order = orderToClose;
    try {
      const confirmed = await postWithStableIdentity("closeOrder", { orderId: order.id, reason: closeReason.trim() });
      if (confirmed) { setOrderToClose(null); setCloseReason(""); }
      else toast({ title: "Closure not confirmed", description: "Your reason is still available. Retry unchanged to confirm the result.", variant: "destructive" });
    } catch { /* The mutation reports the failure; keep the reason and stable retry identity. */ }
  };
  const openPrint = (kind: "order" | "receipt" | "count", id: string) => {
    window.open(`${base}/print/${kind}/${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
  };
  const receiptSummary = (receipt: InventoryState["receipts"][number]) => {
    const movementLabel = receipt.action === "resolveTransit" ? "transit loss" : "quantity";
    const good = receipt.lines.map(line => `${items.find(item => item.id === line.itemId)?.sku ?? line.itemId} ${movementLabel} × ${line.quantity}`);
    const damaged = (receipt.damaged ?? []).map(line =>
      `${items.find(item => item.id === line.itemId)?.sku ?? line.itemId} damaged × ${line.quantity} — ${line.reason}`);
    const closed = (receipt.closedShort ?? []).map(line =>
      `${items.find(item => item.id === line.itemId)?.sku ?? line.itemId} closed short × ${line.quantity}`);
    return [...good, ...damaged, ...closed, receipt.reason].filter(Boolean).join(" · ");
  };
  const runOrderCommand = (action: "unrelease" | "archiveOrder" | "restoreOrder", order: InventoryOrder) => {
    if (command.isPending || !can(action === "unrelease" && order.type === "transfer" ? "inventory.transfer" : "inventory.purchase")) return;
    command.mutate({ action, data: { orderId: order.id } }, {
      onSuccess: () => { if (action === "archiveOrder") setOrderToClear(null); },
    });
  };
  const orderHasReceipt = (order: InventoryOrder) => state.receipts.some(receipt => receipt.reference === order.id);
  const isUnreleaseLocked = (order: InventoryOrder) => order.status !== "released" ||
    order.received.length > 0 || order.dispatched.length > 0 || orderHasReceipt(order) ||
    (state.shipmentDrafts ?? []).some(draft => draft.orderId === order.id);
  const uploadImage = async (file?: File) => {
    if (!file) return;
    setImageBusy(true);
    try {
      const form = new FormData(); form.append("image", file);
      const response = await fetch(`${base}/images`, { method: "POST", body: form, credentials: "include" });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json() as { url: string };
      const url = new URL(result.url, window.location.origin);
      if (url.origin !== window.location.origin) throw new Error("Only server-hosted project images can be attached.");
      setItemForm(current => ({ ...current, images: [...current.images, result.url].slice(0, 8) }));
    } catch (error) { toast({ title: "Image upload failed", description: error instanceof Error ? error.message : "Could not upload image.", variant: "destructive" }); }
    finally { setImageBusy(false); }
  };

  const openCount = (count: InventoryCount, reload = false) => {
    if (countDraftId !== count.id || reload) {
      const rows = inventoryCountRows(count, items, {}, {});
      setSavedCountValues(JSON.stringify({ reason: count.draft?.reason ?? "",
        rows: rows.map(({ itemId, quantity, serials }) => ({ itemId, quantity, serials })).sort((a, b) => a.itemId.localeCompare(b.itemId)) }));
      setCountQuantities(Object.fromEntries(count.draft?.rows.map(row => [row.itemId, row.quantity]) ?? []));
      setCountSerials(Object.fromEntries(count.draft?.rows.map(row => [row.itemId, row.serials]) ?? []));
      setCountReason(count.draft?.reason ?? "");
      setCountDraftRevision(count.draft?.revision ?? 0);
      setCountDraftMessage(count.draft ? `Loaded saved draft revision ${count.draft.revision}.` : "");
      setCountDraftId(count.id);
      setCountPage(0);
      setCountSearch("");
      setCountProductSearch("");
      setCountProduct("");
    }
    setActiveCount(count);
    setCountWarehouse(count.warehouseId);
  };
  const countRowIds = new Set(countRows.map(row => row.itemId));
  const discoveryProducts = items.filter(item => item.active && !countRowIds.has(item.id) &&
    `${item.sku} ${item.name} ${item.barcode}`.toLowerCase().includes(countProductSearch.toLowerCase())).slice(0, 100);
  const matchingCountRows = countRows.filter(row => `${row.item?.sku} ${row.item?.name}`.toLowerCase().includes(countSearch.toLowerCase()));
  const lastCountPage = Math.max(0, Math.ceil(matchingCountRows.length / COUNT_PAGE_SIZE) - 1);
  const currentCountPage = Math.min(countPage, lastCountPage);
  const visibleCountRows = matchingCountRows.slice(currentCountPage * COUNT_PAGE_SIZE, (currentCountPage + 1) * COUNT_PAGE_SIZE);
  const addCountProduct = () => {
    if (!countProduct || countRowIds.has(countProduct) || countRows.length >= COUNT_MAX_LINES) return;
    setCountQuantities(current => ({ ...current, [countProduct]: "0" }));
    setCountSerials(current => ({ ...current, [countProduct]: "" }));
    setCountSearch("");
    setCountPage(Math.floor(countRows.length / COUNT_PAGE_SIZE));
    setCountProduct("");
    setCountDraftMessage("Unsaved discovery added. Save the draft before leaving.");
  };
  const saveCountDraft = (afterSave?: () => void) => {
    if (!activeCount || !can("inventory.count") || command.isPending || countSaving.current) return;
    countSaving.current = true;
    command.mutate({ action: "countSaveDraft", data: {
      id: activeCount.id, revision: countDraftRevision, reason: countReason,
      rows: countRows.map(row => ({ itemId: row.itemId, quantity: row.quantity, serials: row.serials })),
    } }, {
      onSuccess: result => {
        const saved = (result.state as InventoryState).counts.find(count => count.id === activeCount.id);
        if (saved?.draft) {
          setActiveCount(saved);
          setCountDraftRevision(saved.draft.revision);
          setCountDraftMessage(`Draft saved, revision ${saved.draft.revision}. Stock has not changed.`);
          setSavedCountValues(countValues);
          countSaving.current = false;
          if (afterSave) {
            setPendingCountTransition(null);
            completeSavedNavigation(afterSave);
          }
        } else {
          setCountDraftMessage("Draft save could not be confirmed. Your entries were kept. Reload the saved draft before retrying.");
        }
      },
      onError: () => setCountDraftMessage("Draft not saved. Your entries are still here. If another operator saved changes, reload the saved draft before retrying."),
      onSettled: () => { countSaving.current = false; },
    });
  };
  const reloadCountDraft = async () => {
    if (!activeCount) return;
    const latest = await refetch();
    const count = latest.data?.state.counts.find(count => count.id === activeCount.id);
    if (!latest.isError && count?.status === "open") openCount(count, true);
    else setCountDraftMessage("The saved draft could not be loaded, or the count is no longer open. Your entries were kept.");
  };
  const startCount = () => {
    if (!countWarehouse || !can("inventory.count")) return;
    const id = freshId();
    command.mutate({ action: "countStart", data: { id, warehouseId: countWarehouse } }, { onSuccess: result => {
      const count = (result.state as InventoryState).counts.find(value => value.id === id);
      if (!count) {
        toast({ title: "Count snapshot unavailable", description: "Refresh inventory and continue the saved count.", variant: "destructive" });
        return;
      }
      openCount(count, true);
    } });
  };
  const closeCount = () => {
    setActiveCount(null);
    setCountDraftId(null);
  };
  const cancelCount = (count: InventoryCount) => {
    const cancel = () => command.mutate({ action: "countCancel", data: { id: count.id, reason: "Operator cancelled stale or unfinished count" } },
      { onSuccess: () => { if (activeCount?.id === count.id) closeCount(); } });
    if (activeCount?.id === count.id) requestCountTransition(cancel);
    else cancel();
  };
  const postCount = () => {
    if (!activeCount || !can("inventory.count")) return;
    let countLines: StockLine[];
    try { countLines = inventoryCountLines(countRows); }
    catch (error) {
      toast({ title: "Check count entries", description: error instanceof Error ? error.message : "Review every counted item.", variant: "destructive" });
      return;
    }
    command.mutate({ action: "countPost", data: { id: activeCount.id, draftRevision: countDraftRevision, lines: countLines, reason: countReason } }, { onSuccess: () => setActiveCount(null) });
  };

  return <main ref={inventoryMainRef} className="inventory-workspace-shell mx-auto flex h-[calc(100dvh-72px)] min-h-0 w-full max-w-7xl flex-col overflow-hidden p-2 sm:p-4 md:p-7" data-testid="inventory-workspace">
    <Dialog open={!!pendingOrderTransition} onOpenChange={open => { if (!open && !orderSaving.current) setPendingOrderTransition(null); }}>
      <DialogContent onEscapeKeyDown={event => { if (orderSaving.current) event.preventDefault(); }} onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>Unsaved order changes</DialogTitle><DialogDescription>Save this purchase or transfer draft before continuing, discard the unsaved changes, or stay here. Saving a draft does not release an order or change stock.</DialogDescription></DialogHeader>
        {orderMessage && <p role="status" className="text-sm">{orderMessage}</p>}
        {!canSaveOrder && <p className="text-sm">Complete the required order fields and add or clear the unfinished line before saving.</p>}
        <DialogFooter>
          <Button variant="outline" disabled={command.isPending} onClick={() => setPendingOrderTransition(null)}>Stay</Button>
          <Button variant="destructive" disabled={command.isPending} onClick={() => {
            const next = pendingOrderTransition;
            setPendingOrderTransition(null);
            // Only the successful replacement/navigation abandons the editor.
            next?.();
          }}>Discard</Button>
          <Button disabled={!canSaveOrder || command.isPending} onClick={() => saveOrderDraft(pendingOrderTransition ?? undefined)}>Save draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!pendingCountTransition} onOpenChange={open => { if (!open && !countSaving.current) setPendingCountTransition(null); }}>
      <DialogContent onEscapeKeyDown={event => { if (countSaving.current) event.preventDefault(); }} onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>Unsaved count changes</DialogTitle><DialogDescription>Save this count draft before continuing, discard changes since the last save, or stay here. Saving a draft does not change stock.</DialogDescription></DialogHeader>
        {countDraftMessage && <p role="status" className="text-sm">{countDraftMessage}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={command.isPending} onClick={() => setPendingCountTransition(null)}>Stay</Button>
          <Button variant="destructive" disabled={command.isPending} onClick={() => {
            const next = pendingCountTransition;
            setPendingCountTransition(null);
            // Each transition replaces/closes the editor only on success.
            // Failed reloads, cancellations and starts must keep local edits.
            next?.();
          }}>Discard</Button>
          <Button disabled={!can("inventory.count") || command.isPending} onClick={() => saveCountDraft(pendingCountTransition ?? undefined)}>Save draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!pendingMovementTransition} onOpenChange={open => { if (!open && !command.isPending) setPendingMovementTransition(null); }}>
      <DialogContent onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>Unsaved movement scans</DialogTitle><DialogDescription>Stay and continue scanning, or discard unsaved local changes. Server checkpoints remain available to Resume. Nothing is posted automatically.{movementCheckpointBusy && " Waiting for the current checkpoint before leaving."}</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" disabled={command.isPending} onClick={() => setPendingMovementTransition(null)}>Stay</Button><Button variant="destructive" disabled={command.isPending || movementCheckpointBusy} onClick={() => {
          const next = pendingMovementTransition;
          setPendingMovementTransition(null); setMovementDirty(false); setOperationOrder(null); setTransitOrder(null);
          next?.();
        }}>Discard movement</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!orderToClear} onOpenChange={open => { if (!open && !command.isPending) setOrderToClear(null); }}>
      <DialogContent onEscapeKeyDown={event => { if (command.isPending) event.preventDefault(); }} onPointerDownOutside={event => { if (command.isPending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Clear cancelled purchase order?</DialogTitle>
          <DialogDescription>
            {orderToClear ? orderLabel(orderToClear) : ""} will be hidden from the default order list. The order, audit history, and any receipts are retained. You can recover it by turning on “Show cleared POs”.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={command.isPending} onClick={() => setOrderToClear(null)}>Keep order visible</Button>
          <Button variant="destructive" disabled={command.isPending || !can("inventory.purchase") || !orderToClear}
            onClick={() => orderToClear && runOrderCommand("archiveOrder", orderToClear)}>Clear PO</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!orderToClose} onOpenChange={open => { if (!open && !command.isPending) setOrderToClose(null); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onEscapeKeyDown={event => { if (command.isPending) event.preventDefault(); }} onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>Close remainder · <span className="font-mono">{orderToClose ? orderLabel(orderToClose) : ""}</span></DialogTitle><DialogDescription>Outstanding units will be recorded as explicitly unfulfilled. No stock movement is created. This cannot be undone.</DialogDescription></DialogHeader>
        {orderToClose && <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-3">{orderToClose.lines.map(line => {
          const item = items.find(value => value.id === line.itemId);
          const p = orderLineProgress(state, orderToClose, line.itemId);
          const closedShort = Math.max(0, p.ordered - p.received);
          return <div key={line.itemId} className="flex justify-between gap-3 border-b pb-2 text-sm last:border-0 last:pb-0"><span>{item?.name ?? line.itemId} <span className="font-mono text-xs text-muted-foreground">{item?.sku}</span></span><span className="font-mono tabular-nums">{closedShort} closed short</span></div>;
        })}</div>}
        <div className="space-y-1"><Label htmlFor="close-order-reason">Closure reason</Label><Textarea id="close-order-reason" maxLength={1000} rows={3} value={closeReason} onChange={event => setCloseReason(event.target.value)} placeholder="Document why the remaining quantity will not be fulfilled" /></div>
        <DialogFooter><Button variant="outline" disabled={command.isPending} onClick={() => setOrderToClose(null)}>Stay</Button><Button variant="destructive" disabled={!closeReason.trim() || command.isPending || !can("inventory.closeOrders")} onClick={() => void confirmCloseOrder()}>{command.isPending ? "Closing…" : "Confirm close with exceptions"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {isError && <Alert variant="destructive"><AlertTitle>Inventory refresh failed</AlertTitle><AlertDescription>The last loaded inventory is shown. Your count entries were kept; retry before relying on current stock.</AlertDescription><Button variant="outline" className="mt-2" onClick={() => refetch()}>Retry inventory refresh</Button></Alert>}
    <Tabs value={inventoryTab} onValueChange={setInventoryTab} className="flex min-h-0 flex-1 flex-col gap-1.5 sm:gap-3 [&>[role=tabpanel]]:mt-0 md:[&>[role=tabpanel]]:mt-2">
      <div className="inventory-sticky-header relative z-10 shrink-0 space-y-2 border-b bg-background pb-2 sm:space-y-3 sm:pb-3" data-testid="inventory-sticky-header">
        <div className="flex min-w-0 items-center justify-between gap-2 sm:items-center">
          <div className="inventory-desktop-heading hidden min-w-0 md:block">
            <p className="mb-0.5 hidden text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:block">Project operations</p>
            <h1 className="text-xl font-semibold tracking-tight sm:text-3xl">Inventory</h1>
            <p className="mt-1 hidden text-sm text-muted-foreground sm:block">Know what’s on hand, where it lives, and which serial leaves with each crew.</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:flex-wrap sm:gap-2">
            <Button
              size="sm"
              variant={showInventoryStats ? "secondary" : "outline"}
              className="h-9 px-2 sm:px-3"
              aria-expanded={showInventoryStats}
              aria-controls="inventory-stats-region"
              data-testid="button-toggle-inventory-stats"
              aria-label={showInventoryStats ? "Hide inventory stats" : "Show inventory stats"}
              onClick={() => setShowInventoryStats(value => !value)}
            >
              <BarChart3 className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">{showInventoryStats ? "Hide Stats" : "Show Stats"}</span>
              {showInventoryStats ? <ChevronUp className="ml-1 hidden h-4 w-4 sm:block" /> : <ChevronDown className="ml-1 hidden h-4 w-4 sm:block" />}
            </Button>
            {can("inventory.maintain") && <Button size="sm" variant="outline" className="inventory-desktop-action hidden h-9 px-3 md:inline-flex" aria-label="Add location" onClick={() => openResource("warehouse")}><Plus className="mr-1.5 h-4 w-4" />Location</Button>}
            {can("inventory.maintain") && <Button size="sm" className="inventory-desktop-action hidden h-9 px-3 md:inline-flex" aria-label="Add new item" onClick={() => openResource("item")}><Plus className="mr-1.5 h-4 w-4" />New item</Button>}
            {(can("inventory.purchase") || can("inventory.transfer")) && <Button size="sm" className="inventory-desktop-action hidden h-9 px-3 md:inline-flex" aria-label="Build an order draft" onClick={() => { setInventoryTab("orders"); startNewOrderDraft(); }}><Plus className="mr-1.5 h-4 w-4" />Build an order draft</Button>}
          </div>
        </div>
        <div
          id="inventory-stats-region"
          role="region"
          aria-label="Inventory statistics"
          data-testid="inventory-stats-region"
          hidden={!showInventoryStats}
          className={showInventoryStats ? "grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4" : "hidden"}
        >
          <Metric label="Active locations" value={activeWarehouses.length} detail={`${warehouses.filter(value => value.type === "vehicle").length} vehicles`} icon={<WarehouseIcon className="h-4 w-4" />} />
          <Metric label="Catalog items" value={items.filter(item => item.active).length} detail={`${items.filter(item => item.tracking === "serialized").length} serial tracked`} icon={<Package className="h-4 w-4" />} />
          <Metric label="Open orders" value={orderItems.filter(order => ["draft", "released", "partial"].includes(order.status)).length} detail="Purchases and transfers" icon={<ArrowLeftRight className="h-4 w-4" />} />
          <Metric label="Open counts" value={state.counts.filter(count => count.status === "open").length} detail={`Ledger revision ${state.revision}`} icon={<ClipboardList className="h-4 w-4" />} />
        </div>
        <div className="inventory-mobile-menu !mt-0 absolute left-0 right-12 top-0 md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="h-9 w-full justify-between" aria-label={`Inventory sections, current: ${inventoryTabs.find(tab => tab.value === inventoryTab)?.label ?? "Stock & search"}`} data-testid="inventory-mobile-menu">
                <span className="flex min-w-0 items-center gap-2"><Menu className="h-4 w-4 shrink-0" /><span className="truncate">{inventoryTabs.find(tab => tab.value === inventoryTab)?.label ?? "Stock & search"}</span></span>
                <ChevronDown className="h-4 w-4 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[min(70dvh,30rem)] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
              {can("inventory.maintain") && <DropdownMenuItem onSelect={() => openResource("warehouse")}>Add location</DropdownMenuItem>}
              {can("inventory.maintain") && <DropdownMenuItem onSelect={() => openResource("item")}>Add new item</DropdownMenuItem>}
              {can("inventory.maintain") && <DropdownMenuItem onSelect={() => setInventoryTab("categories")}>Manage categories</DropdownMenuItem>}
              {(can("inventory.purchase") || can("inventory.transfer")) && <DropdownMenuItem onSelect={() => { setInventoryTab("orders"); startNewOrderDraft(); }}>Build an order draft</DropdownMenuItem>}
              {inventoryTabs.map(tab => <DropdownMenuItem key={tab.value} aria-label={tab.label} data-testid={`inventory-mobile-menu-item-${tab.value}`} onSelect={() => setInventoryTab(tab.value)}>
                {tab.label}
              </DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <TabsList className="inventory-desktop-tabs hidden h-auto w-full flex-wrap justify-start gap-1 md:flex">
          <TabsTrigger value="stock">Stock &amp; search</TabsTrigger>
          <TabsTrigger value="locations">Locations</TabsTrigger>
          <TabsTrigger value="items">Items</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="exceptions">Shipment exceptions</TabsTrigger>
          <TabsTrigger value="counts">Counts &amp; assembly</TabsTrigger>
          <TabsTrigger value="returns">Removed Equipment</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
      </div>

    <div className={`min-h-0 flex-1 ${["orders", "stock", "items", "vendors", "categories", "locations", "exceptions", "returns", "activity"].includes(inventoryTab) ? "flex flex-col overflow-hidden" : "space-y-5 overflow-y-auto overscroll-contain pb-8 pr-1"}`} data-testid="inventory-scroll-content" role="region" aria-label="Inventory content" tabIndex={0}>
    {!hasAny && <Alert hidden={["orders", "stock", "items", "vendors", "categories"].includes(inventoryTab)}><Boxes className="h-4 w-4" /><AlertTitle>Set up the first stock location</AlertTitle><AlertDescription>Add a warehouse or service vehicle, then add catalog items and begin receiving meters.</AlertDescription></Alert>}

      <TabsContent value="stock" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryStockWorkspace rows={allStockRows} projectName={data.projectName} timezone={timezone} onRefresh={() => void refetch()}
          onViewSerials={row => setSelectedStockKey(`${row.itemId}/${row.warehouseId}`)} />
      </TabsContent>
      <TabsContent value="locations" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryRecordsWorkspace kind="locations" title="Warehouses & vehicles" description="Access is enforced by the project inventory service for every operation." dataset={locationsDataset} projectName={data.projectName} timezone={timezone} onRefresh={() => void refetch()}
          headerAction={can("inventory.maintain") && <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" aria-label="Add location" title="Add location" onClick={() => openResource("warehouse")}><Plus className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Add location</span></Button>}
          renderRow={row => { const warehouse = warehouses.find(value => value.id === row.id); if (!warehouse) return null;
            const assigned = data.users.find(user => user.id === warehouse.assignedUserId)?.username ?? (warehouse.assignedUserId ? inventoryActorLabel(warehouse.assignedUserId, data.actors ?? data.users) : "None");
            const authorized = warehouse.userIds.map(id => data.users.find(user => user.id === id)?.username ?? inventoryActorLabel(id, data.actors ?? data.users));
            return <article className="min-w-0 rounded-md border bg-card px-3 py-2 sm:px-4 sm:py-3"><div className="flex min-w-0 items-start justify-between gap-2 sm:gap-3">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 font-medium"><h3 className="break-words">{warehouse.name}</h3><Badge variant="outline">{warehouse.type === "vehicle" ? "Vehicle" : "Warehouse"}</Badge>{!warehouse.active && <Badge variant="secondary">Inactive</Badge>}</div>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{warehouse.code}</p>
                <div className="hidden md:block">
                  <p className="mt-2 break-words text-sm text-muted-foreground">{warehouse.type === "vehicle" ? [warehouse.make, warehouse.model, warehouse.year, warehouse.plate && `${warehouse.plate} ${warehouse.plateState}`].filter(Boolean).join(" · ") : [warehouse.address, warehouse.city, warehouse.state, warehouse.zip].filter(Boolean).join(", ") || "Address not recorded"}</p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">Assigned: {assigned} · {warehouse.userIds.length} additional authorized{authorized.length ? ` · ${authorized.join(", ")}` : ""}</p>
                </div>
                <details className="md:hidden"><summary className="mt-1 cursor-pointer text-xs text-muted-foreground">Location details</summary><div>
                <p className="mt-2 break-words text-sm text-muted-foreground">{warehouse.type === "vehicle" ? [warehouse.make, warehouse.model, warehouse.year, warehouse.plate && `${warehouse.plate} ${warehouse.plateState}`].filter(Boolean).join(" · ") : [warehouse.address, warehouse.city, warehouse.state, warehouse.zip].filter(Boolean).join(", ") || "Address not recorded"}</p>
                <p className="mt-1 break-words text-xs text-muted-foreground">Assigned: {assigned} · {warehouse.userIds.length} additional authorized{authorized.length ? ` · ${authorized.join(", ")}` : ""}</p>
                </div></details>
              </div>{can("inventory.maintain") && <Button size="sm" variant="outline" onClick={() => openResource("warehouse", warehouse)}>Edit</Button>}</div></article>;
          }} />
      </TabsContent>
      <TabsContent value="items" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryCatalogWorkspace kind="items" items={items} vendors={vendors} projectName={data.projectName} timezone={timezone}
          canMaintain={can("inventory.maintain")} onRefresh={() => void refetch()} onAdd={() => openResource("item")}
          onEditItem={item => openResource("item", item)} onEditVendor={vendor => openResource("vendor", vendor)} />
      </TabsContent>
      <TabsContent value="vendors" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryCatalogWorkspace kind="vendors" items={items} vendors={vendors} projectName={data.projectName} timezone={timezone}
          canMaintain={can("inventory.maintain")} onRefresh={() => void refetch()} onAdd={() => openResource("vendor")}
          onEditItem={item => openResource("item", item)} onEditVendor={vendor => openResource("vendor", vendor)} />
      </TabsContent>
      <TabsContent value="categories" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryRecordsWorkspace kind="categories" title="Item categories" description="Project-wide catalog groups. Existing item categories are included automatically."
          dataset={categoriesDataset} projectName={data.projectName} timezone={timezone} onRefresh={() => void refetch()}
          headerAction={<InventoryCategoryCreateAction canMaintain={can("inventory.maintain")} pending={command.isPending}
            onCreate={(name, operationId) => command.mutateAsync({ action: "category", data: { name }, operationId })} />}
          renderRow={row => {
            const categoryName = String(row.cells.name ?? "");
            return <article className="flex min-w-0 items-center justify-between gap-3 rounded-md border bg-card px-3 py-2.5">
              <div className="min-w-0"><h3 className="break-words text-sm font-medium">{categoryName}</h3></div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="secondary">{Number(row.cells.itemCount ?? 0)} {Number(row.cells.itemCount ?? 0) === 1 ? "item" : "items"}</Badge>
                <InventoryCategoryCreateAction canMaintain={can("inventory.maintain")} pending={command.isPending}
                  categoryId={row.id}
                  categoryName={categoryName}
                  onRename={(id, newName, operationId) => command.mutateAsync({
                    action: "categoryRename", data: { id, newName }, operationId,
                  })} />
              </div>
            </article>;
          }} />
      </TabsContent>

      <TabsContent value="orders" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <Dialog open={shipmentDraftsOpen} onOpenChange={setShipmentDraftsOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader><DialogTitle>Saved shipment drafts</DialogTitle><DialogDescription>Continue a saved receiving, dispatch, or arrival capture. Access remains owner-only, except administrators may take ownership.</DialogDescription></DialogHeader>
            <InventoryShipmentDraftsPanel base={base} state={state} users={data.users} orders={orderItems}
              userId={user?.id} isAdmin={user?.role === "admin"} onResume={(draft, snapshot) => void resumeShipmentDraft(draft, snapshot)} />
          </DialogContent>
        </Dialog>
        {can("inventory.purchase") || can("inventory.transfer") ? <>
          <Dialog open={orderEditorOpen} onOpenChange={open => {
            if (open) setOrderEditorOpen(true);
            else if (!orderSaving.current) closeOrderEditor();
          }}>
            <DialogContent data-testid="inventory-order-dialog" className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
              onEscapeKeyDown={event => { if (orderSaving.current) event.preventDefault(); }}
              onPointerDownOutside={event => event.preventDefault()}>
              <DialogHeader>
                <DialogTitle>{editingOrderId ? "Edit order draft" : replacementFor ? "Create replacement draft" : "Build an order draft"}</DialogTitle>
                <DialogDescription>{editingOrderId
                  ? `Update ${orderTitle(editingOrderId)}. Its generated order number and internal ID stay unchanged.`
                  : replacementFor
                  ? `This new order is linked to ${orderTitle(replacementFor)}. The original quantities and exception history stay unchanged.`
                  : "Plan items and quantities now. Record serials later during receiving or transfer dispatch."}</DialogDescription>
              </DialogHeader>
              <fieldset disabled={command.isPending} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1"><Label>Order type</Label><Select value={orderType} onValueChange={value => setOrderType(value as "purchase" | "transfer")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="purchase">Purchase</SelectItem><SelectItem value="transfer">Transfer</SelectItem></SelectContent></Select></div>
            <div className="space-y-1"><Label>Destination</Label><Select value={orderDestination} onValueChange={setOrderDestination}><SelectTrigger><SelectValue placeholder="Choose location" /></SelectTrigger><SelectContent>{activeWarehouses.map(w => <SelectItem value={w.id} key={w.id}>{w.code} · {w.name}</SelectItem>)}</SelectContent></Select></div>
            {orderType === "purchase" ? <div className="space-y-1"><Label>Vendor</Label><Select value={orderVendor} onValueChange={setOrderVendor}><SelectTrigger><SelectValue placeholder="Choose vendor" /></SelectTrigger><SelectContent>{vendors.filter(v => v.active).map(v => <SelectItem value={v.id} key={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></div> : <div className="space-y-1"><Label>Source</Label><Select value={orderSource} onValueChange={setOrderSource}><SelectTrigger><SelectValue placeholder="Choose location" /></SelectTrigger><SelectContent>{activeWarehouses.filter(w => w.id !== orderDestination).map(w => <SelectItem value={w.id} key={w.id}>{w.code} · {w.name}</SelectItem>)}</SelectContent></Select></div>}
            <div className="space-y-1"><Label htmlFor="order-id-reference">Supplier/customer reference</Label><Input id="order-id-reference" maxLength={100} aria-describedby="order-id-reference-help" value={orderId} onChange={event => setOrderId(event.target.value)} placeholder="Optional supplier PO or reference" /><p id="order-id-reference-help" className="text-xs text-muted-foreground">Optional reference, not the order ID. Changing it edits this draft; the generated number and internal ID stay unchanged.</p></div>
          </div>
          <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm font-medium" role="status">Order number: <span className="font-mono">{editingOrderId ? orderTitle(editingOrderId) : "Assigned automatically when saved"}</span></p>
          {replacementFor && <div className="flex items-center justify-between gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm"><span>Replacement for <span className="font-mono font-medium">{orderTitle(replacementFor)}</span></span><Button type="button" size="sm" variant="ghost" onClick={() => setReplacementFor("")}>Unlink replacement</Button></div>}
          <OrderLineEditor items={items} draftMode lineItem={orderLineItem} setLineItem={setOrderLineItem} lineQty={orderLineQty} setLineQty={setOrderLineQty} lines={orderLines} quantityValues={orderLineQuantities} setQuantityValue={(itemId, value) => setOrderLineQuantities(current => { const next = { ...current }; const original = orderLines.find(line => line.itemId === itemId); if (original && value === String(original.quantity)) delete next[itemId]; else next[itemId] = value; return next; })} add={addLine} remove={index => { const line = orderLines[index]; setOrderLines(value => value.filter((_, i) => i !== index)); if (line) setOrderLineQuantities(current => { const next = { ...current }; delete next[line.itemId]; return next; }); }} />
          <Textarea aria-label="Order notes" placeholder="Notes for purchasing or the receiving crew" value={orderNotes} onChange={event => setOrderNotes(event.target.value)} />
          {orderDirty && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Unsaved order changes. Save the draft to keep your entries.</p>}
          {orderHasPendingLine && <div className="flex flex-wrap items-center gap-2"><p className="text-sm">Add or clear the unfinished line before saving.</p><Button type="button" variant="outline" size="sm" onClick={() => { setOrderLineItem(""); setOrderLineQty("1"); }}>Clear unfinished line</Button></div>}
          {orderMessage && <p role="status" className="text-sm">{orderMessage}</p>}
              </fieldset>
              <DialogFooter className="flex-col-reverse sm:flex-row">
                <Button variant="outline" disabled={orderSaving.current} onClick={closeOrderEditor}>Cancel</Button>
                <Button disabled={command.isPending || !canSaveOrder} onClick={() => saveOrderDraft()}><Plus className="mr-2 h-4 w-4" />Save draft</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </> : null}
        <Dialog open={orderFiltersOpen} onOpenChange={setOrderFiltersOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader><DialogTitle>Filter orders</DialogTitle><DialogDescription>Refine the order list by type, status, locations, vendor, date, and sort order.</DialogDescription></DialogHeader>
            <InventoryOrderFilters filters={orderFilters} onChange={setOrderFilters} warehouses={warehouses} vendors={vendors}
              timezone={timezone} resultCount={visibleOrders.length} totalCount={orderItems.filter(order => showClearedOrders || !order.archivedAt).length} showSearch={false} />
          </DialogContent>
        </Dialog>
        <section className="flex min-h-0 flex-1 flex-col" aria-label="Purchase and transfer orders">
          <header className="z-10 shrink-0 border-b bg-background px-1 pb-2 sm:pb-3" data-testid="inventory-orders-subheader">
            <div className="flex flex-nowrap items-center justify-between gap-x-2 sm:gap-x-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate whitespace-nowrap text-base font-semibold tracking-tight sm:text-lg">Purchase &amp; transfer orders</h2>
                <p className="hidden text-xs text-muted-foreground sm:block">Review orders, capture movements, and follow exceptions.</p>
              </div>
            </div>
            <InventoryMobileTools tab="orders">
              <div className="mt-1 space-y-2 rounded-md border bg-card p-2 md:rounded-none md:border-0 md:bg-transparent md:p-0">
              <div className="flex items-center gap-1.5">
                {(can("inventory.purchase") || can("inventory.transfer")) && <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" aria-label="Build an order draft" title="Build an order draft" onClick={() => { setInventoryTab("orders"); startNewOrderDraft(); }}><Plus className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Build an order draft</span></Button>}
                <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="Refresh orders" title="Refresh orders" onClick={() => void refetch()}><RefreshCw className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Refresh</span></Button>
                <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="Saved shipment drafts" title="Saved shipment drafts" onClick={() => setShipmentDraftsOpen(true)}><ClipboardList className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Saved shipment drafts</span></Button>
                <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="CSV" title="CSV" disabled={!visibleOrders.length} onClick={async () => {
                  try { await downloadInventoryOrders("csv", { project: data.projectName, timezone }, visibleOrders, state); }
                  catch (error) { toast({ title: "CSV export failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" }); }
                }}><Download className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">CSV</span></Button>
                <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="Excel" title="Excel" disabled={!visibleOrders.length} onClick={async () => {
                  try { await downloadInventoryOrders("xlsx", { project: data.projectName, timezone }, visibleOrders, state); }
                  catch (error) { toast({ title: "Excel export failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" }); }
                }}><FileSpreadsheet className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Excel</span></Button>
                <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" variant="outline" aria-label="PDF / Print" title="PDF / Print" disabled={!visibleOrders.length} onClick={async () => {
                  try { await downloadInventoryOrders("pdf", { project: data.projectName, timezone }, visibleOrders, state); }
                  catch (error) { toast({ title: "PDF export failed", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" }); }
                }}><FileText className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">PDF / Print</span></Button>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input aria-label="Search orders" className="h-9 pl-9" type="search" autoComplete="off"
                    placeholder="Order number, reference, ID, product, vendor or location"
                    value={orderFilters.query} onChange={event => setOrderFilters(current => ({ ...current, query: event.target.value }))} />
                </div>
                <Button size="sm" variant="outline" aria-label="Filters" aria-expanded={orderFiltersOpen} onClick={() => setOrderFiltersOpen(true)}><Filter className="mr-1.5 h-4 w-4" />Filters</Button>
                <div className="flex shrink-0 items-center gap-2 rounded-md border px-2 py-1.5">
                  <Checkbox id="show-cleared-orders" checked={showClearedOrders} onCheckedChange={checked => setShowClearedOrders(checked === true)} aria-label="Show cleared purchase orders" />
                  <Label htmlFor="show-cleared-orders" className="cursor-pointer text-xs">Cleared</Label>
                </div>
              </div>
              {can("inventory.maintain") && orderItems.some(order => uuidOrderId(order.id) && !order.orderNumber) &&
                <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => command.mutate({ action: "numberOrders", data: {} })}>Assign legacy order numbers</Button>}
              </div>
            </InventoryMobileTools>
            {!orderEditorOpen && orderMessage && <p className="mt-2 rounded-md border border-emerald-700/20 bg-emerald-700/5 px-3 py-2 text-sm" role="status">{orderMessage}</p>}
          </header>
          <div ref={setOrderResultsElement} className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-2" data-testid="inventory-order-results" data-page-size={orderRowsPerPage} role="region" aria-label="Order results" tabIndex={0}>
          <div className="space-y-2">
          {pagedOrders.map(order => {
            const archived = !!order.archivedAt;
            const purchase = order.type === "purchase";
            const unreleaseLocked = ["released", "partial", "completed"].includes(order.status) && isUnreleaseLocked(order);
            return <article key={order.id} data-testid="inventory-order-card" data-order-id={order.id} className="min-w-0 rounded-md border bg-card px-3 py-2.5">
              <div className="flex min-w-0 flex-col justify-between gap-2 lg:flex-row lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 font-medium"><span className="font-mono">{orderLabel(order)}</span><Badge variant={order.status === "completed" ? "default" : "outline"}>{order.status}</Badge><Badge variant="secondary">{order.type}</Badge>{order.replacementFor && <Badge variant="outline">replacement for {orderTitle(order.replacementFor)}</Badge>}{archived && <Badge variant="secondary">cleared</Badge>}</div>
                  <p className="mt-1 truncate text-xs text-muted-foreground md:whitespace-normal md:break-words md:text-sm">{purchase ? vendors.find(v => v.id === order.vendorId)?.name : warehouses.find(w => w.id === order.sourceId)?.name} → {warehouses.find(w => w.id === order.destinationId)?.name}{orderReference(order) ? ` · Ref ${orderReference(order)}` : ""}</p>
                  <p className="text-xs text-muted-foreground">{order.lines.length} {order.lines.length === 1 ? "item" : "items"} · created {new Date(order.createdAt).toLocaleDateString(undefined, { timeZone: timezone })}</p>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 max-md:[&>button]:h-7 max-md:[&>button]:min-h-7 max-md:[&>button]:px-2 max-md:[&>button]:text-xs">
                  <Button size="sm" variant="outline" onClick={() => openPrint("order", order.id)}><Printer className="mr-1 h-3.5 w-3.5" />Print</Button>
                  {order.status === "draft" && can(purchase ? "inventory.purchase" : "inventory.transfer") && <><Button size="sm" variant="outline" onClick={() => editOrderDraft(order)}>Edit draft</Button><Button size="sm" disabled={command.isPending} onClick={() => command.mutate({ action: "release", data: { orderId: order.id } })}>Release</Button></>}
                  {!["completed", "cancelled", "closed"].includes(order.status) && can(purchase ? "inventory.purchase" : "inventory.transfer") && <Button size="sm" variant="ghost" disabled={command.isPending} onClick={() => command.mutate({ action: "cancel", data: { orderId: order.id } })}>Cancel</Button>}
                  {["released", "partial"].includes(order.status) && can(purchase ? "inventory.receive" : "inventory.transfer") &&
                    order.lines.some(line => purchase ? orderLineProgress(state, order, line.itemId).remaining > 0 :
                      orderLineProgress(state, order, line.itemId).ordered > orderLineProgress(state, order, line.itemId).dispatched) ?
                    <Button size="sm" disabled={command.isPending} onClick={() => openOrderOperation(order, purchase ? "receive" : "dispatch")}>{purchase ? "Receive" : "Dispatch"}</Button> : null}
                  {order.type === "transfer" && ["released", "partial"].includes(order.status) && can("inventory.receive") &&
                    order.dispatched.some(line => orderLineProgress(state, order, line.itemId).inTransit > 0) &&
                    <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => openOrderOperation(order, "accept")}>Accept arrival</Button>}
                  {order.type === "transfer" && ["released", "partial"].includes(order.status) && order.lines.some(line => orderLineProgress(state, order, line.itemId).inTransit > 0) && can("inventory.resolveExceptions") && <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => setTransitOrder(order)}>Resolve transit loss</Button>}
                  {["released", "partial"].includes(order.status) && can("inventory.closeOrders") &&
                    !(order.type === "transfer" && order.lines.some(line => orderLineProgress(state, order, line.itemId).inTransit > 0)) &&
                    <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => { setOrderToClose(order); setCloseReason(""); }}>Close remainder</Button>}
                  {order.status !== "draft" && order.status !== "cancelled" && order.lines.some(line => {
                    const progress = orderLineProgress(state, order, line.itemId);
                    return progress.ordered > progress.usable;
                  }) && can(purchase ? "inventory.purchase" : "inventory.transfer") && <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => startReplacementOrder(order)}>Create replacement</Button>}
                  {order.status === "released" && !archived && can(purchase ? "inventory.purchase" : "inventory.transfer") && <Button size="sm" variant="outline" disabled={command.isPending || isUnreleaseLocked(order)} onClick={() => requestOrderTransition(() => runOrderCommand("unrelease", order))}>Un-release to draft</Button>}
                  {purchase && order.status === "cancelled" && !archived && can("inventory.purchase") && <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => requestOrderTransition(() => setOrderToClear(order))}>Clear</Button>}
                  {purchase && order.status === "cancelled" && archived && can("inventory.purchase") && <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => requestOrderTransition(() => runOrderCommand("restoreOrder", order))}>Restore</Button>}
                </div>
              </div>
              <details className="mt-2 border-t pt-1.5 text-xs">
                <summary className="w-fit cursor-pointer text-muted-foreground">Order details · lines, progress, and internal ID</summary>
                <div className="mt-2 space-y-1.5">
                  <p className="break-words md:hidden">{purchase ? vendors.find(v => v.id === order.vendorId)?.name : warehouses.find(w => w.id === order.sourceId)?.name} → {warehouses.find(w => w.id === order.destinationId)?.name}{orderReference(order) ? ` · Ref ${orderReference(order)}` : ""}</p>
                  <div className="flex flex-wrap items-center gap-2 text-muted-foreground"><span className="break-all font-mono">{order.id}</span><Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(order.id).catch(() => toast({ title: "Copy unavailable", description: "Select and copy the displayed internal ID." }))}>Copy internal ID</Button></div>
                  {unreleaseLocked && <p className="text-muted-foreground" role="note">{(state.shipmentDrafts ?? []).some(draft => draft.orderId === order.id) ? "Resume or discard the saved shipment capture before un-releasing this order." : "This order has posted shipment activity and cannot return to draft. Dispatches and receipts must remain attached to the order."}</p>}
                  <div className="grid gap-1 border-t pt-2">{order.lines.map(line => {
                const item = items.find(value => value.id === line.itemId);
                const p = orderLineProgress(state, order, line.itemId);
                return <p key={line.itemId} className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{item?.name ?? line.itemId} <span className="font-mono">{item?.sku}</span></span>
                  <span>ordered {p.ordered}</span><span>dispatched {p.dispatched}</span><span>received {p.received}</span>
                  {p.damaged > 0 && <span>damaged {p.damaged}</span>}{p.held > 0 && <span>held {p.held}</span>}
                  <span>usable {p.usable}</span>{p.inTransit > 0 && <span>in transit {p.inTransit}</span>}
                  {p.lost > 0 && <span>loss {p.lost}</span>}{p.remaining > 0 && <span>remaining {p.remaining}</span>}
                  {p.closedShort > 0 && <span>closed short {p.closedShort}</span>}
                </p>;
                  })}</div>
                  {order.closure && <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Closed by {order.closure.actor} · {new Date(order.closure.occurredAt).toLocaleString()} · {order.closure.reason}</p>}
                </div>
              </details>
            </article>;
          })}</div>
          {visibleOrders.length === 0 && <div className="grid min-h-36 place-items-center"><Empty title={orderItems.length ? "No matching orders" : "No orders yet"} description={orderItems.length ? "Clear search or reset filters; enable Show cleared POs to include cleared purchase orders." : "Draft a purchase order or a transfer between a stockroom and service vehicle."} /></div>}
          </div>
          <nav className="flex shrink-0 flex-wrap items-center gap-2 border-t px-1 py-2" data-testid="inventory-orders-pagination" aria-label="Order pages">
            <p className="mr-auto text-xs text-muted-foreground" aria-live="polite">{visibleOrders.length ? `${currentOrderPage * orderRowsPerPage + 1}–${Math.min(visibleOrders.length, (currentOrderPage + 1) * orderRowsPerPage)} of ${visibleOrders.length}` : "0 orders"}</p>
            <Button size="sm" variant="outline" aria-label="Previous order page" disabled={currentOrderPage === 0} onClick={() => { setOrderPage(Math.max(0, currentOrderPage - 1)); orderResultsElement?.scrollTo({ top: 0 }); }}>Previous</Button>
            <span className="min-w-16 text-center text-xs tabular-nums">Page {currentOrderPage + 1} / {orderPageCount}</span>
            <Button size="sm" variant="outline" aria-label="Next order page" disabled={currentOrderPage >= orderPageCount - 1} onClick={() => { setOrderPage(currentOrderPage + 1); orderResultsElement?.scrollTo({ top: 0 }); }}>Next</Button>
          </nav>
        </section>
      </TabsContent>
      <TabsContent value="exceptions" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryShipmentExceptions state={state} items={items} orders={orderItems} canResolve={can("inventory.resolveExceptions")}
          onDirtyChange={setMovementDirty}
          busy={command.isPending} onPrintOrder={id => openPrint("order", id)} onPrintReceipt={id => openPrint("receipt", id)}
          onResolve={payload => postWithStableIdentity("resolveHold", payload)} projectName={data.projectName} timezone={timezone}
          actors={data.actors ?? []} users={data.users} onRefresh={() => void refetch()} />
      </TabsContent>

      <TabsContent value="counts" className="space-y-3 sm:space-y-4"><Card><CardHeader className="space-y-1 px-3 py-3 sm:px-6 sm:py-6"><CardTitle className="text-base sm:text-lg">Physical stock count</CardTitle><CardDescription>Start a snapshot, count every item including zero, and post with a reason.</CardDescription></CardHeader><CardContent className="space-y-3 px-3 pb-3 sm:space-y-4 sm:px-6 sm:pb-6">
          <InventoryMobileTools tab="counts">
            <div className="flex flex-wrap items-end gap-2 rounded-md border bg-card p-2 sm:gap-3 sm:border-0 sm:bg-transparent sm:p-0"><div className="w-full min-w-0 flex-1 space-y-1 sm:max-w-sm"><Label>Warehouse or vehicle</Label><Select value={countWarehouse} onValueChange={setCountWarehouse}><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{activeWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>)}</SelectContent></Select></div>{can("inventory.count") && <Button className="shrink-0" onClick={() => requestCountTransition(startCount)} disabled={!countWarehouse || command.isPending}>Start count</Button>}</div>
          </InventoryMobileTools>
          {state.counts.map(count => <div key={count.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 sm:p-3"><div className="min-w-0"><span className="font-medium">{warehouses.find(w => w.id === count.warehouseId)?.name ?? "Location unavailable"}</span><span className="ml-2 text-sm text-muted-foreground">{inventoryCountReference(state.counts, count.id)}</span><Badge className="ml-2" variant={count.status === "open" ? "outline" : "secondary"}>{count.status}</Badge></div>{count.status === "open" && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={command.isPending} onClick={() => { if (activeCount?.id !== count.id) requestCountTransition(() => openCount(count, true)); }}>Continue count</Button><Button size="sm" variant="outline" disabled={!can("inventory.count") || command.isPending} onClick={() => cancelCount(count)}>Cancel count</Button></div>}{count.status === "posted" && <Button size="sm" variant="ghost" onClick={() => openPrint("count", count.id)}>Print</Button>}</div>)}
          {activeCount && <div className="space-y-2 rounded-md border bg-muted/30 p-2.5 sm:space-y-3 sm:rounded-lg sm:p-4">
            <div><h3 className="font-medium">{inventoryCountReference(state.counts, activeCount.id)} · {warehouses.find(w => w.id === activeCount.warehouseId)?.name}</h3><p className="text-xs text-muted-foreground">Verify all snapshot items, including zero quantities. Add discovered products below; unused project catalog products are not required. Every entry on every page is included when saving or posting. Save count draft before leaving. Saving does not adjust stock.</p></div>
            <p role="status" className="text-sm">{countDraftMessage || "Unsaved entries remain only on this page until you save the draft."}</p>
            <div className="space-y-2 rounded border p-3">
              <Label htmlFor="count-discovery-search">Find discovery product</Label>
              <Input id="count-discovery-search" value={countProductSearch} disabled={command.isPending} onChange={event => { setCountProductSearch(event.target.value); setCountProduct(""); }} placeholder="Search the project catalog by SKU, name or barcode" />
              <Label htmlFor="count-discovery-product">Discovery product</Label>
              <Select value={countProduct} onValueChange={setCountProduct} disabled={command.isPending || !can("inventory.count")}><SelectTrigger id="count-discovery-product"><SelectValue placeholder="Choose a product found in this warehouse" /></SelectTrigger><SelectContent>{discoveryProducts.map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select>
              <p className="text-xs text-muted-foreground">Up to 100 matches shown. Refine the search for another product. Adding a product starts at zero; enter its actual quantity and scans.</p>
              <Button variant="outline" onClick={addCountProduct} disabled={!can("inventory.count") || !countProduct || command.isPending || countRows.length >= COUNT_MAX_LINES}>Add discovery to count</Button>
            </div>
            <Label htmlFor="count-entry-search">Search count entries</Label>
            <Input id="count-entry-search" value={countSearch} onChange={event => { setCountSearch(event.target.value); setCountPage(0); }} placeholder="Filter entered items by SKU or name; hidden entries are still included" />
            <p className="text-sm">{countRows.length} total count entries · {matchingCountRows.length} matching · limit {COUNT_MAX_LINES}. All pages are saved and posted together.</p>
            {visibleCountRows.map(row => {
              const { itemId: id, item } = row;
              if (!item) return <Alert key={id} variant="destructive"><AlertTitle>Count item unavailable</AlertTitle><AlertDescription>Item {id} is no longer in the catalog. Resolve it before posting; it will not be silently omitted.</AlertDescription></Alert>;
              const old = activeCount.snapshot.find(row => row.itemId === id);
              return <div key={id} className="grid gap-2 rounded border bg-background p-2 sm:grid-cols-[1fr_130px_2fr] sm:items-end sm:p-3">
                <div><div className="font-medium">{item.name}</div><div className="font-mono text-xs text-muted-foreground">{item.sku} · snapshot {old?.quantity ?? 0}</div></div>
                <div className="space-y-1"><Label htmlFor={`count-${id}`}>Actual quantity</Label><Input id={`count-${id}`} type="number" min="0" max="1000000" step="1" value={row.quantity} disabled={command.isPending} onChange={event => setCountQuantities(current => ({ ...current, [id]: event.target.value }))} /></div>
                {item.tracking === "serialized" && <div className="space-y-1"><Label htmlFor={`countserial-${id}`}>Scan all serials</Label><Textarea id={`countserial-${id}`} value={row.serials} disabled={command.isPending} onChange={event => setCountSerials(current => ({ ...current, [id]: event.target.value }))} /></div>}
              </div>;
            })}
            {countRows.length === 0 && <p>No stock rows in the starting snapshot. Add discovered products, or post an empty count to confirm this warehouse is empty.</p>}
            <div className="flex flex-wrap items-center gap-2"><Button variant="outline" aria-label="Previous count entries page" disabled={currentCountPage === 0 || command.isPending} onClick={() => setCountPage(currentCountPage - 1)}>Previous</Button><span className="text-sm">Count entries page {currentCountPage + 1} of {lastCountPage + 1}</span><Button variant="outline" aria-label="Next count entries page" disabled={currentCountPage === lastCountPage || command.isPending} onClick={() => setCountPage(currentCountPage + 1)}>Next</Button></div>
            <div className="space-y-1"><Label htmlFor="count-reason">Count adjustment reason</Label><Input id="count-reason" maxLength={1000} disabled={command.isPending} value={countReason} onChange={event => setCountReason(event.target.value)} placeholder="Required audit note" /></div>
            {countDirty && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Unsaved count changes. Save the draft to keep your entries.</p>}
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => saveCountDraft()} disabled={!can("inventory.count") || command.isPending}>Save count draft</Button><Button variant="outline" onClick={() => requestCountTransition(reloadCountDraft)} disabled={!can("inventory.count") || command.isPending}>Reload saved draft</Button><Button onClick={postCount} disabled={!can("inventory.count") || !countReason.trim() || command.isPending}>Post count</Button><Button variant="outline" disabled={command.isPending} onClick={() => requestCountTransition(closeCount)}>Close</Button></div>
          </div>}
        </CardContent></Card>
        <Card><CardHeader className="space-y-1 px-3 py-3 sm:px-6 sm:py-6"><CardTitle className="text-base sm:text-lg">Assemble a kit</CardTitle><CardDescription>Select a defined kit; scan components from the selected location and record its finished serial identity.</CardDescription></CardHeader><CardContent className="space-y-3 px-3 pb-3 sm:space-y-4 sm:px-6 sm:pb-6"><div className="grid gap-2 sm:grid-cols-3 sm:gap-3"><div className="space-y-1"><Label>Kit item</Label><Select value={assembleItem} onValueChange={value => { setAssembleItem(value); setComponentScan({}); }}><SelectTrigger><SelectValue placeholder="Select kit" /></SelectTrigger><SelectContent>{items.filter(item => item.active && item.components.length).map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label>Build location</Label><Select value={assembleWarehouse} onValueChange={setAssembleWarehouse}><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{activeWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label>Build quantity</Label><Input type="number" min="1" value={assembleQty} onChange={event => setAssembleQty(event.target.value)} /></div></div>{items.find(item => item.id === assembleItem)?.components.map(component => { const item = items.find(value => value.id === component.itemId); return <div key={component.itemId} className="grid gap-2 sm:grid-cols-[1fr_2fr] sm:items-center"><Label>{item?.sku} · {item?.name} — {component.quantity * Number(assembleQty || 1)} required</Label><Input aria-label={`Scan ${item?.name ?? "component"} serials`} value={componentScan[component.itemId] ?? ""} onChange={event => setComponentScan(current => ({ ...current, [component.itemId]: event.target.value }))} placeholder={item?.tracking === "serialized" ? "Scan component serials" : "Quantity is taken from this location"} /></div>; })}{items.find(item => item.id === assembleItem)?.tracking === "serialized" && <div className="space-y-1"><Label>Finished kit serials</Label><Input value={assembleSerials} onChange={event => setAssembleSerials(event.target.value)} placeholder="Scan each finished unit" /></div>}<Button disabled={!can("inventory.assemble") || !assembleItem || !assembleWarehouse || command.isPending} onClick={() => { const kit = items.find(item => item.id === assembleItem); if (!kit) return; const quantity = Number(assembleQty); const components = kit.components.map(component => { const componentItem = items.find(item => item.id === component.itemId); const serialList = componentItem?.tracking === "serialized" ? csv(componentScan[component.itemId] ?? "") : []; return { itemId: component.itemId, quantity: componentItem?.tracking === "serialized" ? serialList.length : component.quantity * quantity, serials: serialList }; }); command.mutate({ action: "assemble", data: { warehouseId: assembleWarehouse, itemId: kit.id, quantity, serials: kit.tracking === "serialized" ? csv(assembleSerials) : [], components } }); }}>Assemble kit</Button></CardContent></Card>
      </TabsContent>
      <TabsContent value="returns" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryRecordsWorkspace kind="returns" title="Removed Equipment" description="Returned systems and modules enter quarantine first. Release to usable inventory only after inspection." dataset={returnsDataset} projectName={data.projectName} timezone={timezone} onRefresh={() => void refetch()}
          renderRow={row => { const returned = state.returns.find(value => value.id === row.id); if (!returned) return null;
            return <article className="flex min-w-0 flex-col justify-between gap-3 rounded-md border bg-card px-3 py-3 sm:flex-row sm:items-start sm:px-4">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-medium"><span>{returned.equipment === "system" ? "System" : "Module"}</span><span className="break-all font-mono text-sm">{returned.serial}</span><Badge variant={returned.status === "released" ? "default" : "outline"}>{returned.status}</Badge></div>
                <div className="mt-1 text-sm text-muted-foreground">Work order #{returned.workOrderId} · Return location: {warehouses.find(w => w.id === returned.warehouseId)?.name ?? "Location unavailable"}</div>
              </div><div className="flex min-w-0 flex-wrap gap-2">{returned.status === "pending" && can("inventory.receive") && <Button size="sm" disabled={command.isPending} onClick={() => command.mutate({ action: "returnAccept", data: { id: returned.id } })}>Accept into quarantine</Button>}
                {returned.status === "quarantine" && can("inventory.receive") && <div className="flex min-w-0 flex-wrap gap-2"><Select value={returnInspect[returned.id]?.itemId ?? ""} onValueChange={value => setReturnInspect(current => ({ ...current, [returned.id]: { itemId: value, reason: current[returned.id]?.reason ?? "" } }))}><SelectTrigger className="w-48"><SelectValue placeholder="Matching equipment item" /></SelectTrigger><SelectContent>{items.filter(item => item.tracking === "serialized" && item.equipment === returned.equipment).map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select><Input aria-label="Inspection result" placeholder="Inspection note" value={returnInspect[returned.id]?.reason ?? ""} onChange={event => setReturnInspect(current => ({ ...current, [returned.id]: { itemId: current[returned.id]?.itemId ?? "", reason: event.target.value } }))} /><Button size="sm" disabled={command.isPending || !returnInspect[returned.id]?.itemId || !returnInspect[returned.id]?.reason} onClick={() => command.mutate({ action: "returnRelease", data: { id: returned.id, itemId: returnInspect[returned.id].itemId, reason: returnInspect[returned.id].reason } })}>Release to stock</Button></div>}
              </div></article>;
          }} />
      </TabsContent>
      <TabsContent value="activity" data-testid="inventory-activity-entries" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryRecordsWorkspace kind="activity" title="Stock movement ledger" description="Good, damaged and short quantities retain their reasons and printable receipt references." dataset={activityDataset} projectName={data.projectName} timezone={timezone} onRefresh={() => void refetch()}
          renderRow={row => { const receipt = state.receipts.find(value => value.id === row.id); if (!receipt) return null;
            return <article className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-md border bg-card px-3 py-3 sm:px-4">
              <div className="min-w-0"><div className="break-words font-medium" data-testid="inventory-activity-title">{receipt.action} · {row.cells.reference}</div>
                <div className="mt-1 break-words text-xs text-muted-foreground">{row.cells.date} · {row.cells.actor} · {receiptSummary(receipt)}</div>
                {receipt.holdId && <p className="mt-1 text-xs">{inventoryHoldLabel(state.shipmentHolds ?? [], receipt.holdId)}</p>}
              </div><Button size="sm" variant="outline" onClick={() => openPrint(receipt.action.startsWith("count") ? "count" : "receipt", receipt.action.startsWith("count") ? receipt.reference : receipt.id)}><Printer className="mr-2 h-4 w-4" />Print</Button>
            </article>;
          }} />
      </TabsContent>
    </div>
    </Tabs>
    {selectedStockRow && can("inventory.view") && (
      <InventoryStockSerialDialog
        key={selectedStockKey}
        open
        onOpenChange={open => { if (!open) setSelectedStockKey(null); }}
        itemName={selectedStockRow.item?.name ?? ""}
        sku={selectedStockRow.item?.sku ?? ""}
        locationName={selectedStockRow.warehouse?.name ?? ""}
        locationCode={selectedStockRow.warehouse?.code ?? ""}
        project={data.projectName}
        serials={selectedStockRow.serials}
      />
    )}

    <Dialog open={!!resource} onOpenChange={open => { if (!open && !resourceSaving.current && !imageBusy) setResource(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{resource === "warehouse" ? "Location details" : resource === "vendor" ? "Vendor details" : "Item details"}</DialogTitle><DialogDescription>Changes apply only to this project. Keep scanned identities and stock rules intact.</DialogDescription></DialogHeader>
      {resourceError && <Alert ref={resourceErrorRef} tabIndex={-1} id="inventory-resource-error" role="alert" variant="destructive"><AlertTitle>Details not saved</AlertTitle><AlertDescription>{resourceError} Your entered values have been kept. Correct the details and retry, or cancel to discard them.</AlertDescription></Alert>}
      <fieldset disabled={resourceBusy} aria-describedby={resourceError ? "inventory-resource-error" : undefined} className="contents">
      {resource === "warehouse" && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" value={warehouseForm.code} set={value => setWarehouseForm(form => ({ ...form, code: value }))} /><Field label="Name" value={warehouseForm.name} set={value => setWarehouseForm(form => ({ ...form, name: value }))} />
        <div className="space-y-1"><Label>Location type</Label><Select value={warehouseForm.type} onValueChange={value => setWarehouseForm(form => ({ ...form, type: value as "physical" | "vehicle" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="physical">Warehouse</SelectItem><SelectItem value="vehicle">Service vehicle</SelectItem></SelectContent></Select></div>
        <Field label="Contact" value={warehouseForm.contact} set={value => setWarehouseForm(form => ({ ...form, contact: value }))} /><Field label="Phone" value={warehouseForm.phone} set={value => setWarehouseForm(form => ({ ...form, phone: value }))} />
        {warehouseForm.type === "physical" ? <><Field label="Street address" value={warehouseForm.address} set={value => setWarehouseForm(form => ({ ...form, address: value }))} /><Field label="City" value={warehouseForm.city} set={value => setWarehouseForm(form => ({ ...form, city: value }))} /><Field label="State" value={warehouseForm.state} set={value => setWarehouseForm(form => ({ ...form, state: value }))} /><Field label="ZIP" value={warehouseForm.zip} set={value => setWarehouseForm(form => ({ ...form, zip: value }))} /></> : <><Field label="VIN" value={warehouseForm.vin} set={value => setWarehouseForm(form => ({ ...form, vin: value }))} /><Field label="Plate" value={warehouseForm.plate} set={value => setWarehouseForm(form => ({ ...form, plate: value }))} /><Field label="Plate jurisdiction" value={warehouseForm.plateState} set={value => setWarehouseForm(form => ({ ...form, plateState: value }))} /><Field label="Make" value={warehouseForm.make} set={value => setWarehouseForm(form => ({ ...form, make: value }))} /><Field label="Model" value={warehouseForm.model} set={value => setWarehouseForm(form => ({ ...form, model: value }))} /><Field label="Year" value={String(warehouseForm.year ?? "")} set={value => setWarehouseForm(form => ({ ...form, year: value ? Number(value) : null }))} /></>}
        <div className="space-y-1"><Label>Primary assigned user</Label><Select value={warehouseForm.assignedUserId ?? "none"} onValueChange={value => setWarehouseForm(form => ({ ...form, assignedUserId: value === "none" ? null : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{data.users.map(user => <SelectItem key={user.id} value={user.id}>{user.username}</SelectItem>)}</SelectContent></Select></div>
        <div className="sm:col-span-2"><Label>Additional users with access</Label><div className="mt-2 grid gap-2 sm:grid-cols-2">{data.users.map(user => <label key={user.id} className="flex items-center gap-2 text-sm"><Checkbox checked={warehouseForm.userIds.includes(user.id)} onCheckedChange={checked => setWarehouseForm(form => ({ ...form, userIds: checked ? [...new Set([...form.userIds, user.id])] : form.userIds.filter(id => id !== user.id) }))} />{user.username}</label>)}</div></div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={warehouseForm.active} onCheckedChange={checked => setWarehouseForm(form => ({ ...form, active: checked === true }))} />Active location</label>
      </div>}
      {resource === "vendor" && <div className="grid gap-3 sm:grid-cols-2"><Field label="Name" value={vendorForm.name} set={value => setVendorForm(form => ({ ...form, name: value }))} /><Field label="Contact" value={vendorForm.contact} set={value => setVendorForm(form => ({ ...form, contact: value }))} /><Field label="Phone" value={vendorForm.phone} set={value => setVendorForm(form => ({ ...form, phone: value }))} /><Field label="Email" value={vendorForm.email} set={value => setVendorForm(form => ({ ...form, email: value }))} /><Field label="Address" value={vendorForm.address} set={value => setVendorForm(form => ({ ...form, address: value }))} /><Field label="Reference" value={vendorForm.reference} set={value => setVendorForm(form => ({ ...form, reference: value }))} /><label className="flex items-center gap-2"><Checkbox checked={vendorForm.active} onCheckedChange={checked => setVendorForm(form => ({ ...form, active: checked === true }))} />Active vendor</label></div>}
      {resource === "item" && <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2 rounded-md border bg-muted/30 p-3 text-sm leading-relaxed text-muted-foreground">
          Use Product ID, Product Label, and Product Description for the same product details you enter in the <strong className="text-foreground">System Type</strong> and <strong className="text-foreground">Module Type</strong> tables. Inventory items are separate records; values are not imported or synchronized automatically.
        </div>
        <Field label="Product ID (SKU)" required maxLength={200} value={itemForm.sku} set={value => setItemForm(form => ({ ...form, sku: value }))} help="Use the Product ID from the System Type or Module Type table, entered manually. Required and unique within this project (case-insensitive), up to 200 characters. Example: E460. Not an individual unit's serial number." />
        <Field label="Product Label (Name)" required maxLength={200} value={itemForm.name} set={value => setItemForm(form => ({ ...form, name: value }))} help="Use the Product Label from the System Type or Module Type table, entered manually. Required recognizable name, up to 200 characters. Example: Electric meter E460." />
        <Field label="Product Description" maxLength={500} value={itemForm.description} set={value => setItemForm(form => ({ ...form, description: value }))} help="Corresponds to Product Description in the System Type or Module Type table. Optional details, up to 500 characters. Example: Three-phase electric meter." className="sm:col-span-2" />
        <div className="space-y-1.5"><Label htmlFor="item-category">Category</Label><select id="item-category" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={itemForm.categoryId === undefined ? categoryCatalog.find(category => category.name.trim().toLocaleLowerCase() === itemForm.category.trim().toLocaleLowerCase())?.id ?? "" : itemForm.categoryId ?? ""} onChange={event => setItemForm(form => ({ ...form, categoryId: event.target.value || null }))}><option value="">None</option>{categoryCatalog.filter(category => category.active || category.id === itemForm.categoryId || (itemForm.categoryId === undefined && category.name.trim().toLocaleLowerCase() === itemForm.category.trim().toLocaleLowerCase())).map(category => <option key={category.id} value={category.id}>{category.name.trim().toLowerCase() === "none" ? `${category.name} (category)` : category.name}</option>)}</select><p className="text-xs leading-relaxed text-muted-foreground">Optional project category. To add a category, use the Categories tab.</p></div>
        <Field label="Unit" required maxLength={200} value={itemForm.unit} set={value => setItemForm(form => ({ ...form, unit: value }))} help="Required unit name, up to 200 characters. Defaults to each. Example: each for a meter or box for supplies. Inventory postings use whole-number quantities, even for units such as ft." />
        <Field label="Barcode" maxLength={500} value={itemForm.barcode} set={value => setItemForm(form => ({ ...form, barcode: value }))} help="Optional catalog barcode for identifying this product, up to 500 characters (example: 012345678905). A barcode identifies the product; it is not an individual unit's serial number." />
        <Field label="Manufacturer" maxLength={500} value={itemForm.manufacturer} set={value => setItemForm(form => ({ ...form, manufacturer: value }))} help="Optional maker name, up to 500 characters. Example: Acme Meter Works." />
        <Field label="Model" maxLength={500} value={itemForm.model} set={value => setItemForm(form => ({ ...form, model: value }))} help="Optional manufacturer's model identifier, up to 500 characters. Example: R-4100. This does not select System or Module; use Equipment for that." />
        <div className="space-y-1.5"><Label htmlFor="item-tracking">Tracking</Label><Select value={itemForm.tracking} onValueChange={value => setItemForm(form => ({ ...form, tracking: value as "regular" | "serialized" }))}><SelectTrigger id="item-tracking" aria-describedby="item-tracking-help"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="regular">Quantity tracked</SelectItem><SelectItem value="serialized">Serialized — scan each unit</SelectItem></SelectContent></Select><p id="item-tracking-help" className="text-xs leading-relaxed text-muted-foreground">Default is quantity tracked for ordinary supplies: stock can be recorded as 20 seals. Choose serialized for systems and modules when each physical unit must be identified, for example serial 0000456. Changing tracking is restricted while stock or assigned records exist.</p></div>
        <div className="space-y-1.5"><Label htmlFor="item-equipment">Equipment</Label><Select value={itemForm.equipment} onValueChange={value => setItemForm(form => ({ ...form, equipment: value as "none" | "system" | "module" }))}><SelectTrigger id="item-equipment" aria-describedby="item-equipment-help"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None — not equipment</SelectItem><SelectItem value="system">System</SelectItem><SelectItem value="module">Module</SelectItem></SelectContent></Select><p id="item-equipment-help" className="text-xs leading-relaxed text-muted-foreground">Default is None for supplies and other non-equipment products. Choose System or Module when this catalog item represents that equipment type; use serialized tracking for individual units. Example: a meter body is System, an add-on radio is Module.</p></div>
        <div className="space-y-1.5"><Label htmlFor="item-vendor">Vendor</Label><Select value={itemForm.vendorId ?? "none"} onValueChange={value => setItemForm(form => ({ ...form, vendorId: value === "none" ? null : value }))}><SelectTrigger id="item-vendor" aria-describedby="item-vendor-help"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{vendors.filter(v => v.active).map(v => <SelectItem value={v.id} key={v.id}>{v.name}</SelectItem>)}</SelectContent></Select><p id="item-vendor-help" className="text-xs leading-relaxed text-muted-foreground">Optional preferred project vendor. None is the default; choose a vendor such as North Valley Supply when relevant.</p></div>
        <Field label="Cost" type="number" min="0" step="any" value={String(itemForm.cost)} set={value => setItemForm(form => ({ ...form, cost: Number(value) || 0 }))} help="Optional unit cost; defaults to 0. Enter a finite, nonnegative amount, for example 18.75." />
        <Field label="Reorder point" type="number" min="0" step="any" value={String(itemForm.reorderPoint)} set={value => setItemForm(form => ({ ...form, reorderPoint: Number(value) || 0 }))} help="Optional nonnegative reference threshold; defaults to 0. Example: 6 displays Reorder at 6 in the catalog. This does not automatically check stock levels, send alerts, or place orders." />
        <div className="sm:col-span-2 space-y-1.5"><Label htmlFor="item-images">Product images</Label><p id="item-images-help" className="text-xs leading-relaxed text-muted-foreground">Optional reference photos. Upload up to 8 PNG or JPEG images, each no larger than 5 MB. Example: a label or product-view photo.</p><div className="mt-2 flex flex-wrap items-center gap-2"><Input id="item-images" aria-describedby="item-images-help" type="file" accept="image/png,image/jpeg" disabled={imageBusy || itemForm.images.length >= 8} onChange={event => { void uploadImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />{imageBusy && <Loader2 className="h-4 w-4" />}</div><div className="mt-2 flex flex-wrap gap-2">{itemForm.images.map((image, index) => <div key={image} className="relative"><img src={image} alt={`Product image ${index + 1}`} className="h-14 w-14 rounded object-cover" /><Button className="absolute -right-2 -top-2 h-6 w-6" size="icon" variant="destructive" aria-describedby="item-images-help" aria-label={`Remove product image ${index + 1}`} onClick={() => setItemForm(form => ({ ...form, images: form.images.filter(value => value !== image) }))}>×</Button></div>)}</div></div>
        <div className="sm:col-span-2 space-y-1.5"><Label>Kit components</Label><p id="item-components-help" className="text-xs leading-relaxed text-muted-foreground">Leave this empty for a standalone product. For a kit, add each product and the whole-number quantity needed per finished kit (example: 1 meter body and 2 seals). Up to 100 component lines; each quantity must be 1–1,000,000. Components cannot include this kit or create a circular recipe. Serialized components require a serialized kit, and serialized kits are assembled one at a time. Kit edits are restricted while stock or assigned records exist.</p><div className="mt-2 space-y-2">{itemForm.components.map((component, index) => <div className="flex flex-wrap items-start gap-2" key={`${component.itemId}-${index}`}><div className="min-w-0 flex-1 space-y-1"><Label className="sr-only" htmlFor={`kit-component-${index}`}>Component product {index + 1}</Label><Select value={component.itemId} onValueChange={value => setItemForm(form => ({ ...form, components: form.components.map((entry, i) => i === index ? { ...entry, itemId: value } : entry) }))}><SelectTrigger id={`kit-component-${index}`} aria-describedby="item-components-help"><SelectValue placeholder="Choose component product" /></SelectTrigger><SelectContent>{items.filter(item => item.id !== itemForm.id).map(item => <SelectItem value={item.id} key={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select></div><div className="w-28 space-y-1"><Label className="sr-only" htmlFor={`kit-quantity-${index}`}>Quantity for component {index + 1}</Label><Input id={`kit-quantity-${index}`} aria-describedby="item-components-help" aria-label={`Quantity for component ${index + 1}`} type="number" min="1" max="1000000" step="1" value={component.quantity} onChange={event => setItemForm(form => ({ ...form, components: form.components.map((entry, i) => i === index ? { ...entry, quantity: Number(event.target.value) } : entry) }))} /></div><Button type="button" variant="ghost" aria-describedby="item-components-help" aria-label={`Remove component ${index + 1}`} onClick={() => setItemForm(form => ({ ...form, components: form.components.filter((_, i) => i !== index) }))}>Remove</Button></div>)}</div><Button type="button" className="mt-2" variant="outline" aria-describedby="item-components-help" disabled={itemForm.components.length >= 100 || !items.some(item => item.id !== itemForm.id)} onClick={() => setItemForm(form => ({ ...form, components: [...form.components, { itemId: items.find(item => item.id !== form.id)?.id ?? "", quantity: 1 }] }))}><Plus className="mr-1 h-4 w-4" />Add component</Button></div>
        <div className="sm:col-span-2"><label htmlFor="item-active" className="flex items-start gap-2 text-sm"><Checkbox id="item-active" checked={itemForm.active} aria-describedby="item-active-help" onCheckedChange={checked => setItemForm(form => ({ ...form, active: checked === true }))} /><span><span className="font-medium">Active product</span><span id="item-active-help" className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">New products default to active and can be used in new inventory activity. Turn off a discontinued supply to retain its catalog record without offering it for new use. Deactivation is blocked while stock, reservations, or open orders remain.</span></span></label></div>
      </div>}
      </fieldset>
      <DialogFooter><Button variant="outline" disabled={resourceBusy} onClick={() => setResource(null)}>Cancel</Button><Button onClick={saveResource} disabled={resourceBusy || command.isPending || !can("inventory.maintain")}>{resourceSave.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{resourceSave.isPending ? "Saving..." : "Save changes"}</Button></DialogFooter>
    </DialogContent></Dialog>

    {operationOrder && <InventoryShipmentSession base={base} state={sessionState ?? state} order={operationOrder} action={operation as ShipmentAction} items={items} draft={sessionDraft} ownerId={user?.id}
      canCloseRemainder={can("inventory.closeOrders") && !(operationOrder.type === "transfer" && operationOrder.lines.some(line => orderLineProgress(state, operationOrder, line.itemId).inTransit > 0))} busy={command.isPending}
      onDirtyChange={setMovementDirty}
      autoSavePaused={!!pendingMovementTransition} onCheckpointBusyChange={setMovementCheckpointBusy}
      onClose={() => { setOperationOrder(null); setSessionDraft(undefined); setSessionState(null); setMovementDirty(false); }} />}
    {transitOrder && <InventoryShipmentTransitDialog state={state} order={transitOrder} items={items} busy={command.isPending}
      onPost={payload => postWithStableIdentity("resolveTransit", payload)}
      onDirtyChange={setMovementDirty}
      onClose={() => setTransitOrder(null)} />}
    {command.isPending && <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-lg"><Loader2 className="h-4 w-4 animate-spin" />Posting inventory update</div>}
  </main>;
}

function Metric({ label, value, detail, icon }: { label: string; value: number; detail: string; icon: React.ReactNode }) {
  return <Card><CardContent className="flex items-start justify-between p-4"><div><div className="text-sm text-muted-foreground">{label}</div><div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></div><div className="rounded-md bg-primary/10 p-2 text-primary">{icon}</div></CardContent></Card>;
}
function Empty({ title, description }: { title: string; description: string }) { return <div className="rounded-lg border border-dashed px-5 py-9 text-center"><p className="font-medium">{title}</p><p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{description}</p></div>; }
function Field({ label, value, set, type = "text", help, maxLength, required, min, step, className }: { label: string; value: string; set: (value: string) => void; type?: string; help?: string; maxLength?: number; required?: boolean; min?: string; step?: string; className?: string }) {
  const id = `field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const helpId = `${id}-help`;
  return <div className={`space-y-1.5 ${className ?? ""}`}><Label htmlFor={id}>{label}{required && <span aria-hidden="true" className="ml-1 text-destructive">*</span>}</Label><Input id={id} type={type} value={value} onChange={event => set(event.target.value)} aria-describedby={help ? helpId : undefined} required={required} maxLength={maxLength} min={min} step={step} /><div className="flex items-start justify-between gap-2">{help && <p id={helpId} className="text-xs leading-relaxed text-muted-foreground">{help}</p>}{maxLength && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{value.length}/{maxLength}</span>}</div></div>;
}
function OrderLineEditor({ items, lineItem, setLineItem, lineQty, setLineQty, lineSerials, setLineSerials, lines, add, remove, updateSerials, draftMode = false, quantityValues, setQuantityValue }: {
  items: InventoryItem[]; lineItem: string; setLineItem: (id: string) => void; lineQty: string; setLineQty: (qty: string) => void;
  lineSerials?: string; setLineSerials?: (serials: string) => void; lines: StockLine[]; add: () => void; remove: (index: number) => void; updateSerials?: (index: number, serials: string[]) => void;
  draftMode?: boolean; quantityValues?: Record<string, string>; setQuantityValue?: (itemId: string, value: string) => void;
}) {
  const selected = items.find(item => item.id === lineItem);
  return <div className="space-y-3 rounded-md border p-3"><div className="grid gap-2 sm:grid-cols-[1fr_110px_auto] sm:items-end"><div className="space-y-1"><Label htmlFor={draftMode ? "draft-line-item" : "operation-line-item"}>Item</Label><Select value={lineItem} onValueChange={setLineItem}><SelectTrigger id={draftMode ? "draft-line-item" : "operation-line-item"}><SelectValue placeholder="Select item" /></SelectTrigger><SelectContent>{items.filter(item => item.active).map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label htmlFor={draftMode ? "draft-line-quantity" : "operation-line-quantity"}>Quantity</Label><Input id={draftMode ? "draft-line-quantity" : "operation-line-quantity"} type="number" min="1" max="1000000" step="1" value={lineQty} onChange={event => setLineQty(event.target.value)} /></div><Button type="button" variant="outline" onClick={add}><Plus className="mr-1 h-4 w-4" />Add line</Button></div>
    {!draftMode && selected?.tracking === "serialized" && <div className="space-y-1"><Label htmlFor="operation-serial-scans">Serial scans</Label><Textarea id="operation-serial-scans" value={lineSerials ?? ""} onChange={event => setLineSerials?.(event.target.value)} placeholder="One serial per line" /></div>}
    {draftMode && lines.length > 0 && <div className="mt-1">
      <div className="grid grid-cols-[minmax(0,1fr)_76px_64px] items-center gap-2 border-b pb-1.5 text-xs font-medium text-muted-foreground sm:grid-cols-[minmax(0,1fr)_88px_72px]">
        <span>Product</span><span className="text-center">Qty</span><span className="sr-only">Actions</span>
      </div>
      <p id="draft-line-quantity-guidance" className="pt-1.5 text-xs text-muted-foreground">Whole quantities · 1–1,000,000</p>
    </div>}
    {lines.map((line, index) => {
      const item = items.find(value => value.id === line.itemId);
      const quantityValue = quantityValues?.[line.itemId] ?? String(line.quantity);
      const quantity = Number(quantityValue);
      const invalidQuantity = draftMode && (quantityValue.trim() === "" || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000000);
      const quantityId = `draft-line-quantity-${index}`;
      const quantityHelpId = `${quantityId}-help`;
      return <div key={`${line.itemId}-${index}`} className={draftMode
        ? "grid grid-cols-[minmax(0,1fr)_76px_64px] items-center gap-2 border-t py-2 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_88px_72px]"
        : "grid gap-2 border-t pt-3 sm:grid-cols-[1fr_130px_auto] sm:items-end"}>
        <div className={draftMode ? "min-w-0 py-0.5" : "min-w-0"}><div className={`text-sm font-medium ${draftMode ? "break-words [overflow-wrap:anywhere]" : ""}`}>{item?.name ?? line.itemId}</div><div className={`${draftMode ? "break-words " : ""}font-mono text-xs text-muted-foreground`}>{item?.sku ?? line.itemId}{!draftMode && ` · ${item?.unit ?? "units"}`}</div>
          {!draftMode && item?.tracking === "serialized" && <div className="mt-1 space-y-1"><Label htmlFor={`line-serial-${index}`}>Serial scans</Label><Textarea id={`line-serial-${index}`} value={line.serials.join("\n")} onChange={event => updateSerials?.(index, csv(event.target.value))} placeholder="One serial per line" /></div>}
        </div>
        {draftMode ? <div><Label className="sr-only" htmlFor={quantityId}>Quantity for {item?.name ?? item?.sku ?? line.itemId}</Label><Input className="h-10 px-2 text-center tabular-nums" id={quantityId} aria-describedby={invalidQuantity ? quantityHelpId : "draft-line-quantity-guidance"} aria-invalid={invalidQuantity} type="number" min="1" max="1000000" step="1" value={quantityValue} onChange={event => setQuantityValue?.(line.itemId, event.target.value)} /></div> : <div className="text-sm tabular-nums">{line.quantity} units</div>}
        <Button type="button" size="sm" className={draftMode ? "h-10 min-w-0 px-2" : undefined} variant="ghost" onClick={() => remove(index)}>Remove</Button>
        {draftMode && invalidQuantity && <p id={quantityHelpId} className="col-span-full text-xs leading-tight text-destructive" role="alert">Enter a whole number from 1 to 1,000,000.</p>}
      </div>;
    })}
  </div>;
}
