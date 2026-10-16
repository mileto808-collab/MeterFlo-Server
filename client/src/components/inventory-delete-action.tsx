import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  kind: "item" | "category";
  id: string;
  name: string;
  canMaintain: boolean;
  pending?: boolean;
  blockers: string[];
  onDelete: (id: string) => Promise<unknown>;
};

export function InventoryDeleteAction({ kind, id, name, canMaintain, pending = false, blockers, onDelete }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isPending = pending || busy;
  const itemLabel = kind === "item" ? "item" : "category";

  const confirmDelete = async () => {
    if (!canMaintain || isPending || blockers.length > 0) return;
    setBusy(true);
    setError("");
    try {
      await onDelete(id);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error && cause.message.trim()
        ? cause.message
        : `Could not delete ${itemLabel} “${name}”. Try again.`);
    } finally {
      setBusy(false);
    }
  };

  if (!canMaintain) return null;
  return <>
    <Button
      className="h-11 w-11 shrink-0 p-0 sm:h-9 sm:w-9"
      size="sm"
      variant="outline"
      aria-label={`Delete ${itemLabel} ${name}`}
      title={`Delete ${itemLabel} ${name}`}
      data-testid={`${kind}-delete-trigger`}
      disabled={pending}
      onClick={() => { setError(""); setOpen(true); }}
    >
      <Trash2 className="h-4 w-4" aria-hidden="true" />
    </Button>
    <Dialog open={open} onOpenChange={next => { if (!isPending) setOpen(next); }}>
      <DialogContent
        className="max-h-[min(90dvh,40rem)] overflow-y-auto sm:max-w-lg"
        data-testid={`${kind}-delete-dialog`}
        onEscapeKeyDown={event => { if (isPending) event.preventDefault(); }}
        onPointerDownOutside={event => { if (isPending) event.preventDefault(); }}
        onOpenAutoFocus={event => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Delete {itemLabel}?</DialogTitle>
          <DialogDescription>
            You are about to permanently delete <span className="font-semibold text-foreground">{name}</span>.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {blockers.length > 0 && <section className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3" aria-labelledby={`${kind}-delete-blocked-title`}>
          <h3 id={`${kind}-delete-blocked-title`} className="text-sm font-semibold">This {itemLabel} can’t be deleted yet</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {blockers.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
          </ul>
        </section>}
        {error && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert" aria-live="assertive">{error}</p>}
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
          <Button variant="outline" disabled={isPending} onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            data-testid={`${kind}-delete-confirm`}
            disabled={isPending || blockers.length > 0}
            onClick={() => void confirmDelete()}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {busy ? "Deleting…" : `Delete ${itemLabel} permanently`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
