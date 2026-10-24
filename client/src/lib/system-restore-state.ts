import { useSyncExternalStore } from "react";

export type RestoreState = {
  phase: "uploading" | "processing" | "complete" | "incomplete" | "unconfirmed";
  message: string;
  percent?: number;
  warnings?: string[];
};
const marker = "meterflo:system-restore";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export function createRestoreStore(storage?: Storage) {
  let state: RestoreState | null = null;
  try {
    if (storage?.getItem(marker)) state = {
      phase: "unconfirmed",
      message: "This page lost its connection to a restore. The server may still be restoring. Check the server logs before starting another restore.",
    };
  } catch { /* Browser storage is optional; the in-memory screen still works. */ }
  const listeners = new Set<() => void>();
  const publish = (next: RestoreState) => {
    state = next;
    try { storage?.setItem(marker, "1"); } catch { /* Do not interrupt a restore. */ }
    listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    begin: () => {
      if (state) return false;
      publish({ phase: "uploading", message: "Preparing backup upload…", percent: 0 });
      return true;
    },
    progress: (progress: { stage: "uploading" | "processing"; message: string; percent: number }) => {
      if (state?.phase === "uploading" || state?.phase === "processing")
        publish({ phase: progress.stage, message: progress.message, percent: progress.percent });
    },
    finish: (phase: "complete" | "incomplete" | "unconfirmed", message: string, warnings?: string[]) => {
      if (state) publish({
        phase,
        message,
        ...(warnings?.length ? { warnings: [...warnings] } : {}),
      });
    },
    clearMarkerForNavigation: () => {
      // Keep the screen mounted until hard navigation actually replaces it.
      try { storage?.removeItem(marker); } catch { /* No persisted marker to clear. */ }
    },
  };
}

function browserStorage() {
  try { return typeof window === "undefined" ? undefined : window.sessionStorage; }
  catch { return undefined; }
}
export const systemRestoreStore = createRestoreStore(browserStorage());
export const useSystemRestore = () => useSyncExternalStore(
  systemRestoreStore.subscribe, systemRestoreStore.getSnapshot, () => null,
);
