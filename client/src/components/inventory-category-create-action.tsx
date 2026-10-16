import { useId, useRef, useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  canMaintain: boolean;
  pending: boolean;
  onCreate?: (name: string, operationId: string) => Promise<unknown>;
  categoryId?: string;
  categoryName?: string;
  onRename?: (id: string, newName: string, operationId: string) => Promise<unknown>;
};

export function InventoryCategoryCreateAction({ canMaintain, pending, onCreate, categoryId, categoryName, onRename }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputId = useId();
  const saving = useRef(false);
  const attempt = useRef<{ fingerprint: string; operationId: string } | null>(null);
  const trimmedName = name.trim();
  const editing = categoryId !== undefined && categoryName !== undefined && onRename !== undefined;
  const save = async () => {
    if (!canMaintain || pending || busy || saving.current || !trimmedName) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const fingerprint = editing ? JSON.stringify([categoryId, trimmedName]) : trimmedName;
      if (attempt.current?.fingerprint !== fingerprint)
        attempt.current = { fingerprint, operationId: crypto.randomUUID() };
      if (editing) await onRename(categoryId, trimmedName, attempt.current.operationId);
      else if (onCreate) await onCreate(trimmedName, attempt.current.operationId);
      else throw new Error("The category could not be saved. Try again.");
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
    {editing
      ? <Button className="h-8 w-8 shrink-0 p-0 sm:w-auto sm:px-2.5" size="sm" variant="outline"
          aria-label={`Edit category ${categoryName}`} title={`Edit category ${categoryName}`}
          disabled={pending || busy}
          onClick={() => { setName(categoryName); setError(""); attempt.current = null; setOpen(true); }}>
          <Pencil className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Edit</span>
        </Button>
      : <Button className="h-9 w-9 shrink-0 p-0 sm:w-auto sm:px-3" size="sm" aria-label="Add category" title="Add category" onClick={() => { setError(""); setOpen(true); }}>
          <Plus className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">Add category</span>
        </Button>}
    <Dialog open={open} onOpenChange={next => { if (!busy && !pending) setOpen(next); }}>
      <DialogContent className="sm:max-w-md" onEscapeKeyDown={event => { if (busy || pending) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit category" : "Add category"}</DialogTitle>
          <DialogDescription>{editing
            ? "Rename this project-wide category. Assigned items keep their category, and the displayed name updates."
            : "Create a project-wide category for organizing catalog items."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={inputId}>Category name</Label>
          <Input id={inputId} autoFocus maxLength={500} value={name} onChange={event => { setName(event.target.value); setError(""); }}
            onKeyDown={event => { if (event.key === "Enter" && trimmedName && !busy && !pending) { event.preventDefault(); void save(); } }} />
          <p className="text-xs text-muted-foreground">Up to 500 characters. Names are unique regardless of capitalization.</p>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy || pending} onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={!trimmedName || busy || pending} onClick={() => void save()}>{busy || pending ? "Saving…" : editing ? "Save changes" : "Save category"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
