import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  canMaintain: boolean;
  pending: boolean;
  onCreate: (name: string, operationId: string) => Promise<unknown>;
};

export function InventoryCategoryCreateAction({ canMaintain, pending, onCreate }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const attempt = useRef<{ name: string; operationId: string } | null>(null);
  const trimmedName = name.trim();
  const save = async () => {
    if (!canMaintain || pending || busy || saving.current || !trimmedName) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (attempt.current?.name !== trimmedName)
        attempt.current = { name: trimmedName, operationId: crypto.randomUUID() };
      await onCreate(trimmedName, attempt.current.operationId);
      attempt.current = null;
      setName("");
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The category could not be saved. Try again.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  if (!canMaintain) return null;
  return <>
    <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" aria-label="Add category" title="Add category" onClick={() => { setError(""); setOpen(true); }}>
      <Plus className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Add category</span>
    </Button>
    <Dialog open={open} onOpenChange={next => { if (!busy && !pending) setOpen(next); }}>
      <DialogContent className="sm:max-w-md" onEscapeKeyDown={event => { if (busy || pending) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>Add category</DialogTitle><DialogDescription>Create a project-wide category for organizing catalog items.</DialogDescription></DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="inventory-category-name">Category name</Label>
          <Input id="inventory-category-name" autoFocus maxLength={500} value={name} onChange={event => { setName(event.target.value); setError(""); }}
            onKeyDown={event => { if (event.key === "Enter" && trimmedName && !busy && !pending) { event.preventDefault(); void save(); } }} />
          <p className="text-xs text-muted-foreground">Up to 500 characters. Names are unique regardless of capitalization.</p>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy || pending} onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!trimmedName || busy || pending} onClick={() => void save()}>{busy || pending ? "Saving…" : "Save category"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
