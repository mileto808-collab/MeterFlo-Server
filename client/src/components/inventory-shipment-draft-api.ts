import type { InventoryCommand, InventoryState } from "@shared/inventory";
import type { SavedShipmentDraft, ShipmentCapture } from "@shared/inventory-shipment-draft-model";
import { queryClient } from "@/lib/queryClient";

export type InventorySnapshot = { enabled: boolean; timezone: string; state: InventoryState; permissions: string[]; users: Array<{ id: string; username: string }> };

export function shipmentDraftKey(base: string) {
  return [base] as const;
}

export async function refreshShipmentInventory(base: string): Promise<InventorySnapshot> {
  const response = await fetch(base, { credentials: "include" });
  if (!response.ok) throw new Error("Could not refresh inventory. Reconnect and retry.");
  const result = await response.json() as InventorySnapshot;
  await queryClient.setQueryData(shipmentDraftKey(base), result);
  return result;
}

export async function sendShipmentDraftCommand(
  base: string, action: InventoryCommand["action"], data: Record<string, unknown>,
  operationId: string = crypto.randomUUID(),
) {
  const response = await fetch(`${base}/commands`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operationId, action, data } satisfies InventoryCommand),
  });
  const body = await response.json().catch(() => null) as { state: InventoryState; operationId?: string; message?: string } | null;
  if (!response.ok || !body?.state) {
    await queryClient.invalidateQueries({ queryKey: shipmentDraftKey(base) });
    throw new Error(body && !response.ok ? body.message || "The saved shipment draft changed or could not be updated. Refresh inventory before continuing." :
      "The response was not confirmed. Refresh inventory to check whether the draft command completed.");
  }
  await queryClient.invalidateQueries({ queryKey: shipmentDraftKey(base) });
  return body;
}

export async function findSavedShipmentDraft(base: string, id: string): Promise<SavedShipmentDraft | null> {
  const latest = await refreshShipmentInventory(base);
  return latest.state.shipmentDrafts?.find(draft => draft.id === id) ?? null;
}

export function captureFromDraft(draft: SavedShipmentDraft): ShipmentCapture {
  return {
    entries: Object.fromEntries(Object.entries(draft.capture.entries).map(([id, row]) => [id, {
      ...row, goodSerials: [...row.goodSerials], damagedSerials: [...row.damagedSerials], expectedSerials: [...row.expectedSerials],
    }])),
    scanBuffers: { ...draft.capture.scanBuffers }, reason: draft.capture.reason, closeRemainder: draft.capture.closeRemainder,
  };
}
