import { useState } from "react";
import type { InventoryOrder, InventoryState } from "@shared/inventory";
import type { SavedShipmentDraft } from "@shared/inventory-shipment-draft-model";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { sendShipmentDraftCommand } from "@/components/inventory-shipment-draft-api";

type Props = {
  base: string;
  state: InventoryState;
  users: Array<{ id: string; username: string }>;
  orders: InventoryOrder[];
  userId?: string;
  isAdmin: boolean;
  onResume: (draft: SavedShipmentDraft, snapshot?: InventoryState) => void;
};

export function InventoryShipmentDraftsPanel({ base, state, users, orders, userId, isAdmin, onResume }: Props) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const drafts = state.shipmentDrafts ?? [];
  const remove = async (draft: SavedShipmentDraft) => {
    if (!window.confirm(`Discard the saved ${draft.stage} shipment draft for order ${draft.orderId}? This removes its saved capture.`)) return;
    setBusyId(draft.id);
    setError("");
    try {
      await sendShipmentDraftCommand(base, "shipmentDraftDelete", { id: draft.id, revision: draft.revision });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saved draft could not be discarded. Refresh inventory and retry.");
    } finally { setBusyId(""); }
  };

  return <Card>
    <CardHeader className="pb-3">
      <CardTitle>Saved shipment drafts</CardTitle>
      <CardDescription>Receiving, dispatch, and arrival captures are owner-only and do not reserve or change stock.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-2">
      {error && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Draft action not confirmed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {drafts.length ? drafts.map(draft => {
        const order = orders.find(value => value.id === draft.orderId);
        const owner = users.find(value => value.id === draft.ownerId)?.username ??
          (draft.ownerId === userId ? "Your account" : `Unavailable account (${draft.ownerId})`);
        const isOwner = draft.ownerId === userId;
        return <div key={draft.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 font-medium">
              <span className="font-mono">{draft.orderId}</span>
              <Badge variant="outline">{draft.stage === "receive" ? "Receiving" : draft.stage === "dispatch" ? "Dispatch" : "Arrival"}</Badge>
              {draft.pending && <Badge variant="destructive">Posting needs confirmation</Badge>}
              {!order && <Badge variant="destructive">Order unavailable</Badge>}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Saved {new Date(draft.savedAt).toLocaleString()} · Owner {owner} · Revision {draft.revision}</p>
            {!order && <p className="mt-1 text-xs text-destructive">Restore this order before resuming; saved capture remains intact.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {isOwner ? <>
              <Button size="sm" variant="outline" disabled={!order || !!busyId} onClick={() => onResume(draft)}>Resume</Button>
              <Button size="sm" variant="outline" disabled={!!draft.pending || !!busyId} onClick={() => void remove(draft)}>
                {busyId === draft.id ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />Discarding…</> : "Discard saved draft"}
              </Button>
            </> : isAdmin ? <Button size="sm" variant="outline" disabled={!!busyId || !order} onClick={async () => {
              if (!window.confirm(`Take ownership of ${draft.orderId} ${draft.stage} draft? Any unposted prepared attempt will be canceled atomically; the saved capture is retained. If already posted, its receipt will remain available for acknowledgement.`)) return;
              setBusyId(draft.id); setError("");
              try {
                const result = await sendShipmentDraftCommand(base, "shipmentDraftClaim", { id: draft.id, revision: draft.revision });
                const claimed = result.state.shipmentDrafts?.find(value => value.id === draft.id);
                if (!claimed) throw new Error("Ownership change was not confirmed. Refresh inventory and retry.");
                onResume(claimed, result.state);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Could not take ownership. Refresh inventory and retry.");
              } finally { setBusyId(""); }
            }}>{busyId === draft.id ? <><RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" />Taking ownership…</> : "Take ownership"}</Button> : null}
          </div>
        </div>;
      }) : <div className="rounded-md border border-dashed px-4 py-5 text-sm text-muted-foreground">No saved shipment captures. Save from a receiving, dispatch, or arrival session to resume it later.</div>}
    </CardContent>
  </Card>;
}
