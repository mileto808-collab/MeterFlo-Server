import { useEffect, useRef } from "react";

type Transition = () => void;
type NavigationGuard = (transition: Transition) => void;
const indexKey = "__inventoryNavigationIndex";

// Track SPA history from application startup, including entries before inventory
// mounts. A pop cannot be cancelled: restore its source before asking the user.
let guard: { isDirty: () => boolean; request: NavigationGuard } | null = null;
let index = 0;
let restoring = false;
let allowPop = false;
let afterRestore: Transition | null = null;
const push = window.history.pushState.bind(window.history);
const replace = window.history.replaceState.bind(window.history);
replace({ ...window.history.state, [indexKey]: index }, "");

for (const method of ["pushState", "replaceState"] as const) {
  const original = method === "pushState" ? push : replace;
  window.history[method] = (state, unused, url) => {
    const destination = url == null ? window.location.href : new URL(url, window.location.href).href;
    const proceed = () => {
      if (method === "pushState") index++;
      original({ ...state, [indexKey]: index }, unused, url);
    };
    if (restoring) return;
    if (guard?.isDirty() && destination !== window.location.href) guard.request(proceed);
    else proceed();
  };
}

window.addEventListener("popstate", event => {
  const targetIndex = event.state?.[indexKey];
  if (restoring) {
    event.stopImmediatePropagation();
    restoring = false;
    const next = afterRestore;
    afterRestore = null;
    next?.();
    return;
  }
  if (allowPop || !guard?.isDirty()) {
    allowPop = false;
    if (typeof targetIndex === "number") index = targetIndex;
    return;
  }
  // An untracked entry predates this document; it can only be behind us.
  const delta = typeof targetIndex === "number" ? targetIndex - index : -1;
  if (!delta) return;
  event.stopImmediatePropagation();
  restoring = true;
  afterRestore = () => guard?.request(() => {
    allowPop = true;
    window.history.go(delta);
  });
  window.history.go(-delta);
}, true);

export function useUnsavedNavigation(dirty: boolean, requestTransition: NavigationGuard) {
  const current = useRef({ dirty, requestTransition });
  current.current = { dirty, requestTransition };
  useEffect(() => {
    const blocker = { isDirty: () => current.current.dirty, request: (transition: Transition) => current.current.requestTransition(transition) };
    guard = blocker;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!current.current.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      if (guard === blocker) guard = null;
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  // A successful save is confirmed before React commits its clean render.
  // Clear the synchronous guard too, so immediately resumed app navigation
  // cannot be intercepted again using the previous render's dirty state.
  return (transition: Transition) => {
    current.current.dirty = false;
    transition();
  };
}
