import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export interface ChangeoutDraftEnvelope {
  revision: number;
  step: string;
  capture: Record<string, any>;
  submissionId: string;
  updatedAt: string;
  assignmentVersion?: number;
}

type DraftStatus = "loading" | "saved" | "syncing" | "offline" | "conflict" | "none";
const DB_NAME = "meterflo-changeout-drafts";
const STORE = "drafts";
let localWriteCounter = 0;
const completedWorkOrders = new Map<string, number>();
function completionScope(projectId: number, workOrderId: number) {
  return `${projectId}:${workOrderId}`;
}
function completionMarkerKey(projectId: number, workOrderId: number) {
  return `__completed:${completionScope(projectId, workOrderId)}`;
}
function isGenerationBlocked(projectId: number, workOrderId: number, assignmentVersion?: number) {
  const completedVersion = completedWorkOrders.get(completionScope(projectId, workOrderId));
  return completedVersion !== undefined && (!Number.isFinite(assignmentVersion) || assignmentVersion! <= completedVersion);
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function storageKey(userId: string | number, projectId: number, workOrderId: number) {
  return `${userId}:${projectId}:${workOrderId}`;
}
async function localGetAll(prefix: string): Promise<any[]> {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result ?? []).filter((row: any) => row.key.startsWith(`${prefix}:`)).map((row: any) => row.draft));
    request.onerror = () => reject(request.error);
  });
}
export async function getLocalChangeoutDraft(userId: string | number, projectId: number, workOrderId: number, submissionId: string) {
  const db = await openDraftDb();
  const key = `${storageKey(userId, projectId, workOrderId)}:${submissionId}`;
  return new Promise<any | null>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result?.draft ?? null);
    request.onerror = () => reject(request.error);
  });
}
async function localPut(key: string, draft: any) {
  const keyParts = key.split(":");
  const projectId = Number(keyParts[1]);
  const workOrderId = Number(keyParts[2]);
  if (isGenerationBlocked(projectId, workOrderId, draft.assignmentVersion)) return;
  const db = await openDraftDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const current = store.get(key);
    const marker = store.get(completionMarkerKey(Number(key.split(":")[1]), Number(key.split(":")[2])));
    let currentReady = false;
    let markerReady = false;
    let currentRow: any;
    let isBlocked = false;
    const maybePut = () => {
      if (!currentReady || !markerReady || isBlocked) return;
      if (isGenerationBlocked(projectId, workOrderId, draft.assignmentVersion)) return;
      if ((currentRow?.writeStamp ?? -1) > (draft.__clientWriteStamp ?? -1)) return;
      const existingUpdated = Date.parse(currentRow?.draft?.updatedAt ?? "");
      const incomingUpdated = Date.parse(draft.updatedAt ?? "");
      if (Number.isFinite(existingUpdated) && Number.isFinite(incomingUpdated) && existingUpdated > incomingUpdated) return;
      store.put({ key, draft, writeStamp: draft.__clientWriteStamp ?? ++localWriteCounter });
    };
    current.onsuccess = () => {
      currentRow = current.result;
      currentReady = true;
      maybePut();
    };
    marker.onsuccess = () => {
      const markerVersion = marker.result?.assignmentVersion;
      isBlocked = !!marker.result && (!Number.isFinite(markerVersion) || !Number.isFinite(draft.assignmentVersion) ||
        draft.assignmentVersion <= markerVersion);
      markerReady = true;
      maybePut();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function localDelete(key: string) {
  const db = await openDraftDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function readCompletionMarker(projectId: number, workOrderId: number) {
  const db = await openDraftDb();
  return new Promise<{ exists: boolean; assignmentVersion?: number }>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(completionMarkerKey(projectId, workOrderId));
    request.onsuccess = () => resolve({ exists: !!request.result, assignmentVersion: request.result?.assignmentVersion });
    request.onerror = () => reject(request.error);
  });
}
async function setCompletionMarkerVersion(projectId: number, workOrderId: number, assignmentVersion: number) {
  const db = await openDraftDb();
  let markerVersion = assignmentVersion;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const key = completionMarkerKey(projectId, workOrderId);
    const request = store.get(key);
    request.onsuccess = () => {
      if (Number.isFinite(request.result?.assignmentVersion)) markerVersion = request.result.assignmentVersion;
      else store.put({ ...(request.result ?? {}), key, completed: true, assignmentVersion });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const scope = completionScope(projectId, workOrderId);
  const current = completedWorkOrders.get(scope);
  completedWorkOrders.set(scope, Number.isFinite(current) ? Math.max(current!, markerVersion) : markerVersion);
}
export async function clearAllLocalChangeoutDraftsForWorkOrder(projectId: number, workOrderId: number, assignmentVersion?: number) {
  const scopeKey = completionScope(projectId, workOrderId);
  const completedVersion = Number.isFinite(assignmentVersion) ? assignmentVersion! : Number.POSITIVE_INFINITY;
  const knownVersion = completedWorkOrders.get(scopeKey);
  completedWorkOrders.set(scopeKey, Number.isFinite(completedVersion)
    ? (Number.isFinite(knownVersion) ? Math.max(knownVersion!, completedVersion) : completedVersion)
    : Number.POSITIVE_INFINITY);
  const db = await openDraftDb();
  const scope = `:${projectId}:${workOrderId}:`;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const request = store.getAll();
    const markerRequest = store.get(completionMarkerKey(projectId, workOrderId));
    let rowsReady = false;
    let markerReady = false;
    let rows: any[] = [];
    let priorMarker: any;
    const clear = () => {
      if (!rowsReady || !markerReady) return;
      const priorVersion = priorMarker?.assignmentVersion;
      if (Number.isFinite(priorVersion) && Number.isFinite(completedVersion) && priorVersion > completedVersion) {
        const known = completedWorkOrders.get(scopeKey);
        completedWorkOrders.set(scopeKey, Number.isFinite(known) ? Math.max(known!, priorVersion) : priorVersion);
        return;
      }
      rows.forEach((row: any) => {
        if (typeof row.key !== "string" || !row.key.includes(scope)) return;
        const rowVersion = row.draft?.assignmentVersion;
        if (!Number.isFinite(completedVersion) || !Number.isFinite(rowVersion) || rowVersion <= completedVersion)
          store.delete(row.key);
      });
      store.put({ key: completionMarkerKey(projectId, workOrderId), completed: true,
        assignmentVersion: Number.isFinite(completedVersion) ? completedVersion : null });
    };
    request.onsuccess = () => { rows = request.result ?? []; rowsReady = true; clear(); };
    markerRequest.onsuccess = () => { priorMarker = markerRequest.result; markerReady = true; clear(); };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export async function listLocalChangeoutDrafts(userId: string | number, projectId: number) {
  const db = await openDraftDb();
  return new Promise<Array<{ workOrderId: number; submissionId: string; updatedAt: string; revision: number; step: string; assignmentVersion?: number }>>((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).getAll();
    request.onsuccess = () => resolve((request.result ?? []).flatMap((row: any) => {
      const prefix = `${userId}:${projectId}:`;
      if (!row.key.startsWith(prefix)) return [];
      const parts = row.key.slice(prefix.length).split(":");
      return [{ workOrderId: Number(parts[0]), submissionId: parts.slice(1).join(":") || row.draft.submissionId,
        updatedAt: row.draft.updatedAt, revision: row.draft.revision ?? 0, step: row.draft.step,
        assignmentVersion: row.draft.assignmentVersion }];
    }));
    request.onerror = () => reject(request.error);
  });
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
function base64ToFile(value: string, name: string, type: string, lastModified: number) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type, lastModified });
}
export async function encodeDraftCapture(capture: Record<string, any>) {
  const encoded = structuredClone(capture);
  for (const field of ["troublePhotos", "beforePhotos", "afterPhotos"]) {
    encoded.data[field] = await Promise.all((capture.data?.[field] ?? []).map(async (photo: any) => ({
      type: photo.type,
      file: { name: photo.file.name, type: photo.file.type, lastModified: photo.file.lastModified,
        size: photo.file.size, base64: await fileToBase64(photo.file) },
    })));
  }
  return encoded;
}
export function decodeDraftCapture(capture: Record<string, any>) {
  const restored = structuredClone(capture);
  for (const field of ["troublePhotos", "beforePhotos", "afterPhotos"]) {
    restored.data[field] = (restored.data?.[field] ?? []).map((photo: any) => {
      const file = photo.file instanceof File ? photo.file : base64ToFile(photo.file.base64, photo.file.name, photo.file.type, photo.file.lastModified);
      return { type: photo.type, file, preview: URL.createObjectURL(file) };
    });
  }
  return restored;
}

export function useChangeoutDraft(projectId: number, workOrderId: number, assignmentVersion?: number) {
  const { user } = useAuth();
  const userId = user?.id;
  const baseKey = userId == null ? "" : storageKey(userId, projectId, workOrderId);
  const endpoint = `/api/projects/${projectId}/work-orders/${workOrderId}/changeout-draft`;
  const [draft, setDraft] = useState<ChangeoutDraftEnvelope | null>(null);
  const [status, setStatus] = useState<DraftStatus>("loading");
  const [conflict, setConflict] = useState<ChangeoutDraftEnvelope | null>(null);
  const [canResume, setCanResume] = useState(true);
  const [currentAssignmentVersion, setCurrentAssignmentVersion] = useState<number | undefined>(undefined);
  const [freshGenerationAvailable, setFreshGenerationAvailable] = useState(false);
  const [reason, setReason] = useState("");
  const revision = useRef(0);
  const revisionToken = useRef("");
  const latestCapture = useRef<{ step: string; capture: Record<string, any>; submissionId: string; version: number; assignmentVersion?: number } | null>(null);
  const writeVersion = useRef(0);
  const statusCheckVersion = useRef(0);
  const completed = useRef(false);
  const revisionByToken = useRef(new Map<string, number>());
  const localWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const serverWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!baseKey || !userId) return;
    let cancelled = false;
    const loadVersion = writeVersion.current;
    setStatus("loading");
    Promise.all([
      localGetAll(baseKey).then(rows => rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))).catch(() => []),
      fetch(endpoint, { credentials: "include" }).then(async response => response.ok ? await response.json() :
        ({ draft: null, canResume: false, reason: "Server ownership could not be verified; this capture is read-only until checked." })).catch(() => null),
      readCompletionMarker(projectId, workOrderId).catch(() => ({ exists: false, assignmentVersion: undefined })),
    ]).then(async ([local, remoteResponse, marker]) => {
      if (cancelled) return;
      if (remoteResponse?.completed) {
        const completedVersion = Number.isFinite(remoteResponse.assignmentVersion) ? remoteResponse.assignmentVersion : undefined;
        const knownVersion = completedWorkOrders.get(completionScope(projectId, workOrderId));
        if (Number.isFinite(knownVersion) && Number.isFinite(completedVersion) && knownVersion! > completedVersion!) {
          setCurrentAssignmentVersion(knownVersion);
          setCanResume(false);
          setFreshGenerationAvailable(true);
          setReason("A newer assignment generation is already active. Start a fresh capture.");
          setStatus("none");
          return;
        }
        completed.current = true;
        writeVersion.current++;
        await localWriteQueue.current.catch(() => undefined);
        await clearAllLocalChangeoutDraftsForWorkOrder(projectId, workOrderId, completedVersion);
        latestCapture.current = null;
        setDraft(null); setCanResume(false); setReason(remoteResponse.reason || "Work order completed"); setStatus("none");
        return;
      }
      const scopeKey = completionScope(projectId, workOrderId);
      const currentVersion = Number.isFinite(remoteResponse?.assignmentVersion) ? remoteResponse.assignmentVersion as number : undefined;
      let completedVersion = marker.exists ? marker.assignmentVersion : completedWorkOrders.get(scopeKey);
      if (!Number.isFinite(completedVersion) && Number.isFinite(currentVersion)) {
        completedVersion = currentVersion! - 1;
        await setCompletionMarkerVersion(projectId, workOrderId, completedVersion);
      }
      if (Number.isFinite(completedVersion)) {
        const memoryVersion = completedWorkOrders.get(scopeKey);
        completedVersion = Number.isFinite(memoryVersion) ? Math.max(memoryVersion!, completedVersion!) : completedVersion;
        completedWorkOrders.set(scopeKey, completedVersion!);
      } else if (marker.exists) completedWorkOrders.set(scopeKey, Number.POSITIVE_INFINITY);
      if (writeVersion.current !== loadVersion || latestCapture.current) return;
      setCurrentAssignmentVersion(currentVersion);
      const hasCompletionBarrier = marker.exists || completedWorkOrders.has(scopeKey);
      const openedNewGeneration = hasCompletionBarrier && Number.isFinite(currentVersion) &&
        Number.isFinite(completedVersion) && currentVersion! > completedVersion!;
      if (hasCompletionBarrier && !openedNewGeneration) {
        setDraft(null); setCanResume(false); setFreshGenerationAvailable(false);
        setReason(remoteResponse?.reason || "Work order is completed; a newer assignment generation is required.");
        setStatus("none");
        return;
      }
      const remoteCandidate = remoteResponse?.draft;
      const localCandidate = local.find((row: any) => !hasCompletionBarrier || row.assignmentVersion === currentVersion) ?? null;
      const remote = remoteCandidate && (!hasCompletionBarrier || remoteCandidate.assignmentVersion === currentVersion)
        ? remoteCandidate : null;
      if (remoteResponse) {
        setCanResume(openedNewGeneration && !remote ? true : remoteResponse.canResume !== false);
        setReason(openedNewGeneration && !remote ? "A new assignment generation is available. Start a fresh capture." : remoteResponse.reason ?? "");
      }
      const selected = !remote || (localCandidate && new Date(localCandidate.updatedAt).getTime() > new Date(remote.updatedAt).getTime()) ? localCandidate : remote;
      if (selected) {
        setDraft(selected);
        setFreshGenerationAvailable(false);
        revision.current = selected.revision ?? 0;
        revisionToken.current = selected.submissionId;
        revisionByToken.current.set(selected.submissionId, revision.current);
        latestCapture.current = { step: selected.step, capture: selected.capture, submissionId: selected.submissionId,
          version: writeVersion.current, assignmentVersion: selected.assignmentVersion };
        setStatus("saved");
      } else {
        setDraft(null);
        setFreshGenerationAvailable(openedNewGeneration);
        setStatus("none");
      }
    }).catch(() => { if (!cancelled) setStatus("offline"); });
    return () => { cancelled = true; };
  }, [baseKey, endpoint, userId]);

  const persist = useCallback((step: string, capture: Record<string, any>, submissionId: string) => {
    if (!baseKey || completed.current || isGenerationBlocked(projectId, workOrderId, assignmentVersion)) return;
    const version = ++writeVersion.current;
    const snapshot = { step, capture: structuredClone(capture), submissionId };
    if (revisionToken.current !== submissionId) revision.current = revisionByToken.current.get(submissionId) ?? 0;
    revisionToken.current = submissionId;
    const key = `${baseKey}:${submissionId}`;
    latestCapture.current = { ...snapshot, version, assignmentVersion };
    const localDraft = { revision: revision.current, assignmentVersion, ...snapshot, updatedAt: new Date().toISOString(),
      __clientWriteStamp: ++localWriteCounter };
    setDraft(localDraft);
    localWriteQueue.current = localWriteQueue.current.catch(() => undefined).then(() => localPut(key, localDraft)).then(() => {
      if (!completed.current && !isGenerationBlocked(projectId, workOrderId, assignmentVersion) && latestCapture.current?.version === version)
        setStatus(current => current === "conflict" ? current : "saved");
    }).catch(() => { if (!completed.current && !isGenerationBlocked(projectId, workOrderId, assignmentVersion) &&
      latestCapture.current?.version === version) setStatus("offline"); });
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(async () => {
      serverWriteQueue.current = serverWriteQueue.current.catch(() => undefined).then(async () => {
        if (completed.current || isGenerationBlocked(projectId, workOrderId, assignmentVersion)) return;
        if (!Number.isFinite(assignmentVersion)) {
          if (latestCapture.current?.submissionId === submissionId && latestCapture.current.version === version)
            setStatus("offline");
          return;
        }
        if (!isGenerationBlocked(projectId, workOrderId, assignmentVersion) &&
          latestCapture.current?.submissionId === submissionId && latestCapture.current.version === version)
          setStatus("syncing");
        const serialized = await encodeDraftCapture(snapshot.capture);
        if (completed.current || isGenerationBlocked(projectId, workOrderId, assignmentVersion)) return;
        const baseRevision = revisionByToken.current.get(submissionId) ?? 0;
        const response = await fetch(endpoint, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ baseRevision, step, capture: serialized, submissionId, assignmentVersion }) });
        if (response.status === 409) {
          const body = await response.json();
          if (latestCapture.current?.submissionId === submissionId && latestCapture.current.version === version &&
            !completed.current && !isGenerationBlocked(projectId, workOrderId, assignmentVersion)) {
            setConflict(body.draft ?? null);
            setStatus("conflict");
          }
          return;
        }
        if (!response.ok) throw new Error("Draft sync failed");
        const body = await response.json();
        if (isGenerationBlocked(projectId, workOrderId, assignmentVersion)) return;
        const savedRevision = body.draft?.revision ?? baseRevision;
        revisionByToken.current.set(submissionId, savedRevision);
        if (revisionToken.current === submissionId) revision.current = savedRevision;
        if (latestCapture.current?.submissionId === submissionId && latestCapture.current.version === version &&
          !completed.current && !isGenerationBlocked(projectId, workOrderId, assignmentVersion)) {
          const synced = { ...localDraft, revision: savedRevision };
          await localWriteQueue.current.catch(() => undefined);
          if (latestCapture.current?.submissionId !== submissionId || latestCapture.current.version !== version ||
            completed.current || isGenerationBlocked(projectId, workOrderId, assignmentVersion)) return;
          await localPut(key, synced);
          if (latestCapture.current?.submissionId === submissionId && latestCapture.current.version === version &&
            !completed.current && !isGenerationBlocked(projectId, workOrderId, assignmentVersion)) {
            setDraft(synced);
            setCanResume(true);
            setFreshGenerationAvailable(false);
            setReason("");
            setStatus("saved");
          }
        }
      }).catch(() => {
        if (!completed.current && !isGenerationBlocked(projectId, workOrderId, assignmentVersion) &&
          latestCapture.current?.submissionId === submissionId && latestCapture.current.version === version)
          setStatus("offline");
      });
    }, 650);
  }, [assignmentVersion, endpoint, baseKey, projectId, workOrderId]);

  useEffect(() => {
    const bestEffort = () => {
      const snapshot = latestCapture.current;
      if (!snapshot || !baseKey || completed.current || isGenerationBlocked(projectId, workOrderId, snapshot.assignmentVersion)) return;
      const tokenRevision = revisionByToken.current.get(snapshot.submissionId) ?? 0;
      const localDraft = { revision: tokenRevision, assignmentVersion, ...snapshot, updatedAt: new Date().toISOString(),
        __clientWriteStamp: ++localWriteCounter };
      localWriteQueue.current = localWriteQueue.current.catch(() => undefined).then(async () => {
        if (completed.current || isGenerationBlocked(projectId, workOrderId, snapshot.assignmentVersion) ||
          latestCapture.current?.version !== snapshot.version) return;
        await localPut(`${baseKey}:${snapshot.submissionId}`, localDraft);
      }).catch(() => undefined);
    };
    const verifyAndSync = async () => {
      const snapshot = latestCapture.current;
      const checkVersion = ++statusCheckVersion.current;
      const observedVersion = writeVersion.current;
      try {
        const response = await fetch(endpoint, { credentials: "include" });
        if (!response.ok) {
          if (checkVersion !== statusCheckVersion.current || completed.current ||
            isGenerationBlocked(projectId, workOrderId, snapshot?.assignmentVersion ?? assignmentVersion) ||
            (snapshot && (latestCapture.current?.submissionId !== snapshot.submissionId || latestCapture.current.version !== snapshot.version)) ||
            (!snapshot && (latestCapture.current || writeVersion.current !== observedVersion))) return;
          setCanResume(false);
          setReason("Server ownership could not be verified; this capture is read-only until checked.");
          setStatus("offline");
          return;
        }
        const body = await response.json();
        if (body.completed) {
          const completedVersion = Number.isFinite(body.assignmentVersion) ? body.assignmentVersion as number : undefined;
          const observedVersion = Number.isFinite(currentAssignmentVersion) ? currentAssignmentVersion : assignmentVersion;
          if (Number.isFinite(completedVersion) && Number.isFinite(observedVersion) && completedVersion! < observedVersion!) return;
          completed.current = true;
          writeVersion.current++;
          if (syncTimer.current) clearTimeout(syncTimer.current);
          await localWriteQueue.current.catch(() => undefined);
          await clearAllLocalChangeoutDraftsForWorkOrder(projectId, workOrderId, completedVersion);
          latestCapture.current = null;
          setDraft(null); setConflict(null); setCanResume(false); setReason(body.reason || "Work order completed");
          setCurrentAssignmentVersion(completedVersion);
          setStatus("none");
          return;
        }
        const scopeKey = completionScope(projectId, workOrderId);
        let completedVersion = completedWorkOrders.get(scopeKey);
        const currentVersion = Number.isFinite(body.assignmentVersion) ? body.assignmentVersion as number : undefined;
        if (!Number.isFinite(completedVersion) && Number.isFinite(currentVersion)) {
          const marker = await readCompletionMarker(projectId, workOrderId);
          if (marker.exists && !Number.isFinite(marker.assignmentVersion)) {
            completedVersion = currentVersion! - 1;
            await setCompletionMarkerVersion(projectId, workOrderId, completedVersion);
          }
        }
        if (Number.isFinite(currentVersion) && Number.isFinite(completedVersion) && currentVersion! > completedVersion!) {
          if (snapshot && Number.isFinite(snapshot.assignmentVersion) && snapshot.assignmentVersion! <= completedVersion!) {
            completed.current = true;
            setCanResume(false);
            setFreshGenerationAvailable(false);
            setReason("This capture belongs to the completed assignment. Start a fresh capture for the reopened work order.");
            setStatus("saved");
            return;
          }
          if (completed.current && !snapshot) completed.current = false;
          if (!snapshot) {
            setCurrentAssignmentVersion(currentVersion);
            setFreshGenerationAvailable(!body.draft || body.draft.assignmentVersion !== currentVersion);
            setCanResume(!!body.draft && body.draft.assignmentVersion === currentVersion ? body.canResume !== false : true);
            setReason(!body.draft || body.draft.assignmentVersion !== currentVersion
              ? "A new assignment generation is available. Start a fresh capture." : (body.reason ?? ""));
            setStatus(body.draft?.assignmentVersion === currentVersion ? "saved" : "none");
            return;
          }
        }
        if (checkVersion !== statusCheckVersion.current || completed.current ||
          isGenerationBlocked(projectId, workOrderId, snapshot?.assignmentVersion ?? assignmentVersion) ||
          (snapshot && (latestCapture.current?.submissionId !== snapshot.submissionId || latestCapture.current.version !== snapshot.version)) ||
          (!snapshot && (latestCapture.current || writeVersion.current !== observedVersion))) return;
        if (Number.isFinite(body.assignmentVersion)) setCurrentAssignmentVersion(body.assignmentVersion);
        const pinnedAssignment = snapshot
          ? (draft?.submissionId === snapshot.submissionId ? draft.assignmentVersion : assignmentVersion)
          : assignmentVersion;
        if (Number.isFinite(body.assignmentVersion) && Number.isFinite(pinnedAssignment) &&
          body.assignmentVersion !== pinnedAssignment) {
          setCanResume(false);
          setReason("Assignment version changed. This capture is preserved for read-only recovery.");
          setStatus("saved");
          return;
        }
        setCanResume(body.canResume !== false);
        setReason(body.reason ?? "");
        if (body.canResume === false) {
          setStatus("saved");
          return;
        }
        if (snapshot) persist(snapshot.step, snapshot.capture, snapshot.submissionId);
      } catch {
        if (checkVersion === statusCheckVersion.current && !completed.current &&
          !isGenerationBlocked(projectId, workOrderId, snapshot?.assignmentVersion ?? assignmentVersion) &&
          (!snapshot || (latestCapture.current?.submissionId === snapshot.submissionId && latestCapture.current.version === snapshot.version)))
          setStatus("offline");
      }
    };
    const handleVisibility = () => {
      bestEffort();
      if (document.visibilityState === "visible") void verifyAndSync();
    };
    const handleOnline = () => { void verifyAndSync(); };
    const handleWorkOrderEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; projectId?: number | string; workOrderId?: number | string }>).detail;
      if (Number(detail?.projectId) !== projectId || Number(detail?.workOrderId) !== workOrderId) return;
      void verifyAndSync();
    };
    window.addEventListener("pagehide", bestEffort);
    window.addEventListener("online", handleOnline);
    window.addEventListener("meterflo:work-order-event", handleWorkOrderEvent);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", bestEffort);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("meterflo:work-order-event", handleWorkOrderEvent);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [assignmentVersion, baseKey, currentAssignmentVersion, draft, endpoint, persist, projectId, userId, workOrderId]);

  const confirmComplete = useCallback(async () => {
    completed.current = true;
    writeVersion.current++;
    latestCapture.current = null;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    await localWriteQueue.current.catch(() => undefined);
    await clearAllLocalChangeoutDraftsForWorkOrder(projectId, workOrderId, assignmentVersion).catch(() => undefined);
    setDraft(null); setConflict(null); setStatus("none");
  }, [assignmentVersion, projectId, userId, workOrderId]);
  const discard = useCallback(async () => {
    if (!baseKey || !latestCapture.current) return;
    const response = await fetch(endpoint, { method: "DELETE", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseRevision: revision.current, submissionId: latestCapture.current.submissionId }) });
    if (!response.ok) throw new Error("The server draft could not be discarded. Your local backup is retained.");
    await localDelete(`${baseKey}:${latestCapture.current.submissionId}`);
    setDraft(null); setConflict(null); setStatus("none");
  }, [endpoint, baseKey]);
  const resolveConflictUseLocal = useCallback(() => {
    if (!latestCapture.current) return;
    revision.current = conflict?.revision ?? revision.current;
    revisionByToken.current.set(latestCapture.current.submissionId, revision.current);
    setConflict(null);
    persist(latestCapture.current.step, latestCapture.current.capture, latestCapture.current.submissionId);
  }, [conflict, persist]);
  return { draft, status, conflict, canResume, currentAssignmentVersion, freshGenerationAvailable, reason,
    persist, confirmComplete, discard, resolveConflictUseLocal };
}
