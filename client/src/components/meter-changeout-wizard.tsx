import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";

type WizardStep =
  | "canChange"
  | "troubleCapture"
  | "oldReading"
  | "beforePhotos"
  | "physicalChange"
  | "newReading"
  | "afterPhotos"
  | "gps"
  | "signature"
  | "confirm";

interface CapturedPhoto {
  file: File;
  preview: string;
  type: "trouble" | "before" | "after";
}

interface MeterChangeoutData {
  canChange: boolean;
  troubleCode: string | null;
  troubleNote: string;
  troublePhotos: CapturedPhoto[];
  oldMeterReading: string;
  beforePhotos: CapturedPhoto[];
  newMeterReading: string;
  afterPhotos: CapturedPhoto[];
  gpsCoordinates: string;
  signatureData: string | null;
  signatureName: string;
}

interface MeterChangeoutWizardProps {
  isOpen: boolean;
  onClose: () => void;
  workOrderId: number;
  customerWoId: string;
  projectId: number;
  troubleCodes: Array<{ id: number; code: string; label: string }>;
  existingOldReading?: string | null;
  existingNewReading?: string | null;
  existingGps?: string | null;
  onComplete: (data: MeterChangeoutData) => Promise<void>;
}

const stepLabels: Record<WizardStep, string> = {
  canChange: "Can Meter Be Changed?",
  troubleCapture: "Report Issue",
  oldReading: "Old Meter Reading",
  beforePhotos: "Before Photos",
  physicalChange: "Perform Changeout",
  newReading: "New Meter Reading",
  afterPhotos: "After Photos",
  gps: "Capture GPS",
  signature: "Signature",
  confirm: "Confirm & Submit",
};

const successSteps: WizardStep[] = [
  "canChange",
  "oldReading",
  "beforePhotos",
  "physicalChange",
  "newReading",
  "afterPhotos",
  "gps",
  "signature",
  "confirm",
];

const troubleSteps: WizardStep[] = ["canChange", "troubleCapture", "confirm"];

export function MeterChangeoutWizard({
  isOpen,
  onClose,
  workOrderId,
  customerWoId,
  projectId,
  troubleCodes,
  existingOldReading,
  existingNewReading,
  existingGps,
  onComplete,
}: MeterChangeoutWizardProps) {
  const { toast } = useToast();
  const signaturePadRef = useRef<SignaturePadRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [currentStep, setCurrentStep] = useState<WizardStep>("canChange");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [photoType, setPhotoType] = useState<"trouble" | "before" | "after">("before");

  const [data, setData] = useState<MeterChangeoutData>({
    canChange: true,
    troubleCode: null,
    troubleNote: "",
    troublePhotos: [],
    oldMeterReading: existingOldReading || "",
    beforePhotos: [],
    newMeterReading: existingNewReading || "",
    afterPhotos: [],
    gpsCoordinates: existingGps || "",
    signatureData: null,
    signatureName: "",
  });

  const currentSteps = data.canChange ? successSteps : troubleSteps;
  const currentStepIndex = currentSteps.indexOf(currentStep);
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === currentSteps.length - 1;

  const resetWizard = useCallback(() => {
    setCurrentStep("canChange");
    setData({
      canChange: true,
      troubleCode: null,
      troubleNote: "",
      troublePhotos: [],
      oldMeterReading: existingOldReading || "",
      beforePhotos: [],
      newMeterReading: existingNewReading || "",
      afterPhotos: [],
      gpsCoordinates: existingGps || "",
      signatureData: null,
      signatureName: "",
    });
    data.troublePhotos.forEach((p) => URL.revokeObjectURL(p.preview));
    data.beforePhotos.forEach((p) => URL.revokeObjectURL(p.preview));
    data.afterPhotos.forEach((p) => URL.revokeObjectURL(p.preview));
  }, [existingOldReading, existingNewReading, existingGps]);

  const handleClose = () => {
    resetWizard();
    onClose();
  };

  const canProceed = (): boolean => {
    switch (currentStep) {
      case "canChange":
        return true;
      case "troubleCapture":
        return !!data.troubleCode && data.troublePhotos.length >= 1;
      case "oldReading":
        return !!data.oldMeterReading.trim();
      case "beforePhotos":
        return data.beforePhotos.length >= 1;
      case "physicalChange":
        return true;
      case "newReading":
        return !!data.newMeterReading.trim();
      case "afterPhotos":
        return data.afterPhotos.length >= 1;
      case "gps":
        return !!data.gpsCoordinates.trim();
      case "signature":
        return !!data.signatureName.trim() && (!!data.signatureData || data.signatureName.trim().length > 0);
      case "confirm":
        return true;
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
    const files = e.target.files;
    if (!files || files.length === 0) return;

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
          ? "Meter changeout completed successfully!" 
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
          <div key={index} className="relative aspect-square rounded-md overflow-hidden border">
            <img
              src={photo.preview}
              alt={`${type} photo ${index + 1}`}
              className="w-full h-full object-cover"
            />
            <Button
              type="button"
              variant="destructive"
              size="icon"
              className="absolute top-1 right-1 h-6 w-6"
              onClick={() => removePhoto(type, index)}
              data-testid={`button-remove-${type}-photo-${index}`}
            >
              <X className="h-3 w-3" />
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
      case "canChange":
        return (
          <div className="space-y-4">
            <p className="text-center text-muted-foreground">
              Can this meter be changed today?
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Button
                type="button"
                variant="outline"
                className="h-24 flex flex-col gap-2"
                onClick={() => handleCanChangeChoice(false)}
                data-testid="button-meter-cannot-change"
              >
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <span>No - Report Issue</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-24 flex flex-col gap-2"
                onClick={() => handleCanChangeChoice(true)}
                data-testid="button-meter-can-change"
              >
                <Check className="h-8 w-8 text-green-600" />
                <span>Yes - Proceed</span>
              </Button>
            </div>
          </div>
        );

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

      case "oldReading":
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <Wrench className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                Record the final reading from the old meter before removal.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Old Meter Final Reading *</Label>
              <Input
                type="text"
                value={data.oldMeterReading}
                onChange={(e) => setData((prev) => ({ ...prev, oldMeterReading: e.target.value }))}
                placeholder="Enter meter reading..."
                className="text-lg text-center"
                data-testid="input-old-meter-reading"
              />
            </div>
          </div>
        );

      case "beforePhotos":
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                Take at least one photo of the meter BEFORE the changeout.
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

      case "physicalChange":
        return (
          <div className="space-y-4 text-center">
            <Wrench className="h-16 w-16 mx-auto text-primary" />
            <h3 className="text-lg font-semibold">Perform Physical Meter Changeout</h3>
            <p className="text-muted-foreground">
              Safely remove the old meter and install the new meter.
              When complete, click Next to continue.
            </p>
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <ul className="text-left text-sm space-y-2">
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600" />
                    Old meter reading recorded: {data.oldMeterReading}
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600" />
                    Before photos captured: {data.beforePhotos.length}
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        );

      case "newReading":
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <Wrench className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                Record the initial reading from the new meter.
              </p>
            </div>
            <div className="space-y-2">
              <Label>New Meter Initial Reading *</Label>
              <Input
                type="text"
                value={data.newMeterReading}
                onChange={(e) => setData((prev) => ({ ...prev, newMeterReading: e.target.value }))}
                placeholder="Enter meter reading..."
                className="text-lg text-center"
                data-testid="input-new-meter-reading"
              />
            </div>
          </div>
        );

      case "afterPhotos":
        return (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                Take at least one photo of the meter AFTER the changeout.
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

      case "gps":
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
              {data.canChange ? "Confirm Meter Changeout" : "Confirm Trouble Report"}
            </h3>
            
            {data.canChange ? (
              <Card>
                <CardContent className="pt-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <span className="text-muted-foreground">Work Order:</span>
                    <span className="font-medium">{customerWoId}</span>
                    
                    <span className="text-muted-foreground">Old Reading:</span>
                    <span className="font-medium">{data.oldMeterReading}</span>
                    
                    <span className="text-muted-foreground">New Reading:</span>
                    <span className="font-medium">{data.newMeterReading}</span>
                    
                    <span className="text-muted-foreground">GPS:</span>
                    <span className="font-medium">{data.gpsCoordinates}</span>
                    
                    <span className="text-muted-foreground">Before Photos:</span>
                    <span className="font-medium">{data.beforePhotos.length}</span>
                    
                    <span className="text-muted-foreground">After Photos:</span>
                    <span className="font-medium">{data.afterPhotos.length}</span>
                    
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
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            {stepLabels[currentStep]}
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
  );
}

export default MeterChangeoutWizard;
