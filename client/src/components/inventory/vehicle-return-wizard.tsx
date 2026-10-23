import { useInventoryHistory } from "@/hooks/use-inventory-history";
import { useWizardStepFocus } from "@/hooks/useWizardStepFocus";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Loader2, Truck } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { serialTokens } from "@/components/inventory/serial-scan-field";
import { meaningfulVehicleReturn, scanTokens, type SavedVehicleReturnDraft, type VehicleReturnCapture, type VehicleReturnEvidence, type VehicleReturnKind } from "@shared/inventory-vehicle-returns";
import type { InventoryItem } from "@shared/inventory";
import { isLaborItem } from "@shared/inventory-pricing";
import { VehicleReturnWizardSteps } from "@/components/inventory/vehicle-return-wizard-steps";
import type { ReturnEquipment, VehicleReturnStep, WorkflowData } from "@/components/inventory/vehicle-return-workflow-types";
import {
  readVehicleReturnLocalRecovery,
  useVehicleReturnDraftSync,
  type VehicleReturnLocalRecovery,
} from "@/components/inventory/use-vehicle-return-draft-sync";

export type { VehicleReturnScreen } from "@/components/inventory/vehicle-return-workflow-types";
type Step = VehicleReturnStep;
const emptyCapture = (kind: VehicleReturnKind): VehicleReturnCapture => ({
  kind, sourceId: "", destinationId: "", itemIds: [], returnIds: [], quantities: {}, scans: {}, reason: "",
});
const storageKey = (projectId: number, userId: string, kind: VehicleReturnKind) =>
  `meterflo:vehicle-return:${encodeURIComponent(userId)}:${projectId}:${kind}`;
const uniqueTokens = (value: string) => scanTokens(value);
const physicalItem = (item: InventoryItem) => item.active && !isLaborItem(item);
export function VehicleReturnWizard({ projectId, kind, permissions, onClose }: {
  projectId: number; kind: VehicleReturnKind; permissions?: string[]; onClose: () => void;
}) {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const userId = user?.id ? String(user.id) : "";
  const can = (permission: string) => permissions !== undefined ? permissions.includes(permission) : hasPermission(permission);
  const canUse = kind === "equipment" ? can("inventory.view") && can("inventory.receive")
    : kind === "count" ? can("inventory.view") && can("inventory.count")
      : can("inventory.view") && can("inventory.receive") && can("inventory.transfer");
  const base = `/api/projects/${projectId}/inventory`;
  const [capture, setCapture] = useState<VehicleReturnCapture>(() => emptyCapture(kind));
  const [step, setStep] = useState<Step>("setup");
  const [draft, setDraft] = useState<SavedVehicleReturnDraft | null>(null);
  const [message, setMessage] = useState("");
  const [conflictDraft, setConflictDraft] = useState<SavedVehicleReturnDraft | null>(null);
  const [physicallyConfirmed, setPhysicallyConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<"selected" | "all">("selected");
  const [restoreReady, setRestoreReady] = useState(false);
  const [receiptId, setReceiptId] = useState("");
  const [receiptEvidence, setReceiptEvidence] = useState<Pick<VehicleReturnEvidence, "needsReview" | "countId"> | null>(null);
  const [prepared, setPrepared] = useState(false);
  useInventoryHistory(`vehicle-return:${projectId}:${kind}:${draft?.id ?? "new"}`, step,
    value => setStep(draft?.status === "posted" ? "receipt" : value),
    { enabled: restoreReady, canRestore: !busy && !prepared });
  const [addItemId, setAddItemId] = useState("");
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const contentRef = useRef<HTMLElement | null>(null);
  const pageRef = useRef<HTMLElement | null>(null);
  const frozenCommandRef = useRef<SavedVehicleReturnDraft["command"]>(undefined);
  const restoredForKeyRef = useRef("");
  const localKey = userId ? storageKey(projectId, userId, kind) : "";
  const restoreReadyForKey = restoreReady && restoredForKeyRef.current === localKey;

  const workflowQuery = useQuery<WorkflowData>({
    queryKey: [base, "vehicle-return-workflows", kind, capture.sourceId, userId],
    queryFn: async () => {
      const params = new URLSearchParams({ kind });
      if (capture.sourceId) params.set("sourceId", capture.sourceId);
      return (await apiRequest("GET", `${base}/vehicle-return-workflows?${params}`)).json();
    },
    enabled: !!userId && canUse,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });
  const data = workflowQuery.data;
  const draftSync = useVehicleReturnDraftSync({
    base, localKey, capture, captureRef, setCapture, draft, setDraft, setConflictDraft, restoreReady: restoreReadyForKey, busy,
    prepared, conflictDraft, data, frozenCommandRef,
  });
  const {
    syncError, setSyncError, syncing, lastSavedSignature, persistLocal, retrySync,
    restoreRecovery, setRecoveryAnchor, pendingSaveRef,
  } = draftSync;
  const items = useMemo(() => (data?.items ?? []).filter(physicalItem), [data?.items]);
  const selectedEquipment = useMemo(() => (data?.equipment ?? []).filter(row => capture.returnIds.includes(row.id)),
    [data?.equipment, capture.returnIds]);
  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const stockByItem = useMemo(() => new Map((data?.stock ?? []).map(row => [row.itemId, row])), [data?.stock]);
  const sourceVehicle = data?.vehicles.find(row => row.id === capture.sourceId);
  const destinations = (data?.destinations ?? []).filter(row => row.id !== capture.sourceId);
  // Restore exactly once per local key. Query refreshes only update the shared-draft list;
  // they never select or replace the active local capture.
  useEffect(() => {
    if (!data || !localKey || restoredForKeyRef.current === localKey) return;
    if (restoredForKeyRef.current && restoredForKeyRef.current !== localKey) setRestoreReady(false);
    restoredForKeyRef.current = localKey;
    setDraft(null);
    setConflictDraft(null);
    setPrepared(false);
    setPhysicallyConfirmed(false);
    setMessage("");
    setReceiptId("");
    setReceiptEvidence(null);
    frozenCommandRef.current = undefined;
    setSyncError("");
    const local: VehicleReturnLocalRecovery | null = (() => {
      try { return readVehicleReturnLocalRecovery(localKey); }
      catch {
        setSyncError("A local recovery buffer could not be read; the shared draft remains available.");
        return null;
      }
    })();
    const recoverLocal = !!local && (
      !!local.pendingSave || !!local.command ||
      (!!local.capture && local.capture.kind === kind && meaningfulVehicleReturn(local.capture))
    );
    restoreRecovery(recoverLocal ? local : null);
    const localCapture = local && local.capture?.kind === kind ? local.capture : emptyCapture(kind);
    const exactDraftId = recoverLocal ? local?.pendingSave?.id ?? local?.draftId ?? local?.command?.data.draftId : undefined;

    void (async () => {
      try {
        let serverDraft: SavedVehicleReturnDraft | undefined;
        let detailMissing = false;
        if (exactDraftId) {
          try {
            const response = await apiRequest("GET", `${base}/vehicle-return-workflows/drafts/${exactDraftId}`);
            serverDraft = (await response.json() as { draft: SavedVehicleReturnDraft }).draft;
          } catch (error) {
            detailMissing = error instanceof Error && /^404:/.test(error.message);
            if (!detailMissing) setSyncError("The exact saved draft could not be checked. Local recovery is retained; retry before continuing.");
          }
        }

        if (serverDraft) {
          setDraft(serverDraft);
          frozenCommandRef.current = serverDraft.status === "submitting" || serverDraft.status === "posted"
            ? serverDraft.command ?? local?.command : undefined;
          const anchor = { draftId: serverDraft.id, baseRevision: serverDraft.revision };
          if (serverDraft.status === "posted") {
            setRecoveryAnchor(serverDraft.id, serverDraft.revision);
            setCapture(serverDraft.capture);
            setStep("receipt");
            setReceiptId(serverDraft.receiptId ?? "");
            setPrepared(false);
            lastSavedSignature.current = JSON.stringify(serverDraft.capture);
          } else if (serverDraft.status === "deleted") {
            setRecoveryAnchor(serverDraft.id, serverDraft.revision);
            setCapture(meaningfulVehicleReturn(localCapture) ? localCapture : serverDraft.capture);
            setConflictDraft(serverDraft);
            setMessage("This exact shared draft was deleted. Your local text is retained; explicitly keep it as a separate draft to continue.");
            setStep("setup");
            setPrepared(false);
            lastSavedSignature.current = JSON.stringify(serverDraft.capture);
          } else if (serverDraft.status === "submitting") {
            setRecoveryAnchor(serverDraft.id, serverDraft.revision);
            setCapture(serverDraft.capture);
            setStep("review");
            setPrepared(true);
            setPhysicallyConfirmed(false);
            lastSavedSignature.current = JSON.stringify(serverDraft.capture);
          } else {
            const pending = local?.pendingSave;
            setStep("setup");
            setPrepared(false);
            setPhysicallyConfirmed(false);
            if (pending && serverDraft.saveId === pending.saveId) {
              // Detail confirms the uncertain save was applied; newer local text can now advance from this revision.
              setRecoveryAnchor(serverDraft.id, serverDraft.revision);
              setCapture(meaningfulVehicleReturn(localCapture) ? localCapture : serverDraft.capture);
              persistLocal(meaningfulVehicleReturn(localCapture) ? localCapture : serverDraft.capture, {
                anchor, pendingSave: null,
              });
              lastSavedSignature.current = JSON.stringify(serverDraft.capture);
              if (JSON.stringify(localCapture) !== JSON.stringify(serverDraft.capture))
                setMessage("Recovered newer local edits after confirming the previous save. They will sync from this exact revision.");
            } else if (pending && serverDraft.revision === pending.revision) {
              // The exact write is still pending; the hook retries the persisted id/revision/saveId/capture.
              restoreRecovery(local);
              setCapture(meaningfulVehicleReturn(localCapture) ? localCapture : pending.capture);
              lastSavedSignature.current = JSON.stringify(serverDraft.capture);
              setMessage("Recovered an unacknowledged save. Retrying the same operation identity before syncing newer text.");
            } else if (pending) {
              // Another write advanced this id without acknowledging our save.
              setRecoveryAnchor(serverDraft.id, serverDraft.revision);
              setCapture(meaningfulVehicleReturn(localCapture) ? localCapture : pending.capture);
              setConflictDraft(serverDraft);
              lastSavedSignature.current = JSON.stringify(serverDraft.capture);
              setMessage("The shared draft advanced while a local save was uncertain. Review this exact draft; local text has not replaced it.");
            } else if (local?.draftId === serverDraft.id && local.capture && local.baseRevision === serverDraft.revision) {
              setRecoveryAnchor(serverDraft.id, serverDraft.revision);
              setCapture(local.capture);
              lastSavedSignature.current = JSON.stringify(serverDraft.capture);
              if (JSON.stringify(local.capture) !== JSON.stringify(serverDraft.capture))
                setMessage("Recovered unsynced local edits against their original shared revision.");
            } else if (local?.capture && JSON.stringify(local.capture) !== JSON.stringify(serverDraft.capture)) {
              // Never transplant edits onto a newer arbitrary revision.
              setRecoveryAnchor(local.draftId, local.baseRevision ?? -1);
              setCapture(local.capture);
              setConflictDraft(serverDraft);
              lastSavedSignature.current = JSON.stringify(serverDraft.capture);
              setMessage("The saved revision changed after these local edits. Review the exact shared draft or keep the local capture separately.");
            } else {
              setRecoveryAnchor(serverDraft.id, serverDraft.revision);
              setCapture(serverDraft.capture);
              lastSavedSignature.current = JSON.stringify(serverDraft.capture);
              persistLocal(serverDraft.capture, { anchor, pendingSave: null });
            }
          }
        } else if (recoverLocal && local) {
          setDraft(null);
          setCapture(localCapture);
          frozenCommandRef.current = local.command;
          if (local.command) {
            setRecoveryAnchor(exactDraftId, local.baseRevision ?? local.command.data.draftRevision);
            setStep("review");
            setPrepared(true);
            setPhysicallyConfirmed(false);
            setMessage("Recovered the exact frozen operation. Retry or resolve only this command; it will not be converted into a new draft.");
          } else if (local.pendingSave) {
            restoreRecovery(local);
            if (!meaningfulVehicleReturn(localCapture)) setCapture(local.pendingSave.capture);
            setStep("setup");
            setMessage(detailMissing
              ? "The exact create/update was not found yet. Retrying its persisted save identity."
              : "Recovered the exact pending save; newer local text will wait for its acknowledgement.");
            lastSavedSignature.current = "";
          } else if (local.draftId) {
            setRecoveryAnchor(local.draftId, detailMissing ? -1 : local.baseRevision ?? -1);
            setStep("setup");
            setMessage("This saved draft could not be found. Keep the local capture as a separate draft before saving.");
            setSyncError("The exact saved draft is unavailable; saving against a guessed or newer revision is blocked.");
          } else {
            setRecoveryAnchor(undefined, 0);
            setStep("setup");
            setMessage("Recovered local entries. Shared draft sync is pending.");
            lastSavedSignature.current = "";
          }
        } else {
          setDraft(null);
          setCapture(emptyCapture(kind));
          setRecoveryAnchor(undefined, 0);
          setStep("setup");
        }
      } finally {
        setRestoreReady(true);
      }
    })();
  }, [data, localKey, kind, base, setSyncError, restoreRecovery, setRecoveryAnchor, persistLocal]);

  const updateCapture = (update: Partial<VehicleReturnCapture>) => {
    setPhysicallyConfirmed(false);
    setCapture(previous => {
      const next = { ...previous, ...update,
        ...(update.scans ? { scans: { ...previous.scans, ...update.scans } } : {}),
        ...(update.quantities ? { quantities: { ...previous.quantities, ...update.quantities } } : {}) };
      captureRef.current = next;
      persistLocal(next);
      return next;
    });
  };

  const selectedLines = useMemo(() => capture.itemIds.map(itemId => {
    const item = itemById.get(itemId);
    const quantityText = capture.quantities[itemId] ?? "";
    const quantity = /^\d+$/.test(quantityText) ? Number(quantityText) : NaN;
    return { itemId, item, quantityText, quantity, serials: uniqueTokens(capture.scans[itemId] ?? "") };
  }), [capture.itemIds, capture.quantities, capture.scans, itemById]);
  const itemIssues = selectedLines.flatMap(line => {
    if (!line.quantityText.trim()) return [`Enter a physical quantity for ${line.item?.name ?? line.itemId}; enter 0 explicitly if none is present.`];
    if (!line.item) return [`A selected item is no longer available.`];
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 0 || line.quantity > 1000000 || (kind === "stock" && line.quantity < 1))
      return [`Enter a whole physical quantity for ${line.item.name}.`];
    if (line.item.tracking === "serialized") {
      if (!/[\r\n,;\t]\s*$/.test(capture.scans[line.itemId] ?? "") && (capture.scans[line.itemId] ?? "").trim())
        return [`Finish the current serial for ${line.item.name} with Enter or Tab.`];
      if (line.serials.length !== line.quantity) return [`Scan exactly ${line.quantity} serial(s) for ${line.item.name}.`];
      if (new Set(line.serials).size !== line.serials.length) return [`Duplicate serials found for ${line.item.name}.`];
      if (kind === "stock") {
        const available = new Set(stockByItem.get(line.itemId)?.serials ?? []);
        if (line.serials.some(serial => !available.has(serial))) return [`One or more ${line.item.name} serials are not on this vehicle.`];
      }
    } else if (line.serials.length) return [`${line.item.name} is a bulk item; remove serial scans.`];
    if (kind === "stock" && line.quantity > (stockByItem.get(line.itemId)?.available ?? 0))
      return [`${line.item.name} exceeds the available vehicle quantity.`];
    return [];
  });
  const repeatedItemSerials = [...new Set(selectedLines.flatMap(line => line.serials).filter(serial =>
    selectedLines.filter(line => line.serials.includes(serial)).length > 1))];
  if (repeatedItemSerials.length) itemIssues.push(`Serials may only be scanned once across the count: ${repeatedItemSerials.join(", ")}.`);
  const equipmentGroups = useMemo(() => {
    const groups = new Map<string, ReturnEquipment[]>();
    for (const row of data?.equipment ?? []) {
      const key = row.equipment || "Equipment";
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()];
  }, [data?.equipment]);
  const equipmentScanIssues = kind === "equipment" ? equipmentGroups.flatMap(([label, rows]) => {
    const selected = rows.filter(row => capture.returnIds.includes(row.id));
    if (!selected.length) return [];
    const value = capture.scans[label] ?? "";
    const values = serialTokens(value);
    const pendingTail = value.trim() && !/[\r\n,;\t]\s*$/.test(value);
    return [
      ...(pendingTail ? [`Finish the current equipment serial in ${label}.`] : []),
      ...(values.length !== selected.length ? [`Scan exactly ${selected.length} selected ${label} serial(s).`] : []),
      ...(new Set(values).size !== values.length ? [`Duplicate serial in ${label}.`] : []),
      ...(selected.some(row => !values.includes(row.serial)) || values.some(value => !selected.some(row => row.serial === value))
        ? [`Scans in ${label} must exactly match selected pending returns.`] : []),
    ];
  }).concat((() => {
    const scanned = equipmentGroups.flatMap(([label, rows]) => serialTokens(capture.scans[label] ?? "")
      .filter(serial => rows.some(row => capture.returnIds.includes(row.id) && row.serial === serial)));
    const duplicates = [...new Set(scanned.filter((serial, index) => scanned.indexOf(serial) !== index))];
    return duplicates.length ? [`A selected equipment serial was scanned more than once: ${duplicates.join(", ")}.`] : [];
  })()) : [];
  const allIssues = kind === "equipment" ? equipmentScanIssues : itemIssues;
  const setupValid = !!capture.sourceId && !!sourceVehicle &&
    (kind !== "count" || !!draft && draft.capture.sourceId === capture.sourceId) &&
    (kind === "count" || !!capture.destinationId && destinations.some(value => value.id === capture.destinationId));
  const selectionValid = kind === "equipment"
    ? capture.returnIds.length > 0 && selectedEquipment.length === capture.returnIds.length
    : capture.itemIds.length > 0 && capture.itemIds.every(id => items.some(item => item.id === id));
  const reasonValid = capture.reason.trim().length >= 10 && capture.reason.trim().length <= 1000;
  const canReview = setupValid && selectionValid && !allIssues.length && reasonValid &&
    !!data && !workflowQuery.isFetching && !workflowQuery.isError && !syncError && !conflictDraft && !syncing &&
    JSON.stringify(capture) === lastSavedSignature.current &&
    (kind !== "equipment" || selectedEquipment.length === capture.returnIds.length);

  const freshContext = async () => {
    const result = await workflowQuery.refetch();
    if (!result.data || result.isError) throw new Error("Current vehicle inventory could not be refreshed. Nothing was prepared.");
    const fresh = result.data;
    if (!fresh.vehicles.some(row => row.id === captureRef.current.sourceId))
      throw new Error("The selected vehicle is no longer available. Your capture is retained.");
    if (kind !== "count" && !fresh.destinations.some(row => row.id === captureRef.current.destinationId))
      throw new Error("The selected return destination is no longer available. Refresh and choose again.");
    if (kind !== "equipment" && captureRef.current.itemIds.some(id => {
      const item = fresh.items.find(value => value.id === id);
      return !item || !physicalItem(item);
    })) throw new Error("A selected item is no longer active or physical. Refresh and review the selection.");
    if (kind === "stock") {
      for (const line of selectedLines) {
        const row = fresh.stock.find(value => value.itemId === line.itemId);
        if (!row || line.quantity > row.available || line.serials.some(serial => !row.serials.includes(serial)))
          throw new Error("Vehicle stock changed. Review the fresh quantities and serials before preparing.");
      }
    }
    if (kind === "equipment" && captureRef.current.returnIds.some(id => !fresh.equipment.some(row => row.id === id)))
      throw new Error("A selected pending return changed. Refresh the pending equipment list and review.");
    return fresh;
  };
  const verifyScans = async (key: string, serials: string[]) => {
    const current = captureRef.current;
    const query = new URLSearchParams({ kind, sourceId: current.sourceId });
    const fresh = await (await apiRequest("GET", `${base}/vehicle-return-workflows?${query}`)).json() as WorkflowData;
    const eligible = new Set(kind === "equipment"
      ? fresh.equipment.filter(row => current.returnIds.includes(row.id) && row.equipment === key).map(row => row.serial)
      : fresh.stock.find(row => row.itemId === key)?.serials ?? []);
    const rejectedSerials = serials.filter(serial => !eligible.has(serial));
    return { status: rejectedSerials.length ? "invalid" as const : "verified" as const,
      message: rejectedSerials.length ? `Unavailable or unexpected serials rejected: ${rejectedSerials.join(", ")}.`
        : "Scanned serials match the current eligible stock or pending returns.", rejectedSerials };
  };
  const prepare = async () => {
    if (!canReview || !physicallyConfirmed || !draft) return;
    setBusy(true); setMessage("");
    try {
      await freshContext();
      const operationId = crypto.randomUUID();
      // Keep the exact preparation identity even if the server's ACK is lost.
      frozenCommandRef.current = { operationId, action: "vehicleReturn",
        data: { draftId: draft.id, draftRevision: draft.revision, physicallyConfirmed: true } };
      setPrepared(true);
      persistLocal(captureRef.current, { anchor: { draftId: draft.id, baseRevision: draft.revision }, pendingSave: null });
      const response = await apiRequest("POST", `${base}/vehicle-return-workflows/drafts/${draft.id}/prepare`, {
        revision: draft.revision, operationId, physicallyConfirmed: true,
      });
      const result = await response.json() as { draft: SavedVehicleReturnDraft };
      setDraft(result.draft);
      frozenCommandRef.current = result.draft.command;
      setPrepared(true);
      setRecoveryAnchor(result.draft.id, result.draft.revision);
      persistLocal(captureRef.current, { anchor: { draftId: result.draft.id, baseRevision: result.draft.revision }, pendingSave: null });
      setMessage("The exact operation is frozen. Preparation did not move inventory.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Preparation failed. Captures are retained.");
    } finally { setBusy(false); }
  };
  const post = async () => {
    const exact = frozenCommandRef.current ?? draft?.command;
    if (!exact) return;
    const draftId = draft?.id ?? exact.data.draftId;
    const revision = draft?.revision ?? exact.data.draftRevision;
    setBusy(true); setMessage("");
    try {
      // Idempotently finish preparation before posting; a lost prepare response must
      // neither mint a replacement operation nor leave a never-prepared request stuck.
      await apiRequest("POST", `${base}/vehicle-return-workflows/drafts/${draftId}/prepare`, {
        revision: exact.data.draftRevision, operationId: exact.operationId, physicallyConfirmed: true,
      });
      const response = await apiRequest("POST", `${base}/commands`, exact);
      const result = await response.json() as {
        state?: { receipts?: Array<{ id: string; vehicleReturn?: VehicleReturnEvidence }> };
      };
      const receipt = result.state?.receipts?.find(value => value.id === exact.operationId);
      if (!receipt?.id) throw new Error("The server response did not include a receipt. Retry only this exact frozen operation.");
      const unlockResponse = await apiRequest("POST", `${base}/vehicle-return-workflows/drafts/${draftId}/unlock`, {
        revision, operationId: exact.operationId,
      });
      const unlocked = await unlockResponse.json() as { draft: SavedVehicleReturnDraft; receiptId?: string };
      setDraft(unlocked.draft);
      const finalReceipt = unlocked.receiptId || receipt.id;
      setReceiptId(finalReceipt);
      setReceiptEvidence(receipt.vehicleReturn
        ? { needsReview: receipt.vehicleReturn.needsReview, countId: receipt.vehicleReturn.countId }
        : null);
      setStep("receipt");
      setMessage("");
      frozenCommandRef.current = undefined;
      setPrepared(false);
      try {
        if (localKey) window.localStorage.removeItem(localKey);
        setRecoveryAnchor(undefined, 0);
      } catch {
        setSyncError("The receipt is confirmed. Local recovery remains available to verify this posted draft.");
      }
      await queryClient.invalidateQueries({ queryKey: [base] });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Outcome could not be confirmed. Keep and retry the exact frozen operation.");
      setPrepared(true);
      persistLocal(captureRef.current);
    } finally { setBusy(false); }
  };
  const unlock = async () => {
    const exact = frozenCommandRef.current ?? draft?.command;
    if (!exact || !window.confirm("Unlocking is allowed only when the server confirms this operation can no longer post. The server will resolve that state atomically. Continue?")) return;
    const draftId = draft?.id ?? exact.data.draftId;
    const revision = draft?.revision ?? exact.data.draftRevision;
    setBusy(true);
    try {
      const response = await apiRequest("POST", `${base}/vehicle-return-workflows/drafts/${draftId}/unlock`, {
        revision, operationId: exact.operationId,
      });
      const result = await response.json() as { draft: SavedVehicleReturnDraft; receiptId?: string };
      setDraft(result.draft);
      if (result.receiptId || result.draft.status === "posted") {
        const resolvedReceipt = result.receiptId ?? result.draft.receiptId ?? "";
        setReceiptId(resolvedReceipt);
        setReceiptEvidence(null);
        setStep("receipt");
        setPrepared(false);
        frozenCommandRef.current = undefined;
        if (localKey) {
          try { window.localStorage.removeItem(localKey); }
          catch { setSyncError("The operation was resolved, but the local retry buffer could not be cleared."); }
        }
        setRecoveryAnchor(undefined, 0);
        return;
      }
      frozenCommandRef.current = undefined;
      setPrepared(false);
      setPhysicallyConfirmed(false);
      setStep("capture");
      lastSavedSignature.current = "";
      setRecoveryAnchor(result.draft.id, result.draft.revision);
      persistLocal(result.draft.capture, { anchor: { draftId: result.draft.id, baseRevision: result.draft.revision }, pendingSave: null });
      setMessage("The server unlocked this draft. Refresh context and physically confirm again before preparing.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The operation is still locked. Its exact command is retained."); }
    finally { setBusy(false); }
  };
  const useLatestDraft = () => {
    if (!conflictDraft) return;
    setDraft(conflictDraft);
    setCapture(conflictDraft.capture);
    setConflictDraft(null);
    setPhysicallyConfirmed(false);
    setSyncError("");
    frozenCommandRef.current = conflictDraft.command;
    setPrepared(conflictDraft.status === "submitting" && !!conflictDraft.command);
    setStep(conflictDraft.status === "posted" ? "receipt" : conflictDraft.status === "submitting" ? "review" : "setup");
    if (conflictDraft.status === "posted") setReceiptId(conflictDraft.receiptId ?? "");
    lastSavedSignature.current = JSON.stringify(conflictDraft.capture);
    setRecoveryAnchor(conflictDraft.id, conflictDraft.revision);
    persistLocal(conflictDraft.capture, { anchor: { draftId: conflictDraft.id, baseRevision: conflictDraft.revision }, pendingSave: null });
    setMessage("Loaded the latest shared draft. Physical context must be refreshed before review.");
  };
  const keepLocalAsSeparateDraft = () => {
    setConflictDraft(null);
    setDraft(null);
    setPhysicallyConfirmed(false);
    setSyncError("");
    frozenCommandRef.current = undefined;
    setPrepared(false);
    lastSavedSignature.current = "";
    setRecoveryAnchor(undefined, 0);
    persistLocal(captureRef.current, { anchor: { baseRevision: 0 }, pendingSave: null });
    setMessage("Your local capture will be saved as a separate shared draft. The other worker’s draft remains unchanged.");
  };
  const deleteDraft = async () => {
    if (!draft || draft.status !== "editing" || !window.confirm("Delete this editing draft? This cannot be undone.")) return;
    setBusy(true);
    try {
      await apiRequest("DELETE", `${base}/vehicle-return-workflows/drafts/${draft.id}`, { revision: draft.revision });
      setDraft(null); setCapture(emptyCapture(kind)); setStep("setup"); setPhysicallyConfirmed(false);
      frozenCommandRef.current = undefined; lastSavedSignature.current = "";
      setRecoveryAnchor(undefined, 0);
      if (localKey) window.localStorage.removeItem(localKey);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Draft could not be deleted. It is retained."); }
    finally { setBusy(false); }
  };

  const toggleItem = (itemId: string, checked: boolean) => {
    updateCapture({ itemIds: checked ? [...capture.itemIds, itemId] : capture.itemIds.filter(id => id !== itemId) });
  };
  const addItem = () => {
    if (!addItemId || capture.itemIds.includes(addItemId)) return;
    updateCapture({ itemIds: [...capture.itemIds, addItemId] });
    setAddItemId("");
  };
  const vehicleStockItemIds = useMemo(() => (data?.stock ?? []).filter(row => row.quantity > 0 || row.serials.length > 0)
    .map(row => row.itemId).filter(itemId => itemById.has(itemId)), [data?.stock, itemById]);
  const baselineFor = (itemId: string) => draft?.baseline.find(row => row.itemId === itemId);
  const steps: Array<{ id: Step; label: string }> = [
    { id: "setup", label: "Vehicle & destination" }, { id: "select", label: kind === "equipment" ? "Pending equipment" : "Choose items" },
    { id: "capture", label: kind === "count" ? "Physical count" : "Quantities & scans" }, { id: "review", label: "Review" },
  ];
  const stepIndex = steps.findIndex(value => value.id === step);
  const pageTitle = kind === "equipment" ? "Return removed equipment" : kind === "count" ? "Verify vehicle inventory" : "Return usable vehicle stock";
  useWizardStepFocus({
    open: canUse, ready: restoreReadyForKey, stepKey: `${kind}:${step}`,
    rootRef: contentRef, bodyRef: pageRef,
    chooseTarget: root => root.querySelector<HTMLElement>('[data-wizard-needs-input="true"]'),
  });

  if (!canUse) return <div className="mx-auto w-full max-w-4xl p-5"><Alert><AlertTitle>Permission required</AlertTitle><AlertDescription>Your inventory permissions no longer allow this workflow.</AlertDescription></Alert><Button className="mt-4" onClick={onClose}>Back to tasks</Button></div>;

  return <section ref={pageRef} className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-y-auto" data-testid={`vehicle-return-${kind}`}>
    <header className="sticky top-0 z-20 border-b bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Button type="button" variant="ghost" className="-ml-3 mb-1 h-8 px-3 text-muted-foreground" onClick={onClose}>
            <ArrowLeft className="mr-2 h-4 w-4" />Back to tasks
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Truck className="h-4 w-4 text-primary" /><h1 className="text-xl font-semibold tracking-tight">{pageTitle}</h1>
            {draft && <Badge variant={draft.status === "editing" ? "secondary" : "outline"}>{draft.status}</Badge>}
            {syncError && <Badge variant="destructive">Sync failed</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Vehicle return workflow · captures stay shared and auditable.</p>
        </div>
        {workflowQuery.isFetching && <Loader2 aria-label="Refreshing vehicle context" className="mt-8 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {step !== "receipt" && <nav aria-label="Workflow steps" className="mt-3 flex flex-wrap gap-2">
        {steps.map((value, index) => <span key={value.id} aria-current={step === value.id ? "step" : undefined}
          className={`rounded-full border px-2.5 py-1 text-xs ${step === value.id ? "border-primary bg-primary text-primary-foreground" : index < stepIndex ? "border-primary/40 bg-primary/5 text-primary" : "text-muted-foreground"}`}>
          {index + 1}. {value.label}
        </span>)}
      </nav>}
    </header>

    <main ref={contentRef} className="min-h-0 flex-1 space-y-5 p-4 pb-28 sm:p-6 sm:pb-28">
      <VehicleReturnWizardSteps kind={kind} step={step} restoreReady={restoreReadyForKey} capture={capture} draft={draft} data={data}
        sourceVehicle={sourceVehicle} destinations={destinations} items={items} selectedEquipment={selectedEquipment}
        equipmentGroups={equipmentGroups} selectedLines={selectedLines} vehicleStockItemIds={vehicleStockItemIds}
        scope={scope} addItemId={addItemId} physicallyConfirmed={physicallyConfirmed} prepared={prepared}
        receiptId={receiptId} receiptEvidence={receiptEvidence} message={message} syncError={syncError}
        conflictDraft={conflictDraft} queryError={workflowQuery.isError}
        canKeepLocalSeparate={!pendingSaveRef.current && !frozenCommandRef.current &&
          draft?.status !== "submitting" && draft?.status !== "posted"}
        canOpenSharedDraft={!pendingSaveRef.current && !syncing}
        onRetryContext={() => void workflowQuery.refetch()} onRetrySync={retrySync} onUseLatestDraft={useLatestDraft}
        onKeepLocalAsSeparateDraft={keepLocalAsSeparateDraft}
        onSourceChange={sourceId => {
          if (pendingSaveRef.current || syncing) {
            setMessage("Finish syncing the exact pending save before changing vehicles.");
            return;
          }
          if (draft?.status === "submitting") return;
          if (meaningfulVehicleReturn(capture) && !window.confirm("Changing vehicles starts a separate draft and clears this wizard’s selected items, quantities, scans, destination, and reason. The existing shared draft remains available. Continue?")) return;
          const next: VehicleReturnCapture = { ...capture, sourceId, destinationId: "", itemIds: [], returnIds: [], quantities: {}, scans: {}, reason: "" };
          captureRef.current = next;
          setCapture(next);
          setDraft(null);
          frozenCommandRef.current = undefined;
          setPrepared(false);
          lastSavedSignature.current = "";
           setSyncError("");
           setRecoveryAnchor(undefined, 0);
          try { if (localKey) window.localStorage.removeItem(localKey); }
          catch { setSyncError("The old local recovery buffer could not be cleared. Do not prepare a physical operation until browser storage is available."); }
           persistLocal(next, { anchor: { baseRevision: 0 }, pendingSave: null });
        }}
        onDestinationChange={destinationId => updateCapture({ destinationId })}
        updateCapture={updateCapture} toggleItem={toggleItem} verifyScans={verifyScans} setScope={setScope}
        setAddItemId={setAddItemId} addItem={addItem} baselineFor={baselineFor}
        onOpenDraft={value => {
          if (meaningfulVehicleReturn(capture) && value.id !== draft?.id &&
            !window.confirm("Open this shared draft and replace the current local capture? Continue only if the current text is saved or no longer needed.")) return;
          setDraft(value); frozenCommandRef.current = value.command; setCapture(value.capture);
          setStep(value.status === "posted" ? "receipt" : value.status === "submitting" ? "review" : "setup");
          setPhysicallyConfirmed(false);
          if (value.status === "posted") setReceiptId(value.receiptId ?? "");
          setPrepared(value.status === "submitting" && !!value.command);
          setSyncError("");
           setRecoveryAnchor(value.id, value.revision);
          lastSavedSignature.current = JSON.stringify(value.capture);
           persistLocal(value.capture, { anchor: { draftId: value.id, baseRevision: value.revision }, pendingSave: null });
        }}
        onPhysicallyConfirm={value => setPhysicallyConfirmed(value)}
        onPrint={() => { if (receiptId) window.open(`${base}/vehicle-return-workflows/receipts/${encodeURIComponent(receiptId)}/print`, "_blank", "noopener,noreferrer"); }}
        onClose={onClose} />
    </main>

    {restoreReadyForKey && step !== "receipt" && <footer className="sticky bottom-0 z-10 mt-auto border-t bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{syncing ? "Saving shared draft…" : draft ? `Shared draft · rev ${draft.revision}` : meaningfulVehicleReturn(capture) ? "Saving shared draft…" : "No draft until you enter meaningful details"}</span>
          {draft?.status === "editing" && <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive" onClick={() => void deleteDraft()} disabled={busy || syncing || !!pendingSaveRef.current}>Delete draft</Button>}
        </div>
        <div className="flex gap-2">
          {step !== "setup" && !prepared && draft?.status !== "submitting" && <Button type="button" variant="outline" onClick={() => {
            setPhysicallyConfirmed(false);
            setStep(step === "review" ? "capture" : step === "capture" ? "select" : "setup");
          }} disabled={busy}><ArrowLeft className="mr-2 h-4 w-4" />Back</Button>}
          {step === "setup" && <Button type="button" onClick={() => { if (setupValid && data && !workflowQuery.isFetching && !workflowQuery.isError) setStep("select"); }} disabled={!setupValid || !data || workflowQuery.isFetching || workflowQuery.isError || busy}>Continue<ArrowRight className="ml-2 h-4 w-4" /></Button>}
          {step === "select" && <Button type="button" onClick={() => { if (setupValid && selectionValid && !workflowQuery.isFetching && !workflowQuery.isError) setStep("capture"); }} disabled={!setupValid || !selectionValid || workflowQuery.isFetching || workflowQuery.isError || busy}>Continue<ArrowRight className="ml-2 h-4 w-4" /></Button>}
          {step === "capture" && <Button type="button" onClick={async () => {
            if (!canReview) return;
            setBusy(true);
            const signature = JSON.stringify(capture);
            try {
              await freshContext();
              if (JSON.stringify(captureRef.current) !== signature) return;
              setMessage(""); setStep("review");
            } catch (error) {
              setMessage(error instanceof Error ? error.message : "Refresh and complete the physical checks before continuing.");
            } finally { setBusy(false); }
          }} disabled={!canReview || busy}>Review operation<ArrowRight className="ml-2 h-4 w-4" /></Button>}
          {step === "review" && (prepared || draft?.status === "submitting" ? <>
            <Button type="button" variant="outline" onClick={() => void unlock()} disabled={busy}>Resolve / unlock</Button>
            <Button type="button" onClick={() => void post()} disabled={busy || !frozenCommandRef.current && !draft?.command}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Retry exact operation</Button>
          </> : <Button type="button" onClick={() => void prepare()} disabled={!canReview || !physicallyConfirmed || !draft || busy || draft.status !== "editing"}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Prepare physical operation</Button>)}
        </div>
      </div>
      {step === "review" && !canReview && !prepared && <p className="mx-auto mt-2 max-w-4xl text-right text-xs text-muted-foreground">{!draft ? "Waiting for shared draft save…" : syncError || conflictDraft ? "Resolve draft sync before preparation." : !reasonValid ? "A reason of at least 10 characters is required." : allIssues[0] ?? "Refresh and complete the required physical checks."}</p>}
    </footer>}
  </section>;
}
