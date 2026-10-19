import { inventoryDateTime } from "@shared/inventory-date-time";
import type { InventoryCount } from "@shared/inventory";
import { countRecoveryBaseline, type CountRecovery } from "@/lib/inventory-count-recovery";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { inventoryCountReference } from "@shared/inventory-count-reference";
import { useState } from "react";

function downloadRecovery(record: CountRecovery) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = "cycle-count-local-recovery.json"; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CountRecoveryInbox({ records, counts, onOpen, onDiscard, timezone }: {
  records: CountRecovery[]; counts: InventoryCount[];
  timezone: string;
  onOpen: (count: InventoryCount) => void; onDiscard: (record: CountRecovery) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!records.length) return null;
  return <>
    <Button size="sm" variant="outline" className="h-9" onClick={() => setOpen(true)}
      data-testid="count-local-recovery-inbox">Local recovery ({records.length})</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" onOpenAutoFocus={event => event.preventDefault()}>
        <DialogHeader><DialogTitle>Local count recovery</DialogTitle>
          <DialogDescription>Unsaved captures for your account and this project on this browser. Open a count to review its most recent capture. Nothing is posted automatically.</DialogDescription></DialogHeader>
        {records.map(record => {
          const count = counts.find(value => value.id === record.countId);
          return <div key={`${record.countId}:${record.writer}`} className="space-y-2 rounded border p-3">
            <p className="text-sm font-medium">{count ? inventoryCountReference(counts, count.id) : "Count no longer available"} · {record.rows.length} entries</p>
            <p className="text-xs text-muted-foreground">{inventoryDateTime(new Date(record.updatedAt), timezone)}{count?.status !== "open" && " · Cannot restore: count is closed or unavailable."}</p>
            <div className="flex flex-wrap gap-2">
              {count?.status === "open" && <Button size="sm" onClick={() => { setOpen(false); onOpen(count); }}>Open count</Button>}
              <Button size="sm" variant="outline" onClick={() => downloadRecovery(record)}>Download local copy</Button>
              <Button size="sm" variant="outline" onClick={() => {
                if (window.confirm("Permanently discard these unsaved entries from this browser? The server draft will not change.")) onDiscard(record);
              }}>Discard local recovery</Button>
            </div>
          </div>;
        })}
      </DialogContent>
    </Dialog>
  </>;
}

export function CountRecoveryNotice({ record, count, disabled, onRestore, onDiscard, timezone }: {
  record: CountRecovery; count: InventoryCount; disabled?: boolean; onRestore: () => void; onDiscard: () => void;
  timezone: string;
}) {
  const sameBaseline = record.baseline === countRecoveryBaseline(count);
  const newerDraft = record.revision !== (count.draft?.revision ?? 0);
  return <Alert data-testid="count-recovery-notice">
    <AlertTitle>Unsaved entries found on this device</AlertTitle>
    <AlertDescription className="space-y-2">
      <p>{record.rows.length} entries captured {inventoryDateTime(new Date(record.updatedAt), timezone)}. Nothing has been saved or posted automatically.</p>
      {newerDraft && <p>A different server draft revision exists. Restored entries can be reviewed, but saving and posting remain blocked until you reload the saved draft.</p>}
      {!sameBaseline && <p>The count snapshot has changed. Download your local copy for reference; these entries cannot be restored onto a different snapshot.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={disabled || !sameBaseline || count.status !== "open"} onClick={onRestore}>Restore local entries</Button>
        <Button type="button" size="sm" variant="outline" onClick={() => downloadRecovery(record)}>Download local copy</Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => {
          if (window.confirm("Permanently discard these unsaved entries from this browser? The server draft will not change.")) onDiscard();
        }}>Discard local recovery</Button>
      </div>
    </AlertDescription>
  </Alert>;
}
