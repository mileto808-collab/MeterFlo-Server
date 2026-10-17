import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InventoryItem, InventoryOrder, InventoryState } from "@shared/inventory";
import { orderLabel, orderReference } from "@shared/inventory-order-labels";
import { inventoryReceiptLabel } from "@shared/inventory-display-labels";
import { blankShipmentCapture, type SavedShipmentDraft, type ShipmentCapture } from "@shared/inventory-shipment-draft-model";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InventoryShipmentGuidedDialog } from "@/components/inventory-shipment-guided-dialog";
import { captureFromDraft, findSavedShipmentDraft, refreshShipmentInventory, sendShipmentDraftCommand } from "@/components/inventory-shipment-draft-api";
import type { ShipmentAction } from "@/lib/inventory-shipment-guidance";
import { ShipmentCheckpointWriter } from "@/lib/inventory-shipment-checkpoint-writer";

type Props = {
  base: string; state: InventoryState; order: InventoryOrder; action: ShipmentAction;
  liveState?: InventoryState;
  items: InventoryItem[]; canCloseRemainder: boolean; busy?: boolean; draft?: SavedShipmentDraft; ownerId?: string;
  onClose: () => void; onDirtyChange: (dirty: boolean) => void;
  autoSavePaused?: boolean; onCheckpointBusyChange?: (busy: boolean) => void;
};

const shipmentOrderBasis = (order?: InventoryOrder) => order ? {
  id: order.id, status: order.status, lines: order.lines, dispatched: order.dispatched,
  received: order.received, losses: order.losses ?? [], closure: order.closure ?? null,
} : null;
function shipmentInventoryBasis(state: InventoryState, orderId: string, action: ShipmentAction) {
  const order = state.orders.find(value => value.id === orderId);
  if (!order) return JSON.stringify({ order: null });
  const warehouses = new Set([action === "dispatch" ? order.sourceId : order.destinationId].filter((id): id is string => !!id));
  const itemIds = new Set(order.lines.map(line => line.itemId));
  const stock = state.stock.filter(line => warehouses.has(line.warehouseId) && itemIds.has(line.itemId));
  const allocations = state.allocations.filter(value => value.status === "reserved").map(value => ({
    workOrderId: value.workOrderId, revision: value.revision,
    lines: value.lines.filter(line => warehouses.has(line.warehouseId) && itemIds.has(line.itemId)),
  })).filter(value => value.lines.length);
  const holds = (state.shipmentHolds ?? []).filter(hold => warehouses.has(hold.warehouseId) && itemIds.has(hold.itemId));
  const occupancy = (state.serialOccupancy ?? []).filter(value => itemIds.has(value.itemId));
  const returns = state.returns.filter(value => itemIds.has(value.itemId ?? ""));
  const kitHolds = (state.kitHolds ?? []).filter(hold => warehouses.has(hold.warehouseId) && itemIds.has(hold.itemId));
  const competingTransfers = state.orders.filter(value => value.id !== order.id && value.type === "transfer" &&
    value.lines.some(line => itemIds.has(line.itemId)));
  const items = state.items.filter(item => itemIds.has(item.id)).map(item => ({
    id: item.id, active: item.active, tracking: item.tracking, components: item.components,
  }));
  return JSON.stringify({
    order: shipmentOrderBasis(order), stock, allocations, items, holds, occupancy, returns, kitHolds, competingTransfers,
  });
}

export function InventoryShipmentSession(props: Props) {
  const { base, state: initialState, liveState, order, action, items, draft: incomingDraft, ownerId, onClose, onDirtyChange } = props;
  const [savedDraft, setSavedDraft] = useState<SavedShipmentDraft | undefined>(incomingDraft ??
    initialState.shipmentDrafts?.find(value => value.orderId === order.id && value.stage === action && value.ownerId === ownerId));
  const foreignDraft = ownerId ? initialState.shipmentDrafts?.find(value =>
    value.orderId === order.id && value.stage === action && value.ownerId !== ownerId) : undefined;
  const [recoveryDraft, setRecoveryDraft] = useState<SavedShipmentDraft | null>(() => {
    const draft = incomingDraft ?? initialState.shipmentDrafts?.find(value =>
      value.orderId === order.id && value.stage === action && value.ownerId === ownerId);
    return draft?.pending ? draft : null;
  });
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [checkpointBusy, setCheckpointBusy] = useState(false);
  const activeSaves = useRef(0);
  const [autoSaveBlocked, setAutoSaveBlocked] = useState(false);
  const [statusChecked, setStatusChecked] = useState(false);
  const draftIdRef = useRef<string | null>(incomingDraft?.id ?? null);
  const [freshState, setFreshState] = useState<InventoryState>(initialState);
  const postingRef = useRef(false);
  const localDirtyRef = useRef(false);
  const [externalInventoryChange, setExternalInventoryChange] = useState(false);
  const [externalCaptureChange, setExternalCaptureChange] = useState<"changed" | "unavailable" | null>(null);
  const pending = recoveryDraft?.pending ?? null;
  const capture = useMemo(() => savedDraft ? captureFromDraft(savedDraft) : undefined, [savedDraft]);
  const editorCapture = capture ?? blankShipmentCapture();
  const createWriter = (initial?: SavedShipmentDraft) => new ShipmentCheckpointWriter({
    orderId: order.id, stage: action, ownerId, initial,
    send: async attempt => {
      const result = await sendShipmentDraftCommand(base, "shipmentDraftSave", attempt.data, attempt.operationId);
      const updated = result.state.shipmentDrafts?.find(value => value.id === attempt.data.id);
      if (!updated) throw new Error("Save response did not include the checkpoint.");
      return updated;
    },
    find: id => findSavedShipmentDraft(base, id),
    confirmed: updated => {
      setSavedDraft(updated); draftIdRef.current = updated.id;
      setMessage(`Saved revision ${updated.revision}.`);
    },
  });
  const writerRef = useRef<ShipmentCheckpointWriter | null>(null);
  if (!writerRef.current) writerRef.current = createWriter(savedDraft);
  const writer = writerRef.current;
  const reportDirty = useCallback((dirty: boolean) => {
    localDirtyRef.current = dirty;
    onDirtyChange(dirty);
  }, [onDirtyChange]);
  useEffect(() => {
    props.onCheckpointBusyChange?.(checkpointBusy);
    return () => props.onCheckpointBusyChange?.(false);
  }, [checkpointBusy, props.onCheckpointBusyChange]);
  const latestInventoryBasis = liveState
    ? shipmentInventoryBasis(liveState, order.id, action)
    : shipmentInventoryBasis(initialState, order.id, action);
  const acceptedInventoryBasis = useRef(shipmentInventoryBasis(initialState, order.id, action));
  useEffect(() => {
    if (latestInventoryBasis === acceptedInventoryBasis.current) return;
    if (postingRef.current || recoveryDraft?.pending) {
      acceptedInventoryBasis.current = latestInventoryBasis;
      return;
    }
    if (localDirtyRef.current) {
      setExternalInventoryChange(true);
      return;
    }
    if (liveState) setFreshState(liveState);
    acceptedInventoryBasis.current = latestInventoryBasis;
    setExternalInventoryChange(false);
  }, [latestInventoryBasis, liveState, recoveryDraft?.pending]);

  const findLiveDraft = (snapshot: InventoryState) => snapshot.shipmentDrafts?.find(value =>
    savedDraft ? value.id === savedDraft.id :
      value.orderId === order.id && value.stage === action);
  useEffect(() => {
    if (!liveState || recoveryDraft?.pending) return;
    const liveDraft = findLiveDraft(liveState);
    if (!liveDraft) {
      if (savedDraft && liveState.revision > initialState.revision) setExternalCaptureChange("unavailable");
      return;
    }
    if (savedDraft && liveDraft.revision < savedDraft.revision) return;
    const same = !!savedDraft && liveDraft.id === savedDraft.id &&
      liveDraft.revision === savedDraft.revision &&
      JSON.stringify(liveDraft.capture) === JSON.stringify(savedDraft.capture) &&
      JSON.stringify(liveDraft.pending ?? null) === JSON.stringify(savedDraft.pending ?? null);
    if (same) {
      setExternalCaptureChange(null);
      return;
    }
    if (checkpointBusy || busy || activeSaves.current > 0 || postingRef.current) return;
    setExternalCaptureChange("changed");
  }, [liveState?.shipmentDrafts, liveState?.revision, savedDraft, recoveryDraft?.pending, checkpointBusy, busy]);

  const refreshInventoryBasis = async () => {
    setBusy(true);
    setMessage("");
    try {
      const latest = await refreshShipmentInventory(base);
      setFreshState(latest.state);
      acceptedInventoryBasis.current = shipmentInventoryBasis(latest.state, order.id, action);
      setExternalInventoryChange(false);
      setMessage("Current inventory checked. Your capture and scanner text were kept; review the refreshed availability before posting.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not refresh inventory. Your capture is still here.");
    } finally { setBusy(false); }
  };

  const reloadLatestCapture = async () => {
    setBusy(true);
    setMessage("");
    try {
      const latest = await refreshShipmentInventory(base);
      const candidate = latest.state.shipmentDrafts?.find(value =>
        savedDraft ? value.id === savedDraft.id :
          value.orderId === order.id && value.stage === action);
      setFreshState(latest.state);
      const expectedOwner = ownerId ?? savedDraft?.ownerId;
      if (!candidate || (expectedOwner && candidate.ownerId !== expectedOwner)) {
        acceptedInventoryBasis.current = shipmentInventoryBasis(latest.state, order.id, action);
        setExternalCaptureChange("unavailable");
        setMessage(candidate ? "This checkpoint now belongs to another user. Your local capture remains retained." :
          "The saved checkpoint is no longer available. Your local capture remains retained and will not be posted against a missing draft.");
        return;
      }
      if (localDirtyRef.current && !window.confirm("Replace the exact local shipment entries and scanner buffers with the current saved capture? This cannot be undone.")) return;
      const nextWriter = createWriter(candidate);
      writerRef.current = nextWriter;
      draftIdRef.current = candidate.id;
      nextWriter.accept(candidate);
      setSavedDraft(candidate);
      setRecoveryDraft(candidate.pending ? candidate : null);
      setEditorEpoch(epoch => epoch + 1);
      setExternalCaptureChange(null);
      setExternalInventoryChange(false);
      acceptedInventoryBasis.current = shipmentInventoryBasis(latest.state, order.id, action);
      setAutoSaveBlocked(false);
      localDirtyRef.current = false;
      onDirtyChange(false);
      setMessage(`Loaded saved revision ${candidate.revision}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not refresh the saved capture. Your local entries remain retained.");
    } finally { setBusy(false); }
  };

  const persistCapture = async (current: ShipmentCapture): Promise<SavedShipmentDraft | null> => {
    draftIdRef.current = writer.draftId;
    activeSaves.current++;
    setCheckpointBusy(true);
    try {
      const updated = await writer.save(current);
      setAutoSaveBlocked(false);
      return updated;
    } catch (cause) {
      setAutoSaveBlocked(true);
      setMessage(cause instanceof Error ? cause.message : "Checkpoint not confirmed. Your local capture is retained.");
      return null;
    } finally { if (--activeSaves.current === 0) setCheckpointBusy(false); }
  };

  const saveCapture = async (current: ShipmentCapture) => {
    if (externalCaptureChange) {
      setMessage("The saved checkpoint changed elsewhere. Reload the latest capture before saving over it; your local entries are retained.");
      return false;
    }
    setBusy(true);
    try { return !!(await persistCapture(current)); } finally { setBusy(false); }
  };

  const post = async (payload: Record<string, unknown>, current: ShipmentCapture) => {
    if (externalCaptureChange) {
      setMessage("The saved checkpoint changed elsewhere. Reload the latest capture before posting; your local entries are retained.");
      return false;
    }
    setBusy(true);
    setMessage("");
    let prepared: SavedShipmentDraft | undefined;
    try {
      const persisted = await persistCapture(current);
      if (!persisted) return false;
      const postingId = crypto.randomUUID();
      const prepare = await sendShipmentDraftCommand(base, "shipmentDraftPrepare", {
        id: persisted.id, revision: persisted.revision, postingId, payload,
      });
      prepared = prepare.state.shipmentDrafts?.find(value => value.id === persisted.id);
      if (!prepared?.pending) throw new Error("Posting preparation was not confirmed. Refresh inventory before retrying.");
      const preparedPending = prepared.pending;
      setSavedDraft(prepared);
      writer.accept(prepared);
      postingRef.current = true;
      const result = await sendShipmentDraftCommand(base, action, {
        ...preparedPending.payload, draftId: prepared.id, draftRevision: prepared.revision,
      }, preparedPending.operationId);
      postingRef.current = false;
      const receiptConfirmed = result.operationId === preparedPending.operationId ||
        result.state.receipts.some(receipt => receipt.id === preparedPending.operationId);
      if (!receiptConfirmed) {
        setMessage("Posting is not confirmed. Check status or retry the unchanged prepared posting.");
        setRecoveryDraft(prepared);
        return false;
      }
      return await acknowledge(prepared, preparedPending.operationId);
    } catch (cause) {
      postingRef.current = false;
      const id = prepared?.id ?? draftIdRef.current ?? savedDraft?.id;
      if (id) {
        try {
          const currentDraft = await findSavedShipmentDraft(base, id);
          if (currentDraft?.pending) {
            setSavedDraft(currentDraft);
            setRecoveryDraft(currentDraft);
            setMessage(`${cause instanceof Error ? cause.message : "The posting response was not confirmed."} Check status, then retry unchanged or safely return to editing.`);
            return false;
          }
          if (currentDraft) setSavedDraft(currentDraft);
        } catch { /* reconnect action below retains the local capture */ }
      }
      setMessage(cause instanceof Error ? cause.message : "The operation could not be confirmed. Reconnect and reload inventory.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = async (draft: SavedShipmentDraft, operationId: string): Promise<boolean> => {
    try {
      await sendShipmentDraftCommand(base, "shipmentDraftDelete", {
        id: draft.id, revision: draft.revision, confirmedOperationId: operationId,
      });
      setRecoveryDraft(null);
      setSavedDraft(undefined);
      writer.accept(undefined);
      onDirtyChange(false);
      onClose();
      return true;
    } catch {
      setMessage("Receipt is posted, but acknowledgement could not be saved. Keep this recovery open and confirm the receipt again after reconnecting.");
      setRecoveryDraft(draft);
      return false;
    }
  };

  const checkStatus = async () => {
    if (!recoveryDraft) return;
    setBusy(true);
    setMessage("");
    try {
      const latest = await refreshShipmentInventory(base);
      setStatusChecked(true);
      setFreshState(latest.state);
      const latestDraft = latest.state.shipmentDrafts?.find(value => value.id === recoveryDraft.id);
      if (!latestDraft) { setMessage("This saved draft is no longer available to your account. Refresh inventory or contact its owner."); return; }
      setSavedDraft(latestDraft);
      setRecoveryDraft(latestDraft);
      const matching = latest.state.receipts.find(receipt => receipt.id === latestDraft.pending?.operationId);
      if (matching && latestDraft.pending) setMessage(`Already posted · ${inventoryReceiptLabel(latest.state.receipts, matching.id)}. Confirm the receipt to close this recovery.`);
      else setMessage("No matching receipt is recorded. Retry the unchanged posting or safely return to editing.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not refresh inventory. Reconnect and try again.");
    } finally { setBusy(false); }
  };

  const retryUnchanged = async () => {
    if (!recoveryDraft) return;
    const pending = recoveryDraft.pending;
    if (!pending) return;
    setBusy(true);
    setMessage("");
    const attempting = recoveryDraft;
    try {
      postingRef.current = true;
      const result = await sendShipmentDraftCommand(base, action, {
        ...pending.payload, draftId: attempting.id, draftRevision: attempting.revision,
      }, pending.operationId);
      const confirmed = result.operationId === pending.operationId ||
        result.state.receipts.some(receipt => receipt.id === pending.operationId);
      if (confirmed) {
        const matching = result.state.shipmentDrafts?.find(value => value.id === attempting.id) ?? attempting;
        await acknowledge(matching, pending.operationId);
      } else {
        setStatusChecked(false);
        setMessage("The prepared posting is still unconfirmed. Check status before another retry.");
      }
    } catch {
      postingRef.current = false;
      setStatusChecked(false);
      setMessage("Retry response was lost. Check status before retrying this unchanged posting.");
    } finally { setBusy(false); }
    postingRef.current = false;
  };

  const returnToEditing = async () => {
    if (!recoveryDraft) return;
    setBusy(true);
    setMessage("");
    try {
      const latest = await refreshShipmentInventory(base);
      const current = latest.state.shipmentDrafts?.find(value => value.id === recoveryDraft.id);
      if (!current) throw new Error("Saved draft is not available after refresh.");
      const result = await sendShipmentDraftCommand(base, "shipmentDraftUnlock", { id: current.id, revision: current.revision });
      const unlocked = result.state.shipmentDrafts?.find(value => value.id === current.id);
      if (!unlocked) throw new Error("The unlocked draft could not be confirmed. Refresh inventory.");
      setFreshState(result.state);
      setSavedDraft(unlocked);
      writer.accept(unlocked);
      setAutoSaveBlocked(false);
      setRecoveryDraft(null);
      setStatusChecked(false);
      setEditorEpoch(value => value + 1);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not safely unlock this attempt. Check status and retry.");
    } finally { setBusy(false); }
  };

  const matchingReceipt = statusChecked && pending && freshState.receipts.find(receipt => receipt.id === pending.operationId);
  if (foreignDraft && !savedDraft && !incomingDraft) return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>Shipment draft belongs to another owner</DialogTitle>
        <DialogDescription>A saved capture already exists for this order and stage. Use the Saved shipment drafts panel to take ownership before resuming; this prevents a second draft from replacing the original.</DialogDescription>
      </DialogHeader>
      <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
  const closeRecovery = () => { if (!busy) { onDirtyChange(false); onClose(); } };
  if (recoveryDraft?.pending) return <Dialog open onOpenChange={open => { if (!open) closeRecovery(); }}>
    <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" onEscapeKeyDown={event => { event.preventDefault(); closeRecovery(); }} onPointerDownOutside={event => { event.preventDefault(); closeRecovery(); }}>
      <DialogHeader><DialogTitle>Recover prepared shipment</DialogTitle><DialogDescription>
        {orderLabel(order)} · {orderReference(order)} · {action === "receive" ? "Receiving" : action === "dispatch" ? "Dispatch" : "Arrival"} · posting identity <span className="font-mono">{recoveryDraft.pending.operationId}</span>
      </DialogDescription></DialogHeader>
      <Alert variant={matchingReceipt ? "default" : "destructive"}>
        {matchingReceipt ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        <AlertTitle>{matchingReceipt ? "Shipment already posted" : "Posting outcome needs confirmation"}</AlertTitle>
        <AlertDescription>{matchingReceipt ?
          `${inventoryReceiptLabel(freshState.receipts, matchingReceipt.id)} matches this prepared operation. Confirm to acknowledge it; no new stock request will be sent.` :
          "This saved attempt is immutable. Refresh status before deciding; retry uses the exact stored payload and operation identity."}</AlertDescription>
      </Alert>
      {message && <p role="status" className="text-sm">{message}</p>}
      <DialogFooter className="flex-wrap">
        <Button variant="outline" disabled={busy} onClick={closeRecovery}>Close — keep saved draft</Button>
        {matchingReceipt ? <Button disabled={busy} onClick={() => void acknowledge(recoveryDraft, pending.operationId)}>Confirm receipt and close</Button> : <>
          <Button variant="outline" disabled={busy} onClick={() => void checkStatus()}><RefreshCw className="mr-2 h-4 w-4" />Check status</Button>
          <Button variant="outline" disabled={busy || !statusChecked} onClick={() => void returnToEditing()}>Return to editing safely</Button>
          <Button disabled={busy || !statusChecked} onClick={() => void retryUnchanged()}>Retry unchanged</Button>
        </>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;

  return <InventoryShipmentGuidedDialog
    key={`${order.id}:${action}:${editorEpoch}`}
    state={freshState} order={freshState.orders.find(value => value.id === order.id) ?? order} action={action} items={freshState.items} canCloseRemainder={props.canCloseRemainder}
    busy={props.busy || busy} initialCapture={capture}
    confirmedCapture={capture} checkpointBusy={checkpointBusy} autoSaveBlocked={autoSaveBlocked || !!externalCaptureChange} autoSavePaused={props.autoSavePaused}
    externalInventoryChanged={externalInventoryChange} onRefreshInventory={() => refreshInventoryBasis()}
    externalCaptureChanged={!!externalCaptureChange} onReloadCapture={() => reloadLatestCapture()}
    onAutoSave={current => persistCapture(current).then(Boolean)}
    onSaveDraft={saveCapture} onPost={(payload, current) => post(payload, current ?? blankShipmentCapture())} onClose={onClose} onDirtyChange={reportDirty}
    externalMessage={message}
  />;
}
