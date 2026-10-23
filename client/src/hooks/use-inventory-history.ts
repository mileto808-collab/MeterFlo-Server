import { useLayoutEffect, useRef } from "react";
import { useLocation } from "wouter";

const key = "__meterfloInventoryViews";
type Views = { path: string; values: Record<string, unknown> };
const viewsAt = (state: any, path: string): Views =>
  state?.[key]?.path === path ? state[key] : { path, values: {} };

/** Same-URL view entries participate in the existing unsaved-navigation guard.
 * Only navigation metadata belongs here, never captured business inputs.
 */
export function useInventoryHistory<T>(scope: string, value: T, restore: (value: T) => void,
  { enabled = true, canRestore = true }: { enabled?: boolean; canRestore?: boolean } = {}) {
  const [path] = useLocation();
  const latest = useRef({ value, restore, canRestore });
  latest.current = { value, restore, canRestore };
  const previous = useRef<{ identity: string; signature: string } | null>(null);
  const applying = useRef(false);
  const signature = JSON.stringify(value);
  const identity = `${path}:${scope}`;

  useLayoutEffect(() => {
    if (!enabled) { previous.current = null; return; }
    const views = viewsAt(window.history.state, path);
    const saved = views.values[scope] as T | undefined;
    if (previous.current?.identity !== identity) {
      previous.current = { identity, signature };
      if (saved !== undefined && JSON.stringify(saved) !== signature) {
        previous.current.signature = JSON.stringify(saved);
        applying.current = true;
        latest.current.restore(saved);
        return;
      }
      window.history.replaceState({ ...window.history.state,
        [key]: { path, values: { ...views.values, [scope]: value } } }, "");
      return;
    }
    if (applying.current) {
      applying.current = false;
      previous.current.signature = signature;
      return;
    }
    if (previous.current.signature === signature) return;
    previous.current.signature = signature;
    window.history.pushState({ ...window.history.state,
      [key]: { path, values: { ...views.values, [scope]: value } } }, "");
  }, [enabled, identity, path, scope, signature]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const onPop = (event: PopStateEvent) => {
      if (window.location.pathname !== path.split("?")[0]) return;
      const saved = viewsAt(event.state, path).values[scope] as T | undefined;
      if (saved === undefined || JSON.stringify(saved) === JSON.stringify(latest.current.value)) return;
      if (!latest.current.canRestore) {
        event.stopImmediatePropagation();
        window.history.go(1);
        return;
      }
      previous.current = { identity, signature: JSON.stringify(saved) };
      applying.current = true;
      latest.current.restore(saved);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enabled, identity, path, scope]);
}
