import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { queryClient } from "@/lib/queryClient";
import { isInventoryQueryForProject, type InventoryLiveEvent } from "@shared/inventory-events";

type Status = "connecting" | "live" | "reconnecting" | "unavailable";
type Snapshot = { status: Status; version: number; event?: InventoryLiveEvent };
const channels = new Map<number, ReturnType<typeof createChannel>>();

function createChannel(projectId: number) {
  let snapshot: Snapshot = { status: "connecting", version: 0 };
  const listeners = new Set<() => void>();
  let source: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposeTimer: ReturnType<typeof setTimeout> | null = null;
  let generation = 0, retry = 0;
  const url = `/api/projects/${projectId}/inventory/events`;
  const update = (next: Snapshot) => { snapshot = next; listeners.forEach(callback => callback()); };
  const invalidate = (event: InventoryLiveEvent) => {
    void queryClient.invalidateQueries({ predicate: query => isInventoryQueryForProject(query.queryKey, projectId) });
    update({ status: "live", version: snapshot.version + 1, event });
  };
  const connect = () => {
    const attempt = ++generation;
    source?.close();
    if (timer) clearTimeout(timer);
    timer = null;
    if (!listeners.size) return;
    update({ ...snapshot, status: snapshot.version ? "reconnecting" : "connecting" });
    const stream = new EventSource(url, { withCredentials: true });
    source = stream;
    stream.onopen = () => {
      if (attempt !== generation) return;
      retry = 0;
      update({ ...snapshot, status: "live" });
      // Server sends resync after subscription is ready, avoiding a missed-write
      // window or two competing initial refetches.
    };
    stream.onmessage = message => {
      if (attempt !== generation) return;
      try {
        const data = JSON.parse(message.data);
        if (data.projectId !== projectId) return;
        if (data.type === "access_lost") {
          stream.close();
          ++generation;
          // A denied stream must not leave previously authorized inventory
          // visible as stale data while the API now rejects its refetch.
          void queryClient.resetQueries({ predicate: query => isInventoryQueryForProject(query.queryKey, projectId) });
          update({ ...snapshot, status: "unavailable" });
        } else if (data.type === "inventory_updated" || data.type === "resync") invalidate(data);
      } catch { /* An invalid event must not change a cached inventory snapshot. */ }
    };
    stream.onerror = () => {
      if (attempt !== generation) return;
      stream.close();
      update({ ...snapshot, status: "reconnecting" });
      // EventSource does not expose HTTP status. A small permission-checked probe
      // distinguishes a transient outage from revoked access without a retry storm.
      void fetch(`${url}?probe=1`, { credentials: "include" }).then(response => {
        if (attempt !== generation || !listeners.size) return;
        if ([401, 403, 404].includes(response.status)) {
          update({ ...snapshot, status: "unavailable" });
          void queryClient.resetQueries({ predicate: query => isInventoryQueryForProject(query.queryKey, projectId) });
          return;
        }
        retry = Math.min(retry + 1, 5);
        timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** retry));
      }).catch(() => {
        if (attempt === generation && listeners.size) timer = setTimeout(connect, 3000);
      });
    };
  };
  const wake = () => {
    if (document.visibilityState !== "hidden" && snapshot.status !== "live") connect();
  };
  return {
    getSnapshot: () => snapshot,
    reconnect: connect,
    subscribe(callback: () => void) {
      if (disposeTimer) clearTimeout(disposeTimer);
      disposeTimer = null;
      listeners.add(callback);
      if (listeners.size === 1 && !source) {
        window.addEventListener("online", wake);
        document.addEventListener("visibilitychange", wake);
        connect();
      }
      return () => {
        listeners.delete(callback);
        if (listeners.size) return;
        disposeTimer = setTimeout(() => {
          ++generation;
          source?.close();
          source = null;
          if (timer) clearTimeout(timer);
          window.removeEventListener("online", wake);
          document.removeEventListener("visibilitychange", wake);
          channels.delete(projectId);
        }, 0);
      };
    },
  };
}

const inactiveSnapshot: Snapshot = { status: "unavailable", version: 0 };
const noopSubscribe = () => () => {};
export function useInventoryEvents(
  project: string | number | null,
  options?: { onChange?: (event: InventoryLiveEvent) => void },
) {
  const projectId = Number(project);
  const channel = useMemo(() => {
    if (!Number.isSafeInteger(projectId) || projectId <= 0) return null;
    if (!channels.has(projectId)) channels.set(projectId, createChannel(projectId));
    return channels.get(projectId)!;
  }, [projectId]);
  const snapshot = useSyncExternalStore(channel?.subscribe ?? noopSubscribe, channel?.getSnapshot ?? (() => inactiveSnapshot));
  const callback = useRef(options?.onChange);
  callback.current = options?.onChange;
  useEffect(() => {
    if (snapshot.event) callback.current?.(snapshot.event);
  }, [snapshot.version, snapshot.event]);
  return { status: snapshot.status, version: snapshot.version, reconnect: channel?.reconnect ?? (() => {}) };
}
