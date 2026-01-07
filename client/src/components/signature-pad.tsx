import { useRef, useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Eraser, Pencil, Type } from "lucide-react";

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

const SignaturePad = forwardRef<SignaturePadRef, SignaturePadProps>(
  ({ initialSignatureData, initialSignatureName, onSignatureChange, disabled = false }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const signatureDataRef = useRef<string | null>(initialSignatureData || null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [signatureName, setSignatureName] = useState(initialSignatureName || "");
    const [useTypedName, setUseTypedName] = useState(!initialSignatureData && !!initialSignatureName);
    const [hasSignature, setHasSignature] = useState(!!initialSignatureData);

    const setupCanvas = (preserveData?: string | null) => {
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

      if (preserveData) {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, rect.width, rect.height);
        };
        img.src = preserveData;
      }

      return { ctx, rect };
    };

    useEffect(() => {
      if (useTypedName) return;
      
      const result = setupCanvas(signatureDataRef.current);
      if (!result) return;
      const { ctx, rect } = result;

      if (initialSignatureData && !signatureDataRef.current) {
        signatureDataRef.current = initialSignatureData;
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, rect.width, rect.height);
          setHasSignature(true);
        };
        img.src = initialSignatureData;
      }

      const handleResize = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const currentData = signatureDataRef.current;
        const result = setupCanvas();
        if (result && currentData) {
          const img = new Image();
          img.onload = () => {
            result.ctx.drawImage(img, 0, 0, result.rect.width, result.rect.height);
          };
          img.src = currentData;
        }
      };

      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }, [useTypedName]);

    useImperativeHandle(ref, () => ({
      clear: () => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const rect = container.getBoundingClientRect();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, rect.width, rect.height);
        signatureDataRef.current = null;
        setHasSignature(false);
        notifyChange(null, signatureName);
      },
      getSignatureData: () => {
        if (!hasSignature || useTypedName) return null;
        const canvas = canvasRef.current;
        if (!canvas) return null;
        return canvas.toDataURL("image/png");
      },
      getSignatureName: () => signatureName,
      setSignatureData: (data: string | null) => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const rect = container.getBoundingClientRect();
        signatureDataRef.current = data;
        if (!data) {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, rect.width, rect.height);
          setHasSignature(false);
          return;
        }
        const img = new Image();
        img.onload = () => {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, rect.width, rect.height);
          ctx.drawImage(img, 0, 0, rect.width, rect.height);
          setHasSignature(true);
        };
        img.src = data;
      },
      setSignatureName: (name: string) => {
        setSignatureName(name);
      },
      isEmpty: () => !hasSignature && !signatureName.trim(),
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
      if (disabled || useTypedName) return;
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { x, y } = getCoordinates(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      setIsDrawing(true);
    };

    const draw = (e: React.MouseEvent | React.TouchEvent) => {
      if (!isDrawing || disabled || useTypedName) return;
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { x, y } = getCoordinates(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      setHasSignature(true);
    };

    const stopDrawing = () => {
      if (isDrawing && hasSignature) {
        const canvas = canvasRef.current;
        if (canvas) {
          const data = canvas.toDataURL("image/png");
          signatureDataRef.current = data;
          notifyChange(data, signatureName);
        }
      }
      setIsDrawing(false);
    };

    const clearSignature = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const rect = container.getBoundingClientRect();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
      signatureDataRef.current = null;
      setHasSignature(false);
      notifyChange(null, signatureName);
    };

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newName = e.target.value;
      setSignatureName(newName);
      if (useTypedName) {
        notifyChange(null, newName);
      } else if (hasSignature) {
        const canvas = canvasRef.current;
        if (canvas) {
          notifyChange(canvas.toDataURL("image/png"), newName);
        }
      } else {
        notifyChange(null, newName);
      }
    };

    const toggleMode = () => {
      if (disabled) return;
      setUseTypedName(!useTypedName);
      if (!useTypedName) {
        clearSignature();
      }
    };

    return (
      <Card className="border">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Label className="text-sm font-medium">Signature / Proof of Service</Label>
            <div className="flex gap-1">
              <Button
                type="button"
                variant={useTypedName ? "outline" : "default"}
                size="sm"
                onClick={toggleMode}
                disabled={disabled}
                data-testid="button-signature-draw-mode"
              >
                <Pencil className="h-4 w-4 mr-1" />
                Draw
              </Button>
              <Button
                type="button"
                variant={useTypedName ? "default" : "outline"}
                size="sm"
                onClick={toggleMode}
                disabled={disabled}
                data-testid="button-signature-type-mode"
              >
                <Type className="h-4 w-4 mr-1" />
                Type
              </Button>
            </div>
          </div>

          {!useTypedName && (
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
                {!hasSignature && !disabled && (
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
                  onClick={clearSignature}
                  disabled={disabled || !hasSignature}
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
              Printed Name {useTypedName && <span className="text-muted-foreground">(Required)</span>}
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
