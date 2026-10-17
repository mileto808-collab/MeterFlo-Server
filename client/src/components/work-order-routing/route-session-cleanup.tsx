import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";

const ROUTE_KEY_PREFIX = "meterflo:active-route:";

function clearRouteEntries(storage: Storage, keepPrefix = "") {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (key?.startsWith(ROUTE_KEY_PREFIX) && (!keepPrefix || !key.startsWith(keepPrefix))) {
      storage.removeItem(key);
    }
  }
}

/**
 * Lives with the authenticated app shell, not the route screen, so logout and
 * account changes clear route recovery even when the planner is unmounted.
 */
export function RouteSessionCleanup() {
  const { user, isLoading } = useAuth();
  useEffect(() => {
    if (isLoading) return;
    // Drop localStorage records written by older builds; current recovery is tab-scoped.
    try { clearRouteEntries(window.localStorage); } catch { /* Unavailable storage is unreadable. */ }
    if (!user) {
      try { clearRouteEntries(window.sessionStorage); } catch { /* Unavailable storage is unreadable. */ }
      return;
    }
    try { clearRouteEntries(window.sessionStorage, `${ROUTE_KEY_PREFIX}${user.id}:`); } catch { /* Current-view routing still works. */ }
  }, [isLoading, user?.id]);
  return null;
}
