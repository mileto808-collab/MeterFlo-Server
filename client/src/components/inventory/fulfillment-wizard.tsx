import { useEffect, useMemo, useRef, useState } from "react";
import { useWizardStepFocus } from "@/hooks/useWizardStepFocus";
import { useInventoryEvents } from "@/hooks/useInventoryEvents";
import { hasMeaningfulFulfillmentWork, reconcileFulfillmentDraft } from "@/lib/fulfillment-draft-reconciliation";
import { FulfillmentSavedInputs } from "./fulfillment-saved-inputs";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { parsePickTicketQr } from "@shared/inventory-pick-ticket";
import { fulfillmentTicketNumber } from "@shared/inventory-pickups";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import type { InventoryItem, InventoryState, Warehouse } from "@shared/inventory";
import { fulfillmentReserved, type FulfillmentBatch, type FulfillmentResumeStatus } from "@shared/inventory-fulfillment";
import { FulfillmentBatchHistory } from "./fulfillment-batch-history";
import { FulfillmentReassignmentReview } from "./fulfillment-reassignment-review";
import { FulfillmentStagingCorrections } from "./fulfillment-staging-corrections";
import type { FulfillmentReassignmentReview as ReassignmentReview } from "@shared/inventory-fulfillment-reassignment";
import { locationTypeFor, warehouseAccessible, isStagingType } from "@shared/inventory-location-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SerialScanProgress } from "./serial-scan-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { acceptFulfillmentScans } from "@/lib/fulfillment-scans";
import { Checkbox } from "@/components/ui/checkbox";
import { ScannerInput } from "@/components/scanner-input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowLeft, ArrowRight, Camera, Check, ClipboardList, Loader2, MapPin, Printer, RotateCcw, ScanLine, Truck } from "lucide-react";
import { inventoryCapabilities } from "@shared/inventory-capabilities";

type FulfillmentOrder = {
  workOrderId: number; label: string; status: string; group: string; installerId: string | null; installer: string;
  scheduledDate: string; assignmentVersion: number; route: string; zone: string;
  lines: Array<{ itemId: string; quantity: number }>;
  missing: Array<{ equipment: string; typeId: number | string }>; eligible: boolean;
};
type FulfillmentResponse = { orders: FulfillmentOrder[]; batches: FulfillmentBatch[]; resumeStatus: Record<string, FulfillmentResumeStatus>; timezone: string };
type InventorySnapshot = { state: InventoryState; permissions: string[]; projectName?: string };
type PickTicketLookup = { batch: FulfillmentBatch; resume: { resumable: boolean; nextStep: "stage" | "vehicle"; reason?: string } };
type CorrectionDraftSnapshot = {
  readable: boolean;
  raw: string | null;
  saved: { edited?: boolean; pending?: { operationId?: string } | null; investigation?: unknown } | null;
};
function readCorrectionDraft(key: string | null): CorrectionDraftSnapshot {
  if (!key) return { readable: false, raw: null, saved: null };
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return { readable: true, raw: null, saved: null };
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value))
      return { readable: false, raw, saved: null };
    const record = value as CorrectionDraftSnapshot["saved"];
    if (record?.pending && typeof record.pending.operationId !== "string")
      return { readable: false, raw, saved: null };
    return { readable: true, raw, saved: record };
  } catch { return { readable: false, raw: null, saved: null }; }
}
function correctionPendingIsUnknown(snapshot: CorrectionDraftSnapshot, receipts: unknown[]) {
  const operationId = snapshot.saved?.pending?.operationId;
  if (!operationId) return false;
  return !receipts.some(receipt => !!receipt && typeof receipt === "object" &&
    (receipt as { id?: unknown }).id === operationId);
}
function correctionHasRetainedInputs(snapshot: CorrectionDraftSnapshot) {
  return !!snapshot.saved && (snapshot.saved.edited === true || !!snapshot.saved.investigation || !!snapshot.saved.pending);
}
type Receipt = { id: string; action: string; reference: string; occurredAt: string; actor: string; reason?: string; lines: Array<{ itemId: string; quantity: number; serials: string[] }> };
type PendingMove = {
  operationId: string;
  action: "fulfillmentMove" | "fulfillmentClose" | "fulfillmentReady" | "fulfillmentReassign";
  data: Record<string, unknown>;
};
type CreateAttempt = { operationId: string; id: string; data: Record<string, unknown> };
type Draft = {
  mode: "crew" | "scheduled" | "resume";
  step: "orders" | "review" | "stage" | "vehicle";
  name: string;
  selectedIds: number[];
  search: string;
  route: string;
  group: string;
  zone: string;
  installer: string;
  date: string;
  sourceId: string;
  stagingId: string;
  vehicleId: string;
  batchId: string;
  quantities: Record<string, string>;
  serialText: Record<string, string>;
  reason: string;
  physicallyConfirmed: boolean;
  closeReason: string;
  createAttempt: CreateAttempt | null;
  pending: PendingMove | null;
  reassignmentBatchId: string;
  reassignmentVehicleId: string;
  reassignmentReason: string;
};
const emptyDraft = (): Draft => ({
  mode: "crew", step: "orders", name: "", selectedIds: [], search: "", route: "", group: "", zone: "", installer: "", date: "",
  sourceId: "", stagingId: "", vehicleId: "", batchId: "", quantities: {}, serialText: {}, reason: "",
  physicallyConfirmed: false, closeReason: "", createAttempt: null, pending: null,
  reassignmentBatchId: "", reassignmentVehicleId: "", reassignmentReason: "",
});
const splitSerials = (value: string) => value.split(/[\n,;]/).map(item => item.trim()).filter(Boolean);
const quantityKey = (phase: string, itemId: string) => `${phase}:${itemId}`;
const unique = (values: string[]) => new Set(values).size === values.length;

export function FulfillmentWizard({ projectId, open, onOpenChange, pickTicketQr, onPickTicketQrConsumed, permissions }: {
  projectId: number; open: boolean; onOpenChange: (open: boolean) => void; pickTicketQr?: string; onPickTicketQrConsumed?: () => void; permissions?: string[];
}) {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [storageReady, setStorageReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectionNotice, setSelectionNotice] = useState("");
  const [showUnavailable, setShowUnavailable] = useState(false);
  const [confirmHandoff, setConfirmHandoff] = useState(false);
  const [serialSearch, setSerialSearch] = useState<Record<string, string>>({});
  const [scanNotices, setScanNotices] = useState<Record<string, string>>({});
  const [editingSerialKey, setEditingSerialKey] = useState<string | null>(null);
  const [showStart, setShowStart] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [showBlocked, setShowBlocked] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);
  const [requestedMode, setRequestedMode] = useState<Draft["mode"] | null>(null);
  const [checkedOnEntry, setCheckedOnEntry] = useState(false);
  const [finishedNotice, setFinishedNotice] = useState("");
  const [showSavedInputs, setShowSavedInputs] = useState(false);
  const [reassignmentBatchId, setReassignmentBatchId] = useState("");
  const [ticketInput, setTicketInput] = useState("");
  const [cameraRequest, setCameraRequest] = useState(0);
  const [ticketArrival, setTicketArrival] = useState(0);
  const ticketIdentityFocus = useRef<string | null>(null);
  const [ticketBusy, setTicketBusy] = useState(false);
  const [ticketConfirmBusy, setTicketConfirmBusy] = useState(false);
  const [requestedTicket, setRequestedTicket] = useState<PickTicketLookup | null>(null);
  const ticketSequence = useRef(0);
  const ticketInFlight = useRef(new Map<string, Promise<PickTicketLookup>>());
  const handledQr = useRef("");
  const ticketInteraction = useRef(false);
  const currentDraftRef = useRef(draft);
  currentDraftRef.current = draft;
  const [requestedTicketSnapshot, setRequestedTicketSnapshot] = useState("");
  const [requestedCorrectionSnapshot, setRequestedCorrectionSnapshot] = useState<string | null>(null);
  const wizardRef = useRef<HTMLDivElement>(null);
  const stepBodyRef = useRef<HTMLDivElement>(null);
  const dataKey = ["/api/projects", projectId, "inventory", "fulfillment"];
  const inventoryKey = [`/api/projects/${projectId}/inventory`];
  const storageKey = user?.id ? `meterflo:fulfillment:${encodeURIComponent(String(user.id))}:${projectId}` : null;
  const correctionStorageKey = user?.id
    ? `meterflo:staging-corrections:${encodeURIComponent(String(user.id))}:${projectId}`
    : null;
  const roleCan = (permission: string) => permissions !== undefined ? permissions.includes(permission) : hasPermission(permission);
  const roleCapabilities = inventoryCapabilities(roleCan);
  const inventory = useQuery<InventorySnapshot>({
    queryKey: inventoryKey,
    queryFn: async () => (await apiRequest("GET", `/api/projects/${projectId}/inventory`)).json(),
    enabled: open && roleCapabilities.fulfillment,
    staleTime: 0,
    refetchOnMount: "always",
  });
  const livePermissions = inventory.data?.permissions;
  const canPermission = (permission: string) => livePermissions !== undefined
    ? livePermissions.includes(permission)
    : roleCan(permission);
  const canViewWorkOrders = canPermission("workOrders.view");
  const canFulfill = inventoryCapabilities(canPermission).fulfillment;
  const canPost = canFulfill;
  const canCorrect = canPost && (canPermission("inventory.resolveExceptions") || canPermission("inventory.maintain") || canPermission("inventory.configure"));
  useInventoryEvents(open && canFulfill ? projectId : null);
  const fulfillment = useQuery<FulfillmentResponse>({
    queryKey: dataKey,
    queryFn: async () => (await apiRequest("GET", `/api/projects/${projectId}/inventory/fulfillment`)).json(),
    enabled: open && canFulfill && !!inventory.data,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    refetchOnWindowFocus: "always",
  });
  useEffect(() => {
    if (!reassignmentBatchId || !fulfillment.dataUpdatedAt) return;
    void queryClient.invalidateQueries({
      queryKey: [`/api/projects/${projectId}/inventory/fulfillment/${reassignmentBatchId}/reassignment`],
    });
  }, [reassignmentBatchId, fulfillment.dataUpdatedAt, projectId]);
  const orders = fulfillment.data?.orders ?? [];
  const state = inventory.data?.state;
  const items = state?.items ?? [];
  const warehouses = state?.warehouses ?? [];
  const receipts: Receipt[] = (state?.receipts ?? []) as Receipt[];
  const activeBatch = fulfillment.data?.batches.find(batch => batch.id === draft.batchId) as (FulfillmentBatch & { pickupReady?: boolean }) | undefined;
  const activeBatchPosition = state?.fulfillmentBatches?.findIndex(batch => batch.id === activeBatch?.id) ?? -1;
  const activeTicketNumber = activeBatch && activeBatchPosition >= 0
    ? fulfillmentTicketNumber(activeBatch.createdAt, activeBatchPosition) : null;
  const activeResume = activeBatch ? fulfillment.data?.resumeStatus?.[activeBatch.id] : undefined;
  const movementBlocked = !!activeBatch && !!activeResume &&
    (!activeResume.resumable || draft.step === "stage" && activeResume.nextStep === "vehicle");
  const resumableBatches = (fulfillment.data?.batches ?? []).filter(batch =>
    batch.status === "active" && fulfillment.data?.resumeStatus?.[batch.id]?.resumable);
  const blockedBatches = (fulfillment.data?.batches ?? []).filter(batch =>
    batch.status === "active" && !fulfillment.data?.resumeStatus?.[batch.id]?.resumable);
  const savedOutcome = useMemo(() => reconcileFulfillmentDraft(draft, fulfillment.data?.batches ?? [], orders), [draft, fulfillment.data]);
  const orderMap = useMemo(() => new Map(orders.map(order => [order.workOrderId, order])), [orders]);
  const selectedOrders = useMemo(() => draft.selectedIds.map(id => orderMap.get(id)).filter((order): order is FulfillmentOrder => !!order), [draft.selectedIds, orderMap]);
  const activeItems = useMemo(() => items.filter(item => item.active && item.kind !== "labor"), [items]);
  const itemMap = useMemo(() => new Map(activeItems.map(item => [item.id, item])), [activeItems]);
  const projectDate = (value: string) => {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return value;
    try {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: fulfillment.data?.timezone || "UTC" }).format(parsed);
    } catch {
      return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed);
    }
  };
  const projectDateKey = (value: string) => {
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return value.slice(0, 10);
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        year: "numeric", month: "2-digit", day: "2-digit", timeZone: fulfillment.data?.timezone || "UTC",
      }).formatToParts(parsed);
      const part = (type: string) => parts.find(entry => entry.type === type)?.value ?? "";
      return `${part("year")}-${part("month")}-${part("day")}`;
    } catch {
      return parsed.toISOString().slice(0, 10);
    }
  };
  const filteredOrders = useMemo(() => {
    const query = draft.search.trim().toLowerCase();
    return orders.filter(order => {
      const status = order.status.toLowerCase();
      if (draft.mode === "crew" && status !== "open") return false;
      if (draft.mode === "scheduled" && status !== "scheduled") return false;
      if (draft.mode === "scheduled" && draft.date && projectDateKey(order.scheduledDate) !== draft.date) return false;
      if (draft.route && order.route !== draft.route) return false;
      if (draft.group && order.group !== draft.group) return false;
      if (draft.zone && order.zone !== draft.zone) return false;
      if (draft.installer && order.installerId !== draft.installer) return false;
      return !query || [order.label, order.group, order.installer, order.route, order.zone, String(order.workOrderId)].some(value => value.toLowerCase().includes(query));
    });
  }, [orders, draft.mode, draft.date, draft.route, draft.group, draft.zone, draft.installer, draft.search, fulfillment.data?.timezone]);
  const allowedLocations = useMemo(() => warehouses.filter(location =>
    warehouseAccessible(state ?? { locationTypes: [] }, location, user?.id ? String(user.id) : undefined, user?.role === "admin")), [warehouses, state, user?.id, user?.role]);
  const sourceLocations = allowedLocations.filter(location => location.active && location.type === "physical");
  const stagingLocations = allowedLocations.filter(location => {
    const type = state ? locationTypeFor(state, location) : undefined;
    return location.active && location.type === "physical" && isStagingType(type);
  });
  const vehicles = allowedLocations.filter(location => location.active && location.type === "vehicle");

  useEffect(() => {
    if (!open) {
      setStorageReady(false);
      setCheckedOnEntry(false);
      return;
    }
    if (!storageKey) return;
    setConfirmHandoff(false);
    setShowStart(true);
    setShowHistory(false);
    setShowBlocked(false);
    setShowCorrections(false);
    setRequestedMode(null);
    setCheckedOnEntry(false);
    setFinishedNotice("");
    setShowSavedInputs(false);
    setReassignmentBatchId("");
    setScanNotices({});
    setEditingSerialKey(null);
    setStorageReady(false);
    try {
      const saved = window.localStorage.getItem(storageKey);
      const parsed = saved ? JSON.parse(saved) as Partial<Draft> : null;
      setDraft({ ...emptyDraft(), ...parsed, pending: parsed?.pending ?? null });
      setReassignmentBatchId(parsed?.reassignmentBatchId ?? "");
      setShowStart(true);
    } catch {
      setDraft(emptyDraft());
      setError("Saved workflow inputs could not be read. A fresh draft is available; no inventory move was sent.");
    }
    setStorageReady(true);
  }, [storageKey, open]);
  useEffect(() => {
    if (open) setShowUnavailable(false);
  }, [open]);
  useEffect(() => {
    if (open && inventory.isFetchedAfterMount && !inventory.isFetching && !canFulfill) {
      onOpenChange(false);
    }
    else if (open && !inventory.data && !roleCapabilities.fulfillment) onOpenChange(false);
  }, [open, inventory.isFetchedAfterMount, inventory.isFetching, inventory.data, canFulfill, roleCapabilities.fulfillment, onOpenChange]);
  useEffect(() => { setSerialSearch({}); }, [open, draft.batchId, draft.step]);
  useEffect(() => {
    if (!storageKey || !storageReady) return;
    try {
      if (hasMeaningfulFulfillmentWork(draft) || draft.reassignmentVehicleId || draft.reassignmentReason.trim())
        window.localStorage.setItem(storageKey, JSON.stringify(draft));
      else window.localStorage.removeItem(storageKey);
    }
    catch { setError("Browser storage is unavailable. Physical moves stay disabled until their exact retry identity can be saved."); }
  }, [storageKey, storageReady, draft]);
  useEffect(() => {
    if (draft.pending && receipts.some(receipt => receipt.id === draft.pending?.operationId)) {
      const completedPending = draft.pending;
      setDraft(current => ({ ...current, pending: null, quantities: {}, serialText: {}, reason: "", physicallyConfirmed: false, closeReason: "" }));
      void queryClient.invalidateQueries({ queryKey: dataKey });
      void queryClient.invalidateQueries({ queryKey: inventoryKey });
    if (completedPending.action === "fulfillmentReassign") finishReassignment(completedPending.data);
    }
  }, [draft.pending, receipts, projectId]);
  useEffect(() => {
    if (!open || !storageReady || busy || !inventory.isFetchedAfterMount || !fulfillment.isFetchedAfterMount ||
      inventory.isFetching || fulfillment.isFetching || inventory.isError || fulfillment.isError) return;
    setCheckedOnEntry(true);
    if (!ticketInteraction.current && showStart && savedOutcome.kind === "clear") {
      setFinishedNotice(`The saved work is already ${savedOutcome.status}. Completed history and receipts are available under Completed batches.`);
      setDraft(emptyDraft());
    }
  }, [open, storageReady, busy, showStart, savedOutcome, inventory.isFetchedAfterMount, fulfillment.isFetchedAfterMount,
    inventory.isFetching, fulfillment.isFetching, inventory.isError, fulfillment.isError]);
  useEffect(() => {
    if (!open || !canViewWorkOrders) return;
    const refresh = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: dataKey });
      void queryClient.invalidateQueries({ queryKey: inventoryKey });
    }, 10_000);
    return () => window.clearInterval(refresh);
  }, [open, canViewWorkOrders, projectId]);

  const update = (changes: Partial<Draft>) => setDraft(current => ({ ...current, ...changes }));
  const changeTicketInput = (value: string) => {
    ticketSequence.current += 1;
    setTicketBusy(false);
    setTicketInput(value);
  };
  const reset = () => {
    if (draft.pending || draft.createAttempt) return;
    setDraft(emptyDraft());
    setError("");
  };
  const showTicketHistory = (ticket: PickTicketLookup) => {
    setFinishedNotice(`This batch is ${ticket.batch.status}. It is read-only; review its record in Completed batches. Scanning did not move stock.`);
    setShowCorrections(false);
    setReassignmentBatchId("");
    setShowStart(true);
    setShowBlocked(false);
    setShowHistory(true);
    setError("");
  };
  const showTicketReview = (ticket: PickTicketLookup) => {
    setShowCorrections(false);
    setReassignmentBatchId("");
    setShowStart(false);
    setShowHistory(false);
    setShowBlocked(true);
    setError(ticket.resume.reason || "This batch needs review before it can be resumed. No stock was moved.");
  };
  const lookupPickTicket = async (raw: string) => {
    const sequence = ++ticketSequence.current;
    setTicketBusy(false);
    setTicketConfirmBusy(false);
    setRequestedTicket(null);
    setRequestedTicketSnapshot("");
    setRequestedCorrectionSnapshot(null);
    const parsed = parsePickTicketQr(raw, projectId);
    if (parsed.kind === "invalid") {
      setError("That code is not a supported pick ticket. Scan its printed QR again or paste the complete ticket link.");
      return;
    }
    if (parsed.kind === "wrong_project") {
      setError(`This pick ticket belongs to project ${parsed.projectId}, not project ${projectId}. Open that project’s Inventory before scanning.`);
      return;
    }
    if (draft.pending || draft.createAttempt) {
      setError("A saved stock operation or batch-creation attempt still has an unknown outcome. Resolve that exact attempt before switching tickets.");
      return;
    }
    const correctionSnapshot = readCorrectionDraft(correctionStorageKey);
    if (!correctionSnapshot.readable) {
      setError("Saved pickup-correction inputs could not be checked safely. Keep them intact and retry after storage is available.");
      return;
    }
    ticketInteraction.current = true;
    const draftSnapshot = JSON.stringify(currentDraftRef.current);
    const key = `${projectId}:${parsed.batchId}`;
    setTicketBusy(true);
    setError("");
    try {
      let request = ticketInFlight.current.get(key);
      if (!request) {
        request = apiRequest("GET", `/api/projects/${projectId}/inventory/fulfillment/${encodeURIComponent(parsed.batchId)}/ticket`)
          .then(response => response.json() as Promise<PickTicketLookup>);
        ticketInFlight.current.set(key, request);
      }
      const result = await request;
      if (sequence !== ticketSequence.current) return;
      const [freshInventory, freshFulfillment] = await Promise.all([inventory.refetch(), fulfillment.refetch()]);
      if (sequence !== ticketSequence.current) return;
      if (JSON.stringify(currentDraftRef.current) !== draftSnapshot) {
        setError("Your workflow inputs changed while the ticket was loading. They were kept; scan or paste the ticket again to continue.");
        return;
      }
      if (freshInventory.isError || freshFulfillment.isError || !freshInventory.data || !freshFulfillment.data) {
        setError("Ticket details were found, but a fresh inventory and fulfillment refresh did not complete. Your workflow inputs were kept; retry before continuing.");
        return;
      }
      const currentCorrection = readCorrectionDraft(correctionStorageKey);
      if (!currentCorrection.readable || currentCorrection.raw !== correctionSnapshot.raw) {
        setError("Pickup-correction captures changed while the ticket was loading. They were kept; scan or paste the ticket again after reviewing them.");
        return;
      }
      const freshReceipts = (freshInventory.data.state.receipts ?? []) as unknown[];
      if (correctionPendingIsUnknown(currentCorrection, freshReceipts)) {
        setError("A saved pickup-correction command has no matching receipt yet. Its exact identity and inputs remain protected; resolve that command before switching tickets.");
        return;
      }
      const freshBatch = freshFulfillment.data?.batches.find(batch => batch.id === parsed.batchId);
      if (!freshBatch) {
        setError("The ticket was found, but its batch is not visible in the refreshed fulfillment list. Check your project access and retry.");
        return;
      }
      const ticket = { ...result, batch: freshBatch };
      if (ticket.batch.status === "completed" || ticket.batch.status === "cancelled") {
        showTicketHistory(ticket);
        return;
      }
      if (ticket.batch.status !== "active" || !ticket.resume.resumable) {
        showTicketReview(ticket);
        return;
      }
      const correctionRetained = correctionHasRetainedInputs(currentCorrection);
      const hasRetainedWork = hasMeaningfulFulfillmentWork(draft) || !!draft.reassignmentBatchId || correctionRetained;
      const changesSavedWork = draft.batchId !== parsed.batchId || !!draft.reassignmentBatchId ||
        showCorrections || correctionRetained || draft.step !== ticket.resume.nextStep;
      if (hasRetainedWork && changesSavedWork) {
        setRequestedTicket(ticket);
        setRequestedTicketSnapshot(draftSnapshot);
        setRequestedCorrectionSnapshot(currentCorrection.raw);
        return;
      }
      if (hasMeaningfulFulfillmentWork(draft) && draft.batchId === parsed.batchId) {
        ticketIdentityFocus.current = ticket.batch.id;
        setTicketArrival(value => value + 1);
        setDraft(current => ({ ...current, mode: "resume", step: ticket.resume.nextStep }));
        setShowStart(false);
        setShowHistory(false);
        setError("");
        return;
      }
      applyPickTicket(ticket);
    } catch (cause) {
      if (sequence !== ticketSequence.current) return;
      const message = cause instanceof Error ? cause.message : "";
      if (message.startsWith("403")) setError("You do not have permission to open this pick ticket. Ask a project administrator for fulfillment access.");
      else if (message.startsWith("404")) setError("This pick ticket is not available in this project. Verify the printed ticket or ask a project administrator.");
      else setError(`The pick ticket could not be refreshed (${message || "connection error"}). Your saved inputs were kept; retry when inventory is available.`);
    } finally {
      if (ticketInFlight.current.get(key)) ticketInFlight.current.delete(key);
      if (sequence === ticketSequence.current) setTicketBusy(false);
    }
  };
  const applyPickTicket = (ticket: PickTicketLookup) => {
    if (draft.pending || draft.createAttempt) return;
    ticketIdentityFocus.current = ticket.batch.id;
    setTicketArrival(value => value + 1);
    setDraft({ ...emptyDraft(), mode: "resume", step: ticket.resume.nextStep, batchId: ticket.batch.id, name: ticket.batch.name });
    setReassignmentBatchId("");
    setShowCorrections(false);
    setShowBlocked(false);
    setShowHistory(false);
    setShowStart(false);
    setRequestedTicket(null);
    setRequestedTicketSnapshot("");
    setRequestedCorrectionSnapshot(null);
    setFinishedNotice("");
    setError("");
  };
  const confirmPickTicketReplacement = async () => {
    const candidate = requestedTicket;
    if (!candidate || ticketConfirmBusy || busy || draft.pending || draft.createAttempt) return;
    const sequence = ++ticketSequence.current;
    setTicketConfirmBusy(true);
    setError("");
    const currentCorrection = readCorrectionDraft(correctionStorageKey);
    if (!currentCorrection.readable || JSON.stringify(currentDraftRef.current) !== requestedTicketSnapshot ||
      currentCorrection.raw !== requestedCorrectionSnapshot) {
      setRequestedTicket(null);
      setRequestedTicketSnapshot("");
      setRequestedCorrectionSnapshot(null);
      setError("Workflow or pickup-correction inputs changed while confirmation was open. They were kept; scan or paste the ticket again.");
      setTicketConfirmBusy(false);
      return;
    }
    try {
      const response = await apiRequest("GET", `/api/projects/${projectId}/inventory/fulfillment/${encodeURIComponent(candidate.batch.id)}/ticket`);
      const latestTicket = await response.json() as PickTicketLookup;
      if (sequence !== ticketSequence.current) return;
      const [freshInventory, freshFulfillment] = await Promise.all([inventory.refetch(), fulfillment.refetch()]);
      if (sequence !== ticketSequence.current) return;
      const finalCorrection = readCorrectionDraft(correctionStorageKey);
      if (JSON.stringify(currentDraftRef.current) !== requestedTicketSnapshot ||
        !finalCorrection.readable || finalCorrection.raw !== requestedCorrectionSnapshot) {
        setRequestedTicket(null);
        setRequestedTicketSnapshot("");
        setRequestedCorrectionSnapshot(null);
        setError("Workflow or pickup-correction inputs changed during the final ticket check. They were kept; scan or paste again.");
        return;
      }
      if (freshInventory.isError || freshFulfillment.isError || !freshInventory.data || !freshFulfillment.data) {
        setError("A fresh inventory and fulfillment check could not complete. Nothing was replaced; retry the confirmation.");
        return;
      }
      const freshReceipts = (freshInventory.data.state.receipts ?? []) as unknown[];
      if (correctionPendingIsUnknown(finalCorrection, freshReceipts)) {
        setError("A saved pickup-correction command still has no matching receipt. Its identity and inputs remain protected; resolve it before confirming this ticket.");
        return;
      }
      const freshBatch = freshFulfillment.data.batches.find(batch => batch.id === candidate.batch.id);
      if (!freshBatch) {
        setError("The ticket is no longer visible in the refreshed fulfillment list. Verify project access and retry.");
        return;
      }
      const ticket = { ...latestTicket, batch: freshBatch };
      if (ticket.batch.status === "completed" || ticket.batch.status === "cancelled") {
        setRequestedTicket(null);
        setRequestedTicketSnapshot("");
        setRequestedCorrectionSnapshot(null);
        showTicketHistory(ticket);
        return;
      }
      if (ticket.batch.status !== "active" || !ticket.resume.resumable) {
        setRequestedTicket(null);
        setRequestedTicketSnapshot("");
        setRequestedCorrectionSnapshot(null);
        showTicketReview(ticket);
        return;
      }
      applyPickTicket(ticket);
    } catch (cause) {
      if (sequence !== ticketSequence.current) return;
      const message = cause instanceof Error ? cause.message : "";
      if (message.startsWith("403")) setError("You do not have permission to open this pick ticket. Your saved inputs remain unchanged.");
      else if (message.startsWith("404")) setError("This pick ticket is no longer available. Your saved inputs remain unchanged.");
      else setError(`The final ticket check failed (${message || "connection error"}). Nothing was replaced; retry the confirmation.`);
    } finally {
      if (sequence === ticketSequence.current) setTicketConfirmBusy(false);
    }
  };
  useEffect(() => {
    if (!pickTicketQr) { handledQr.current = ""; return; }
    // A scan can arrive while the dialog is closed. Hydrate saved captures and
    // finish the entry refresh before taking the lookup's edit-safety snapshot.
    if (!open || !storageReady || !checkedOnEntry) return;
    if (pickTicketQr === handledQr.current) return;
    handledQr.current = pickTicketQr;
    setTicketInput(pickTicketQr);
    void lookupPickTicket(pickTicketQr);
    onPickTicketQrConsumed?.();
  }, [pickTicketQr, open, storageReady, checkedOnEntry]);
  const hasSavedProgress = hasMeaningfulFulfillmentWork(draft);
  const startMode = (mode: Draft["mode"]) => {
    if (draft.pending || draft.createAttempt || busy) return;
    setDraft({ ...emptyDraft(), mode });
    setError("");
    setFinishedNotice("");
    setShowSavedInputs(false);
    setRequestedMode(null);
    setShowStart(false);
  };
  const close = (next: boolean) => {
    if (!next && busy) return;
    onOpenChange(next);
    if (!next) setError("");
  };
  const selectedOrderIds = (ids: number[]) => update({ selectedIds: ids });
  const demand = useMemo(() => {
    const totals = new Map<string, number>();
    for (const order of selectedOrders) for (const line of order.lines) {
      if (itemMap.get(line.itemId)?.kind === "labor") continue;
      totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + line.quantity);
    }
    return [...totals.entries()].map(([itemId, quantity]) => ({ itemId, quantity, item: itemMap.get(itemId) }))
      .sort((a, b) => (a.item?.name ?? a.itemId).localeCompare(b.item?.name ?? b.itemId));
  }, [selectedOrders, itemMap]);
  const batchDemand = useMemo(() => {
    const totals = new Map<string, { total: number; staged: number; delivered: number; serials: string[]; deliveredSerials: string[] }>();
    for (const line of activeBatch?.lines ?? []) {
      const row = totals.get(line.itemId) ?? { total: 0, staged: 0, delivered: 0, serials: [], deliveredSerials: [] };
      row.total += line.quantity;
      row.staged += line.stagedQuantity;
      row.delivered += line.deliveredQuantity;
      row.serials.push(...line.stagedSerials);
      row.deliveredSerials.push(...line.deliveredSerials);
      totals.set(line.itemId, row);
    }
    return [...totals.entries()].map(([itemId, values]) => ({ itemId, ...values, item: itemMap.get(itemId) }))
      .filter(row => !!row.item && row.item.kind !== "labor")
      .sort((a, b) => (a.item?.name ?? a.itemId).localeCompare(b.item?.name ?? b.itemId));
  }, [activeBatch, itemMap]);
  const sourceAvailability = useMemo(() => batchDemand.map(row => {
    const batchWorkOrderIds = new Set(activeBatch?.mode === "scheduled"
      ? activeBatch.workOrders.map(workOrder => workOrder.workOrderId) : []);
    const onHand = state?.stock.filter(stock => stock.warehouseId === activeBatch?.sourceId && stock.itemId === row.itemId)
      .reduce((sum, stock) => sum + stock.quantity, 0) ?? 0;
    const allocationHolds = state?.allocations.filter(allocation => allocation.status === "reserved")
      .filter(allocation => !batchWorkOrderIds.has(allocation.workOrderId))
      .flatMap(allocation => allocation.lines)
      .filter(line => line.warehouseId === activeBatch?.sourceId && line.itemId === row.itemId)
      .reduce((sum, line) => sum + line.quantity, 0) ?? 0;
    const crewBatchHolds = state && activeBatch?.sourceId ? fulfillmentReserved(state, activeBatch.sourceId, row.itemId) : 0;
    const held = allocationHolds + crewBatchHolds;
    const available = Math.max(0, onHand - held);
    const remaining = row.total - row.staged;
    return { ...row, onHand, held, available, shortage: Math.max(0, remaining - available), remaining };
  }), [batchDemand, state, activeBatch?.sourceId]);
  const stageRemaining = (row: typeof batchDemand[number]) => row.total - row.staged;
  const vehicleRemaining = (row: typeof batchDemand[number]) => row.staged - row.delivered;
  const batchCanReleaseRemainder = !!activeBatch && activeBatch.status === "active";
  const stagingComplete = batchCanReleaseRemainder && batchDemand.length > 0 && batchDemand.every(row => stageRemaining(row) <= 0);
  const hasStagedStock = batchCanReleaseRemainder && batchDemand.some(row => vehicleRemaining(row) > 0);
  const hasUnrecordedMove = Object.values(draft.quantities).some(value => value.trim() !== "" && value.trim() !== "0") ||
    Object.values(draft.serialText).some(value => value.trim() !== "") || !!draft.reason.trim() || draft.physicallyConfirmed || !!draft.closeReason.trim();
  const showMoveForm = draft.step !== "stage" || !stagingComplete || hasUnrecordedMove;
  const selectionConstraintError = draft.mode === "crew"
    ? (selectedOrders.some(order => !order.group) || new Set(selectedOrders.map(order => order.group)).size > 1
      ? "A crew batch can contain work from one non-empty group only." : "")
    : draft.mode === "scheduled"
      ? (selectedOrders.some(order => !order.installerId) || new Set(selectedOrders.map(order => order.installerId)).size > 1
        ? "A scheduled batch can contain work for one assigned installer only." : "")
      : "";
  const isOrderSelectable = (order: FulfillmentOrder) => order.eligible && order.missing.length === 0 && order.lines.length > 0;
  const unavailableMatchingOrders = filteredOrders.filter(order => !isOrderSelectable(order));
  const visibleOrders = showUnavailable ? filteredOrders : filteredOrders.filter(isOrderSelectable);
  const eligibleMatchingOrders = filteredOrders.filter(isOrderSelectable);
  const eligibleMatchingIds = new Set(eligibleMatchingOrders.map(order => order.workOrderId));
  const selectedMatchingCount = eligibleMatchingOrders.filter(order => draft.selectedIds.includes(order.workOrderId)).length;
  const allMatchingSelected = eligibleMatchingOrders.length > 0 && selectedMatchingCount === eligibleMatchingOrders.length;
  const hiddenSelectionCount = draft.selectedIds.filter(id => !eligibleMatchingIds.has(id)).length;
  const unresolvedSelection = draft.selectedIds.some(id => !orderMap.has(id));
  const bulkIdentityError = (() => {
    if (allMatchingSelected || !eligibleMatchingOrders.length) return "";
    if (draft.mode === "crew") {
      const targetGroups = new Set(eligibleMatchingOrders.map(order => order.group).filter(Boolean));
      if (targetGroups.size > 1 || eligibleMatchingOrders.some(order => !order.group))
        return "Filter to one crew/group before selecting all matching orders.";
      if (unresolvedSelection) return "Some selected orders are no longer available to verify. Clear selection before adding this group.";
      const groups = new Set([...selectedOrders.map(order => order.group), ...eligibleMatchingOrders.map(order => order.group)]);
      if (groups.size > 1 || [...groups].some(group => !group))
        return "Selected orders include another crew/group. Clear or filter the selection before adding this group.";
    } else if (draft.mode === "scheduled") {
      const targetInstallers = new Set(eligibleMatchingOrders.map(order => order.installerId).filter((id): id is string => !!id));
      if (targetInstallers.size > 1 || eligibleMatchingOrders.some(order => !order.installerId))
        return "Filter to one installer before selecting all matching orders.";
      if (unresolvedSelection) return "Some selected orders are no longer available to verify. Clear selection before adding this installer.";
      const installers = new Set([...selectedOrders.map(order => order.installerId), ...eligibleMatchingOrders.map(order => order.installerId)]);
      if (installers.size > 1 || [...installers].some(installer => !installer))
        return "Selected orders include another installer. Clear or filter the selection before adding this installer.";
    }
    return "";
  })();
  const bulkAddWouldExceedLimit = !allMatchingSelected &&
    new Set([...draft.selectedIds, ...eligibleMatchingOrders.map(order => order.workOrderId)]).size > 500;
  const bulkSelectionDisabled = !eligibleMatchingOrders.length || !!draft.pending || !!draft.createAttempt ||
    (!allMatchingSelected && (!!bulkIdentityError || bulkAddWouldExceedLimit));
  const handleSelectAllMatching = () => {
    if (!eligibleMatchingOrders.length || draft.pending || draft.createAttempt) return;
    if (allMatchingSelected) {
      const matchingIds = new Set(eligibleMatchingOrders.map(order => order.workOrderId));
      update({ selectedIds: draft.selectedIds.filter(id => !matchingIds.has(id)) });
      setSelectionNotice("");
      return;
    }
    if (bulkIdentityError) { setSelectionNotice(bulkIdentityError); return; }
    const nextIds = [...new Set([...draft.selectedIds, ...eligibleMatchingOrders.map(order => order.workOrderId)])];
    if (nextIds.length > 500) {
      setSelectionNotice("A batch is limited to 500 work orders. Refine the filters or clear/remove selections; no orders were added.");
      return;
    }
    update({ selectedIds: nextIds });
    setSelectionNotice("");
  };
  const pendingLock = !!draft.pending;
  const createLock = !!draft.createAttempt;
  const canCreate = canPost && !!draft.name.trim() && selectedOrders.length > 0 && selectedOrders.length === draft.selectedIds.length &&
    selectedOrders.every(order => order.eligible && !order.missing.length && order.lines.length > 0) &&
    !selectionConstraintError && !!draft.sourceId && !!draft.stagingId && !!draft.vehicleId &&
    new Set([draft.sourceId, draft.stagingId, draft.vehicleId]).size === 3 && !pendingLock;

  const createBatch = async () => {
    const savedAttempt = draft.createAttempt;
    if (busy || !storageReady || !canPost || (!savedAttempt && !canCreate)) return;
    const attempt = draft.createAttempt ?? {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      data: { name: draft.name.trim(), mode: draft.mode, sourceId: draft.sourceId, stagingId: draft.stagingId, vehicleId: draft.vehicleId,
        workOrders: selectedOrders.map(order => ({ workOrderId: order.workOrderId, assignmentVersion: order.assignmentVersion })) },
    };
    const saved = { ...draft, createAttempt: attempt };
    if (!storageKey) { setError("A signed-in user is required to safely save this batch attempt."); return; }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(saved));
      setDraft(saved);
    } catch {
      setError("Could not save this batch attempt before sending. The batch was not created.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (savedAttempt) {
        try {
          const latest = await queryClient.fetchQuery({
            queryKey: dataKey,
            queryFn: async () => (await apiRequest("GET", `/api/projects/${projectId}/inventory/fulfillment`)).json(),
            staleTime: 0,
          }) as FulfillmentResponse;
          if (latest.batches.some(batch => batch.id === attempt.id)) {
            await queryClient.invalidateQueries({ queryKey: dataKey });
            await queryClient.invalidateQueries({ queryKey: inventoryKey });
            update({ batchId: attempt.id, step: "stage", createAttempt: null });
            return;
          }
        } catch {
          // If reconciliation is unavailable, the original idempotent create is still safe to replay.
        }
      }
      await apiRequest("POST", `/api/projects/${projectId}/inventory/commands`, {
        operationId: attempt.operationId, action: "fulfillmentCreate",
        data: { id: attempt.id, ...attempt.data },
      });
      await Promise.all([queryClient.invalidateQueries({ queryKey: dataKey }), queryClient.invalidateQueries({ queryKey: inventoryKey })]);
      update({ batchId: attempt.id, step: "stage", createAttempt: null });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not create the saved batch. Your selections are retained.";
      const status = Number(message.match(/^\s*(\d{3}):/)?.[1] ?? 0);
      if (status >= 400 && status < 500 && status !== 403) update({ createAttempt: null });
      setError(status === 403
        ? "Permissions changed. This exact batch attempt and its inputs are retained; restore access and retry it."
        : status >= 400 && status < 500
          ? `${message} The server rejected this batch; your selections remain available.`
          : "Batch creation outcome is unknown. This exact batch identity is saved; retry it before starting another.");
    } finally { setBusy(false); }
  };
  const receiptFound = async (operationId: string) => {
    try {
      const latest = await queryClient.fetchQuery({
        queryKey: inventoryKey,
        queryFn: async () => (await apiRequest("GET", `/api/projects/${projectId}/inventory`)).json(),
        staleTime: 0,
      }) as InventorySnapshot;
      return ((latest.state?.receipts ?? []) as Receipt[]).some(receipt => receipt.id === operationId);
    } catch { return false; }
  };
  const sendPending = async (pendingOverride?: PendingMove) => {
    const pending = pendingOverride ?? draft.pending;
    if (!pending || busy || !canPost) return;
    setBusy(true);
    setError("");
    try {
      if (await receiptFound(pending.operationId)) {
        update({ pending: null, quantities: {}, serialText: {}, reason: "", physicallyConfirmed: false, closeReason: "" });
        await Promise.all([queryClient.invalidateQueries({ queryKey: dataKey }), queryClient.invalidateQueries({ queryKey: inventoryKey })]);
        if (pending.action === "fulfillmentReassign") finishReassignment(pending.data);
        return;
      }
      await apiRequest("POST", `/api/projects/${projectId}/inventory/commands`, {
        operationId: pending.operationId, action: pending.action, data: pending.data,
      });
      update({ pending: null, quantities: {}, serialText: {}, reason: "", physicallyConfirmed: false, closeReason: "" });
      await Promise.all([queryClient.invalidateQueries({ queryKey: dataKey }), queryClient.invalidateQueries({ queryKey: inventoryKey })]);
      if (pending.action === "fulfillmentReassign") finishReassignment(pending.data);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Movement outcome is unknown.";
      const status = Number(message.match(/^\s*(\d{3}):/)?.[1] ?? 0);
      if (status >= 400 && status < 500 && status !== 403) {
        update({ pending: null });
        setError(`${message} The server rejected this command. Its inputs remain available to correct.`);
      } else if (status === 403) {
        setError("Permissions changed. The exact movement identity and inputs are retained; restore access, check for its receipt, then retry the same command.");
      } else {
        setError("Movement outcome is unknown. Inputs are locked; check the matching receipt or retry this exact operation ID before beginning another move.");
      }
    } finally { setBusy(false); }
  };
  const finishReassignment = (data: Record<string, unknown>) => {
    const id = String(data.id ?? "");
    const batch = fulfillment.data?.batches.find(entry => entry.id === id);
    const nextStep = batch?.lines.some(line => line.quantity > line.stagedQuantity) ? "stage" : "vehicle";
    setReassignmentBatchId("");
    setShowStart(false);
    setShowBlocked(false);
    update({ batchId: id, mode: "resume", step: nextStep, reassignmentBatchId: "", reassignmentVehicleId: "", reassignmentReason: "" });
  };
  const submitReassignment = (review: ReassignmentReview, vehicleId: string, reason: string) => {
    if (!canPost || busy || pendingLock || hasUnrecordedMove || !storageKey || !review.canApply) return;
    const pending: PendingMove = {
      operationId: crypto.randomUUID(), action: "fulfillmentReassign",
      data: { id: review.batchId, revision: review.revision, vehicleId,
        workOrders: review.orders.map(order => ({ workOrderId: order.workOrderId, assignmentVersion: order.assignmentVersion })),
        reason, confirmed: true },
    };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ ...draft, pending }));
      setDraft(current => ({ ...current, pending }));
    } catch {
      setError("Could not save the exact reassignment command before sending. No reassignment was sent.");
      return;
    }
    void sendPending(pending);
  };
  const submitMove = async (phase: "stage" | "vehicle") => {
    if (movementBlocked) { setError(activeResume?.reason ?? "This batch needs review before another stock movement."); return; }
    if (!activeBatch || !canPost || busy || pendingLock) return;
    if (!draft.reason.trim() || draft.reason.trim().length < 10 || !draft.physicallyConfirmed) return;
    const rows = batchDemand.map(row => {
      const remaining = phase === "stage" ? stageRemaining(row) : vehicleRemaining(row);
      const source = sourceAvailability.find(balance => balance.itemId === row.itemId);
      const moveLimit = phase === "stage" ? Math.min(remaining, source?.available ?? 0) : remaining;
      const quantity = Number(draft.quantities[quantityKey(phase, row.itemId)] ?? "0");
      const serials = splitSerials(draft.serialText[quantityKey(phase, row.itemId)] ?? "");
      return { row, remaining, moveLimit, quantity, serials };
    }).filter(entry => entry.quantity > 0);
    if (!rows.length || rows.some(({ row, moveLimit, quantity, serials }) =>
      !Number.isInteger(quantity) || quantity < 1 || quantity > moveLimit ||
      (row.item?.tracking === "serialized" && (serials.length !== quantity || !unique(serials))))) {
      setError("Enter a quantity within the remaining demand and currently available source stock. Serialized quantity must match unique custody serials exactly.");
      return;
    }
    const allExisting = phase === "stage" ? batchDemand.flatMap(row => row.serials) : batchDemand.flatMap(row => row.deliveredSerials);
    const submitted = rows.flatMap(row => row.serials);
    if (!unique(submitted) || submitted.some(serial => allExisting.includes(serial))) {
      setError("A custody serial is duplicated in this batch or move. Each physical unit may move only once.");
      return;
    }
    if (phase === "vehicle") {
      const staged = new Set(batchDemand.flatMap(row => row.serials));
      if (submitted.some(serial => !staged.has(serial))) {
        setError("Vehicle handoff serials must already be staged in this batch.");
        return;
      }
    }
    const pending: PendingMove = {
      operationId: crypto.randomUUID(), action: "fulfillmentMove",
      data: { id: activeBatch.id, revision: activeBatch.revision, phase,
        lines: rows.map(entry => ({ itemId: entry.row.itemId, quantity: entry.quantity, serials: entry.serials })),
        reason: draft.reason.trim(), physicallyConfirmed: true },
    };
    if (!storageKey) { setError("A signed-in user is required to safely save a retry identity. No move was sent."); return; }
    try {
      const saved = { ...draft, pending };
      window.localStorage.setItem(storageKey, JSON.stringify(saved));
      setDraft(saved);
    } catch {
      setError("Could not save this exact move in browser storage. No movement was sent.");
      return;
    }
    await sendPending(pending);
  };
  const cancelRemainder = async () => {
    if (!activeBatch || !canPost || !batchCanReleaseRemainder || draft.closeReason.trim().length < 10 || busy || pendingLock) return;
    if (!window.confirm("Release this batch’s unfinished remainder? Staged-but-undelivered units will remain physically at Staging and their holds will be released. This is not a physical return. Delivered units stay with the vehicle.")) return;
    const pending: PendingMove = { operationId: crypto.randomUUID(), action: "fulfillmentClose",
      data: { id: activeBatch.id, revision: activeBatch.revision, reason: draft.closeReason.trim() } };
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ ...draft, pending }));
      setDraft(current => ({ ...current, pending }));
    } catch { setError("Could not save this exact close command. No batch change was sent."); return; }
    await sendPending(pending);
  };
  const changeSelection = (id: number) => {
    if (draft.pending || draft.createAttempt) return;
    const order = orderMap.get(id);
    if (!draft.selectedIds.includes(id) && (!order || !isOrderSelectable(order))) return;
    if (!draft.selectedIds.includes(id) && draft.selectedIds.length >= 500) {
      setSelectionNotice("A batch is limited to 500 work orders. Remove a selection before adding another.");
      return;
    }
    selectedOrderIds(draft.selectedIds.includes(id)
      ? draft.selectedIds.filter(value => value !== id) : [...draft.selectedIds, id]);
    setSelectionNotice("");
  };
  const setLineValue = (key: string, value: string, field: "quantities" | "serialText") => {
    update({ [field]: { ...draft[field], [key]: value } });
    if (field === "quantities") setScanNotices(current => ({ ...current, [key]: "" }));
  };
  const setMoveQuantity = (key: string, value: string, limit: number) => {
    // A number input's max only affects validity/spinners; typing and paste
    // must also respect the current demand and available physical stock.
    if (value !== "" && (!/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) || Number(value) > Math.max(0, limit))) return;
    setLineValue(key, value, "quantities");
  };
  const scanSerials = (key: string, text: string, commitLast = false) => {
    if (pendingLock || createLock || !canPost) return;
    const quantity = Number(draft.quantities[key] ?? 0);
    const target = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0;
    const previousText = draft.serialText[key] ?? "";
    // Reducing the quantity must not silently discard serials already captured.
    if (new Set(splitSerials(previousText)).size > target && new Set(splitSerials(text)).size > target) {
      if (text.length <= previousText.length) setLineValue(key, text, "serialText");
      setScanNotices(current => ({ ...current, [key]: "Remove extra serials or increase the move quantity before scanning more." }));
      return;
    }
    const recorded = batchDemand.flatMap(row => draft.step === "stage" ? row.serials : row.deliveredSerials);
    const otherLines = Object.entries(draft.serialText)
      .filter(([other]) => other !== key && other.startsWith(`${draft.step}:`))
      .flatMap(([, value]) => splitSerials(value));
    const result = acceptFulfillmentScans(text, [...recorded, ...otherLines], commitLast, target);
    setLineValue(key, result.text, "serialText");
    setEditingSerialKey(!commitLast && result.text.split(/[\r\n,;\t]/).at(-1)?.trim() ? key : null);
    setScanNotices(current => ({
      ...current,
      [key]: result.rejected.length
        ? `Already scanned or recorded in this batch: ${result.rejected.slice(0, 3).join(", ")}${result.rejected.length > 3 ? ` (+${result.rejected.length - 3} more)` : ""}. Duplicate entries were not added.`
        : result.excess
          ? target ? "Required scan count reached. Extra serials were not added." : "Set a positive whole move quantity before scanning."
          : "",
    }));
  };
  const availableStagedSerials = (row: typeof batchDemand[number]) =>
    [...new Set(row.serials.filter(serial => !row.deliveredSerials.includes(serial)))];
  const acceptStagedSerials = (itemId: string, selection?: { serial: string; checked: boolean }) => {
    if (draft.step !== "vehicle" || !batchCanReleaseRemainder || !canPost || busy || pendingLock || createLock) return;
    const row = batchDemand.find(row => row.itemId === itemId && row.item?.tracking === "serialized");
    if (!row) return;
    const available = availableStagedSerials(row);
    if (!available.length) return;
    if (selection && !available.includes(selection.serial)) return;
    const key = quantityKey("vehicle", itemId);
    const existing = splitSerials(draft.serialText[key] ?? "");
    if (existing.some(serial => !available.includes(serial))) {
      setError("The scan box contains a serial that is not available in this batch's staged stock. Review those entries before choosing or accepting staged serials. Your entries were kept.");
      return;
    }
    const serials = [...new Set(selection
      ? selection.checked ? [...existing, selection.serial] : existing.filter(serial => serial !== selection.serial)
      : [...existing, ...available])];
    if (serials.length > vehicleRemaining(row)) {
      setError("Staged quantities and serials no longer agree. Refresh the batch before accepting serials. Your entries were kept.");
      return;
    }
    setError("");
    setEditingSerialKey(null);
    setScanNotices(current => ({ ...current, [key]: "" }));
    update({
      serialText: { ...draft.serialText, [key]: serials.join("\n") },
      quantities: { ...draft.quantities, [key]: String(serials.length) },
    });
  };
  const startResume = (batch: FulfillmentBatch) => update({ batchId: batch.id, mode: "resume",
    step: fulfillment.data?.resumeStatus?.[batch.id]?.nextStep ??
      (batch.lines.some(line => line.quantity > line.stagedQuantity) ? "stage" : "vehicle") });
  const printBatchReceipt = (id: string) => window.open(`/api/projects/${projectId}/inventory/print/fulfillment/${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
  const printPickTicket = (id: string) => window.open(`/api/projects/${projectId}/inventory/fulfillment/${encodeURIComponent(id)}/pick-ticket`, "_blank", "noopener,noreferrer");
  const makePartialReady = async () => {
    if (!activeBatch || !canPost || busy || pendingLock || !hasStagedStock || stagingComplete) return;
    const pending: PendingMove = { operationId: crypto.randomUUID(), action: "fulfillmentReady",
      data: { id: activeBatch.id, revision: activeBatch.revision, ready: true } };
    if (!storageKey) { setError("A signed-in user is required to safely save this exact readiness command."); return; }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ ...draft, pending }));
      setDraft(current => ({ ...current, pending }));
    } catch { setError("Could not save this exact readiness command. No status change was sent."); return; }
    await sendPending(pending);
  };
  const setupLocations = () => {
    try {
      window.sessionStorage.setItem(`meterflo:inventory-tab:${user?.id ?? "pending"}:${projectId}`, "locations");
      window.location.assign(`/projects/${projectId}/inventory`);
    } catch { setError("Open Inventory → Locations to create and manage a Staging location."); }
  };

  const stepNames = draft.mode === "resume" ? ["Stage stock", "Vehicle handoff"] : ["Choose work", "Review batch", "Stage stock", "Vehicle handoff"];
  const currentStepIndex = draft.mode === "resume" ? (draft.step === "vehicle" ? 1 : 0) : ({ orders: 0, review: 1, stage: 2, vehicle: 3 } as const)[draft.step];
  const goBack = () => {
    if (draft.pending) return;
    if (draft.step === "review") update({ step: "orders" });
    else if (draft.step === "stage" && draft.mode !== "resume") update({ step: "review" });
    else if (draft.step === "vehicle") update({ step: "stage" });
    else update({ mode: "crew", step: "orders", batchId: "" });
  };
  const moveToVehicle = (discard = false) => {
    if (busy || pendingLock || createLock || !hasStagedStock) return;
    if (hasUnrecordedMove && !discard) { setConfirmHandoff(true); return; }
    setConfirmHandoff(false);
    setError("");
    update({ step: "vehicle", quantities: {}, serialText: {}, reason: "", physicallyConfirmed: false });
  };

  useWizardStepFocus({
    open,
    ready: storageReady && checkedOnEntry && !inventory.isLoading && !fulfillment.isLoading && !busy && !confirmHandoff && requestedMode === null,
    stepKey: `${ticketArrival}:${showCorrections}:${showHistory}:${showBlocked}:${showStart ? `start:${hasSavedProgress}:${savedOutcome.kind}` : `${draft.mode}:${draft.step}:${draft.batchId}:${activeBatch?.status ?? ""}:${stagingComplete}:${reassignmentBatchId}`}:${draft.pending?.operationId ?? ""}:${draft.createAttempt?.operationId ?? ""}:${error}`,
    rootRef: wizardRef,
    bodyRef: stepBodyRef,
    chooseTarget: root => {
      const find = (...selectors: string[]) => {
        for (const selector of selectors) {
          const target = [...root.querySelectorAll<HTMLElement>(selector)].find(element =>
            !element.matches(":disabled, [aria-disabled=true]") && element.getClientRects().length > 0);
          if (target) return target;
        }
        return null;
      };
      if (showHistory) return find('[data-wizard-history]');
      if (showBlocked) return find('[data-wizard-blocked]');
      if (showCorrections) return null; // the correction's own step controller manages focus
      if (showStart) return find('[data-wizard-continue]', '[data-wizard-entry]', '[data-testid="fulfillment-start-screen"] button');
      if (reassignmentBatchId) return find('[data-wizard-reassignment]');
      if (draft.pending || draft.createAttempt) return find('[data-wizard-pending]', '[data-wizard-title]');
      if (activeBatch && ticketIdentityFocus.current === activeBatch.id) {
        const identity = find('[data-wizard-ticket-identity]');
        if (identity) {
          ticketIdentityFocus.current = null;
          return identity;
        }
      }
      if (draft.step === "review") return find('[data-wizard-review]');
      if (draft.step === "orders") return draft.mode === "resume"
        ? find('[data-wizard-saved-batches]')
        : find(!draft.selectedIds.length ? "#fulfillment-search" : !draft.name.trim() ? "#batch-name" : !draft.sourceId ? "#batch-source" : !draft.stagingId ? "#batch-staging" : !draft.vehicleId ? "#batch-vehicle" : "#fulfillment-search");
      if (activeBatch && activeBatch.status !== "active") return find('[data-wizard-complete]');
      if (draft.step === "stage" && stagingComplete && !hasUnrecordedMove) return find('[data-wizard-handoff]', "#fulfillment-staging-complete");
      return find('[data-wizard-needs-input="true"]',
        ...(draft.reason.trim().length < 10 ? ["#fulfillment-reason"] : []),
        ...(!draft.physicallyConfirmed ? ["#fulfillment-physical-confirmation"] : []),
        '[data-wizard-record]', '[data-wizard-title]');
    },
  });

  return <><Dialog open={open && roleCapabilities.fulfillment && canFulfill} onOpenChange={close}>
    <DialogContent ref={wizardRef} data-inventory-fulfillment-dialog="true" className="!fixed !left-1/2 !top-2 !translate-x-[-50%] !translate-y-0 !flex !h-auto !max-h-[calc(100dvh-1rem)] !w-[calc(100vw-1rem)] !max-w-4xl !min-w-0 flex-col gap-0 overflow-hidden p-0 sm:rounded-xl" onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <div className="min-w-0 shrink-0 border-b bg-muted/35 px-4 py-3 pr-12 sm:px-6 sm:py-4">
        <DialogHeader className="min-w-0 text-left">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"><ClipboardList className="h-4 w-4" /> Inventory workflow</div>
          <DialogTitle data-wizard-title tabIndex={-1} className="mt-1 text-xl sm:text-2xl">Fulfill / Stage Work Orders</DialogTitle>
          <DialogDescription>Build one saved crew batch, move only what is physically in custody, then hand it to one vehicle.</DialogDescription>
        </DialogHeader>
        {!showStart && !reassignmentBatchId && !showCorrections && <div className="mt-4 grid grid-cols-4 gap-2" aria-label={`Step ${currentStepIndex + 1} of ${stepNames.length}`}>
          {stepNames.map((name, index) => <div key={name} className="min-w-0">
            <div className={`h-1 rounded-full ${index <= currentStepIndex ? "bg-primary" : "bg-border"}`} />
            <p className={`mt-1 truncate text-[10px] sm:text-xs ${index === currentStepIndex ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{name}</p>
          </div>)}
        </div>}
      </div>
      <div ref={stepBodyRef} data-testid="fulfillment-step-body" className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
        {error && <Alert variant="destructive" className="mb-4"><AlertTriangle className="h-4 w-4" /><AlertTitle>Workflow needs attention</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        {draft.pending && <Alert data-wizard-pending tabIndex={-1} className="mb-4 border-amber-500/50 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4" /><AlertTitle>{busy ? "Checking saved movement" : "Movement outcome needs confirmation"}</AlertTitle>
          <AlertDescription className="space-y-2"><span>The exact operation ID and payload are retained. Do not make another physical move until a matching receipt is found or this command is retried.</span>
            <span className="block break-all font-mono text-xs">{draft.pending.operationId}</span>
            <Button type="button" size="sm" variant="outline" disabled={busy || !canPost} onClick={() => void sendPending()}><RotateCcw className="mr-2 h-4 w-4" />Check receipt / retry same command</Button>
          </AlertDescription>
        </Alert>}
        {draft.createAttempt && <Alert data-wizard-pending tabIndex={-1} className="mb-4 border-amber-500/50 bg-amber-500/5">
          <AlertTriangle className="h-4 w-4" /><AlertTitle>Batch creation outcome needs confirmation</AlertTitle>
          <AlertDescription>The saved batch identity is retained. Retry the same command before creating another batch. <span className="block break-all font-mono text-xs">{draft.createAttempt.operationId}</span></AlertDescription>
        </Alert>}
        {!canViewWorkOrders && !inventory.isLoading && <Alert variant="destructive" className="mb-4">
          <AlertTriangle className="h-4 w-4" /><AlertTitle>Work-order access is required</AlertTitle>
          <AlertDescription>Your saved selections and captures remain in this browser. An administrator must restore workOrders.view before work orders or saved batches can be loaded.</AlertDescription>
        </Alert>}
        {!canPost && <Alert className="mb-4"><AlertTriangle className="h-4 w-4" /><AlertTitle>Read-only workflow</AlertTitle><AlertDescription>Posting requires workOrders.view plus inventory.assign, inventory.receive, and inventory.transfer. Your saved draft is retained while access is unavailable.</AlertDescription></Alert>}
        {!showStart && !reassignmentBatchId && activeBatch?.status === "active" && activeResume?.reason && <Alert className="mb-4">
          <AlertTriangle className="h-4 w-4" /><AlertTitle>Batch review required</AlertTitle>
          <AlertDescription className="space-y-2">{activeResume.reason} Your saved inputs are retained. Use Review / release remainder below when appropriate.
            {activeBatch.mode === "scheduled" && <Button type="button" size="sm" className="block" data-testid={`fulfillment-review-reassignment-${activeBatch.id}`}
              disabled={!canPost || busy || !!draft.pending || !!draft.createAttempt}
              onClick={() => setReassignmentBatchId(activeBatch.id)}>Review reassignment</Button>}
          </AlertDescription>
        </Alert>}
        {(!fulfillment.isLoading && !fulfillment.isError && !inventory.isLoading && !inventory.isError && !stagingLocations.length) && <Alert className="mb-4">
          <MapPin className="h-4 w-4" /><AlertTitle>Set up a Staging location</AlertTitle><AlertDescription className="space-y-2">
            <span>No accessible physical location is typed “Staging”. Create the actual location or review its access in Inventory → Locations; no location is created by this wizard.</span>
            <Button type="button" size="sm" variant="outline" onClick={setupLocations}>Open Locations</Button>
          </AlertDescription>
        </Alert>}
        {(fulfillment.isLoading || inventory.isLoading || (!checkedOnEntry && canViewWorkOrders && !inventory.isError && !fulfillment.isError)) && <div className="space-y-3" aria-label="Loading fulfillment data">
          <div className="h-16 animate-pulse rounded-lg bg-muted" /><div className="h-28 animate-pulse rounded-lg bg-muted" /><div className="h-20 animate-pulse rounded-lg bg-muted" />
        </div>}
        {(fulfillment.isError || inventory.isError) && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Inventory could not load</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>Work orders and authorized locations are required before this workflow can continue.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => { void fulfillment.refetch(); void inventory.refetch(); }}>Retry</Button>
        </AlertDescription></Alert>}
        {storageReady && checkedOnEntry && !fulfillment.isLoading && !inventory.isLoading && !fulfillment.isError && !inventory.isError && (showCorrections && state && fulfillment.data ?
          <FulfillmentStagingCorrections
            projectId={projectId}
            userId={String(user?.id ?? "")}
            storageKey={storageKey ?? ""}
            state={state}
            batches={fulfillment.data.batches as Array<FulfillmentBatch & { issues?: import("@shared/inventory-staging-corrections").StagedIssue[]; pickupReady?: boolean }>}
            activeBatchId={activeBatch?.id}
            blockedBatchIds={blockedBatches.map(batch => batch.id)}
            canCorrect={canCorrect}
            onBack={() => setShowCorrections(false)}
            onCommand={(action, payload, onSuccess, onError) => {
              const { operationId, ...data } = payload;
              void apiRequest("POST", `/api/projects/${projectId}/inventory/commands`, { operationId, action, data })
                .then(async () => {
                  await Promise.all([queryClient.invalidateQueries({ queryKey: dataKey }), queryClient.invalidateQueries({ queryKey: inventoryKey })]);
                  onSuccess();
                })
                .catch(error => {
                  const failure = error instanceof Error ? error : new Error("Command outcome is unknown.");
                  if (failure.message.startsWith("409:")) {
                    void queryClient.invalidateQueries({ queryKey: dataKey });
                    void queryClient.invalidateQueries({ queryKey: inventoryKey });
                  }
                  onError(failure);
                });
            }}
          /> : <>
          {reassignmentBatchId && !showStart && <FulfillmentReassignmentReview projectId={projectId} batchId={reassignmentBatchId}
            canApply={canPost} blocked={hasUnrecordedMove || !!draft.pending || !!draft.createAttempt || busy}
            vehicleId={draft.reassignmentVehicleId} reason={draft.reassignmentReason}
            onVehicleChange={value => update({ reassignmentBatchId, reassignmentVehicleId: value })}
            onReasonChange={value => update({ reassignmentBatchId, reassignmentReason: value })}
            onApply={submitReassignment}
            onReviewRelease={() => {
              const batch = fulfillment.data?.batches.find(entry => entry.id === reassignmentBatchId);
              setReassignmentBatchId("");
              update({ reassignmentBatchId: "", reassignmentVehicleId: "", reassignmentReason: "" });
              if (batch) startResume(batch);
              else { setShowStart(true); setShowBlocked(true); }
            }} />}
          {showHistory && state && fulfillment.data && <div data-wizard-history tabIndex={-1} className="flex min-h-[24rem] flex-col">
            {finishedNotice && <Alert className="mb-3"><AlertTitle>Read-only pick ticket</AlertTitle><AlertDescription>{finishedNotice}</AlertDescription></Alert>}
            <FulfillmentBatchHistory state={state} batches={fulfillment.data.batches}
              timezone={fulfillment.data.timezone} projectName={inventory.data?.projectName ?? "Project inventory"}
              onRefresh={() => { void fulfillment.refetch(); void inventory.refetch(); }} onPrint={printBatchReceipt} />
          </div>}
          {showBlocked && <div data-wizard-blocked tabIndex={-1} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-semibold">Batches needing review</h3><Button type="button" variant="outline" size="sm" onClick={() => setShowCorrections(true)}>Review pickup problems</Button></div>
            <p className="text-sm text-muted-foreground">These active batches cannot be resumed. Review the reason and release any unfinished remainder without undoing physical stock movements.</p>
            {blockedBatches.length ? blockedBatches.map(batch => <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
              <div className="min-w-0"><p className="break-words font-medium">{batch.name}</p>
                <p className="text-sm text-muted-foreground">{fulfillment.data?.resumeStatus?.[batch.id]?.reason}</p></div>
              <div className="flex flex-wrap gap-2">
              {batch.mode === "scheduled" && <Button type="button" variant="default" size="sm" data-testid={`fulfillment-review-reassignment-${batch.id}`}
                disabled={!canPost || fulfillment.isFetching || !!draft.pending || !!draft.createAttempt}
                onClick={() => { setReassignmentBatchId(batch.id); setShowBlocked(false); setShowStart(false); }}>Review reassignment</Button>}
              <Button type="button" variant="outline" size="sm" disabled={!canPost || fulfillment.isFetching}
                onClick={() => { setShowBlocked(false); startResume(batch); }}>Review / release remainder</Button>
              </div>
            </div>) : <p role="status" className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No batches need review. Check Resume saved batch for unfinished work.</p>}
          </div>}
          {showStart && !showHistory && !showBlocked && <div className="space-y-4" data-testid="fulfillment-start-screen">
            <div><h3 className="text-lg font-semibold">Choose a fulfillment workflow</h3>
              <p className="text-sm text-muted-foreground">Start new work, resume an unfinished batch, or review completed batches.</p></div>
            <section className="space-y-3 rounded-xl border bg-muted/15 p-4" aria-labelledby="pick-ticket-scan-heading">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h3 id="pick-ticket-scan-heading" className="font-semibold">Open a saved fulfillment ticket</h3>
                  <p className="text-sm text-muted-foreground">Open the saved ticket to continue staging or handoff. Scanning never moves stock.</p></div>
                <Button type="button" data-testid="inventory-pick-ticket-camera"
                  onClick={() => setCameraRequest(value => value + 1)}>
                  <Camera className="mr-2 h-4 w-4" />Scan Pick Ticket QR Code
                </Button>
              </div>
              <ScannerInput value={ticketInput} onChange={value => {
                changeTicketInput(value);
                if (parsePickTicketQr(value, projectId).kind !== "invalid") void lookupPickTicket(value);
              }} placeholder="Scan a printed pick ticket QR code"
                data-testid="inventory-pick-ticket-scanner" openCameraRequest={cameraRequest} />
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input aria-label="Paste pick ticket QR link" data-testid="inventory-pick-ticket-paste"
                  value={ticketInput} onChange={event => changeTicketInput(event.target.value)}
                  onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void lookupPickTicket(ticketInput); } }}
                  placeholder="Or paste the complete ticket link" />
                <Button type="button" data-testid="inventory-pick-ticket-open"
                  disabled={ticketBusy || !ticketInput.trim() || !!draft.pending || !!draft.createAttempt}
                  onClick={() => void lookupPickTicket(ticketInput)}>
                  {ticketBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ScanLine className="mr-2 h-4 w-4" />}
                  Open ticket
                </Button>
              </div>
              {(draft.pending || draft.createAttempt) && <p role="status" className="text-xs text-amber-800">Resolve the saved operation before opening a different ticket. Your retry identity is protected.</p>}
            </section>
            <Button type="button" variant="outline" className="w-full sm:w-auto" data-testid="fulfillment-open-corrections-chooser" onClick={() => setShowCorrections(true)}>Review pickup problems and missing stock</Button>
            {finishedNotice && <p role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">{finishedNotice}</p>}
            {hasSavedProgress && (checkedOnEntry || draft.pending || draft.createAttempt) && savedOutcome.kind !== "clear" &&
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">{savedOutcome.kind === "review"
                ? `This saved batch is ${savedOutcome.status}. Local unrecorded inputs were kept for review, not for another stock movement.`
                : draft.pending || draft.createAttempt
                  ? "A saved operation still needs confirmation. Its exact identity and inputs have been retained."
                  : "Your previous workflow inputs are saved. Continue when you are ready to return to them."}</p>
              {savedOutcome.kind === "review"
                ? <div className="flex flex-wrap gap-2">
                  {draft.reassignmentBatchId && <Button data-testid="fulfillment-continue-reassignment" type="button" variant="outline" disabled={busy}
                    onClick={() => { setReassignmentBatchId(draft.reassignmentBatchId); setShowStart(false); }}>Review saved reassignment</Button>}
                  <Button type="button" variant="outline" onClick={() => setShowSavedInputs(value => !value)}>Review saved inputs</Button>
                </div>
                : <Button data-wizard-continue type="button" data-testid={draft.reassignmentBatchId ? "fulfillment-continue-reassignment" : undefined} disabled={busy}
                  onClick={() => {
                    if (draft.reassignmentBatchId) setReassignmentBatchId(draft.reassignmentBatchId);
                    setShowStart(false);
                  }}><RotateCcw className="mr-2 h-4 w-4" />{draft.reassignmentBatchId ? "Continue saved reassignment review" : "Continue saved workflow"}</Button>}
              {savedOutcome.kind === "review" && showSavedInputs && <FulfillmentSavedInputs draft={draft} items={items} />}
            </div>}
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ["crew", "New crew batch", "Choose unclaimed work and prepare one crew's pull."],
                ["scheduled", "Scheduled installer work", "Choose scheduled work for an installer and date."],
                ["resume", "Resume saved batch", "Continue valid, unfinished batches only."],
              ] as const).map(([mode, label, description]) => <button key={mode} type="button" data-wizard-entry
                disabled={busy || pendingLock || createLock}
                onClick={() => hasSavedProgress ? setRequestedMode(mode) : startMode(mode)}
                className="min-h-20 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50">
                <span className="block font-semibold">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span>
              </button>)}
              <button type="button" onClick={() => setShowHistory(true)}
                disabled={!fulfillment.data || fulfillment.isError}
                className="min-h-20 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/60 disabled:opacity-50">
                <span className="block font-semibold">Completed batches</span>
                <span className="mt-1 block text-xs text-muted-foreground">Search and filter completed batches, export history, or print combined receipts.</span>
              </button>
              {!!blockedBatches.length && <button type="button" onClick={() => setShowBlocked(true)}
                className="min-h-20 rounded-lg border border-amber-500/40 bg-card p-3 text-left transition-colors hover:bg-muted/60">
                <span className="block font-semibold">Batches needing review</span>
                <span className="mt-1 block text-xs text-muted-foreground">{blockedBatches.length} unfinished batch{blockedBatches.length === 1 ? "" : "es"} cannot be resumed. Review why or release the remainder.</span>
              </button>}
            </div>
            {(pendingLock || createLock) && <p className="text-sm text-muted-foreground">Continue the saved workflow to resolve its pending result before starting another workflow.</p>}
          </div>}
          {!showStart && <>
          {draft.step === "orders" && <div className="space-y-5">
            {!draft.batchId && <div className="grid gap-3 sm:grid-cols-3">
              {([
                ["crew", "New crew batch", "Choose unclaimed work and prepare one crew's pull."],
                ["scheduled", "Scheduled installer work", "Filter eligible scheduled work for an installer and date."],
                ["resume", "Resume saved batch", "Continue a batch without claiming or reassigning work orders."],
              ] as const).map(([mode, label, description]) => <button key={mode} type="button" onClick={() => {
                if (mode === "resume") update({ mode, batchId: "", step: "orders" });
                else update({ mode, batchId: "", step: "orders", selectedIds: [] });
              }} className={`min-h-20 rounded-lg border p-3 text-left transition-colors hover:bg-muted/60 ${draft.mode === mode ? "border-primary bg-primary/5" : "bg-card"}`}>
                <span className="block font-semibold">{label}</span><span className="mt-1 block text-xs text-muted-foreground">{description}</span>
              </button>)}
            </div>}
            {(draft.mode === "crew" || draft.mode === "scheduled") && <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><h3 className="text-lg font-semibold">Choose eligible orders</h3><p className="text-sm text-muted-foreground">Selection saves assignment versions only. It does not reserve, assign, or change an installer.</p></div>
                <Badge variant="secondary">{draft.selectedIds.length} selected</Badge>
              </div>
              {!!selectionConstraintError && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{selectionConstraintError}</AlertDescription></Alert>}
              <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1"><Label htmlFor="fulfillment-search">Search orders</Label><Input id="fulfillment-search" value={draft.search} onChange={event => update({ search: event.target.value })} placeholder="Order, group, route…" /></div>
                <div className="space-y-1"><Label htmlFor="fulfillment-route">Route</Label><Select value={draft.route || "all"} onValueChange={value => update({ route: value === "all" ? "" : value })}><SelectTrigger id="fulfillment-route"><SelectValue placeholder="Any route" /></SelectTrigger><SelectContent><SelectItem value="all">Any route</SelectItem>{[...new Set(orders.map(order => order.route).filter(Boolean))].sort().map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label htmlFor="fulfillment-group">Work group</Label><Select value={draft.group || "all"} onValueChange={value => update({ group: value === "all" ? "" : value })}><SelectTrigger id="fulfillment-group"><SelectValue placeholder="Any group" /></SelectTrigger><SelectContent><SelectItem value="all">Any group</SelectItem>{[...new Set(orders.map(order => order.group).filter(Boolean))].sort().map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label htmlFor="fulfillment-zone">Zone</Label><Select value={draft.zone || "all"} onValueChange={value => update({ zone: value === "all" ? "" : value })}><SelectTrigger id="fulfillment-zone"><SelectValue placeholder="Any zone" /></SelectTrigger><SelectContent><SelectItem value="all">Any zone</SelectItem>{[...new Set(orders.map(order => order.zone).filter(Boolean))].sort().map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1"><Label htmlFor="fulfillment-installer">Installer</Label><Select value={draft.installer || "all"} onValueChange={value => update({ installer: value === "all" ? "" : value })}><SelectTrigger id="fulfillment-installer"><SelectValue placeholder="Any installer" /></SelectTrigger><SelectContent><SelectItem value="all">Any installer</SelectItem>{[...new Map(orders.filter(order => order.installerId).map(order => [order.installerId!, order.installer])).entries()].map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select></div>
                {draft.mode === "scheduled" && <div className="space-y-1"><Label htmlFor="fulfillment-date">Scheduled date</Label><Input id="fulfillment-date" type="date" value={draft.date} onChange={event => update({ date: event.target.value })} /></div>}
              </div>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/10 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Checkbox
                    id="fulfillment-show-unavailable"
                    data-testid="fulfillment-show-unavailable"
                    checked={showUnavailable}
                    onCheckedChange={checked => setShowUnavailable(checked === true)}
                  />
                  <Label htmlFor="fulfillment-show-unavailable" className="cursor-pointer text-sm">Show unavailable work orders</Label>
                </div>
                <Badge variant="secondary" aria-label={`${unavailableMatchingOrders.length} unavailable work orders matching current filters`}>
                  {unavailableMatchingOrders.length} unavailable
                </Badge>
              </div>
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border bg-background/70 p-3">
                <label className="flex min-w-0 items-center gap-2 text-sm">
                  <Checkbox
                    id="fulfillment-select-all-matching"
                    data-testid="fulfillment-select-all-matching"
                    aria-label="Select all eligible matching orders"
                    aria-describedby="fulfillment-selection-summary"
                    checked={allMatchingSelected ? true : selectedMatchingCount > 0 ? "indeterminate" : false}
                    disabled={bulkSelectionDisabled}
                    onCheckedChange={handleSelectAllMatching}
                  />
                  <span className="font-medium">Select all eligible matching orders</span>
                </label>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p id="fulfillment-selection-summary" data-testid="fulfillment-selection-summary" aria-live="polite" className="text-xs text-muted-foreground">
                    Selected {draft.selectedIds.length} / Eligible matching {eligibleMatchingOrders.length}
                  </p>
                  <Button type="button" size="sm" variant="outline" data-testid="fulfillment-clear-selection"
                    disabled={!draft.selectedIds.length || !!draft.pending || !!draft.createAttempt}
                    onClick={() => { update({ selectedIds: [] }); setSelectionNotice(""); }}>
                    Clear selection
                  </Button>
                </div>
                {hiddenSelectionCount > 0 && <p className="w-full text-xs text-muted-foreground">
                  {hiddenSelectionCount} selected {hiddenSelectionCount === 1 ? "order is" : "orders are"} outside these filters or unavailable. Bulk changes affect only eligible matching orders.
                </p>}
                {!allMatchingSelected && !!bulkIdentityError && eligibleMatchingOrders.length > 0 && <p className="w-full text-xs text-amber-700">{bulkIdentityError}</p>}
                {!allMatchingSelected && bulkAddWouldExceedLimit && <p className="w-full text-xs text-amber-700">A batch is limited to 500 work orders. Refine filters or clear/remove selections before adding these matches.</p>}
                {draft.selectedIds.length >= 500 && <p className="w-full text-xs text-amber-700">500-order batch limit reached. Remove selected orders before adding more.</p>}
                {selectionNotice && <p role="alert" className="w-full text-xs text-destructive">{selectionNotice}</p>}
              </div>
              {filteredOrders.length > 0 && eligibleMatchingOrders.length === 0 && <Alert data-testid="fulfillment-no-eligible" className="border-amber-500/40 bg-amber-500/5">
                <AlertTriangle className="h-4 w-4" /><AlertTitle>No eligible work orders</AlertTitle>
                <AlertDescription>
                  Nothing matching these filters can be added to a new batch. Existing reservations or planned/fulfilled batches may already cover demand; no uncovered lines does not confirm stock was physically picked. Other matches may be unavailable because mapped requirements are missing or their status/assignment does not fit this mode. Completed work orders no longer appear here. Resume existing custody records from Saved fulfillment batches.
                </AlertDescription>
              </Alert>}
              <div className="space-y-2">
                {visibleOrders.map(order => {
                  const checked = draft.selectedIds.includes(order.workOrderId);
                  const limitBlocked = !checked && draft.selectedIds.length >= 500;
                  return <label key={order.workOrderId} className={`flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3 ${checked ? "border-primary bg-primary/5" : "bg-card"} ${!order.eligible ? "opacity-65" : ""}`}>
                    <Checkbox checked={checked} disabled={(!checked && !isOrderSelectable(order)) || limitBlocked || !!draft.pending || !!draft.createAttempt} onCheckedChange={() => changeSelection(order.workOrderId)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 font-medium">{order.label || `Work order ${order.workOrderId}`}<Badge variant={isOrderSelectable(order) ? "outline" : "secondary"}>{isOrderSelectable(order) ? "Eligible" : "Unavailable"}</Badge></span>
                      <span className="mt-1 block text-xs text-muted-foreground">{[order.group, order.installer || "No installer", projectDate(order.scheduledDate), order.route && `Route ${order.route}`, order.zone && `Zone ${order.zone}`].filter(Boolean).join(" · ")}</span>
                      {order.missing.length > 0 && <span className="mt-1 block text-xs text-amber-700">Missing configured items: {order.missing.map(entry => `${entry.equipment} ${entry.typeId}`).join(", ")}</span>}
                      {!order.missing.length && !order.lines.length && <span className="mt-1 block text-xs text-muted-foreground">No uncovered physical demand. Existing reservations or a planned/fulfilled batch may cover this work; this does not confirm a physical pickup.</span>}
                      {!order.eligible && <span className="mt-1 block text-xs text-amber-700">This order’s current status or assignment is not eligible for a new batch.</span>}
                    </span>
                  </label>;
                })}
                {!filteredOrders.length && <div className="rounded-lg border border-dashed p-8 text-center"><ClipboardList className="mx-auto h-7 w-7 text-muted-foreground" /><p className="mt-2 font-medium">No matching work orders</p><p className="text-sm text-muted-foreground">No records match this mode and the current search, route, date, or assignment filters.</p></div>}
              </div>
              <div className="space-y-3 rounded-lg border p-4">
                <div><h3 className="font-semibold">Batch setup</h3><p className="text-xs text-muted-foreground">One source, physical Staging destination, and one vehicle for the entire batch.</p></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1"><Label htmlFor="batch-name">Batch name</Label><Input id="batch-name" maxLength={120} value={draft.name} onChange={event => update({ name: event.target.value })} placeholder="Crew / date / route" /></div>
                  <div className="space-y-1"><Label htmlFor="batch-source">Warehouse source</Label><Select value={draft.sourceId} onValueChange={value => update({ sourceId: value })}><SelectTrigger id="batch-source"><SelectValue placeholder="Choose accessible warehouse" /></SelectTrigger><SelectContent>{sourceLocations.map(location => <SelectItem key={location.id} value={location.id}>{location.code} · {location.name}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1"><Label htmlFor="batch-staging">Staging destination</Label><Select value={draft.stagingId} onValueChange={value => update({ stagingId: value })}><SelectTrigger id="batch-staging"><SelectValue placeholder="Choose Staging location" /></SelectTrigger><SelectContent>{stagingLocations.map(location => <SelectItem key={location.id} value={location.id}>{location.code} · {location.name}</SelectItem>)}</SelectContent></Select></div>
                  <div className="space-y-1"><Label htmlFor="batch-vehicle">Vehicle</Label><Select value={draft.vehicleId} onValueChange={value => update({ vehicleId: value })}><SelectTrigger id="batch-vehicle"><SelectValue placeholder="Choose one vehicle" /></SelectTrigger><SelectContent>{vehicles.map(location => <SelectItem key={location.id} value={location.id}>{location.code} · {location.name}</SelectItem>)}</SelectContent></Select></div>
                </div>
              </div>
            </>}
            {draft.mode === "resume" && <div className="space-y-3">
              <div><h3 data-wizard-saved-batches tabIndex={-1} className="text-lg font-semibold">Saved fulfillment batches</h3><p className="text-sm text-muted-foreground">Resume the existing custody record; no work order is claimed or reassigned.</p></div>
              {resumableBatches.length ? resumableBatches.map(batch => <div key={batch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-medium">{batch.name}<Badge variant={batch.status === "completed" ? "secondary" : "outline"}>{batch.status}</Badge></div>
                  <p className="mt-1 text-xs text-muted-foreground">{batch.workOrders.length} work orders · {batch.mode} · {batch.createdAt ? new Date(batch.createdAt).toLocaleString() : ""}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Staged {batch.lines.reduce((sum, line) => sum + line.stagedQuantity, 0)} / {batch.lines.reduce((sum, line) => sum + line.quantity, 0)} · Vehicle {batch.lines.reduce((sum, line) => sum + line.deliveredQuantity, 0)} / {batch.lines.reduce((sum, line) => sum + line.quantity, 0)}</p></div>
                <div className="flex flex-wrap gap-2">
                  {receipts.some(receipt => ["fulfillmentMove", "fulfillmentClose"].includes(receipt.action) && receipt.reference === batch.id) &&
                    <Button type="button" size="sm" variant="outline" onClick={() => printBatchReceipt(batch.id)}><Printer className="mr-2 h-4 w-4" />Print combined receipt</Button>}
                  <Button type="button" size="sm" disabled={!canPost || fulfillment.isFetching} onClick={() => startResume(batch)}><RotateCcw className="mr-2 h-4 w-4" />Resume batch</Button>
                </div>
              </div>) : <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No resumable batches. Completed batches are available from the workflow's main page.</div>}
              <Button type="button" variant="ghost" onClick={() => setShowStart(true)}>Back to workflow choices</Button>
            </div>}
          </div>}
          {draft.step === "review" && <div className="space-y-5">
            <div><Badge variant="outline">Review before creating</Badge><h3 data-wizard-review tabIndex={-1} className="mt-2 text-xl font-semibold">{draft.name || "Unnamed batch"}</h3><p className="text-sm text-muted-foreground">{selectedOrders.length} selected work orders · {draft.mode === "scheduled" ? "scheduled installer work" : "crew batch"}</p></div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[["Source", draft.sourceId], ["Staging", draft.stagingId], ["Vehicle", draft.vehicleId]].map(([label, id]) => <div key={label} className="rounded-lg border p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 font-medium">{warehouses.find(location => location.id === id)?.name ?? "Not selected"}</p></div>)}
            </div>
            <div className="rounded-lg border">
              <div className="border-b px-4 py-3"><h4 className="font-semibold">Aggregated physical demand</h4><p className="text-xs text-muted-foreground">Labor is intentionally omitted. Scheduled batches use quantity holds only. This creates a saved batch only; stock moves after physical confirmation.</p></div>
              <ul className="divide-y">{demand.map(row => <li key={row.itemId} className="flex justify-between gap-3 px-4 py-3 text-sm"><span>{row.item?.name ?? row.itemId}<span className="ml-2 text-xs text-muted-foreground">{row.item?.sku}</span></span><span className="font-mono">{row.quantity} {row.item?.unit ?? "units"}</span></li>)}</ul>
              {!demand.length && <p className="p-4 text-sm text-muted-foreground">No physical demand was found. Select work orders with inventory requirements before creating a batch.</p>}
            </div>
          </div>}
          {!reassignmentBatchId && !showStart && (draft.step === "stage" || draft.step === "vehicle") && <div className="space-y-5">
            {!activeBatch ? <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>Batch is syncing</AlertTitle><AlertDescription>Refreshing the saved batch before a physical move is enabled.</AlertDescription></Alert> :
              activeBatch.status !== "active" ? <div className="space-y-4 rounded-xl border bg-muted/20 p-5 text-center sm:p-8">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Check className="h-6 w-6" /></div>
                <Badge variant="secondary">{activeBatch.status}</Badge>
                <h3 data-wizard-complete tabIndex={-1} className="text-xl font-semibold">{activeBatch.status === "completed" ? "Vehicle handoff complete" : "Batch closed"}</h3>
                <p className="mx-auto max-w-lg text-sm text-muted-foreground">{activeBatch.status === "completed"
                  ? "All physical demand was handed to the batch vehicle. The work orders were not reassigned."
                  : "Unfinished quantities were released. Staged-but-undelivered stock remains physically at Staging; this was not a physical return. Delivered stock remains with the vehicle."}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button type="button" variant="outline" onClick={() => printBatchReceipt(activeBatch.id)}><Printer className="mr-2 h-4 w-4" />Print combined receipt</Button>
                </div>
                {savedOutcome.kind === "review" && <FulfillmentSavedInputs draft={draft} items={items} />}
                <Button type="button" variant="ghost" onClick={() => { setShowStart(true); setShowHistory(activeBatch.status === "completed"); }}>{activeBatch.status === "completed" ? "View completed batches" : "Back to workflow choices"}</Button>
              </div> : <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><Badge variant="outline">{draft.step === "stage" ? "Physical pull to staging" : "Physical vehicle handoff"}</Badge><h3
                  data-testid="fulfillment-batch-identity" data-wizard-ticket-identity tabIndex={-1}
                  className="mt-2 break-words text-xl font-semibold">{activeBatch.name}{activeTicketNumber && ` - ${activeTicketNumber}`}</h3>
                  <p className="text-sm text-muted-foreground">{draft.step === "stage"
                    ? `${warehouses.find(location => location.id === activeBatch.sourceId)?.name ?? "Source"} → ${warehouses.find(location => location.id === activeBatch.stagingId)?.name ?? "Staging"}`
                    : `${warehouses.find(location => location.id === activeBatch.stagingId)?.name ?? "Staging"} → ${warehouses.find(location => location.id === activeBatch.vehicleId)?.name ?? "Vehicle"}`}</p></div>
                <Button type="button" variant="outline" size="sm" data-testid="fulfillment-open-corrections" onClick={() => setShowCorrections(true)}>Review pickup problems</Button>
                 <div className="flex flex-wrap gap-2"><Badge variant={activeBatch.pickupReady || stagingComplete ? "secondary" : "outline"}>{stagingComplete || activeBatch.pickupReady ? stagingComplete ? "Ready · full batch" : "Ready · partial" : "Not yet ready"}</Badge><Badge variant="secondary">Revision {activeBatch.revision}</Badge></div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3">
                <div><p className="text-sm font-medium">Pick ticket · {warehouses.find(location => location.id === activeBatch.vehicleId)?.name ?? "Vehicle"}</p><p className="text-xs text-muted-foreground">A printable staging list; printing does not move stock.</p></div>
                <Button type="button" size="sm" variant="outline" onClick={() => printPickTicket(activeBatch.id)}><Printer className="mr-2 h-4 w-4" />Print pick ticket</Button>
              </div>
              {(() => {
                const assignedVehicle = warehouses.find(location => location.id === activeBatch.vehicleId);
                return assignedVehicle && !assignedVehicle.assignedUserId && !(assignedVehicle.userIds?.length) ?
                  <Alert className="border-amber-500/40 bg-amber-500/5"><AlertTriangle className="h-4 w-4" /><AlertTitle>Vehicle has no assigned users</AlertTitle><AlertDescription>This vehicle has neither an assigned user nor assigned-user list. Technicians will not receive pickup notices until it is assigned.</AlertDescription></Alert> : null;
              })()}
              <Alert className="border-amber-500/40 bg-amber-500/5"><AlertTriangle className="h-4 w-4" /><AlertTitle>Stock stays at Staging</AlertTitle><AlertDescription>Ready status and pickup notices do not move inventory. Warehouse must record the physical vehicle handoff to transfer custody.</AlertDescription></Alert>
              {draft.step === "stage" && stagingComplete && <Alert data-testid="fulfillment-staging-complete">
                <Check className="h-4 w-4" /><AlertTitle>Stock staged</AlertTitle>
                <AlertDescription>The full batch has already been pulled into Staging. Continue to vehicle handoff when ready; do not record the same pull again.
                  {hasUnrecordedMove && <span className="mt-1 block">Unrecorded entries remain below. Continuing will ask before discarding them.</span>}
                </AlertDescription>
              </Alert>}
              {showMoveForm && <><Alert><ScanLine className="h-4 w-4" /><AlertTitle>{draft.step === "stage" ? "Scan stock as it is pulled" : "Scan stock as custody changes"}</AlertTitle>
                <AlertDescription>{draft.step === "stage"
                  ? "Enter only the quantity physically moved from the warehouse. Partial pulls are allowed; the remaining demand stays visible."
                  : "Enter only units physically handed to this batch’s single vehicle. Serialized units must already be staged and cannot be delivered twice."}</AlertDescription></Alert>
              {draft.step === "stage" && <div className="rounded-lg border bg-muted/20 p-3">
                <h4 className="text-sm font-semibold">Source availability · {warehouses.find(location => location.id === activeBatch.sourceId)?.name ?? "Warehouse"}</h4>
                <p className="mt-1 text-xs text-muted-foreground">Available equals on-hand less existing allocation and active crew-batch holds. Shortages are shown; the source is never changed automatically.</p>
                <ul className="mt-2 divide-y">{sourceAvailability.map(row => <li key={row.itemId} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1 py-2 text-xs sm:grid-cols-5">
                  <span className="col-span-2 min-w-0 break-words font-medium sm:col-span-1">{row.item?.name}</span>
                  <span className="min-w-0">On hand <strong className="font-mono">{row.onHand}</strong></span>
                  <span className="min-w-0">Held <strong className="font-mono">{row.held}</strong></span>
                  <span className="min-w-0">Available <strong className="font-mono">{row.available}</strong></span>
                  <span className={`min-w-0 break-words ${row.shortage > 0 ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{row.shortage > 0 ? `Short ${row.shortage}` : `${row.remaining} still to stage`}</span>
                </li>)}</ul>
              </div>}
              <div className="space-y-3">
                {batchDemand.map(row => {
                  const remaining = draft.step === "stage" ? stageRemaining(row) : vehicleRemaining(row);
                  const source = sourceAvailability.find(balance => balance.itemId === row.itemId);
                  const moveLimit = draft.step === "stage" ? Math.min(remaining, source?.available ?? 0) : remaining;
                  const key = quantityKey(draft.step, row.itemId);
                  const availableSerials = availableStagedSerials(row);
                  const capturedSerials = new Set(splitSerials(draft.serialText[key] ?? ""));
                  const enteredQuantity = Number(draft.quantities[key] ?? 0);
                  const scanTarget = Number.isSafeInteger(enteredQuantity) && enteredQuantity > 0 ? enteredQuantity : 0;
                  const scanText = draft.serialText[key] ?? "";
                  const scannedCount = new Set(splitSerials(editingSerialKey === key ? scanText.replace(/[^\r\n,;\t]*$/, "") : scanText)).size;
                  const scanComplete = scanTarget > 0 && scannedCount === scanTarget && capturedSerials.size === scanTarget;
                  const tooManyScans = capturedSerials.size > scanTarget;
                  const matchingSerials = availableSerials.filter(serial => serial.toLowerCase().includes((serialSearch[row.itemId] ?? "").trim().toLowerCase()));
                  const serialSelectionLocked = busy || pendingLock || createLock || !canPost || !batchCanReleaseRemainder;
                  return <div key={row.itemId} className="rounded-lg border p-3 sm:p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-semibold">{row.item?.name}</p><p className="text-xs text-muted-foreground">{row.item?.sku} · {row.item?.unit ?? "units"}</p></div>
                      <div className="text-right text-xs"><span className="block text-muted-foreground">Remaining to {draft.step === "stage" ? "stage" : "handoff"}</span><strong className="font-mono text-base">{remaining}</strong><span className="ml-1">{row.item?.unit ?? "units"}</span></div></div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)]">
                      <div className="space-y-1"><Label htmlFor={`qty-${key}`}>Move quantity</Label><Input id={`qty-${key}`} data-wizard-needs-input={!scanTarget || enteredQuantity > moveLimit ? "true" : undefined} data-testid={`fulfillment-move-quantity-${draft.step}-${row.itemId}`} aria-label={`${draft.step === "stage" ? "Stage" : "Vehicle handoff"} quantity for ${row.item?.name ?? row.itemId}`} aria-describedby={`qty-limit-${key}`} type="number" min="0" max={moveLimit} step="1" inputMode="numeric" disabled={pendingLock || moveLimit < 1 || !canPost} value={draft.quantities[key] ?? ""} onChange={event => setMoveQuantity(key, event.target.value, moveLimit)} placeholder="0" /><p id={`qty-limit-${key}`} className="text-xs text-muted-foreground">Maximum {moveLimit} {row.item?.unit ?? "units"}</p></div>
                      {row.item?.tracking === "serialized" && <div className="space-y-1">
                        <Label htmlFor={`serial-${key}`}>Custody serials</Label>
                        <div data-testid={`fulfillment-scan-progress-${draft.step}-${row.itemId}`}>
                          <SerialScanProgress scanned={tooManyScans ? capturedSerials.size : scannedCount} expected={scanTarget || null} />
                        </div>
                        <p id={`scan-notice-${key}`} role="status" aria-live="polite" className="text-sm text-destructive">{scanNotices[key] ?? ""}</p>
                        <Textarea id={`serial-${key}`} data-wizard-needs-input={scanTarget > 0 && !scanComplete ? "true" : undefined} data-testid={`fulfillment-custody-serials-${draft.step}-${row.itemId}`} aria-label={`${draft.step === "stage" ? "Stage" : "Vehicle handoff"} custody serials for ${row.item?.name ?? row.itemId}`} aria-describedby={`scan-help-${key} scan-notice-${key}`} rows={2} disabled={pendingLock || moveLimit < 1 || !canPost} value={draft.serialText[key] ?? ""}
                          onChange={event => scanSerials(key, event.target.value)}
                          onBlur={() => setEditingSerialKey(current => current === key ? null : current)}
                          onKeyDown={event => {
                            const text = event.currentTarget.value;
                            if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey && text.split(/[\r\n,;\t]/).at(-1)?.trim())) {
                              event.preventDefault();
                              scanSerials(key, text, true);
                            }
                          }}
                          onPaste={event => {
                            event.preventDefault();
                            const input = event.currentTarget;
                            scanSerials(key, input.value.slice(0, input.selectionStart) + event.clipboardData.getData("text") + input.value.slice(input.selectionEnd), true);
                          }}
                          placeholder={draft.step === "stage" ? "Scan source serials, one per unit" : "Scan serials already staged in this batch"} />
                        <p id={`scan-help-${key}`} className="text-xs text-muted-foreground">Scan with Enter or Tab, or paste a list. Repeated serials are rejected immediately. Enter exactly one unique serial per moved unit. This is custody only, never installed-equipment assignment.</p>
                      </div>}
                    </div>
                    {row.item?.tracking === "serialized" && <p className="mt-2 break-words text-xs text-muted-foreground">{draft.step === "stage" ? "Already staged: " : "Already handed off: "}{(draft.step === "stage" ? row.serials : row.deliveredSerials).join(", ") || "none"}</p>}
                    {draft.step === "vehicle" && row.item?.tracking === "serialized" && <div className="mt-2 space-y-2">
                      <p className="break-words text-xs text-muted-foreground">Available staged serials: {availableSerials.join(", ") || "none"}</p>
                      {availableSerials.length > 0 && <>
                        <Button type="button" variant="outline" size="sm" className="h-auto min-h-9 w-full whitespace-normal sm:w-auto"
                          data-testid={`fulfillment-accept-staged-${row.itemId}`} disabled={serialSelectionLocked}
                          onClick={() => acceptStagedSerials(row.itemId)}>
                          <Check className="mr-2 h-4 w-4 shrink-0" />Accept displayed serials ({availableSerials.length})
                        </Button>
                        <p className="text-xs text-muted-foreground">Visually verify the listed units, then accept all or choose individual units below for a partial handoff. Existing matching scans are kept without duplicates. This does not move stock; physical handoff confirmation is still required.</p>
                        <details className="min-w-0 rounded-lg border p-3" data-testid={`fulfillment-serial-picker-${row.itemId}`}>
                          <summary className="min-h-9 cursor-pointer text-sm font-medium">Choose staged serials for a partial handoff</summary>
                          <div className="mt-2 space-y-2">
                            <Label htmlFor={`serial-search-${row.itemId}`}>Search staged serials for {row.item?.name}</Label>
                            <Input id={`serial-search-${row.itemId}`} type="search" disabled={serialSelectionLocked}
                              value={serialSearch[row.itemId] ?? ""} onChange={event => setSerialSearch(current => ({ ...current, [row.itemId]: event.target.value }))}
                              placeholder="Find a staged serial…" />
                            <p className="text-xs text-muted-foreground" role="status">{availableSerials.filter(serial => capturedSerials.has(serial)).length} selected / {availableSerials.length} available · {matchingSerials.length} matching</p>
                            <div className="max-h-52 space-y-1 overflow-y-auto overscroll-contain">
                              {matchingSerials.map(serial => <label key={serial} className="flex min-h-11 cursor-pointer items-center gap-3 rounded border px-3 py-2 text-sm">
                                <Checkbox aria-label={`Hand off staged serial ${serial}`} checked={capturedSerials.has(serial)} disabled={serialSelectionLocked}
                                  onCheckedChange={checked => acceptStagedSerials(row.itemId, { serial, checked: checked === true })} />
                                <span className="min-w-0 break-all font-mono">{serial}</span>
                              </label>)}
                              {!matchingSerials.length && <p className="py-2 text-sm text-muted-foreground">No staged serials match this search.</p>}
                            </div>
                          </div>
                        </details>
                      </>}
                    </div>}
                  </div>;
                })}
                {!batchDemand.length && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No physical lines are currently available in this batch.</div>}
              </div>
              <div className="space-y-1"><Label htmlFor="fulfillment-reason">Physical move reason</Label><Input id="fulfillment-reason" maxLength={500} disabled={pendingLock || !canPost} value={draft.reason} onChange={event => update({ reason: event.target.value })} placeholder="Describe the physical pull or handoff" /><p className="text-xs text-muted-foreground">At least 10 characters. Do not record a planned or future movement.</p></div>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/20 p-3">
                <Checkbox id="fulfillment-physical-confirmation" checked={draft.physicallyConfirmed} disabled={pendingLock || !canPost} onCheckedChange={checked => update({ physicallyConfirmed: checked === true })} />
                <span><span className="text-sm font-medium">I confirm the listed stock has physically moved</span><span className="mt-1 block text-xs text-muted-foreground">Only actual quantities in physical custody can be recorded. This does not assign installed serials.</span></span>
              </label>
              </>}
              {draft.step === "stage" && batchDemand.some(row => stageRemaining(row) > 0) && <div className="rounded-lg border border-dashed p-3 text-sm"><p className="font-medium">Outstanding work remains</p><ul className="mt-1 space-y-1 text-muted-foreground">{batchDemand.filter(row => stageRemaining(row) > 0).map(row => <li key={row.itemId}>{row.item?.name}: {stageRemaining(row)} {row.item?.unit ?? "units"} still to stage</li>)}</ul></div>}
              {draft.step === "vehicle" && batchDemand.some(row => vehicleRemaining(row) > 0) && <div className="rounded-lg border border-dashed p-3 text-sm"><p className="font-medium">Staged stock still to hand off</p><ul className="mt-1 space-y-1 text-muted-foreground">{batchDemand.filter(row => vehicleRemaining(row) > 0).map(row => <li key={row.itemId}>{row.item?.name}: {vehicleRemaining(row)} {row.item?.unit ?? "units"} still at staging</li>)}</ul></div>}
              {draft.step === "stage" && !stagingComplete && hasStagedStock && <div className="space-y-2">
                <p className="text-xs text-muted-foreground">You may hand off only the stock already staged; return here later for the remaining pull. Unrecorded entries are not part of that handoff.</p>
                {!activeBatch.pickupReady && <Button type="button" variant="outline" disabled={!canPost || busy || pendingLock || movementBlocked} onClick={() => void makePartialReady()}>Make staged stock ready for partial pickup</Button>}
                <Button type="button" variant="outline" disabled={busy || pendingLock || createLock} className="w-full sm:w-auto" onClick={() => moveToVehicle()}><Truck className="mr-2 h-4 w-4" />Hand off already-staged stock</Button>
              </div>}
              {(draft.step === "stage" || draft.step === "vehicle") && batchCanReleaseRemainder && <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
                <p className="font-medium">Release unfinished remainder</p>
                <p className="text-xs text-muted-foreground">This releases remaining demand and holds. Any staged-but-undelivered stock stays physically at Staging; it is not returned. Delivered stock stays in the vehicle. Work-order assignment is unchanged. Use this to recover a stale or reassigned scheduled batch, then create a fresh batch or continue through the manual workflow.</p>
                <Label htmlFor="fulfillment-close-reason">Release reason (10 characters minimum)</Label><Textarea id="fulfillment-close-reason" rows={2} disabled={pendingLock || !canPost} value={draft.closeReason} onChange={event => update({ closeReason: event.target.value })} placeholder="Why the unfinished demand is being released" />
                <Button type="button" size="sm" variant="outline" disabled={!canPost || pendingLock || draft.closeReason.trim().length < 10 || busy} onClick={() => void cancelRemainder()}>Confirm release remainder</Button>
              </div>}
            </>}
          </div>}
          </>}
        </>)}
      </div>
      <DialogFooter className="min-w-0 shrink-0 flex-row flex-wrap items-center justify-between gap-2 border-t bg-background px-4 py-3 sm:px-6">
        {showHistory && <Button type="button" variant="outline" onClick={() => setShowHistory(false)}><ArrowLeft className="mr-2 h-4 w-4" />Back to workflows</Button>}
        {showBlocked && <Button type="button" variant="outline" onClick={() => setShowBlocked(false)}><ArrowLeft className="mr-2 h-4 w-4" />Back to workflows</Button>}
        {reassignmentBatchId && <Button type="button" variant="outline" className="min-w-0 whitespace-normal" onClick={() => {
          setReassignmentBatchId("");
          if (draft.batchId === reassignmentBatchId) setShowStart(false);
          else { setShowStart(true); setShowBlocked(true); }
        }}><ArrowLeft className="mr-2 h-4 w-4 shrink-0" />Back</Button>}
        {!showStart && !reassignmentBatchId && !showCorrections && <div className="flex gap-2">
          {draft.step !== "orders" && <Button type="button" variant="outline" disabled={busy || pendingLock || createLock} onClick={goBack}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>}
          {draft.step === "orders" && !draft.batchId && <Button type="button" variant="ghost" disabled={busy || pendingLock || createLock} onClick={reset}>Clear draft</Button>}
        </div>}
        <div className="flex flex-wrap justify-end gap-2">
          {!showStart && !reassignmentBatchId && !showCorrections && <>
          {draft.step === "orders" && (draft.mode === "crew" || draft.mode === "scheduled") && <Button type="button" disabled={!canCreate || busy || !storageReady || !stagingLocations.length} onClick={() => update({ step: "review" })}>Review batch<ArrowRight className="ml-2 h-4 w-4" /></Button>}
          {draft.step === "review" && <Button type="button" disabled={(!canCreate && !createLock) || busy} onClick={() => void createBatch()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : createLock ? <RotateCcw className="mr-2 h-4 w-4" /> : <Check className="mr-2 h-4 w-4" />}{createLock ? "Retry same batch creation" : "Create saved batch"}</Button>}
          {draft.step === "stage" && stagingComplete && hasStagedStock && <Button data-wizard-handoff type="button" disabled={busy || pendingLock || createLock} onClick={() => moveToVehicle()}>
            <Truck className="mr-2 h-4 w-4" />Continue to vehicle handoff
          </Button>}
          {(draft.step === "stage" || draft.step === "vehicle") && batchCanReleaseRemainder && !(draft.step === "stage" && stagingComplete) && <Button data-wizard-record type="button" disabled={movementBlocked || !canPost || busy || pendingLock || !draft.reason.trim() || draft.reason.trim().length < 10 || !draft.physicallyConfirmed} onClick={() => void submitMove(draft.step as "stage" | "vehicle")}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : draft.step === "stage" ? <ArrowRight className="mr-2 h-4 w-4" /> : <Truck className="mr-2 h-4 w-4" />}
            {draft.step === "stage" ? "Record physical pull" : "Record vehicle handoff"}
          </Button>}
          </>}
          <Button type="button" variant="outline" disabled={busy} onClick={() => close(false)}>{showStart && !showCorrections ? "Close" : "Save & leave"}</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
    <AlertDialog open={open && requestedMode !== null} onOpenChange={next => { if (!next) setRequestedMode(null); }}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Replace saved workflow inputs?</AlertDialogTitle>
          <AlertDialogDescription>Starting a different workflow replaces the current saved selections and unrecorded inputs. Recorded batches, receipts and stock movements are not changed. Cancel to keep your saved workflow.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep saved workflow</AlertDialogCancel>
          <AlertDialogAction disabled={busy || pendingLock || createLock} onClick={() => { if (requestedMode) startMode(requestedMode); }}>Start selected workflow</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={open && !!requestedTicket} onOpenChange={next => {
      if (!next && !ticketConfirmBusy) {
        setRequestedTicket(null);
        setRequestedTicketSnapshot("");
        setRequestedCorrectionSnapshot(null);
      }
    }}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-lg" data-testid="inventory-pick-ticket-replace-dialog"
        onEscapeKeyDown={event => { if (ticketConfirmBusy) event.preventDefault(); }}>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace saved workflow inputs?</AlertDialogTitle>
          <AlertDialogDescription>
            Opening ticket {requestedTicket?.batch.name} replaces different unrecorded selections, movement entries, or correction/reassignment edits. Recorded receipts and stock are unchanged. Cancel keeps every current input.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="inventory-pick-ticket-cancel-replace" disabled={ticketConfirmBusy}>Keep current inputs</AlertDialogCancel>
          <AlertDialogAction data-testid="inventory-pick-ticket-confirm-replace"
            disabled={busy || ticketConfirmBusy || pendingLock || createLock}
            onClick={event => {
              event.preventDefault();
              void confirmPickTicketReplacement();
            }}>{ticketConfirmBusy ? "Checking current ticket…" : "Replace inputs and open ticket"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <AlertDialog open={open && confirmHandoff} onOpenChange={setConfirmHandoff}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Unrecorded movement entries</AlertDialogTitle>
          <AlertDialogDescription>These quantities, serials, notes and confirmation have not been recorded. Stay here to record or review them, or discard them and continue with stock already recorded at Staging. Discarding does not move stock or change recorded receipts.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay and review</AlertDialogCancel>
          <AlertDialogAction disabled={busy || pendingLock || createLock || !hasStagedStock} onClick={() => moveToVehicle(true)}>Discard entries and continue</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
