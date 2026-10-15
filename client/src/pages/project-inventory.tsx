import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { useUnsavedNavigation } from "@/hooks/use-unsaved-navigation";
import type { InventoryCommand, InventoryCount, InventoryItem, InventoryOrder, InventoryState, StockLine, Vendor, Warehouse } from "@shared/inventory";
import { inventoryCountReference } from "@shared/inventory-count-reference";
import { COUNT_MAX_LINES, COUNT_PAGE_SIZE } from "@shared/inventory-count-limits";
import { inventoryCountRows, inventoryCountLines } from "@/lib/inventory-count-form";
import { inventoryResourceFailure, validateInventoryResource } from "@/lib/inventory-resource-save";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, ArrowLeftRight, Boxes, ClipboardList, Loader2, Package, Plus, Printer, RefreshCw, Search, Warehouse as WarehouseIcon } from "lucide-react";

type Snapshot = { enabled: boolean; state: InventoryState; permissions: string[]; users: Array<{ id: string; username: string }> };
type ResourceKind = "warehouse" | "vendor" | "item";
const blankWarehouse = (): Warehouse => ({ id: "", code: "", name: "", type: "physical", active: true, address: "", city: "", state: "", zip: "", contact: "", phone: "", location: "", vin: "", plate: "", plateState: "", make: "", model: "", year: null, assignedUserId: null, userIds: [] });
const blankVendor = (): Vendor => ({ id: "", name: "", contact: "", address: "", phone: "", email: "", reference: "", active: true });
const blankItem = (): InventoryItem => ({ id: "", sku: "", name: "", description: "", category: "", unit: "each", tracking: "regular", equipment: "none", barcode: "", manufacturer: "", model: "", vendorId: null, cost: 0, reorderPoint: 0, active: true, images: [], components: [] });
const freshId = () => crypto.randomUUID();
const csv = (value: string) => value.split(/[\n,;]/).map(part => part.trim()).filter(Boolean);
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
  const { toast } = useToast();
  const base = `/api/projects/${projectId}/inventory`;
  const queryKey = [base];
  const { data, isLoading, isError, refetch } = useQuery<Snapshot>({ queryKey, enabled: !!projectId });
  const [search, setSearch] = useState("");
  const [stockPage, setStockPage] = useState(0);
  const [activityPage, setActivityPage] = useState(0);
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
  const [orderId, setOrderId] = useState("");
  const [orderDestination, setOrderDestination] = useState("");
  const [orderSource, setOrderSource] = useState("");
  const [orderVendor, setOrderVendor] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [orderLines, setOrderLines] = useState<StockLine[]>([]);
  // The order's unadded line is independent of the movement scanner.
  const [orderLineItem, setOrderLineItem] = useState("");
  const [orderLineQty, setOrderLineQty] = useState("1");
  const [orderLineSerials, setOrderLineSerials] = useState("");
  const orderValues = { orderType, orderId, orderDestination, orderSource, orderVendor, orderNotes, orderLines,
    orderLineItem, orderLineQty, orderLineSerials };
  const [savedOrderValues, setSavedOrderValues] = useState(() => JSON.stringify(orderValues));
  const orderDirty = JSON.stringify(orderValues) !== savedOrderValues;
  const orderSaving = useRef(false);
  const [orderMessage, setOrderMessage] = useState("");
  const [pendingOrderTransition, setPendingOrderTransition] = useState<(() => void) | null>(null);
  const [showClearedOrders, setShowClearedOrders] = useState(false);
  const [orderToClear, setOrderToClear] = useState<InventoryOrder | null>(null);
  const requestOrderTransition = (transition: () => void) => {
    if (orderSaving.current || command.isPending) return;
    if (orderDirty) setPendingOrderTransition(current => current ?? transition);
    else transition();
  };
  const [lineItem, setLineItem] = useState("");
  const [lineQty, setLineQty] = useState("1");
  const [lineSerials, setLineSerials] = useState("");
  const [operationOrder, setOperationOrder] = useState<InventoryOrder | null>(null);
  const [operation, setOperation] = useState<"receive" | "dispatch" | "accept">("receive");
  const [operationReview, setOperationReview] = useState(false);
  const [operationLines, setOperationLines] = useState<StockLine[]>([]);
  const [operationReason, setOperationReason] = useState("");
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
  const completeSavedNavigation = useUnsavedNavigation(countDirty || orderDirty,
    transition => requestCountTransition(() => requestOrderTransition(transition)));
  const [assembleItem, setAssembleItem] = useState("");
  const [assembleWarehouse, setAssembleWarehouse] = useState("");
  const [assembleQty, setAssembleQty] = useState("1");
  const [assembleSerials, setAssembleSerials] = useState("");
  const [componentScan, setComponentScan] = useState<Record<string, string>>({});
  const [returnInspect, setReturnInspect] = useState<Record<string, { itemId: string; reason: string }>>({});

  const state = data?.state;
  const can = (permission: string) => hasPermission(permission);
  const command = useMutation({
    mutationFn: async ({ action, data: payload }: { action: InventoryCommand["action"]; data: Record<string, unknown> }) => {
      const response = await apiRequest("POST", `${base}/commands`, { operationId: freshId(), action, data: payload } satisfies InventoryCommand);
      return response.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
      toast({ title: "Inventory saved", description: "The project stock ledger is up to date." });
    },
    onError: (error: Error) => toast({ title: "Inventory action failed", description: error.message, variant: "destructive" }),
  });
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
  const visibleOrders = orderItems.filter(order => showClearedOrders || !order.archivedAt);
  const activityPageSize = 100;
  const lastActivityPage = Math.max(0, Math.ceil((state?.receipts.length ?? 0) / activityPageSize) - 1);
  const currentActivityPage = Math.min(activityPage, lastActivityPage);
  const activityEnd = Math.max(0, (state?.receipts.length ?? 0) - currentActivityPage * activityPageSize);
  const activityStart = Math.max(0, activityEnd - activityPageSize);
  const activityReceipts = state?.receipts.slice(activityStart, activityEnd).reverse() ?? [];
  const activeWarehouses = warehouses.filter(value => value.active);
  const stockRows = useMemo(() => (state?.stock ?? []).map(stock => ({
    ...stock, item: items.find(value => value.id === stock.itemId), warehouse: warehouses.find(value => value.id === stock.warehouseId),
    reserved: state?.allocations.filter(allocation => allocation.status === "reserved").flatMap(allocation => allocation.lines)
      .filter(line => line.itemId === stock.itemId && line.warehouseId === stock.warehouseId).reduce((total, line) => total + line.quantity, 0) ?? 0,
  })).filter(row => row.item && row.warehouse).filter(row => {
    const needle = search.toLowerCase();
    return !needle || [row.item?.sku, row.item?.name, row.warehouse?.code, row.warehouse?.name, ...row.serials].join(" ").toLowerCase().includes(needle);
  }), [state, items, warehouses, search]);
  const stockPageSize = 100;
  const lastStockPage = Math.max(0, Math.ceil(stockRows.length / stockPageSize) - 1);
  const currentStockPage = Math.min(stockPage, lastStockPage);
  const visibleStockRows = stockRows.slice(currentStockPage * stockPageSize, (currentStockPage + 1) * stockPageSize);

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
  const addLine = (destination: "order" | "operation") => {
    const item = items.find(value => value.id === (destination === "order" ? orderLineItem : lineItem));
    const quantity = Number(destination === "order" ? orderLineQty : lineQty);
    const serials = item?.tracking === "serialized" ? csv(destination === "order" ? orderLineSerials : lineSerials) : [];
    const requiresSerials = item?.tracking === "serialized" && !(destination === "order" && orderType === "purchase");
    if (!item || !Number.isInteger(quantity) || quantity < 1 || (requiresSerials && serials.length !== quantity)) {
      toast({ title: "Check scanned quantity", description: item?.tracking === "serialized" ? "Scan exactly one distinct serial for each unit." : "Enter a positive whole quantity.", variant: "destructive" }); return;
    }
    const update = destination === "order" ? setOrderLines : setOperationLines;
    update(current => {
      const match = current.findIndex(line => line.itemId === item.id);
      return match < 0 ? [...current, { itemId: item.id, quantity, serials }] :
        current.map((line, index) => index === match ? { ...line, quantity: line.quantity + quantity, serials: [...line.serials, ...serials] } : line);
    });
    if (destination === "order") { setOrderLineItem(""); setOrderLineQty("1"); setOrderLineSerials(""); }
    else { setLineItem(""); setLineQty("1"); setLineSerials(""); }
  };
  const orderHasPendingLine = !!orderLineItem || orderLineQty !== "1" || !!orderLineSerials;
  const canSaveOrder = !!orderDestination && !!orderLines.length && !orderHasPendingLine &&
    (orderType === "purchase" ? !!orderVendor && can("inventory.purchase") : !!orderSource && can("inventory.transfer"));
  const saveOrderDraft = (afterSave?: () => void) => {
    if (!canSaveOrder || command.isPending || orderSaving.current) return;
    orderSaving.current = true;
    setOrderMessage("");
    const id = orderId.trim() || freshId();
    command.mutate({ action: "order", data: { id, type: orderType, destinationId: orderDestination,
      sourceId: orderType === "transfer" ? orderSource : null, vendorId: orderType === "purchase" ? orderVendor : null,
      lines: orderLines.map(line => orderType === "purchase" ? { ...line, serials: [] } : line), notes: orderNotes } }, {
      onSuccess: result => {
        const saved = (result.state as InventoryState | undefined)?.orders.find(order => order.id === id);
        if (!saved) {
          setOrderMessage("Draft save could not be confirmed. Your entries were kept.");
          return;
        }
        setOrderLines([]); setOrderId(""); setOrderNotes("");
        setSavedOrderValues(JSON.stringify({ ...orderValues, orderLines: [], orderId: "", orderNotes: "" }));
        setOrderMessage("Order draft saved. Stock has not changed.");
        orderSaving.current = false;
        if (afterSave) {
          setPendingOrderTransition(null);
          completeSavedNavigation(afterSave);
        }
      },
      onError: () => setOrderMessage("Order draft not saved. Your entries are still here; retry before leaving."),
      onSettled: () => { orderSaving.current = false; },
    });
  };
  const editOrderDraft = (order: InventoryOrder) => requestOrderTransition(() => {
    setOrderId(order.id); setOrderType(order.type); setOrderDestination(order.destinationId);
    setOrderSource(order.sourceId || ""); setOrderVendor(order.vendorId || "");
    setOrderLines(order.lines); setOrderNotes(order.notes);
    setOrderLineItem(""); setOrderLineQty("1"); setOrderLineSerials("");
    setOrderMessage("");
    setSavedOrderValues(JSON.stringify({ orderType: order.type, orderId: order.id,
      orderDestination: order.destinationId, orderSource: order.sourceId || "", orderVendor: order.vendorId || "",
      orderNotes: order.notes, orderLines: order.lines, orderLineItem: "", orderLineQty: "1", orderLineSerials: "" }));
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  const openOrderOperation = (order: InventoryOrder, action: "receive" | "dispatch" | "accept") => {
    setOperationOrder(order); setOperation(action); setOperationLines([]); setOperationReason(""); setOperationReview(false);
    const previous = action === "receive" ? order.received : action === "dispatch" ? order.dispatched : order.received;
    setOperationLines(order.lines.flatMap(line => {
      const done = previous.filter(old => old.itemId === line.itemId).reduce((sum, old) => sum + old.quantity, 0);
      const dispatchedQuantity = order.dispatched.filter(old => old.itemId === line.itemId).reduce((sum, old) => sum + old.quantity, 0);
      const remaining = Math.max(0, (action === "accept" ? dispatchedQuantity : line.quantity) - done);
      const receivedSerials = order.received.filter(old => old.itemId === line.itemId).flatMap(old => old.serials);
      const dispatchedSerials = order.dispatched.filter(old => old.itemId === line.itemId).flatMap(old => old.serials);
      const transferSerials = action === "accept" ? dispatchedSerials.filter(serial => !receivedSerials.includes(serial)) :
        action === "dispatch" ? line.serials.filter(serial => !dispatchedSerials.includes(serial)) : line.serials;
      return remaining ? [{ itemId: line.itemId, quantity: remaining, serials: action === "receive" ? [] : transferSerials }] : [];
    }));
  };
  const openPrint = (kind: "order" | "receipt" | "count", id: string) => {
    window.open(`${base}/print/${kind}/${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
  };
  const runOrderCommand = (action: "unrelease" | "archiveOrder" | "restoreOrder", order: InventoryOrder) => {
    if (command.isPending || !can("inventory.purchase")) return;
    command.mutate({ action, data: { orderId: order.id } }, {
      onSuccess: () => { if (action === "archiveOrder") setOrderToClear(null); },
    });
  };
  const orderHasReceipt = (order: InventoryOrder) => state.receipts.some(receipt => receipt.reference === order.id);
  const isUnreleaseLocked = (order: InventoryOrder) => order.status !== "released" ||
    order.received.length > 0 || order.dispatched.length > 0 || orderHasReceipt(order);
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

  return <main className="mx-auto max-w-7xl space-y-6 p-4 pb-12 md:p-7">
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
    <Dialog open={!!orderToClear} onOpenChange={open => { if (!open && !command.isPending) setOrderToClear(null); }}>
      <DialogContent onEscapeKeyDown={event => { if (command.isPending) event.preventDefault(); }} onPointerDownOutside={event => { if (command.isPending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Clear cancelled purchase order?</DialogTitle>
          <DialogDescription>
            {orderToClear?.id} will be hidden from the default order list. The order, audit history, and any receipts are retained. You can recover it by turning on “Show cleared POs”.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={command.isPending} onClick={() => setOrderToClear(null)}>Keep order visible</Button>
          <Button variant="destructive" disabled={command.isPending || !can("inventory.purchase") || !orderToClear}
            onClick={() => orderToClear && runOrderCommand("archiveOrder", orderToClear)}>Clear PO</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {isError && <Alert variant="destructive"><AlertTitle>Inventory refresh failed</AlertTitle><AlertDescription>The last loaded inventory is shown. Your count entries were kept; retry before relying on current stock.</AlertDescription><Button variant="outline" className="mt-2" onClick={() => refetch()}>Retry inventory refresh</Button></Alert>}
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="mb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Project operations</p><h1 className="text-3xl font-semibold tracking-tight">Inventory</h1><p className="mt-1 text-sm text-muted-foreground">Know what’s on hand, where it lives, and which serial leaves with each crew.</p></div>
      <div className="flex flex-wrap gap-2">{can("inventory.maintain") && <Button variant="outline" onClick={() => openResource("warehouse")}><Plus className="mr-2 h-4 w-4" />Location</Button>}{can("inventory.maintain") && <Button onClick={() => openResource("item")}><Plus className="mr-2 h-4 w-4" />New item</Button>}</div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Active locations" value={activeWarehouses.length} detail={`${warehouses.filter(value => value.type === "vehicle").length} vehicles`} icon={<WarehouseIcon className="h-4 w-4" />} />
      <Metric label="Catalog items" value={items.filter(item => item.active).length} detail={`${items.filter(item => item.tracking === "serialized").length} serial tracked`} icon={<Package className="h-4 w-4" />} />
      <Metric label="Open orders" value={orderItems.filter(order => ["draft", "released", "partial"].includes(order.status)).length} detail="Purchases and transfers" icon={<ArrowLeftRight className="h-4 w-4" />} />
      <Metric label="Open counts" value={state.counts.filter(count => count.status === "open").length} detail={`Ledger revision ${state.revision}`} icon={<ClipboardList className="h-4 w-4" />} />
    </div>

    {!hasAny && <Alert><Boxes className="h-4 w-4" /><AlertTitle>Set up the first stock location</AlertTitle><AlertDescription>Add a warehouse or service vehicle, then add catalog items and begin receiving meters.</AlertDescription></Alert>}

    <Tabs defaultValue="stock" className="space-y-5">
      <TabsList className="h-auto flex-wrap justify-start"><TabsTrigger value="stock">Stock & search</TabsTrigger><TabsTrigger value="locations">Locations</TabsTrigger><TabsTrigger value="catalog">Items & vendors</TabsTrigger><TabsTrigger value="orders">Orders</TabsTrigger><TabsTrigger value="counts">Counts & assembly</TabsTrigger><TabsTrigger value="returns">Removed Equipment</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList>
      <TabsContent value="stock" className="space-y-4">
        <Card><CardHeader className="pb-3"><div className="flex flex-col justify-between gap-3 md:flex-row md:items-end"><div><CardTitle>On hand by location</CardTitle><CardDescription>Reserved units are excluded from available stock. Serial identity remains attached to its bin.</CardDescription></div><div className="relative w-full md:max-w-sm"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search inventory" className="pl-9" placeholder="Search SKU, item, location, serial…" value={search} onChange={event => { setSearch(event.target.value); setStockPage(0); }} /></div></div></CardHeader><CardContent>
          {stockRows.length ? <><div className="max-h-[32rem] max-w-full overflow-auto" role="region" aria-label="Stock balances" tabIndex={0}><table className="w-full min-w-[780px] text-sm"><thead><tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="pb-3">Item / SKU</th><th className="pb-3">Location</th><th className="pb-3 text-right">On hand</th><th className="pb-3 text-right">Reserved</th><th className="pb-3 text-right">Available</th><th className="pb-3">Serial identity</th></tr></thead><tbody>{visibleStockRows.map(row => <tr key={`${row.warehouseId}/${row.itemId}`} className="border-b align-top last:border-0"><td className="py-3"><div className="font-medium">{row.item?.name}</div><div className="font-mono text-xs text-muted-foreground">{row.item?.sku}</div></td><td className="py-3"><div>{row.warehouse?.name}</div><div className="text-xs text-muted-foreground">{row.warehouse?.code}</div></td><td className="py-3 text-right font-mono">{row.quantity}</td><td className="py-3 text-right font-mono">{row.reserved}</td><td className="py-3 text-right font-mono font-semibold">{row.quantity - row.reserved}</td><td className="max-w-xs py-3 font-mono text-xs text-muted-foreground">{row.serials.length ? <div className="max-h-24 overflow-y-auto break-all" role="region" aria-label={`Serials for ${row.item?.sku} at ${row.warehouse?.code}`} tabIndex={0}>{row.serials.join(", ")}</div> : "—"}</td></tr>)}</tbody></table></div>{stockRows.length > stockPageSize && <nav aria-label="Stock pages" className="mt-4 flex flex-wrap items-center gap-2"><p className="mr-auto text-sm text-muted-foreground" aria-live="polite">{currentStockPage * stockPageSize + 1}–{Math.min((currentStockPage + 1) * stockPageSize, stockRows.length)} of {stockRows.length} balances</p><Button size="sm" variant="outline" aria-label="First stock page" disabled={currentStockPage === 0} onClick={() => setStockPage(0)}>First</Button><Button size="sm" variant="outline" aria-label="Previous stock page" disabled={currentStockPage === 0} onClick={() => setStockPage(currentStockPage - 1)}>Previous</Button><Button size="sm" variant="outline" aria-label="Next stock page" disabled={currentStockPage === lastStockPage} onClick={() => setStockPage(currentStockPage + 1)}>Next</Button><Button size="sm" variant="outline" aria-label="Last stock page" disabled={currentStockPage === lastStockPage} onClick={() => setStockPage(lastStockPage)}>Last</Button></nav>}</> : <Empty title="No stock balances yet" description="Receive a purchase or accept a transfer to see item quantities and scanned serials here." />}</CardContent></Card>
      </TabsContent>
      <TabsContent value="locations"><Card><CardHeader><div className="flex items-center justify-between"><div><CardTitle>Warehouses & vehicles</CardTitle><CardDescription>Access is enforced by the project inventory service for every operation.</CardDescription></div>{can("inventory.maintain") && <Button onClick={() => openResource("warehouse")}><Plus className="mr-2 h-4 w-4" />Add location</Button>}</div></CardHeader><CardContent><div className="grid gap-3 lg:grid-cols-2">{warehouses.map(warehouse => <div key={warehouse.id} className="rounded-lg border p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2 font-medium">{warehouse.name}<Badge variant="outline">{warehouse.type === "vehicle" ? "Vehicle" : "Warehouse"}</Badge>{!warehouse.active && <Badge variant="secondary">Inactive</Badge>}</div><div className="mt-1 font-mono text-xs text-muted-foreground">{warehouse.code}</div></div>{can("inventory.maintain") && <Button size="sm" variant="outline" onClick={() => openResource("warehouse", warehouse)}>Edit</Button>}</div><p className="mt-3 text-sm text-muted-foreground">{warehouse.type === "vehicle" ? `${warehouse.make} ${warehouse.model} · ${warehouse.plate} ${warehouse.plateState}` : [warehouse.address, warehouse.city, warehouse.state, warehouse.zip].filter(Boolean).join(", ")}</p><p className="mt-2 text-xs text-muted-foreground">{warehouse.assignedUserId ? `Assigned user ${data.users.find(user => user.id === warehouse.assignedUserId)?.username ?? warehouse.assignedUserId}` : "Assigned: None"} · {warehouse.userIds.length} additional authorized</p></div>)}</div>{warehouses.length === 0 && <Empty title="No locations configured" description="Create a warehouse or field vehicle to establish the first stock location." />}</CardContent></Card></TabsContent>
      <TabsContent value="catalog" className="space-y-4"><Card><CardHeader><div className="flex items-center justify-between"><div><CardTitle>Item catalog</CardTitle><CardDescription>Serialized meters require a scan for each quantity; kits list their component recipe.</CardDescription></div>{can("inventory.maintain") && <Button onClick={() => openResource("item")}><Plus className="mr-2 h-4 w-4" />Add item</Button>}</div></CardHeader><CardContent><div className="space-y-2">{items.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div className="flex items-center gap-3">{item.images[0] && sameOriginImage(item.images[0]) && <img src={sameOriginImage(item.images[0]) ?? undefined} alt="" className="h-12 w-12 rounded object-cover" />}<div><div className="font-medium">{item.name} <span className="font-mono text-xs text-muted-foreground">{item.sku}</span></div><div className="text-xs text-muted-foreground">{item.category || "Uncategorized"} · {item.tracking} · {item.unit}{item.components.length ? ` · Kit of ${item.components.length}` : ""}</div></div></div><div className="flex items-center gap-2">{item.reorderPoint > 0 && <Badge variant="outline">Reorder at {item.reorderPoint}</Badge>}{!item.active && <Badge variant="secondary">Inactive</Badge>}{can("inventory.maintain") && <Button size="sm" variant="outline" onClick={() => openResource("item", item)}>Edit</Button>}</div></div>)}</div>{items.length === 0 && <Empty title="No items in this project" description="Add the meter catalog, barcode identifiers, tracking type, and kit recipes." />}</CardContent></Card>
        <Card><CardHeader><div className="flex items-center justify-between"><div><CardTitle>Vendors</CardTitle><CardDescription>Vendor details are project-specific.</CardDescription></div>{can("inventory.maintain") && <Button variant="outline" onClick={() => openResource("vendor")}><Plus className="mr-2 h-4 w-4" />Add vendor</Button>}</div></CardHeader><CardContent><div className="grid gap-2 sm:grid-cols-2">{vendors.map(vendor => <div key={vendor.id} className="rounded-md border p-3"><div className="flex justify-between gap-2"><span className="font-medium">{vendor.name}</span>{can("inventory.maintain") && <Button size="sm" variant="ghost" onClick={() => openResource("vendor", vendor)}>Edit</Button>}</div><p className="text-sm text-muted-foreground">{vendor.contact} {vendor.phone && `· ${vendor.phone}`}</p><p className="text-xs text-muted-foreground">{vendor.email || vendor.reference}</p></div>)}</div>{vendors.length === 0 && <Empty title="No vendors added" description="Vendor details are optional for internal stock moves and required when creating purchase orders." />}</CardContent></Card>
      </TabsContent>

      <TabsContent value="orders" className="space-y-4">
        {can("inventory.purchase") || can("inventory.transfer") ? <Card><CardHeader><CardTitle>Build an order draft</CardTitle><CardDescription>Save draft, then release it to enable receiving or field transfer.</CardDescription></CardHeader><CardContent><fieldset disabled={command.isPending} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4"><div className="space-y-1"><Label>Order type</Label><Select value={orderType} onValueChange={value => setOrderType(value as "purchase" | "transfer")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="purchase">Purchase</SelectItem><SelectItem value="transfer">Transfer</SelectItem></SelectContent></Select></div><div className="space-y-1"><Label>Destination</Label><Select value={orderDestination} onValueChange={setOrderDestination}><SelectTrigger><SelectValue placeholder="Choose location" /></SelectTrigger><SelectContent>{activeWarehouses.map(w => <SelectItem value={w.id} key={w.id}>{w.code} · {w.name}</SelectItem>)}</SelectContent></Select></div>{orderType === "purchase" ? <div className="space-y-1"><Label>Vendor</Label><Select value={orderVendor} onValueChange={setOrderVendor}><SelectTrigger><SelectValue placeholder="Choose vendor" /></SelectTrigger><SelectContent>{vendors.filter(v => v.active).map(v => <SelectItem value={v.id} key={v.id}>{v.name}</SelectItem>)}</SelectContent></Select></div> : <div className="space-y-1"><Label>Source</Label><Select value={orderSource} onValueChange={setOrderSource}><SelectTrigger><SelectValue placeholder="Choose location" /></SelectTrigger><SelectContent>{activeWarehouses.filter(w => w.id !== orderDestination).map(w => <SelectItem value={w.id} key={w.id}>{w.code} · {w.name}</SelectItem>)}</SelectContent></Select></div>}<div className="space-y-1"><Label>Draft reference</Label><Input value={orderId} onChange={event => setOrderId(event.target.value)} placeholder="e.g. PO-2025-014" /></div></div>
          <OrderLineEditor items={items} lineItem={orderLineItem} setLineItem={setOrderLineItem} lineQty={orderLineQty} setLineQty={setOrderLineQty} lineSerials={orderLineSerials} setLineSerials={setOrderLineSerials} lines={orderLines} add={() => addLine("order")} remove={index => setOrderLines(value => value.filter((_, i) => i !== index))} updateSerials={(index, serials) => setOrderLines(value => value.map((line, i) => i === index ? { ...line, serials } : line))} />
          <Textarea aria-label="Order notes" placeholder="Notes for purchasing or the receiving crew" value={orderNotes} onChange={event => setOrderNotes(event.target.value)} />
          {orderDirty && <p role="status" className="text-sm text-amber-700 dark:text-amber-400">Unsaved order changes. Save the draft to keep your entries.</p>}
          {orderHasPendingLine && <div className="flex flex-wrap items-center gap-2"><p className="text-sm">Add or clear the unfinished line before saving.</p><Button type="button" variant="outline" size="sm" onClick={() => { setOrderLineItem(""); setOrderLineQty("1"); setOrderLineSerials(""); }}>Clear unfinished line</Button></div>}
          {orderMessage && <p role="status" className="text-sm">{orderMessage}</p>}
          <Button disabled={command.isPending || !canSaveOrder} onClick={() => saveOrderDraft()}><Plus className="mr-2 h-4 w-4" />Save draft</Button>
        </fieldset></CardContent></Card> : null}
        <Card><CardHeader><CardTitle>Purchase & transfer orders</CardTitle><CardDescription>Open the relevant action to scan and post each partial movement.</CardDescription></CardHeader><CardContent>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3">
            <div><Label htmlFor="show-cleared-orders" className="cursor-pointer">Show cleared POs</Label><p className="text-xs text-muted-foreground">Cleared orders are hidden by default; turn this on to restore them.</p></div>
            <Checkbox id="show-cleared-orders" checked={showClearedOrders} onCheckedChange={checked => setShowClearedOrders(checked === true)} aria-label="Show cleared purchase orders" />
          </div>
          <div className="space-y-3">{visibleOrders.map(order => {
            const archived = !!order.archivedAt;
            const purchase = order.type === "purchase";
            const unreleaseLocked = purchase && ["released", "partial", "completed"].includes(order.status) && isUnreleaseLocked(order);
            return <div key={order.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-medium">{order.id}<Badge variant={order.status === "completed" ? "default" : "outline"}>{order.status}</Badge><Badge variant="secondary">{order.type}</Badge>{archived && <Badge variant="secondary">cleared</Badge>}</div>
                  <p className="mt-1 text-sm text-muted-foreground">{purchase ? vendors.find(v => v.id === order.vendorId)?.name : warehouses.find(w => w.id === order.sourceId)?.name} → {warehouses.find(w => w.id === order.destinationId)?.name}</p>
                  <p className="text-xs text-muted-foreground">{order.lines.map(line => `${items.find(item => item.id === line.itemId)?.sku ?? line.itemId} × ${line.quantity}`).join(" · ")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => openPrint("order", order.id)}><Printer className="mr-1 h-3.5 w-3.5" />Print</Button>
                  {order.status === "draft" && can(purchase ? "inventory.purchase" : "inventory.transfer") && <><Button size="sm" variant="outline" onClick={() => editOrderDraft(order)}>Edit draft</Button><Button size="sm" disabled={command.isPending} onClick={() => command.mutate({ action: "release", data: { orderId: order.id } })}>Release</Button></>}
                  {!["completed", "cancelled"].includes(order.status) && <Button size="sm" variant="ghost" disabled={command.isPending} onClick={() => command.mutate({ action: "cancel", data: { orderId: order.id } })}>Cancel</Button>}
                  {order.status === "released" || order.status === "partial" ? <Button size="sm" disabled={command.isPending} onClick={() => openOrderOperation(order, purchase ? "receive" : "dispatch")}>{purchase ? "Receive" : "Dispatch"}</Button> : null}
                  {order.type === "transfer" && ["released", "partial"].includes(order.status) && <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => openOrderOperation(order, "accept")}>Accept arrival</Button>}
                  {purchase && order.status === "released" && !archived && can("inventory.purchase") && <Button size="sm" variant="outline" disabled={command.isPending || isUnreleaseLocked(order)} onClick={() => requestOrderTransition(() => runOrderCommand("unrelease", order))}>Un-release to draft</Button>}
                  {purchase && order.status === "cancelled" && !archived && can("inventory.purchase") && <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => requestOrderTransition(() => setOrderToClear(order))}>Clear</Button>}
                  {purchase && order.status === "cancelled" && archived && can("inventory.purchase") && <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => requestOrderTransition(() => runOrderCommand("restoreOrder", order))}>Restore</Button>}
                </div>
              </div>
              {purchase && unreleaseLocked && <p className="mt-3 text-xs text-muted-foreground" role="note">This purchase order is receipt-locked and cannot be un-released. Received, dispatched, or receipt activity must remain attached to the order; partially received and completed POs cannot return to draft.</p>}
            </div>;
          })}</div>
          {visibleOrders.length === 0 && <Empty title={showClearedOrders ? "No orders yet" : "No active orders"} description={showClearedOrders ? "Draft a purchase order or a transfer between a stockroom and service vehicle." : orderItems.length ? "All purchase orders in this list are cleared. Turn on Show cleared POs to recover one." : "Draft a purchase order or a transfer between a stockroom and service vehicle."} />}
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="counts" className="space-y-4"><Card><CardHeader><CardTitle>Physical stock count</CardTitle><CardDescription>Start a snapshot, count every item including zero, and post with a reason.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex flex-wrap items-end gap-3"><div className="w-full max-w-sm space-y-1"><Label>Warehouse or vehicle</Label><Select value={countWarehouse} onValueChange={setCountWarehouse}><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{activeWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>)}</SelectContent></Select></div>{can("inventory.count") && <Button onClick={() => requestCountTransition(startCount)} disabled={!countWarehouse || command.isPending}>Start count</Button>}</div>
          {state.counts.map(count => <div key={count.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"><div><span className="font-medium">{warehouses.find(w => w.id === count.warehouseId)?.name ?? "Location unavailable"}</span><span className="ml-2 text-sm text-muted-foreground">{inventoryCountReference(state.counts, count.id)}</span><Badge className="ml-2" variant={count.status === "open" ? "outline" : "secondary"}>{count.status}</Badge></div>{count.status === "open" && <div className="flex gap-2"><Button size="sm" variant="outline" disabled={command.isPending} onClick={() => { if (activeCount?.id !== count.id) requestCountTransition(() => openCount(count, true)); }}>Continue count</Button><Button size="sm" variant="outline" disabled={!can("inventory.count") || command.isPending} onClick={() => cancelCount(count)}>Cancel count</Button></div>}{count.status === "posted" && <Button size="sm" variant="ghost" onClick={() => openPrint("count", count.id)}>Print</Button>}</div>)}
          {activeCount && <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
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
              return <div key={id} className="grid gap-2 rounded border bg-background p-3 sm:grid-cols-[1fr_130px_2fr] sm:items-end">
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
        <Card><CardHeader><CardTitle>Assemble a kit</CardTitle><CardDescription>Select a defined kit; scan components from the selected location and record its finished serial identity.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-3 sm:grid-cols-3"><div className="space-y-1"><Label>Kit item</Label><Select value={assembleItem} onValueChange={value => { setAssembleItem(value); setComponentScan({}); }}><SelectTrigger><SelectValue placeholder="Select kit" /></SelectTrigger><SelectContent>{items.filter(item => item.active && item.components.length).map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label>Build location</Label><Select value={assembleWarehouse} onValueChange={setAssembleWarehouse}><SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger><SelectContent>{activeWarehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label>Build quantity</Label><Input type="number" min="1" value={assembleQty} onChange={event => setAssembleQty(event.target.value)} /></div></div>{items.find(item => item.id === assembleItem)?.components.map(component => { const item = items.find(value => value.id === component.itemId); return <div key={component.itemId} className="grid gap-2 sm:grid-cols-[1fr_2fr] sm:items-center"><Label>{item?.sku} · {item?.name} — {component.quantity * Number(assembleQty || 1)} required</Label><Input aria-label={`Scan ${item?.name ?? "component"} serials`} value={componentScan[component.itemId] ?? ""} onChange={event => setComponentScan(current => ({ ...current, [component.itemId]: event.target.value }))} placeholder={item?.tracking === "serialized" ? "Scan component serials" : "Quantity is taken from this location"} /></div>; })}{items.find(item => item.id === assembleItem)?.tracking === "serialized" && <div className="space-y-1"><Label>Finished kit serials</Label><Input value={assembleSerials} onChange={event => setAssembleSerials(event.target.value)} placeholder="Scan each finished unit" /></div>}<Button disabled={!can("inventory.assemble") || !assembleItem || !assembleWarehouse || command.isPending} onClick={() => { const kit = items.find(item => item.id === assembleItem); if (!kit) return; const quantity = Number(assembleQty); const components = kit.components.map(component => { const componentItem = items.find(item => item.id === component.itemId); const serialList = componentItem?.tracking === "serialized" ? csv(componentScan[component.itemId] ?? "") : []; return { itemId: component.itemId, quantity: componentItem?.tracking === "serialized" ? serialList.length : component.quantity * quantity, serials: serialList }; }); command.mutate({ action: "assemble", data: { warehouseId: assembleWarehouse, itemId: kit.id, quantity, serials: kit.tracking === "serialized" ? csv(assembleSerials) : [], components } }); }}>Assemble kit</Button></CardContent></Card>
      </TabsContent>
      <TabsContent value="returns"><Card><CardHeader><CardTitle>Removed Equipment</CardTitle><CardDescription>Returned systems and modules enter quarantine first. Release to usable inventory only after inspection.</CardDescription></CardHeader><CardContent><div className="space-y-3">{state.returns.map(returned => <div key={returned.id} className="flex flex-col justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-start"><div><div className="flex items-center gap-2 font-medium">{returned.equipment === "system" ? "System" : "Module"} · <span className="font-mono">{returned.serial}</span><Badge variant={returned.status === "released" ? "default" : "outline"}>{returned.status}</Badge></div><div className="mt-1 text-sm text-muted-foreground">Work order #{returned.workOrderId} · Return location: {warehouses.find(w => w.id === returned.warehouseId)?.name ?? "—"}</div></div><div className="flex flex-wrap gap-2">{returned.status === "pending" && can("inventory.receive") && <Button size="sm" onClick={() => command.mutate({ action: "returnAccept", data: { id: returned.id } })}>Accept into quarantine</Button>}{returned.status === "quarantine" && can("inventory.receive") && <div className="flex min-w-0 flex-wrap gap-2"><Select value={returnInspect[returned.id]?.itemId ?? ""} onValueChange={value => setReturnInspect(current => ({ ...current, [returned.id]: { itemId: value, reason: current[returned.id]?.reason ?? "" } }))}><SelectTrigger className="w-48"><SelectValue placeholder="Matching equipment item" /></SelectTrigger><SelectContent>{items.filter(item => item.tracking === "serialized" && item.equipment === returned.equipment).map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select><Input aria-label="Inspection result" placeholder="Inspection note" value={returnInspect[returned.id]?.reason ?? ""} onChange={event => setReturnInspect(current => ({ ...current, [returned.id]: { itemId: current[returned.id]?.itemId ?? "", reason: event.target.value } }))} /><Button size="sm" disabled={!returnInspect[returned.id]?.itemId || !returnInspect[returned.id]?.reason} onClick={() => command.mutate({ action: "returnRelease", data: { id: returned.id, itemId: returnInspect[returned.id].itemId, reason: returnInspect[returned.id].reason } })}>Release to stock</Button></div>}</div></div>)}</div>{state.returns.length === 0 && <Empty title="No returned equipment" description="When technicians record a removed system or module as returned, it will appear here for receiving and inspection." />}</CardContent></Card></TabsContent>
          <TabsContent value="activity"><Card><CardHeader><CardTitle>Stock movement ledger</CardTitle><CardDescription>Printable documents open as same-origin project reports.</CardDescription></CardHeader><CardContent><div className="space-y-2" data-testid="inventory-activity-entries">{activityReceipts.map(receipt => <div key={receipt.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div><div className="font-medium">{receipt.action} · {receipt.action.startsWith("count") ? inventoryCountReference(state.counts, receipt.reference) : receipt.reference}</div><div className="text-xs text-muted-foreground">{new Date(receipt.occurredAt).toLocaleString()} · {receipt.actor} · {receipt.lines.map(line => `${items.find(item => item.id === line.itemId)?.sku ?? line.itemId} × ${line.quantity}`).join(" · ") || receipt.reason}</div></div><Button size="sm" variant="outline" onClick={() => openPrint(receipt.action.startsWith("count") ? "count" : "receipt", receipt.action.startsWith("count") ? receipt.reference : receipt.id)}><Printer className="mr-2 h-4 w-4" />Print</Button></div>)}</div>{state.receipts.length > activityPageSize && <nav aria-label="Activity pages" className="mt-4 flex flex-wrap items-center gap-2"><p className="mr-auto text-sm text-muted-foreground" aria-live="polite">{currentActivityPage * activityPageSize + 1}–{Math.min((currentActivityPage + 1) * activityPageSize, state.receipts.length)} of {state.receipts.length} movements</p><Button size="sm" variant="outline" aria-label="First activity page" disabled={currentActivityPage === 0} onClick={() => setActivityPage(0)}>First</Button><Button size="sm" variant="outline" aria-label="Previous activity page" disabled={currentActivityPage === 0} onClick={() => setActivityPage(currentActivityPage - 1)}>Previous</Button><Button size="sm" variant="outline" aria-label="Next activity page" disabled={currentActivityPage === lastActivityPage} onClick={() => setActivityPage(currentActivityPage + 1)}>Next</Button><Button size="sm" variant="outline" aria-label="Last activity page" disabled={currentActivityPage === lastActivityPage} onClick={() => setActivityPage(lastActivityPage)}>Last</Button></nav>}{state.receipts.length === 0 && <Empty title="No movement recorded" description="Receiving, transfers, kit assembly, count adjustments and returns appear here." />}</CardContent></Card></TabsContent>
    </Tabs>

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
        <Field label="Category" maxLength={500} value={itemForm.category} set={value => setItemForm(form => ({ ...form, category: value }))} help="Optional catalog grouping, up to 500 characters. Example: Water meters, fittings, or repair kits. Category does not select System or Module; use Equipment for that." />
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

    <Dialog open={!!operationOrder} onOpenChange={open => !open && setOperationOrder(null)}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{operation === "receive" ? "Receive purchase" : operation === "dispatch" ? "Dispatch transfer" : "Accept transfer arrival"}</DialogTitle><DialogDescription>Scan serial identity and post the confirmed quantities for order {operationOrder?.id}.</DialogDescription></DialogHeader>
      {operationReview ? <div className="space-y-3"><Alert><Package className="h-4 w-4" /><AlertTitle>Review movement before posting</AlertTitle><AlertDescription>Verify each quantity and scanned meter identity. Posting updates the stock ledger immediately.</AlertDescription></Alert>{operationLines.map(line => <div key={line.itemId} className="rounded-md border p-3"><div className="font-medium">{items.find(item => item.id === line.itemId)?.name ?? line.itemId} · {line.quantity} {items.find(item => item.id === line.itemId)?.unit ?? "units"}</div><div className="mt-1 break-all font-mono text-xs text-muted-foreground">{line.serials.join(", ") || "Quantity tracked"}</div></div>)}{operationLines.length === 0 && <Empty title="No movement lines" description="Return to scanning and add at least one item." />}</div> : <div className="space-y-3"><OrderLineEditor items={items} lineItem={lineItem} setLineItem={setLineItem} lineQty={lineQty} setLineQty={setLineQty} lineSerials={lineSerials} setLineSerials={setLineSerials} lines={operationLines} add={() => addLine("operation")} remove={index => setOperationLines(value => value.filter((_, i) => i !== index))} updateSerials={(index, serials) => setOperationLines(value => value.map((line, i) => i === index ? { ...line, serials } : line))} /><div className="space-y-1"><Label>Reason or receiving note</Label><Textarea value={operationReason} onChange={event => setOperationReason(event.target.value)} /></div></div>}
      <DialogFooter>{operationReview ? <><Button variant="outline" onClick={() => setOperationReview(false)}>Back to scans</Button><Button disabled={!operationLines.length || command.isPending || !can(operation === "dispatch" ? "inventory.transfer" : "inventory.receive")} onClick={() => { if (!operationOrder) return; command.mutate({ action: operation, data: { orderId: operationOrder.id, lines: operationLines, reason: operationReason } }, { onSuccess: () => setOperationOrder(null) }); }}>Post movement</Button></> : <><Button variant="outline" onClick={() => setOperationOrder(null)}>Cancel</Button><Button disabled={!operationLines.length} onClick={() => setOperationReview(true)}>Review movement</Button></>}</DialogFooter>
    </DialogContent></Dialog>
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
function OrderLineEditor({ items, lineItem, setLineItem, lineQty, setLineQty, lineSerials, setLineSerials, lines, add, remove, updateSerials }: {
  items: InventoryItem[]; lineItem: string; setLineItem: (id: string) => void; lineQty: string; setLineQty: (qty: string) => void;
  lineSerials: string; setLineSerials: (serials: string) => void; lines: StockLine[]; add: () => void; remove: (index: number) => void; updateSerials: (index: number, serials: string[]) => void;
}) {
  const selected = items.find(item => item.id === lineItem);
  return <div className="space-y-3 rounded-md border p-3"><div className="grid gap-2 sm:grid-cols-[1fr_110px_auto] sm:items-end"><div className="space-y-1"><Label>Item</Label><Select value={lineItem} onValueChange={setLineItem}><SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger><SelectContent>{items.filter(item => item.active).map(item => <SelectItem key={item.id} value={item.id}>{item.sku} · {item.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label>Quantity</Label><Input type="number" min="1" value={lineQty} onChange={event => setLineQty(event.target.value)} /></div><Button type="button" variant="outline" onClick={add}><Plus className="mr-1 h-4 w-4" />Add line</Button></div>
    {selected?.tracking === "serialized" && <div className="space-y-1"><Label>Serial scans</Label><Textarea value={lineSerials} onChange={event => setLineSerials(event.target.value)} placeholder="One serial per line" /></div>}
    {lines.map((line, index) => <div key={`${line.itemId}-${index}`} className="grid gap-2 border-t pt-2 sm:grid-cols-[1fr_auto] sm:items-end"><div><div className="text-sm">{items.find(item => item.id === line.itemId)?.name ?? line.itemId} × {line.quantity}</div>{items.find(item => item.id === line.itemId)?.tracking === "serialized" && <div className="mt-1 space-y-1"><Label htmlFor={`line-serial-${index}`}>Serial scans</Label><Textarea id={`line-serial-${index}`} value={line.serials.join("\n")} onChange={event => updateSerials(index, csv(event.target.value))} placeholder="One serial per line" /></div>}</div><Button type="button" size="sm" variant="ghost" onClick={() => remove(index)}>Remove</Button></div>)}
  </div>;
}
