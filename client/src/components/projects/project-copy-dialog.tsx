import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

export function ProjectCopyDialog({ open, onOpenChange, projectName, canCopyAccess, pending, onCopy }: {
  open: boolean; onOpenChange: (open: boolean) => void; projectName: string; canCopyAccess: boolean;
  pending: boolean; onCopy: (options: { copyAccess: boolean }) => void;
}) {
  const [copyAccess, setCopyAccess] = useState(canCopyAccess);
  useEffect(() => setCopyAccess(canCopyAccess), [canCopyAccess]);
  return <Dialog open={open} onOpenChange={value => { if (!pending) onOpenChange(value); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto" data-testid="project-copy-dialog">
      <DialogHeader><DialogTitle>Copy project setup</DialogTitle>
        <DialogDescription>Create a fresh project using the saved configuration of {projectName}. Unsaved changes on this page are not included.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border p-3"><h3 className="font-medium">Included setup</h3>
          <p className="mt-1 text-muted-foreground">Project settings, service and equipment types, reading precision, wizard and search settings, scheduling rules, holidays, custom sub-statuses and trouble codes.</p>
          <p className="mt-2 text-muted-foreground">When inventory is enabled: locations, items, categories, vendors, recipes, type links, field stock settings and equipment removal rules.</p>
        </div>
        {canCopyAccess ? <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <Checkbox checked={copyAccess} onCheckedChange={value => setCopyAccess(value === true)} disabled={pending}
            data-testid="checkbox-copy-project-access" className="mt-0.5" />
          <span><span className="font-medium">Copy access assignments</span>
            <span className="mt-1 block text-muted-foreground">Give the same users and user groups access to the new project, and retain user assignments on copied vehicle locations. User roles and group membership do not change.</span></span>
        </label> : <p className="text-muted-foreground">Access assignments are not copied. An administrator can include them.</p>}
        <div className="rounded-lg border border-amber-400/50 bg-amber-50 p-3 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-medium">A clean project—not a stock or history copy</p>
          <p className="mt-1">No work orders, stock, serials, batches, drafts, files or transaction history are copied. Webhooks and customer API delivery start off.</p>
          <p className="mt-2">Import/export jobs, connection and file-transfer credentials, and access locks are not copied. Review external services before enabling them.</p>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="button" disabled={pending} data-testid="button-confirm-project-copy"
          onClick={() => onCopy({ copyAccess: canCopyAccess && copyAccess })}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{pending ? "Copying..." : "Copy setup"}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
