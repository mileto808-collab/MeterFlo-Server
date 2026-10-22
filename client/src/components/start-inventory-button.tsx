import { useEffect, useRef, useState } from "react";
import { ArrowRight, Boxes, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FulfillmentWizard } from "@/components/inventory/fulfillment-wizard";
import { usePermissions } from "@/hooks/usePermissions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { inventoryCapabilities } from "@shared/inventory-capabilities";
import { parsePickTicketQr } from "@shared/inventory-pick-ticket";

const launcherEvent = "meterflo:open-inventory-fulfillment";

export function StartInventoryButton({ mobile = false, projectId, permissions }: { mobile?: boolean; projectId: number; permissions?: string[] }) {
  const { hasPermission, isLoading } = usePermissions();
  const can = (permission: string) => permissions ? permissions.includes(permission) : hasPermission(permission);
  const allowed = inventoryCapabilities(can).fulfillment;
  if (!allowed && !isLoading) return null;
  return <Button type="button" size={mobile ? "default" : "sm"}
    disabled={(isLoading && permissions === undefined) || !allowed}
    title={!allowed ? "Fulfillment access requires work-order viewing, assignment, receiving, and transfer permissions." : "Fulfill or stage work orders"}
    aria-description={!allowed ? "The required permissions for the complete fulfillment workflow are not available." : undefined}
    onClick={() => window.dispatchEvent(new CustomEvent(launcherEvent, { detail: { projectId } }))}
    data-testid={`button-start-inventory-${mobile ? "mobile" : "desktop"}`}
    className={mobile
      ? "inventory-start-mobile flex w-full shrink-0 bg-green-600 text-white dark:bg-green-600 md:hidden"
      : "inventory-start-desktop hidden shrink-0 bg-green-600 text-white dark:bg-green-600 md:inline-flex"}>
    <Boxes className={mobile ? "mr-1.5 h-4 w-4" : "mr-1 h-3.5 w-3.5"} />
    <span className={mobile ? "text-base font-bold" : undefined}>Start Inventory</span>
  </Button>;
}

/** One launcher owns the wizard even though responsive desktop/mobile buttons are both mounted. */
export function InventoryWorkflowLauncher({ projectId, permissions }: { projectId: number; permissions?: string[] }) {
  const { hasPermission, isLoading } = usePermissions();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [ticketQr, setTicketQr] = useState("");
  const sequenceRef = useRef("");
  const sequenceTimeRef = useRef(0);
  const can = (permission: string) => permissions ? permissions.includes(permission) : hasPermission(permission);
  const allowed = inventoryCapabilities(can).fulfillment;

  useEffect(() => {
    if (!allowed || (isLoading && permissions === undefined)) return;
    const onOpen = (event: Event) => {
      const targetProject = (event as CustomEvent<{ projectId?: number }>).detail?.projectId;
      if (targetProject === undefined || targetProject === projectId) setChooserOpen(true);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const dialog = target?.closest('[role="dialog"]');
      if ((dialog && !dialog.hasAttribute("data-inventory-fulfillment-dialog") &&
        !dialog.hasAttribute("data-inventory-task-chooser")) ||
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
          setChooserOpen(false);
          setWizardOpen(true);
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
  }, [allowed, isLoading, permissions === undefined, projectId]);

  if (!allowed && !isLoading) return null;
  return <>
    <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
      <DialogContent data-inventory-task-chooser="true" className="min-w-0 w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] max-w-lg overflow-y-auto sm:rounded-xl">
        <DialogHeader className="text-left">
          <DialogTitle>Choose an inventory task</DialogTitle>
          <DialogDescription>Start a guided physical workflow. Saved batches can be resumed without changing work-order assignments.</DialogDescription>
        </DialogHeader>
        {allowed && <button type="button" data-testid="inventory-task-fulfillment"
          onClick={() => { setChooserOpen(false); setWizardOpen(true); }}
          className="group flex min-h-20 w-full items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ClipboardCheck className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 font-semibold">Fulfill / Stage Work Orders<Badge variant="secondary">Available</Badge></span>
            <span className="mt-1 block text-sm text-muted-foreground">Build a crew or scheduled batch, stage a physical pull, and hand stock to one vehicle.</span></span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>}
      </DialogContent>
    </Dialog>
    {allowed && <FulfillmentWizard projectId={projectId} open={wizardOpen} onOpenChange={setWizardOpen} permissions={permissions}
      pickTicketQr={ticketQr} onPickTicketQrConsumed={() => setTicketQr("")} />}
  </>;
}
