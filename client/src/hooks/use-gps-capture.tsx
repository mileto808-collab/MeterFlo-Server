import { useState, useCallback, useRef } from "react";

export type GpsCaptureStatus = "idle" | "capturing" | "success" | "error";
export type GpsCaptureSource = "external" | "device" | "geocode" | "manual" | "existing" | null;

interface GpsCaptureResult {
  coordinates: string;
  source: GpsCaptureSource;
  accuracy?: number;
}

interface UseGpsCaptureOptions {
  existingGps?: string | null;
  address?: string | null;
  onSuccess?: (result: GpsCaptureResult) => void;
  onError?: (error: string) => void;
}

interface UseGpsCaptureReturn {
  status: GpsCaptureStatus;
  coordinates: string;
  source: GpsCaptureSource;
  error: string | null;
  startCapture: () => Promise<GpsCaptureResult | null>;
  setManualCoordinates: (coords: string) => void;
  reset: () => void;
}

export function useGpsCapture(options: UseGpsCaptureOptions = {}): UseGpsCaptureReturn {
  const { existingGps, address, onSuccess, onError } = options;
  
  const [status, setStatus] = useState<GpsCaptureStatus>("idle");
  const [coordinates, setCoordinates] = useState<string>("");
  const [source, setSource] = useState<GpsCaptureSource>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<boolean>(false);

  const reset = useCallback(() => {
    setStatus("idle");
    setCoordinates("");
    setSource(null);
    setError(null);
    abortRef.current = false;
  }, []);

  const setManualCoordinates = useCallback((coords: string) => {
    setCoordinates(coords);
    setSource("manual");
    setStatus("success");
    setError(null);
    onSuccess?.({ coordinates: coords, source: "manual" });
  }, [onSuccess]);

  // Try device geolocation (browser API)
  const tryDeviceGps = (): Promise<GpsCaptureResult | null> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }

      const timeoutId = setTimeout(() => {
        resolve(null);
      }, 15000);

      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(timeoutId);
          const lat = position.coords.latitude.toFixed(6);
          const lng = position.coords.longitude.toFixed(6);
          resolve({
            coordinates: `${lat}, ${lng}`,
            source: "device",
            accuracy: position.coords.accuracy,
          });
        },
        () => {
          clearTimeout(timeoutId);
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        }
      );
    });
  };

  // Try geocoding from address
  const tryGeocodeAddress = async (): Promise<GpsCaptureResult | null> => {
    if (!address || !address.trim()) {
      return null;
    }

    try {
      const response = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      if (data.lat && data.lng) {
        return {
          coordinates: `${data.lat}, ${data.lng}`,
          source: "geocode",
        };
      }
      return null;
    } catch {
      return null;
    }
  };

  // Main capture function - tries each source in priority order
  const startCapture = useCallback(async (): Promise<GpsCaptureResult | null> => {
    if (abortRef.current) return null;
    
    setStatus("capturing");
    setError(null);

    // Priority 1: Use existing GPS if available
    if (existingGps && existingGps.trim()) {
      const result: GpsCaptureResult = {
        coordinates: existingGps,
        source: "existing",
      };
      setCoordinates(existingGps);
      setSource("existing");
      setStatus("success");
      onSuccess?.(result);
      return result;
    }

    // Priority 2: External GPS device (not currently supported in browser - future enhancement)
    // Would check for Web Serial API or Web USB for NMEA devices

    // Priority 3: Device GPS (browser geolocation)
    const deviceResult = await tryDeviceGps();
    if (abortRef.current) return null;
    
    if (deviceResult) {
      setCoordinates(deviceResult.coordinates);
      setSource("device");
      setStatus("success");
      onSuccess?.(deviceResult);
      return deviceResult;
    }

    // Priority 4: Geocode from address
    const geocodeResult = await tryGeocodeAddress();
    if (abortRef.current) return null;
    
    if (geocodeResult) {
      setCoordinates(geocodeResult.coordinates);
      setSource("geocode");
      setStatus("success");
      onSuccess?.(geocodeResult);
      return geocodeResult;
    }

    // All automatic methods failed
    setStatus("error");
    const errorMsg = "Unable to capture GPS automatically. Please enter coordinates manually.";
    setError(errorMsg);
    onError?.(errorMsg);
    return null;
  }, [existingGps, address, onSuccess, onError]);

  return {
    status,
    coordinates,
    source,
    error,
    startCapture,
    setManualCoordinates,
    reset,
  };
}
