import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2 } from "lucide-react";
import { useGpsCapture } from "@/hooks/use-gps-capture";
import type { GpsFix } from "@shared/gps-capture";

interface GPSCaptureProps {
  value: string;
  onChange: (value: string) => void;
  onCaptured?: (fix: GpsFix) => void;
  capture?: () => Promise<GpsFix | null>;
  capturing?: boolean;
  placeholder?: string;
  disabled?: boolean;
  "data-testid"?: string;
}
export function GPSCapture({ value, onChange, onCaptured, capture, capturing,
  placeholder = "Latitude, Longitude", disabled = false, "data-testid": testId }: GPSCaptureProps) {
  const gps = useGpsCapture({ onSuccess: fix => { onChange(fix.coordinates); onCaptured?.(fix); } });
  const busy = capturing ?? gps.status === "capturing";
  return (
    <div>
      <div className="flex gap-1">
        <Input value={value} onChange={event => { if (!capture) gps.stop(); onChange(event.target.value); }} placeholder={placeholder}
          disabled={disabled} data-testid={testId} className="min-w-0 flex-1" />
        <Button type="button" variant="outline" size="icon" onClick={() => void (capture ?? gps.startCapture)()}
          disabled={disabled || busy} data-testid={`${testId}-capture`} title="Capture location">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
        </Button>
      </div>
      {!capture && gps.error && <p role="status" className="mt-1 text-sm text-muted-foreground">{gps.error}</p>}
    </div>
  );
}
export default GPSCapture;
