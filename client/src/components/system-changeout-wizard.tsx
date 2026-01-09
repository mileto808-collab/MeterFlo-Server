import { useState, useRef, useCallback, useEffect } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { GPSCapture } from "./gps-capture";
import SignaturePad, { SignaturePadRef } from "./signature-pad";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  AlertTriangle,
  Wrench,
  MapPin,
  Pen,
  Loader2,
  X,
  Image as ImageIcon,
  ScanBarcode,
  QrCode,
  Keyboard,
  Trash2,
  ZoomIn,
  FileText,
  Gauge,
  ClipboardCheck,
  StickyNote,
} from "lucide-react";

type WizardStep =
  | "canChange"
  | "troubleCapture"
  | "oldReading"
  | "beforePhotos"
  | "physicalChange"
  | "newSystemId"
  | "newReading"
  | "afterPhotos"
  | "gps"
  | "notes"
  | "signature"
  | "confirm";

interface CapturedPhoto {
  file: File;
  preview: string;
  type: "trouble" | "before" | "after";
}

export type ChangeoutScope = "system" | "module" | "both";

interface SystemChangeoutData {
  canChange: boolean;
  troubleCode: string | null;
  troubleNote: string;
  troublePhotos: CapturedPhoto[];
  oldSystemReading: string;
  oldModuleReading: string;
  beforePhotos: CapturedPhoto[];
  newSystemId: string;
  newSystemReading: string;
  newModuleId: string;
  newModuleReading: string;
  afterPhotos: CapturedPhoto[];
  gpsCoordinates: string;
  completionNotes: string;
  signatureData: string | null;
  signatureName: string;
}

interface SystemChangeoutWizardProps {
  isOpen: boolean;
  onClose: () => void;
  workOrderId: number;
  customerWoId: string;
  address?: string | null;
  oldSystemId?: string | null;
  oldSystemType?: string | null;
  newSystemType?: string | null;
  oldModuleId?: string | null;
  oldModuleType?: string | null;
  newModuleType?: string | null;
  status?: string | null;
  trouble?: string | null;
  notes?: string | null;
  projectId: number;
  troubleCodes: Array<{ id: number; code: string; label: string }>;
  existingOldReading?: string | null;
  existingNewReading?: string | null;
  existingOldModuleReading?: string | null;
  existingNewModuleReading?: string | null;
  existingGps?: string | null;
  onComplete: (data: SystemChangeoutData) => Promise<void>;
}

const stepLabels: Record<WizardStep, string> = {
  canChange: "Can The Changeout Proceed?",
  troubleCapture: "Report Issue",
  oldReading: "Old System Reading",
  beforePhotos: "Before Photos",
  physicalChange: "Perform Changeout",
  newSystemId: "New System ID",
  newReading: "New System Reading",
  afterPhotos: "After Photos",
  gps: "Capture GPS",
  notes: "Notes",
  signature: "Signature",
  confirm: "Confirm & Submit",
};

const successSteps: WizardStep[] = [
  "canChange",
  "oldReading",
  "beforePhotos",
  "physicalChange",
  "newSystemId",
  "newReading",
  "afterPhotos",
  "gps",
  "notes",
  "signature",
  "confirm",
];

const troubleSteps: WizardStep[] = ["canChange", "troubleCapture", "confirm"];

export function SystemChangeoutWizard({
  isOpen,
  onClose,
  workOrderId,
  customerWoId,
  address,
  oldSystemId,
  oldSystemType,
  newSystemType,
  oldModuleId,
  oldModuleType,
  newModuleType,
  status,
  trouble,
  notes,
  projectId,
  troubleCodes,
  existingOldReading,
  existingNewReading,
  existingOldModuleReading,
  existingNewModuleReading,
  existingGps,
  onComplete,
}: SystemChangeoutWizardProps) {
  const { toast } = useToast();
  const signaturePadRef = useRef<SignaturePadRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentStep, setCurrentStep] = useState<WizardStep>("canChange");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [photoType, setPhotoType] = useState<"trouble" | "before" | "after">("before");
  const [isCapturingPhoto, setIsCapturingPhoto] = useState(false);
  const captureSessionActive = useRef(false);
  const [systemIdInputMode, setSystemIdInputMode] = useState<"choose" | "barcode" | "qr" | "manual" | null>(null);
  const [manualSystemIdInput, setManualSystemIdInput] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<HTMLDivElement>(null);
  const [previewPhoto, setPreviewPhoto] = useState<{ photo: CapturedPhoto; type: "trouble" | "before" | "after"; index: number } | null>(null);
  
  // Toggle states for optional reading capture
  const [captureOldSystemReading, setCaptureOldSystemReading] = useState(!existingOldReading);
  const [captureOldModuleReading, setCaptureOldModuleReading] = useState(!existingOldModuleReading);

  const [data, setData] = useState<SystemChangeoutData>({
    canChange: true,
    troubleCode: null,
    troubleNote: "",
    troublePhotos: [],
    oldSystemReading: existingOldReading || "",
    oldModuleReading: existingOldModuleReading || "",
    beforePhotos: [],
    newSystemId: "",
    newSystemReading: existingNewReading || "",
    newModuleId: "",
    newModuleReading: existingNewModuleReading || "",
    afterPhotos: [],
    gpsCoordinates: existingGps || "",
    completionNotes: "",
    signatureData: null,
    signatureName: "",
  });
  
  // Determine the effective display mode based on presence of system/module IDs
  // This is now data-driven instead of scope-driven
  const getDisplayMode = (): "system" | "module" | "both" => {
    const hasSystem = !!oldSystemId;
    const hasModule = !!oldModuleId;
    
    if (hasSystem && hasModule) return "both";
    if (hasModule) return "module";
    return "system"; // Default to system if neither or only system
  };
  
  const displayMode = getDisplayMode();
  
  // Dynamic step label based on what data is present
  const getCanChangeLabel = (): string => {
    switch (displayMode) {
      case "module": return "Can The Changeout Proceed?";
      case "both": return "Can The Changeout Proceed?";
      default: return "Can The Changeout Proceed?";
    }
  };

  const currentSteps = data.canChange ? successSteps : troubleSteps;
  const currentStepIndex = currentSteps.indexOf(currentStep);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === currentSteps.length - 1;

  // Reset photo capture state when user returns to page (handles camera cancel on mobile)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isCapturingPhoto) {
        // Give a brief delay to allow onChange to fire if a photo was taken
        setTimeout(() => {
          setIsCapturingPhoto(false);
          captureSessionActive.current = false;
        }, 500);
      }
    };

    // Handle cancel event on file input (modern browsers)
    const handleCancel = () => {
      setTimeout(() => {
        setIsCapturingPhoto(false);
        captureSessionActive.current = false;
      }, 100);
    };

    // Handle window focus regain (desktop fallback for file picker cancel)
    const handleWindowFocus = () => {
      if (isCapturingPhoto) {
        // Give a brief delay to allow onChange to fire if a file was selected
        setTimeout(() => {
          setIsCapturingPhoto(false);
          captureSessionActive.current = false;
        }, 500);
      }
    };

    const fileInput = fileInputRef.current;
    if (fileInput) {
      fileInput.addEventListener('cancel', handleCancel);
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      if (fileInput) {
        fileInput.removeEventListener('cancel', handleCancel);
      }
    };
  }, [isCapturingPhoto]);

  const resetWizard = useCallback(() => {
    setCurrentStep("canChange");
    setData({
      canChange: true,
      troubleCode: null,
      troubleNote: "",
      troublePhotos: [],
      oldSystemReading: existingOldReading || "",
      oldModuleReading: existingOldModuleReading || "",
      beforePhotos: [],
      newSystemId: "",
      newSystemReading: existingNewReading || "",
      newModuleId: "",
      newModuleReading: existingNewModuleReading || "",
      afterPhotos: [],
      gpsCoordinates: existingGps || "",
      completionNotes: "",
      signatureData: null,
      signatureName: "",
    });
    setCaptureOldSystemReading(!existingOldReading);
    setCaptureOldModuleReading(!existingOldModuleReading);
    data.troublePhotos.forEach((p) => URL.revokeObjectURL(p.preview));
    data.beforePhotos.forEach((p) => URL.revokeObjectURL(p.preview));
    data.afterPhotos.forEach((p) => URL.revokeObjectURL(p.preview));
  }, [existingOldReading, existingNewReading, existingOldModuleReading, existingNewModuleReading, existingGps]);

  const handleClose = () => {
    resetWizard();
    onClose();
  };

  // Validation helpers
  const isValidSystemReading = (reading: string | undefined | null): boolean => {
    // Must be digits only (allows leading zeros like "0001")
    if (!reading || typeof reading !== 'string') return false;
    const trimmed = reading.trim();
    return trimmed.length > 0 && /^\d+$/.test(trimmed);
  };

  const isValidGps = (gps: string | undefined | null): boolean => {
    // Validate GPS format: lat,lng where lat is -90 to 90 and lng is -180 to 180
    if (!gps || typeof gps !== 'string') return false;
    const trimmed = gps.trim();
    if (!trimmed) return false;
    
    const match = trimmed.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (!match) return false;
    
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    
    return !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  };

  const getSystemReadingError = (reading: string | undefined | null): string | null => {
    if (!reading || typeof reading !== 'string' || !reading.trim()) return "Reading is required";
    if (!/^\d+$/.test(reading.trim())) return "Reading must contain only digits (0-9)";
    return null;
  };

  const getGpsError = (gps: string | undefined | null): string | null => {
    if (!gps || typeof gps !== 'string' || !gps.trim()) return "GPS coordinates are required";
    const trimmed = gps.trim();
    const match = trimmed.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (!match) return "Invalid format. Use: latitude,longitude (e.g., 37.7749,-122.4194)";
    
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    
    if (isNaN(lat) || lat < -90 || lat > 90) return "Latitude must be between -90 and 90";
    if (isNaN(lng) || lng < -180 || lng > 180) return "Longitude must be between -180 and 180";
    return null;
  };

  const canProceed = (): boolean => {
    switch (currentStep) {
      case "canChange":
        return true;
      case "troubleCapture":
        return !!data.troubleCode && data.troublePhotos.length >= 1;
      case "oldReading": {
        // Validate based on scope and capture toggles
        const needsSystemReading = (displayMode === "system" || displayMode === "both");
        const needsModuleReading = (displayMode === "module" || displayMode === "both");
        
        const systemReadingValid = !needsSystemReading || 
          (!captureOldSystemReading && !!existingOldReading) || 
          isValidSystemReading(data.oldSystemReading);
        
        const moduleReadingValid = !needsModuleReading || 
          (!captureOldModuleReading && !!existingOldModuleReading) || 
          isValidSystemReading(data.oldModuleReading);
        
        return systemReadingValid && moduleReadingValid;
      }
      case "beforePhotos":
        return data.beforePhotos.length >= 1;
      case "physicalChange":
        return true;
      case "newSystemId": {
        // Validate based on scope
        const needsNewSystemId = (displayMode === "system" || displayMode === "both");
        const needsNewModuleId = (displayMode === "module" || displayMode === "both");
        
        const systemIdValid = !needsNewSystemId || !!data.newSystemId.trim();
        const moduleIdValid = !needsNewModuleId || !!data.newModuleId.trim();
        
        return systemIdValid && moduleIdValid;
      }
      case "newReading": {
        // Validate based on scope
        const needsNewSystemReading = (displayMode === "system" || displayMode === "both");
        const needsNewModuleReading = (displayMode === "module" || displayMode === "both");
        
        const systemReadingValid = !needsNewSystemReading || isValidSystemReading(data.newSystemReading);
        const moduleReadingValid = !needsNewModuleReading || isValidSystemReading(data.newModuleReading);
        
        return systemReadingValid && moduleReadingValid;
      }
      case "afterPhotos":
        return data.afterPhotos.length >= 1;
      case "gps":
        return isValidGps(data.gpsCoordinates);
      case "notes":
        return true; // Notes are optional
      case "signature":
        return !!data.signatureName.trim();
      case "confirm": {
        // Final validation: check all required fields based on path and scope
        if (data.canChange) {
          const needsSystemData = (displayMode === "system" || displayMode === "both");
          const needsModuleData = (displayMode === "module" || displayMode === "both");
          
          // System validations
          const oldSystemReadingValid = !needsSystemData || 
            (!captureOldSystemReading && !!existingOldReading) || 
            isValidSystemReading(data.oldSystemReading);
          const newSystemIdValid = !needsSystemData || !!data.newSystemId.trim();
          const newSystemReadingValid = !needsSystemData || isValidSystemReading(data.newSystemReading);
          
          // Module validations
          const oldModuleReadingValid = !needsModuleData || 
            (!captureOldModuleReading && !!existingOldModuleReading) || 
            isValidSystemReading(data.oldModuleReading);
          const newModuleIdValid = !needsModuleData || !!data.newModuleId.trim();
          const newModuleReadingValid = !needsModuleData || isValidSystemReading(data.newModuleReading);
          
          return (
            oldSystemReadingValid &&
            newSystemIdValid &&
            newSystemReadingValid &&
            oldModuleReadingValid &&
            newModuleIdValid &&
            newModuleReadingValid &&
            data.beforePhotos.length >= 1 &&
            data.afterPhotos.length >= 1 &&
            isValidGps(data.gpsCoordinates) &&
            !!data.signatureName.trim()
          );
        } else {
          // Trouble path requires: trouble code, trouble photos
          return !!data.troubleCode && data.troublePhotos.length >= 1;
        }
      }
      default:
        return false;
    }
  };

  const goNext = () => {
    if (!canProceed()) {
      toast({
        title: "Required Information",
        description: "Please complete all required fields before proceeding.",
        variant: "destructive",
      });
      return;
    }

    if (currentStep === "canChange" && !data.canChange) {
      setCurrentStep("troubleCapture");
      return;
    }

    const nextIndex = currentStepIndex + 1;
    if (nextIndex < currentSteps.length) {
      setCurrentStep(currentSteps[nextIndex]);
    }
  };

  const goBack = () => {
    if (currentStep === "troubleCapture") {
      setCurrentStep("canChange");
      return;
    }

    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(currentSteps[prevIndex]);
    }
  };

  const handleCanChangeChoice = (canChange: boolean) => {
    setData((prev) => ({ ...prev, canChange }));
    if (canChange) {
      setCurrentStep("oldReading");
    } else {
      setCurrentStep("troubleCapture");
    }
  };

  const handlePhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsCapturingPhoto(false);
    const files = e.target.files;
    
    if (!files || files.length === 0) {
      setTimeout(() => {
        captureSessionActive.current = false;
      }, 500);
      return;
    }

    const newPhotos: CapturedPhoto[] = [];
    Array.from(files).forEach((file) => {
      const preview = URL.createObjectURL(file);
      newPhotos.push({ file, preview, type: photoType });
    });

    setData((prev) => {
      if (photoType === "trouble") {
        return { ...prev, troublePhotos: [...prev.troublePhotos, ...newPhotos] };
      } else if (photoType === "before") {
        return { ...prev, beforePhotos: [...prev.beforePhotos, ...newPhotos] };
      } else {
        return { ...prev, afterPhotos: [...prev.afterPhotos, ...newPhotos] };
      }
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    
    setTimeout(() => {
      captureSessionActive.current = false;
    }, 500);
  };

  const removePhoto = (type: "trouble" | "before" | "after", index: number) => {
    setData((prev) => {
      const photos = type === "trouble" ? prev.troublePhotos : type === "before" ? prev.beforePhotos : prev.afterPhotos;
      const photo = photos[index];
      if (photo) {
        URL.revokeObjectURL(photo.preview);
      }
      const newPhotos = photos.filter((_, i) => i !== index);
      if (type === "trouble") {
        return { ...prev, troublePhotos: newPhotos };
      } else if (type === "before") {
        return { ...prev, beforePhotos: newPhotos };
      } else {
        return { ...prev, afterPhotos: newPhotos };
      }
    });
  };

  const openCamera = (type: "trouble" | "before" | "after") => {
    setPhotoType(type);
    setIsCapturingPhoto(true);
    captureSessionActive.current = true;
    fileInputRef.current?.click();
  };

  const handleSignatureChange = (signatureData: string | null, signatureName: string) => {
    setData((prev) => ({ ...prev, signatureData, signatureName }));
  };

  const handleSubmit = async () => {
    if (!canProceed()) {
      toast({
        title: "Incomplete Data",
        description: "Please complete all required fields.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      await onComplete(data);
      toast({
        title: "Success",
        description: data.canChange 
          ? "System changeout completed successfully!" 
          : "Trouble report submitted successfully!",
      });
      handleClose();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to submit. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const scannerInstanceRef = useRef<Html5Qrcode | null>(null);
  const captureTargetRef = useRef<"system" | "module">("system");
  const scannerBusyRef = useRef<boolean>(false);

  const startScanner = useCallback(async (mode: "barcode" | "qr", captureTarget: "system" | "module") => {
    // Prevent concurrent scanner operations
    if (scannerBusyRef.current) {
      console.log("Scanner busy, ignoring start request");
      return;
    }
    scannerBusyRef.current = true;
    
    // Track which field we're capturing for this scan session
    captureTargetRef.current = captureTarget;
    try {
      // Clean up any existing scanner - wait for it to fully stop
      if (scannerInstanceRef.current) {
        try {
          await scannerInstanceRef.current.stop();
        } catch {
          // Ignore stop errors
        }
        scannerInstanceRef.current = null;
      }

      const html5QrCode = new Html5Qrcode("qr-reader");
      scannerInstanceRef.current = html5QrCode;

      // Configure supported formats based on scan mode
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
      
      const qrFormats = [
        Html5QrcodeSupportedFormats.QR_CODE,
        Html5QrcodeSupportedFormats.DATA_MATRIX,
      ];

      const formatsToSupport = mode === "qr" ? qrFormats : barcodeFormats;
      
      const config = {
        fps: 10,
        qrbox: mode === "qr" ? { width: 200, height: 200 } : { width: 280, height: 100 },
        aspectRatio: 1.0,
        formatsToSupport,
      };

      await html5QrCode.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          // Use the ref to determine which field to set - this is set when scanner starts
          const target = captureTargetRef.current;
          
          if (target === "system") {
            setData((prev) => ({ ...prev, newSystemId: decodedText }));
          } else {
            setData((prev) => ({ ...prev, newModuleId: decodedText }));
          }
          
          const fieldLabel = target === "system" ? "System" : "Module";
          
          setIsScanning(false);
          setSystemIdInputMode(null);
          html5QrCode.stop().catch(() => {}).finally(() => {
            scannerBusyRef.current = false;
          });
          scannerInstanceRef.current = null;
          toast({
            title: "Scanned Successfully",
            description: `${fieldLabel} ID: ${decodedText}`,
          });
        },
        () => {
          // QR code not found - this is called continuously, ignore
        }
      );
    } catch (error: any) {
      console.error("Scanner error:", error);
      setIsScanning(false);
      scannerBusyRef.current = false;
      toast({
        title: "Camera Error",
        description: error.message || "Could not access camera. Try manual entry instead.",
        variant: "destructive",
      });
      setSystemIdInputMode(null);
    }
  }, [toast]);

  // Clean up scanner when mode changes or component unmounts
  useEffect(() => {
    return () => {
      if (scannerInstanceRef.current) {
        scannerInstanceRef.current.stop().catch(() => {}).finally(() => {
          scannerBusyRef.current = false;
        });
        scannerInstanceRef.current = null;
      }
    };
  }, []);

  // Stop scanner when leaving the newSystemId step or changing mode
  useEffect(() => {
    if (currentStep !== "newSystemId" || (!systemIdInputMode || systemIdInputMode === "manual" || systemIdInputMode === "choose")) {
      if (scannerInstanceRef.current) {
        scannerInstanceRef.current.stop().catch(() => {}).finally(() => {
          scannerBusyRef.current = false;
        });
        scannerInstanceRef.current = null;
        setIsScanning(false);
      }
    }
  }, [currentStep, systemIdInputMode]);

  const renderStepIndicator = () => {
    return (
      <div className="flex items-center justify-center gap-1 mb-4">
        {currentSteps.map((step, index) => (
          <div
            key={step}
            className={`h-2 rounded-full transition-all ${
              index === currentStepIndex
                ? "w-8 bg-primary"
                : index < currentStepIndex
                ? "w-2 bg-primary/60"
                : "w-2 bg-muted"
            }`}
          />
        ))}
      </div>
    );
  };

  const renderPhotoGrid = (photos: CapturedPhoto[], type: "trouble" | "before" | "after") => {
    return (
      <div className="grid grid-cols-3 gap-2 mt-3">
        {photos.map((photo, index) => (
          <div 
            key={index} 
            className="relative aspect-square rounded-md overflow-hidden border cursor-pointer hover-elevate"
            onClick={() => setPreviewPhoto({ photo, type, index })}
            data-testid={`photo-thumbnail-${type}-${index}`}
          >
            <img
              src={photo.preview}
              alt={`${type} photo ${index + 1}`}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-100 bg-black/30 transition-opacity">
              <ZoomIn className="h-6 w-6 text-white" />
            </div>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute top-1 right-1"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                removePhoto(type, index);
              }}
              data-testid={`button-remove-${type}-photo-${index}`}
            >
              <X className="h-4 w-4" />
            </Button>
            <Badge className="absolute bottom-1 left-1 text-xs" variant="secondary">
              {index + 1}
            </Badge>
          </div>
        ))}
      </div>
    );
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case "canChange": {
        const isTrouble = status?.toLowerCase() === "trouble";
        const getTroubleCodeLabel = (code: string | null | undefined): string | null => {
          if (!code) return null;
          const troubleCode = troubleCodes.find(tc => tc.code.toLowerCase() === code.toLowerCase());
          return troubleCode ? troubleCode.label : null;
        };
        
        // Dynamic question text based on scope
        const getQuestionText = () => {
          switch (displayMode) {
            case "module": return "Can this module be changed today?";
            case "both": return "Can the system and module be changed today?";
            default: return "Can this system be changed today?";
          }
        };
        
        return (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Work Order</p>
                    <p className="font-medium break-all" data-testid="text-wizard-wo-id">
                      {customerWoId}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <MapPin className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Address</p>
                    <p className="font-medium break-all" data-testid="text-wizard-address">
                      {address || "No address"}
                    </p>
                  </div>
                </div>

                {/* Show System ID for system or both modes */}
                {(displayMode === "system" || displayMode === "both") && (
                  <div className="flex items-start gap-3">
                    <Gauge className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">Old System ID</p>
                      <p className="font-medium break-all" data-testid="text-wizard-system-id">
                        {oldSystemId || "N/A"}
                      </p>
                    </div>
                  </div>
                )}
                
                {/* Show Module ID for module or both modes */}
                {(displayMode === "module" || displayMode === "both") && (
                  <div className="flex items-start gap-3">
                    <Wrench className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">Old Module ID</p>
                      <p className="font-medium break-all" data-testid="text-wizard-module-id">
                        {oldModuleId || "N/A"}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3">
                  <ClipboardCheck className={`h-5 w-5 mt-0.5 shrink-0 ${isTrouble ? "text-amber-500" : "text-muted-foreground"}`} />
                  <div className="min-w-0">
                    <p className="text-sm text-muted-foreground">Status</p>
                    <p className={`font-medium ${isTrouble ? "text-amber-500" : ""}`} data-testid="text-wizard-status">
                      {status || "Unknown"}
                      {isTrouble && trouble && (
                        <span className="ml-2 text-sm" data-testid="text-wizard-trouble-code">
                          ({trouble}{getTroubleCodeLabel(trouble) ? ` - ${getTroubleCodeLabel(trouble)}` : ""})
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {notes && (
                  <div className="flex items-start gap-3">
                    <StickyNote className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-muted-foreground">Notes</p>
                      <p className="font-medium break-all" data-testid="text-wizard-notes">
                        {notes}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <p className="text-center text-muted-foreground">
              {getQuestionText()}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Button
                type="button"
                variant="outline"
                className="h-24 flex flex-col gap-2"
                onClick={() => handleCanChangeChoice(false)}
                data-testid="button-system-cannot-change"
              >
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <span>No - Report Issue</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-24 flex flex-col gap-2"
                onClick={() => handleCanChangeChoice(true)}
                data-testid="button-system-can-change"
              >
                <Check className="h-8 w-8 text-green-600" />
                <span>Yes - Proceed</span>
              </Button>
            </div>
          </div>
        );
      }

      case "troubleCapture":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Trouble Code *</Label>
              <Select
                value={data.troubleCode || ""}
                onValueChange={(value) => setData((prev) => ({ ...prev, troubleCode: value }))}
              >
                <SelectTrigger data-testid="select-trouble-code">
                  <SelectValue placeholder="Select trouble code..." />
                </SelectTrigger>
                <SelectContent>
                  {troubleCodes.map((tc) => (
                    <SelectItem key={tc.id} value={tc.code}>
                      {tc.code} - {tc.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Take Photo(s) * (at least 1 required)</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => openCamera("trouble")}
                data-testid="button-capture-trouble-photo"
              >
                <Camera className="h-4 w-4 mr-2" />
                Take Photo ({data.troublePhotos.length} captured)
              </Button>
              {data.troublePhotos.length > 0 && renderPhotoGrid(data.troublePhotos, "trouble")}
            </div>

            <div className="space-y-2">
              <Label>Note (optional)</Label>
              <Textarea
                value={data.troubleNote}
                onChange={(e) => setData((prev) => ({ ...prev, troubleNote: e.target.value }))}
                placeholder="Additional notes about the issue..."
                rows={3}
                data-testid="input-trouble-note"
              />
            </div>
          </div>
        );

      case "oldReading": {
        const oldSystemReadingError = getSystemReadingError(data.oldSystemReading);
        const oldModuleReadingError = getSystemReadingError(data.oldModuleReading);
        
        // Determine description text based on scope
        const getReadingDescription = () => {
          switch (displayMode) {
            case "module": return "Record the final reading from the old module before removal.";
            case "both": return "Record the final readings from the old system and module before removal.";
            default: return "Record the final reading from the old system before removal.";
          }
        };
        
        // Check if we should show system reading
        const showSystemReading = displayMode === "system" || displayMode === "both";
        // Check if we should show module reading
        const showModuleReading = displayMode === "module" || displayMode === "both";
        
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <Wrench className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                {getReadingDescription()}
              </p>
            </div>
            
            {/* Old System Reading Section */}
            {showSystemReading && (
              <div className="space-y-2">
                {existingOldReading && (
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Capture new old system reading?</Label>
                    <Switch
                      checked={captureOldSystemReading}
                      onCheckedChange={setCaptureOldSystemReading}
                      data-testid="switch-capture-old-system-reading"
                    />
                  </div>
                )}
                {(captureOldSystemReading || !existingOldReading) && (
                  <>
                    <Label>Old System Final Reading *</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={data.oldSystemReading}
                      onChange={(e) => setData((prev) => ({ ...prev, oldSystemReading: e.target.value }))}
                      placeholder="Enter system reading (digits only)..."
                      className={`text-lg text-center ${oldSystemReadingError && data.oldSystemReading ? "border-destructive" : ""}`}
                      data-testid="input-old-system-reading"
                    />
                    {oldSystemReadingError && data.oldSystemReading && (
                      <p className="text-sm text-destructive">{oldSystemReadingError}</p>
                    )}
                    <p className="text-xs text-muted-foreground">Enter digits only. Leading zeros are preserved (e.g., 0001).</p>
                  </>
                )}
                {!captureOldSystemReading && existingOldReading && (
                  <Card className="bg-muted/50">
                    <CardContent className="pt-4">
                      <p className="text-sm text-muted-foreground">Current reading:</p>
                      <p className="font-medium">{existingOldReading}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
            
            {/* Old Module Reading Section */}
            {showModuleReading && (
              <div className="space-y-2">
                {existingOldModuleReading && (
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Capture new old module reading?</Label>
                    <Switch
                      checked={captureOldModuleReading}
                      onCheckedChange={setCaptureOldModuleReading}
                      data-testid="switch-capture-old-module-reading"
                    />
                  </div>
                )}
                {(captureOldModuleReading || !existingOldModuleReading) && (
                  <>
                    <Label>Old Module Final Reading *</Label>
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={data.oldModuleReading}
                      onChange={(e) => setData((prev) => ({ ...prev, oldModuleReading: e.target.value }))}
                      placeholder="Enter module reading (digits only)..."
                      className={`text-lg text-center ${oldModuleReadingError && data.oldModuleReading ? "border-destructive" : ""}`}
                      data-testid="input-old-module-reading"
                    />
                    {oldModuleReadingError && data.oldModuleReading && (
                      <p className="text-sm text-destructive">{oldModuleReadingError}</p>
                    )}
                    <p className="text-xs text-muted-foreground">Enter digits only. Leading zeros are preserved (e.g., 0001).</p>
                  </>
                )}
                {!captureOldModuleReading && existingOldModuleReading && (
                  <Card className="bg-muted/50">
                    <CardContent className="pt-4">
                      <p className="text-sm text-muted-foreground">Current reading:</p>
                      <p className="font-medium">{existingOldModuleReading}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}

            {/* Show type verification cards */}
            {showSystemReading && oldSystemType && (
              <Card className="bg-muted/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Gauge className="h-4 w-4" />
                    Verify Old System Type
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm" data-testid="text-verify-old-system-type">{oldSystemType}</p>
                </CardContent>
              </Card>
            )}
            
            {showModuleReading && oldModuleType && (
              <Card className="bg-muted/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Wrench className="h-4 w-4" />
                    Verify Old Module Type
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm" data-testid="text-verify-old-module-type">{oldModuleType}</p>
                </CardContent>
              </Card>
            )}
          </div>
        );
      }

      case "beforePhotos":
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                Take at least one photo of the system BEFORE the changeout.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full h-16"
              onClick={() => openCamera("before")}
              data-testid="button-capture-before-photo"
            >
              <Camera className="h-5 w-5 mr-2" />
              Take Before Photo ({data.beforePhotos.length} captured)
            </Button>
            {data.beforePhotos.length > 0 && renderPhotoGrid(data.beforePhotos, "before")}
            {data.beforePhotos.length === 0 && (
              <p className="text-sm text-destructive text-center">* At least 1 photo required</p>
            )}
          </div>
        );

      case "physicalChange": {
        // Dynamic title and content based on scope
        const getChangeoutTitle = () => {
          switch (displayMode) {
            case "module": return "Perform Physical Module Changeout";
            case "both": return "Perform Physical Changeout";
            default: return "Perform Physical Changeout";
          }
        };
        
        const getChangeoutDescription = () => {
          switch (displayMode) {
            case "module": return "Safely remove the old module and install the new module. When complete, click Next to continue.";
            case "both": return "Safely remove the old system and module, then install the new ones. When complete, click Next to continue.";
            default: return "Safely remove the old system and install the new system. When complete, click Next to continue.";
          }
        };
        
        return (
          <div className="space-y-4 text-center">
            <Wrench className="h-16 w-16 mx-auto text-primary" />
            <h3 className="text-lg font-semibold">{getChangeoutTitle()}</h3>
            <p className="text-muted-foreground">
              {getChangeoutDescription()}
            </p>
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <ul className="text-left text-sm space-y-2">
                  {(displayMode === "system" || displayMode === "both") && data.oldSystemReading && (
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600" />
                      Old system reading recorded: {data.oldSystemReading}
                    </li>
                  )}
                  {(displayMode === "module" || displayMode === "both") && data.oldModuleReading && (
                    <li className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-600" />
                      Old module reading recorded: {data.oldModuleReading}
                    </li>
                  )}
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600" />
                    Before photos captured: {data.beforePhotos.length}
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        );
      }

      case "newSystemId": {
        const showNewSystemId = displayMode === "system" || displayMode === "both";
        const showNewModuleId = displayMode === "module" || displayMode === "both";
        
        // Determine dynamic description
        const getNewIdDescription = () => {
          switch (displayMode) {
            case "module": return "Capture the new module ID by scanning or entering manually.";
            case "both": return "Capture the new system and module IDs by scanning or entering manually.";
            default: return "Capture the new system ID by scanning or entering manually.";
          }
        };
        
        // Check if both IDs are captured (for "both" mode)
        const systemIdCaptured = !showNewSystemId || !!data.newSystemId;
        const moduleIdCaptured = !showNewModuleId || !!data.newModuleId;
        const allCaptured = systemIdCaptured && moduleIdCaptured;
        
        // Determine which field to focus on
        const capturingSystem = showNewSystemId && !data.newSystemId;
        const capturingModule = showNewModuleId && !data.newModuleId && (!showNewSystemId || data.newSystemId);
        
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <ScanBarcode className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                {getNewIdDescription()}
              </p>
            </div>
            
            {/* Show captured IDs */}
            {data.newSystemId && showNewSystemId && (
              <Card className="bg-muted/50">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Label className="text-xs text-muted-foreground">New System ID</Label>
                      <p className="text-lg font-medium break-all" data-testid="text-new-system-id">{data.newSystemId}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setData((prev) => ({ ...prev, newSystemId: "" }));
                        setSystemIdInputMode(null);
                      }}
                      data-testid="button-clear-system-id"
                    >
                      Clear
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {data.newModuleId && showNewModuleId && (
              <Card className="bg-muted/50">
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Label className="text-xs text-muted-foreground">New Module ID</Label>
                      <p className="text-lg font-medium break-all" data-testid="text-new-module-id">{data.newModuleId}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setData((prev) => ({ ...prev, newModuleId: "" }));
                        setSystemIdInputMode(null);
                      }}
                      data-testid="button-clear-module-id"
                    >
                      Clear
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            
            {/* Show input controls when not all IDs are captured */}
            {!allCaptured && (
              <>
                {capturingSystem && (
                  <div className="p-2 bg-primary/10 rounded-md text-center text-sm font-medium">
                    Capturing: New System ID
                  </div>
                )}
                {capturingModule && (
                  <div className="p-2 bg-primary/10 rounded-md text-center text-sm font-medium">
                    Capturing: New Module ID
                  </div>
                )}
                
                {systemIdInputMode === "barcode" || systemIdInputMode === "qr" ? (
                  <div className="space-y-4">
                    <div 
                      ref={scannerRef} 
                      id="qr-reader" 
                      className="w-full rounded-md overflow-hidden"
                      style={{ minHeight: "250px" }}
                    />
                    {isScanning && (
                      <div className="flex items-center justify-center gap-2 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Scanning for {systemIdInputMode === "qr" ? "QR code" : "barcode"}...</span>
                      </div>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setSystemIdInputMode(null);
                        setIsScanning(false);
                        scannerBusyRef.current = false;
                      }}
                      data-testid="button-cancel-scan"
                    >
                      <ArrowLeft className="h-4 w-4 mr-2" />
                      Back to Options
                    </Button>
                  </div>
                    ) : systemIdInputMode === "manual" ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Enter New {capturingSystem ? "System" : "Module"} ID *</Label>
                      <Input
                        type="text"
                        placeholder={`Type or paste ${capturingSystem ? "system" : "module"} ID...`}
                        className="text-lg"
                        autoFocus
                        value={manualSystemIdInput}
                        onChange={(e) => setManualSystemIdInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const input = manualSystemIdInput.trim();
                            if (input) {
                              if (capturingSystem) {
                                setData((prev) => ({ ...prev, newSystemId: input }));
                              } else {
                                setData((prev) => ({ ...prev, newModuleId: input }));
                              }
                              setManualSystemIdInput("");
                              setSystemIdInputMode(null);
                            }
                          }
                        }}
                        data-testid={capturingSystem ? "input-new-system-id" : "input-new-module-id"}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setSystemIdInputMode(null);
                          setManualSystemIdInput("");
                        }}
                        data-testid="button-cancel-manual"
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        className="flex-1"
                        onClick={() => {
                          const input = manualSystemIdInput.trim();
                          if (input) {
                            if (capturingSystem) {
                              setData((prev) => ({ ...prev, newSystemId: input }));
                            } else {
                              setData((prev) => ({ ...prev, newModuleId: input }));
                            }
                            setManualSystemIdInput("");
                            setSystemIdInputMode(null);
                          } else {
                            toast({
                              title: "Required",
                              description: `Please enter a ${capturingSystem ? "system" : "module"} ID`,
                              variant: "destructive",
                            });
                          }
                        }}
                        data-testid={capturingSystem ? "button-confirm-system-id" : "button-confirm-module-id"}
                      >
                        <Check className="h-4 w-4 mr-2" />
                        Confirm
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-16 flex items-center justify-center gap-3"
                      onClick={() => {
                        const target = capturingSystem ? "system" : "module";
                        setSystemIdInputMode("barcode");
                        setIsScanning(true);
                        setTimeout(() => {
                          startScanner("barcode", target);
                        }, 100);
                      }}
                      data-testid="button-scan-barcode"
                    >
                      <ScanBarcode className="h-6 w-6" />
                      <span>Scan Barcode</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-16 flex items-center justify-center gap-3"
                      onClick={() => {
                        const target = capturingSystem ? "system" : "module";
                        setSystemIdInputMode("qr");
                        setIsScanning(true);
                        setTimeout(() => {
                          startScanner("qr", target);
                        }, 100);
                      }}
                      data-testid="button-scan-qr"
                    >
                      <QrCode className="h-6 w-6" />
                      <span>Scan QR Code</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-16 flex items-center justify-center gap-3"
                      onClick={() => setSystemIdInputMode("manual")}
                      data-testid="button-enter-manual"
                    >
                      <Keyboard className="h-6 w-6" />
                      <span>Enter Manually</span>
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      }


      case "newReading": {
        const showNewSystemReading = displayMode === "system" || displayMode === "both";
        const showNewModuleReading = displayMode === "module" || displayMode === "both";
        const newSystemReadingError = getSystemReadingError(data.newSystemReading);
        const newModuleReadingError = getSystemReadingError(data.newModuleReading || "");
        
        const getNewReadingDescription = () => {
          switch (displayMode) {
            case "module": return "Record the initial reading from the new module.";
            case "both": return "Record the initial readings from the new system and module.";
            default: return "Record the initial reading from the new system.";
          }
        };
        
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <Wrench className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                {getNewReadingDescription()}
              </p>
            </div>
            
            {/* New System Reading */}
            {showNewSystemReading && (
              <div className="space-y-2">
                <Label>New System Initial Reading *</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={data.newSystemReading}
                  onChange={(e) => setData((prev) => ({ ...prev, newSystemReading: e.target.value }))}
                  placeholder="Enter system reading (digits only)..."
                  className={`text-lg text-center ${newSystemReadingError && data.newSystemReading ? "border-destructive" : ""}`}
                  data-testid="input-new-system-reading"
                />
                {newSystemReadingError && data.newSystemReading && (
                  <p className="text-sm text-destructive">{newSystemReadingError}</p>
                )}
                <p className="text-xs text-muted-foreground">Enter digits only. Leading zeros are preserved (e.g., 0001).</p>
              </div>
            )}
            
            {/* New Module Reading */}
            {showNewModuleReading && (
              <div className="space-y-2">
                <Label>New Module Initial Reading *</Label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={data.newModuleReading || ""}
                  onChange={(e) => setData((prev) => ({ ...prev, newModuleReading: e.target.value }))}
                  placeholder="Enter module reading (digits only)..."
                  className={`text-lg text-center ${newModuleReadingError && data.newModuleReading ? "border-destructive" : ""}`}
                  data-testid="input-new-module-reading"
                />
                {newModuleReadingError && data.newModuleReading && (
                  <p className="text-sm text-destructive">{newModuleReadingError}</p>
                )}
                <p className="text-xs text-muted-foreground">Enter digits only. Leading zeros are preserved (e.g., 0001).</p>
              </div>
            )}

            {newSystemType && showNewSystemReading && (
              <Card className="bg-muted/50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Gauge className="h-4 w-4" />
                    Verify New System Type
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm" data-testid="text-verify-new-system-type">{newSystemType}</p>
                </CardContent>
              </Card>
            )}
          </div>
        );
      }

      case "afterPhotos":
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                Take at least one photo of the system AFTER the changeout.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full h-16"
              onClick={() => openCamera("after")}
              data-testid="button-capture-after-photo"
            >
              <Camera className="h-5 w-5 mr-2" />
              Take After Photo ({data.afterPhotos.length} captured)
            </Button>
            {data.afterPhotos.length > 0 && renderPhotoGrid(data.afterPhotos, "after")}
            {data.afterPhotos.length === 0 && (
              <p className="text-sm text-destructive text-center">* At least 1 photo required</p>
            )}
          </div>
        );

      case "gps": {
        const gpsError = getGpsError(data.gpsCoordinates);
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <MapPin className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                Capture the GPS coordinates of this location.
              </p>
            </div>
            <div className="space-y-2">
              <Label>GPS Coordinates *</Label>
              <GPSCapture
                value={data.gpsCoordinates}
                onChange={(value) => setData((prev) => ({ ...prev, gpsCoordinates: value }))}
                data-testid="input-gps-coordinates"
              />
              {gpsError && data.gpsCoordinates && (
                <p className="text-sm text-destructive">{gpsError}</p>
              )}
              <p className="text-xs text-muted-foreground">Format: latitude,longitude (e.g., 37.7749,-122.4194)</p>
            </div>
          </div>
        );
      }

      case "notes":
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <StickyNote className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                Add any additional notes about this changeout (optional).
              </p>
            </div>
            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Textarea
                value={data.completionNotes}
                onChange={(e) => setData((prev) => ({ ...prev, completionNotes: e.target.value }))}
                placeholder="Enter any additional notes or observations..."
                rows={4}
                data-testid="input-completion-notes"
              />
              <p className="text-xs text-muted-foreground">
                You can skip this step if you have no additional notes to add.
              </p>
            </div>
          </div>
        );

      case "signature":
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <Pen className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                Capture signature and printed name for proof of service.
              </p>
            </div>
            <SignaturePad
              ref={signaturePadRef}
              initialSignatureData={data.signatureData}
              initialSignatureName={data.signatureName}
              onSignatureChange={handleSignatureChange}
            />
          </div>
        );

      case "confirm":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-center">
              {data.canChange ? "Confirm System Changeout" : "Confirm Trouble Report"}
            </h3>
            
            {data.canChange ? (
              <Card>
                <CardContent className="pt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-muted-foreground">Work Order:</span>
                    <span className="font-medium">{customerWoId}</span>
                    
                    <span className="text-muted-foreground">Address:</span>
                    <span className="font-medium">{address || "-"}</span>
                    
                    <span className="text-muted-foreground">Old System ID:</span>
                    <span className="font-medium">{oldSystemId || "-"}</span>
                    
                    <span className="text-muted-foreground">Old Reading:</span>
                    <span className="font-medium">{data.oldSystemReading}</span>
                    
                    <span className="text-muted-foreground">New System ID:</span>
                    <span className="font-medium">{data.newSystemId}</span>
                    
                    <span className="text-muted-foreground">New Reading:</span>
                    <span className="font-medium">{data.newSystemReading}</span>
                    
                    <span className="text-muted-foreground">GPS:</span>
                    <span className="font-medium">{data.gpsCoordinates}</span>
                    
                    <span className="text-muted-foreground">Before Photos:</span>
                    <span className="font-medium">{data.beforePhotos.length}</span>
                    
                    <span className="text-muted-foreground">After Photos:</span>
                    <span className="font-medium">{data.afterPhotos.length}</span>
                    
                    {data.completionNotes && (
                      <>
                        <span className="text-muted-foreground">Notes:</span>
                        <span className="font-medium">{data.completionNotes}</span>
                      </>
                    )}
                    
                    <span className="text-muted-foreground">Signed By:</span>
                    <span className="font-medium">{data.signatureName}</span>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="pt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-muted-foreground">Work Order:</span>
                    <span className="font-medium">{customerWoId}</span>
                    
                    <span className="text-muted-foreground">Trouble Code:</span>
                    <span className="font-medium">{data.troubleCode}</span>
                    
                    <span className="text-muted-foreground">Photos:</span>
                    <span className="font-medium">{data.troublePhotos.length}</span>
                    
                    {data.troubleNote && (
                      <>
                        <span className="text-muted-foreground">Note:</span>
                        <span className="font-medium">{data.troubleNote}</span>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
            
            <p className="text-sm text-center text-muted-foreground">
              Please review the information above. Click Submit to complete.
            </p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={(open) => {
      if (!open && !isCapturingPhoto && !captureSessionActive.current) {
        handleClose();
      }
    }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            {currentStep === "canChange" ? getCanChangeLabel() : stepLabels[currentStep]}
          </DialogTitle>
        </DialogHeader>

        {renderStepIndicator()}

        <div className="min-h-[300px]">
          {renderStepContent()}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={handlePhotoCapture}
          data-testid="input-photo-capture"
        />

        <div className="flex justify-between gap-2 pt-4 border-t">
          {!isFirstStep && currentStep !== "canChange" ? (
            <Button
              type="button"
              variant="outline"
              onClick={goBack}
              disabled={isSubmitting}
              data-testid="button-wizard-back"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isSubmitting}
              data-testid="button-wizard-cancel"
            >
              Cancel
            </Button>
          )}

          {isLastStep ? (
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !canProceed()}
              data-testid="button-wizard-submit"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Submit
                </>
              )}
            </Button>
          ) : currentStep !== "canChange" ? (
            <Button
              type="button"
              onClick={goNext}
              disabled={!canProceed()}
              data-testid="button-wizard-next"
            >
              Next
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>

    {/* Photo Preview Dialog */}
    <Dialog open={previewPhoto !== null} onOpenChange={(open) => !open && setPreviewPhoto(null)}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0 overflow-hidden">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle>
            Photo {previewPhoto ? previewPhoto.index + 1 : ""} - {previewPhoto?.type === "trouble" ? "Trouble" : previewPhoto?.type === "before" ? "Before" : "After"}
          </DialogTitle>
          <DialogDescription>
            Click delete to remove this photo and take another one.
          </DialogDescription>
        </DialogHeader>
        {previewPhoto && (
          <div className="relative">
            <img
              src={previewPhoto.photo.preview}
              alt={`${previewPhoto.type} photo preview`}
              className="w-full max-h-[60vh] object-contain"
              data-testid="image-photo-preview"
            />
          </div>
        )}
        <DialogFooter className="p-4 pt-2 gap-2">
          <Button
            variant="outline"
            onClick={() => setPreviewPhoto(null)}
            data-testid="button-preview-close"
          >
            Close
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (previewPhoto) {
                removePhoto(previewPhoto.type, previewPhoto.index);
                setPreviewPhoto(null);
              }
            }}
            data-testid="button-preview-delete"
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>
  );
}

export default SystemChangeoutWizard;
