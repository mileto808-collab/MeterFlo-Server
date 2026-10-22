import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  SavedVehicleTransferDraft, VehicleTransferDraftCapture,
} from "@shared/inventory-vehicle-transfer-drafts";
export type { SavedVehicleTransferDraft, VehicleTransferDraftCapture } from "@shared/inventory-vehicle-transfer-drafts";

type LocalSave = { revision: number; saveId: string; capture: VehicleTransferDraftCapture };
type LocalBuffer = { draftId: string; capture: VehicleTransferDraftCapture; savedAt: string; serverRevision?: number; serverCapture?: VehicleTransferDraftCapture; pendingSave?: LocalSave; conflicted?: boolean; localOnly?: boolean; tombstone?: boolean };
type DraftCommand = NonNullable<SavedVehicleTransferDraft["command"]>;

const captureHasMeaningfulInput = (capture: VehicleTransferDraftCapture) =>
  !!capture.sourceId || !!capture.destinationId || !!capture.batchId || capture.selectedOrders.length > 0 ||
  !!capture.installerId || Object.values(capture.quantities).some(value => value.trim() !== "") ||
  Object.values(capture.scans).some(value => value.trim() !== "") || !!capture.reason.trim();
const localKey = (base: string, userId: string) =>
  `meterflo:vehicle-transfer-drafts:${encodeURIComponent(userId)}:${base}`;
const newId = () => crypto.randomUUID();
const captureKey = (value: VehicleTransferDraftCapture) => JSON.stringify([
  value.mode, value.sourceId, value.destinationId, value.batchId, value.selectedOrders, value.installerId,
  Object.entries(value.quantities).sort(([a], [b]) => a.localeCompare(b)),
  Object.entries(value.scans).sort(([a], [b]) => a.localeCompare(b)),
  value.reason, value.batchRevision ?? null,
  (value.workOrders ?? []).map(row => [row.workOrderId, row.assignmentVersion]),
]);

export function useVehicleTransferDrafts({
  base, userId, enabled, capture, paused,
}: {
  base: string;
  userId: string;
  enabled: boolean;
  capture: VehicleTransferDraftCapture;
  paused: boolean;
}) {
  const key = userId ? localKey(base, userId) : "";
  const [activeDraftId, setActiveDraftId] = useState("");
  const [localBuffers, setLocalBuffers] = useState<LocalBuffer[]>([]);
  const [loadedLocalKey, setLoadedLocalKey] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error" | "conflict">("idle");
  const [syncError, setSyncError] = useState("");
  const latestCapture = useRef(capture);
  latestCapture.current = capture;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveQueue = useRef<Promise<unknown>>(Promise.resolve());
  const localRef = useRef<LocalBuffer[]>([]);
  localRef.current = localBuffers;
  const recoveryCandidates = useRef(new Set<string>());

  const draftsQuery = useQuery<{ drafts: SavedVehicleTransferDraft[] }>({
    queryKey: [base, "vehicle-transfer-drafts"],
    queryFn: async () => (await apiRequest("GET", `${base}/vehicle-transfer-drafts`)).json(),
    enabled: enabled && !!userId && loadedLocalKey === key,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const refetchRef = useRef(draftsQuery.refetch);
  refetchRef.current = draftsQuery.refetch;
  const drafts = useMemo(() => (draftsQuery.data?.drafts ?? []).filter(draft =>
    draft.status === "editing" || draft.status === "submitting"), [draftsQuery.data]);
  const localCopies = useMemo(() => localBuffers.filter(value => value.localOnly && !value.tombstone), [localBuffers]);
  const localConflicts = useMemo(() => localBuffers.filter(value => value.conflicted && !value.localOnly && !value.tombstone), [localBuffers]);

  useEffect(() => {
    setActiveDraftId("");
    localRef.current = [];
    setLocalBuffers([]);
    recoveryCandidates.current.clear();
    if (!key) {
      setLoadedLocalKey(key);
      return;
    }
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) as unknown : [];
      const buffers = Array.isArray(parsed) ? parsed.filter((entry): entry is LocalBuffer =>
        !!entry && typeof entry.draftId === "string" && !!entry.capture) : [];
      localRef.current = buffers;
      setLocalBuffers(buffers);
      recoveryCandidates.current = new Set(buffers.map(buffer => buffer.draftId));
    } catch {
      setSyncStatus("error");
      setSyncError("Local draft captures could not be read. Existing saved drafts remain available.");
    } finally {
      setLoadedLocalKey(key);
    }
  }, [key]);

  const persistLocal = useCallback((buffer: LocalBuffer) => {
    if (!key) return false;
    const next = [...localRef.current.filter(value => value.draftId !== buffer.draftId), buffer];
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      localRef.current = next;
      setLocalBuffers(next);
      return true;
    } catch {
      setSyncStatus("error");
      setSyncError("The local draft buffer could not be saved. Your entries are still visible; check browser storage.");
      return false;
    }
  }, [key]);

  const writeCapture = useCallback(async (
    draftId: string, value: VehicleTransferDraftCapture, existing?: SavedVehicleTransferDraft,
  ): Promise<SavedVehicleTransferDraft | undefined> => {
    const run = async (): Promise<SavedVehicleTransferDraft | undefined> => {
      if (existing?.status === "submitting") return existing;
      const send = async (payload: LocalSave) => {
        const response = await apiRequest("POST", `${base}/vehicle-transfer-drafts/${encodeURIComponent(draftId)}`, payload);
        return (await response.json() as { draft: SavedVehicleTransferDraft }).draft;
      };
      try {
        setSyncStatus("saving");
        setSyncError("");
        let current = localRef.current.find(entry => entry.draftId === draftId);
        if (current?.conflicted || current?.tombstone) return undefined;
        if (!current) {
          current = { draftId, capture: value, savedAt: new Date().toISOString() };
          if (!persistLocal(current)) return undefined;
        }
        // A lost response is retried with the exact durable saveId and body before newer captures.
        if (current.pendingSave) {
          const replay = await send(current.pendingSave);
          current = { ...(localRef.current.find(entry => entry.draftId === draftId) ?? current),
            serverRevision: replay.revision, serverCapture: replay.capture, pendingSave: undefined };
          persistLocal(current);
          if (captureKey(replay.capture) === captureKey(current.capture)) {
            setSyncStatus("saved");
            setSyncError("");
            void refetchRef.current();
            return replay;
          }
        }
        current = localRef.current.find(entry => entry.draftId === draftId) ?? current;
        if (current.conflicted || current.tombstone) return undefined;
        const revision = current.serverRevision ?? existing?.revision ?? 0;
        const payload: LocalSave = { revision, saveId: newId(), capture: current.capture };
        current = { ...current, savedAt: new Date().toISOString(), pendingSave: payload };
        if (!persistLocal(current)) return undefined;
        const saved = await send(payload);
        const latest = localRef.current.find(entry => entry.draftId === draftId) ?? current;
        persistLocal({ ...latest, serverRevision: saved.revision, serverCapture: saved.capture,
          pendingSave: latest.pendingSave?.saveId === payload.saveId ? undefined : latest.pendingSave });
        setSyncStatus(captureKey(latest.capture) === captureKey(saved.capture) ? "saved" : "saving");
        setSyncError("");
        void refetchRef.current();
        return saved;
      } catch (error) {
        const status = error instanceof Error ? Number(error.message.match(/^(\d{3}):/)?.[1]) : undefined;
        setSyncStatus(status === 409 ? "conflict" : "error");
        if (status === 409) {
          const current = localRef.current.find(entry => entry.draftId === draftId);
          if (current) persistLocal({ ...current, conflicted: true });
        }
        setSyncError(status === 409
          ? "Another warehouse user updated this draft. Your local capture is retained; reopen the latest draft or start a new one."
          : "Draft sync failed. Its exact save identity is retained locally; retry sync before preparing a transfer.");
        return undefined;
      }
    };
    const queued = saveQueue.current.then(run, run);
    saveQueue.current = queued;
    return queued;
  }, [base, persistLocal]);

  useLayoutEffect(() => {
    if (!enabled || paused || !userId || loadedLocalKey !== key) return;
    if (!captureHasMeaningfulInput(capture)) return;
    let draftId = activeDraftId;
    if (!draftId) {
      draftId = newId();
      setActiveDraftId(draftId);
    }
    const previous = localRef.current.find(entry => entry.draftId === draftId);
    if (previous?.tombstone) return;
    if (previous && !previous.pendingSave && !previous.conflicted && !previous.tombstone &&
      captureKey(previous.serverCapture ?? previous.capture) === captureKey(capture)) return;
    const buffer: LocalBuffer = { ...previous, draftId, capture, savedAt: new Date().toISOString() };
    if (!persistLocal(buffer)) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const remote = drafts.find(draft => draft.id === draftId);
      if (remote?.status === "submitting") return;
      const local = localRef.current.find(entry => entry.draftId === draftId) as (LocalBuffer & { serverRevision?: number }) | undefined;
      if (local?.conflicted || local?.tombstone) return;
      const known = local?.serverRevision !== undefined && (!remote || local.serverRevision > remote.revision)
        ? { revision: local.serverRevision } as SavedVehicleTransferDraft : remote;
      void writeCapture(draftId, local?.capture ?? latestCapture.current, known);
    }, 650);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [activeDraftId, capture, drafts, enabled, key, loadedLocalKey, paused, persistLocal, userId, writeCapture]);

  useEffect(() => {
    if (!enabled || paused || !draftsQuery.isSuccess) return;
    for (const local of localBuffers) {
      if (!recoveryCandidates.current.has(local.draftId)) continue;
      if (local.tombstone || local.localOnly || local.conflicted) continue;
      const remote = drafts.find(draft => draft.id === local.draftId);
      if (!remote && local.serverRevision !== undefined) continue;
      if (remote?.status === "submitting") continue;
      if (remote && local.serverRevision !== undefined && local.serverRevision < remote.revision) {
        setSyncStatus("conflict");
        setSyncError("A shared draft changed while this browser was away. Your local capture is retained; resume the shared version or keep this capture as a separate draft.");
        persistLocal({ ...local, conflicted: true });
        continue;
      }
      if (remote && local.serverRevision === undefined && !local.pendingSave) {
        setSyncStatus("conflict");
        setSyncError("This local capture shares an ID with a different server draft. It was preserved; resume or start a separate draft.");
        persistLocal({ ...local, conflicted: true });
        continue;
      }
      const hasNewerLocalCapture = !!remote && local.serverRevision === remote.revision &&
        captureKey(local.serverCapture ?? local.capture) !== captureKey(local.capture);
      recoveryCandidates.current.delete(local.draftId);
      if ((!remote && local.serverRevision === undefined) || !!local.pendingSave ||
        (!!remote && (local.serverRevision ?? -1) > remote.revision) || hasNewerLocalCapture)
        void writeCapture(local.draftId, local.capture, remote);
    }
  }, [drafts, draftsQuery.isSuccess, enabled, paused, localBuffers, persistLocal, writeCapture]);

  const flush = useCallback(async (value = latestCapture.current) => {
    if (!captureHasMeaningfulInput(value)) return undefined;
    const draftId = activeDraftId || newId();
    recoveryCandidates.current.delete(draftId);
    if (!activeDraftId) setActiveDraftId(draftId);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const remote = drafts.find(draft => draft.id === draftId);
    const local = localRef.current.find(entry => entry.draftId === draftId);
    const known = local?.serverRevision !== undefined && (!remote || local.serverRevision > remote.revision)
      ? { revision: local.serverRevision } as SavedVehicleTransferDraft : remote;
    if (known?.status === "submitting") return known;
    return writeCapture(draftId, value, known);
  }, [activeDraftId, drafts, draftsQuery, paused, writeCapture]);

  const resume = useCallback((draft: SavedVehicleTransferDraft) => {
    recoveryCandidates.current.delete(draft.id);
    setActiveDraftId(draft.id);
    const local = localRef.current.find(entry => entry.draftId === draft.id);
    if (local?.conflicted || local?.pendingSave ||
      (!!local && captureKey(local.capture) !== captureKey(draft.capture))) {
      const copyId = newId();
      if (!persistLocal({ draftId: copyId, capture: local.capture, savedAt: local.savedAt, localOnly: true })) {
        setSyncError("Your local capture could not be separated from the shared draft. Keep this browser session open; no shared edits were applied.");
        return local.capture;
      }
      const next = localRef.current.filter(entry => entry.draftId !== draft.id);
      try {
        if (key) window.localStorage.setItem(key, JSON.stringify(next));
        localRef.current = next;
        setLocalBuffers(next);
      } catch {
        setSyncError("The conflicting local capture could not be separated. Keep this browser session open before continuing.");
        return local.capture;
      }
      setSyncStatus("saved");
      setSyncError("Your prior local capture is retained as a separate local copy. Resume it as a new shared draft when needed.");
      if (draft.status === "editing")
        persistLocal({ draftId: draft.id, capture: draft.capture, savedAt: draft.savedAt, serverRevision: draft.revision, serverCapture: draft.capture });
    } else if (draft.status === "editing") {
      persistLocal({ draftId: draft.id, capture: draft.capture, savedAt: draft.savedAt, serverRevision: draft.revision, serverCapture: draft.capture });
    }
    return draft.capture;
  }, [key, persistLocal]);

  const resumeLocalCopy = useCallback((buffer: LocalBuffer) => {
    if (!buffer.localOnly) persistLocal({ ...buffer, localOnly: true, conflicted: false });
    setActiveDraftId(newId());
    setSyncStatus("idle");
    setSyncError("");
    return buffer.capture;
  }, [persistLocal]);

  const startNew = useCallback(() => {
    setActiveDraftId("");
    setSyncStatus("idle");
    setSyncError("");
  }, []);

  const removeLocal = (draftId: string) => {
    const existing = localRef.current.find(entry => entry.draftId === draftId);
    const next = [
      ...localRef.current.filter(entry => entry.draftId !== draftId),
      { ...(existing ?? { draftId, capture: latestCapture.current, savedAt: new Date().toISOString() }),
        tombstone: true, pendingSave: undefined },
    ];
    try {
      if (key) window.localStorage.setItem(key, JSON.stringify(next));
      localRef.current = next;
      setLocalBuffers(next);
    } catch {
      setSyncError("The deleted draft tombstone is saved on the server, but its local buffer could not be cleared.");
    }
  };
  const deleteDraft = useCallback(async (draft: SavedVehicleTransferDraft) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    try {
      await apiRequest("DELETE", `${base}/vehicle-transfer-drafts/${encodeURIComponent(draft.id)}`, { revision: draft.revision });
      removeLocal(draft.id);
      setSyncStatus("saved");
      setSyncError("");
      await draftsQuery.refetch();
    } catch (error) {
      setSyncStatus("error");
      setSyncError(error instanceof Error ? error.message : "Draft could not be deleted.");
    }
  }, [activeDraftId, base, draftsQuery]);

  const prepare = useCallback(async (draft: SavedVehicleTransferDraft, command: DraftCommand) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await saveQueue.current;
    const result = await (await apiRequest("POST", `${base}/vehicle-transfer-drafts/${encodeURIComponent(draft.id)}/prepare`, {
      revision: draft.revision, command,
    })).json() as { draft: SavedVehicleTransferDraft };
    const local = localRef.current.find(entry => entry.draftId === draft.id);
    if (local) persistLocal({ ...local, serverRevision: result.draft.revision, serverCapture: result.draft.capture, pendingSave: undefined });
    void refetchRef.current();
    return result;
  }, [base, persistLocal]);
  const unlock = useCallback(async (draft: SavedVehicleTransferDraft, operationId: string) => {
    const result = await (await apiRequest("POST", `${base}/vehicle-transfer-drafts/${encodeURIComponent(draft.id)}/unlock`, {
      revision: draft.revision, operationId,
    })).json() as { draft: SavedVehicleTransferDraft; receiptId?: string; inactiveOperationId?: string };
    const local = localRef.current.find(entry => entry.draftId === draft.id);
    if (local && result.draft.status === "editing") {
      const divergent = captureKey(local.capture) !== captureKey(result.draft.capture);
      persistLocal({ ...local, serverRevision: result.draft.revision, serverCapture: result.draft.capture,
        pendingSave: undefined, conflicted: divergent });
      if (divergent) {
        setSyncStatus("conflict");
        setSyncError("Another worker changed this handover while resolving its request. Your local inputs are retained; reopen the current shared draft.");
      }
    }
    void draftsQuery.refetch();
    return result;
  }, [base, draftsQuery, persistLocal]);

  return {
    drafts, localCopies, localConflicts, draftsLoading: draftsQuery.isLoading || (enabled && loadedLocalKey !== key), draftsError: draftsQuery.isError,
    refreshDrafts: draftsQuery.refetch, activeDraftId, syncStatus, syncError,
    resume, resumeLocalCopy, startNew, deleteDraft, flush, retrySync: () => flush(latestCapture.current), prepare, unlock,
    setActiveDraftId, clearLocal: removeLocal,
  };
}
