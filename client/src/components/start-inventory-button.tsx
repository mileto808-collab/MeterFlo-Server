import { ArrowRight, Boxes, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FulfillmentWizard } from "@/components/inventory/fulfillment-wizard";
import { useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export function StartInventoryButton({ mobile = false, projectId, permissions }: { mobile?: boolean; projectId: number; permissions?: string[] }) {
  const { hasPermission, isLoading } = usePermissions();
  const { user } = useAuth();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const allowed = permissions
    ? permissions.includes("workOrders.view") || user?.role === "admin"
    : hasPermission("workOrders.view");
  return <>
    <Button type="button" size={mobile ? "default" : "sm"} disabled={(isLoading && permissions === undefined) || !allowed}
    title={!allowed ? "Work order viewing permission is required." : "Fulfill or stage work orders"}
    aria-description={!allowed ? "You do not have permission to view work orders." : undefined}
    onClick={() => setChooserOpen(true)}
    data-testid={`button-start-inventory-${mobile ? "mobile" : "desktop"}`}
    className={mobile
      ? "inventory-start-mobile flex w-full shrink-0 bg-green-600 text-white dark:bg-green-600 md:hidden"
      : "inventory-start-desktop hidden shrink-0 bg-green-600 text-white dark:bg-green-600 md:inline-flex"}>
    <Boxes className={mobile ? "mr-1.5 h-4 w-4" : "mr-1 h-3.5 w-3.5"} />
    <span className={mobile ? "text-base font-bold" : undefined}>Start Inventory</span>
    </Button>
    <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
      <DialogContent className="min-w-0 w-[calc(100vw-1rem)] max-h-[calc(100dvh-1rem)] max-w-lg overflow-y-auto sm:rounded-xl">
        <DialogHeader className="text-left">
          <DialogTitle>Choose an inventory task</DialogTitle>
          <DialogDescription>Start a guided physical workflow. Saved batches can be resumed without changing work-order assignments.</DialogDescription>
        </DialogHeader>
        <button type="button" data-testid="inventory-task-fulfillment" disabled={!allowed}
          onClick={() => { setChooserOpen(false); setWizardOpen(true); }}
          className="group flex min-h-20 w-full items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ClipboardCheck className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 font-semibold">Fulfill / Stage Work Orders<Badge variant="secondary">Available</Badge></span>
            <span className="mt-1 block text-sm text-muted-foreground">Build a crew or scheduled batch, stage a physical pull, and hand stock to one vehicle.</span></span>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>
      </DialogContent>
    </Dialog>
    {wizardOpen && <FulfillmentWizard projectId={projectId} open onOpenChange={setWizardOpen} />}
  </>;
}
