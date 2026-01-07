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

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 200;

const SignaturePad = forwardRef<SignaturePadRef, SignaturePadProps>(
  ({ initialSignatureData, initialSignatureName, onSignatureChange, disabled = false }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [signatureName, setSignatureName] = useState(initialSignatureName || "");
    const [useTypedName, setUseTypedName] = useState(!initialSignatureData && !!initialSignatureName);
    const [hasSignature, setHasSignature] = useState(!!initialSignatureData);

    const initCanvas = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };

    useEffect(() => {
      if (useTypedName) return;
      
      initCanvas();
      
      if (initialSignatureData) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
          setHasSignature(true);
        };
        img.src = initialSignatureData;
      }
    }, [useTypedName, initialSignatureData]);

    useImperativeHandle(ref, () => ({
      clear: () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
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
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        
        if (!data) {
          setHasSignature(false);
          return;
        }
        
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
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
      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;
      
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
      
      const x = (clientX - rect.left) * scaleX;
      const y = (clientY - rect.top) * scaleY;
      
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
          notifyChange(canvas.toDataURL("image/png"), signatureName);
        }
      }
      setIsDrawing(false);
    };

    const clearSignature = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
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
              <div className="relative border rounded-md bg-white overflow-hidden">
                <canvas
                  ref={canvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  className="w-full touch-none cursor-crosshair block"
                  style={{ height: "auto", aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}` }}
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
