import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface GPSCaptureProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  "data-testid"?: string;
}

export function GPSCapture({
  value,
  onChange,
  placeholder = "Latitude, Longitude",
  disabled = false,
  "data-testid": testId,
}: GPSCaptureProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const { toast } = useToast();

  const captureGPS = () => {
    if (!navigator.geolocation) {
      toast({
        title: "GPS Not Supported",
        description: "Your device does not support GPS location services.",
        variant: "destructive",
      });
      return;
    }

    setIsCapturing(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude.toFixed(4);
        const lng = position.coords.longitude.toFixed(4);
        const gpsValue = `${lat}, ${lng}`;
        onChange(gpsValue);
        setIsCapturing(false);
        toast({
          title: "GPS Captured",
          description: `Location: ${gpsValue}`,
        });
      },
      (error) => {
        setIsCapturing(false);
        let errorMessage = "Failed to get GPS location.";
        
        switch (error.code) {
          case error.PERMISSION_DENIED:
            errorMessage = "Location permission denied. Please enable location access in your browser settings.";
            break;
          case error.POSITION_UNAVAILABLE:
            errorMessage = "Location information is unavailable.";
            break;
          case error.TIMEOUT:
            errorMessage = "Location request timed out. Please try again.";
            break;
        }
        
        toast({
          title: "GPS Error",
          description: errorMessage,
          variant: "destructive",
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  return (
    <div className="flex gap-1">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        data-testid={testId}
        className="flex-1"
      />
      
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={captureGPS}
        disabled={disabled || isCapturing}
        data-testid={`${testId}-capture`}
        title="Capture GPS Location"
      >
        {isCapturing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MapPin className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

export default GPSCapture;
