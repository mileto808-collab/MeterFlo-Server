import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Scan, QrCode, Keyboard, Camera, X, Flashlight, FlashlightOff, Focus, Check, RotateCcw, Loader2, Wrench, AlertCircle, MapPin, FileText, Gauge, ClipboardCheck, Ban, StickyNote } from "lucide-react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import type { ProjectWorkOrder } from "../../../server/projectDb";
import type { UserGroup, TroubleCode } from "@shared/schema";

export type ChangeoutScope = "system" | "module" | "both";

interface StartSystemChangeoutDialogProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: number;
  onWorkOrderFound: (workOrder: ProjectWorkOrder, scope: ChangeoutScope) => void;
}

type ScanMode = "select" | "barcode" | "qrcode" | "manual" | "confirm";

export function StartSystemChangeoutDialog({
  isOpen,
  onClose,
  projectId,
  onWorkOrderFound,
}: StartSystemChangeoutDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Fetch user's group memberships to determine if claiming is needed
  const { data: userGroups = [], isLoading: isGroupsLoading } = useQuery<UserGroup[]>({
    queryKey: ["/api/auth/user/groups"],
    enabled: isOpen,
  });
  
  // Fetch trouble codes to display labels
  const { data: troubleCodes = [] } = useQuery<TroubleCode[]>({
    queryKey: ["/api/trouble-codes"],
    enabled: isOpen,
  });
  
  // Helper to get trouble code label (case-insensitive comparison)
  const getTroubleCodeLabel = (code: string | null | undefined): string | null => {
    if (!code) return null;
    const troubleCode = troubleCodes.find(tc => tc.code.toLowerCase() === code.toLowerCase());
    return troubleCode ? troubleCode.label : null;
  };
  
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
    setShowClaimConfirm(false);
    setPendingClaimCheck(false);
    setIsClaiming(false);
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
      const videoElement = document.querySelector('#system-scanner-container video') as HTMLVideoElement;
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
      const scanner = new Html5Qrcode("system-scanner-container");
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

  const lookupWorkOrder = useCallback(async (searchTerm: string) => {
    if (!searchTerm.trim()) {
      setLookupError("Please enter a search term");
      return;
    }

    setIsLookingUp(true);
    setLookupError(null);

    try {
      const response = await apiRequest("GET", `/api/projects/${projectId}/work-orders/by-system/${encodeURIComponent(searchTerm.trim())}`);
      const workOrder = await response.json();
      
      stopScanning();
      setFoundWorkOrder(workOrder);
      setScanMode("confirm");
    } catch (error: any) {
      console.error("Lookup error:", error);
      if (error.message?.includes("404") || error.message?.includes("not found")) {
        setLookupError(`No work order found matching: ${searchTerm}`);
      } else {
        setLookupError(error.message || "Failed to look up work order");
      }
    } finally {
      setIsLookingUp(false);
    }
  }, [projectId, stopScanning]);

  const [isClaiming, setIsClaiming] = useState(false);
  const [showClaimConfirm, setShowClaimConfirm] = useState(false);

  // Check if claiming is needed for the found work order (client-side check)
  const isClaimingNeeded = useCallback((workOrder: ProjectWorkOrder): boolean => {
    // Already assigned to current user - no claim needed
    if (workOrder.assignedUserId === user?.id) {
      return false;
    }
    
    // Assigned to a group the user is a member of - no claim needed
    if (workOrder.assignedGroupId && userGroups.length > 0) {
      const userGroupNames = userGroups.map(g => g.name);
      if (userGroupNames.includes(workOrder.assignedGroupId)) {
        return false;
      }
    }
    
    // Otherwise, claiming is needed
    return true;
  }, [user?.id, userGroups]);

  // Determine scope based on work order data (presence of system/module IDs)
  const determineScope = useCallback((workOrder: ProjectWorkOrder): ChangeoutScope => {
    const hasSystem = !!(workOrder as any).old_system_id || !!workOrder.oldSystemId;
    const hasModule = !!(workOrder as any).old_module_id || !!workOrder.oldModuleId;
    
    if (hasSystem && hasModule) return "both";
    if (hasModule) return "module";
    return "system"; // Default to system even if neither exists
  }, []);

  // Proceed with work order (let backend decide if claim is needed)
  const proceedWithWorkOrder = useCallback(async () => {
    if (!foundWorkOrder) return;
    
    setIsClaiming(true);
    try {
      // Call claim endpoint - backend will decide if claim is actually needed
      const response = await apiRequest("POST", `/api/projects/${projectId}/work-orders/${foundWorkOrder.id}/claim`);
      const result = await response.json();
      const updatedWorkOrder = result.workOrder || foundWorkOrder;
      setShowClaimConfirm(false);
      
      // Auto-determine scope and proceed directly (no scope selection dialog)
      const autoScope = determineScope(updatedWorkOrder);
      onWorkOrderFound(updatedWorkOrder, autoScope);
      onClose();
    } catch (error: any) {
      console.error("Error proceeding with work order:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to proceed with work order",
        variant: "destructive",
      });
      setShowClaimConfirm(false);
    } finally {
      setIsClaiming(false);
    }
  }, [foundWorkOrder, projectId, toast, determineScope, onWorkOrderFound, onClose]);

  // State to track when we're waiting for groups to load
  const [pendingClaimCheck, setPendingClaimCheck] = useState(false);
  
  // Effect to handle claim check after groups have loaded
  useEffect(() => {
    if (pendingClaimCheck && !isGroupsLoading && foundWorkOrder && user) {
      setPendingClaimCheck(false);
      
      // Now that groups are loaded, make the decision
      if (!isClaimingNeeded(foundWorkOrder)) {
        // No claim needed - proceed directly
        proceedWithWorkOrder();
      } else {
        // Claiming is needed - show confirmation dialog
        setShowClaimConfirm(true);
      }
    }
  }, [pendingClaimCheck, isGroupsLoading, foundWorkOrder, user, isClaimingNeeded, proceedWithWorkOrder]);

  const openClaimConfirmation = useCallback(() => {
    if (!foundWorkOrder) return;
    
    // If groups are still loading or user not ready, wait for them
    if (isGroupsLoading || !user) {
      // Mark that we're waiting for groups to load
      setPendingClaimCheck(true);
      return;
    }
    
    // Use client-side check to determine if dialog should show
    // The backend will do the authoritative check when claim is executed
    if (!isClaimingNeeded(foundWorkOrder)) {
      // No claim needed according to client-side check - proceed directly
      proceedWithWorkOrder();
      return;
    }
    
    // Claiming may be needed - show confirmation dialog
    setShowClaimConfirm(true);
  }, [foundWorkOrder, isClaimingNeeded, proceedWithWorkOrder, isGroupsLoading, user]);

  // User confirmed they want to claim the work order
  const executeClaimAndProceed = useCallback(async () => {
    if (!foundWorkOrder) return;
    proceedWithWorkOrder();
  }, [foundWorkOrder, proceedWithWorkOrder]);

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
    <>
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Start System Changeout
          </DialogTitle>
          <DialogDescription>
            Search by work order ID, system ID, module ID, address, or customer ID
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
                  <p className="text-sm text-muted-foreground">Search by work order ID, system ID, module ID, address, or customer ID</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {(scanMode === "barcode" || scanMode === "qrcode") && (
          <div className="space-y-4">
            <div className="relative">
              <div
                id="system-scanner-container"
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
              <label className="text-sm font-medium">Search</label>
              <Input
                ref={inputRef}
                value={manualInput}
                onChange={(e) => {
                  setManualInput(e.target.value);
                  setLookupError(null);
                }}
                placeholder="Work order ID, system ID, module ID, address, or customer ID..."
                disabled={isLookingUp}
                data-testid="input-search"
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

        {scanMode === "confirm" && foundWorkOrder && (() => {
          const isCompleted = foundWorkOrder.status?.toLowerCase() === "completed";
          const isTrouble = foundWorkOrder.status?.toLowerCase() === "trouble";
          return (
            <div className="space-y-4">
              <div className="text-center">
                <Badge variant={isCompleted ? "destructive" : (isTrouble ? "outline" : "secondary")} className={`mb-2 ${isTrouble ? "border-amber-500 text-amber-500" : ""}`}>
                  {isCompleted ? "Work Order Already Completed" : (isTrouble ? "Trouble Work Order" : "Work Order Found")}
                </Badge>
              </div>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">Work Order</p>
                      <p className="font-medium break-all" data-testid="text-confirm-wo-id">
                        {(foundWorkOrder as any).customer_wo_id || foundWorkOrder.customerWoId || `WO-${foundWorkOrder.id}`}
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
                      <p className="text-sm text-muted-foreground">Old System ID</p>
                      <p className="font-medium break-all" data-testid="text-confirm-old-system-id">
                        {(foundWorkOrder as any).old_system_id || foundWorkOrder.oldSystemId || "N/A"}
                      </p>
                    </div>
                  </div>

                  {((foundWorkOrder as any).new_system_id || foundWorkOrder.newSystemId) && (
                    <div className="flex items-start gap-3">
                      <Gauge className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-muted-foreground">New System ID</p>
                        <p className="font-medium break-all" data-testid="text-confirm-new-system-id">
                          {(foundWorkOrder as any).new_system_id || foundWorkOrder.newSystemId}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-3">
                    <ClipboardCheck className={`h-5 w-5 mt-0.5 shrink-0 ${isCompleted ? "text-destructive" : (isTrouble ? "text-amber-500" : "text-muted-foreground")}`} />
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">Status</p>
                      <p className={`font-medium ${isCompleted ? "text-destructive" : (isTrouble ? "text-amber-500" : "")}`} data-testid="text-confirm-status">
                        {foundWorkOrder.status || "Unknown"}
                        {isTrouble && foundWorkOrder.trouble && (
                          <span className="ml-2 text-sm" data-testid="text-confirm-trouble-code">
                            ({foundWorkOrder.trouble}{getTroubleCodeLabel(foundWorkOrder.trouble) ? ` - ${getTroubleCodeLabel(foundWorkOrder.trouble)}` : ""})
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {foundWorkOrder.notes && (
                    <div className="flex items-start gap-3">
                      <StickyNote className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm text-muted-foreground">Notes</p>
                        <p className="font-medium break-all" data-testid="text-confirm-notes">
                          {foundWorkOrder.notes}
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {isCompleted && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive" data-testid="alert-completed-warning">
                  <Ban className="h-5 w-5 shrink-0" />
                  <p className="text-sm" data-testid="text-completed-warning">This work order has already been completed. A system changeout cannot be started.</p>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelConfirmation}
                  className="flex-1"
                  disabled={isClaiming}
                  data-testid="button-cancel-confirm"
                >
                  <X className="h-4 w-4 mr-2" />
                  {isCompleted ? "Close" : "Cancel"}
                </Button>
                {!isCompleted && (
                  <Button
                    type="button"
                    onClick={openClaimConfirmation}
                    className="flex-1"
                    disabled={pendingClaimCheck || isClaiming}
                    data-testid="button-confirm-proceed"
                  >
                    {(pendingClaimCheck || isClaiming) ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4 mr-2" />
                    )}
                    {pendingClaimCheck ? "Loading..." : (isClaiming ? "Processing..." : "Confirm")}
                  </Button>
                )}
              </div>
            </div>
          );
        })()}
      </DialogContent>
    </Dialog>

    <AlertDialog open={showClaimConfirm && !pendingClaimCheck} onOpenChange={setShowClaimConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle data-testid="title-claim-confirm">Claim Work Order?</AlertDialogTitle>
          <AlertDialogDescription data-testid="text-claim-description">
            Claiming this work order will assign it to you and open the system changeout wizard. 
            {foundWorkOrder?.assignedGroupId && (
              <span className="block mt-2">
                Currently assigned to group: <strong>{foundWorkOrder.assignedGroupId}</strong>
              </span>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isClaiming} data-testid="button-claim-back">
            Back
          </AlertDialogCancel>
          <Button 
            onClick={executeClaimAndProceed} 
            disabled={isClaiming}
            data-testid="button-claim-start"
          >
            {isClaiming ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Claiming...
              </>
            ) : (
              "Claim & Start"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    </>
  );
}
