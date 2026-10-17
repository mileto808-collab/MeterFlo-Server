import { useCallback, useEffect, useRef, useState } from "react";
import type { InventoryCount } from "@shared/inventory";
import {
  countRecoveryBaseline, countRecoveryKey, countRecoveryPrefix, readCountRecoveries, removeCountRecovery,
  type CountCaptureRow, type CountRecovery,
} from "@/lib/inventory-count-recovery";

export function useCountRecovery({ userId, projectId, count, revision, rows, reason, dirty, enabled }: {
  userId?: string; projectId: string; count: InventoryCount | null; revision: number;
  rows: CountCaptureRow[]; reason: string; dirty: boolean; enabled: boolean;
}) {
  const [writer] = useState(() => crypto.randomUUID());
  const prefix = userId ? countRecoveryPrefix(userId, projectId) : "";
  const [records, setRecords] = useState<CountRecovery[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<CountRecovery | null>(null);
  const pendingRef = useRef<CountRecovery | null>(null);
  const prepared = useRef("");
  const currentRecord = useRef<CountRecovery | null>(null);
  const sourceRecord = useRef<CountRecovery | null>(null);
  const refresh = useCallback(() => {
    if (!prefix) { setRecords([]); return; }
    try { setRecords(readCountRecoveries(window.localStorage, prefix)); }
    catch { setError("Local recovery is unavailable. Save the count draft on the server before leaving."); }
  }, [prefix]);
  useEffect(() => {
    refresh();
    const changed = (event: StorageEvent) => { if (!event.key || event.key.startsWith(prefix)) refresh(); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [refresh, prefix]);
  const clear = useCallback(() => {
    if (!prefix) return;
    try {
      if (currentRecord.current) removeCountRecovery(window.localStorage, prefix, currentRecord.current);
      if (sourceRecord.current) removeCountRecovery(window.localStorage, prefix, sourceRecord.current);
      currentRecord.current = null;
      sourceRecord.current = null;
      pendingRef.current = null;
      setPending(null);
      refresh();
    } catch { setError("Could not clear local recovery. Browser storage is unavailable."); }
  }, [prefix, refresh]);
  // Preparing a count must happen before the capture effect; never replace an unreviewed recovery.
  useEffect(() => {
    const key = count && prefix ? `${prefix}${count.id}` : "";
    if (prepared.current === key) return;
    prepared.current = key;
    currentRecord.current = null;
    sourceRecord.current = null;
    pendingRef.current = null;
    setPending(null);
    if (!key || !count) return;
    try {
      const candidate = readCountRecoveries(window.localStorage, prefix).find(record =>
        record.countId === count.id && record.writer !== writer);
      pendingRef.current = candidate ?? null;
      setPending(candidate ?? null);
    } catch { setError("Local recovery is unavailable. Save the count draft before leaving."); }
  }, [count?.id, prefix, writer]);
  const serialized = JSON.stringify(rows.map(({ itemId, quantity, serials }) => ({ itemId, quantity, serials })));
  useEffect(() => {
    if (!count || !prefix || !enabled || pending || pendingRef.current || count.status !== "open") return;
    if (!dirty) { clear(); return; }
    const record: CountRecovery = {
      version: 1, writer, countId: count.id, baseline: countRecoveryBaseline(count),
      revision, rows: JSON.parse(serialized), reason, updatedAt: Date.now(),
    };
    try {
      window.localStorage.setItem(countRecoveryKey(prefix, record), JSON.stringify(record));
      currentRecord.current = record;
      // Transfer ownership only after the new capture is durable. Avoid a chain
      // of obsolete captures after repeated crash -> restore -> crash cycles.
      if (sourceRecord.current) {
        removeCountRecovery(window.localStorage, prefix, sourceRecord.current);
        sourceRecord.current = null;
      }
      setError("");
      refresh();
    } catch {
      setError("This browser could not store your latest entries for recovery (storage may be full or blocked). Save the server draft now; do not close this page.");
    }
  }, [count?.id, prefix, enabled, revision, serialized, reason, dirty, pending, writer, clear, refresh]);
  const restore = () => {
    if (!pending) return null;
    // Retain the source until its replacement has actually reached storage.
    sourceRecord.current = pending;
    pendingRef.current = null;
    setPending(null);
    return pending;
  };
  const discardRecovery = () => {
    if (!pending) return;
    try {
      removeCountRecovery(window.localStorage, prefix, pending);
      pendingRef.current = null;
      setPending(null);
      refresh();
    } catch { setError("Could not discard the local recovery. Browser storage is unavailable."); }
  };
  const discardRecord = (record: CountRecovery) => {
    try { removeCountRecovery(window.localStorage, prefix, record); refresh(); }
    catch { setError("Could not discard the local recovery. Browser storage is unavailable."); }
  };
  return { records, pending, error, restore, discardRecovery, discardRecord, clear };
}
