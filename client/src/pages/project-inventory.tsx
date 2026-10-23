import { inventoryDateTime } from "@shared/inventory-date-time";
import { OrderItemPicker } from "@/components/inventory/order-item-picker";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CustomerHandoffDialog } from "@/components/inventory/customer-handoff-dialog";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useInventoryEvents } from "@/hooks/useInventoryEvents";
import { inventoryTabs } from "@/components/inventory-navigation";
import { inventoryCapabilities } from "@shared/inventory-capabilities";
import { InventoryWorkflowLauncher, StartInventoryButton } from "@/components/start-inventory-button";
import type { VehicleReturnScreen } from "@/components/inventory/vehicle-return-wizard";
import { useUnsavedNavigation } from "@/hooks/use-unsaved-navigation";
import { useInventoryHistory } from "@/hooks/use-inventory-history";
import { usePageHeader } from "@/contexts/page-header-context";
import { countStockMatches, countStockScopeMatches } from "@shared/inventory-count-stock";
import { emptyInventory, type InventoryCommand, type InventoryCount, type InventoryItem, type InventoryOrder, type InventoryState, type StockLine, type Vendor, type Warehouse } from "@shared/inventory";
import type { SavedShipmentDraft } from "@shared/inventory-shipment-draft-model";
import { orderLineProgress } from "@shared/inventory-shipment-model";
import { inventoryCountReference } from "@shared/inventory-count-reference";
import { orderLabel, orderReference, uuidOrderId } from "@shared/inventory-order-labels";
import { inventoryActorLabel, inventoryHoldLabel, type InventoryActorLabel } from "@shared/inventory-display-labels";
import { categoryDeletionBlockers, itemDeletionBlockers } from "@shared/inventory-deletion";
import { emptyOrderFilters, searchOrders } from "@shared/inventory-order-search";
import { InventoryOrderFilters } from "@/components/inventory-order-filters";
import { downloadInventoryOrders } from "@/lib/inventory-order-export";
import { COUNT_MAX_LINES } from "@shared/inventory-count-limits";
import { inventoryCountReviewIdentity, inventoryCountSerialChanges } from "@shared/inventory-count-review";
import { inventoryCountRows, inventoryCountLines } from "@/lib/inventory-count-form";
import { inventoryResourceFailure, validateInventoryResource } from "@/lib/inventory-resource-save";
import { orderSaveAttempt, type OrderSaveAttempt } from "@/lib/inventory-order-save";
import { shipmentFingerprint, type ShipmentAction } from "@/lib/inventory-shipment-guidance";
import { InventoryShipmentSession } from "@/components/inventory-shipment-session";
import { InventoryShipmentDraftsPanel } from "@/components/inventory-shipment-drafts-panel";
import { refreshShipmentInventory } from "@/components/inventory-shipment-draft-api";
import { InventoryShipmentExceptions } from "@/components/inventory-shipment-exceptions";
import { InventoryStockDiscrepancies } from "@/components/inventory-stock-discrepancies";
import { InventoryShipmentTransitDialog } from "@/components/inventory-shipment-transit-dialog";
import { InventoryStockSerialDialog, InventoryCatalogWorkspace, InventoryKitDialog, InventoryVendorKitDialog } from "@/components/inventory-lazy-tools";
import { InventoryStockWorkspace } from "@/components/inventory-stock-workspace";
import { copyInventoryItem } from "@/lib/inventory-item-copy";
import { InventoryRecordsWorkspace } from "@/components/inventory-records-workspace";
import { InventoryCategoryCreateAction } from "@/components/inventory-category-create-action";
import { InventoryDeleteAction } from "@/components/inventory-delete-action";
import { InventoryMobileTools } from "@/components/inventory-mobile-tools";
import { InventoryEditorSurface } from "@/components/inventory/inventory-editor-surface";
import { LocationTypesManager } from "@/components/inventory/location-types-manager";
import { RemovalRulesManager } from "@/components/inventory/removal-rules-manager";
import { RemovedEquipmentActions, type ReturnDecisionDraft } from "@/components/inventory/removed-equipment-actions";
import { CountSerialsDialog } from "@/components/inventory/count-serials-dialog";
import { VehicleTransferPanel } from "@/components/inventory/vehicle-transfer-panel";
import { InventoryItemPricing } from "@/components/inventory/inventory-item-pricing";
import { InventoryItemComponents } from "@/components/inventory/inventory-item-components";
import { CountProductScanner } from "@/components/inventory/count-product-scanner";
import { matchesCountProduct } from "@/lib/inventory-count-recovery";
import { CountRecoveryInbox, CountRecoveryNotice } from "@/components/inventory/count-recovery-notice";
import { useCountRecovery } from "@/components/inventory/use-count-recovery";
import { CountDiscrepancyReview, type CountDiscrepancyReviewPayload } from "@/components/inventory/count-discrepancy-review";
import { useCountEntryPagination } from "@/components/inventory/use-count-entry-pagination";
import { downloadCountEntries, type CountExportRow } from "@/lib/inventory-count-export";
import { buildOperationsDataset } from "@/lib/inventory-operations-data";
import { defaultLocationTypeId, locationTypeFor, locationTypeLabel, warehouseAccessible } from "@shared/inventory-location-types";
import type { StockBalanceRow } from "@/lib/inventory-stock-export";
import { fetchStock, type StockSummary } from "@/lib/inventory-stock-api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SerialScanField, serialTokens } from "@/components/inventory/serial-scan-field";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ArrowLeftRight, ArrowLeft, BarChart3, Boxes, ChevronDown, ChevronUp, ClipboardList, Download, FileSpreadsheet, FileText, Filter, ListOrdered, Loader2, Menu, Package, Plus, Printer, RefreshCw, Search, Trash2, Warehouse as WarehouseIcon } from "lucide-react";

import { inventoryActivityGroups } from "@shared/inventory-activity-groups";
import { groupedInventoryActivity } from "@/lib/inventory-activity-data";
import { InventoryActivityEntry } from "@/components/inventory-activity-entry";

// Keep this page's additional section local; do not mutate shared navigation state.
const projectInventoryTabs = [...inventoryTabs, { value: "stock-discrepancies", label: "Stock discrepancies" }];

function ProjectInventoryMobileMenu({ value, onValueChange, can }: {
  value: string; onValueChange: (value: string) => void; can: (permission: string) => boolean;
}) {
  const capabilities = inventoryCapabilities(can);
  const tabs = projectInventoryTabs.filter(tab => capabilities.tabs[tab.value as keyof typeof capabilities.tabs]);
  return <div className="inventory-mobile-menu min-w-0 flex-1 md:hidden">
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" variant="outline" className="h-9 w-full justify-between"
        aria-label={`Inventory sections, current: ${tabs.find(tab => tab.value === value)?.label ?? "Stock & search"}`}
        data-testid="inventory-mobile-menu">
        <span className="flex min-w-0 items-center gap-2"><Menu className="h-4 w-4 shrink-0" /><span className="truncate">{tabs.find(tab => tab.value === value)?.label ?? "Stock & search"}</span></span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(70dvh,30rem)] w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto">
        {capabilities.tabs.categories && <DropdownMenuItem onSelect={() => onValueChange("categories")}>Manage categories</DropdownMenuItem>}
        {tabs.map(tab => <DropdownMenuItem key={tab.value} aria-label={tab.label}
          data-testid={`inventory-mobile-menu-item-${tab.value}`} onSelect={() => onValueChange(tab.value)}>{tab.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

function ProjectInventoryDesktopTabs({ can }: { can: (permission: string) => boolean }) {
  const capabilities = inventoryCapabilities(can);
  return <TabsList className="inventory-desktop-tabs hidden h-auto w-full flex-wrap justify-start gap-1 md:flex">
    {projectInventoryTabs.filter(tab => capabilities.tabs[tab.value as keyof typeof capabilities.tabs]).map(tab => <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>)}
  </TabsList>;
}

type Snapshot = { enabled: boolean; projectName: string; timezone: string; state: InventoryState; permissions: string[]; users: Array<{ id: string; username: string }>; actors?: InventoryActorLabel[]; workOrderLabels?: Record<string, string>; workOrderIdentifiers?: import("@shared/inventory-work-order-labels").InventoryWorkOrderIdentifiers };
type ResourceKind = "warehouse" | "vendor" | "item";
const blankWarehouse = (): Warehouse => ({ id: "", code: "", name: "", type: "physical", active: true, address: "", city: "", state: "", zip: "", contact: "", phone: "", location: "", vin: "", plate: "", plateState: "", make: "", model: "", year: null, assignedUserId: null, userIds: [] });
const blankVendor = (): Vendor => ({ id: "", name: "", contact: "", address: "", phone: "", email: "", reference: "", active: true });
const blankItem = (): InventoryItem => ({ id: "", sku: "", name: "", description: "", category: "", categoryId: null, unit: "each", tracking: "regular", equipment: "none", barcode: "", manufacturer: "", model: "", vendorId: null, cost: 0, reorderPoint: 0, active: true, images: [], components: [] });
const freshId = () => crypto.randomUUID();
const csv = (value: string) => value.split(/[\n,;]/).map(part => part.trim()).filter(Boolean);
function savedInventoryTab(key: string) {
  try {
    const saved = window.sessionStorage.getItem(key);
    return projectInventoryTabs.some(tab => tab.value === saved) ? saved! : "stock";
  } catch {
    return "stock"; // Browser storage can be disabled; inventory itself must remain usable.
  }
}
const sameOriginImage = (value: string) => {
  try { return new URL(value, window.location.origin).origin === window.location.origin ? value : null; }
  catch { return null; }
};
const orderEditorValues = (order: InventoryOrder) => ({
  orderType: order.type,
  orderId: orderReference(order),
  orderDestination: order.destinationId,
  orderSource: order.sourceId || "",
  orderVendor: order.vendorId || "",
  orderNotes: order.notes,
  replacementFor: order.replacementFor ?? "",
  orderLines: order.lines,
  orderLineQuantities: {},
  orderLineItem: "",
  orderLineQty: "1",
});

export default function ProjectInventory() {
  const [, params] = useRoute("/projects/:projectId/inventory");
  const projectId = params?.projectId;
  if (!projectId) return <div className="p-6">Project not found.</div>;
  // Route changes must not carry one project's drafts into another project's commands.
  return <ProjectInventoryWorkspace key={projectId} projectId={projectId} />;
}

function ProjectInventoryWorkspace({ projectId }: { projectId: string }) {
  const { setHeaderContent } = usePageHeader();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const { user } = useAuth();
  const fulfillmentSessionKey = `meterflo:fulfillment-workspace:${encodeURIComponent(String(user?.id ?? "pending"))}:${projectId}`;
  type InventoryWorkspaceScreen = "inventory" | "tasks" | "fulfillment" | "vehicle-stock" | VehicleReturnScreen;
  const [inventoryWorkspace, setInventoryWorkspaceState] = useState<InventoryWorkspaceScreen>("inventory");
  const [fulfillmentSessionReadyKey, setFulfillmentSessionReadyKey] = useState("");
  const restoredFulfillmentKey = useRef("");
  useLayoutEffect(() => {
    if (!user?.id) return;
    if (restoredFulfillmentKey.current === fulfillmentSessionKey) return;
    restoredFulfillmentKey.current = fulfillmentSessionKey;
    try {
      const saved = window.localStorage.getItem(fulfillmentSessionKey);
      const session = saved ? JSON.parse(saved) as { workspace?: unknown; open?: unknown } : null;
      const workspace = session?.workspace;
      setInventoryWorkspaceState(workspace === "inventory" || workspace === "tasks" || workspace === "fulfillment" || workspace === "vehicle-stock" ||
        workspace === "return-equipment" || workspace === "vehicle-count" || workspace === "return-stock"
        ? workspace
        : session?.open === true ? "fulfillment" : "inventory");
    } catch {
      setInventoryWorkspaceState("inventory");
    }
    setFulfillmentSessionReadyKey(fulfillmentSessionKey);
  }, [fulfillmentSessionKey, user?.id]);
  const setInventoryWorkspace = (screen: InventoryWorkspaceScreen) => {
    if (user?.id) {
      try {
        window.localStorage.setItem(fulfillmentSessionKey, JSON.stringify({ workspace: screen, open: screen === "fulfillment" }));
      } catch {
        console.warn("Browser storage is unavailable; the inventory workspace cannot be restored after refresh.");
      }
    }
    setInventoryWorkspaceState(screen);
  };
  useLayoutEffect(() => {
    if (fulfillmentSessionReadyKey !== fulfillmentSessionKey || !user?.id) return;
    try {
      window.localStorage.setItem(fulfillmentSessionKey, JSON.stringify({
        workspace: inventoryWorkspace,
        open: inventoryWorkspace === "fulfillment",
      }));
    } catch {
      console.warn("Browser storage is unavailable; the inventory workspace cannot be restored after refresh.");
    }
  }, [inventoryWorkspace, fulfillmentSessionKey, fulfillmentSessionReadyKey, user?.id]);
  const { toast } = useToast();
  const inventoryEvents = useInventoryEvents(projectId);
  const base = `/api/projects/${projectId}/inventory`;
  const queryKey = [base];
  const [showInventoryStats, setShowInventoryStats] = useState(false);
  const [vendorKitOpen, setVendorKitOpen] = useState(false);
  const inventoryTabKey = `meterflo:inventory-tab:${user?.id ?? "pending"}:${projectId}`;
  const [inventoryTab, setInventoryTabState] = useState(() => savedInventoryTab(inventoryTabKey));
  useEffect(() => { setInventoryTabState(savedInventoryTab(inventoryTabKey)); }, [inventoryTabKey]);
  const setInventoryTab = (value: string) => {
    if (!projectInventoryTabs.some(tab => tab.value === value)) return;
    setInventoryTabState(value);
    try { window.sessionStorage.setItem(inventoryTabKey, value); }
    catch { console.warn("Browser storage is unavailable; the selected Inventory tab cannot be remembered on refresh."); }
  };
  useInventoryHistory(`inventory:${user?.id ?? "pending"}:${projectId}`,
    { workspace: inventoryWorkspace, tab: inventoryTab }, view => {
      setInventoryWorkspace(view.workspace);
      setInventoryTab(view.tab);
    }, { enabled: !!user?.id && fulfillmentSessionReadyKey === fulfillmentSessionKey });
  const inventoryMainRef = useRef<HTMLElement>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const inventoryTabsHostRef = useRef<HTMLDivElement>(null);
  const [selectedStockRow, setSelectedStockRow] = useState<StockBalanceRow | null>(null);
  const [resource, setResource] = useState<ResourceKind | null>(null);
  const [activeCount, setActiveCount] = useState<InventoryCount | null>(null);
  const canFromRole = (permission: string) => hasPermission(permission);
  const roleCapabilities = inventoryCapabilities(canFromRole);
  const stockContext = useQuery<Omit<Snapshot, "state" | "users"> & { summary: StockSummary }>({
    queryKey: [base, "stock", "context"], queryFn: () => fetchStock(`${base}/stock/context`),
    enabled: inventoryTab === "stock" && roleCapabilities.tabs.stock,
  });
  const cachedSnapshot = queryClient.getQueryData<Snapshot>(queryKey);
  const snapshotCachedAt = queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0;
  const permissionSource = cachedSnapshot && snapshotCachedAt >= stockContext.dataUpdatedAt
    ? cachedSnapshot.permissions
    : stockContext.data?.permissions ?? cachedSnapshot?.permissions;
  const queryCan = (permission: string) => permissionSource
    ? permissionSource.includes(permission)
    : hasPermission(permission);
  const queryCapabilities = inventoryCapabilities(queryCan);
  // Other tabs/editors retain the legacy contract; stock never subscribes to it in the background.
  const snapshotQuery = useQuery<Snapshot>({ queryKey, enabled: (inventoryTab !== "stock" &&
    !!queryCapabilities.tabs[inventoryTab as keyof typeof queryCapabilities.tabs]) ||
    (!!resource && queryCan("inventory.maintain")) || (vendorKitOpen && queryCan("inventory.receive")) });
  const stockSnapshot = useMemo<Snapshot | undefined>(() => stockContext.data ? {
    ...stockContext.data, state: emptyInventory(), users: [],
  } : undefined, [stockContext.data]);
  const data = inventoryTab === "stock" && !resource && !vendorKitOpen ? stockSnapshot : snapshotQuery.data;
  const latestPermissionSnapshot = snapshotQuery.data && snapshotQuery.dataUpdatedAt >= stockContext.dataUpdatedAt
    ? snapshotQuery.data
    : stockContext.data ?? data;
  const can = (permission: string) => latestPermissionSnapshot
    ? latestPermissionSnapshot.permissions.includes(permission)
    : hasPermission(permission);
  const capabilities = inventoryCapabilities(can);
  useEffect(() => {
    if (permissionsLoading) return;
    const lostAccess = inventoryWorkspace === "fulfillment" && !capabilities.fulfillment ||
      inventoryWorkspace === "vehicle-stock" && !capabilities.vehicleStock ||
      inventoryWorkspace === "return-equipment" && !capabilities.returnEquipment ||
      inventoryWorkspace === "vehicle-count" && !capabilities.verifyVehicle ||
      inventoryWorkspace === "return-stock" && !capabilities.returnStock;
    if (lostAccess) setInventoryWorkspace("tasks");
  }, [inventoryWorkspace, permissionsLoading, capabilities.fulfillment, capabilities.vehicleStock, capabilities.returnEquipment, capabilities.verifyVehicle, capabilities.returnStock, setInventoryWorkspace]);
  const allowedTabs = projectInventoryTabs.filter(tab => capabilities.tabs[tab.value as keyof typeof capabilities.tabs]);
  const { isLoading, isError } = inventoryTab === "stock" && !resource && !vendorKitOpen ? stockContext : snapshotQuery;
  const refetch = () => inventoryTab === "stock" && !resource && !vendorKitOpen ? stockContext.refetch() : snapshotQuery.refetch();
  const summary = inventoryTab === "stock" ? stockContext.data?.summary : undefined;
  useEffect(() => {
    if (!data?.projectName) {
      setHeaderContent(null);
      return;
    }

    setHeaderContent(
      <div className="flex items-center gap-2 w-full min-w-0">
        <div className="flex flex-col min-w-0 flex-1">
          <span className="font-semibold text-sm truncate">{data.projectName}</span>
          <span className="text-xs text-muted-foreground">Inventory</span>
        </div>
      </div>,
    );
  }, [data?.projectName, setHeaderContent]);
  useEffect(() => () => setHeaderContent(null), [setHeaderContent]);
  const [warehouseForm, setWarehouseForm] = useState<Warehouse>(blankWarehouse());
  const [vendorForm, setVendorForm] = useState<Vendor>(blankVendor());
  const [itemForm, setItemForm] = useState<InventoryItem>(blankItem());
  const [copiedItemName, setCopiedItemName] = useState<string | null>(null);
  const [imageBusy, setImageBusy] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [resourceConflict, setResourceConflict] = useState<"changed" | "deleted" | null>(null);
  const resourceErrorRef = useRef<HTMLDivElement>(null);
  const resourceId = useRef("");
  const resourceAttempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const resourceSaving = useRef(false);
  const resourceBaseline = useRef<{ kind: ResourceKind; id: string; signature: string; copied: boolean; locationContext?: string } | null>(null);
  const [selectedLocationTypeBasis, setSelectedLocationTypeBasis] = useState<{ id: string; revision: number } | null>(null);
  const resourceCurrentForm = resource === "warehouse" ? warehouseForm : resource === "vendor" ? vendorForm : itemForm;
  const resourceDirty = !!resource && resource !== "vendor" && !!resourceBaseline.current &&
    JSON.stringify(resourceCurrentForm) !== resourceBaseline.current.signature;
  const [pendingResourceTransition, setPendingResourceTransition] = useState<(() => void) | null>(null);
  const [locationTypesManagerOpen, setLocationTypesManagerOpen] = useState(false);
  useEffect(() => { if (resourceError) resourceErrorRef.current?.focus(); }, [resourceError]);
  const [orderType, setOrderType] = useState<"purchase" | "transfer">("purchase");
  const [orderEditorOpen, setOrderEditorOpen] = useState(false);
  const inlineEditorOpen = (!!resource && resource !== "vendor") || orderEditorOpen || !!activeCount || locationTypesManagerOpen;
  useLayoutEffect(() => {
    const host = inventoryTabsHostRef.current;
    if (!host) return;
    if (inlineEditorOpen) {
      host.setAttribute("inert", "");
    } else {
      host.removeAttribute("inert");
    }
  }, [inlineEditorOpen]);
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
  const [orderConflict, setOrderConflict] = useState<"changed" | "deleted" | null>(null);
  const orderServerBaseline = useRef<{ id: string; signature: string } | null>(null);
  const [pendingOrderTransition, setPendingOrderTransition] = useState<(() => void) | null>(null);
  const [pendingMovementTransition, setPendingMovementTransition] = useState<(() => void) | null>(null);
  const [movementDirty, setMovementDirty] = useState(false);
  const [movementCheckpointBusy, setMovementCheckpointBusy] = useState(false);
  const [kitDialogMode, setKitDialogMode] = useState<"assemble" | "disassemble" | "inspect" | null>(null);
  const [kitDirty, setKitDirty] = useState(false);
  const [kitOperationPending, setKitOperationPending] = useState(false);
  const [pendingKitTransition, setPendingKitTransition] = useState<(() => void) | null>(null);
  const movementAttempts = useRef(new Map<string, string>());
  const [orderToClose, setOrderToClose] = useState<InventoryOrder | null>(null);
  const [closeReason, setCloseReason] = useState("");
  const [showClearedOrders, setShowClearedOrders] = useState(false);
  const [unreleaseStatus, setUnreleaseStatus] = useState<Record<string, { pending: boolean; message: string; needsCheck: boolean }>>({});
  const unreleaseInFlight = useRef(new Set<string>());
  const [orderFiltersOpen, setOrderFiltersOpen] = useState(false);
  const [shipmentDraftsOpen, setShipmentDraftsOpen] = useState(false);
  const [orderPage, setOrderPage] = useState(0);
  const [orderResultsElement, setOrderResultsElement] = useState<HTMLDivElement | null>(null);
  const orderRowHeightRef = useRef(0);
  const orderContainerWidthRef = useRef(0);
  const orderContainerHeightRef = useRef(0);
  const [orderRowsPerPage, setOrderRowsPerPage] = useState(1);
  const [orderToClear, setOrderToClear] = useState<InventoryOrder | null>(null);
  const requestResourceTransition = (transition: () => void) => {
    if (resourceSaving.current || imageBusy) return;
    const leaveResource = () => {
      setResource(null);
      setResourceError(null);
      setPendingResourceTransition(null);
      transition();
    };
    if (resourceDirty) setPendingResourceTransition(current => current ?? leaveResource);
    else leaveResource();
  };
  const requestOrderTransition = (transition: () => void) => {
    if (orderSaving.current || command.isPending || unreleaseInFlight.current.size > 0) return;
    if (orderDirty) setPendingOrderTransition(current => current ?? transition);
    else transition();
  };
  const requestMovementTransition = (transition: () => void) => {
    if (command.isPending) return;
    if (movementDirty || movementCheckpointBusy) setPendingMovementTransition(current => current ?? transition);
    else transition();
  };
  const requestKitTransition = (transition: () => void) => {
    if (command.isPending || kitOperationPending) return;
    const leaveKit = () => { setKitDirty(false); setKitDialogMode(null); setVendorKitOpen(false); transition(); };
    if (kitDirty) setPendingKitTransition(current => current ?? leaveKit);
    else leaveKit();
  };
  const [operationOrder, setOperationOrder] = useState<InventoryOrder | null>(null);
  const [sessionState, setSessionState] = useState<InventoryState | null>(null);
  const [customerHandoffIds, setCustomerHandoffIds] = useState<string[] | null>(null);
  const [sessionDraft, setSessionDraft] = useState<SavedShipmentDraft | undefined>();
  const [transitOrder, setTransitOrder] = useState<InventoryOrder | null>(null);
  const [operation, setOperation] = useState<"receive" | "dispatch" | "accept">("receive");
  const [countWarehouse, setCountWarehouse] = useState("");
  const [countStartScope, setCountStartScope] = useState<"selected" | "warehouse">("selected");
  const [countStartOpen, setCountStartOpen] = useState(false);
  const [countExportScope, setCountExportScope] = useState<"all" | "filtered" | "page">("all");
  const [countQuantities, setCountQuantities] = useState<Record<string, string>>({});
  const [countSerials, setCountSerials] = useState<Record<string, string>>({});
  const [countSerialDialog, setCountSerialDialog] = useState<{ itemId: string; countId: string } | null>(null);
  const [countReason, setCountReason] = useState("");
  const [countDraftId, setCountDraftId] = useState<string | null>(null);
  useInventoryHistory(`inventory-editors:${user?.id ?? "pending"}:${projectId}`, {
    resource, resourceId: resourceBaseline.current?.copied ? "" : resourceBaseline.current?.id ?? "",
    order: orderEditorOpen ? editingOrderId || "new" : "",
    count: activeCount?.id ?? "", countStartOpen, locationTypesManagerOpen,
    kitDialogMode, vendorKitOpen,
  }, view => {
    if (!view.resource) setResource(null);
    else if (view.resource !== resource || view.resourceId !== resourceBaseline.current?.id) {
      const rows = view.resource === "item" ? state?.items : view.resource === "warehouse" ? state?.warehouses : state?.vendors;
      const existing = rows?.find(row => row.id === view.resourceId);
      if (!view.resourceId || existing) openResource(view.resource, existing);
    }
    if (!view.order) setOrderEditorOpen(false);
    else if (view.order === "new") startNewOrderDraft();
    else {
      const order = state?.orders.find(row => row.id === view.order);
      if (order?.status === "draft") loadOrderDraft(order);
    }
    if (!view.count) setActiveCount(null);
    else {
      const count = state?.counts.find(row => row.id === view.count);
      if (count) openCount(count);
    }
    setCountStartOpen(view.countStartOpen);
    setLocationTypesManagerOpen(view.locationTypesManagerOpen);
    setKitDialogMode(view.kitDialogMode);
    setVendorKitOpen(view.vendorKitOpen);
  }, { enabled: !!user?.id && !!data?.state && inventoryWorkspace === "inventory",
    canRestore: !resourceSaving.current && !imageBusy && !movementCheckpointBusy && !kitOperationPending });
  const [countDraftRevision, setCountDraftRevision] = useState(0);
  const [countDraftMessage, setCountDraftMessage] = useState("");
  const [pendingCountReview, setPendingCountReview] = useState<CountDiscrepancyReviewPayload | null>(null);
  const [countPage, setCountPage] = useState(0);
  const [countSearch, setCountSearch] = useState("");
  const [countProduct, setCountProduct] = useState("");
  const [countToolsOpen, setCountToolsOpen] = useState(false);
  const countEntriesRef = useRef<HTMLDivElement>(null);
  const countReserveRef = useRef<HTMLDivElement>(null);
  const [pendingCountTransition, setPendingCountTransition] = useState<(() => void) | null>(null);
  const [savedCountValues, setSavedCountValues] = useState("");
  const [countConflict, setCountConflict] = useState<"changed" | "unavailable" | null>(null);
  const countSaving = useRef(false);
  const countRows = activeCount ? inventoryCountRows(activeCount, data?.state.items ?? [], countQuantities, countSerials) : [];
  const countPageSize = useCountEntryPagination(countEntriesRef, countReserveRef,
    `${activeCount?.id ?? ""}:${countToolsOpen}:${countSearch}:${countRows.length}`, activeCount?.id ?? "");
  const previousCountPageSize = useRef(countPageSize);
  useLayoutEffect(() => {
    const previous = previousCountPageSize.current;
    if (previous !== countPageSize) {
      setCountPage(page => Math.floor(page * previous / countPageSize));
      previousCountPageSize.current = countPageSize;
    }
  }, [countPageSize]);
  useEffect(() => {
    if (countSerialDialog && (countSerialDialog.countId !== activeCount?.id ||
      !countRows.some(row => row.itemId === countSerialDialog.itemId && row.item?.tracking === "serialized"))) {
      setCountSerialDialog(null);
    }
  }, [activeCount?.id, countSerialDialog, countRows]);
  const countValues = JSON.stringify({ reason: countReason,
    rows: countRows.map(({ itemId, quantity, serials }) => ({ itemId, quantity, serials })).sort((a, b) => a.itemId.localeCompare(b.itemId)) });
  const countDirty = !!activeCount && countValues !== savedCountValues;
  const countRecovery = useCountRecovery({
    userId: user?.id ? String(user.id) : undefined, projectId, count: activeCount,
    revision: countDraftRevision, rows: countRows, reason: countReason, dirty: countDirty,
    enabled: !!data?.enabled && data.permissions.includes("inventory.count"),
  });
  const requestCountTransition = (transition: () => void) => {
    if (countSaving.current || command.isPending) return;
    if (countDirty) setPendingCountTransition(current => current ?? transition);
    else transition();
  };
  // Register a single navigation guard: both editors can have unsaved values.
  // A count choice must not silently discard an unrelated order draft.
  const completeSavedNavigation = useUnsavedNavigation(countDirty || orderDirty || resourceDirty || (!!resource && resource !== "vendor" && (imageBusy || resourceSaving.current)) || movementDirty || movementCheckpointBusy || kitDirty,
    transition => requestCountTransition(() => requestOrderTransition(() => requestResourceTransition(() => requestMovementTransition(() => requestKitTransition(transition))))));
  const [returnInspect, setReturnInspect] = useState<Record<string, ReturnDecisionDraft>>({});

  const state = data?.state;
  const locationContextSignature = (warehouse: Warehouse) => JSON.stringify({
    type: state ? locationTypeFor(state, warehouse) ?? null : null,
    locations: state?.warehouses.filter(value => value.locationTypeId === warehouse.locationTypeId).map(value => value.id).sort() ?? [],
  });
  const currentCountStock = useMemo(() => (state?.stock ?? []).filter(stock => stock.warehouseId === activeCount?.warehouseId), [state?.stock, activeCount?.warehouseId]);
  const countStockByItem = useMemo(() => new Map(currentCountStock.map(stock => [stock.itemId, stock])), [currentCountStock]);
  const countStockDrift = useMemo(() => {
    if (!activeCount || !state) return false;
    return activeCount.scope === "selected"
      ? !countStockScopeMatches(activeCount, currentCountStock, countRows.map(row => row.itemId))
      : !countStockMatches(activeCount.snapshot, currentCountStock);
  }, [activeCount, state, currentCountStock, countRows]);
  const currentClosingOrder = orderToClose ? state?.orders.find(order => order.id === orderToClose.id) : undefined;
  const locationsDataset = useMemo(() => buildOperationsDataset("locations", state ?? emptyInventory(), data?.actors ?? [], data?.users ?? [], timezone), [state, data?.actors, data?.users, timezone]);
  const returnsDataset = useMemo(() => buildOperationsDataset("returns", state ?? emptyInventory(), data?.actors ?? [], data?.users ?? [], timezone, data?.workOrderLabels, data?.workOrderIdentifiers), [state, data?.actors, data?.users, timezone, data?.workOrderLabels, data?.workOrderIdentifiers]);
  const activityGroups = useMemo(() => inventoryActivityGroups(state ?? emptyInventory(), data?.workOrderLabels), [state, data?.workOrderLabels]);
  const activityGroupById = useMemo(() => new Map(activityGroups.map(group => [group.id, group])), [activityGroups]);
  const activityDataset = useMemo(() => groupedInventoryActivity(buildOperationsDataset("activity", state ?? emptyInventory(), data?.actors ?? [], data?.users ?? [], timezone, data?.workOrderLabels, data?.workOrderIdentifiers), activityGroups), [state, data?.actors, data?.users, timezone, data?.workOrderLabels, data?.workOrderIdentifiers, activityGroups]);
  const categoriesDataset = useMemo(() => buildOperationsDataset("categories", state ?? emptyInventory(), data?.actors ?? [], data?.users ?? [], timezone), [state]);
  const countsDataset = useMemo(() => buildOperationsDataset("counts", state ?? emptyInventory(), data?.actors ?? [], data?.users ?? [], timezone), [state, timezone]);
  const categoryCatalog = state?.categoryCatalog ?? [];
  // Inventory SSE resyncs include fresh permissions; the global role cache may
  // still reflect an earlier session grant while an editor is open.
  const canManageLocationTypes = can("inventory.manageLocationTypes");
  useEffect(() => {
    if (allowedTabs.some(tab => tab.value === inventoryTab)) return;
    setInventoryTab("stock");
  }, [inventoryTab, allowedTabs.map(tab => tab.value).join("|")]);
  useEffect(() => {
    if (!capabilities.stats) setShowInventoryStats(false);
    if (!capabilities.tabs.stock) {
      setSelectedStockRow(null);
      setVendorKitOpen(false);
    }
    if (resource && (resource === "warehouse" ? !can("inventory.maintain") : !can("inventory.maintain"))) {
      setResource(null);
      setResourceError(null);
    }
    if (activeCount && !capabilities.tabs.counts) setActiveCount(null);
    if (orderEditorOpen && !capabilities.tabs.orders) setOrderEditorOpen(false);
    if (locationTypesManagerOpen && !canManageLocationTypes) setLocationTypesManagerOpen(false);
    if (kitDialogMode === "assemble" && !can("inventory.assemble")) setKitDialogMode(null);
    if (kitDialogMode === "inspect" && !can("inventory.resolveExceptions")) setKitDialogMode(null);
    if (kitDialogMode === "disassemble" && !can("inventory.assemble")) setKitDialogMode(null);
  }, [capabilities.stats, capabilities.tabs.stock, capabilities.tabs.counts, capabilities.tabs.orders,
    resource, activeCount, orderEditorOpen, locationTypesManagerOpen, canManageLocationTypes, kitDialogMode,
    latestPermissionSnapshot?.permissions]);
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
  useEffect(() => {
    if (!can("inventory.view") || inventoryTab !== "stock") setSelectedStockRow(null);
  }, [inventoryTab, hasPermission]);
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
  useEffect(() => {
    const baseline = resourceBaseline.current;
    if (!resource || !baseline || baseline.copied || !baseline.id || !state) return;
    const latest = baseline.kind === "warehouse" ? state.warehouses.find(value => value.id === baseline.id) :
      baseline.kind === "vendor" ? state.vendors.find(value => value.id === baseline.id) :
        state.items.find(value => value.id === baseline.id);
    if (!latest) {
      setResourceConflict("deleted");
      return;
    }
    const refreshedForm = baseline.kind === "item"
      ? { ...latest as InventoryItem, images: (latest as InventoryItem).images.filter(image => !!sameOriginImage(image)) }
      : latest;
    const signature = JSON.stringify(refreshedForm);
    const latestLocationContext = baseline.kind === "warehouse"
      ? locationContextSignature(refreshedForm as Warehouse) : baseline.locationContext;
    const contextChanged = baseline.kind === "warehouse" && latestLocationContext !== baseline.locationContext;
    if (signature === baseline.signature) {
      if (contextChanged) {
        const current = baseline.kind === "warehouse" ? warehouseForm : null;
        if (current && JSON.stringify(current) !== baseline.signature) {
          setResourceConflict("changed");
          return;
        }
        baseline.locationContext = latestLocationContext;
      }
      setResourceConflict(null);
      return;
    }
    const current = baseline.kind === "warehouse" ? warehouseForm :
      baseline.kind === "vendor" ? vendorForm : itemForm;
    if (JSON.stringify(current) !== baseline.signature) {
      setResourceConflict("changed");
      return;
    }
    if (baseline.kind === "warehouse") setWarehouseForm(refreshedForm as Warehouse);
    else if (baseline.kind === "vendor") setVendorForm(refreshedForm as Vendor);
    else setItemForm(refreshedForm as InventoryItem);
    baseline.signature = signature;
    if (baseline.kind === "warehouse") baseline.locationContext = latestLocationContext;
    setResourceConflict(null);
  }, [resource, state, warehouseForm, vendorForm, itemForm]);
  useEffect(() => {
    const baseline = orderServerBaseline.current;
    if (!editingOrderId || !baseline || baseline.id !== editingOrderId || !state) return;
    const latest = state.orders.find(value => value.id === editingOrderId);
    if (!latest || latest.status !== "draft") {
      setOrderConflict("deleted");
      return;
    }
    const signature = JSON.stringify(orderEditorValues(latest));
    if (signature === baseline.signature) {
      setOrderConflict(null);
      return;
    }
    if (orderDirty) {
      setOrderConflict("changed");
      return;
    }
    loadOrderDraft(latest);
    setOrderConflict(null);
  }, [state?.orders, editingOrderId, orderDirty]);
  useEffect(() => {
    if (!activeCount || !state) return;
    const latest = state.counts.find(value => value.id === activeCount.id);
    if (!latest || latest.status !== "open") {
      setCountConflict("unavailable");
      return;
    }
    if ((latest.draft?.revision ?? 0) !== countDraftRevision) {
      setCountConflict("changed");
      return;
    }
    setCountConflict(null);
  }, [state?.counts, activeCount?.id, countDraftRevision]);

  const countReviewStaleReason = (() => {
    if (!pendingCountReview) return null;
    if (!activeCount || activeCount.id !== pendingCountReview.countId) return "The active count changed.";
    if (activeCount.status !== "open") return "This count is no longer open.";
    if (!can("inventory.count")) return "You no longer have permission to post counts.";
    if (countConflict === "unavailable") return "The saved count is no longer open.";
    if (countConflict === "changed") return "Another operator saved a newer count draft.";
    if (countStockDrift) return "Warehouse stock changed after the count began.";
    try {
      const lines = inventoryCountLines(countRows);
      const identity = inventoryCountReviewIdentity(activeCount.id, countDraftRevision, lines, countReason);
      if (identity !== pendingCountReview.identity) return "Count quantities, serials, or the reason changed after this review was prepared.";
    } catch {
      return "The current count entries no longer pass validation.";
    }
    const latest = state?.counts.find(value => value.id === pendingCountReview.countId);
    if (!latest || latest.status !== "open") return "The saved count is no longer available to post.";
    if ((latest.draft?.revision ?? 0) !== pendingCountReview.draftRevision) return "The saved count revision changed after this review was prepared.";
    return null;
  })();
  const warehouseEditorType = resource === "warehouse"
    ? state?.locationTypes?.find(type => type.id === warehouseForm.locationTypeId) ?? (state ? locationTypeFor(state, warehouseForm) : undefined)
    : undefined;
  const warehouseRecord = state?.warehouses.find(value => value.id === warehouseForm.id);
  const warehouseCanSave = resource === "warehouse"
    ? (warehouseForm.id
      ? can("inventory.maintain") && (canManageLocationTypes || (!!state && !!warehouseRecord &&
        warehouseAccessible(state, warehouseRecord, user?.id, user?.role === "admin")))
      : can("inventory.maintain") && canManageLocationTypes)
    : can("inventory.maintain");

  if (!projectId) return <div className="p-6">Project not found.</div>;
  if (isLoading) return <main className="mx-auto max-w-7xl p-4 md:p-7 space-y-5"><div className="h-8 w-64 animate-pulse rounded bg-muted" /><div className="grid gap-4 md:grid-cols-3">{[1, 2, 3].map(i => <div key={i} className="h-28 animate-pulse rounded-lg bg-muted" />)}</div><div className="h-80 animate-pulse rounded-lg bg-muted" /></main>;
  if (!data) return <main className="mx-auto max-w-4xl p-6"><Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Inventory unavailable</AlertTitle><AlertDescription>Project inventory could not be loaded. Your work is safe; retry the connection.</AlertDescription></Alert><Button className="mt-4" onClick={() => refetch()}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button></main>;
  if (!state) return <main className="mx-auto max-w-4xl p-6"><Alert variant="destructive"><AlertTitle>Inventory snapshot is incomplete</AlertTitle><AlertDescription>Refresh the project inventory before continuing.</AlertDescription></Alert><Button className="mt-4" onClick={() => refetch()}>Retry</Button></main>;
  if (!data.enabled) return <main className="mx-auto max-w-3xl p-6"><Card><CardHeader><CardTitle>Inventory is not enabled</CardTitle><CardDescription>Ask a project administrator to enable inventory control in project settings.</CardDescription></CardHeader></Card></main>;
  const hasAny = !!(state?.warehouses.length || state?.items.length || state?.vendors.length);
  if (!can("inventory.view")) return <main className="mx-auto max-w-3xl p-6"><Card><CardHeader><CardTitle>Inventory access required</CardTitle><CardDescription>Your account does not have permission to view this project’s stock.</CardDescription></CardHeader></Card></main>;

  const openResource = (kind: ResourceKind, existing?: Warehouse | Vendor | InventoryItem, copying = false) => {
    if (resourceSaving.current || imageBusy) return;
    if (kind === "warehouse") {
      if (existing) {
        if (!can("inventory.maintain") || (!canManageLocationTypes &&
            !warehouseAccessible(state!, existing as Warehouse, user?.id, user?.role === "admin"))) return;
      } else if (!can("inventory.maintain") || !canManageLocationTypes) return;
    } else if (!can("inventory.maintain")) return;
    resourceId.current = copying ? freshId() : existing?.id || freshId();
    resourceAttempt.current = null;
    setResourceError(null);
    setCopiedItemName(copying && kind === "item" ? existing?.name ?? null : null);
    setResource(kind);
    if (kind === "warehouse") {
      const source = existing as Warehouse | undefined;
      const resolvedType = source ? locationTypeFor(state!, source) : undefined;
      const form: Warehouse = source
        ? { ...source, locationTypeId: source.locationTypeId ?? resolvedType?.id, type: resolvedType?.kind ?? source.type }
        : { ...blankWarehouse(), locationTypeId: defaultLocationTypeId("physical") };
      setWarehouseForm(form);
      const selectedType = locationTypeFor(state!, form);
      setSelectedLocationTypeBasis(selectedType ? { id: selectedType.id, revision: selectedType.revision } : null);
      resourceBaseline.current = { kind, id: form.id, signature: JSON.stringify(form), copied: copying,
        locationContext: source ? locationContextSignature(source) : undefined };
    }
    if (kind === "vendor") {
      const form = existing as Vendor ?? blankVendor();
      setVendorForm(form);
      resourceBaseline.current = { kind, id: form.id, signature: JSON.stringify(form), copied: copying };
    }
    if (kind === "item") {
      const item = existing ? copying ? copyInventoryItem(existing as InventoryItem) : existing as InventoryItem : undefined;
      const form = item ? { ...item, images: item.images.filter(image => !!sameOriginImage(image)) } : blankItem();
      setItemForm(form);
      resourceBaseline.current = { kind, id: form.id, signature: JSON.stringify(form), copied: copying };
    }
    setResourceConflict(null);
  };
  const saveResource = () => {
    if (!resource || resourceConflict || resourceSaving.current || imageBusy || command.isPending) return;
    if (resource !== "warehouse" && !can("inventory.maintain")) return;
    if (resource === "warehouse") {
      const baseline = resourceBaseline.current;
      const creating = !baseline?.id;
      if (creating ? (!can("inventory.maintain") || !canManageLocationTypes) : !can("inventory.maintain")) return;
      const existing = creating ? undefined : state.warehouses.find(value => value.id === baseline?.id);
      if (existing && !canManageLocationTypes && !warehouseAccessible(state, existing, user?.id, user?.role === "admin")) return;
      if (!canManageLocationTypes && existing) {
        const original = existing;
        if (warehouseForm.locationTypeId !== (original.locationTypeId ?? locationTypeFor(state, original)?.id) ||
            warehouseForm.assignedUserId !== original.assignedUserId ||
            JSON.stringify(warehouseForm.userIds) !== JSON.stringify(original.userIds)) {
          setResourceError("Location type and access assignments require the Manage location types permission.");
          return;
        }
      }
    }
    setResourceError(null);
    let payload: Record<string, unknown>;
    try {
      const draft = resource === "warehouse" ? warehouseForm : resource === "vendor" ? vendorForm : itemForm;
      payload = validateInventoryResource(resource, { ...draft, id: resourceId.current });
      if (resource === "warehouse") {
        const currentType = locationTypeFor(state, warehouseForm);
        if (currentType) {
          if (!selectedLocationTypeBasis || selectedLocationTypeBasis.id !== currentType.id || selectedLocationTypeBasis.revision !== currentType.revision) {
            setResourceError("The selected location type changed. Review its updated policy before saving.");
            return;
          }
          payload = { ...payload, expectedLocationTypeRevision: selectedLocationTypeBasis.revision };
        }
      }
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
  const reloadResourceFromServer = () => {
    const baseline = resourceBaseline.current;
    if (!baseline || !baseline.id || !state) return;
    const currentForm = baseline.kind === "warehouse" ? warehouseForm :
      baseline.kind === "vendor" ? vendorForm : itemForm;
    if (JSON.stringify(currentForm) !== baseline.signature &&
        !window.confirm("Replace your unsaved details with the current server record? This discards the local edits.")) return;
    const latest = baseline.kind === "warehouse" ? state.warehouses.find(value => value.id === baseline.id) :
      baseline.kind === "vendor" ? state.vendors.find(value => value.id === baseline.id) :
        state.items.find(value => value.id === baseline.id);
    if (!latest) {
      setResourceConflict("deleted");
      return;
    }
    const signature = JSON.stringify(latest);
    if (baseline.kind === "warehouse") {
      setWarehouseForm(latest as Warehouse);
      const type = locationTypeFor(state, latest as Warehouse);
      setSelectedLocationTypeBasis(type ? { id: type.id, revision: type.revision } : null);
    }
    else if (baseline.kind === "vendor") setVendorForm(latest as Vendor);
    else setItemForm(latest as InventoryItem);
    baseline.signature = signature;
    setResourceConflict(null);
    setResourceError(null);
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
    orderServerBaseline.current = null;
    setOrderConflict(null);
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
  const loadOrderDraft = (order: InventoryOrder) => {
    orderAttempt.current = null;
    orderServerBaseline.current = { id: order.id, signature: JSON.stringify(orderEditorValues(order)) };
    setOrderConflict(null);
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
  };
  const reloadOrderDraftFromServer = () => {
    const current = state?.orders.find(order => order.id === editingOrderId && order.status === "draft");
    if (!current) {
      setOrderConflict("deleted");
      return;
    }
    if (orderDirty && !window.confirm("Replace this unsaved order draft with the current server draft? Local edits will be discarded.")) return;
    loadOrderDraft(current);
    setOrderMessage("Loaded the current server draft. Review it before saving.");
  };
  const editOrderDraft = (order: InventoryOrder) => requestOrderTransition(() => loadOrderDraft(order));
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
    orderServerBaseline.current = null;
    setOrderConflict(null);
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
  const openPrint = (kind: "order" | "receipt" | "count" | "return" | "customer-handoff" | "activity", id: string) => {
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
  const reconcileUnrelease = async (orderId: string, permission: string) => {
    const response = await fetch(base, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`Inventory status could not be checked (${response.status}).`);
    const snapshot = await response.json() as Snapshot;
    if (!snapshot?.state || !Array.isArray(snapshot.permissions)) throw new Error("The inventory status response was incomplete.");
    queryClient.setQueryData(queryKey, snapshot);
    const current = snapshot.state.orders.find(order => order.id === orderId);
    if (!current) {
      return { opened: false, checkable: true, message: "Status checked, but this order is no longer available. No editor was opened." };
    }
    if (!can("inventory.view") || !can(permission) ||
        !snapshot.permissions.includes("inventory.view") || !snapshot.permissions.includes(permission)) {
      return { opened: false, checkable: false, message: "Status checked, but your current inventory access does not allow editing this order." };
    }
    if (current.status !== "draft") {
      return { opened: false, checkable: false, message: `Status checked: this order is ${current.status}, not draft. No editor was opened.` };
    }
    const requiredWarehouses = [current.destinationId, ...(current.type === "transfer" ? [current.sourceId] : [])];
    if (!requiredWarehouses.every(id => {
      const warehouse = snapshot.state.warehouses.find(value => value.id === id);
      return !!warehouse && warehouseAccessible(snapshot.state, warehouse, user?.id, user?.role === "admin");
    })) {
      return { opened: false, checkable: false, message: "Status checked, but your current warehouse access does not allow editing this order." };
    }
    loadOrderDraft(current);
    return { opened: true, checkable: false, message: `Draft confirmed for ${orderLabel(current)}; opened the order editor.` };
  };
  const checkUnreleaseStatus = async (order: InventoryOrder) => {
    if (unreleaseInFlight.current.has(order.id)) return;
    const permission = order.type === "transfer" ? "inventory.transfer" : "inventory.purchase";
    unreleaseInFlight.current.add(order.id);
    setUnreleaseStatus(current => ({ ...current, [order.id]: { pending: true, message: "Checking the authoritative order status…", needsCheck: false } }));
    try {
      const result = await reconcileUnrelease(order.id, permission);
      setUnreleaseStatus(current => ({ ...current, [order.id]: {
        pending: false, message: result.message, needsCheck: result.checkable,
      } }));
    } catch (error) {
      setUnreleaseStatus(current => ({ ...current, [order.id]: {
        pending: false,
        message: `Could not confirm the order status. Your editor entries were kept. ${error instanceof Error ? error.message : "Reconnect and check again."}`,
        needsCheck: true,
      } }));
    } finally {
      unreleaseInFlight.current.delete(order.id);
    }
  };
  const runOrderCommand = (action: "unrelease" | "archiveOrder" | "restoreOrder", order: InventoryOrder) => {
    if (command.isPending || !can(action === "unrelease" && order.type === "transfer" ? "inventory.transfer" : "inventory.purchase")) return;
    if (action === "unrelease") {
      if (unreleaseInFlight.current.has(order.id)) return;
      const permission = order.type === "transfer" ? "inventory.transfer" : "inventory.purchase";
      unreleaseInFlight.current.add(order.id);
      setUnreleaseStatus(current => ({ ...current, [order.id]: { pending: true, message: "Returning order to draft…", needsCheck: false } }));
      void (async () => {
        let postMessage = "";
        try {
          await command.mutateAsync({ action, data: { orderId: order.id }, operationId: freshId() });
        } catch (error) {
          // A failed response can still follow a committed command. Reconcile before
          // telling the operator whether the order changed.
          postMessage = error instanceof Error ? error.message : "The command response was not confirmed.";
        }
        try {
          const result = await reconcileUnrelease(order.id, permission);
          setUnreleaseStatus(current => ({ ...current, [order.id]: {
            pending: false,
            message: result.opened
              ? result.message
              : `${result.message}${postMessage ? ` The command response was uncertain: ${postMessage} A saved capture owned by another operator may also block un-release even when it is not visible in your capture list.` : ""}`,
            needsCheck: result.checkable,
          } }));
        } catch (error) {
          setUnreleaseStatus(current => ({ ...current, [order.id]: {
            pending: false,
            message: `The un-release result is unknown; inventory status could not be confirmed. Your editor entries were kept. ${error instanceof Error ? error.message : postMessage || "Reconnect and check again."}`,
            needsCheck: true,
          } }));
        } finally {
          unreleaseInFlight.current.delete(order.id);
        }
      })();
      return;
    }
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
    if (activeCount && (activeCount.id !== count.id || reload)) countRecovery.clear();
    setPendingCountReview(null);
    setCountSerialDialog(null);
    setCountToolsOpen(count.scope === "selected" && !(count.draft?.rows.length));
    if (countDraftId !== count.id || reload) {
      const rows = inventoryCountRows(count, items, {}, {});
      setSavedCountValues(JSON.stringify({ reason: count.draft?.reason ?? "",
        rows: rows.map(({ itemId, quantity, serials }) => ({ itemId, quantity, serials })).sort((a, b) => a.itemId.localeCompare(b.itemId)) }));
      const initialRows = count.scope === "selected"
        ? count.draft?.rows ?? []
        : count.draft?.rows ?? count.snapshot.map(row => ({
          itemId: row.itemId, quantity: String(row.quantity), serials: row.serials.join("\n"),
        }));
      setCountQuantities(Object.fromEntries(initialRows.map(row => [row.itemId, row.quantity])));
      setCountSerials(Object.fromEntries(initialRows.map(row => [row.itemId, row.serials])));
      setCountReason(count.draft?.reason ?? "");
      setCountDraftRevision(count.draft?.revision ?? 0);
      setCountDraftMessage(count.draft ? `Loaded saved draft revision ${count.draft.revision}.` : "");
      setCountDraftId(count.id);
      setCountPage(0);
      setCountSearch("");
      setCountProduct("");
    }
    setCountConflict(null);
    setActiveCount(count);
    setCountWarehouse(count.warehouseId);
  };
  const countRowIds = new Set(countRows.map(row => row.itemId));
  const discoveryProducts = items.filter(item => item.active && item.kind !== "labor" && !countRowIds.has(item.id) &&
    matchesCountProduct(item, countSearch)).slice(0, 100);
  const matchingCountRows = countRows.filter(row => matchesCountProduct(row.item, countSearch));
  const lastCountPage = Math.max(0, Math.ceil(matchingCountRows.length / countPageSize) - 1);
  const currentCountPage = Math.min(countPage, lastCountPage);
  const visibleCountRows = matchingCountRows.slice(currentCountPage * countPageSize, (currentCountPage + 1) * countPageSize);
  const countExportRows = countExportScope === "filtered" ? matchingCountRows
    : countExportScope === "page" ? visibleCountRows : countRows;
  const exportCount = async (format: "csv" | "xlsx" | "pdf") => {
    if (!activeCount || !countExportRows.length) return;
    const rows: CountExportRow[] = countExportRows.map(row => ({
      sku: row.item?.sku ?? row.itemId,
      name: row.item?.name ?? "Unavailable catalog item",
      tracking: row.item?.tracking ?? "unknown",
      expected: activeCount.snapshot.find(snapshot => snapshot.itemId === row.itemId)?.quantity ?? 0,
      actual: row.quantity,
      serials: row.serials,
    }));
    try {
      await downloadCountEntries(format, {
        project: data?.projectName ?? "Inventory",
        location: warehouses.find(warehouse => warehouse.id === activeCount.warehouseId)?.name ?? "Location unavailable",
        countReference: inventoryCountReference(state?.counts ?? [], activeCount.id),
        scope: activeCount.scope === "selected" ? "selected" : "warehouse",
        exportScope: countExportScope === "all" ? "All entries" : countExportScope === "filtered" ? "Filtered entries" : "Current page",
      }, rows);
    } catch (error) {
      toast({ title: `${format === "xlsx" ? "Excel" : format.toUpperCase()} export failed`,
        description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    }
  };
  const addCountProduct = (itemId = countProduct) => {
    if (!itemId || countRecovery.pending || !can("inventory.count") || command.isPending ||
      countRowIds.has(itemId) || countRows.length >= COUNT_MAX_LINES) return;
    setCountQuantities(current => ({ [itemId]: "", ...current }));
    setCountSerials(current => ({ [itemId]: "", ...current }));
    setCountSearch("");
    setCountPage(0);
    setCountProduct("");
    setCountDraftMessage("Unsaved discovery added. Save the draft before leaving.");
  };
  const saveCountDraft = (afterSave?: () => void) => {
    if (!activeCount || countRecovery.pending || countConflict || !can("inventory.count") || command.isPending || countSaving.current) return;
    countSaving.current = true;
    command.mutate({ action: "countSaveDraft", data: {
      id: activeCount.id, revision: countDraftRevision, reason: countReason,
      rows: countRows.map(row => ({ itemId: row.itemId, quantity: row.quantity, serials: row.serials })),
    } }, {
      onSuccess: result => {
        const saved = (result.state as InventoryState).counts.find(count => count.id === activeCount.id);
        if (saved?.draft) {
          countRecovery.clear();
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
    // The caller already presents Save / Discard / Stay; retain edits until refetch succeeds.
    const latest = await snapshotQuery.refetch();
    const count = latest.data?.state.counts.find(count => count.id === activeCount.id);
    if (!latest.isError && count?.status === "open") openCount(count, true);
    else setCountDraftMessage("The saved draft could not be loaded, or the count is no longer open. Your entries were kept.");
  };
  const startCount = () => {
    if (!countWarehouse || !can("inventory.count")) return;
    const id = freshId();
    command.mutate({ action: "countStart", data: {
      id, warehouseId: countWarehouse, scope: countStartScope,
    } }, { onSuccess: result => {
      const count = (result.state as InventoryState).counts.find(value => value.id === id);
      if (!count) {
        toast({ title: "Count snapshot unavailable", description: "Refresh inventory and continue the saved count.", variant: "destructive" });
        return;
      }
      setCountStartOpen(false);
      openCount(count, true);
    } });
  };
  const closeCount = () => {
    countRecovery.clear();
    setPendingCountReview(null);
    setCountSerialDialog(null);
    setActiveCount(null);
    setCountDraftId(null);
  };
  const cancelCount = (count: InventoryCount) => {
    const cancel = () => command.mutate({ action: "countCancel", data: { id: count.id, reason: "Operator cancelled stale or unfinished count" } },
      { onSuccess: () => { if (activeCount?.id === count.id) closeCount(); } });
    if (activeCount?.id === count.id) requestCountTransition(cancel);
    else cancel();
  };
  const postReviewedCount = (review: CountDiscrepancyReviewPayload) => {
    if (!activeCount || pendingCountReview?.identity !== review.identity || countReviewStaleReason ||
        !can("inventory.count") || command.isPending || countSaving.current) return;
    let countLines: StockLine[];
    try { countLines = inventoryCountLines(countRows); }
    catch (error) {
      toast({ title: "Check count entries", description: error instanceof Error ? error.message : "Review every counted item.", variant: "destructive" });
      return;
    }
    const identity = inventoryCountReviewIdentity(activeCount.id, countDraftRevision, countLines, countReason);
    const latest = state.counts.find(value => value.id === activeCount.id);
    if (identity !== review.identity || activeCount.id !== review.countId || !latest || latest.status !== "open" ||
        (latest.draft?.revision ?? 0) !== review.draftRevision || countStockDrift || countConflict) {
      setCountDraftMessage("The reviewed count changed before confirmation. Go back and prepare a fresh review; your entries are retained.");
      return;
    }
    command.mutate({ action: "countPost", data: { id: review.countId, draftRevision: review.draftRevision, lines: countLines, reason: review.reason } }, { onSuccess: () => {
      countRecovery.clear();
      setPendingCountReview(null);
      setCountSerialDialog(null);
      setActiveCount(null);
      setCountDraftId(null);
    }, onError: () => {
      // Keep the exact reviewed payload and acknowledgement available for a non-destructive retry.
      setCountDraftMessage("Posting could not be confirmed. Your entries and review are retained; refresh inventory before retrying.");
    } });
  };
  const postCount = () => {
    if (!activeCount || countRecovery.pending || countConflict || countStockDrift || !can("inventory.count") || command.isPending ||
        countSaving.current || countRows.length === 0 || !countReason.trim()) return;
    let countLines: StockLine[];
    try { countLines = inventoryCountLines(countRows); }
    catch (error) {
      toast({ title: "Check count entries", description: error instanceof Error ? error.message : "Review every counted item.", variant: "destructive" });
      return;
    }
    const changes = inventoryCountSerialChanges(activeCount.snapshot, countLines, items);
    if (changes.length) {
      const lines = Object.freeze(countLines.map(line => Object.freeze({ ...line, serials: Object.freeze([...line.serials]) }))) as unknown as CountDiscrepancyReviewPayload["lines"];
      const reason = countReason;
      const immutableChanges = Object.freeze(changes.map(change => Object.freeze({
        ...change,
        missingSerials: Object.freeze([...change.missingSerials]),
        unexpectedSerials: Object.freeze([...change.unexpectedSerials]),
      }))) as unknown as CountDiscrepancyReviewPayload["changes"];
      setPendingCountReview(Object.freeze({
        countId: activeCount.id,
        draftRevision: countDraftRevision,
        lines,
        reason,
        identity: inventoryCountReviewIdentity(activeCount.id, countDraftRevision, lines, reason),
        changes: immutableChanges,
      }));
      return;
    }
    command.mutate({ action: "countPost", data: { id: activeCount.id, draftRevision: countDraftRevision, lines: countLines, reason: countReason } }, { onSuccess: () => {
      countRecovery.clear();
      setPendingCountReview(null);
      setCountSerialDialog(null);
      setActiveCount(null);
      setCountDraftId(null);
    } });
  };

  return <main ref={inventoryMainRef} className={`inventory-workspace-shell relative mx-auto flex h-[calc(100dvh-72px)] min-h-0 w-full max-w-7xl flex-col overflow-hidden p-2 sm:p-4 md:p-7 ${["locations", "returns"].includes(inventoryTab) ? "[@media(max-height:500px)]:pb-2" : ""}`} data-testid="inventory-workspace">
    {(capabilities.startInventory || inventoryWorkspace !== "inventory") && <InventoryWorkflowLauncher projectId={Number(projectId)} permissions={latestPermissionSnapshot?.permissions}
      screen={inventoryWorkspace === "fulfillment" && !capabilities.fulfillment ||
        inventoryWorkspace === "vehicle-stock" && !capabilities.vehicleStock ||
        inventoryWorkspace === "return-equipment" && !capabilities.returnEquipment ||
        inventoryWorkspace === "vehicle-count" && !capabilities.verifyVehicle ||
        inventoryWorkspace === "return-stock" && !capabilities.returnStock ? "tasks" : inventoryWorkspace}
      onScreenChange={setInventoryWorkspace} />}
    <div className={inventoryWorkspace !== "inventory" ? "hidden" : "contents"}>
    <div
      ref={editorHostRef}
      className={inlineEditorOpen ? "absolute inset-0 z-30" : "hidden"}
      aria-hidden={inlineEditorOpen ? undefined : true}
    />
    <CountDiscrepancyReview
      review={pendingCountReview}
      staleReason={countReviewStaleReason}
      posting={command.isPending}
      onDismiss={() => setPendingCountReview(null)}
      onConfirm={postReviewedCount}
    />
    <Dialog open={!!pendingResourceTransition} onOpenChange={open => { if (!open && !resourceSaving.current && !imageBusy) setPendingResourceTransition(null); }}>
      <DialogContent onEscapeKeyDown={event => { if (resourceSaving.current || imageBusy) event.preventDefault(); }} onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>Unsaved inventory details</DialogTitle><DialogDescription>Your location or item changes have not been saved. Stay to keep editing, or discard them and return to the inventory list.</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={resourceBusy} onClick={() => setPendingResourceTransition(null)}>Stay</Button>
          <Button type="button" variant="destructive" disabled={resourceBusy} onClick={() => {
            const next = pendingResourceTransition;
            setPendingResourceTransition(null);
            next?.();
          }}>Discard</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <Dialog open={!!pendingKitTransition} onOpenChange={open => { if (!open && !command.isPending) setPendingKitTransition(null); }}>
      <DialogContent onEscapeKeyDown={event => event.preventDefault()} onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>Unsaved kit operation</DialogTitle><DialogDescription>Scanned serial custody and dispositions have not been posted. Stay here or discard the local draft before navigating.</DialogDescription></DialogHeader>
        <DialogFooter><Button variant="outline" disabled={command.isPending} onClick={() => setPendingKitTransition(null)}>Keep editing</Button><Button variant="destructive" disabled={command.isPending} onClick={() => {
          const next = pendingKitTransition;
          setPendingKitTransition(null);
          next?.();
        }}>Discard draft</Button></DialogFooter>
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
        <DialogHeader><DialogTitle>Close remainder · <span className="font-mono">{currentClosingOrder ? orderLabel(currentClosingOrder) : "Order unavailable"}</span></DialogTitle><DialogDescription>Outstanding units will be recorded as explicitly unfulfilled. No stock movement is created. This cannot be undone.</DialogDescription></DialogHeader>
        {orderToClose && !currentClosingOrder && <Alert data-testid="inventory-external-change" variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Order is no longer available</AlertTitle><AlertDescription>Your closure reason is retained, but the current order could not be found and will not be submitted.</AlertDescription></Alert>}
        {currentClosingOrder && <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border p-3">{currentClosingOrder.lines.map(line => {
          const item = items.find(value => value.id === line.itemId);
          const p = orderLineProgress(state, currentClosingOrder, line.itemId);
          const closedShort = Math.max(0, p.ordered - p.received);
          return <div key={line.itemId} className="flex justify-between gap-3 border-b pb-2 text-sm last:border-0 last:pb-0"><span>{item?.name ?? line.itemId} <span className="font-mono text-xs text-muted-foreground">{item?.sku}</span></span><span className="font-mono tabular-nums">{closedShort} closed short</span></div>;
        })}</div>}
        <div className="space-y-1"><Label htmlFor="close-order-reason">Closure reason</Label><Textarea id="close-order-reason" maxLength={1000} rows={3} value={closeReason} onChange={event => setCloseReason(event.target.value)} placeholder="Document why the remaining quantity will not be fulfilled" /></div>
        <DialogFooter><Button variant="outline" disabled={command.isPending} onClick={() => setOrderToClose(null)}>Stay</Button><Button variant="destructive" disabled={!currentClosingOrder || !closeReason.trim() || command.isPending || !can("inventory.closeOrders")} onClick={() => void confirmCloseOrder()}>{command.isPending ? "Closing…" : "Confirm close with exceptions"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    {isError && <Alert variant="destructive"><AlertTitle>Inventory refresh failed</AlertTitle><AlertDescription>The last loaded inventory is shown. Your count entries were kept; retry before relying on current stock.</AlertDescription><Button variant="outline" className="mt-2" onClick={() => refetch()}>Retry inventory refresh</Button></Alert>}
    <div
      ref={inventoryTabsHostRef}
      style={{ visibility: inlineEditorOpen ? "hidden" : undefined }}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
    <Tabs value={inventoryTab} onValueChange={value => requestCountTransition(() => requestOrderTransition(() => requestResourceTransition(() => requestMovementTransition(() => requestKitTransition(() => setInventoryTab(value))))))} className="flex min-h-0 flex-1 flex-col gap-1.5 sm:gap-3 [&>[role=tabpanel]]:mt-0 md:[&>[role=tabpanel]]:mt-2">
      <div className="inventory-sticky-header relative z-10 shrink-0 space-y-2 border-b bg-background pb-2 sm:space-y-3 sm:pb-3" data-testid="inventory-sticky-header">
        {capabilities.startInventory && <StartInventoryButton mobile projectId={Number(projectId)} permissions={latestPermissionSnapshot?.permissions} />}
        <div className="flex min-w-0 items-center justify-between gap-2 sm:items-center">
          <ProjectInventoryMobileMenu value={inventoryTab} onValueChange={setInventoryTab} can={can} />
          <div className="inventory-desktop-heading hidden min-w-0 md:block">
            <p className="mb-0.5 hidden text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground sm:block">Project operations</p>
            <h1 className="text-xl font-semibold tracking-tight sm:text-3xl">Inventory</h1>
            <p className="mt-1 hidden text-sm text-muted-foreground sm:block">Know what’s on hand, where it lives, and which serial leaves with each crew.</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:flex-wrap sm:gap-2">
            {capabilities.startInventory && <StartInventoryButton projectId={Number(projectId)} permissions={latestPermissionSnapshot?.permissions} />}
            {can("inventory.view") && can("inventory.transfer") && can("inventory.receive") &&
              <VehicleTransferPanel projectId={projectId} permissions={latestPermissionSnapshot?.permissions} />}
            <span
              data-testid="inventory-live-indicator"
              aria-live="polite"
              aria-label={`Inventory connection ${inventoryEvents.status}`}
              title={inventoryEvents.status === "live" ? "Live inventory updates are connected" : `Live inventory updates ${inventoryEvents.status}`}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium text-muted-foreground sm:px-2.5 sm:text-xs"
            >
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${inventoryEvents.status === "live" ? "bg-emerald-600" : inventoryEvents.status === "unavailable" ? "bg-amber-600" : "bg-muted-foreground"}`} />
              <span className="hidden sm:inline">{inventoryEvents.status === "live" ? "Live" : inventoryEvents.status === "reconnecting" ? "Reconnecting" : inventoryEvents.status === "unavailable" ? "Live unavailable" : "Connecting"}</span>
              <span className="sr-only">{inventoryEvents.status === "live" ? "Live" : inventoryEvents.status === "reconnecting" ? "Reconnecting" : inventoryEvents.status === "unavailable" ? "Live updates unavailable" : "Connecting"}</span>
            </span>
            {inventoryEvents.status === "unavailable" && <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-[11px] sm:text-xs" aria-label="Retry live inventory updates" onClick={inventoryEvents.reconnect}>
              <RefreshCw className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Retry live</span>
            </Button>}
            {capabilities.stats && <Button
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
            </Button>}
          </div>
        </div>
        {capabilities.stats && <div
          id="inventory-stats-region"
          role="region"
          aria-label="Inventory statistics"
          data-testid="inventory-stats-region"
          hidden={!showInventoryStats}
          className={showInventoryStats ? "grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4" : "hidden"}
        >
          <Metric label="Active locations" value={summary?.locations ?? activeWarehouses.length} detail={`${summary?.vehicles ?? warehouses.filter(value => value.type === "vehicle").length} vehicles`} icon={<WarehouseIcon className="h-4 w-4" />} />
          <Metric label="Catalog items" value={summary?.items ?? items.filter(item => item.active).length} detail={`${summary?.serialized ?? items.filter(item => item.tracking === "serialized").length} serial tracked`} icon={<Package className="h-4 w-4" />} />
          <Metric label="Open orders" value={summary?.orders ?? orderItems.filter(order => ["draft", "released", "partial"].includes(order.status)).length} detail="Purchases and transfers" icon={<ArrowLeftRight className="h-4 w-4" />} />
          <Metric label="Open counts" value={summary?.counts ?? state.counts.filter(count => count.status === "open").length} detail={summary ? "Snapshots awaiting a post" : `Ledger revision ${state.revision}`} icon={<ClipboardList className="h-4 w-4" />} />
        </div>}
        <ProjectInventoryDesktopTabs can={can} />
      </div>

    {/* Preserve the existing navigation policy, but let these toolbar surfaces
        scroll into view when that navigation leaves very little desktop height. */}
    <div className={`min-h-0 flex-1 ${["locations", "returns"].includes(inventoryTab) ? "flex flex-col overflow-y-auto overscroll-contain" : ["orders", "stock", "items", "vendors", "categories", "exceptions", "counts", "activity", "stock-discrepancies"].includes(inventoryTab) ? "flex flex-col overflow-hidden" : "space-y-5 overflow-y-auto overscroll-contain pb-8 pr-1"}`} data-testid="inventory-scroll-content" role="region" aria-label="Inventory content" tabIndex={0}>
    {!hasAny && <Alert hidden={["orders", "stock", "items", "vendors", "categories"].includes(inventoryTab)}><Boxes className="h-4 w-4" /><AlertTitle>Set up the first stock location</AlertTitle><AlertDescription>Add a warehouse or service vehicle, then add catalog items and begin receiving meters.</AlertDescription></Alert>}

      {capabilities.tabs.stock && <TabsContent value="stock" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryStockWorkspace base={base} projectName={data.projectName} timezone={timezone} onRefresh={() => void refetch()}
          onViewSerials={setSelectedStockRow} canVerifyVendorKit={can("inventory.receive")}
          onVerifyVendorKit={() => { setVendorKitOpen(true); }} />
      </TabsContent>}
      {capabilities.tabs["stock-discrepancies"] && <TabsContent value="stock-discrepancies" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryStockDiscrepancies projectId={projectId!} state={state} canResolve={can("inventory.resolveExceptions")} busy={command.isPending}
          timezone={timezone} projectName={data.projectName} actors={data.actors ?? []}
          workOrderLabels={data.workOrderLabels ?? {}} workOrderIdentifiers={data.workOrderIdentifiers}
          onNavigate={setInventoryTab}
          onResolve={async payload => {
            await command.mutateAsync({ action: "resolveStockDiscrepancy", data: payload });
            return true;
          }} />
      </TabsContent>}
      {capabilities.tabs.locations && <TabsContent value="locations" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        {locationTypesManagerOpen && canManageLocationTypes && can("inventory.maintain") ? <LocationTypesManager state={state} pending={command.isPending} authorized={canManageLocationTypes} portalHost={editorHostRef.current}
          onBack={() => setLocationTypesManagerOpen(false)}
          onCommand={(action, payload, onSuccess, onError) => command.mutate(
            { action: action as InventoryCommand["action"], data: payload },
            { onSuccess: () => onSuccess(), onError: error => onError(error instanceof Error ? error : new Error("Location type could not be saved.")) },
          )} /> :
        <InventoryRecordsWorkspace kind="locations" title="Warehouses & vehicles" description="Access is enforced by the project inventory service for every operation." dataset={locationsDataset} projectName={data.projectName} timezone={timezone} onRefresh={() => void refetch()}
          headerAction={(canManageLocationTypes || can("inventory.maintain")) && <div className="flex flex-wrap items-center gap-1.5">
            {canManageLocationTypes && can("inventory.maintain") && <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" aria-label="Add location" title="Add location" onClick={() => openResource("warehouse")}><Plus className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Add location</span></Button>}
            {canManageLocationTypes && <Button className="h-9 px-2.5 sm:px-3" size="sm" variant="outline" aria-label="Manage location types" title="Manage location types" onClick={() => setLocationTypesManagerOpen(true)}><span className="sm:hidden">Types</span><span className="hidden sm:inline">Manage location types</span></Button>}
          </div>}
          renderRow={row => { const warehouse = warehouses.find(value => value.id === row.id); if (!warehouse) return null;
            const assigned = data.users.find(user => user.id === warehouse.assignedUserId)?.username ?? (warehouse.assignedUserId ? inventoryActorLabel(warehouse.assignedUserId, data.actors ?? data.users) : "None");
            const authorized = warehouse.userIds.map(id => data.users.find(user => user.id === id)?.username ?? inventoryActorLabel(id, data.actors ?? data.users));
            const resolvedType = locationTypeFor(state, warehouse);
            const restricted = resolvedType?.accessPolicy === "assigned";
            const detail = resolvedType?.kind === "vehicle"
              ? [warehouse.make, warehouse.model, warehouse.year, warehouse.plate && `${warehouse.plate} ${warehouse.plateState}`].filter(Boolean).join(" · ")
              : resolvedType?.kind === "physical"
                ? [warehouse.address, warehouse.city, warehouse.state, warehouse.zip].filter(Boolean).join(", ") || "Address not recorded"
                : [warehouse.location, warehouse.city, warehouse.state].filter(Boolean).join(", ") || "Mobile location";
            return <article className="min-w-0 rounded-md border bg-card px-3 py-2 sm:px-4 sm:py-3"><div className="flex min-w-0 items-start justify-between gap-2 sm:gap-3">
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2 font-medium"><h3 className="break-words">{warehouse.name}</h3><Badge variant="outline">{locationTypeLabel(state, warehouse)}</Badge>{!warehouse.active && <Badge variant="secondary">Inactive</Badge>}</div>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{warehouse.code}</p>
                <div className="hidden md:block">
                  <p className="mt-2 break-words text-sm text-muted-foreground">{detail}</p>
                  {restricted && <p className="mt-1 break-words text-xs text-muted-foreground">Assigned: {assigned} · {warehouse.userIds.length} additional authorized{authorized.length ? ` · ${authorized.join(", ")}` : ""}</p>}
                </div>
                <details className="md:hidden"><summary className="mt-1 cursor-pointer text-xs text-muted-foreground">Location details</summary><div>
                <p className="mt-2 break-words text-sm text-muted-foreground">{detail}</p>
                {restricted && <p className="mt-1 break-words text-xs text-muted-foreground">Assigned: {assigned} · {warehouse.userIds.length} additional authorized{authorized.length ? ` · ${authorized.join(", ")}` : ""}</p>}
                </div></details>
              </div>{can("inventory.maintain") && (canManageLocationTypes || warehouseAccessible(state, warehouse, user?.id, user?.role === "admin")) && <Button size="sm" variant="outline" onClick={() => openResource("warehouse", warehouse)}>Edit</Button>}</div></article>;
          }} />
        }
      </TabsContent>}
      {capabilities.tabs.items && <TabsContent value="items" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryCatalogWorkspace kind="items" items={items} vendors={vendors} projectName={data.projectName} timezone={timezone}
          canMaintain={can("inventory.maintain")} canAssemble={can("inventory.assemble")} canInspectKits={can("inventory.resolveExceptions")}
          onAssemble={() => setKitDialogMode("assemble")} onDisassemble={() => setKitDialogMode("disassemble")} onInspectKits={() => setKitDialogMode("inspect")}
          onRefresh={() => void refetch()} onAdd={() => openResource("item")}
          onEditItem={item => openResource("item", item)} onCopyItem={item => openResource("item", item, true)}
          onDeleteItem={(item, operationId) => command.mutateAsync({ action: "itemDelete", data: { id: item.id }, operationId })}
          itemDeleteBlockers={item => itemDeletionBlockers(state, item.id)}
          itemDeletePending={command.isPending}
          onEditVendor={vendor => openResource("vendor", vendor)} />
      </TabsContent>}
      {capabilities.tabs.vendors && <TabsContent value="vendors" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryCatalogWorkspace kind="vendors" items={items} vendors={vendors} projectName={data.projectName} timezone={timezone}
          canMaintain={can("inventory.maintain")} onRefresh={() => void refetch()} onAdd={() => openResource("vendor")}
          onEditItem={item => openResource("item", item)} onEditVendor={vendor => openResource("vendor", vendor)} />
      </TabsContent>}
      {capabilities.tabs.categories && <TabsContent value="categories" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
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
                <InventoryDeleteAction kind="category" id={row.id} name={categoryName}
                  canMaintain={can("inventory.maintain")} pending={command.isPending}
                  blockers={categoryDeletionBlockers(state, row.id)}
                  onDelete={(id, operationId) => command.mutateAsync({ action: "categoryDelete", data: { id }, operationId })} />
              </div>
            </article>;
          }} />
      </TabsContent>}

      {capabilities.tabs.orders && <TabsContent value="orders" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <Dialog open={shipmentDraftsOpen} onOpenChange={setShipmentDraftsOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader><DialogTitle>Saved shipment drafts</DialogTitle><DialogDescription>Continue a saved receiving, dispatch, or arrival capture. Access remains owner-only, except administrators may take ownership.</DialogDescription></DialogHeader>
            <InventoryShipmentDraftsPanel base={base} state={state} users={data.users} orders={orderItems}
              userId={user?.id} isAdmin={user?.role === "admin"} onResume={(draft, snapshot) => void resumeShipmentDraft(draft, snapshot)} />
          </DialogContent>
        </Dialog>
        {can("inventory.purchase") || can("inventory.transfer") ? <>
          {orderEditorOpen && <InventoryEditorSurface
              inline
              portalHost={editorHostRef.current}
              title={editingOrderId ? "Edit order draft" : replacementFor ? "Create replacement draft" : "Build an order draft"}
              description={editingOrderId
                  ? `Update ${orderTitle(editingOrderId)}. Its generated order number and internal ID stay unchanged.`
                  : replacementFor
                  ? `This new order is linked to ${orderTitle(replacementFor)}. The original quantities and exception history stay unchanged.`
                  : "Plan items and quantities now. Record serials later during receiving or transfer dispatch."}
              onBack={closeOrderEditor}
              onSave={() => saveOrderDraft()}
              saving={orderSaving.current || command.isPending}
              saveDisabled={!!orderConflict || !canSaveOrder}
              saveLabel="Save draft"
            >
              {orderConflict && <Alert data-testid="inventory-external-change" variant={orderConflict === "deleted" ? "destructive" : "default"}>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{orderConflict === "deleted" ? "Order draft is no longer available" : "Order draft changed elsewhere"}</AlertTitle>
                <AlertDescription className="space-y-2">
                  <span>{orderConflict === "deleted"
                    ? "This draft was removed or is no longer editable. Your local entries are retained; they will not be submitted."
                    : "Another operator changed this draft. Your exact local entries are retained, and saving is paused until you review the current server draft."}</span>
                  {orderConflict === "changed" && <Button type="button" size="sm" variant="outline" onClick={reloadOrderDraftFromServer}>Reload current draft</Button>}
                </AlertDescription>
              </Alert>}
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
          </InventoryEditorSurface>}
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
            const unreleaseUpdate = unreleaseStatus[order.id];
            return <article key={order.id} data-testid="inventory-order-card" data-order-id={order.id} className="min-w-0 rounded-md border bg-card px-3 py-2.5">
              <div className="flex min-w-0 flex-col justify-between gap-2 lg:flex-row lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 font-medium"><span className="font-mono">{orderLabel(order)}</span><Badge variant={order.status === "completed" ? "default" : "outline"}>{order.status}</Badge><Badge variant="secondary">{order.type}</Badge>{order.replacementFor && <Badge variant="outline">replacement for {orderTitle(order.replacementFor)}</Badge>}{archived && <Badge variant="secondary">cleared</Badge>}</div>
                  <p className="mt-1 truncate text-xs text-muted-foreground md:whitespace-normal md:break-words md:text-sm">{purchase ? vendors.find(v => v.id === order.vendorId)?.name : warehouses.find(w => w.id === order.sourceId)?.name} → {warehouses.find(w => w.id === order.destinationId)?.name}{orderReference(order) ? ` · Ref ${orderReference(order)}` : ""}</p>
                  <p className="text-xs text-muted-foreground">{order.lines.length} {order.lines.length === 1 ? "item" : "items"} · created {new Date(order.createdAt).toLocaleDateString(undefined, { timeZone: timezone })}</p>
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 max-md:[&>button]:h-7 max-md:[&>button]:min-h-7 max-md:[&>button]:px-2 max-md:[&>button]:text-xs">
                  <Button size="sm" variant="outline" onClick={() => openPrint("order", order.id)}><Printer className="mr-1 h-3.5 w-3.5" />Print</Button>
                  {order.status === "draft" && can(purchase ? "inventory.purchase" : "inventory.transfer") && <><Button size="sm" variant="outline" disabled={!!unreleaseUpdate?.pending || !!unreleaseUpdate?.needsCheck} onClick={() => editOrderDraft(order)}>Edit draft</Button><Button size="sm" disabled={command.isPending || !!unreleaseUpdate?.pending || !!unreleaseUpdate?.needsCheck} onClick={() => command.mutate({ action: "release", data: { orderId: order.id } })}>Release</Button></>}
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
                  {order.status === "released" && !archived && can(purchase ? "inventory.purchase" : "inventory.transfer") && <Button size="sm" variant="outline" disabled={command.isPending || !!unreleaseUpdate?.pending || !!unreleaseUpdate?.needsCheck || isUnreleaseLocked(order)} onClick={() => requestOrderTransition(() => runOrderCommand("unrelease", order))}>
                    {unreleaseUpdate?.pending ? <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />{unreleaseUpdate.message.startsWith("Checking") ? "Checking…" : "Un-releasing…"}</> : "Un-release to draft"}
                  </Button>}
                  {purchase && order.status === "cancelled" && !archived && can("inventory.purchase") && <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => requestOrderTransition(() => setOrderToClear(order))}>Clear</Button>}
                  {purchase && order.status === "cancelled" && archived && can("inventory.purchase") && <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => requestOrderTransition(() => runOrderCommand("restoreOrder", order))}>Restore</Button>}
                </div>
              </div>
              {unreleaseUpdate && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm" role={unreleaseUpdate.needsCheck ? "alert" : "status"} aria-live="polite">
                <span className="min-w-0 flex-1 break-words">{unreleaseUpdate.message}</span>
                {unreleaseUpdate.needsCheck && <Button type="button" size="sm" variant="outline" className="min-h-10" disabled={unreleaseUpdate.pending || command.isPending}
                  onClick={() => requestOrderTransition(() => void checkUnreleaseStatus(order))} aria-label={`Check authoritative status for ${orderLabel(order)}`}>
                  <RefreshCw className={`mr-1.5 h-4 w-4 ${unreleaseUpdate.pending ? "animate-spin" : ""}`} />
                  {unreleaseUpdate.pending ? "Checking status…" : "Check status"}
                </Button>}
              </div>}
              <details className="mt-2 border-t pt-1.5 text-xs">
                <summary className="w-fit cursor-pointer text-muted-foreground">Order details · lines and progress</summary>
                <div className="mt-2 space-y-1.5">
                  <p className="break-words md:hidden">{purchase ? vendors.find(v => v.id === order.vendorId)?.name : warehouses.find(w => w.id === order.sourceId)?.name} → {warehouses.find(w => w.id === order.destinationId)?.name}{orderReference(order) ? ` · Ref ${orderReference(order)}` : ""}</p>
                  <div className="flex flex-wrap items-center gap-2 text-muted-foreground"><Button size="sm" variant="ghost" onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(order.id);
                      toast({ title: "Internal ID copied", description: "The order's internal tracking ID was copied to your clipboard." });
                    } catch {
                      toast({ title: "Copy unavailable", description: "Allow clipboard access in your browser and try again.", variant: "destructive" });
                    }
                  }}>Copy internal ID</Button></div>
                  {unreleaseLocked && <p className="text-muted-foreground" role="note">{(state.shipmentDrafts ?? []).some(draft => draft.orderId === order.id) ? "Resume or discard the saved shipment capture before un-releasing this order. A capture owned by another operator may not be visible here; ask its owner to reconcile it." : "This order has posted shipment activity and cannot return to draft. Dispatches and receipts must remain attached to the order."}</p>}
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
                  {order.closure && <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">Closed by {order.closure.actor} · {inventoryDateTime(order.closure.occurredAt, timezone)} · {order.closure.reason}</p>}
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
      </TabsContent>}
      {capabilities.tabs.exceptions && <TabsContent value="exceptions" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryShipmentExceptions state={state} items={items} orders={orderItems} canResolve={can("inventory.resolveExceptions")}
          onDirtyChange={setMovementDirty}
          busy={command.isPending} onPrintOrder={id => openPrint("order", id)} onPrintReceipt={id => openPrint("receipt", id)}
          onResolve={payload => postWithStableIdentity("resolveHold", payload)} projectName={data.projectName} timezone={timezone}
          actors={data.actors ?? []} users={data.users} onRefresh={() => void refetch()} />
      </TabsContent>}

      {capabilities.tabs.counts && <TabsContent value="counts" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <Dialog open={countStartOpen} onOpenChange={open => { if (!command.isPending) setCountStartOpen(open); }}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" onEscapeKeyDown={event => { if (command.isPending) event.preventDefault(); }} onPointerDownOutside={event => { if (command.isPending) event.preventDefault(); }}>
            <DialogHeader><DialogTitle>Start cycle count</DialogTitle><DialogDescription>Choose a location and counting scope. Stock changes only after the count is reviewed and posted.</DialogDescription></DialogHeader>
            <div className="space-y-2"><Label htmlFor="count-start-location">Warehouse or vehicle</Label>
              <Select value={countWarehouse} disabled={command.isPending} onValueChange={setCountWarehouse}><SelectTrigger id="count-start-location"><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{activeWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>)}</SelectContent></Select>
            </div>
            <fieldset className="space-y-2" data-testid="inventory-count-scope-options">
              <legend className="text-sm font-medium">Counting scope</legend>
              <div className="grid gap-2">
                <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${countStartScope === "selected" ? "border-primary bg-primary/5" : "bg-background"}`}>
                  <input type="radio" name="count-scope" value="selected" checked={countStartScope === "selected"} disabled={command.isPending}
                    onChange={() => setCountStartScope("selected")} aria-label="Selected items only" data-testid="count-scope-selected" className="mt-1 accent-primary" />
                  <span><span className="block text-sm font-medium">Selected items only</span><span className="mt-0.5 block text-xs text-muted-foreground">Start empty and select products on the count page by searching or scanning.</span></span>
                </label>
                <label className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${countStartScope === "warehouse" ? "border-primary bg-primary/5" : "bg-background"}`}>
                  <input type="radio" name="count-scope" value="warehouse" checked={countStartScope === "warehouse"} disabled={command.isPending}
                    onChange={() => setCountStartScope("warehouse")} aria-label="Full warehouse" data-testid="count-scope-warehouse" className="mt-1 accent-primary" />
                  <span><span className="block text-sm font-medium">Full warehouse</span><span className="mt-0.5 block text-xs text-muted-foreground">Include every product in the location snapshot, including zero-stock items.</span></span>
                </label>
              </div>
            </fieldset>
            <DialogFooter><Button variant="outline" disabled={command.isPending} onClick={() => setCountStartOpen(false)}>Cancel</Button>
              {can("inventory.count") && <Button onClick={startCount} disabled={!countWarehouse || command.isPending}>{command.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Start count</Button>}
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <InventoryRecordsWorkspace kind="counts" title="Cycle counts"
          description="Review physical count snapshots, continue open drafts, and retain posted or cancelled counts as audit history."
          dataset={countsDataset} projectName={data.projectName} timezone={timezone} onRefresh={() => void refetch()}
          persistentHeaderAction={can("inventory.count") ? <CountRecoveryInbox records={countRecovery.records} counts={state.counts} timezone={timezone}
            onOpen={count => requestCountTransition(() => openCount(count, true))} onDiscard={countRecovery.discardRecord} /> : null}
          headerAction={can("inventory.count") ? <Button size="sm" className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" aria-label="Start count" title="Start count" onClick={() => setCountStartOpen(true)} disabled={command.isPending}><Plus className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Start count</span></Button> : null}
          renderRow={row => {
            const count = state.counts.find(value => value.id === row.id);
            if (!count) return null;
            const location = warehouses.find(value => value.id === count.warehouseId)?.name ?? "Location unavailable";
            return <article className="flex min-w-0 flex-col justify-between gap-3 rounded-md border bg-card px-3 py-3 sm:flex-row sm:items-center sm:px-4" data-testid="inventory-count-record" data-count-record data-count-id={count.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5"><span className="font-mono font-medium">{inventoryCountReference(state.counts, count.id)}</span>
                  <Badge variant={count.status === "open" ? "outline" : count.status === "posted" ? "default" : "secondary"}>{count.status}</Badge>
                </div>
                <p className="mt-1 text-sm">{location}</p>
                <p className="text-xs text-muted-foreground">
                  {count.scope === "selected" ? "Selected-item count" : "Full warehouse count"} ·
                  {" "}warehouse baseline {count.snapshot.length} products · {count.snapshot.reduce((total, line) => total + line.quantity, 0)} units
                  {" "}· {count.status === "posted" ? `${count.lines?.length ?? 0} posted entries` : `${count.draft?.rows.length ?? count.lines?.length ?? 0} count entries`}
                  {count.reason && ` · ${count.reason}`}
                </p>
                {countRecovery.records.some(record => record.countId === count.id) && can("inventory.count") &&
                  <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">Unsaved entries available in Local recovery</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {count.status === "open" && <>
                  <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => {
                    if (activeCount?.id !== count.id) requestCountTransition(() => openCount(count, true));
                  }}>Continue count</Button>
                  {can("inventory.count") && <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => cancelCount(count)}>Cancel count</Button>}
                </>}
                {count.status === "posted" && <Button size="sm" variant="ghost" onClick={() => openPrint("count", count.id)}><Printer className="mr-1.5 h-4 w-4" />Print</Button>}
              </div>
            </article>;
          }} />
        {activeCount && <InventoryEditorSurface
          inline
          compact
          portalHost={editorHostRef.current}
          testId="inventory-count-editor"
          title={`${activeCount.scope === "selected" ? "Selected-item count" : "Full warehouse count"} · ${inventoryCountReference(state.counts, activeCount.id)} · ${warehouses.find(w => w.id === activeCount.warehouseId)?.name ?? "Location unavailable"}`}
          description={activeCount.scope === "selected"
            ? "Choose only products you physically check. The full warehouse snapshot stays fixed as the comparison baseline; blank quantities must be entered before posting."
            : "Verify every product in the warehouse snapshot, including zero. All entry pages save and post together; saving a draft does not adjust stock."}
          onBack={() => requestCountTransition(closeCount)}
          onSave={() => saveCountDraft()}
          saving={countSaving.current || command.isPending}
          saveDisabled={!!countRecovery.pending || !!countConflict || !can("inventory.count")}
          saveLabel="Save draft"
          stickyFooter
          actions={<div className="col-span-2 flex min-w-0 justify-end sm:col-span-1">
            <span role="status" className="truncate text-xs text-muted-foreground">{countDraftMessage || (countDirty ? "Unsaved count entries" : "Draft is current")}</span>
          </div>}
          footer={<>
            <Button size="sm" variant="outline" onClick={() => saveCountDraft()} disabled={!!countRecovery.pending || !can("inventory.count") || !!countConflict || command.isPending}>Save draft</Button>
            <Button size="sm" variant="outline" onClick={() => requestCountTransition(reloadCountDraft)} disabled={!!countRecovery.pending || !can("inventory.count") || command.isPending || countConflict === "unavailable"}>Reload saved draft</Button>
            <Button size="sm" onClick={postCount} disabled={!!countRecovery.pending || !can("inventory.count") || !!countConflict || countStockDrift || !countReason.trim() || countRows.length === 0 || command.isPending}>Post count</Button>
          </>}
        >
          <>
            <div className="sticky top-0 z-10 flex flex-col gap-2 bg-background pb-1 sm:flex-row sm:items-center">
            <Button type="button" variant="outline" className="h-10 w-full justify-between gap-3 bg-background sm:w-auto sm:shrink-0"
              aria-expanded={countToolsOpen} aria-controls={countToolsOpen ? "count-search-tools" : undefined}
              onClick={() => setCountToolsOpen(open => !open)}>
              <span>{countToolsOpen ? "Hide Search & Tools" : "Show Search & Tools"}</span>
              {countToolsOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
            </Button>
            <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded border bg-background/95 px-2 py-1"
              data-testid="inventory-count-pagination" aria-label="Count entry pages">
              <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">
                {matchingCountRows.length ? `${currentCountPage * countPageSize + 1}–${Math.min(matchingCountRows.length, (currentCountPage + 1) * countPageSize)} of ${matchingCountRows.length}` : "0 entries"}
              </span>
              <Button size="sm" variant="outline" aria-label="Previous count entries page" disabled={currentCountPage === 0 || command.isPending}
                onClick={() => setCountPage(currentCountPage - 1)}>Previous</Button>
              <span className="min-w-24 text-center text-xs tabular-nums">Page {currentCountPage + 1} / {lastCountPage + 1}</span>
              <Button size="sm" variant="outline" aria-label="Next count entries page" disabled={currentCountPage === lastCountPage || command.isPending}
                onClick={() => setCountPage(currentCountPage + 1)}>Next</Button>
            </nav>
            </div>
            {!countToolsOpen && countSearch.trim() && <span className="mb-3 block truncate text-xs text-muted-foreground" role="status" title={`Entry filter: ${countSearch}`}>
              Entry filter active: “{countSearch}” · {matchingCountRows.length} matching
            </span>}
            {countRecovery.error && <Alert variant="destructive"><AlertTitle>Local recovery unavailable</AlertTitle><AlertDescription>{countRecovery.error}</AlertDescription></Alert>}
            {countRecovery.pending && <CountRecoveryNotice record={countRecovery.pending} count={state.counts.find(count => count.id === activeCount.id) ?? activeCount} timezone={timezone}
              disabled={command.isPending || !can("inventory.count")}
              onDiscard={countRecovery.discardRecovery}
              onRestore={() => {
                const recovered = countRecovery.restore();
                if (!recovered) return;
                setCountQuantities(Object.fromEntries(recovered.rows.map(row => [row.itemId, row.quantity])));
                setCountSerials(Object.fromEntries(recovered.rows.map(row => [row.itemId, row.serials])));
                setCountReason(recovered.reason);
                setCountDraftRevision(recovered.revision);
                // Review the captured rows, not a hybrid with a newer saved
                // selected-item draft. The old revision still blocks writes.
                setActiveCount(current => current ? { ...current, draft: current.draft
                  ? { ...current.draft, rows: recovered.rows } : undefined } : null);
                setCountPage(0);
                setCountDraftMessage("Local entries restored for review. Save the draft to keep them on the server. Stock has not changed.");
              }} />}
            {countToolsOpen && <div id="count-search-tools" className="mb-3 grid grid-cols-1 gap-3 rounded border bg-background p-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
                <div className="sm:col-span-2"><CountProductScanner id="count-product-scanner" items={items} existingIds={[...countRowIds]}
                  value={countSearch} onValueChange={value => { setCountSearch(value); setCountProduct(""); setCountPage(0); }}
                  onAdd={addCountProduct} disabled={command.isPending || !can("inventory.count") || !!countRecovery.pending} /></div>
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:col-span-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0 space-y-2">
                    <Label htmlFor="count-discovery-product">Discovery product</Label>
                    <Select value={countProduct} onValueChange={setCountProduct} disabled={command.isPending || !can("inventory.count")}><SelectTrigger id="count-discovery-product"><SelectValue placeholder="Choose a product found in this warehouse" /></SelectTrigger><SelectContent>{discoveryProducts.map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select>
                  </div>
                  <Button className="w-full self-end sm:w-fit" variant="outline" onClick={() => addCountProduct()} disabled={!!countRecovery.pending || !can("inventory.count") || !countProduct || command.isPending || countRows.length >= COUNT_MAX_LINES}>Add discovery to count</Button>
                  <p className="text-xs text-muted-foreground sm:col-span-2">Up to 100 products not yet in this count are shown. Hidden count entries are still saved and posted. Adding a product leaves its actual quantity and serials blank.</p>
                </div>
                <div className="flex min-w-0 flex-wrap items-end gap-2 border-t pt-3 sm:col-span-2" data-testid="inventory-count-exports">
                  <div className="min-w-40 flex-1 space-y-1">
                    <Label htmlFor="count-export-scope">Export entries</Label>
                    <select id="count-export-scope" aria-label="Export entry scope" data-testid="count-export-scope"
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={countExportScope} onChange={event => setCountExportScope(event.target.value as "all" | "filtered" | "page")}>
                      <option value="all">All entries</option>
                      <option value="filtered">Filtered entries ({matchingCountRows.length})</option>
                      <option value="page">Current page ({visibleCountRows.length})</option>
                    </select>
                  </div>
                  <Button type="button" variant="outline" size="sm" aria-label="Export count as CSV" data-testid="count-export-csv"
                    disabled={!countExportRows.length} onClick={() => void exportCount("csv")}><Download className="mr-1.5 h-4 w-4" />CSV</Button>
                  <Button type="button" variant="outline" size="sm" aria-label="Export count as Excel" data-testid="count-export-xlsx"
                    disabled={!countExportRows.length} onClick={() => void exportCount("xlsx")}><FileSpreadsheet className="mr-1.5 h-4 w-4" />Excel</Button>
                  <Button type="button" variant="outline" size="sm" aria-label="Export count as PDF or print" data-testid="count-export-pdf"
                    disabled={!countExportRows.length} onClick={() => void exportCount("pdf")}><FileText className="mr-1.5 h-4 w-4" />PDF / Print</Button>
                  <span className="sr-only" role="status" aria-live="polite">{countExportRows.length} entries selected for export. Unsaved edits are included without saving them.</span>
                </div>
              </div>}
            <div className="space-y-3">
            {countConflict && <Alert data-testid="inventory-external-change" variant={countConflict === "unavailable" ? "destructive" : "default"}>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{countConflict === "unavailable" ? "Count is no longer open" : "Saved count draft changed elsewhere"}</AlertTitle>
              <AlertDescription>{countConflict === "unavailable"
                ? "Your entries remain on this page, but this count cannot be saved or posted in its current state."
                : "Your exact quantities and scans are retained. Saving and posting are paused until you reload the current saved draft."}</AlertDescription>
            </Alert>}
            {countStockDrift && <Alert data-testid="inventory-count-stock-drift">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warehouse stock changed since this count started</AlertTitle>
              <AlertDescription>Save this draft if you want to keep it for reference, then close or cancel and start a new count. Posting is disabled.</AlertDescription>
            </Alert>}
            <p className="text-xs text-muted-foreground [@media(max-height:600px)]:hidden" title={`Limit ${COUNT_MAX_LINES}. All pages are saved and posted together.`}>{countRows.length} count entries · {matchingCountRows.length} matching<span className="hidden lg:inline"> · All pages are saved and posted together.</span></p>
            <div ref={countEntriesRef} className="space-y-2" data-testid="inventory-count-entry-list" data-page-size={countPageSize}>
            {visibleCountRows.map(row => {
              const { itemId: id, item } = row;
              if (!item) return <Alert key={id} data-count-entry variant="destructive"><AlertTitle>Count item unavailable</AlertTitle><AlertDescription>Item {id} is no longer in the catalog. Resolve it before posting; it will not be silently omitted.</AlertDescription></Alert>;
              const old = activeCount.snapshot.find(row => row.itemId === id);
              const currentStock = countStockByItem.get(id);
              return <div key={id} data-count-entry className="grid min-w-0 gap-2 rounded border bg-background p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,260px)] sm:items-end sm:p-3">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-medium">{item.name}</div><div className="font-mono text-xs text-muted-foreground">{item.sku} · at count start {old?.quantity ?? 0}</div></div>
                  {item.tracking === "serialized" && <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="relative h-11 w-11 shrink-0"
                    aria-label={`Scan serials for ${item.name}`}
                    title={`Scan serials for ${item.name}`}
                    disabled={!!countRecovery.pending || command.isPending || !can("inventory.count")}
                    onClick={() => setCountSerialDialog({ itemId: id, countId: activeCount.id })}
                  >
                    <ListOrdered className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">{row.serials.split(/[\n,;]/).filter(value => value.trim()).length} serials entered</span>
                  </Button>}
                </div>
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  <div className="min-w-0 space-y-1"><span id={`expected-count-label-${id}`} className="text-sm font-medium">Expected quantity</span><output id={`expected-count-${id}`} aria-labelledby={`expected-count-label-${id}`} className="block min-w-0 py-2 text-sm tabular-nums">{currentStock?.quantity ?? 0}</output></div>
                  <div className="min-w-0 space-y-1"><Label htmlFor={`count-${id}`}>Actual quantity</Label><Input id={`count-${id}`} type="number" min="0" max="1000000" step="1" value={row.quantity} disabled={!!countRecovery.pending || command.isPending || !can("inventory.count")} onChange={event => setCountQuantities(current => ({ ...current, [id]: event.target.value }))} /></div>
                </div>
                {item.tracking === "serialized" && <span className="text-xs text-muted-foreground sm:col-span-2">
                  {row.serials.split(/[\n,;]/).filter(value => value.trim()).length} serials entered
                </span>}
                {item.tracking === "serialized" && countSerialDialog?.itemId === id && countSerialDialog.countId === activeCount.id && <CountSerialsDialog
                  item={item}
                  actualQuantity={row.quantity}
                  blockedSerials={Object.entries(countSerials).filter(([otherId]) => otherId !== id).flatMap(([, text]) => serialTokens(text))}
                  serials={row.serials}
                  open
                  disabled={command.isPending || !can("inventory.count")}
                  onOpenChange={open => { if (!open) setCountSerialDialog(null); }}
                  onSerialsChange={value => setCountSerials(current => ({ ...current, [id]: value }))}
                />}
              </div>;
            })}
            {countRows.length === 0 && <p data-count-entry className="rounded-md border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">{activeCount.scope === "selected" ? "No products selected yet. Expand Search & Tools and add only the products you physically checked." : "There are no products in this warehouse snapshot. Add any discovered products that need to be counted."}</p>}
            </div>
            <div ref={countReserveRef} className="space-y-2">
              <div className="space-y-1"><Label htmlFor="count-reason">Count adjustment reason</Label><Input id="count-reason" maxLength={1000} disabled={!!countRecovery.pending || command.isPending || !can("inventory.count")} value={countReason} onChange={event => setCountReason(event.target.value)} placeholder="Required audit note" /></div>
              {countDirty && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Unsaved count changes. Save the draft to keep your entries.</p>}
            </div>
            </div>
          </>
        </InventoryEditorSurface>}
      </TabsContent>}
      {capabilities.tabs.returns && <TabsContent value="returns" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        {Object.entries(returnInspect).filter(([id, draft]) => {
          const current = state.returns.find(value => value.id === id);
          const selectedItem = items.find(value => value.id === draft.itemId && value.active);
          return !current || current.status !== "quarantine" || (!!draft.itemId && !selectedItem);
        }).map(([id, draft]) => {
          const current = state.returns.find(value => value.id === id);
          const selectedItem = items.find(value => value.id === draft.itemId && value.active);
          return <Alert key={id} data-testid="inventory-external-change" variant={!current ? "destructive" : "default"}>
            <AlertTriangle className="h-4 w-4" /><AlertTitle>{!current ? "Removed equipment record is unavailable" : current.status !== "quarantine" ? "Equipment custody changed" : "Selected catalog item is unavailable"}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center gap-2">
              <span>{!current
                ? `Your inspection note “${draft.reason || "No note entered"}” and selected item ${draft.itemId || "none"} remain in this tab, but return ${id} is no longer present.`
                : current.status !== "quarantine"
                  ? `Return ${current.serial} is now ${current.status}; the retained inspection note will not be applied to its new custody state.`
                  : `The selected match ${draft.itemId} is no longer active equipment.`}</span>
              {selectedItem && <span>{selectedItem.sku} · {selectedItem.name}</span>}
              <Button type="button" size="sm" variant="outline" onClick={() => {
                if (!window.confirm("Discard this retained inspection note and selected item?")) return;
                setReturnInspect(value => { const next = { ...value }; delete next[id]; return next; });
              }}>Discard retained inspection</Button>
            </AlertDescription>
          </Alert>;
        })}
        <InventoryRecordsWorkspace kind="returns" title="Removed Equipment" description="Returned systems and modules enter quarantine first. Release to usable inventory only after inspection." dataset={returnsDataset} projectName={data.projectName} timezone={timezone} onRefresh={() => void refetch()}
          headerAction={<div className="flex flex-wrap gap-2">
            {can("inventory.resolveReturns") && <Button size="sm" variant="outline" onClick={() => setCustomerHandoffIds([])}>Customer handoffs</Button>}
            {can("inventory.manageRemovalRules") && <RemovalRulesManager state={state} authorized={can("inventory.manageRemovalRules")} post={(action, payload, operationId) => command.mutateAsync({ action, data: payload, operationId })} />}</div>}
          renderRow={row => { const returned = state.returns.find(value => value.id === row.id); if (!returned) return null;
            return <article className="flex min-w-0 flex-col justify-between gap-3 rounded-md border bg-card px-3 py-3 sm:flex-row sm:items-start sm:px-4">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-medium"><span>{returned.equipment === "system" ? "System" : "Module"}</span><span className="break-all font-mono text-sm">{returned.serial}</span><Badge variant={returned.status === "released" ? "default" : "outline"}>{row.cells.status}</Badge></div>
                <div className="mt-1 text-sm text-muted-foreground">Work order #{row.cells.workOrder} · Return location: {warehouses.find(w => w.id === returned.warehouseId)?.name ?? "Location unavailable"}</div>
                <div className="mt-1 text-xs text-muted-foreground">Field disposition: {row.cells.fieldDisposition}</div>
                <div className="mt-1 text-xs text-muted-foreground">Warehouse decision: {row.cells.warehouseDisposition}</div>
                {returned.customerHandoffAt && <div className="mt-1 text-xs text-muted-foreground">
                  Customer recipient: {row.cells.customerRecipient} · {row.cells.customerHandoffAt}
                  {!!row.cells.customerReference && <> · Reference: {row.cells.customerReference}</>}
                </div>}
              </div><div className="flex min-w-0 flex-col gap-3">
              <Button size="sm" variant="outline" className="self-start" onClick={() => openPrint("return", returned.id)} aria-label={`Print removed equipment ${returned.serial}`}><Printer className="mr-2 h-4 w-4" />Print</Button>
              {returned.customerHandoffId && <Button size="sm" variant="outline" onClick={() => openPrint("customer-handoff", returned.customerHandoffId!)}>Print customer manifest</Button>}
              <RemovedEquipmentActions record={returned} state={state} canReceive={can("inventory.receive")} canDecide={can("inventory.resolveReturns")} onHandoff={() => setCustomerHandoffIds([returned.id])}
                actorLabel={id => inventoryActorLabel(id, data.actors ?? data.users)}
                timezone={timezone}
                draft={returnInspect[returned.id]} onDraft={draft => setReturnInspect(current => { const next = { ...current }; if (draft) next[returned.id] = draft; else delete next[returned.id]; return next; })}
                post={(action, payload, operationId) => command.mutateAsync({ action, data: payload, operationId })} /></div></article>;
          }} />
      </TabsContent>}
      {capabilities.tabs.activity && <TabsContent value="activity" data-testid="inventory-activity-entries" className="data-[state=inactive]:hidden data-[state=active]:flex min-h-0 flex-1 flex-col overflow-hidden">
        <InventoryRecordsWorkspace kind="activity" title="Stock movement ledger" description="Related transactions appear once. Expand or print the complete history, including batch operations. Filters match individual transactions; each matching summary retains its full history." dataset={activityDataset} projectName={data.projectName} timezone={timezone} onRefresh={() => void refetch()}
          renderRow={row => { const group = activityGroupById.get(row.id); return group ?
            <InventoryActivityEntry group={group} row={row} state={state} receiptSummary={receiptSummary} print={openPrint} /> : null; }} />
      </TabsContent>}
    </div>
    </Tabs>
    </div>
    {can("inventory.resolveReturns") && <CustomerHandoffDialog open={customerHandoffIds !== null} onClose={() => setCustomerHandoffIds(null)}
      initialIds={customerHandoffIds ?? []} state={state} timezone={timezone} workOrderLabels={data.workOrderLabels ?? {}}
      post={(payload, operationId) => command.mutateAsync({ action: "returnCustomerBatch", data: payload, operationId })}
      print={id => openPrint("customer-handoff", id)} />}
    {kitDialogMode && (kitDialogMode === "inspect" ? can("inventory.resolveExceptions") : can("inventory.assemble")) && <InventoryKitDialog key={kitDialogMode} state={state} projectId={projectId} mode={kitDialogMode}
      canResolve={can("inventory.resolveExceptions")} onDirtyChange={setKitDirty} onOperationPending={setKitOperationPending}
      onClose={() => { setKitDialogMode(null); setKitDirty(false); setKitOperationPending(false); }}
      onSaved={async () => { await queryClient.invalidateQueries({ queryKey }); return refetch(); }} />}
    {vendorKitOpen && state && can("inventory.receive") && <InventoryVendorKitDialog key="vendor-kit" state={state} projectId={projectId}
      onDirtyChange={setKitDirty} onOperationPending={setKitOperationPending}
      onClose={() => { setVendorKitOpen(false); setKitDirty(false); setKitOperationPending(false); }}
      onSaved={async () => { await queryClient.invalidateQueries({ queryKey }); return refetch(); }} />}
    {selectedStockRow && can("inventory.view") && (
      <InventoryStockSerialDialog
        key={`${selectedStockRow.itemId}/${selectedStockRow.warehouseId}`}
        open
        onOpenChange={open => { if (!open) setSelectedStockRow(null); }}
        itemName={selectedStockRow.item?.name ?? ""}
        sku={selectedStockRow.item?.sku ?? ""}
        locationName={selectedStockRow.warehouse?.name ?? ""}
        locationCode={selectedStockRow.warehouse?.code ?? ""}
        project={data.projectName}
        serials={selectedStockRow.serials}
        base={base}
        itemId={selectedStockRow.itemId}
        warehouseId={selectedStockRow.warehouseId}
      />
    )}

    {resource && can("inventory.maintain") && <InventoryEditorSurface
      inline={resource !== "vendor"}
      portalHost={editorHostRef.current}
      open={!!resource}
      title={resource === "warehouse" ? (warehouseForm.id ? "Edit location" : "Add location") : resource === "vendor" ? "Vendor details" : copiedItemName !== null ? "Copy item" : itemForm.id ? "Edit item" : "Add item"}
      description={copiedItemName !== null ? `Copy of ${copiedItemName}. Enter a unique Product ID (SKU). Barcode is cleared; stock, serials and history are not copied.` : "Changes apply only to this project. Keep scanned identities and stock rules intact."}
      onBack={() => resource === "vendor"
        ? (!resourceSaving.current && !imageBusy && setResource(null))
        : requestResourceTransition(() => {})}
      onSave={saveResource}
      saving={resourceBusy || resourceSave.isPending}
      saveDisabled={command.isPending || !!resourceConflict || !warehouseCanSave}
      saveLabel="Save changes"
      footer={resource === "vendor" ? <>
        <Button variant="outline" disabled={resourceBusy} onClick={() => setResource(null)}>Cancel</Button>
        <Button onClick={saveResource} disabled={resourceBusy || command.isPending || !!resourceConflict || !warehouseCanSave}>
          {resourceSave.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {resourceSave.isPending ? "Saving..." : "Save changes"}
        </Button>
      </> : undefined}
    >
      {resourceConflict && <Alert data-testid="inventory-external-change" variant={resourceConflict === "deleted" ? "destructive" : "default"}>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>{resourceConflict === "deleted" ? "Record is no longer available" : "Record changed elsewhere"}</AlertTitle>
        <AlertDescription className="space-y-2">
          <span>{resourceConflict === "deleted"
            ? "The original record was removed. Your entered values are retained, but this edit cannot be saved against the missing record."
            : "Your exact edits are retained. Saving is paused until you explicitly reload the current record."}</span>
          {resourceConflict === "changed" && <Button type="button" size="sm" variant="outline" onClick={reloadResourceFromServer}>Reload current record</Button>}
        </AlertDescription>
      </Alert>}
      {resourceError && <Alert ref={resourceErrorRef} tabIndex={-1} id="inventory-resource-error" role="alert" variant="destructive"><AlertTitle>Details not saved</AlertTitle><AlertDescription>{resourceError} Your entered values have been kept. Correct the details and retry, or cancel to discard them.</AlertDescription></Alert>}
      <fieldset disabled={resourceBusy} aria-describedby={resourceError ? "inventory-resource-error" : undefined} className="contents">
      {resource === "warehouse" && <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Code" value={warehouseForm.code} set={value => setWarehouseForm(form => ({ ...form, code: value }))} /><Field label="Name" value={warehouseForm.name} set={value => setWarehouseForm(form => ({ ...form, name: value }))} />
        <div className="space-y-1"><Label htmlFor="warehouse-location-type">Location type</Label>
          <Select value={warehouseForm.locationTypeId ?? ""} disabled={!canManageLocationTypes} onValueChange={value => {
            const selected = state.locationTypes?.find(type => type.id === value);
            if (!selected) return;
            setWarehouseForm(form => ({ ...form, locationTypeId: selected.id, type: selected.kind }));
            setSelectedLocationTypeBasis({ id: selected.id, revision: selected.revision });
          }}><SelectTrigger id="warehouse-location-type"><SelectValue placeholder="Choose a location type" /></SelectTrigger><SelectContent>{(state.locationTypes ?? []).map(type => <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>)}</SelectContent></Select>
          {!canManageLocationTypes && <p className="text-xs text-muted-foreground">Only location-type managers can change the type.</p>}
          {warehouseEditorType && selectedLocationTypeBasis?.id === warehouseEditorType.id && selectedLocationTypeBasis.revision !== warehouseEditorType.revision && <Alert variant="destructive">
            <AlertTitle>Selected location type changed</AlertTitle><AlertDescription>Your entered details are retained. The current type uses {warehouseEditorType.kind} details and {warehouseEditorType.accessPolicy === "shared" ? "shared project access" : "assigned-user access"}.</AlertDescription>
            <Button className="mt-2" size="sm" variant="outline" onClick={() => {
              setSelectedLocationTypeBasis({ id: warehouseEditorType.id, revision: warehouseEditorType.revision });
              setWarehouseForm(form => ({ ...form, type: warehouseEditorType.kind }));
              const baseline = resourceBaseline.current;
              const original = state.warehouses.find(warehouse => warehouse.id === baseline?.id);
              if (baseline && original) baseline.locationContext = locationContextSignature(original);
              setResourceError(null);
              setResourceConflict(null);
            }}>Review updated type and retain entries</Button>
          </Alert>}
        </div>
        <Field label="Contact" value={warehouseForm.contact} set={value => setWarehouseForm(form => ({ ...form, contact: value }))} /><Field label="Phone" value={warehouseForm.phone} set={value => setWarehouseForm(form => ({ ...form, phone: value }))} />
        {warehouseEditorType?.kind === "physical" ? <><Field label="Street address" required value={warehouseForm.address} set={value => setWarehouseForm(form => ({ ...form, address: value }))} /><Field label="City" value={warehouseForm.city} set={value => setWarehouseForm(form => ({ ...form, city: value }))} /><Field label="State" value={warehouseForm.state} set={value => setWarehouseForm(form => ({ ...form, state: value }))} /><Field label="ZIP" value={warehouseForm.zip} set={value => setWarehouseForm(form => ({ ...form, zip: value }))} /></> :
          warehouseEditorType?.kind === "vehicle" ? <><Field label="VIN" required value={warehouseForm.vin} set={value => setWarehouseForm(form => ({ ...form, vin: value }))} help="Enter the 17-character vehicle identification number." /><Field label="Plate" required value={warehouseForm.plate} set={value => setWarehouseForm(form => ({ ...form, plate: value }))} /><Field label="Plate jurisdiction" required value={warehouseForm.plateState} set={value => setWarehouseForm(form => ({ ...form, plateState: value }))} /><Field label="Make" value={warehouseForm.make} set={value => setWarehouseForm(form => ({ ...form, make: value }))} /><Field label="Model" value={warehouseForm.model} set={value => setWarehouseForm(form => ({ ...form, model: value }))} /><Field label="Year" type="number" value={String(warehouseForm.year ?? "")} set={value => setWarehouseForm(form => ({ ...form, year: value ? Number(value) : null }))} /></> :
            <><Field label="Location notes" value={warehouseForm.location} set={value => setWarehouseForm(form => ({ ...form, location: value }))} className="sm:col-span-2" /><Field label="City" value={warehouseForm.city} set={value => setWarehouseForm(form => ({ ...form, city: value }))} /><Field label="State / region" value={warehouseForm.state} set={value => setWarehouseForm(form => ({ ...form, state: value }))} /></>}
        {warehouseEditorType?.accessPolicy === "assigned" && <>
          {canManageLocationTypes ? <>
            <div className="space-y-1"><Label>Primary assigned user</Label><Select value={warehouseForm.assignedUserId ?? "none"} onValueChange={value => setWarehouseForm(form => ({ ...form, assignedUserId: value === "none" ? null : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{data.users.map(user => <SelectItem key={user.id} value={user.id}>{user.username}</SelectItem>)}</SelectContent></Select></div>
            <div className="sm:col-span-2"><Label>Additional users with access</Label><div className="mt-2 grid gap-2 sm:grid-cols-2">{data.users.map(user => <label key={user.id} className="flex min-h-10 items-center gap-2 text-sm"><Checkbox checked={warehouseForm.userIds.includes(user.id)} onCheckedChange={checked => setWarehouseForm(form => ({ ...form, userIds: checked ? [...new Set([...form.userIds, user.id])] : form.userIds.filter(id => id !== user.id) }))} />{user.username}</label>)}</div></div>
          </> : <p className="sm:col-span-2 text-sm text-muted-foreground">Restricted access · Assigned to {warehouseForm.assignedUserId ? inventoryActorLabel(warehouseForm.assignedUserId, data.actors ?? data.users) : "no primary user"} · {warehouseForm.userIds.length} additional users. Only location-type managers can change assignments.</p>}
        </>}
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
        <InventoryItemPricing item={itemForm} onChange={setItemForm} />
        <Field label="Barcode" maxLength={500} value={itemForm.barcode} set={value => setItemForm(form => ({ ...form, barcode: value }))} help="Optional catalog barcode for identifying this product, up to 500 characters (example: 012345678905). A barcode identifies the product; it is not an individual unit's serial number." />
        <Field label="Manufacturer" maxLength={500} value={itemForm.manufacturer} set={value => setItemForm(form => ({ ...form, manufacturer: value }))} help="Optional maker name, up to 500 characters. Example: Acme Meter Works." />
        <Field label="Model" maxLength={500} value={itemForm.model} set={value => setItemForm(form => ({ ...form, model: value }))} help="Optional manufacturer's model identifier, up to 500 characters. Example: R-4100. This does not select System or Module; use Equipment for that." />
        {itemForm.kind !== "labor" && <div className="space-y-1.5"><Label htmlFor="item-tracking">Tracking</Label><Select value={itemForm.tracking} onValueChange={value => setItemForm(form => ({ ...form, tracking: value as "regular" | "serialized" }))}><SelectTrigger id="item-tracking" aria-describedby="item-tracking-help"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="regular">Quantity tracked</SelectItem><SelectItem value="serialized">Serialized — scan each unit</SelectItem></SelectContent></Select><p id="item-tracking-help" className="text-xs leading-relaxed text-muted-foreground">Default is quantity tracked for ordinary supplies: stock can be recorded as 20 seals. Choose serialized for systems and modules when each physical unit must be identified, for example serial 0000456. Changing tracking is restricted while stock or assigned records exist.</p></div>}
        {itemForm.kind !== "labor" && <div className="space-y-1.5"><Label htmlFor="item-equipment">Equipment</Label><Select value={itemForm.equipment} onValueChange={value => setItemForm(form => ({ ...form, equipment: value as "none" | "system" | "module" }))}><SelectTrigger id="item-equipment" aria-describedby="item-equipment-help"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None — not equipment</SelectItem><SelectItem value="system">System</SelectItem><SelectItem value="module">Module</SelectItem></SelectContent></Select><p id="item-equipment-help" className="text-xs leading-relaxed text-muted-foreground">Default is None for supplies and other non-equipment products. Choose System or Module when this catalog item represents that equipment type; use serialized tracking for individual units. Example: a meter body is System, an add-on radio is Module.</p></div>}
        <div className="space-y-1.5"><Label htmlFor="item-vendor">Vendor</Label><Select value={itemForm.vendorId ?? "none"} onValueChange={value => setItemForm(form => ({ ...form, vendorId: value === "none" ? null : value }))}><SelectTrigger id="item-vendor" aria-describedby="item-vendor-help"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{vendors.filter(v => v.active).map(v => <SelectItem value={v.id} key={v.id}>{v.name}</SelectItem>)}</SelectContent></Select><p id="item-vendor-help" className="text-xs leading-relaxed text-muted-foreground">Optional preferred project vendor. None is the default; choose a vendor such as North Valley Supply when relevant.</p></div>
        {itemForm.kind !== "labor" && <Field label="Reorder point" type="number" min="0" step="any" value={String(itemForm.reorderPoint)} set={value => setItemForm(form => ({ ...form, reorderPoint: Number(value) || 0 }))} help="Optional nonnegative reference threshold; defaults to 0. Example: 6 displays Reorder at 6 in the catalog. This does not automatically check stock levels, send alerts, or place orders." />}
        <div className="sm:col-span-2 space-y-1.5"><Label htmlFor="item-images">Product images</Label><p id="item-images-help" className="text-xs leading-relaxed text-muted-foreground">Optional reference photos. Upload up to 8 PNG or JPEG images, each no larger than 5 MB. Example: a label or product-view photo.</p><div className="mt-2 flex flex-wrap items-center gap-2"><Input id="item-images" aria-describedby="item-images-help" type="file" accept="image/png,image/jpeg" disabled={imageBusy || itemForm.images.length >= 8} onChange={event => { void uploadImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />{imageBusy && <Loader2 className="h-4 w-4" />}</div><div className="mt-2 flex flex-wrap gap-2">{itemForm.images.map((image, index) => <div key={image} className="relative"><img src={image} alt={`Product image ${index + 1}`} className="h-14 w-14 rounded object-cover" /><Button className="absolute -right-2 -top-2 h-6 w-6" size="icon" variant="destructive" aria-describedby="item-images-help" aria-label={`Remove product image ${index + 1}`} onClick={() => setItemForm(form => ({ ...form, images: form.images.filter(value => value !== image) }))}>×</Button></div>)}</div></div>
        <InventoryItemComponents item={itemForm} items={items} onChange={setItemForm} />
        <div className="sm:col-span-2"><label htmlFor="item-active" className="flex items-start gap-2 text-sm"><Checkbox id="item-active" checked={itemForm.active} aria-describedby="item-active-help" onCheckedChange={checked => setItemForm(form => ({ ...form, active: checked === true }))} /><span><span className="font-medium">Active product</span><span id="item-active-help" className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">New products default to active and can be used in new inventory activity. Turn off a discontinued supply to retain its catalog record without offering it for new use. Deactivation is blocked while stock, reservations, or open orders remain.</span></span></label></div>
      </div>}
      </fieldset>
    </InventoryEditorSurface>}

    {operationOrder && <InventoryShipmentSession base={base} state={sessionState ?? state} liveState={state} order={operationOrder} action={operation as ShipmentAction} items={items} draft={sessionDraft} ownerId={user?.id}
      canCloseRemainder={can("inventory.closeOrders") && !(operationOrder.type === "transfer" && operationOrder.lines.some(line => orderLineProgress(state, operationOrder, line.itemId).inTransit > 0))} busy={command.isPending}
      onDirtyChange={setMovementDirty}
      autoSavePaused={!!pendingMovementTransition} onCheckpointBusyChange={setMovementCheckpointBusy}
      onClose={() => { setOperationOrder(null); setSessionDraft(undefined); setSessionState(null); setMovementDirty(false); }} />}
    {transitOrder && <InventoryShipmentTransitDialog state={state} liveState={state} order={transitOrder} items={items} busy={command.isPending}
      onRecheck={latestOrder => setTransitOrder(latestOrder)}
      onPost={async payload => {
        const latest = await refreshShipmentInventory(base);
        const current = latest.state.orders.find(order => order.id === transitOrder.id);
        if (!current) throw new Error("This transfer is no longer available. Your quantities and scans remain in this dialog; do not retry against the old order.");
        const relevant = (order: InventoryOrder) => JSON.stringify({
          status: order.status, lines: order.lines, dispatched: order.dispatched,
          received: order.received, losses: order.losses ?? [],
        });
        if (relevant(current) !== relevant(transitOrder)) {
          throw new Error("This transfer changed elsewhere. Your exact quantities and scans remain here; close safely and reopen the current transfer before recording a loss.");
        }
        return postWithStableIdentity("resolveTransit", payload);
      }}
      onDirtyChange={setMovementDirty}
      onClose={() => setTransitOrder(null)} />}
    {command.isPending && <div className="fixed bottom-4 right-4 flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-lg"><Loader2 className="h-4 w-4 animate-spin" />Posting inventory update</div>}
    </div>
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
  items = items.filter(item => item.kind !== "labor");
  const selected = items.find(item => item.id === lineItem);
  return <div className="space-y-3 rounded-md border p-3"><div className="grid gap-2 sm:grid-cols-[1fr_110px_auto] sm:items-end"><div className="space-y-1"><Label htmlFor={draftMode ? "draft-line-item" : "operation-line-item"}>Item</Label>{draftMode
    ? <OrderItemPicker id="draft-line-item" items={items} value={lineItem} onValueChange={setLineItem} />
    : <Select value={lineItem} onValueChange={setLineItem}><SelectTrigger id="operation-line-item"><SelectValue placeholder="Select item" /></SelectTrigger><SelectContent>{items.filter(item => item.active).map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select>}</div><div className="space-y-1"><Label htmlFor={draftMode ? "draft-line-quantity" : "operation-line-quantity"}>Quantity</Label><Input id={draftMode ? "draft-line-quantity" : "operation-line-quantity"} type="number" min="1" max="1000000" step="1" value={lineQty} onChange={event => setLineQty(event.target.value)} /></div><Button type="button" variant="outline" onClick={add}><Plus className="mr-1 h-4 w-4" />Add line</Button></div>
    {!draftMode && selected?.tracking === "serialized" && <div className="space-y-1"><Label htmlFor="operation-serial-scans">Serial scans</Label><SerialScanField id="operation-serial-scans" expected={lineQty} blockedSerials={lines.flatMap(line => line.serials)} value={lineSerials ?? ""} onChange={value => setLineSerials?.(value)} placeholder="One serial per line" /></div>}
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
          {!draftMode && item?.tracking === "serialized" && <div className="mt-1 space-y-1"><Label htmlFor={`line-serial-${index}`}>Serial scans</Label><SerialScanField id={`line-serial-${index}`} expected={line.quantity} blockedSerials={lines.filter((_, other) => other !== index).flatMap(line => line.serials)} value={line.serials.join("\n")} onChange={value => updateSerials?.(index, serialTokens(value))} placeholder="One serial per line" /></div>}
        </div>
        {draftMode ? <div><Label className="sr-only" htmlFor={quantityId}>Quantity for {item?.name ?? item?.sku ?? line.itemId}</Label><Input className="h-10 px-2 text-center tabular-nums" id={quantityId} aria-describedby={invalidQuantity ? quantityHelpId : "draft-line-quantity-guidance"} aria-invalid={invalidQuantity} type="number" min="1" max="1000000" step="1" value={quantityValue} onChange={event => setQuantityValue?.(line.itemId, event.target.value)} /></div> : <div className="text-sm tabular-nums">{line.quantity} units</div>}
        <Button type="button" size="sm" className={draftMode ? "h-10 min-w-0 px-2" : undefined} variant="ghost" onClick={() => remove(index)}>Remove</Button>
        {draftMode && invalidQuantity && <p id={quantityHelpId} className="col-span-full text-xs leading-tight text-destructive" role="alert">Enter a whole number from 1 to 1,000,000.</p>}
      </div>;
    })}
  </div>;
}
