import { parseCoordinates, validateGpsFix, coordinateText, type GpsFix } from "@shared/gps-capture";
import { desktopGpsBridge } from "./gps-native-bridge";

export interface NativeGpsRequest {
  version: 1;
  id: string;
  origin: string;
  startedAt: number;
  timeoutMs: number;
}
export interface NativeGpsResponse {
  version: 1;
  id: string;
  origin: string;
  fix: GpsFix;
}
export interface NativeGpsBridge {
  version: 1;
  origin: string;
  capture(request: NativeGpsRequest): Promise<NativeGpsResponse>;
  cancel?(id: string): void;
}
declare global {
  interface Window { meterfloGps?: NativeGpsBridge }
}

const NATIVE_TIMEOUT = 8000;
const BROWSER_TIMEOUT = 12000;
const MAX_FIX_AGE = 15000;

function usableFix(value: unknown, since: number): GpsFix {
  const fix = validateGpsFix(value, (value as GpsFix)?.coordinates);
  if (!fix || !parseCoordinates(fix.coordinates) || !fix.capturedAt ||
      Date.parse(fix.capturedAt) < since - MAX_FIX_AGE) throw new Error("Receiver did not provide a fresh fix.");
  return fix;
}

export async function nativeGps(signal: AbortSignal, bridge = window.meterfloGps ?? desktopGpsBridge()): Promise<GpsFix | null> {
  if (!bridge || bridge.version !== 1 || bridge.origin !== window.location.origin || signal.aborted) return null;
  const request: NativeGpsRequest = { version: 1, id: crypto.randomUUID(), origin: window.location.origin,
    startedAt: Date.now(), timeoutMs: NATIVE_TIMEOUT };
  return new Promise(resolve => {
    let settled = false;
    const finish = (fix: GpsFix | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      try { bridge.cancel?.(request.id); } catch { /* The fallback must remain usable if a native app disconnected. */ }
      resolve(fix);
    };
    const abort = () => finish(null);
    const timer = setTimeout(() => finish(null), NATIVE_TIMEOUT);
    signal.addEventListener("abort", abort, { once: true });
    try {
      Promise.resolve(bridge.capture(request)).then(response => {
        if (signal.aborted || response?.version !== 1 || response.id !== request.id || response.origin !== request.origin)
          return finish(null);
        try {
          const fix = usableFix(response.fix, request.startedAt);
          finish(fix.source === "native" ? fix : null);
        } catch { finish(null); }
      }, () => finish(null));
    } catch { finish(null); }
  });
}

export async function browserGps(signal: AbortSignal, limit?: number | null,
  geo: Geolocation | undefined = navigator.geolocation): Promise<GpsFix> {
  if (!geo) throw new Error("Browser location is unavailable. Use an approved device helper, saved coordinates or manual entry.");
  if (signal.aborted) throw new DOMException("Capture cancelled", "AbortError");
  return new Promise((resolve, reject) => {
    let best: GpsFix | null = null;
    let watch: number | undefined;
    let settled = false;
    const startedAt = Date.now();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (watch !== undefined) geo.clearWatch(watch);
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new DOMException("Capture cancelled", "AbortError"));
      else if (best) resolve(best);
      else reject(error ?? new Error("No fresh location was obtained. Check location permissions and retry, or use saved/manual coordinates if permitted."));
    };
    const abort = () => finish();
    const timer = setTimeout(() => finish(), BROWSER_TIMEOUT);
    signal.addEventListener("abort", abort, { once: true });
    const success = (position: GeolocationPosition) => {
      if (settled) return;
      try {
        const fix = usableFix({
        coordinates: `${coordinateText(position.coords.latitude)}, ${coordinateText(position.coords.longitude)}`,
          source: "browser", receiver: "unknown",
          accuracy: Number.isFinite(position.coords.accuracy) && position.coords.accuracy >= 0 ? position.coords.accuracy : null,
          capturedAt: new Date(position.timestamp).toISOString(),
        }, startedAt);
        if (!best || (fix.accuracy != null && (best.accuracy == null || fix.accuracy < best.accuracy))) best = fix;
        // Allow a bounded refinement window when accuracy is poor or unknown.
        if (fix.accuracy != null && fix.accuracy <= (limit ?? 20)) finish();
      } catch { /* Ignore invalid/stale provider updates and wait for a usable reading. */ }
    };
    const failure = (error: GeolocationPositionError) => finish(new Error(error.code === 1
      ? "Location permission was denied. Enable browser location access and retry."
      : error.code === 2 ? "Location is unavailable. Check the device location service and retry." : "Location capture timed out. Retry location capture."));
    try {
      watch = geo.watchPosition(success, failure, { enableHighAccuracy: true, maximumAge: 0, timeout: BROWSER_TIMEOUT });
      if (settled) geo.clearWatch(watch);
    } catch (error) { finish(error instanceof Error ? error : new Error("Browser location could not start.")); }
  });
}

export async function acquireGps(signal: AbortSignal, limit?: number | null): Promise<GpsFix> {
  const native = await nativeGps(signal);
  if (signal.aborted) throw new DOMException("Capture cancelled", "AbortError");
  // A poor native fix should not prevent the last fallback improving it.
  if (native && (limit == null || (native.accuracy != null && native.accuracy <= limit))) return native;
  try {
    const browser = await browserGps(signal, limit);
    return native && native.accuracy != null && (browser.accuracy == null || native.accuracy < browser.accuracy)
      ? native : browser;
  } catch (error) {
    if (native && !signal.aborted) return native;
    throw error;
  }
}
