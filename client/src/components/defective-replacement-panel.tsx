import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, ArrowRight, Loader2, RotateCcw, Wrench } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import type {
  CreateReplacement,
  ReplacementEligibility,
  ReplacementHistoryRow,
  ReplacementOperationStatus,
  ReplacementVisit,
} from "@shared/defective-replacement";

type PendingOperation = { payload: CreateReplacement };
type ReplacementResponse = { workOrder: any; replacementVisit: ReplacementVisit; replay: boolean };
type RecoveryAction = { kind: "restore" | "delete"; row: ReplacementHistoryRow } | null;

interface DefectiveReplacementPanelProps {
  projectId: number;
  workOrder: any;
  readingOnly?: boolean;
  onLaunch: (workOrder: any, visit: ReplacementVisit, inventoryEnabled: boolean) => void;
  onOpenWorkOrder?: (workOrderId: number) => void | Promise<boolean | void>;
  onDeletedVisit?: () => void;
}

export function DefectiveReplacementPanel({ projectId, workOrder, readingOnly = false, onLaunch, onOpenWorkOrder, onDeletedVisit }: DefectiveReplacementPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [equipment, setEquipment] = useState<"system" | "module" | "both">("system");
  const [reason, setReason] = useState("");
  const [vehicleId, setVehicleId] = useState("warehouse");
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | null>(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [pendingOwnerKey, setPendingOwnerKey] = useState<string | null>(null);
  const [recoveryAction, setRecoveryAction] = useState<RecoveryAction>(null);
  const [recoveryReason, setRecoveryReason] = useState("");
  const [noPhysicalReplacement, setNoPhysicalReplacement] = useState(false);
  const storageKey = `meterflo.replacement-operation:${user?.id ?? "unknown"}:${projectId}:${workOrder.id}`;
  const contextKey = `${user?.id ?? "unknown"}:${projectId}:${workOrder.id}`;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;
  const pendingOperationRef = useRef(pendingOperation);
  pendingOperationRef.current = pendingOperation;
  const operationStatusGenerationRef = useRef(0);
  const eligibilityQueryKey = ["/api/projects", projectId, "work-orders", workOrder.id, "replacement"];
  const currentPendingOperation = pendingOwnerKey === storageKey ? pendingOperation : null;

  const { data: eligibility, isLoading, isError, refetch } = useQuery<ReplacementEligibility>({
    queryKey: eligibilityQueryKey,
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/work-orders/${workOrder.id}/replacement`, { credentials: "include" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Replacement eligibility could not load.");
      return response.json();
    },
    enabled: !!projectId && !!workOrder.id,
    retry: 1,
  });

  const clearPendingIfMatches = (operationId: string, key = storageKey, expectedContext = contextKey) => {
    try {
      const saved = localStorage.getItem(key);
      const parsed = saved ? JSON.parse(saved) as PendingOperation : null;
      if (parsed?.payload?.operationId === operationId) localStorage.removeItem(key);
    } catch { /* Keep state aligned with the confirmed server result even if storage is unavailable. */ }
    if (contextKeyRef.current !== expectedContext) return;
    if (pendingOperationRef.current?.payload.operationId === operationId) {
      setPendingOperation(null);
      setPendingOwnerKey(null);
    }
  };

  const reconcilePendingOperation = async (
    operationId: string,
    rootWorkOrderId = eligibility?.rootWorkOrderId ?? workOrder.id,
  ): Promise<ReplacementOperationStatus | null> => {
    try {
      const response = await fetch(
        `/api/projects/${projectId}/work-orders/${rootWorkOrderId}/replacement/operations/${encodeURIComponent(operationId)}`,
        { credentials: "include" },
      );
      if (!response.ok) return null;
      const status = await response.json() as ReplacementOperationStatus;
      if (status.operationId !== operationId || !["active", "cancelled", "deleted", "completed"].includes(status.status)) return null;
      return status;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    setPendingOperation(null);
    setPendingOwnerKey(null);
    setActionError("");
    setBusy(false);
    setEquipment("system");
    setReason("");
    setVehicleId("warehouse");
    setCancelConfirmOpen(false);
    setRecoveryAction(null);
    setRecoveryReason("");
    setNoPhysicalReplacement(false);
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const pending = JSON.parse(saved) as PendingOperation;
        setPendingOperation(pending);
        setPendingOwnerKey(storageKey);
      }
    } catch {
      setActionError("Saved replacement request could not be read. It has not been submitted.");
    }
  }, [storageKey]);

  useEffect(() => {
    if (!pendingOperation || pendingOwnerKey !== storageKey || !eligibility?.rootWorkOrderId) return;
    let active = true;
    const operationId = pendingOperation.payload.operationId;
    const expectedContext = contextKey;
    const generation = operationStatusGenerationRef.current;
    void reconcilePendingOperation(operationId, eligibility.rootWorkOrderId).then(status => {
      if (!active || !status || contextKeyRef.current !== expectedContext ||
        generation !== operationStatusGenerationRef.current) return;
      clearPendingIfMatches(operationId, storageKey, expectedContext);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: eligibilityQueryKey }),
        queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] }),
      ]);
      if (status.status === "cancelled") setActionError("This replacement request was cancelled. You may start a new request.");
      else if (status.status === "deleted") setActionError("This replacement request was deleted. You may start a new request.");
      else if (status.status === "completed") setActionError("This replacement request has already completed.");
    });
    return () => { active = false; };
  }, [pendingOperation?.payload.operationId, pendingOwnerKey, storageKey, eligibility?.rootWorkOrderId, contextKey]);

  useEffect(() => {
    if (eligibility?.availableEquipment?.length) {
      setEquipment(current => eligibility.availableEquipment.includes(current as "system" | "module")
        ? current
        : eligibility.availableEquipment.length > 1 ? "both" : eligibility.availableEquipment[0] === "module" ? "module" : "system");
    }
  }, [eligibility?.predecessorFingerprint]);

  const resumeVisit = async (id: number) => {
    const expectedContext = contextKey;
    setBusy(true);
    setActionError("");
    try {
      const claim = await apiRequest("POST", `/api/projects/${projectId}/work-orders/${id}/claim`);
      const claimResult = await claim.json().catch(() => null);
      const claimed = claimResult?.workOrder ?? claimResult ?? {};
      const response = await fetch(`/api/projects/${projectId}/work-orders/${id}`, { credentials: "include" });
      if (!response.ok) throw new Error("Replacement visit could not be loaded.");
      const child = { ...(await response.json()), ...claimed };
      const refreshed = await queryClient.fetchQuery<ReplacementEligibility>({
        queryKey: ["/api/projects", projectId, "work-orders", workOrder.id, "replacement"],
        queryFn: async () => {
          const response = await fetch(`/api/projects/${projectId}/work-orders/${workOrder.id}/replacement`, { credentials: "include" });
          if (!response.ok) throw new Error("Replacement status could not be refreshed.");
          return response.json();
        },
      });
      const visit = (child.replacementVisit ?? child.replacement_visit) as ReplacementVisit | undefined;
      if (!visit) {
        // Some older DTOs omit the nested visit on fetch; preserve the authoritative visit id and let
        // the child DTO refresh catch up rather than creating another replacement.
        throw new Error(refreshed.activeVisit?.canResume
          ? "The active visit is resumable, but its replacement details are not available yet. Retry in a moment."
          : "This replacement visit is no longer resumable.");
      }
      if (visit.cancelledAt || visit.active === false || contextKeyRef.current !== expectedContext) {
        if (contextKeyRef.current === expectedContext)
          setActionError("This replacement visit is no longer active and cannot be resumed.");
        return;
      }
      onLaunch(child, visit, refreshed.inventoryEnabled);
    } catch (error) {
      if (contextKeyRef.current === expectedContext)
        setActionError(error instanceof Error ? error.message : "Could not resume the replacement visit.");
    } finally {
      if (contextKeyRef.current === expectedContext) setBusy(false);
    }
  };

  const cancelActiveVisit = async () => {
    if (!eligibility) return;
    const activeVisit = eligibility?.activeVisit;
    if (!activeVisit?.canResume) return;
    const expectedContext = contextKey;
    const ownerStorageKey = storageKey;
    const rootWorkOrderId = eligibility.rootWorkOrderId;
    const knownOperationId = eligibility.history.find(row => row.workOrderId === activeVisit.workOrderId)?.operationId ?? null;
    setBusy(true);
    setActionError("");
    try {
      await apiRequest("POST", `/api/projects/${projectId}/work-orders/${activeVisit.workOrderId}/replacement/cancel`, {});
      operationStatusGenerationRef.current++;
      if (knownOperationId && pendingOperationRef.current?.payload.operationId === knownOperationId)
        clearPendingIfMatches(knownOperationId, ownerStorageKey, expectedContext);
      else if (pendingOperationRef.current?.payload.operationId) {
        const pendingId = pendingOperationRef.current.payload.operationId;
        const status = await reconcilePendingOperation(pendingId, rootWorkOrderId);
        if (contextKeyRef.current === expectedContext && status && status.status !== "active")
          clearPendingIfMatches(pendingId, ownerStorageKey, expectedContext);
      }
      if (contextKeyRef.current !== expectedContext) return;
      setCancelConfirmOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eligibilityQueryKey }),
        queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] }),
      ]);
      if (contextKeyRef.current === expectedContext)
        toast({ title: "Replacement visit cancelled", description: "The unused visit remains in replacement history." });
    } catch (error) {
      if (contextKeyRef.current !== expectedContext) return;
      const message = error instanceof Error ? error.message : "The replacement visit could not be cancelled.";
      setActionError(message);
      toast({ title: "Unable to cancel replacement visit", description: message, variant: "destructive" });
    } finally {
      if (contextKeyRef.current === expectedContext) setBusy(false);
    }
  };

  const printReplacementHistory = () => {
    const receiptUrl = `/api/projects/${projectId}/work-orders/${workOrder.id}/replacement/receipt`;
    window.open(receiptUrl, "_blank", "noopener,noreferrer");
  };

  const openRecoveryAction = (kind: "restore" | "delete", row: ReplacementHistoryRow) => {
    setRecoveryAction({ kind, row });
    setRecoveryReason("");
    setNoPhysicalReplacement(false);
    setActionError("");
  };

  const submitRecoveryAction = async () => {
    if (!recoveryAction || recoveryReason.trim().length < 10 ||
      recoveryAction.kind === "delete" && !noPhysicalReplacement) return;
    const expectedContext = contextKey;
    const rootWorkOrderId = eligibility?.rootWorkOrderId ?? workOrder.id;
    const action = recoveryAction;
    setBusy(true);
    setActionError("");
    try {
      const path = `/api/projects/${projectId}/work-orders/${action.row.workOrderId}/replacement/${action.kind}`;
      const body = action.kind === "restore"
        ? { reason: recoveryReason.trim() }
        : { reason: recoveryReason.trim(), noPhysicalReplacement: true };
      const response = await apiRequest("POST", path, body);
      await response.json().catch(() => null);
      if (contextKeyRef.current !== expectedContext) return;
      setRecoveryAction(null);
      setRecoveryReason("");
      setNoPhysicalReplacement(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eligibilityQueryKey }),
        queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] }),
      ]);
      if (contextKeyRef.current !== expectedContext) return;
      const refreshed = await refetch();
      if (contextKeyRef.current !== expectedContext) return;
      if (action.kind === "restore") {
        toast({
          title: "Replacement visit restored",
          description: refreshed.data?.activeVisit?.canResume
            ? "The visit is available to resume. Its captured work remains fenced as a fresh attempt."
            : "Eligibility was refreshed. Resume will be available when the visit is assigned to you.",
        });
      } else {
        toast({ title: "Unused replacement deleted", description: "The visit is hidden from operational history and retained in the audit record." });
        if (action.row.workOrderId === workOrder.id) {
          const openedRoot = onOpenWorkOrder ? await onOpenWorkOrder(rootWorkOrderId) : false;
          if (contextKeyRef.current === expectedContext && openedRoot !== true) onDeletedVisit?.();
        }
      }
    } catch (error) {
      if (contextKeyRef.current === expectedContext) {
        const message = error instanceof Error ? error.message : "The recovery action could not be completed.";
        setActionError(message);
        toast({
          title: action.kind === "restore" ? "Unable to restore replacement visit" : "Unable to delete unused replacement",
          description: message,
          variant: "destructive",
        });
      }
    } finally {
      if (contextKeyRef.current === expectedContext) setBusy(false);
    }
  };

  const formatHistoryDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const timezone = (eligibility as (ReplacementEligibility & { timezone?: string }) | undefined)?.timezone;
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: timezone || undefined,
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    } catch {
      return date.toLocaleString();
    }
  };

  const historyEquipmentSummary = (row: ReplacementHistoryRow) => {
    const oldIds = [
      row.oldSystemId && `System ${row.oldSystemId}`,
      row.oldModuleId && `Module ${row.oldModuleId}`,
    ].filter(Boolean);
    const newIds = [
      row.newSystemId && `System ${row.newSystemId}`,
      row.newModuleId && `Module ${row.newModuleId}`,
    ].filter(Boolean);
    const status = row.status.toLowerCase();
    const accountingEvidence = !!row.completedAt || !!row.accountingStatus;
    const completed = status === "completed" || status === "closed" && accountingEvidence;
    const hasEvidence = accountingEvidence || oldIds.length > 0 || newIds.length > 0;
    const mayDescribeRemoval = completed && hasEvidence;
    const mayDescribeInstallation = completed && hasEvidence;
    if (readingOnly) {
      return [
        oldIds.length ? `Existing: ${oldIds.join(" · ")}` : "Existing equipment not recorded",
        newIds.length ? `Captured: ${newIds.join(" · ")}` : "Captured equipment not recorded",
      ].join(" · ");
    }
    return [
      oldIds.length
        ? `${mayDescribeRemoval ? "Removed" : "Previous installed"}: ${oldIds.join(" · ")}`
        : completed && hasEvidence ? "Removal details not recorded" : "Previous installed equipment not recorded",
      newIds.length
        ? `${mayDescribeInstallation ? "Installed" : "Intended replacement"}: ${newIds.join(" · ")}`
        : completed && hasEvidence ? "Installed details not recorded" : "Intended replacement not recorded",
    ].join(" · ");
  };

  const submit = async () => {
    setActionError("");
    if (!eligibility) return;
    const expectedContext = contextKey;
    const ownerStorageKey = storageKey;
    let operation = pendingOwnerKey === ownerStorageKey ? pendingOperation : null;
    if (!operation) {
      const payload: CreateReplacement = {
        operationId: crypto.randomUUID(),
        predecessorFingerprint: eligibility.predecessorFingerprint,
        equipment,
        reason: reason.trim(),
        vehicleId: vehicleId === "warehouse" ? null : vehicleId,
      };
      operation = { payload };
      setPendingOperation(operation);
      setPendingOwnerKey(ownerStorageKey);
      try { localStorage.setItem(ownerStorageKey, JSON.stringify(operation)); }
      catch {
        setPendingOperation(null);
        setPendingOwnerKey(null);
        setActionError("Browser storage is unavailable. Request not sent; enable storage and retry.");
        return;
      }
    }
    setBusy(true);
    let result: ReplacementResponse;
    try {
      const response = await apiRequest("POST", `/api/projects/${projectId}/work-orders/${workOrder.id}/replacement`, operation.payload);
      result = await response.json() as ReplacementResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request outcome is unknown. Retry this exact request.";
      const deletedOperation = /410[\s\S]*REPLACEMENT_DELETED|REPLACEMENT_DELETED[\s\S]*410/i.test(message);
      if (deletedOperation) {
        clearPendingIfMatches(operation.payload.operationId, ownerStorageKey, expectedContext);
        if (contextKeyRef.current === expectedContext) {
          setActionError("This replacement visit was deleted and cannot be resumed. You may start a new request.");
          void Promise.all([
            queryClient.invalidateQueries({ queryKey: eligibilityQueryKey }),
            queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] }),
          ]);
        }
      } else if (/^(400|403|409):/.test(message)) {
        // These responses are definitive rejections: no visit was created, so allow correction or refresh.
        clearPendingIfMatches(operation.payload.operationId, ownerStorageKey, expectedContext);
        if (contextKeyRef.current === expectedContext) {
          setActionError(message);
          const refreshed = await refetch();
          if (contextKeyRef.current === expectedContext && refreshed.data?.availableEquipment?.length) {
            setEquipment(refreshed.data.availableEquipment.length > 1 ? "both" : refreshed.data.availableEquipment[0] === "module" ? "module" : "system");
          }
        }
      } else {
        // Keep the exact payload and operation id; unknown outcomes must never mint a second visit.
        if (contextKeyRef.current === expectedContext) {
          setActionError(message);
          void queryClient.invalidateQueries({ queryKey: eligibilityQueryKey });
        }
      }
      if (contextKeyRef.current === expectedContext) setBusy(false);
      return;
    }

    if (!result.workOrder?.id || !result.replacementVisit) {
      if (contextKeyRef.current === expectedContext) {
        setActionError("The server response was incomplete. Retry the same request.");
        setBusy(false);
      }
      return;
    }
    clearPendingIfMatches(operation.payload.operationId, ownerStorageKey, expectedContext);
    if (contextKeyRef.current !== expectedContext) return;
    const returnedStatus = String(result.workOrder.statusCode ?? result.workOrder.status_code ?? result.workOrder.status ?? "").toLowerCase();
    const cancelled = !!result.replacementVisit.cancelledAt ||
      !!(result.workOrder.replacementCancelledAt ?? result.workOrder.replacement_cancelled_at) || returnedStatus === "cancelled";
    const completed = returnedStatus === "completed" || result.replacementVisit.active === false && !cancelled;
    if (cancelled || completed) {
      if (contextKeyRef.current === expectedContext) {
        setActionError(cancelled
          ? "This request already belongs to a cancelled replacement visit. It was not resumed."
          : "This replacement visit has already completed. It was not resumed.");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: eligibilityQueryKey }),
          queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] }),
        ]);
      }
      if (contextKeyRef.current === expectedContext) setBusy(false);
      return;
    }
    try {
      const claimResponse = await apiRequest("POST", `/api/projects/${projectId}/work-orders/${result.workOrder.id}/claim`);
      const claimResult = await claimResponse.json().catch(() => null);
      const claimed = claimResult?.workOrder ?? claimResult ?? {};
      if (contextKeyRef.current !== expectedContext) return;
      const refreshedOrder = await fetch(`/api/projects/${projectId}/work-orders/${result.workOrder.id}`, { credentials: "include" });
      if (!refreshedOrder.ok) throw new Error("Visit created, but its assignment could not be confirmed. Resume the active visit from this work order.");
      const claimedOrder = { ...(await refreshedOrder.json()), ...claimed };
      if (contextKeyRef.current !== expectedContext) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: eligibilityQueryKey }),
        queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] }),
      ]);
      const visit = claimedOrder.replacementVisit ?? claimedOrder.replacement_visit ?? result.replacementVisit;
      if (visit.cancelledAt || visit.active === false) {
        setActionError("This replacement visit is no longer active. It was not opened.");
        return;
      }
      onLaunch(claimedOrder, visit, eligibility.inventoryEnabled);
    } catch (error) {
      if (contextKeyRef.current === expectedContext) {
        const message = error instanceof Error ? error.message : "The visit was created but could not be opened.";
        setActionError(message);
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: eligibilityQueryKey }),
          queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] }),
        ]);
      }
    } finally {
      if (contextKeyRef.current === expectedContext) setBusy(false);
    }
  };

  if (isLoading) return <div className="rounded-xl border border-teal-900/10 bg-teal-50/30 p-5" data-testid="replacement-loading"><div className="h-4 w-40 animate-pulse rounded bg-muted" /><div className="mt-3 h-3 w-3/4 animate-pulse rounded bg-muted" /></div>;
  if (isError) return <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4" data-testid="replacement-error"><span className="text-sm">{readingOnly ? "Read history could not load." : "Replacement options could not load."}</span><Button size="sm" variant="outline" onClick={() => void refetch()} data-testid="button-retry-replacement-eligibility">Retry</Button></div>;
  if (!eligibility) return null;

  return (
    <Card className="overflow-hidden border-teal-900/15 bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--primary)/0.045))]" data-testid="defective-replacement-panel">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-teal-900/8 p-2.5 text-teal-900 dark:text-teal-100"><Wrench className="h-5 w-5" /></span>
            <div><CardTitle className="text-base">{readingOnly ? "Read history" : "Defective equipment replacement"}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{readingOnly ? "Review captured readings for this work order." : "Open a tracked replacement visit for this work order."}</p></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={printReplacementHistory} data-testid="button-print-replacement-history">
              Print history
            </Button>
            {eligibility.activeVisit && <Button type="button" onClick={() => void resumeVisit(eligibility.activeVisit!.workOrderId)} disabled={busy || !eligibility.activeVisit.canResume} data-testid="button-resume-replacement">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRight className="mr-2 h-4 w-4" />}
              {eligibility.activeVisit.canResume ? "Resume active visit" : "Visit unavailable"}
            </Button>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {eligibility.activeVisit && <div className="rounded-lg border bg-background/70 px-3 py-2.5 text-sm" data-testid="replacement-active-visit">
          <span className="font-medium">{eligibility.activeVisit.label}</span><span className="ml-2 text-muted-foreground">#{eligibility.activeVisit.workOrderId}</span>
          {!eligibility.activeVisit.canResume && <p className="mt-1 text-xs text-muted-foreground">This visit is active but not available to resume under the current assignment.</p>}
        </div>}
        {!readingOnly && !eligibility.activeVisit && eligibility.canCreate && <div className="grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,0.9fr)]">
          <div className="space-y-2">
            <Label htmlFor={`replacement-equipment-${workOrder.id}`}>Equipment scope</Label>
            <Select value={currentPendingOperation?.payload.equipment ?? equipment} onValueChange={value => setEquipment(value as typeof equipment)} disabled={!!currentPendingOperation}>
              <SelectTrigger id={`replacement-equipment-${workOrder.id}`} data-testid="select-replacement-equipment"><SelectValue /></SelectTrigger>
              <SelectContent>
                {eligibility.availableEquipment.includes("system") && <SelectItem value="system">System</SelectItem>}
                {eligibility.availableEquipment.includes("module") && <SelectItem value="module">Module</SelectItem>}
                {eligibility.availableEquipment.includes("system") && eligibility.availableEquipment.includes("module") && <SelectItem value="both">System + module</SelectItem>}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`replacement-reason-${workOrder.id}`}>Why is it being replaced?</Label>
            <Textarea id={`replacement-reason-${workOrder.id}`} value={currentPendingOperation?.payload.reason ?? reason} onChange={event => setReason(event.target.value)} disabled={!!currentPendingOperation} maxLength={2000} minLength={10} placeholder="Describe the defect and why replacement is required." className="min-h-[84px] resize-y" data-testid="textarea-replacement-reason" />
            <p className="text-xs text-muted-foreground">At least 10 characters. {currentPendingOperation ? "A failed request is locked to its original payload." : `${reason.trim().length}/2000`}</p>
          </div>
          <div className="space-y-2">
            <Label>Replacement stock source</Label>
            <Select value={currentPendingOperation ? (currentPendingOperation.payload.vehicleId ?? "warehouse") : vehicleId} onValueChange={setVehicleId} disabled={!!currentPendingOperation}>
              <SelectTrigger data-testid="select-replacement-vehicle"><SelectValue placeholder="Choose source" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="warehouse">Warehouse fulfillment</SelectItem>
                {eligibility.vehicles.map(vehicle => <SelectItem key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.code}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Choose a vehicle only when taking replacement stock from accessible onboard inventory.</p>
          </div>
        </div>}
        {eligibility.activeVisit?.canResume && <div className="flex justify-end border-t pt-3">
          <Button type="button" variant="outline" onClick={() => setCancelConfirmOpen(true)} disabled={busy} data-testid="button-cancel-unused-replacement">
            Cancel unused visit
          </Button>
        </div>}
        {!eligibility.activeVisit && (readingOnly || !eligibility.canCreate) && (readingOnly
          ? <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="replacement-ineligible">This project records readings only; equipment is not replaced.</p>
          : <div className="flex items-start gap-2 rounded-lg border border-amber-700/20 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20" data-testid="replacement-ineligible"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" /><span>{eligibility.reason || "A replacement visit cannot be created for this work order."}</span></div>)}
        {actionError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive" data-testid="replacement-action-error"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{actionError}</span></div>}
        {!readingOnly && (currentPendingOperation || (!eligibility.activeVisit && eligibility.canCreate)) && <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">The original work order remains in history. Replacement evidence is captured in a linked visit.</p>
          <Button type="button" onClick={() => void submit()} disabled={busy || (!currentPendingOperation && reason.trim().length < 10)} data-testid={currentPendingOperation ? "button-retry-replacement" : "button-create-replacement"}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : currentPendingOperation ? <RotateCcw className="mr-2 h-4 w-4" /> : <ArrowRight className="mr-2 h-4 w-4" />}
            {busy ? "Sending…" : currentPendingOperation ? "Retry same request" : "Start replacement visit"}
          </Button>
        </div>}
        <section className="border-t pt-4" data-testid="replacement-history">
          <h3 className="text-sm font-semibold">{readingOnly ? "Read history" : "Replacement history"}</h3>
          {eligibility.history.length > 0 ? <ol className="mt-2 divide-y">
            {eligibility.history.map(row => <li key={row.workOrderId} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm" data-testid={`replacement-history-row-${row.workOrderId}`}>
              <div className="min-w-0"><p className="font-medium">{row.label} <span className="font-normal text-muted-foreground">· #{row.workOrderId}</span></p>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.equipment ? row.equipment === "both" ? "System + module" : row.equipment : readingOnly ? "Reading capture" : "Replacement"}{row.reason ? ` — ${row.reason}` : ""}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                   {historyEquipmentSummary(row)}
                  {row.completedAt ? ` · ${formatHistoryDate(row.completedAt)}` : ""}
                </p>
                 {row.recovery?.restoreReason && !row.recovery.canRestore && <p className="mt-1 text-xs text-muted-foreground">{row.recovery.restoreReason}</p>}
                 {row.recovery?.deleteReason && !row.recovery.canDelete && <p className="mt-1 text-xs text-muted-foreground">{row.recovery.deleteReason}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs capitalize">{row.status.replaceAll("_", " ")}</span>
                 {!readingOnly && row.accountingStatus && <span className="text-xs text-muted-foreground">Stock: {row.accountingStatus.replaceAll("_", " ")}</span>}
                 {row.recovery?.canRestore && <Button type="button" size="sm" variant="outline" disabled={busy}
                   onClick={() => openRecoveryAction("restore", row)} data-testid={`button-restore-replacement-${row.workOrderId}`}>Restore</Button>}
                 {row.recovery?.canDelete && <Button type="button" size="sm" variant="outline" disabled={busy}
                   onClick={() => openRecoveryAction("delete", row)} data-testid={`button-delete-unused-replacement-${row.workOrderId}`}>Delete unused</Button>}
                <Link
                  href={`/projects/${projectId}/work-orders?edit=${row.workOrderId}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline"
                  data-testid={`link-replacement-work-order-${row.workOrderId}`}
                  onClick={event => {
                    if (!onOpenWorkOrder || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                    event.preventDefault();
                    onOpenWorkOrder(row.workOrderId);
                  }}
                >
                  Open work order <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </li>)}
          </ol> : <p className="mt-2 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground" data-testid="replacement-history-empty">No replacement visits are recorded for this work order.</p>}
        </section>
      </CardContent>
      <AlertDialog open={cancelConfirmOpen} onOpenChange={open => !busy && setCancelConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this unused replacement visit?</AlertDialogTitle>
            <AlertDialogDescription>
              The visit will remain in replacement history as cancelled. This action cannot cancel a completed or posted installation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy} data-testid="button-cancel-replacement-confirmation-dismiss">Keep visit</AlertDialogCancel>
            <AlertDialogAction onClick={event => { event.preventDefault(); void cancelActiveVisit(); }} disabled={busy} data-testid="button-confirm-cancel-replacement">
              {busy ? "Cancelling…" : "Cancel unused visit"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!recoveryAction} onOpenChange={open => {
        if (busy) return;
        if (!open) {
          setRecoveryAction(null);
          setRecoveryReason("");
          setNoPhysicalReplacement(false);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {recoveryAction?.kind === "restore" ? "Restore this cancelled replacement?" : "Delete this unused replacement?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {recoveryAction?.kind === "restore"
                ? <>
                    <span>Restoring revalidates the current baseline, assignment, and stock source. Captures are preserved, but the restored visit starts a fresh fenced attempt.</span>
                    {recoveryAction.row.recovery?.restoreAssigneeLabel && <span className="mt-2 block">Assigned user: {recoveryAction.row.recovery.restoreAssigneeLabel}</span>}
                    {recoveryAction.row.recovery?.usesOriginalRequester && <span className="mt-2 block">This older cancelled visit did not retain its cancellation assignment. It will restore to the original requesting user, not a previous technician.</span>}
                  </>
                : "This removes the cancelled unused visit from operational history and deletes its saved wizard inputs. Its audit record is retained. Confirm that no physical replacement occurred."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="replacement-recovery-reason">Reason <span className="text-destructive">*</span></Label>
              <Textarea
                id="replacement-recovery-reason"
                value={recoveryReason}
                onChange={event => setRecoveryReason(event.target.value)}
                maxLength={1000}
                minLength={10}
                placeholder={recoveryAction?.kind === "restore" ? "Explain why this visit should be restored." : "Explain why the unused visit should be removed from operational history."}
                className="min-h-24"
                data-testid="input-replacement-recovery-reason"
              />
              <p className="text-xs text-muted-foreground">{recoveryReason.trim().length}/1000 · At least 10 characters.</p>
            </div>
            {recoveryAction?.kind === "delete" && <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                checked={noPhysicalReplacement}
                onChange={event => setNoPhysicalReplacement(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                data-testid="checkbox-no-physical-replacement"
              />
              <span>I confirm that no physical replacement was performed.</span>
            </label>}
            {recoveryAction && actionError && <p role="alert" className="rounded-md border border-destructive/25 bg-destructive/5 p-2 text-sm text-destructive">{actionError}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep history</AlertDialogCancel>
            <AlertDialogAction
              onClick={event => { event.preventDefault(); void submitRecoveryAction(); }}
              disabled={busy || recoveryReason.trim().length < 10 || recoveryAction?.kind === "delete" && !noPhysicalReplacement}
              data-testid={recoveryAction?.kind === "restore" ? "button-confirm-restore-replacement" : "button-confirm-delete-replacement"}
            >
              {busy ? "Saving…" : recoveryAction?.kind === "restore" ? "Restore visit" : "Delete unused visit"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
