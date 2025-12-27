import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Scan, QrCode, Keyboard, Camera, X, Flashlight, FlashlightOff, Focus, Check, RotateCcw, Loader2, Wrench, AlertCircle, MapPin, FileText, Gauge } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { ProjectWorkOrder } from "../../../server/projectDb";

interface StartMeterChangeoutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  onWorkOrderFound: (workOrder: ProjectWorkOrder) => void;
}

type ScanMode = "select" | "barcode" | "qrcode" | "manual" | "confirm";

export function StartMeterChangeoutDialog({
  isOpen,
  onClose,
  projectId,
  onWorkOrderFound,
}: StartMeterChangeoutDialogProps) {
  const { toast } = useToast();
  const [scanMode, setScanMode] = useState<ScanMode>("select");
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [focusSupported, setFocusSupported] = useState(false);
  const [isFocusing, setIsFocusing] = useState(false);
  const [capabilitiesChecked, setCapabilitiesChecked] = useState(false);
  const [pendingResult, setPendingResult] = useState<string | null>(null);
  const [manualInput, setManualInput] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [foundWorkOrder, setFoundWorkOrder] = useState<ProjectWorkOrder | null>(null);
  
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );
      setIsMobile(mobile);
    };
    checkMobile();
  }, []);

  useEffect(() => {
    if (!isOpen) {
      resetState();
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  const resetState = useCallback(() => {
    stopScanning();
    setScanMode("select");
    setManualInput("");
    setLookupError(null);
    setPendingResult(null);
    setFoundWorkOrder(null);
  }, []);

  const handleScanResult = useCallback((decodedText: string) => {
    setPendingResult(decodedText);
    if (scannerRef.current) {
      scannerRef.current.pause(true);
    }
  }, []);

  const stopScanning = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (e) {
        console.error("Error stopping scanner:", e);
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
    setScanError(null);
    setTorchSupported(false);
    setTorchEnabled(false);
    setFocusSupported(false);
    setCapabilitiesChecked(false);
    setPendingResult(null);
  }, []);

  const checkCameraCapabilities = useCallback(async () => {
    if (!scannerRef.current) return;

    try {
      await new Promise(resolve => setTimeout(resolve, 500));

      const capabilities = scannerRef.current.getRunningTrackCapabilities() as any;
      const settings = scannerRef.current.getRunningTrackSettings() as any;

      const hasFocus = capabilities?.focusMode && Array.isArray(capabilities.focusMode) && capabilities.focusMode.length > 0;
      setFocusSupported(hasFocus);

      if (hasFocus && capabilities.focusMode.includes("continuous")) {
        try {
          await scannerRef.current.applyVideoConstraints({
            focusMode: "continuous",
            advanced: [{ focusMode: "continuous" }],
          } as unknown as MediaTrackConstraints);
        } catch (focusErr) {
          console.log("Could not apply continuous autofocus:", focusErr);
        }
      }

      const hasTorch = capabilities?.torch === true || (settings && "torch" in settings);
      setTorchSupported(hasTorch);

      setCapabilitiesChecked(true);
    } catch (err) {
      console.log("Could not check camera capabilities:", err);
      setCapabilitiesChecked(true);
    }
  }, []);

  const triggerFocus = useCallback(async () => {
    if (!scannerRef.current) return;

    setIsFocusing(true);
    try {
      const videoElement = document.querySelector('#meter-scanner-container video') as HTMLVideoElement;
      if (!videoElement?.srcObject) {
        return;
      }
      
      const stream = videoElement.srcObject as MediaStream;
      const videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        return;
      }

      const capabilities = videoTrack.getCapabilities() as any;
      
      if (capabilities?.focusMode && Array.isArray(capabilities.focusMode)) {
        if (capabilities.focusMode.includes("single-shot")) {
          await videoTrack.applyConstraints({
            advanced: [{ focusMode: "single-shot" } as any],
          });
        } else if (capabilities.focusMode.includes("continuous")) {
          await videoTrack.applyConstraints({
            advanced: [{ focusMode: "continuous" } as any],
          });
        }
      }
    } catch (err) {
      console.error("Failed to trigger focus:", err);
    } finally {
      setTimeout(() => setIsFocusing(false), 500);
    }
  }, []);

  const toggleTorch = useCallback(async () => {
    if (!scannerRef.current || !torchSupported) return;

    try {
      const newTorchState = !torchEnabled;
      await scannerRef.current.applyVideoConstraints({
        torch: newTorchState,
        advanced: [{ torch: newTorchState }],
      } as unknown as MediaTrackConstraints);

      const settings = scannerRef.current.getRunningTrackSettings() as any;
      if (settings?.torch !== undefined) {
        setTorchEnabled(settings.torch === true);
      } else {
        setTorchEnabled(newTorchState);
      }
    } catch (err) {
      console.error("Failed to toggle torch:", err);
    }
  }, [torchSupported, torchEnabled]);

  const startScanning = useCallback(async (mode: "barcode" | "qrcode") => {
    setScanError(null);
    setIsScanning(true);
    setTorchSupported(false);
    setTorchEnabled(false);
    setFocusSupported(false);
    setCapabilitiesChecked(false);

    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      const scanner = new Html5Qrcode("meter-scanner-container");
      scannerRef.current = scanner;

      const formats = mode === "barcode"
        ? [
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E,
            Html5QrcodeSupportedFormats.ITF,
            Html5QrcodeSupportedFormats.CODABAR,
          ]
        : [Html5QrcodeSupportedFormats.QR_CODE];

      const config = {
        fps: 10,
        qrbox: mode === "barcode"
          ? { width: 280, height: 120 }
          : { width: 200, height: 200 },
        formatsToSupport: formats,
        aspectRatio: mode === "barcode" ? 16 / 9 : 1.0,
        experimentalFeatures: {
          useBarCodeDetectorIfSupported: true,
        },
      };

      await scanner.start(
        { facingMode: "environment" },
        config,
        handleScanResult,
        () => {}
      );

      checkCameraCapabilities();
    } catch (err: any) {
      console.error("Failed to start scanner:", err);
      setScanError(
        err?.message || "Failed to start camera. Please check permissions."
      );
      setIsScanning(false);
    }
  }, [handleScanResult, checkCameraCapabilities]);

  const lookupWorkOrder = useCallback(async (meterId: string) => {
    if (!meterId.trim()) {
      setLookupError("Please enter an old meter ID");
      return;
    }

    setIsLookingUp(true);
    setLookupError(null);

    try {
      const response = await apiRequest("GET", `/api/projects/${projectId}/work-orders/by-meter/${encodeURIComponent(meterId.trim())}`);
      const workOrder = await response.json();
      
      stopScanning();
      setFoundWorkOrder(workOrder);
      setScanMode("confirm");
    } catch (error: any) {
      console.error("Lookup error:", error);
      if (error.message?.includes("404") || error.message?.includes("not found")) {
        setLookupError(`No work order found with old meter ID: ${meterId}`);
      } else {
        setLookupError(error.message || "Failed to look up work order");
      }
    } finally {
      setIsLookingUp(false);
    }
  }, [projectId, stopScanning]);

  const confirmAndProceed = useCallback(() => {
    if (foundWorkOrder) {
      onWorkOrderFound(foundWorkOrder);
      onClose();
    }
  }, [foundWorkOrder, onWorkOrderFound, onClose]);

  const cancelConfirmation = useCallback(() => {
    setFoundWorkOrder(null);
    setScanMode("select");
    setManualInput("");
    setPendingResult(null);
  }, []);

  const acceptScanResult = useCallback(() => {
    if (pendingResult) {
      lookupWorkOrder(pendingResult);
    }
  }, [pendingResult, lookupWorkOrder]);

  const retryScan = useCallback(() => {
    setPendingResult(null);
    setLookupError(null);
    if (scannerRef.current) {
      scannerRef.current.resume();
    }
  }, []);

  const handleModeSelect = (mode: "barcode" | "qrcode" | "manual") => {
    setLookupError(null);
    if (mode === "manual") {
      setScanMode("manual");
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setScanMode(mode);
      startScanning(mode);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lookupWorkOrder(manualInput);
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Start Meter Changeout
          </DialogTitle>
          <DialogDescription>
            Scan or enter the old meter ID to find the work order
          </DialogDescription>
        </DialogHeader>

        {scanMode === "select" && (
          <div className="space-y-3">
            <Card 
              className="cursor-pointer hover-elevate"
              onClick={() => handleModeSelect("barcode")}
              data-testid="button-scan-barcode"
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <Scan className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium">Scan Barcode</h3>
                  <p className="text-sm text-muted-foreground">Use camera to scan 1D barcode</p>
                </div>
              </CardContent>
            </Card>

            <Card 
              className="cursor-pointer hover-elevate"
              onClick={() => handleModeSelect("qrcode")}
              data-testid="button-scan-qrcode"
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <QrCode className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium">Scan QR Code</h3>
                  <p className="text-sm text-muted-foreground">Use camera to scan QR code</p>
                </div>
              </CardContent>
            </Card>

            <Card 
              className="cursor-pointer hover-elevate"
              onClick={() => handleModeSelect("manual")}
              data-testid="button-manual-entry"
            >
              <CardContent className="flex items-center gap-4 p-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <Keyboard className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-medium">Manual Entry</h3>
                  <p className="text-sm text-muted-foreground">Type the old meter ID</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {(scanMode === "barcode" || scanMode === "qrcode") && (
          <div className="space-y-4">
            <div className="relative">
              <div
                id="meter-scanner-container"
                className="w-full min-h-[250px] rounded-lg overflow-hidden bg-muted"
              />
              
              {isScanning && !scanError && !pendingResult && (
                <div className="absolute bottom-2 left-2 right-2 flex gap-1 flex-wrap justify-center">
                  {capabilitiesChecked && torchSupported && (
                    <Button
                      type="button"
                      size="sm"
                      variant={torchEnabled ? "default" : "secondary"}
                      onClick={toggleTorch}
                      className="gap-1"
                      data-testid="button-toggle-torch"
                    >
                      {torchEnabled ? (
                        <FlashlightOff className="h-4 w-4" />
                      ) : (
                        <Flashlight className="h-4 w-4" />
                      )}
                      {torchEnabled ? "Off" : "Light"}
                    </Button>
                  )}
                  {capabilitiesChecked && focusSupported && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={triggerFocus}
                      disabled={isFocusing}
                      className="gap-1"
                      data-testid="button-focus"
                    >
                      <Focus className={`h-4 w-4 ${isFocusing ? "animate-pulse" : ""}`} />
                      Focus
                    </Button>
                  )}
                </div>
              )}

              {pendingResult && (
                <div className="absolute inset-0 bg-background/95 flex flex-col items-center justify-center p-4">
                  <Badge variant="secondary" className="mb-4 text-lg px-4 py-2">
                    {pendingResult}
                  </Badge>
                  
                  {isLookingUp ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Looking up work order...
                    </div>
                  ) : lookupError ? (
                    <div className="text-center space-y-3">
                      <div className="flex items-center justify-center gap-2 text-destructive">
                        <AlertCircle className="h-5 w-5" />
                        <span className="text-sm">{lookupError}</span>
                      </div>
                      <Button onClick={retryScan} variant="outline" data-testid="button-retry-scan">
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Scan Again
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button onClick={retryScan} variant="outline" data-testid="button-retry">
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Retry
                      </Button>
                      <Button onClick={acceptScanResult} data-testid="button-accept-scan">
                        <Check className="h-4 w-4 mr-2" />
                        Look Up
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {scanError && (
                <div className="absolute inset-0 flex items-center justify-center p-4 bg-background/90">
                  <div className="text-center space-y-2">
                    <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
                    <p className="text-sm text-destructive">{scanError}</p>
                    <Button onClick={() => startScanning(scanMode as "barcode" | "qrcode")} variant="outline" size="sm">
                      Try Again
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  stopScanning();
                  setScanMode("select");
                }}
                className="flex-1"
                data-testid="button-back-to-select"
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
            </div>
          </div>
        )}

        {scanMode === "manual" && (
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Old Meter ID</label>
              <Input
                ref={inputRef}
                value={manualInput}
                onChange={(e) => {
                  setManualInput(e.target.value);
                  setLookupError(null);
                }}
                placeholder="Enter old meter ID..."
                disabled={isLookingUp}
                data-testid="input-old-meter-id"
              />
              {lookupError && (
                <div className="flex items-center gap-2 text-destructive text-sm">
                  <AlertCircle className="h-4 w-4" />
                  {lookupError}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setScanMode("select");
                  setManualInput("");
                  setLookupError(null);
                }}
                disabled={isLookingUp}
                className="flex-1"
                data-testid="button-back"
              >
                Back
              </Button>
              <Button
                type="submit"
                disabled={!manualInput.trim() || isLookingUp}
                className="flex-1"
                data-testid="button-lookup"
              >
                {isLookingUp ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Looking up...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Look Up
                  </>
                )}
              </Button>
            </div>
          </form>
        )}

        {scanMode === "confirm" && foundWorkOrder && (
          <div className="space-y-4">
            <div className="text-center">
              <Badge variant="secondary" className="mb-2">
                Work Order Found
              </Badge>
            </div>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Work Order</p>
                    <p className="font-medium break-all" data-testid="text-confirm-wo-id">
                      {foundWorkOrder.customerWoId || `WO-${foundWorkOrder.id}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Address</p>
                    <p className="font-medium break-all" data-testid="text-confirm-address">
                      {foundWorkOrder.address || "No address"}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Gauge className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Old Meter ID</p>
                    <p className="font-medium break-all" data-testid="text-confirm-meter-id">
                      {foundWorkOrder.oldMeterId || "N/A"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={cancelConfirmation}
                className="flex-1"
                data-testid="button-cancel-confirm"
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button
                type="button"
                onClick={confirmAndProceed}
                className="flex-1"
                data-testid="button-confirm-proceed"
              >
                <Check className="h-4 w-4 mr-2" />
                Confirm
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
