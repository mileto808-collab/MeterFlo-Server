import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SubStatusBadgeProps {
  label: string;
  color?: string | null;
  testId?: string;
  className?: string;
}

function getContrastText(hex: string): "#000000" | "#ffffff" {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map(channel =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return luminance > 0.179 ? "#000000" : "#ffffff";
}

export function SubStatusBadge({ label, color, testId, className }: SubStatusBadgeProps) {
  const validHex = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;

  return (
    <Badge
      variant="outline"
      className={cn("max-w-full whitespace-normal break-words text-left leading-snug", className)}
      style={validHex ? {
        backgroundColor: validHex,
        borderColor: validHex,
        color: getContrastText(validHex),
        overflowWrap: "anywhere",
      } : { overflowWrap: "anywhere" }}
      data-testid={testId}
      title={label}
    >
      {label}
    </Badge>
  );
}
