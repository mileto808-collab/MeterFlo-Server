import { useState, useCallback, useRef, useEffect } from "react";
import { acquireGps } from "@/lib/gps-acquisition";
import { parseCoordinates, type GpsFix, type GpsCaptureStatus } from "@shared/gps-capture";
export type { GpsCaptureStatus } from "@shared/gps-capture";
export type GpsCaptureSource = GpsFix["source"] | null;

interface UseGpsCaptureOptions {
  existingGps?: string | null;
  oldGps?: string | null;
  address?: string | null;
  accuracyLimit?: number | null;
  captureKey?: string;
  onSuccess?: (result: GpsFix) => void;
  onError?: (error: string) => void;
}

export function useGpsCapture(options: UseGpsCaptureOptions = {}) {
  const [status, setStatus] = useState<GpsCaptureStatus>("idle");
  const [fix, setFix] = useState<GpsFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const context = useRef(options.captureKey);
  if (context.current !== options.captureKey) {
    active.current?.abort();
    active.current = null;
    context.current = options.captureKey;
  }
  const result = useRef<GpsFix | null>(null);
  const callbacks = useRef(options);
  callbacks.current = options;
  const cancel = useCallback(() => { active.current?.abort(); active.current = null; }, []);
  useEffect(() => cancel, [cancel]);
  const accept = useCallback((value: GpsFix) => {
    cancel();
    result.current = value;
    setFix(value);
    setStatus("success");
    setError(null);
    callbacks.current.onSuccess?.(value);
  }, [cancel]);
  const reset = useCallback(() => {
    cancel(); result.current = null; setFix(null); setStatus("idle"); setError(null);
  }, [cancel]);
  const stop = useCallback(() => {
    cancel();
    setStatus(result.current ? "success" : "idle");
  }, [cancel]);
  const startCapture = useCallback(async (): Promise<GpsFix | null> => {
    cancel();
    const controller = new AbortController();
    active.current = controller;
    setStatus("capturing"); setError(null);
    try {
      const captured = await acquireGps(controller.signal, callbacks.current.accuracyLimit);
      if (active.current !== controller || controller.signal.aborted) return null;
      accept(captured);
      return captured;
    } catch (failure) {
      if (active.current !== controller || controller.signal.aborted) return null;
      active.current = null;
      const message = failure instanceof Error ? failure.message : "Location capture failed. Retry location capture.";
      setStatus("error"); setError(message); callbacks.current.onError?.(message);
      return null;
    }
  }, [accept, cancel]);
  const setManualCoordinates = useCallback((coordinates: string, source: "manual" | "existing" = "manual") => {
    cancel(); result.current = null; setFix(null); setError(null); setStatus("idle");
    if (parseCoordinates(coordinates)) accept({ coordinates, source, accuracy: null, capturedAt: null, receiver: "unknown" });
  }, [accept, cancel]);
  return { status, fix, error, source: fix?.source ?? null, coordinates: fix?.coordinates ?? "",
    startCapture, setManualCoordinates, reset, cancel, stop, getFix: () => result.current };
}
