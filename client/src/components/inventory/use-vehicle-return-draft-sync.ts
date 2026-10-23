import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { apiRequest } from "@/lib/queryClient";
import { meaningfulVehicleReturn, type SavedVehicleReturnDraft, type VehicleReturnCapture } from "@shared/inventory-vehicle-returns";
import type { WorkflowData } from "@/components/inventory/vehicle-return-workflow-types";

export type VehicleReturnPendingSave = {
  id: string;
  revision: number;
  saveId: string;
  capture: VehicleReturnCapture;
};

export type VehicleReturnLocalRecovery = {
  capture?: VehicleReturnCapture;
  draftId?: string;
  baseRevision?: number;
  command?: SavedVehicleReturnDraft["command"];
  pendingSave?: VehicleReturnPendingSave;
  savedAt?: string;
};

type RecoveryUpdate = {
  anchor?: { draftId?: string; baseRevision: number };
  pendingSave?: VehicleReturnPendingSave | null;
};

export const readVehicleReturnLocalRecovery = (key: string): VehicleReturnLocalRecovery | null => {
  const raw = window.localStorage.getItem(key);
  return raw ? JSON.parse(raw) as VehicleReturnLocalRecovery : null;
};

type Args = {
  base: string;
  localKey: string;
  capture: VehicleReturnCapture;
  captureRef: MutableRefObject<VehicleReturnCapture>;
  setCapture: Dispatch<SetStateAction<VehicleReturnCapture>>;
  draft: SavedVehicleReturnDraft | null;
  setDraft: Dispatch<SetStateAction<SavedVehicleReturnDraft | null>>;
  setConflictDraft: Dispatch<SetStateAction<SavedVehicleReturnDraft | null>>;
  restoreReady: boolean;
  busy: boolean;
  prepared: boolean;
  conflictDraft: SavedVehicleReturnDraft | null;
  data: WorkflowData | undefined;
  frozenCommandRef: MutableRefObject<SavedVehicleReturnDraft["command"]>;
};

export function useVehicleReturnDraftSync({
  base, localKey, capture, captureRef, setCapture, draft, setDraft, setConflictDraft,
  restoreReady, busy, prepared, conflictDraft, data, frozenCommandRef,
}: Args) {
  const [syncError, setSyncError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [saveSettled, setSaveSettled] = useState(0);
  const [retryNonce, setRetryNonce] = useState(0);
  const lastSavedSignature = useRef("");
  const activeSave = useRef(false);
  const recoveryRef = useRef<{ draftId?: string; baseRevision: number }>({ baseRevision: 0 });
  const pendingSaveRef = useRef<VehicleReturnPendingSave | undefined>(undefined);

  const restoreRecovery = useCallback((local: VehicleReturnLocalRecovery | null) => {
    recoveryRef.current = {
      draftId: local?.draftId,
      // Missing revision on a legacy record is not evidence that it can safely overwrite a server draft.
      baseRevision: local?.baseRevision ?? (local?.draftId ? -1 : 0),
    };
    pendingSaveRef.current = local?.pendingSave;
  }, []);

  const setRecoveryAnchor = useCallback((draftId: string | undefined, baseRevision: number) => {
    recoveryRef.current = { draftId, baseRevision };
    pendingSaveRef.current = undefined;
  }, []);

  const persistLocal = useCallback((value: VehicleReturnCapture, update?: RecoveryUpdate) => {
    if (!localKey) return false;
    if (update?.anchor) recoveryRef.current = update.anchor;
    if (update && Object.prototype.hasOwnProperty.call(update, "pendingSave"))
      pendingSaveRef.current = update.pendingSave ?? undefined;
    try {
      window.localStorage.setItem(localKey, JSON.stringify({
        capture: value,
        draftId: recoveryRef.current.draftId,
        baseRevision: recoveryRef.current.baseRevision,
        command: frozenCommandRef.current,
        pendingSave: pendingSaveRef.current,
        savedAt: new Date().toISOString(),
      }));
      return true;
    } catch {
      setSyncError("Local recovery could not be saved. Keep this page open until shared draft sync completes.");
      return false;
    }
  }, [localKey, frozenCommandRef]);

  useEffect(() => {
    if (!restoreReady || !localKey || busy || prepared || (draft && draft.status !== "editing") ||
      (recoveryRef.current.baseRevision < 0 && !pendingSaveRef.current) || !meaningfulVehicleReturn(capture) ||
      conflictDraft || syncError || !data) return;
    const signature = JSON.stringify(capture);
    if ((!pendingSaveRef.current && signature === lastSavedSignature.current) || activeSave.current) return;
    const timer = window.setTimeout(async () => {
      let intent = pendingSaveRef.current;
      if (!intent) {
        intent = {
          id: recoveryRef.current.draftId ?? crypto.randomUUID(),
          revision: recoveryRef.current.baseRevision,
          saveId: crypto.randomUUID(),
          capture: captureRef.current,
        };
        pendingSaveRef.current = intent;
      }
      // Persist the complete idempotency identity before every attempt. Unknown outcomes reuse it verbatim.
      if (!persistLocal(captureRef.current, {
        anchor: { draftId: intent.id, baseRevision: intent.revision }, pendingSave: intent,
      })) return;

      activeSave.current = true;
      setSyncing(true);
      try {
        const response = await apiRequest("POST", `${base}/vehicle-return-workflows/drafts/${intent.id}`, {
          revision: intent.revision,
          saveId: intent.saveId,
          capture: intent.capture,
        });
        const result = await response.json() as { draft: SavedVehicleReturnDraft };
        setDraft(result.draft);
        lastSavedSignature.current = JSON.stringify(intent.capture);
        pendingSaveRef.current = undefined;
        recoveryRef.current = { draftId: result.draft.id, baseRevision: result.draft.revision };
        // The ACK advances metadata, but persists the newest local text rather than the old request body.
        const savedLocally = persistLocal(captureRef.current, { anchor: recoveryRef.current, pendingSave: null });
        if (savedLocally) setSyncError("");
        setSaveSettled(value => value + 1);
      } catch (error) {
        const isConflict = error instanceof Error && /^409:/.test(error.message);
        setSyncError(isConflict
          ? "Another worker saved a newer revision. Your local entries are retained; review the exact shared draft before continuing."
          : "Shared draft sync failed. Your local entries are retained; retry the exact pending save.");
        if (isConflict) {
          try {
            const response = await apiRequest("GET", `${base}/vehicle-return-workflows/drafts/${intent.id}`);
            const latest = await response.json() as { draft: SavedVehicleReturnDraft };
            if (latest.draft.status === "editing" && latest.draft.saveId === intent.saveId) {
              // The write was applied, but its original acknowledgement was lost.
              pendingSaveRef.current = undefined;
              lastSavedSignature.current = JSON.stringify(intent.capture);
              recoveryRef.current = { draftId: latest.draft.id, baseRevision: latest.draft.revision };
              setDraft(latest.draft);
              const savedLocally = persistLocal(captureRef.current, { anchor: recoveryRef.current, pendingSave: null });
              if (savedLocally) setSyncError("");
              setSaveSettled(value => value + 1);
            } else {
              pendingSaveRef.current = undefined;
              persistLocal(captureRef.current, { pendingSave: null });
              setConflictDraft(latest.draft);
            }
          } catch {
            // Keep the frozen intent so retry can only repeat this exact save, never create a new draft.
          }
        }
      } finally {
        activeSave.current = false;
        setSyncing(false);
      }
    }, 750);
    return () => window.clearTimeout(timer);
  }, [capture, restoreReady, localKey, busy, prepared, draft?.id, draft?.revision, draft?.status,
    conflictDraft, syncError, data, base, persistLocal, captureRef, setDraft, setConflictDraft, saveSettled, retryNonce]);

  const retrySync = () => {
    if (recoveryRef.current.baseRevision < 0 && !pendingSaveRef.current) {
      setSyncError("This local draft cannot be safely matched to a server revision. Keep it as a separate draft before syncing.");
      return;
    }
    setSyncError("");
    setRetryNonce(value => value + 1);
    setCapture(current => ({ ...current }));
  };

  return {
    syncError, setSyncError, syncing, lastSavedSignature, persistLocal, retrySync,
    restoreRecovery, setRecoveryAnchor, pendingSaveRef,
  };
}
