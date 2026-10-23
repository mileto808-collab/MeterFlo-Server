// Background tabs must not occupy every HTTP/1 connection with live streams.
// Release streams before navigation too: waiting for pagehide alone is too late
// when the next document is queued behind those streams.
export function watchPageActivity(
  resume: () => void,
  pause: () => void,
  targetWindow: Window = window,
  targetDocument: Document = document,
) {
  let active = false;
  let leaving = false;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  const sync = () => {
    const next = !leaving && targetDocument.visibilityState !== "hidden";
    if (next === active) return;
    active = next;
    if (active) resume();
    else pause();
  };
  const beforeUnload = () => {
    leaving = true;
    sync();
    clearTimeout(recoveryTimer);
    // If another listener cancels navigation, restore live updates on this page.
    recoveryTimer = setTimeout(() => { leaving = false; sync(); }, 2000);
  };
  const hide = () => {
    leaving = true;
    clearTimeout(recoveryTimer);
    sync();
  };
  const show = () => { leaving = false; sync(); };
  targetDocument.addEventListener("visibilitychange", sync);
  targetWindow.addEventListener("beforeunload", beforeUnload);
  targetWindow.addEventListener("pagehide", hide);
  targetWindow.addEventListener("pageshow", show);
  sync();
  return () => {
    clearTimeout(recoveryTimer);
    targetDocument.removeEventListener("visibilitychange", sync);
    targetWindow.removeEventListener("beforeunload", beforeUnload);
    targetWindow.removeEventListener("pagehide", hide);
    targetWindow.removeEventListener("pageshow", show);
    if (active) pause();
    active = false;
  };
}
