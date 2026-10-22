import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SerialScanField } from "@/components/inventory/serial-scan-field";
import { AlertTriangle, ArrowLeftRight, Check, Loader2, Printer, RefreshCw, Truck } from "lucide-react";

type TransferMode = "stock" | "work";
type Vehicle = { id: string; code: string; name: string; members: Array<{ id: string; name: string }> };
type Item = { id: string; name: string; sku: string; tracking: string; unit: string };
type BatchOrder = {
  workOrderId: string | number; label: string; assignmentVersion: number; status: string;
  installerId: string | null; eligible: boolean; reason?: string; lines: Array<{ itemId: string; quantity: number }>;
};
type Batch = { id: string; name: string; receiptNumber: string; revision: number; mode: "crew" | "scheduled"; workOrders: BatchOrder[] };
type Options = {
  revision: number; canStockTransfer: boolean; canWorkTransfer: boolean; vehicles: Vehicle[]; items: Item[];
  stock: Array<{ itemId: string; quantity: number; available: number; serials: string[] }>; batches: Batch[];
};
type TransferLine = { itemId: string; quantity: number; serials: string[] };
type TransferCommand = {
  operationId: string; action: "vehicleTransfer";
  data: {
    mode: TransferMode; revision: number; sourceId: string; destinationId: string; batchId?: string;
    batchRevision?: number; workOrders: Array<{ workOrderId: string | number; assignmentVersion: number }>;
    installerId?: string | null; lines: TransferLine[]; reason: string; physicallyConfirmed: true;
  };
};
type PendingTransfer = { command: TransferCommand; savedAt: string };
type TransferResponse = { operationId?: string; state?: { receipts?: Array<{ id: string; reference?: string }> }; reference?: string };

const parseErrorStatus = (error: unknown) => {
  if (error instanceof Error) {
    const match = error.message.match(/^(\d{3}):/);
    if (match) return Number(match[1]);
  }
  if (!error || typeof error !== "object") return undefined;
  const value = error as { status?: unknown; response?: { status?: unknown } };
  const status = value.status ?? value.response?.status;
  return typeof status === "number" ? status : undefined;
};
const storageKeyFor = (projectId: string | number, userId: string) =>
  `meterflo:vehicle-transfer-pending:${encodeURIComponent(userId)}:${projectId}`;
const committedSerialTokens = (value: string) => {
  const parts = value.split(/[\r\n,;\t]/);
  if (!/[\r\n,;\t]\s*$/.test(value)) parts.pop();
  return parts.map(part => part.trim()).filter(Boolean);
};
const orderIsSelectable = (order: BatchOrder) => order.eligible &&
  !["completed", "complete", "installed", "closed", "cancelled", "canceled"].includes(order.status.toLowerCase());
const selectedQuantity = (value: string) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};

export function VehicleTransferPanel({ projectId, permissions }: { projectId: string | number; permissions?: string[] }) {
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const userId = user?.id ? String(user.id) : "";
  const can = (permission: string) => permissions !== undefined && permission.startsWith("inventory.")
    ? permissions.includes(permission) : hasPermission(permission);
  const stockPermission = ["inventory.view", "inventory.transfer", "inventory.receive"].every(permission => can(permission));
  const workPermission = stockPermission && ["inventory.assign", "workOrders.view", "workOrders.edit", "workOrders.assign"].every(permission => can(permission));
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TransferMode>("stock");
  const [sourceId, setSourceId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [installerId, setInstallerId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [scans, setScans] = useState<Record<string, string>>({});
  const [scanChecks, setScanChecks] = useState<Record<string, {
    signature: string; status: "checking" | "verified" | "invalid" | "error"; message: string; version: number;
  }>>({});
  const [reason, setReason] = useState("");
  const [physicallyConfirmed, setPhysicallyConfirmed] = useState(false);
  const [step, setStep] = useState<"details" | "review">("details");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<PendingTransfer | null>(null);
  const [pendingStorageKey, setPendingStorageKey] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [receiptId, setReceiptId] = useState("");
  const [posting, setPosting] = useState(false);
  const verificationRuns = useRef(new Map<string, number>());
  const base = `/api/projects/${projectId}/inventory`;
  const transferKey = userId ? storageKeyFor(projectId, userId) : "";
  const selectedWorkIds = selectedOrders.slice().sort().join(",");

  const recoverOldestPending = () => {
    if (!transferKey) return;
    try {
      const recovered: Array<{ pending: PendingTransfer; key: string }> = [];
      let recoveryError = "";
      const validPending = (value: unknown): value is PendingTransfer => {
        if (!value || typeof value !== "object") return false;
        const entry = value as PendingTransfer;
        return entry.command?.action === "vehicleTransfer" && !!entry.command.operationId && !!entry.command.data;
      };
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key || !key.startsWith(`${transferKey}:`)) continue;
        try {
          const raw = window.localStorage.getItem(key);
          const parsed = raw ? JSON.parse(raw) as unknown : null;
          if (validPending(parsed) && key === `${transferKey}:${parsed.command.operationId}`)
            recovered.push({ pending: parsed, key });
        } catch {
          recoveryError = "A saved transfer retry could not be read. No new transfer will be sent until it is recovered.";
        }
      }
      const legacyRaw = window.localStorage.getItem(transferKey);
      if (legacyRaw) {
        let legacy: unknown;
        try { legacy = JSON.parse(legacyRaw) as unknown; }
        catch { recoveryError = "The legacy transfer retry could not be read. No new transfer will be sent."; }
        if (validPending(legacy)) {
          const migratedKey = `${transferKey}:${legacy.command.operationId}`;
          const existing = window.localStorage.getItem(migratedKey);
          const existingPending = existing ? JSON.parse(existing) as unknown : null;
          if (!existing || validPending(existingPending) &&
            JSON.stringify(existingPending.command) === JSON.stringify(legacy.command)) {
            if (!existing) window.localStorage.setItem(migratedKey, JSON.stringify(legacy));
            const durableRaw = window.localStorage.getItem(migratedKey);
            const durable = durableRaw ? JSON.parse(durableRaw) as unknown : null;
            if (validPending(durable) && JSON.stringify(durable.command) === JSON.stringify(legacy.command)) {
              if (window.localStorage.getItem(transferKey) === legacyRaw) window.localStorage.removeItem(transferKey);
              recovered.push({ pending: durable, key: migratedKey });
            } else {
              recovered.push({ pending: legacy, key: transferKey });
              recoveryError = "The legacy retry is retained; its new durable copy could not be confirmed.";
            }
          } else {
            recovered.push({ pending: legacy, key: transferKey });
            recoveryError = "The legacy retry conflicts with another saved operation. Both identities are preserved.";
          }
        }
      }
      recovered.sort((left, right) => {
        const a = Date.parse(left.pending.savedAt || "");
        const b = Date.parse(right.pending.savedAt || "");
        return (Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0);
      });
      const oldest = recovered[0];
      setPending(oldest?.pending ?? null);
      setPendingStorageKey(oldest?.key ?? "");
      setStorageError(recoveryError);
    } catch {
      setStorageError("Saved transfer retries could not be read. No new transfer will be sent.");
    }
  };

  useEffect(() => {
    setStorageReady(false);
    setPending(null);
    setPendingStorageKey("");
    if (!transferKey) return;
    recoverOldestPending();
    setStorageReady(true);
  }, [transferKey]);

  const optionsQuery = useQuery<Options>({
    queryKey: [base, "vehicle-transfer-options", sourceId, mode === "work" ? batchId : "", mode === "work" ? selectedWorkIds : ""],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (sourceId) params.set("sourceId", sourceId);
      if (mode === "work" && batchId) {
        params.set("batchId", batchId);
        if (selectedWorkIds) params.set("workOrderIds", selectedWorkIds);
      }
      const query = params.toString();
      return (await apiRequest("GET", `${base}/vehicle-transfers/options${query ? `?${query}` : ""}`)).json();
    },
    enabled: open && !!userId,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const options = optionsQuery.data;
  const vehicles = options?.vehicles ?? [];
  const source = vehicles.find(vehicle => vehicle.id === sourceId);
  const destination = vehicles.find(vehicle => vehicle.id === destinationId);
  const itemById = useMemo(() => new Map((options?.items ?? []).map(item => [item.id, item])), [options?.items]);
  const stockByItem = useMemo(() => new Map((options?.stock ?? []).map(row => [row.itemId, row])), [options?.stock]);
  const batch = options?.batches.find(value => value.id === batchId);
  const selectedWorkOrders = useMemo(() => (batch?.workOrders ?? []).filter(order => selectedOrders.includes(String(order.workOrderId))), [batch, selectedOrders]);
  const demand = useMemo(() => {
    const totals = new Map<string, number>();
    for (const order of selectedWorkOrders) for (const line of order.lines)
      totals.set(line.itemId, (totals.get(line.itemId) ?? 0) + line.quantity);
    return totals;
  }, [selectedWorkOrders]);
  const lineIds = mode === "work"
    ? [...demand.keys()]
    : Object.keys(quantities).filter(itemId => selectedQuantity(quantities[itemId] ?? "") > 0);
  const transferLines: TransferLine[] = lineIds.map(itemId => {
    const item = itemById.get(itemId);
    const quantity = mode === "work" ? demand.get(itemId) ?? 0 : selectedQuantity(quantities[itemId] ?? "");
    return { itemId, quantity, serials: item?.tracking === "serialized" ? committedSerialTokens(scans[itemId] ?? "") : [] };
  }).filter(line => line.quantity > 0);
  const serialErrors = transferLines.flatMap(line => {
    const item = itemById.get(line.itemId);
    if (item?.tracking !== "serialized") return [];
    const available = new Set(stockByItem.get(line.itemId)?.serials ?? []);
    const values = committedSerialTokens(scans[line.itemId] ?? "");
    return values.length !== line.quantity || new Set(values).size !== values.length || values.some(serial => !available.has(serial)
      || transferLines.some(other => other.itemId !== line.itemId && committedSerialTokens(scans[other.itemId] ?? "").includes(serial)))
      ? [item.name] : [];
  });
  const enoughStock = transferLines.every(line => (stockByItem.get(line.itemId)?.available ?? 0) >= line.quantity);
  const quantityErrors = Object.entries(quantities).filter(([itemId, raw]) => {
    if (!raw.trim()) return false;
    const amount = Number(raw);
    return !Number.isSafeInteger(amount) || amount < 0 ||
      (amount > 0 && amount > (stockByItem.get(itemId)?.available ?? 0));
  });
  const serializedLineIds = new Set(transferLines.filter(line => itemById.get(line.itemId)?.tracking === "serialized").map(line => line.itemId));
  const unavailableCaptureIds = [...new Set([
    ...Object.entries(scans).filter(([itemId, value]) => !!value.trim() &&
      (itemById.get(itemId)?.tracking !== "serialized" || !serializedLineIds.has(itemId))).map(([itemId]) => itemId),
    ...quantityErrors.map(([itemId]) => itemId),
  ])].filter(itemId => !itemById.has(itemId) || (mode === "work" && !demand.has(itemId)));
  const serialChecksReady = transferLines.filter(line => itemById.get(line.itemId)?.tracking === "serialized").every(line => {
    const check = scanChecks[line.itemId];
    return !!check && check.status === "verified" &&
      check.signature === line.serials.join("\n") && check.version === optionsQuery.dataUpdatedAt;
  });
  const scheduled = mode === "work" && batch?.mode === "scheduled";
    const installerValid = mode !== "work" || (scheduled
      ? !!destination?.members.some(member => member.id === installerId)
      : !installerId || !!destination?.members.some(member => member.id === installerId));
  const selectedOrdersEligible = mode !== "work" || (selectedWorkOrders.length > 0 && selectedWorkOrders.length === selectedOrders.length && selectedWorkOrders.every(orderIsSelectable));
  const workDestinationBlocked = mode === "work" && !!destinationId &&
    (!destination || destination.members.length === 0);
  const canReview = !!options && (mode === "stock" ? options.canStockTransfer : options.canWorkTransfer) &&
    sourceId !== "" && destinationId !== "" && sourceId !== destinationId &&
    !workDestinationBlocked && (mode !== "work" || (!!batch && selectedOrdersEligible && installerValid)) &&
    transferLines.length > 0 && enoughStock && quantityErrors.length === 0 && unavailableCaptureIds.length === 0 &&
    serialErrors.length === 0 && serialChecksReady &&
    !!reason.trim() && !optionsQuery.isFetching && !optionsQuery.isError && !storageError;
  const canSubmit = canReview && physicallyConfirmed;

  useEffect(() => {
    if (options?.canStockTransfer === false && options.canWorkTransfer && workPermission) setMode("work");
  }, [options?.canStockTransfer, options?.canWorkTransfer, workPermission]);

  const resetCaptures = () => {
    setQuantities({});
    setScans({});
    setScanChecks({});
    verificationRuns.current.forEach((run, itemId) => verificationRuns.current.set(itemId, run + 1));
    setReason("");
    setPhysicallyConfirmed(false);
    setStep("details");
    setMessage("");
    setConflict(false);
  };
  const guardedChange = (hasCapture: boolean, label: string, change: () => void) => {
    if (hasCapture && !window.confirm(`${label} will clear the current quantities, serial scans, reason, and confirmation. Continue?`)) return;
    if (hasCapture) resetCaptures();
    change();
  };
  const hasCaptures = Object.values(scans).some(value => value.trim()) ||
    Object.values(quantities).some(value => value.trim()) || !!reason.trim() || physicallyConfirmed;
  const validateFreshOptions = (
    fresh: Options, version: number, targetItemId?: string, targetSerials?: string[],
  ) => {
    const freshStock = new Map(fresh.stock.map(row => [row.itemId, row]));
    const availabilityProblems = transferLines.filter(line => (freshStock.get(line.itemId)?.available ?? 0) < line.quantity);
    const freshBatch = mode === "work" ? fresh.batches.find(value => value.id === batchId) : undefined;
    const freshOrders = (freshBatch?.workOrders ?? []).filter(order => selectedOrders.includes(String(order.workOrderId)));
    const workEligible = mode !== "work" || (!!freshBatch && freshOrders.length === selectedOrders.length &&
      freshOrders.length > 0 && freshOrders.every(orderIsSelectable));
    const freshDestination = fresh.vehicles.find(vehicle => vehicle.id === destinationId);
    const locationsValid = !!fresh.vehicles.find(vehicle => vehicle.id === sourceId) &&
      !!freshDestination && sourceId !== destinationId;
    const destinationHasMember = mode !== "work" || (freshDestination?.members.length ?? 0) > 0;
    const permissionValid = mode === "stock" ? fresh.canStockTransfer : fresh.canWorkTransfer;
    const freshScheduled = mode === "work" && freshBatch?.mode === "scheduled";
    const installerIsValid = mode !== "work" || (freshScheduled
      ? !!freshDestination?.members.some(member => member.id === installerId)
      : !installerId || !!freshDestination?.members.some(member => member.id === installerId));
    const checks: typeof scanChecks = {};
    const rejectedByItem: Record<string, string[]> = {};
    const allSerials = new Set<string>();
    for (const line of transferLines) {
      if (itemById.get(line.itemId)?.tracking !== "serialized") continue;
      const serials = line.itemId === targetItemId
        ? targetSerials ?? []
        : committedSerialTokens(scans[line.itemId] ?? "");
      const row = freshStock.get(line.itemId);
      const unavailable = serials.filter(serial => !row?.serials.includes(serial));
      const canReject = line.itemId === targetItemId && !!row && permissionValid && locationsValid &&
        destinationHasMember && workEligible && installerIsValid && availabilityProblems.length === 0;
      const rejectedSerials = canReject ? unavailable : [];
      rejectedByItem[line.itemId] = rejectedSerials;
      const rejectedSet = new Set(rejectedSerials);
      const retainedSerials = serials.filter(serial => !rejectedSet.has(serial));
      const duplicate = new Set(retainedSerials).size !== retainedSerials.length ||
        retainedSerials.some(serial => allSerials.has(serial));
      retainedSerials.forEach(serial => allSerials.add(serial));
      const invalid = !permissionValid || !locationsValid || !destinationHasMember || !workEligible || !installerIsValid || availabilityProblems.length > 0 ||
        retainedSerials.some(serial => !row?.serials.includes(serial)) || duplicate || retainedSerials.length > line.quantity;
      checks[line.itemId] = {
        signature: retainedSerials.join("\n"),
        status: invalid ? "invalid" : "verified",
        message: !permissionValid ? "Transfer permissions changed. Refresh options before continuing."
          : !locationsValid ? "The selected vehicles are no longer available."
            : !destinationHasMember ? "Assign an active authorized technician in Inventory > Locations first."
              : !workEligible ? "Selected work is no longer eligible. Refresh options and review the batch."
          : !installerIsValid ? "Choose an installer assigned to the receiving vehicle."
            : availabilityProblems.length ? "Current available quantity is below the selected transfer quantity."
              : rejectedSerials.length ? `Unavailable serials rejected: ${rejectedSerials.join(", ")}.`
                : invalid ? "One or more serials are not currently available at this source."
                : "Serials verified against freshly loaded source stock.",
        version,
      };
    }
    setScanChecks(current => ({ ...current, ...checks }));
    const checkedTarget = targetItemId ? checks[targetItemId] : undefined;
    const targetCheck = checkedTarget ? {
      status: checkedTarget.status === "verified" ? "verified" as const
        : checkedTarget.status === "invalid" ? "invalid" as const : "error" as const,
      message: checkedTarget.message,
      ...(rejectedByItem[targetItemId!]!.length ? { rejectedSerials: rejectedByItem[targetItemId!] } : {}),
    } : undefined;
    return {
      valid: permissionValid && locationsValid && destinationHasMember && !availabilityProblems.length && workEligible && installerIsValid &&
        Object.values(checks).every(check => check.status === "verified"),
      target: targetCheck ?? { status: "verified" as const, message: "Current source stock verified." },
      availabilityProblems,
      workEligible,
      installerIsValid,
      freshBatch,
    };
  };
  const serialVerificationState = (itemId: string) => {
    if (!scans[itemId]?.trim()) return undefined;
    const signature = committedSerialTokens(scans[itemId] ?? "").join("\n");
    const check = scanChecks[itemId];
    if (!check || check.signature !== signature)
      return { status: "checking" as const, message: "Verify committed serials against current source stock." };
    if (check.status === "checking") return check;
    if (check.version !== optionsQuery.dataUpdatedAt)
      return { status: "checking" as const, message: "Source availability changed. Verify this scan again." };
    return check;
  };
  const verifySourceSerials = async (itemId: string, serials: string[]) => {
    const signature = serials.join("\n");
    const run = (verificationRuns.current.get(itemId) ?? 0) + 1;
    verificationRuns.current.set(itemId, run);
    setScanChecks(current => ({ ...current, [itemId]: {
      signature, status: "checking", message: "Checking committed serials against current source stock…", version: -1,
    } }));
    try {
      const result = await optionsQuery.refetch();
      if (verificationRuns.current.get(itemId) !== run)
        return { status: "error" as const, message: "A newer scan is being verified; the latest capture is preserved." };
      if (result.isError || !result.data) {
        setScanChecks(current => ({ ...current, [itemId]: {
          signature, status: "error", message: "Current source stock could not be refreshed. Scans are kept; retry verification.", version: -1,
        } }));
        return { status: "error" as const, message: "Current source stock could not be refreshed. Scans are kept; retry verification." };
      }
      const validation = validateFreshOptions(result.data, result.dataUpdatedAt, itemId, serials);
      return validation.target;
    } catch {
      if (verificationRuns.current.get(itemId) !== run)
        return { status: "error" as const, message: "A newer scan is being verified; the latest capture is preserved." };
      setScanChecks(current => ({ ...current, [itemId]: {
        signature, status: "error", message: "Current source stock could not be refreshed. Scans are kept; retry verification.", version: -1,
      } }));
      return { status: "error" as const, message: "Current source stock could not be refreshed. Scans are kept; retry verification." };
    }
  };
  const refreshOptions = async () => {
    setConflict(false);
    verificationRuns.current.forEach((run, itemId) => verificationRuns.current.set(itemId, run + 1));
    setScanChecks(current => Object.fromEntries(Object.entries(current).map(([itemId, check]) => [itemId, {
      ...check, status: "checking" as const, version: -1, message: "Refreshing source availability…",
    }])));
    const result = await optionsQuery.refetch();
    if (result.data) validateFreshOptions(result.data, result.dataUpdatedAt);
  };
  const createCommand = (fresh: Options, freshBatch?: Batch): TransferCommand => ({
    operationId: crypto.randomUUID(),
    action: "vehicleTransfer",
    data: {
      mode,
      revision: fresh.revision,
      sourceId,
      destinationId,
      ...(mode === "work" && freshBatch ? { batchId: freshBatch.id, batchRevision: freshBatch.revision } : {}),
      workOrders: mode === "work" && freshBatch ? freshBatch.workOrders.filter(order =>
        selectedOrders.includes(String(order.workOrderId))).map(order => ({
          workOrderId: order.workOrderId, assignmentVersion: order.assignmentVersion,
        })) : [],
      ...(mode === "work" ? { installerId: installerId && installerId !== "__crew_pool__" ? installerId : null } : {}),
      lines: transferLines,
      reason: reason.trim(),
      physicallyConfirmed: true,
    },
  });
  const persistPending = (entry: PendingTransfer): string => {
    if (!transferKey) throw new Error("Sign in again before submitting a transfer.");
    try {
      const key = `${transferKey}:${entry.command.operationId}`;
      const existingRaw = window.localStorage.getItem(key);
      if (existingRaw) {
        const existing = JSON.parse(existingRaw) as PendingTransfer;
        if (existing.command?.operationId !== entry.command.operationId ||
          JSON.stringify(existing.command) !== JSON.stringify(entry.command))
          throw new Error("A different pending command already uses this operation ID.");
      } else {
        window.localStorage.setItem(key, JSON.stringify(entry));
      }
      const durableRaw = window.localStorage.getItem(key);
      const durable = durableRaw ? JSON.parse(durableRaw) as PendingTransfer : null;
      if (!durable || durable.command?.operationId !== entry.command.operationId ||
        JSON.stringify(durable.command) !== JSON.stringify(entry.command))
        throw new Error("The saved transfer identity could not be confirmed.");
      setPending(durable);
      setPendingStorageKey(key);
      setStorageError("");
      return key;
    } catch {
      setStorageError("The exact retry identity could not be saved. Enable browser storage before posting.");
      throw new Error("Transfer not sent because the retry identity could not be saved.");
    }
  };
  const removePending = (command: TransferCommand, key: string) => {
    try {
      if (!key) throw new Error("No durable retry identity is available.");
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw) as PendingTransfer;
        if (saved.command?.operationId !== command.operationId ||
          JSON.stringify(saved.command) !== JSON.stringify(command))
          throw new Error("A different pending command is stored at this key.");
        window.localStorage.removeItem(key);
      }
    } catch {
      setStorageError("The pending transfer key changed or could not be cleared. Its exact request remains preserved.");
      return false;
    }
    if (pendingStorageKey === key) {
      setPending(null);
      setPendingStorageKey("");
    }
    recoverOldestPending();
    return true;
  };
  const postCommand = async (command: TransferCommand, retryKey: string) => {
    if (!retryKey) {
      setStorageError("No durable retry identity is available. No request was sent.");
      setMessage("Retry protection is missing; no request was sent.");
      return;
    }
    try {
      const storedRaw = window.localStorage.getItem(retryKey);
      const stored = storedRaw ? JSON.parse(storedRaw) as PendingTransfer : null;
      if (!stored || stored.command?.operationId !== command.operationId ||
        JSON.stringify(stored.command) !== JSON.stringify(command))
        throw new Error("The exact pending command is not durably stored.");
    } catch {
      setStorageError("The exact retry identity could not be verified. No request was sent.");
      setMessage("Retry protection could not be verified; no request was sent.");
      return;
    }
    setPosting(true);
    setMessage("");
    setConflict(false);
    try {
      const response = await apiRequest("POST", `${base}/commands`, command);
      const result = await response.json() as TransferResponse;
      const receipt = result.state?.receipts?.find(value => value.id === command.operationId);
      const id = receipt?.id ?? result.operationId ?? command.operationId;
      const retryCleared = removePending(command, retryKey);
      setReceiptId(id);
      setMessage(`Transfer posted${receipt?.reference || result.reference ? ` · ${receipt?.reference ?? result.reference}` : ""}.${retryCleared ? "" : " The exact retry identity remains saved for safe reconciliation."}`);
      setStep("details");
      if (retryCleared) {
        setQuantities({});
        setScans({});
        setScanChecks({});
        setReason("");
        setPhysicallyConfirmed(false);
        setConflict(false);
      }
      void queryClient.invalidateQueries({ queryKey: [base] });
      void queryClient.invalidateQueries({ queryKey: [base, "vehicle-transfer-options"] });
    } catch (error) {
      const status = parseErrorStatus(error);
      // Losing access on a retry cannot prove whether an earlier attempt committed.
      if (status && status >= 400 && status < 500 && ![401, 403, 408, 425, 429].includes(status)) {
        const retryCleared = removePending(command, retryKey);
        if (status === 409) {
          setConflict(true);
          setMessage("Inventory changed since review. Refresh options, verify the retained scans and quantities, then review again.");
        } else {
          setMessage(retryCleared
            ? "The transfer was rejected. Your entries are retained; correct the issue and review to create a new command."
            : "The transfer was rejected, but the pending identity could not be cleared. Its exact request remains preserved.");
        }
      } else {
        setMessage("The outcome is unknown. Retry the exact saved transfer; do not create a new one.");
      }
    } finally {
      setPosting(false);
    }
  };
  const beginPost = async () => {
    if (!canSubmit || posting) return;
    setPosting(true);
    try {
      const freshResult = await optionsQuery.refetch();
      if (freshResult.isError || !freshResult.data) {
        setMessage("Current vehicle availability could not be refreshed. Your scans and quantities are retained; retry review.");
        return;
      }
      const validation = validateFreshOptions(freshResult.data, freshResult.dataUpdatedAt);
      if (!validation.valid) {
        setConflict(true);
        setMessage("Availability or work eligibility changed. Your captures are retained; review the refreshed source stock before posting.");
        return;
      }
      const freshBatch = mode === "work" ? freshResult.data.batches.find(value => value.id === batchId) : undefined;
      const command = createCommand(freshResult.data, freshBatch);
      const entry = { command, savedAt: new Date().toISOString() };
      const durableKey = persistPending(entry);
      await postCommand(command, durableKey);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the transfer retry identity.");
    } finally {
      setPosting(false);
    }
  };
  const retryPending = () => pending && void postCommand(pending.command, pendingStorageKey);

  if (!stockPermission) return null;
  return <>
    <Button type="button" size="sm" variant="outline" className="h-9 gap-2 border-primary/40 bg-primary/5"
      data-testid="button-vehicle-transfers"
      onClick={() => { setOpen(true); setMessage(""); }}>
      <ArrowLeftRight className="h-4 w-4" /><span className="hidden sm:inline">Vehicle transfer</span><span className="sm:hidden">Transfer</span>
    </Button>
    <Dialog open={open} onOpenChange={value => { if (!posting) setOpen(value); }}>
      <DialogContent data-testid="vehicle-transfer-dialog" className="flex max-h-[94dvh] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden p-0 sm:w-full">
        <DialogHeader className="shrink-0 border-b px-4 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-primary/10 p-2 text-primary"><Truck className="h-5 w-5" /></div>
            <div><DialogTitle>Vehicle handover</DialogTitle><DialogDescription>Move stock or take over open work with a clear custody record.</DialogDescription></div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
          {pending && <Alert>
            <AlertTriangle className="h-4 w-4" /><AlertTitle>Transfer outcome needs confirmation</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>A previous request may already have posted. Retry uses the same operation ID and exact request; editing is paused until its outcome is known.</p>
              <p className="text-xs">Mode: {pending.command.data.mode === "stock" ? "Stock only" : "Outstanding work and stock"} · {pending.command.data.lines.length} line(s) · {pending.command.data.reason}</p>
              <Button type="button" size="sm" data-testid="transfer-retry" onClick={retryPending} disabled={posting || !storageReady}>
                {posting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Retry same transfer
              </Button>
            </AlertDescription>
          </Alert>}
          {storageError && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Retry protection unavailable</AlertTitle><AlertDescription>{storageError}</AlertDescription></Alert>}
          {message && <Alert variant={conflict ? "destructive" : "default"}>
            {conflict ? <AlertTriangle className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            <AlertTitle>{conflict ? "Review required" : receiptId ? "Handover recorded" : "Transfer status"}</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{message}</span>
              {receiptId && <a className="inline-flex min-h-9 items-center gap-2 rounded-md border px-3 font-medium text-foreground underline-offset-4 hover:underline"
                href={`${base}/print/receipt/${encodeURIComponent(receiptId)}`} target="_blank" rel="noreferrer"><Printer className="h-4 w-4" />Print receipt</a>}
            </AlertDescription>
          </Alert>}
          {optionsQuery.isError && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Transfer options unavailable</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>Current vehicle stock and eligibility could not be loaded.</span>
              <Button type="button" variant="outline" size="sm" onClick={() => void refreshOptions()}>Retry options</Button></AlertDescription></Alert>}
          {optionsQuery.isLoading && <div className="space-y-3" aria-label="Loading vehicle transfer options">
            <div className="h-10 animate-pulse rounded-md bg-muted" /><div className="h-24 animate-pulse rounded-md bg-muted" /><div className="h-40 animate-pulse rounded-md bg-muted" />
          </div>}
          {options && !pending && <fieldset disabled={posting} className="contents">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Transfer type">
                {options.canStockTransfer && <Button type="button" variant={mode === "stock" ? "default" : "outline"}
                  data-testid="transfer-mode-stock"
                  onClick={() => guardedChange(hasCaptures, "Changing transfer type", () => { setMode("stock"); setBatchId(""); setSelectedOrders([]); setInstallerId(""); })}>Transfer stock only</Button>}
                {options.canWorkTransfer && workPermission && <Button type="button" variant={mode === "work" ? "default" : "outline"}
                  data-testid="transfer-mode-work"
                  onClick={() => guardedChange(hasCaptures, "Changing transfer type", () => { setMode("work"); setQuantities({}); setInstallerId(""); })}>Transfer outstanding work and stock</Button>}
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => void refreshOptions()} disabled={optionsQuery.isFetching}>
                <RefreshCw className={`mr-2 h-4 w-4 ${optionsQuery.isFetching ? "animate-spin" : ""}`} />Refresh availability
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="transfer-source">Source vehicle</Label>
                <Select value={sourceId} onValueChange={value => guardedChange(hasCaptures, "Changing source vehicle", () => { setSourceId(value); setBatchId(""); setSelectedOrders([]); setInstallerId(""); })}>
                  <SelectTrigger id="transfer-source" data-testid="transfer-source"><SelectValue placeholder="Choose source vehicle" /></SelectTrigger>
                  <SelectContent>{vehicles.map(vehicle => <SelectItem key={vehicle.id} value={vehicle.id}>{vehicle.code} · {vehicle.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="transfer-destination">Receiving vehicle</Label>
                <Select value={destinationId} onValueChange={value => guardedChange(hasCaptures, "Changing receiving vehicle", () => { setDestinationId(value); setInstallerId(""); })}>
                  <SelectTrigger id="transfer-destination" data-testid="transfer-destination"><SelectValue placeholder="Choose destination vehicle" /></SelectTrigger>
                  <SelectContent>{vehicles.filter(vehicle => vehicle.id !== sourceId).map(vehicle => <SelectItem key={vehicle.id} value={vehicle.id}>{vehicle.code} · {vehicle.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {sourceId && destinationId === sourceId && <p role="alert" className="text-sm text-destructive">Source and destination must be different vehicles.</p>}
            {workDestinationBlocked && <Alert variant="destructive" data-testid="transfer-destination-members-blocker">
              <AlertTriangle className="h-4 w-4" /><AlertTitle>Receiving vehicle has no eligible technicians</AlertTitle>
              <AlertDescription>Work takeover is unavailable because this vehicle has no active authorized members. Assign an active authorized technician in Inventory &gt; Locations first. Stock-only transfers to an empty vehicle remain available.</AlertDescription>
            </Alert>}
            {mode === "work" && <>
              <section className="space-y-3 rounded-lg border bg-muted/20 p-3 sm:p-4">
                <div><h3 className="text-sm font-semibold">Work takeover</h3><p className="text-xs text-muted-foreground">Choose a batch, then select eligible outstanding orders. Completed installs are excluded.</p></div>
                <div className="space-y-1.5"><Label htmlFor="transfer-batch">Source batch</Label>
                  <Select value={batchId} onValueChange={value => guardedChange(hasCaptures, "Changing source batch", () => { setBatchId(value); setSelectedOrders([]); setInstallerId(""); })}>
                    <SelectTrigger id="transfer-batch" data-testid="transfer-batch"><SelectValue placeholder="Choose a source batch" /></SelectTrigger>
                    <SelectContent>{options.batches.map(value => <SelectItem key={value.id} value={value.id}>{value.name} · {value.receiptNumber}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {batch && <div className="max-h-56 space-y-2 overflow-y-auto rounded-md border bg-background p-3">
                  {batch.workOrders.filter(orderIsSelectable).map(order => {
                    const checked = selectedOrders.includes(String(order.workOrderId));
                    return <label key={order.workOrderId} className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted/50">
                      <Checkbox data-testid={`transfer-work-order-${order.workOrderId}`} checked={checked} onCheckedChange={value => guardedChange(hasCaptures, "Changing selected work orders", () =>
                        setSelectedOrders(current => value ? [...current, String(order.workOrderId)] : current.filter(id => id !== String(order.workOrderId))))} />
                      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{order.label}</span>
                        <span className="text-xs text-muted-foreground">{order.status} · {order.lines.reduce((sum, line) => sum + line.quantity, 0)} required units</span></span>
                    </label>;
                  })}
                  {batch.workOrders.some(order => !orderIsSelectable(order)) &&
                    <div className="space-y-1 border-t pt-2">{batch.workOrders.filter(order => !orderIsSelectable(order)).map(order =>
                      <p key={`blocked-${order.workOrderId}`} className="text-xs text-muted-foreground">{order.label} · {order.reason || `${order.status} work is not eligible for takeover.`}</p>)}</div>}
                  {!batch.workOrders.some(orderIsSelectable) &&
                    <p className="text-sm text-muted-foreground">No eligible outstanding work orders in this batch.</p>}
                </div>}
                {batch && <div className="space-y-1.5"><Label htmlFor="transfer-installer">{scheduled ? "Receiving installer" : "Receiving installer (optional)"}</Label>
                  <Select value={installerId || "__crew_pool__"} onValueChange={value => setInstallerId(value === "__crew_pool__" ? "" : value)}>
                    <SelectTrigger id="transfer-installer" data-testid="transfer-installer"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {!scheduled && <SelectItem value="__crew_pool__">Leave unclaimed · receiving crew pool</SelectItem>}
                      {destination?.members.map(member => <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{scheduled ? "Scheduled work requires an installer on the receiving vehicle." : "Choose a receiving installer or leave blank to unclaim into the receiving crew pool."}</p>
                </div>}
                {mode === "work" && selectedWorkOrders.length > 0 && !scheduled && !installerId && <p className="text-xs text-muted-foreground">Crew work will be unclaimed to the receiving crew pool.</p>}
              </section>
            </>}
            <section className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><div><h3 className="text-sm font-semibold">{mode === "work" ? "Required stock" : "Select stock"}</h3>
                <p className="text-xs text-muted-foreground">{mode === "work" ? "Exact aggregate demand for the selected orders is required." : "Choose the quantities physically moving to the receiving vehicle."}</p></div>
                {mode === "work" && batch && <Badge variant="outline">Batch revision {batch.revision}</Badge>}
              </div>
              {mode === "work" && selectedOrdersEligible && selectedWorkOrders.length > 0 && [...demand.entries()].map(([itemId, quantity]) => {
                const item = itemById.get(itemId);
                const row = stockByItem.get(itemId);
                return <div key={itemId} className="rounded-md border p-3">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0"><span className="block text-sm font-medium">{item?.name ?? itemId}</span><span className="font-mono text-xs text-muted-foreground">{item?.sku}</span></span>
                    <span className="font-mono text-sm tabular-nums">{quantity} required · {row?.available ?? 0} available</span>
                  </div>
                  {item?.tracking === "serialized" && <SerialScanField id={`transfer-serials-${itemId}`} data-testid={`transfer-serials-${itemId}`} aria-label={`Serial scans for ${item.name}`}
                    value={scans[itemId] ?? ""} onChange={value => setScans(current => ({ ...current, [itemId]: value }))}
                    expected={quantity} blockedSerials={Object.entries(scans).filter(([otherId]) => otherId !== itemId).flatMap(([, value]) => committedSerialTokens(value))}
                    verifyCommittedScans={serials => verifySourceSerials(itemId, serials)} verificationState={serialVerificationState(itemId)} />}
                </div>;
              })}
              {mode === "stock" && <div className="max-h-[min(38dvh,24rem)] space-y-2 overflow-y-auto pr-1">
                {(options.items ?? []).filter(item => (stockByItem.get(item.id)?.available ?? 0) > 0 ||
                  !!quantities[item.id]?.trim() || !!scans[item.id]?.trim()).map(item => {
                  const row = stockByItem.get(item.id);
                  const quantity = selectedQuantity(quantities[item.id] ?? "");
                  return <div key={item.id} className="rounded-md border p-3">
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0"><span className="block text-sm font-medium">{item.name}</span><span className="font-mono text-xs text-muted-foreground">{item.sku} · {item.unit}</span></span>
                      <Badge variant="outline">{row?.available ?? 0} available</Badge>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[minmax(8rem,12rem)_1fr]">
                      <div className="space-y-1"><Label htmlFor={`transfer-quantity-${item.id}`}>Transfer quantity</Label>
                        <Input id={`transfer-quantity-${item.id}`} data-testid={`transfer-quantity-${item.id}`} type="number" inputMode="numeric" min="0" max={row?.available ?? 0} step="1"
                          value={quantities[item.id] ?? ""} onChange={event => setQuantities(current => ({ ...current, [item.id]: event.target.value }))} /></div>
                      {item.tracking === "serialized" && (quantity > 0 || !!scans[item.id]?.trim()) && <div className="min-w-0">
                        <SerialScanField id={`transfer-serials-${item.id}`} data-testid={`transfer-serials-${item.id}`} aria-label={`Serial scans for ${item.name}`}
                          value={scans[item.id] ?? ""} onChange={value => setScans(current => ({ ...current, [item.id]: value }))}
                          expected={quantity} blockedSerials={Object.entries(scans).filter(([otherId]) => otherId !== item.id).flatMap(([, value]) => committedSerialTokens(value))}
                          verifyCommittedScans={serials => verifySourceSerials(item.id, serials)} verificationState={serialVerificationState(item.id)} />
                      </div>}
                    </div>
                  </div>;
                })}
                {!options.items.some(item => (stockByItem.get(item.id)?.available ?? 0) > 0) &&
                  <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No transferable stock is currently available at this source.</div>}
              </div>}
              {mode === "work" && selectedWorkOrders.length === 0 && <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">Select outstanding work to calculate exact required quantities.</div>}
              {mode === "work" && selectedWorkOrders.length > 0 && !selectedOrdersEligible && <p role="alert" className="text-sm text-destructive">Selected work is no longer eligible. Refresh options and review the batch.</p>}
              {serialErrors.length > 0 && <p role="alert" className="text-sm text-destructive">Serial scans must be unique, currently available at this source, and match the exact quantity for: {serialErrors.join(", ")}.</p>}
              {quantityErrors.length > 0 && <p role="alert" className="text-sm text-destructive">A selected stock quantity exceeds the refreshed available balance. Your value is retained; correct it before review.</p>}
              {unavailableCaptureIds.length > 0 && <p role="alert" className="text-sm text-destructive">Some retained scans no longer match currently selected stock or work ({unavailableCaptureIds.join(", ")}). Review the refreshed options; captured text has not been discarded.</p>}
              {!enoughStock && transferLines.length > 0 && <p role="alert" className="text-sm text-destructive">One or more required quantities exceed current available source stock.</p>}
            </section>
            <section className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="transfer-reason">Reason for handover</Label>
                <Textarea id="transfer-reason" data-testid="transfer-reason" rows={2} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)}
                  placeholder="For example: vehicle reassignment, route coverage, or stock balancing" /></div>
            </section>
            {step === "review" && <section className="space-y-3 rounded-lg border-2 border-primary/30 bg-primary/[0.035] p-4" aria-live="polite">
              <div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Final review</p><h3 className="text-base font-semibold">{mode === "stock" ? "Stock-only transfer" : "Work and stock takeover"}</h3></div>
              <div className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">{source?.code ?? source?.name}</Badge><ArrowLeftRight className="h-4 w-4 text-muted-foreground" /><Badge variant="outline">{destination?.code ?? destination?.name}</Badge></div>
              {mode === "work" && <p className="text-sm">Batch: <strong>{batch?.name}</strong> · {selectedWorkOrders.length} outstanding order(s) · {installerId ? `Receiving installer: ${destination?.members.find(member => member.id === installerId)?.name ?? "not available"}` : "Receiving crew pool"}</p>}
              <ul className="divide-y rounded-md border bg-background">{transferLines.map(line => <li key={line.itemId} className="flex justify-between gap-3 p-2.5 text-sm">
                <span>{itemById.get(line.itemId)?.name ?? line.itemId}</span><span className="font-mono tabular-nums">{line.quantity} {itemById.get(line.itemId)?.unit ?? "units"}{itemById.get(line.itemId)?.tracking === "serialized" ? ` · ${line.serials.length} serials` : ""}</span>
              </li>)}</ul>
              <p className="text-sm"><span className="font-medium">Reason:</span> {reason.trim()}</p>
              <label className="flex items-start gap-3 rounded-md border bg-background p-3">
                <Checkbox data-testid="transfer-physical-confirm" checked={physicallyConfirmed}
                  onCheckedChange={value => setPhysicallyConfirmed(value === true)} />
                <span className="text-sm"><span className="block font-medium">Both crews are present and the receiving crew physically received these items.</span>
                  <span className="text-xs text-muted-foreground">This records a completed direct custody handover. For stock that is in transit, use the existing transfer-order workflow.</span></span>
              </label>
              <p className="text-xs text-muted-foreground">Availability revision {options.revision} · The command posts atomically.</p>
            </section>}
          </fieldset>}
        </div>
        <DialogFooter className="shrink-0 flex-row justify-between gap-2 border-t px-4 py-3 sm:px-6">
          <Button type="button" variant="outline" onClick={() => { setOpen(false); }} disabled={posting}>Close</Button>
          <div className="flex gap-2">
            {step === "review" && <Button type="button" variant="outline" onClick={() => setStep("details")} disabled={posting}>Back to edit</Button>}
            {step === "details" ? <Button type="button" data-testid="transfer-review" onClick={() => { setStep("review"); setMessage(""); }}
              disabled={!canReview || !!pending || posting}>Review transfer</Button>
              : <Button type="button" data-testid="transfer-post" onClick={() => void beginPost()} disabled={!canSubmit || !!pending || posting || !storageReady}>
                {posting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Post transfer
              </Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
