import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Eraser, Pencil, Type, X, Check } from "lucide-react";

export interface SignaturePadRef {
  clear: () => void;
  getSignatureData: () => string | null;
  getSignatureName: () => string;
  setSignatureData: (data: string | null) => void;
  setSignatureName: (name: string) => void;
  isEmpty: () => boolean;
}

interface SignaturePadProps {
  initialSignatureData?: string | null;
  initialSignatureName?: string | null;
  onSignatureChange?: (data: string | null, name: string) => void;
  disabled?: boolean;
}

type SignatureMode = "view" | "draw" | "type";

const SignaturePad = forwardRef<SignaturePadRef, SignaturePadProps>(
  ({ initialSignatureData, initialSignatureName, onSignatureChange, disabled = false }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasDrawnAnything, setHasDrawnAnything] = useState(false);
    const [signatureName, setSignatureName] = useState(initialSignatureName || "");
    const [signatureData, setSignatureData] = useState<string | null>(initialSignatureData || null);
    const [pendingSignatureData, setPendingSignatureData] = useState<string | null>(null);
    const [previousSignatureData, setPreviousSignatureData] = useState<string | null>(() => {
      if (!initialSignatureData && initialSignatureName) {
        return null;
      }
      return null;
    });
    const [previousSignatureName, setPreviousSignatureName] = useState<string>(() => {
      if (!initialSignatureData && initialSignatureName) {
        return initialSignatureName;
      }
      return "";
    });
    const getInitialMode = (): SignatureMode => {
      if (initialSignatureData) return "view";
      if (initialSignatureName) return "type";
      return "view";
    };
    const [mode, setMode] = useState<SignatureMode>(getInitialMode);
    const [previousMode, setPreviousMode] = useState<SignatureMode>(getInitialMode);

    const setupCanvas = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      return { ctx, rect };
    };

    useEffect(() => {
      if (mode === "draw") {
        const timeoutId = setTimeout(() => {
          setupCanvas();
          setHasDrawnAnything(false);
          setPendingSignatureData(null);
        }, 50);
        return () => clearTimeout(timeoutId);
      }
    }, [mode]);

    useImperativeHandle(ref, () => ({
      clear: () => {
        setSignatureData(null);
        setPendingSignatureData(null);
        setHasDrawnAnything(false);
        if (mode === "draw") {
          setupCanvas();
        }
        notifyChange(null, signatureName);
      },
      getSignatureData: () => {
        if (mode === "type") return null;
        return signatureData;
      },
      getSignatureName: () => signatureName,
      setSignatureData: (data: string | null) => {
        setSignatureData(data);
        if (data) {
          setMode("view");
        }
      },
      setSignatureName: (name: string) => {
        setSignatureName(name);
      },
      isEmpty: () => !signatureData && !signatureName.trim(),
    }));

    const notifyChange = (data: string | null, name: string) => {
      if (onSignatureChange) {
        onSignatureChange(data, name);
      }
    };

    const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };

      const rect = canvas.getBoundingClientRect();
      
      let clientX: number;
      let clientY: number;
      
      if ("touches" in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else if ("clientX" in e) {
        clientX = e.clientX;
        clientY = e.clientY;
      } else {
        return { x: 0, y: 0 };
      }
      
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      
      return { x, y };
    };

    const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
      if (disabled) return;
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const { x, y } = getCoordinates(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      setIsDrawing(true);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing || disabled) return;
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { x, y } = getCoordinates(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      setHasDrawnAnything(true);
    };

    const stopDrawing = () => {
      if (isDrawing && hasDrawnAnything) {
        const canvas = canvasRef.current;
        if (canvas) {
          const data = canvas.toDataURL("image/png");
          setPendingSignatureData(data);
        }
      }
      setIsDrawing(false);
    };

    const clearCanvas = () => {
      setupCanvas();
      setPendingSignatureData(null);
      setHasDrawnAnything(false);
    };

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newName = e.target.value;
      setSignatureName(newName);
      if (mode === "view" && signatureData) {
        notifyChange(signatureData, newName);
      }
    };

    const switchToDrawMode = () => {
      if (disabled) return;
      setPreviousSignatureData(signatureData);
      setPreviousSignatureName(signatureName);
      setPreviousMode(mode);
      setMode("draw");
    };

    const switchToTypeMode = () => {
      if (disabled) return;
      setPreviousSignatureData(signatureData);
      setPreviousSignatureName(signatureName);
      setPreviousMode(mode);
      setMode("type");
    };

    const cancelEditing = () => {
      setSignatureData(previousSignatureData);
      setSignatureName(previousSignatureName);
      setMode(previousMode);
      setPendingSignatureData(null);
      setHasDrawnAnything(false);
    };

    const confirmTypedSignature = () => {
      setSignatureData(null);
      notifyChange(null, signatureName);
      setMode("view");
      setPreviousSignatureData(null);
      setPreviousSignatureName("");
    };

    const confirmDrawing = () => {
      if (pendingSignatureData) {
        setSignatureData(pendingSignatureData);
        notifyChange(pendingSignatureData, signatureName);
      }
      setMode("view");
      setPendingSignatureData(null);
      setHasDrawnAnything(false);
      setPreviousSignatureData(null);
      setPreviousSignatureName("");
    };

    const clearExistingSignature = () => {
      setSignatureData(null);
      notifyChange(null, signatureName);
    };

    return (
      <Card className="border">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label className="text-sm font-medium">Signature / Proof of Service</Label>
            {mode === "view" && (
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={switchToDrawMode}
                  disabled={disabled}
                  data-testid="button-signature-draw-mode"
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Draw
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={switchToTypeMode}
                  disabled={disabled}
                  data-testid="button-signature-type-mode"
                >
                  <Type className="h-4 w-4 mr-1" />
                  Type
                </Button>
              </div>
            )}
            {mode === "draw" && (
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancelEditing}
                  data-testid="button-cancel-drawing"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={confirmDrawing}
                  disabled={!hasDrawnAnything}
                  data-testid="button-confirm-drawing"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Done
                </Button>
              </div>
            )}
            {mode === "type" && (
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={cancelEditing}
                  data-testid="button-cancel-type"
                >
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={confirmTypedSignature}
                  disabled={!signatureName.trim()}
                  data-testid="button-confirm-type"
                >
                  <Check className="h-4 w-4 mr-1" />
                  Done
                </Button>
              </div>
            )}
          </div>

          {mode === "view" && signatureData && (
            <div className="border rounded-md bg-white p-2 relative">
              <img
                src={signatureData}
                alt="Signature"
                className="max-h-[150px] w-auto mx-auto"
                data-testid="img-signature-preview"
              />
              {!disabled && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearExistingSignature}
                  className="absolute top-1 right-1"
                  data-testid="button-clear-existing-signature"
                >
                  <Eraser className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}

          {mode === "view" && !signatureData && (
            <div className="border rounded-md bg-muted/30 p-4 text-center text-muted-foreground text-sm">
              No signature captured. Click "Draw" to add one.
            </div>
          )}

          {mode === "draw" && (
            <div className="space-y-2">
              <div 
                ref={containerRef}
                className="relative border rounded-md bg-white overflow-hidden"
                style={{ height: "150px" }}
              >
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 touch-none cursor-crosshair block"
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={draw}
                  onTouchEnd={stopDrawing}
                  data-testid="canvas-signature"
                />
                {!hasDrawnAnything && !disabled && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground text-sm">
                    Sign here
                  </div>
                )}
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clearCanvas}
                  disabled={disabled || !hasDrawnAnything}
                  data-testid="button-clear-signature"
                >
                  <Eraser className="h-4 w-4 mr-1" />
                  Clear
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="signature-name" className="text-sm">
              Printed Name {mode === "type" && <span className="text-muted-foreground">(Required)</span>}
            </Label>
            <Input
              id="signature-name"
              value={signatureName}
              onChange={handleNameChange}
              placeholder="Enter printed name..."
              disabled={disabled}
              data-testid="input-signature-name"
            />
          </div>
        </CardContent>
      </Card>
    );
  }
);

SignaturePad.displayName = "SignaturePad";

export default SignaturePad;
