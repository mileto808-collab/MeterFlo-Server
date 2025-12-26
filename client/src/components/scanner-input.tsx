import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Scan, QrCode, Keyboard, ChevronDown, Camera, X, Flashlight, FlashlightOff, Focus, Check, RotateCcw } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Badge } from "@/components/ui/badge";

interface ScannerInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

type ScanMode = "manual" | "barcode" | "qrcode";

export function ScannerInput({
  value,
  onChange,
  placeholder = "Enter ID...",
  disabled = false,
  "data-testid": testId,
}: ScannerInputProps) {
  const [scanMode, setScanMode] = useState<ScanMode>("manual");
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [focusSupported, setFocusSupported] = useState(false);
  const [isFocusing, setIsFocusing] = useState(false);
  const [capabilitiesChecked, setCapabilitiesChecked] = useState(false);
  const [pendingResult, setPendingResult] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
        navigator.userAgent
      );
      setIsMobile(mobile);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  const handleScanResult = useCallback((decodedText: string) => {
    setPendingResult(decodedText);
    if (scannerRef.current) {
      scannerRef.current.pause(true);
    }
  }, []);

  const acceptScanResult = useCallback(() => {
    if (pendingResult) {
      onChange(pendingResult);
      setPendingResult(null);
      stopScanning();
    }
  }, [pendingResult, onChange]);

  const retryScan = useCallback(() => {
    setPendingResult(null);
    if (scannerRef.current) {
      scannerRef.current.resume();
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

      console.log("Camera capabilities:", capabilities);
      console.log("Camera settings:", settings);

      const hasFocus = capabilities?.focusMode && Array.isArray(capabilities.focusMode) && capabilities.focusMode.length > 0;
      setFocusSupported(hasFocus);

      if (hasFocus && capabilities.focusMode.includes("continuous")) {
        try {
          await scannerRef.current.applyVideoConstraints({
            focusMode: "continuous",
            advanced: [{ focusMode: "continuous" }],
          } as unknown as MediaTrackConstraints);
          console.log("Continuous autofocus applied");
        } catch (focusErr) {
          console.log("Could not apply continuous autofocus:", focusErr);
        }
      }

      const hasTorch = capabilities?.torch === true || (settings && "torch" in settings);
      setTorchSupported(hasTorch);
      console.log("Torch supported:", hasTorch);

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
      const capabilities = scannerRef.current.getRunningTrackCapabilities() as any;
      
      if (capabilities?.focusMode && Array.isArray(capabilities.focusMode)) {
        if (capabilities.focusMode.includes("single-shot")) {
          await scannerRef.current.applyVideoConstraints({
            focusMode: "single-shot",
            advanced: [{ focusMode: "single-shot" }],
          } as unknown as MediaTrackConstraints);
        } else if (capabilities.focusMode.includes("manual")) {
          await scannerRef.current.applyVideoConstraints({
            focusMode: "manual",
            advanced: [{ focusMode: "manual" }],
          } as unknown as MediaTrackConstraints);
          await new Promise(resolve => setTimeout(resolve, 100));
          await scannerRef.current.applyVideoConstraints({
            focusMode: "continuous",
            advanced: [{ focusMode: "continuous" }],
          } as unknown as MediaTrackConstraints);
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

  const startQRScanning = useCallback(async () => {
    setScanError(null);
    setIsScanning(true);
    setTorchSupported(false);
    setTorchEnabled(false);
    setFocusSupported(false);
    setCapabilitiesChecked(false);
    setPendingResult(null);

    await new Promise(resolve => setTimeout(resolve, 100));

    const containerId = "qr-scanner-container";
    const container = document.getElementById(containerId);
    
    if (!container) {
      setScanError("Scanner container not found");
      setIsScanning(false);
      return;
    }

    try {
      scannerRef.current = new Html5Qrcode(containerId, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      
      await scannerRef.current.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          handleScanResult(decodedText);
        },
        () => {}
      );

      await checkCameraCapabilities();
    } catch (err: any) {
      console.error("QR Scanner error:", err);
      setScanError(err?.message || "Failed to access camera. Please check permissions.");
      setIsScanning(false);
      scannerRef.current = null;
    }
  }, [handleScanResult, checkCameraCapabilities]);

  const startBarcodeScanning = useCallback(async () => {
    if (isMobile) {
      setScanError(null);
      setIsScanning(true);
      setTorchSupported(false);
      setTorchEnabled(false);
      setFocusSupported(false);
      setCapabilitiesChecked(false);
      setPendingResult(null);

      await new Promise(resolve => setTimeout(resolve, 100));

      const containerId = "qr-scanner-container";
      const container = document.getElementById(containerId);
      
      if (!container) {
        setScanError("Scanner container not found");
        setIsScanning(false);
        return;
      }

      try {
        const barcodeFormats = [
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.CODABAR,
        ];
        
        scannerRef.current = new Html5Qrcode(containerId, {
          formatsToSupport: barcodeFormats,
          verbose: false,
        });
        
        await scannerRef.current.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 300, height: 150 },
            aspectRatio: 2,
          },
          (decodedText) => {
            handleScanResult(decodedText);
          },
          () => {}
        );

        await checkCameraCapabilities();
      } catch (err: any) {
        console.error("Barcode Scanner error:", err);
        setScanError(err?.message || "Failed to access camera. Please check permissions.");
        setIsScanning(false);
        scannerRef.current = null;
      }
    } else {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }
  }, [isMobile, handleScanResult, checkCameraCapabilities]);

  const handleModeSelect = (mode: ScanMode) => {
    setScanMode(mode);
    setScanError(null);
    
    if (mode === "qrcode") {
      startQRScanning();
    } else if (mode === "barcode") {
      startBarcodeScanning();
    } else if (mode === "manual") {
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  };

  const handleDialogClose = () => {
    stopScanning();
  };

  const getModeIcon = () => {
    switch (scanMode) {
      case "barcode":
        return <Scan className="h-4 w-4" />;
      case "qrcode":
        return <QrCode className="h-4 w-4" />;
      default:
        return <Keyboard className="h-4 w-4" />;
    }
  };

  const getModeLabel = () => {
    switch (scanMode) {
      case "barcode":
        return isMobile ? "Scan Barcode" : "HID Barcode";
      case "qrcode":
        return "Scan QR";
      default:
        return "Manual";
    }
  };

  return (
    <div className="flex gap-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={scanMode === "barcode" && !isMobile ? "Scan with HID device..." : placeholder}
        disabled={disabled}
        data-testid={testId}
        className="flex-1"
      />
      
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={disabled}
            className="gap-1 px-2"
            data-testid={`${testId}-mode-trigger`}
          >
            {getModeIcon()}
            <span className="hidden sm:inline text-xs">{getModeLabel()}</span>
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => handleModeSelect("manual")} data-testid={`${testId}-mode-manual`}>
            <Keyboard className="h-4 w-4 mr-2" />
            Manual Entry
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleModeSelect("barcode")} data-testid={`${testId}-mode-barcode`}>
            <Scan className="h-4 w-4 mr-2" />
            {isMobile ? "Scan Barcode (Camera)" : "Barcode (HID Scanner)"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleModeSelect("qrcode")} data-testid={`${testId}-mode-qrcode`}>
            <QrCode className="h-4 w-4 mr-2" />
            Scan QR Code (Camera)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={isScanning} onOpenChange={(open) => !open && handleDialogClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Camera className="h-5 w-5" />
                {pendingResult 
                  ? "Code Captured" 
                  : scanMode === "qrcode" 
                    ? "Scan QR Code" 
                    : "Scan Barcode"}
              </div>
              {!pendingResult && (
                <div className="flex items-center gap-1">
                  {capabilitiesChecked && focusSupported && (
                    <Button
                      type="button"
                      variant={isFocusing ? "default" : "outline"}
                      size="icon"
                      onClick={triggerFocus}
                      disabled={isFocusing}
                      data-testid={`${testId}-tap-focus`}
                      title="Tap to focus"
                    >
                      <Focus className="h-4 w-4" />
                    </Button>
                  )}
                  {capabilitiesChecked && torchSupported && (
                    <Button
                      type="button"
                      variant={torchEnabled ? "default" : "outline"}
                      size="icon"
                      onClick={toggleTorch}
                      data-testid={`${testId}-toggle-torch`}
                      title={torchEnabled ? "Turn off flashlight" : "Turn on flashlight"}
                    >
                      {torchEnabled ? (
                        <Flashlight className="h-4 w-4" />
                      ) : (
                        <FlashlightOff className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              )}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div 
              id="qr-scanner-container" 
              ref={scannerContainerRef}
              className={`w-full aspect-square bg-muted rounded-lg overflow-hidden ${pendingResult ? 'hidden' : ''}`}
            />
            
            {pendingResult ? (
              <div className="space-y-4">
                <div className="p-4 bg-muted rounded-lg text-center">
                  <p className="text-sm text-muted-foreground mb-2">Scanned Value:</p>
                  <p className="text-lg font-mono font-semibold break-all" data-testid={`${testId}-scanned-value`}>
                    {pendingResult}
                  </p>
                </div>
                
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={retryScan}
                    className="flex-1"
                    data-testid={`${testId}-retry-scan`}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Retry
                  </Button>
                  <Button
                    type="button"
                    onClick={acceptScanResult}
                    className="flex-1"
                    data-testid={`${testId}-accept-scan`}
                  >
                    <Check className="h-4 w-4 mr-2" />
                    Accept
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {scanError && (
                  <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                    {scanError}
                  </div>
                )}

                {capabilitiesChecked && (
                  <div className="flex flex-wrap gap-2 justify-center">
                    <Badge variant={focusSupported ? "secondary" : "outline"} className="text-xs">
                      {focusSupported ? "Autofocus: On" : "Autofocus: N/A"}
                    </Badge>
                    <Badge variant={torchSupported ? "secondary" : "outline"} className="text-xs">
                      {torchSupported ? "Flashlight: Available" : "Flashlight: N/A"}
                    </Badge>
                  </div>
                )}
                
                <p className="text-sm text-muted-foreground text-center">
                  {scanMode === "qrcode" 
                    ? "Point your camera at a QR code"
                    : "Point your camera at a barcode"}
                </p>
              </>
            )}
            
            <Button
              type="button"
              variant="outline"
              onClick={handleDialogClose}
              className="w-full"
              data-testid={`${testId}-cancel-scan`}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ScannerInput;
