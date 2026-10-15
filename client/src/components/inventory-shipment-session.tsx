import { useMemo, useRef, useState } from "react";
import type { InventoryItem, InventoryOrder, InventoryState } from "@shared/inventory";
import { canonicalInventoryJson } from "@shared/inventory-engine";
import { blankShipmentCapture, type SavedShipmentDraft, type ShipmentCapture } from "@shared/inventory-shipment-draft-model";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InventoryShipmentGuidedDialog } from "@/components/inventory-shipment-guided-dialog";
import { captureFromDraft, findSavedShipmentDraft, refreshShipmentInventory, sendShipmentDraftCommand } from "@/components/inventory-shipment-draft-api";
import type { ShipmentAction } from "@/lib/inventory-shipment-guidance";

type Props = {
  base: string; state: InventoryState; order: InventoryOrder; action: ShipmentAction;
  items: InventoryItem[]; canCloseRemainder: boolean; busy?: boolean; draft?: SavedShipmentDraft; ownerId?: string;
  onClose: () => void; onDirtyChange: (dirty: boolean) => void;
};

const captureFingerprint = canonicalInventoryJson;

export function InventoryShipmentSession(props: Props) {
  const { base, state: initialState, order, action, items, draft: incomingDraft, ownerId, onClose, onDirtyChange } = props;
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
  const [statusChecked, setStatusChecked] = useState(false);
  const draftIdRef = useRef<string | null>(incomingDraft?.id ?? null);
  const [freshState, setFreshState] = useState<InventoryState>(initialState);
  const pending = recoveryDraft?.pending ?? null;
  const capture = useMemo(() => savedDraft ? captureFromDraft(savedDraft) : undefined, [savedDraft]);

  const persistCapture = async (current: ShipmentCapture): Promise<SavedShipmentDraft | null> => {
    const id = savedDraft?.id ?? draftIdRef.current ?? crypto.randomUUID();
    draftIdRef.current = id;
    try {
      const result = await sendShipmentDraftCommand(base, "shipmentDraftSave", {
        id, revision: savedDraft?.revision ?? 0, orderId: order.id, stage: action, capture: current,
      });
      const updated = result.state.shipmentDrafts?.find(value => value.id === id);
      if (!updated) throw new Error("Draft save response did not include the saved draft.");
      setSavedDraft(updated);
      draftIdRef.current = updated.id;
      setMessage(`Saved revision ${updated.revision}.`);
      return updated;
    } catch (cause) {
      setMessage(cause instanceof Error ? `${cause.message} Your capture remains open; refresh inventory and resume the saved draft if needed.` :
        "Draft save could not be confirmed. Your capture remains open.");
      try {
        const found = await findSavedShipmentDraft(base, id);
        if (found) {
          if (found.ownerId !== ownerId) {
            setMessage("Draft ownership changed in another session. Your local capture remains open; cancel local edits and refresh inventory.");
            return null;
          }
          if (found.pending) {
            setSavedDraft(found); setRecoveryDraft(found);
            return null;
          }
          if (captureFingerprint(captureFromDraft(found)) === captureFingerprint(current)) {
            setSavedDraft(found); draftIdRef.current = found.id;
            setMessage(`Saved revision ${found.revision}; confirmed after reconnecting.`);
            return found;
          }
          // A concurrent writer's capture must not replace this editor's local
          // values. The operator can cancel local edits then Resume explicitly.
          setMessage("The saved draft changed in another session. Your local capture is retained. Cancel, choose Discard for local edits, then Resume to load the server version; the saved draft is not removed.");
        }
      } catch { /* keep the local capture and the actionable reconnect message */ }
      return null;
    }
  };

  const saveCapture = async (current: ShipmentCapture) => {
    setBusy(true);
    try { return !!(await persistCapture(current)); } finally { setBusy(false); }
  };

  const post = async (payload: Record<string, unknown>, current: ShipmentCapture) => {
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
      const result = await sendShipmentDraftCommand(base, action, {
        ...preparedPending.payload, draftId: prepared.id, draftRevision: prepared.revision,
      }, preparedPending.operationId);
      const receiptConfirmed = result.operationId === preparedPending.operationId ||
        result.state.receipts.some(receipt => receipt.id === preparedPending.operationId);
      if (!receiptConfirmed) {
        setMessage("Posting is not confirmed. Check status or retry the unchanged prepared posting.");
        setRecoveryDraft(prepared);
        return false;
      }
      return await acknowledge(prepared, preparedPending.operationId);
    } catch (cause) {
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
      if (matching && latestDraft.pending) setMessage(`Already posted · receipt ${matching.reference || matching.id}. Confirm the receipt to close this recovery.`);
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
      setStatusChecked(false);
      setMessage("Retry response was lost. Check status before retrying this unchanged posting.");
    } finally { setBusy(false); }
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
        {order.id} · {action === "receive" ? "Receiving" : action === "dispatch" ? "Dispatch" : "Arrival"} · posting identity <span className="font-mono">{recoveryDraft.pending.operationId}</span>
      </DialogDescription></DialogHeader>
      <Alert variant={matchingReceipt ? "default" : "destructive"}>
        {matchingReceipt ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        <AlertTitle>{matchingReceipt ? "Shipment already posted" : "Posting outcome needs confirmation"}</AlertTitle>
        <AlertDescription>{matchingReceipt ?
          `Receipt ${matchingReceipt.reference || matchingReceipt.id} matches this prepared operation. Confirm to acknowledge it; no new stock request will be sent.` :
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
    onSaveDraft={saveCapture} onPost={(payload, current) => post(payload, current ?? blankShipmentCapture())} onClose={onClose} onDirtyChange={onDirtyChange}
    savedFingerprint={capture ? captureFingerprint(capture) : undefined}
    externalMessage={message}
  />;
}
