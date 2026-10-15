import { canonicalInventoryJson } from "@shared/inventory-engine";
import { shipmentCaptureSchema, type SavedShipmentDraft, type ShipmentCapture } from "@shared/inventory-shipment-draft-model";

type Attempt = {
  operationId: string;
  data: { id: string; revision: number; orderId: string; stage: SavedShipmentDraft["stage"]; capture: ShipmentCapture };
};
type Dependencies = {
  orderId: string; stage: SavedShipmentDraft["stage"]; ownerId?: string; initial?: SavedShipmentDraft;
  send: (attempt: Attempt) => Promise<SavedShipmentDraft>;
  find: (id: string) => Promise<SavedShipmentDraft | null | undefined>;
  confirmed: (draft: SavedShipmentDraft) => void;
};

/** One writer per open editor. Failed attempts retain their exact replay identity. */
export class ShipmentCheckpointWriter {
  private saved?: SavedShipmentDraft;
  private attempt?: Attempt;
  private tail: Promise<unknown> = Promise.resolve();
  private id: string;
  constructor(private deps: Dependencies) {
    this.saved = deps.initial;
    this.id = deps.initial?.id ?? crypto.randomUUID();
  }
  get draftId() { return this.id; }
  get current() { return this.saved; }
  accept(draft?: SavedShipmentDraft) { this.saved = draft; }
  save(capture: ShipmentCapture): Promise<SavedShipmentDraft> {
    // Snapshot at call time; no later scanner edits may change a queued body.
    const snapshot = structuredClone(capture);
    const result = this.tail.then(() => this.persist(snapshot));
    this.tail = result.catch(() => {});
    return result;
  }
  private confirm(attempt: Attempt, found?: SavedShipmentDraft) {
    if (!found || found.ownerId !== this.deps.ownerId || found.pending ||
      found.revision !== attempt.data.revision + 1 ||
      canonicalInventoryJson(found.capture) !== canonicalInventoryJson(attempt.data.capture))
      throw new Error("The saved draft changed in another session, or this checkpoint could not be confirmed. Your local capture is retained. Retry Save draft, or close and explicitly Resume the server version.");
    this.saved = found;
    this.attempt = undefined;
    this.deps.confirmed(found);
    return found;
  }
  private async sendAttempt() {
    const attempt = this.attempt!;
    try { return this.confirm(attempt, await this.deps.send(attempt)); }
    catch (cause) {
      // A read can confirm this exact revision/body, but cannot authorize
      // writing over another owner's/revision's capture after a conflict.
      let found: SavedShipmentDraft | undefined;
      try { found = await this.deps.find(attempt.data.id) ?? undefined; } catch {}
      if (found) return this.confirm(attempt, found);
      throw new Error(`${cause instanceof Error ? cause.message : "Save response was lost."} Your local capture is retained; reconnect and use Save draft to retry.`);
    }
  }
  private async persist(capture: ShipmentCapture): Promise<SavedShipmentDraft> {
    if (this.attempt) await this.sendAttempt();
    const validation = shipmentCaptureSchema.safeParse(capture);
    if (!validation.success) throw new Error(`Capture is not saved: ${validation.error.issues[0]?.message}. Correct it and use Save draft; your local capture is retained.`);
    if (this.saved && canonicalInventoryJson(this.saved.capture) === canonicalInventoryJson(capture)) return this.saved;
    const data = { id: this.id, revision: this.saved?.revision ?? 0, orderId: this.deps.orderId,
      stage: this.deps.stage, capture };
    if (new TextEncoder().encode(JSON.stringify(data)).length > 8 * 1024 * 1024)
      throw new Error("Checkpoint exceeds 8 MiB. Reduce the capture before saving; your local capture is retained.");
    this.attempt = {
      operationId: crypto.randomUUID(),
      data,
    };
    return this.sendAttempt();
  }
}
