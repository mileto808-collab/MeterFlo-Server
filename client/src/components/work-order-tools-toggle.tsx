import { ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveConnectionIndicator } from "@/components/live-connection-indicator";

export function WorkOrderToolsToggle({ open, onToggle, status }: {
  open: boolean;
  onToggle: () => void;
  status: "connecting" | "live" | "reconnecting";
}) {
  return <div className="flex min-w-0 shrink-0 items-center gap-2" data-testid="work-order-tools-row">
    <Button type="button" variant="outline" size="sm" className="min-w-0 flex-1 justify-between"
      onClick={onToggle} aria-expanded={open} data-testid="button-toggle-mobile-tools">
      <span className="flex min-w-0 items-center gap-2">
        <Settings2 className="h-4 w-4 shrink-0" />
        <span className="truncate">{open ? "Hide Search & Tools" : "Show Search & Tools"}</span>
      </span>
      {open ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
    </Button>
    <LiveConnectionIndicator status={status} label="Work orders" testId="work-orders-live-indicator" />
  </div>;
}
