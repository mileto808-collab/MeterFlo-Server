import { useEffect, useState } from "react";
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
import type { CreateReplacement, ReplacementEligibility, ReplacementVisit } from "@shared/defective-replacement";

type PendingOperation = { payload: CreateReplacement };
type ReplacementResponse = { workOrder: any; replacementVisit: ReplacementVisit; replay: boolean };

interface DefectiveReplacementPanelProps {
  projectId: number;
  workOrder: any;
  onLaunch: (workOrder: any, visit: ReplacementVisit, inventoryEnabled: boolean) => void;
  onOpenWorkOrder?: (workOrderId: number) => void;
}

export function DefectiveReplacementPanel({ projectId, workOrder, onLaunch, onOpenWorkOrder }: DefectiveReplacementPanelProps) {
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
  const storageKey = `meterflo.replacement-operation:${user?.id ?? "unknown"}:${projectId}:${workOrder.id}`;

  const { data: eligibility, isLoading, isError, refetch } = useQuery<ReplacementEligibility>({
    queryKey: ["/api/projects", projectId, "work-orders", workOrder.id, "replacement"],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/work-orders/${workOrder.id}/replacement`, { credentials: "include" });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.message || "Replacement eligibility could not load.");
      return response.json();
    },
    enabled: !!projectId && !!workOrder.id,
    retry: 1,
  });

  useEffect(() => {
    setPendingOperation(null);
    setActionError("");
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setPendingOperation(JSON.parse(saved) as PendingOperation);
    } catch {
      setActionError("Saved replacement request could not be read. It has not been submitted.");
    }
  }, [storageKey]);

  useEffect(() => {
    if (eligibility?.availableEquipment?.length) {
      setEquipment(current => eligibility.availableEquipment.includes(current as "system" | "module")
        ? current
        : eligibility.availableEquipment.length > 1 ? "both" : eligibility.availableEquipment[0] === "module" ? "module" : "system");
    }
  }, [eligibility?.predecessorFingerprint]);

  const resumeVisit = async (id: number) => {
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
      onLaunch(child, visit, refreshed.inventoryEnabled);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not resume the replacement visit.");
    } finally {
      setBusy(false);
    }
  };

  const cancelActiveVisit = async () => {
    const activeVisit = eligibility?.activeVisit;
    if (!activeVisit?.canResume) return;
    setBusy(true);
    setActionError("");
    try {
      await apiRequest("POST", `/api/projects/${projectId}/work-orders/${activeVisit.workOrderId}/replacement/cancel`, {});
      setCancelConfirmOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "work-orders", workOrder.id, "replacement"] }),
        queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] }),
      ]);
      toast({ title: "Replacement visit cancelled", description: "The unused visit remains in replacement history." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The replacement visit could not be cancelled.";
      setActionError(message);
      toast({ title: "Unable to cancel replacement visit", description: message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const printReplacementHistory = () => {
    const receiptUrl = `/api/projects/${projectId}/work-orders/${workOrder.id}/replacement/receipt`;
    window.open(receiptUrl, "_blank", "noopener,noreferrer");
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

  const submit = async () => {
    setActionError("");
    if (!eligibility) return;
    let operation = pendingOperation;
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
      try { localStorage.setItem(storageKey, JSON.stringify(operation)); }
      catch {
        setPendingOperation(null);
        setActionError("Browser storage is unavailable. Request not sent; enable storage and retry.");
        return;
      }
    }
    setBusy(true);
    try {
      const response = await apiRequest("POST", `/api/projects/${projectId}/work-orders/${workOrder.id}/replacement`, operation.payload);
      const result = await response.json() as ReplacementResponse;
      if (!result.workOrder?.id || !result.replacementVisit) throw new Error("The server response was incomplete. Retry the same request.");
      localStorage.removeItem(storageKey);
      setPendingOperation(null);
      const claimResponse = await apiRequest("POST", `/api/projects/${projectId}/work-orders/${result.workOrder.id}/claim`);
      const claimResult = await claimResponse.json().catch(() => null);
      const claimed = claimResult?.workOrder ?? claimResult ?? {};
      const refreshedOrder = await fetch(`/api/projects/${projectId}/work-orders/${result.workOrder.id}`, { credentials: "include" });
      if (!refreshedOrder.ok) throw new Error("Visit created, but its assignment could not be confirmed. Resume the active visit from this work order.");
      const claimedOrder = { ...(await refreshedOrder.json()), ...claimed };
      await queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "work-orders", workOrder.id, "replacement"] });
      await queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/work-orders`] });
      const visit = claimedOrder.replacementVisit ?? claimedOrder.replacement_visit ?? result.replacementVisit;
      onLaunch(claimedOrder, visit, eligibility.inventoryEnabled);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request outcome is unknown. Retry this exact request.";
      if (/^(400|403|409):/.test(message)) {
        // These responses are definitive rejections: no visit was created, so allow correction or refresh.
        try { localStorage.removeItem(storageKey); } catch { /* The UI still unlocks; the rejection is definitive. */ }
        setPendingOperation(null);
        setActionError(message);
        const refreshed = await refetch();
        if (refreshed.data?.availableEquipment?.length) {
          setEquipment(refreshed.data.availableEquipment.length > 1 ? "both" : refreshed.data.availableEquipment[0] === "module" ? "module" : "system");
        }
      } else {
        // Keep the exact payload and operation id; unknown outcomes must never mint a second visit.
        setActionError(message);
        void queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "work-orders", workOrder.id, "replacement"] });
      }
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <div className="rounded-xl border border-teal-900/10 bg-teal-50/30 p-5" data-testid="replacement-loading"><div className="h-4 w-40 animate-pulse rounded bg-muted" /><div className="mt-3 h-3 w-3/4 animate-pulse rounded bg-muted" /></div>;
  if (isError) return <div className="flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4" data-testid="replacement-error"><span className="text-sm">Replacement options could not load.</span><Button size="sm" variant="outline" onClick={() => void refetch()} data-testid="button-retry-replacement-eligibility">Retry</Button></div>;
  if (!eligibility) return null;

  return (
    <Card className="overflow-hidden border-teal-900/15 bg-[linear-gradient(135deg,hsl(var(--card)),hsl(var(--primary)/0.045))]" data-testid="defective-replacement-panel">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-teal-900/8 p-2.5 text-teal-900 dark:text-teal-100"><Wrench className="h-5 w-5" /></span>
            <div><CardTitle className="text-base">Defective equipment replacement</CardTitle><p className="mt-1 text-sm text-muted-foreground">Open a tracked replacement visit for this work order.</p></div>
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
        {!eligibility.activeVisit && eligibility.canCreate && <div className="grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,0.9fr)]">
          <div className="space-y-2">
            <Label htmlFor={`replacement-equipment-${workOrder.id}`}>Equipment scope</Label>
            <Select value={pendingOperation?.payload.equipment ?? equipment} onValueChange={value => setEquipment(value as typeof equipment)} disabled={!!pendingOperation}>
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
            <Textarea id={`replacement-reason-${workOrder.id}`} value={pendingOperation?.payload.reason ?? reason} onChange={event => setReason(event.target.value)} disabled={!!pendingOperation} maxLength={2000} minLength={10} placeholder="Describe the defect and why replacement is required." className="min-h-[84px] resize-y" data-testid="textarea-replacement-reason" />
            <p className="text-xs text-muted-foreground">At least 10 characters. {pendingOperation ? "A failed request is locked to its original payload." : `${reason.trim().length}/2000`}</p>
          </div>
          <div className="space-y-2">
            <Label>Replacement stock source</Label>
            <Select value={pendingOperation ? (pendingOperation.payload.vehicleId ?? "warehouse") : vehicleId} onValueChange={setVehicleId} disabled={!!pendingOperation}>
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
        {!eligibility.canCreate && !eligibility.activeVisit && <div className="flex items-start gap-2 rounded-lg border border-amber-700/20 bg-amber-50/60 p-3 text-sm dark:bg-amber-950/20" data-testid="replacement-ineligible"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" /><span>{eligibility.reason || "A replacement visit cannot be created for this work order."}</span></div>}
        {actionError && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive" data-testid="replacement-action-error"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{actionError}</span></div>}
        {(pendingOperation || (!eligibility.activeVisit && eligibility.canCreate)) && <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-xs text-muted-foreground">The original work order remains in history. Replacement evidence is captured in a linked visit.</p>
          <Button type="button" onClick={() => void submit()} disabled={busy || (!pendingOperation && reason.trim().length < 10)} data-testid={pendingOperation ? "button-retry-replacement" : "button-create-replacement"}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : pendingOperation ? <RotateCcw className="mr-2 h-4 w-4" /> : <ArrowRight className="mr-2 h-4 w-4" />}
            {busy ? "Sending…" : pendingOperation ? "Retry same request" : "Start replacement visit"}
          </Button>
        </div>}
        <section className="border-t pt-4" data-testid="replacement-history">
          <h3 className="text-sm font-semibold">Replacement history</h3>
          {eligibility.history.length > 0 ? <ol className="mt-2 divide-y">
            {eligibility.history.map(row => <li key={row.workOrderId} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm" data-testid={`replacement-history-row-${row.workOrderId}`}>
              <div className="min-w-0"><p className="font-medium">{row.label} <span className="font-normal text-muted-foreground">· #{row.workOrderId}</span></p>
                <p className="mt-0.5 text-xs text-muted-foreground">{row.equipment ? row.equipment === "both" ? "System + module" : row.equipment : "Replacement"}{row.reason ? ` — ${row.reason}` : ""}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.oldSystemId || row.oldModuleId ? `Removed: ${[row.oldSystemId && `System ${row.oldSystemId}`, row.oldModuleId && `Module ${row.oldModuleId}`].filter(Boolean).join(" · ")}` : "Removed equipment not recorded"}
                  {row.newSystemId || row.newModuleId ? ` · Installed: ${[row.newSystemId && `System ${row.newSystemId}`, row.newModuleId && `Module ${row.newModuleId}`].filter(Boolean).join(" · ")}` : ""}
                  {row.completedAt ? ` · ${formatHistoryDate(row.completedAt)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2.5 py-1 text-xs capitalize">{row.status.replaceAll("_", " ")}</span>
                {row.accountingStatus && <span className="text-xs text-muted-foreground">Stock: {row.accountingStatus.replaceAll("_", " ")}</span>}
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
    </Card>
  );
}
