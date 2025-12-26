import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Scan, QrCode, Keyboard, ChevronDown, Camera, X, Flashlight, Check, RotateCcw } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";

interface ScannerInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

type ScanMode = "manual" | "barcode" | "qrcode";

interface ScanAttempt {
  value: string;
  timestamp: number;
  count: number;
}

const REQUIRED_CONSECUTIVE_MATCHES = 2;
const MAX_RECENT_ATTEMPTS = 5;

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
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [recentAttempts, setRecentAttempts] = useState<ScanAttempt[]>([]);
  const [matchProgress, setMatchProgress] = useState(0);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);
  const lastScanRef = useRef<{ value: string; consecutiveCount: number } | null>(null);
  const confirmationOpenRef = useRef(false);

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

  const validateAndAcceptScan = useCallback((decodedText: string) => {
    if (confirmationOpenRef.current) {
      return;
    }
    
    const now = Date.now();
    const lastScan = lastScanRef.current;
    
    if (lastScan && lastScan.value === decodedText) {
      lastScan.consecutiveCount++;
    } else {
      lastScanRef.current = { value: decodedText, consecutiveCount: 1 };
    }
    
    const currentCount = lastScanRef.current?.consecutiveCount || 0;
    setMatchProgress(currentCount);
    
    setRecentAttempts(prev => {
      const existing = prev.find(a => a.value === decodedText);
      if (existing) {
        return prev.map(a => 
          a.value === decodedText 
            ? { ...a, count: a.count + 1, timestamp: now }
            : a
        ).slice(-MAX_RECENT_ATTEMPTS);
      } else {
        return [...prev, { value: decodedText, count: 1, timestamp: now }].slice(-MAX_RECENT_ATTEMPTS);
      }
    });
    
    if (currentCount >= REQUIRED_CONSECUTIVE_MATCHES) {
      lastScanRef.current = null;
      setMatchProgress(0);
      setPendingValue(decodedText);
      confirmationOpenRef.current = true;
      setShowConfirmation(true);
    }
  }, []);

  const confirmScan = useCallback(() => {
    if (pendingValue) {
      onChange(pendingValue);
      setPendingValue(null);
      confirmationOpenRef.current = false;
      setShowConfirmation(false);
      stopScanning();
    }
  }, [pendingValue, onChange]);

  const rejectScan = useCallback(() => {
    setPendingValue(null);
    confirmationOpenRef.current = false;
    setShowConfirmation(false);
    lastScanRef.current = null;
    setMatchProgress(0);
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
    setTorchEnabled(false);
    setTorchSupported(false);
    setRecentAttempts([]);
    setMatchProgress(0);
    lastScanRef.current = null;
    confirmationOpenRef.current = false;
  }, []);

  const toggleTorch = useCallback(async () => {
    if (!scannerRef.current) return;
    
    try {
      const newState = !torchEnabled;
      await scannerRef.current.applyVideoConstraints({
        advanced: [{ torch: newState } as any]
      });
      setTorchEnabled(newState);
    } catch (err) {
      console.error("Failed to toggle torch:", err);
    }
  }, [torchEnabled]);

  const checkTorchSupport = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment" } 
      });
      const track = stream.getVideoTracks()[0];
      const capabilities = track.getCapabilities() as any;
      stream.getTracks().forEach(t => t.stop());
      return capabilities?.torch === true;
    } catch {
      return false;
    }
  }, []);

  const startQRScanning = useCallback(async () => {
    setScanError(null);
    setIsScanning(true);
    setRecentAttempts([]);
    lastScanRef.current = null;
    setMatchProgress(0);

    await new Promise(resolve => setTimeout(resolve, 100));

    const containerId = "qr-scanner-container";
    const container = document.getElementById(containerId);
    
    if (!container) {
      setScanError("Scanner container not found");
      setIsScanning(false);
      return;
    }

    const hasTorch = await checkTorchSupport();
    setTorchSupported(hasTorch);

    try {
      scannerRef.current = new Html5Qrcode(containerId, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      
      await scannerRef.current.start(
        { facingMode: "environment" },
        {
          fps: 15,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1,
        },
        (decodedText) => {
          validateAndAcceptScan(decodedText);
        },
        () => {}
      );
    } catch (err: any) {
      console.error("QR Scanner error:", err);
      setScanError(err?.message || "Failed to access camera. Please check permissions.");
      setIsScanning(false);
    }
  }, [validateAndAcceptScan, checkTorchSupport]);

  const startBarcodeScanning = useCallback(async () => {
    if (isMobile) {
      setScanError(null);
      setIsScanning(true);
      setRecentAttempts([]);
      lastScanRef.current = null;
      setMatchProgress(0);

      await new Promise(resolve => setTimeout(resolve, 100));

      const containerId = "qr-scanner-container";
      const container = document.getElementById(containerId);
      
      if (!container) {
        setScanError("Scanner container not found");
        setIsScanning(false);
        return;
      }

      const hasTorch = await checkTorchSupport();
      setTorchSupported(hasTorch);

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
            fps: 15,
            qrbox: { width: 280, height: 120 },
            aspectRatio: 16 / 9,
            videoConstraints: {
              facingMode: "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
              focusMode: "continuous" as any,
            }
          } as any,
          (decodedText) => {
            validateAndAcceptScan(decodedText);
          },
          () => {}
        );
      } catch (err: any) {
        console.error("Barcode Scanner error:", err);
        setScanError(err?.message || "Failed to access camera. Please check permissions.");
        setIsScanning(false);
      }
    } else {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }
  }, [isMobile, validateAndAcceptScan, checkTorchSupport]);

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
    setShowConfirmation(false);
    setPendingValue(null);
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

      <Dialog open={isScanning && !showConfirmation} onOpenChange={(open) => !open && handleDialogClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Camera className="h-5 w-5" />
                {scanMode === "qrcode" ? "Scan QR Code" : "Scan Barcode"}
              </div>
              {torchSupported && (
                <Button
                  type="button"
                  variant={torchEnabled ? "default" : "outline"}
                  size="icon"
                  onClick={toggleTorch}
                  data-testid={`${testId}-torch-toggle`}
                >
                  <Flashlight className="h-4 w-4" />
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div 
              id="qr-scanner-container" 
              ref={scannerContainerRef}
              className="w-full aspect-video bg-muted rounded-lg overflow-hidden"
            />
            
            {matchProgress > 0 && (
              <div className="flex items-center justify-center gap-2">
                <span className="text-sm text-muted-foreground">Verifying:</span>
                <div className="flex gap-1">
                  {Array.from({ length: REQUIRED_CONSECUTIVE_MATCHES }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-3 h-3 rounded-full ${
                        i < matchProgress ? "bg-green-500" : "bg-muted-foreground/30"
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}
            
            {recentAttempts.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Recent scans:</p>
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                  {recentAttempts.slice().reverse().map((attempt, idx) => (
                    <Badge
                      key={`${attempt.value}-${idx}`}
                      variant="secondary"
                      className="text-xs font-mono"
                    >
                      {attempt.value.length > 15 ? `${attempt.value.slice(0, 15)}...` : attempt.value}
                      {attempt.count > 1 && (
                        <span className="ml-1 text-green-600 dark:text-green-400">x{attempt.count}</span>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            
            {scanError && (
              <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
                {scanError}
              </div>
            )}
            
            <p className="text-sm text-muted-foreground text-center">
              {scanMode === "qrcode" 
                ? "Point your camera at a QR code. Hold steady for verification."
                : "Point your camera at a barcode. Hold steady for verification."}
            </p>
            
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

      <Dialog open={showConfirmation} onOpenChange={(open) => !open && rejectScan()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-500" />
              Confirm Scanned Value
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Scanned value:</p>
              <p className="text-lg font-mono font-medium break-all" data-testid={`${testId}-pending-value`}>
                {pendingValue}
              </p>
            </div>
            
            <p className="text-sm text-muted-foreground text-center">
              Is this the correct value?
            </p>
          </div>
          
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={rejectScan}
              data-testid={`${testId}-reject-scan`}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Try Again
            </Button>
            <Button
              type="button"
              onClick={confirmScan}
              data-testid={`${testId}-confirm-scan`}
            >
              <Check className="h-4 w-4 mr-2" />
              Accept
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ScannerInput;
