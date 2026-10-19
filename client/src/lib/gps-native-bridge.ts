import type { NativeGpsBridge, NativeGpsRequest, NativeGpsResponse } from "./gps-acquisition";

const KEY = "meterflo.gps-helper";
export interface GpsPairing { url: string; token: string }
export function validatePairing(value: GpsPairing): GpsPairing {
  const url = new URL(value.url);
  if (url.protocol !== "https:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error("Use the helper's trusted HTTPS loopback address, such as https://localhost:47764/.");
  if (!/^[a-f0-9]{64}$/.test(value.token)) throw new Error("Enter the helper pairing key from its local pairing file.");
  return { url: url.origin, token: value.token };
}
export function readGpsPairing(): GpsPairing | null {
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return null;
    return validatePairing(JSON.parse(stored));
  } catch { return null; }
}
export function saveGpsPairing(value: GpsPairing | null) {
  if (value) localStorage.setItem(KEY, JSON.stringify(validatePairing(value)));
  else localStorage.removeItem(KEY);
}
export async function checkGpsPairing(value: GpsPairing) {
  const pairing = validatePairing(value);
  const response = await fetch(`${pairing.url}/status`, { headers: { Authorization: `Bearer ${pairing.token}` },
    signal: AbortSignal.timeout(4000), credentials: "omit", cache: "no-store" });
  if (!response.ok || (await response.json()).version !== 1) throw new Error("Helper connection was rejected.");
}
export function desktopGpsBridge(): NativeGpsBridge | undefined {
  const pairing = readGpsPairing();
  if (!pairing) return undefined;
  const requests = new Map<string, AbortController>();
  return {
    version: 1, origin: window.location.origin,
    async capture(request: NativeGpsRequest): Promise<NativeGpsResponse> {
      const controller = new AbortController();
      requests.set(request.id, controller);
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const response = await fetch(`${pairing.url}/capture`, {
          method: "POST", credentials: "omit", cache: "no-store", signal: controller.signal,
          headers: { Authorization: `Bearer ${pairing.token}`, "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });
        if (!response.ok) throw new Error("Native receiver could not provide a fix.");
        return await response.json();
      } finally { clearTimeout(timer); requests.delete(request.id); }
    },
    cancel(id: string) { requests.get(id)?.abort(); requests.delete(id); },
  };
}
