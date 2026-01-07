import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { CalendarIcon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DateTimePickerProps {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}

export function DateTimePicker({
  value,
  onChange,
  disabled = false,
  placeholder = "Select date and time",
  className,
  "data-testid": testId,
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [time, setTime] = React.useState("09:00");

  const selectedDate = React.useMemo(() => {
    if (!value) return undefined;
    const date = new Date(value);
    return isValid(date) ? date : undefined;
  }, [value]);

  React.useEffect(() => {
    if (selectedDate) {
      const hours = selectedDate.getHours().toString().padStart(2, "0");
      const minutes = selectedDate.getMinutes().toString().padStart(2, "0");
      setTime(`${hours}:${minutes}`);
    }
  }, [selectedDate]);

  const handleDateSelect = (date: Date | undefined) => {
    if (!date) {
      onChange(null);
      return;
    }

    const [hours, minutes] = time.split(":").map(Number);
    date.setHours(hours || 0, minutes || 0, 0, 0);
    
    // Use toISOString() to send UTC time, preserving the user's local time correctly
    onChange(date.toISOString());
  };

  const handleTimeChange = (newTime: string) => {
    setTime(newTime);
    
    if (selectedDate) {
      const [hours, minutes] = newTime.split(":").map(Number);
      const newDate = new Date(selectedDate);
      newDate.setHours(hours || 0, minutes || 0, 0, 0);
      
      // Use toISOString() to send UTC time, preserving the user's local time correctly
      onChange(newDate.toISOString());
    }
  };

  const handleClear = () => {
    onChange(null);
    setOpen(false);
  };

  const displayValue = selectedDate
    ? format(selectedDate, "MMM d, yyyy 'at' h:mm a")
    : placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "w-full justify-start text-left font-normal",
            !selectedDate && "text-muted-foreground",
            className
          )}
          data-testid={testId}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {displayValue}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleDateSelect}
          initialFocus
        />
        <div className="border-t p-3 flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <Input
            type="time"
            value={time}
            onChange={(e) => handleTimeChange(e.target.value)}
            className="w-auto"
            data-testid={testId ? `${testId}-time` : undefined}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="ml-auto"
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
