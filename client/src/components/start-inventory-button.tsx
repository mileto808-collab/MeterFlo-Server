import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Boxes, ClipboardCheck, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FulfillmentWizard } from "@/components/inventory/fulfillment-wizard";
import { usePermissions } from "@/hooks/usePermissions";
import { Badge } from "@/components/ui/badge";
import { inventoryCapabilities } from "@shared/inventory-capabilities";
import { parsePickTicketQr } from "@shared/inventory-pick-ticket";
import { openVehicleTransfer } from "@/components/inventory/vehicle-transfer-panel";

const launcherEvent = "meterflo:open-inventory-fulfillment";
type InventoryWorkspaceScreen = "inventory" | "tasks" | "fulfillment";

export function StartInventoryButton({ mobile = false, projectId, permissions }: { mobile?: boolean; projectId: number; permissions?: string[] }) {
  const { hasPermission, isLoading } = usePermissions();
  const can = (permission: string) => permissions ? permissions.includes(permission) : hasPermission(permission);
  const allowed = inventoryCapabilities(can).startInventory;
  if (!allowed && !isLoading) return null;
  return <Button type="button" size={mobile ? "default" : "sm"}
    disabled={(isLoading && permissions === undefined) || !allowed}
    title={!allowed ? "Start Inventory requires fulfillment or vehicle-transfer permissions." : "Choose a fulfillment or vehicle-transfer task"}
    aria-description={!allowed ? "The required permissions for the available inventory workflows are not available." : undefined}
    onClick={() => window.dispatchEvent(new CustomEvent(launcherEvent, { detail: { projectId } }))}
    data-testid={`button-start-inventory-${mobile ? "mobile" : "desktop"}`}
    className={mobile
      ? "inventory-start-mobile flex w-full shrink-0 bg-green-600 text-white dark:bg-green-600 md:hidden"
      : "inventory-start-desktop hidden shrink-0 bg-green-600 text-white dark:bg-green-600 md:inline-flex"}>
    <Boxes className={mobile ? "mr-1.5 h-4 w-4" : "mr-1 h-3.5 w-3.5"} />
    <span className={mobile ? "text-base font-bold" : undefined}>Start Inventory</span>
  </Button>;
}

/** One launcher owns the inline task chooser and wizard although responsive buttons are both mounted. */
export function InventoryWorkflowLauncher({ projectId, permissions, screen, onScreenChange }: {
  projectId: number; permissions?: string[]; screen: InventoryWorkspaceScreen; onScreenChange: (screen: InventoryWorkspaceScreen) => void;
}) {
  const { hasPermission, isLoading } = usePermissions();
  const [ticketQr, setTicketQr] = useState("");
  const sequenceRef = useRef("");
  const sequenceTimeRef = useRef(0);
  const can = (permission: string) => permissions ? permissions.includes(permission) : hasPermission(permission);
  const capabilities = inventoryCapabilities(can);
  const allowed = capabilities.startInventory;
  const fulfillmentAllowed = capabilities.fulfillment;

  useEffect(() => {
    if (!allowed || (isLoading && permissions === undefined)) return;
    const onOpen = (event: Event) => {
      const targetProject = (event as CustomEvent<{ projectId?: number }>).detail?.projectId;
      if (targetProject === undefined || targetProject === projectId) onScreenChange("tasks");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const dialog = target?.closest('[role="dialog"]');
      if (!fulfillmentAllowed || (dialog && !dialog.hasAttribute("data-inventory-fulfillment-dialog")) ||
        target?.isContentEditable ||
        target?.matches("input, textarea, select, [contenteditable='true']")) {
        sequenceRef.current = "";
        return;
      }
      const now = performance.now();
      if (now - sequenceTimeRef.current > 85) sequenceRef.current = "";
      sequenceTimeRef.current = now;
      if (event.key === "Enter" || event.key === "Tab") {
        const value = sequenceRef.current;
        sequenceRef.current = "";
        const parsed = parsePickTicketQr(value, projectId);
        if (parsed.kind === "ticket" || parsed.kind === "wrong_project") {
          event.preventDefault();
          setTicketQr(value);
          onScreenChange("fulfillment");
        }
        return;
      }
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        sequenceRef.current = `${sequenceRef.current}${event.key}`.slice(-512);
      } else if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) sequenceRef.current = "";
    };
    window.addEventListener(launcherEvent, onOpen);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener(launcherEvent, onOpen);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [allowed, fulfillmentAllowed, isLoading, permissions === undefined, projectId, onScreenChange]);

  if (!allowed && !isLoading) return null;
  return <>
    {screen === "tasks" && <section data-inventory-task-chooser="true" className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col overflow-y-auto">
      <div className="border-b pb-5 sm:pb-7">
        <Button type="button" variant="ghost" className="-ml-3 mb-4 h-9 px-3 text-muted-foreground" onClick={() => onScreenChange("inventory")}>
          <ArrowLeft className="mr-2 h-4 w-4" />Back to Inventory
        </Button>
        <div className="max-w-2xl">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Start Inventory</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Choose an inventory task</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">Choose a guided workflow for moving and staging physical inventory.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 py-5 sm:grid-cols-2 sm:gap-4 sm:py-7 lg:grid-cols-3">
        {capabilities.fulfillment && <button type="button" data-testid="inventory-task-fulfillment"
          onClick={() => onScreenChange("fulfillment")}
          className="group flex min-h-24 w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ClipboardCheck className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 font-semibold">Fulfill / Stage Work Orders<Badge variant="secondary">Available</Badge></span>
            <span className="mt-1 block text-sm text-muted-foreground">Build a crew or scheduled batch, stage a physical pull, and hand stock to one vehicle.</span></span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>}
        {capabilities.vehicleTransfer && <button type="button" data-testid="inventory-task-vehicle-transfer"
          onClick={event => openVehicleTransfer(projectId, event.currentTarget)}
          className="group flex min-h-24 w-full items-center gap-3 rounded-xl border bg-card p-4 text-left transition-[border-color,background-color,transform] hover:-translate-y-0.5 hover:border-primary/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Truck className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 font-semibold">Vehicle Transfer<Badge variant="secondary">Available</Badge></span>
            <span className="mt-1 block text-sm text-muted-foreground">Move stock between locations and vehicles.</span></span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>}
      </div>
    </section>}
    {fulfillmentAllowed && <FulfillmentWizard projectId={projectId} open={screen === "fulfillment"}
      onOpenChange={open => onScreenChange(open ? "fulfillment" : "tasks")} permissions={permissions}
      pickTicketQr={ticketQr} onPickTicketQrConsumed={() => setTicketQr("")} />}
  </>;
}
