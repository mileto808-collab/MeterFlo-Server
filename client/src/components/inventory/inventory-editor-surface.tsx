import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type InventoryEditorSurfaceProps = {
  inline?: boolean;
  portalHost?: HTMLElement | null;
  open?: boolean;
  title: string;
  description: string;
  onBack: () => void;
  onSave: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  saveLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  stickyFooter?: boolean;
  actions?: ReactNode;
  testId?: string;
};

export function InventoryEditorSurface({
  inline = false,
  portalHost,
  open = true,
  title,
  description,
  onBack,
  onSave,
  saving = false,
  saveDisabled = false,
  saveLabel = "Save changes",
  children,
  footer,
  stickyFooter = false,
  actions,
  testId = "inventory-page-editor",
}: InventoryEditorSurfaceProps) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!inline) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    backRef.current?.focus({ preventScroll: true });
    return () => {
      const target = previousFocus.current;
      if (target?.isConnected) {
        requestAnimationFrame(() => {
          if (target.isConnected && !target.closest("[inert]")) target.focus({ preventScroll: true });
        });
      }
    };
  }, [inline]);

  if (!inline) {
    return (
      <Dialog open={open} onOpenChange={next => { if (!next) onBack(); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          {footer}
        </DialogContent>
      </Dialog>
    );
  }

  const editor = (
    <section
      data-testid={testId}
      aria-label={title}
      className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background"
    >
      <header className="sticky top-0 z-20 grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-2 border-b bg-background/95 px-3 py-2.5 backdrop-blur sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-5 sm:py-3">
        <Button
          ref={backRef}
          type="button"
          variant="ghost"
          size="sm"
          data-testid="inventory-editor-back"
          aria-label="Back to inventory"
          disabled={saving}
          onClick={onBack}
          className="shrink-0"
        >
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          Back
        </Button>
        <div className="min-w-0 px-1">
          <h1 className="line-clamp-2 break-words text-sm font-semibold leading-tight tracking-tight sm:truncate sm:text-lg">{title}</h1>
          <p className="hidden max-w-3xl truncate text-xs text-muted-foreground sm:block">{description}</p>
        </div>
        {actions ?? <div className="col-span-2 flex min-w-0 justify-end gap-2 sm:col-span-1">
            <Button type="button" variant="outline" size="sm" disabled={saving} onClick={onBack}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              data-testid="inventory-editor-save"
              disabled={saving || saveDisabled}
              onClick={onSave}
            >
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              <span className="hidden sm:inline">{saving ? "Saving…" : saveLabel}</span>
              <span className="sm:hidden">{saving ? "Saving" : "Save"}</span>
            </Button>
          </div>}
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-5xl space-y-4 px-3 py-4 sm:px-5 sm:py-6">
          <p className="text-sm leading-relaxed text-muted-foreground sm:hidden">{description}</p>
          {children}
        </div>
      </div>
      {footer && <DialogFooter className={stickyFooter
        ? "sticky bottom-0 z-20 shrink-0 flex-row flex-wrap justify-start gap-2 border-t bg-background/95 px-3 py-2.5 backdrop-blur sm:px-5"
        : "mx-auto w-full max-w-5xl flex-col-reverse gap-2 border-t px-3 py-4 sm:flex-row sm:px-5 sm:py-6"}>
        {footer}
      </DialogFooter>}
    </section>
  );
  return portalHost ? createPortal(editor, portalHost) : editor;
}
