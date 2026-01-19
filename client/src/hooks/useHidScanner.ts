import { useEffect, useRef, useCallback } from "react";

interface UseHidScannerOptions {
  enabled?: boolean;
  minLength?: number;
  maxTimeBetweenKeys?: number;
  onScan: (scannedValue: string) => void;
}

/**
 * Hook to detect HID barcode/QR code scanner input.
 * HID scanners work by sending rapid keystrokes followed by Enter.
 * This hook captures those rapid sequences and triggers a callback.
 * 
 * @param options.enabled - Whether the scanner detection is active (default: true)
 * @param options.minLength - Minimum characters to consider a valid scan (default: 3)
 * @param options.maxTimeBetweenKeys - Max ms between keystrokes to be considered scanning (default: 50)
 * @param options.onScan - Callback when a valid scan is detected
 */
export function useHidScanner({
  enabled = true,
  minLength = 3,
  maxTimeBetweenKeys = 50,
  onScan,
}: UseHidScannerOptions) {
  const bufferRef = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetBuffer = useCallback(() => {
    bufferRef.current = "";
    lastKeyTimeRef.current = 0;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      resetBuffer();
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input, textarea, or contenteditable
      const target = event.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || 
                      target.tagName === "TEXTAREA" || 
                      target.isContentEditable;
      
      // Allow scanner input even in inputs if it's very fast typing
      const now = Date.now();
      const timeSinceLastKey = now - lastKeyTimeRef.current;
      
      // If typing in an input and time between keys is slow, it's manual typing - ignore
      if (isInput && timeSinceLastKey > maxTimeBetweenKeys && bufferRef.current.length === 0) {
        return;
      }

      // Clear buffer if too much time has passed (user is typing manually)
      if (timeSinceLastKey > maxTimeBetweenKeys && bufferRef.current.length > 0) {
        resetBuffer();
      }

      lastKeyTimeRef.current = now;

      // Handle Enter key - this indicates end of scan
      if (event.key === "Enter") {
        if (bufferRef.current.length >= minLength) {
          // Prevent the Enter from triggering form submission
          event.preventDefault();
          event.stopPropagation();
          
          const scannedValue = bufferRef.current.trim();
          resetBuffer();
          onScan(scannedValue);
        } else {
          resetBuffer();
        }
        return;
      }

      // Only capture printable characters
      if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
        bufferRef.current += event.key;
        
        // Set a timeout to clear the buffer if no more keys come in
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          resetBuffer();
        }, maxTimeBetweenKeys * 3);
      }
    };

    // Use capture phase to intercept before other handlers
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      resetBuffer();
    };
  }, [enabled, minLength, maxTimeBetweenKeys, onScan, resetBuffer]);

  return { resetBuffer };
}
