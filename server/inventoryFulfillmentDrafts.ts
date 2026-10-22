import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "./db";
import { lockInventory, saveInventory } from "./inventoryService";
import { readRelationalInventory } from "./inventoryRelational";
import { fulfillmentOrders } from "./inventoryFulfillment";
import { canonicalInventoryJson, InventoryError, warehouseAccess } from "../shared/inventory-engine";
import {
  emptyFulfillmentDraftCapture, fulfillmentDraftCaptureSchema, meaningfulFulfillmentDraft, savedFulfillmentDraftSchema,
  type SavedFulfillmentDraft,
} from "../shared/inventory-fulfillment-drafts";
import type { InventoryState } from "../shared/inventory";
import type { PoolClient } from "pg";
import { fulfillmentDeletionStatus } from "../shared/inventory-fulfillment-deletion";

const conflict = (message: string) => Object.assign(new InventoryError(message), { status: 409 });
async function canReadDraft(client: PoolClient, context: any, state: InventoryState, draft: SavedFulfillmentDraft) {
  const ids = [...new Set(draft.capture.selectedIds)];
  if (!ids.length) return true;
  const visible = await fulfillmentOrders(client, context.project.id, state, context.user, ids);
  return ids.every(id => visible.some(order => order.workOrderId === id));
}

/** Shares setup captures, not inventory custody. All writes use the inventory aggregate lock. */
export function registerFulfillmentDraftRoutes(
  app: Express, base: string,
  handler: (fn: (req: any, res: any) => Promise<any>) => any,
  requireFulfillment: (context: any) => void,
) {
  app.get(`${base}/fulfillment-drafts`, handler(async (_req, res) => {
    const c = res.locals.inventory;
    requireFulfillment(c);
    if (!c.project.inventoryEnabled) throw new InventoryError("Project inventory is disabled.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const state = await readRelationalInventory(client, c.project.id, { readOnly: true });
      const drafts: SavedFulfillmentDraft[] = [];
      for (const draft of state.fulfillmentDrafts ?? [])
        if (await canReadDraft(client, c, state, draft)) drafts.push(draft);
      await client.query("COMMIT");
      return { drafts: drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt)) };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }));
  const mutate = (remove: boolean, clear = false) => handler(async (req, res) => {
    const c = res.locals.inventory;
    requireFulfillment(c);
    const id = z.string().uuid().parse(req.params.id);
    const input = (remove || clear
      ? z.object({ revision: z.number().int().positive() }).strict()
      : z.object({ revision: z.number().int().nonnegative(), capture: fulfillmentDraftCaptureSchema }).strict()
    ).parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [project] } = await client.query(
        "SELECT inventory_enabled,is_active,wizard_mode FROM public.projects WHERE id=$1 FOR SHARE", [c.project.id]);
      if (!project?.inventory_enabled || project.is_active === false || project.wizard_mode === "reading_only")
        throw new InventoryError("An active inventory-enabled changeout project is required.");
      const before = await lockInventory(client, c.project.id);
      const previous = before.fulfillmentDrafts?.find(draft => draft.id === id);
      if (!remove && !clear && !previous && input.revision === 0) {
        const { rows: [retired] } = await client.query(
          `SELECT EXISTS(SELECT 1 FROM public.inventory_movements
             WHERE project_id=$1 AND changes->'entities' @> $2::jsonb) AS found`,
          [c.project.id, JSON.stringify([{ field: `fulfillmentDrafts/${id}`, after: null }])]);
        if (retired?.found) throw conflict("This saved draft was deleted or used to create a batch. An old autosave cannot recreate it.");
      }
      // A lost response must not create another draft or turn a successful save into a conflict.
      if (remove && !previous) {
        await client.query("COMMIT");
        return { deleted: true };
      }
      if (clear && !previous) throw conflict("This draft was deleted or used to create a batch. Reload Resume saved batch.");
      const capture = remove ? undefined : clear
        ? emptyFulfillmentDraftCapture(previous!.mode)
        : fulfillmentDraftCaptureSchema.parse("capture" in input ? input.capture : undefined);
      if (!remove && previous && previous.revision === input.revision + 1 &&
          previous.updatedBy === c.user.id &&
          canonicalInventoryJson(previous.capture) === canonicalInventoryJson(capture)) {
        if (!await canReadDraft(client, c, before, previous))
          throw Object.assign(new InventoryError("Work-order access is required for this saved draft."), { status: 403 });
        await client.query("COMMIT");
        return { draft: previous };
      }
      if ((previous?.revision ?? 0) !== input.revision)
        throw conflict("This draft was changed, used, or deleted by another user. Reopen it from Resume saved batch; your inputs have been kept.");
      if (previous && !await canReadDraft(client, c, before, previous))
        throw Object.assign(new InventoryError("Work-order access is required for this saved draft."), { status: 403 });
      const after = structuredClone(before);
      let saved: SavedFulfillmentDraft | undefined;
      if (remove) {
        if (!previous) throw conflict("This saved draft is no longer available.");
        after.fulfillmentDrafts = (after.fulfillmentDrafts ?? []).filter(draft => draft.id !== id);
      } else {
        if (!capture) throw new InventoryError("Draft inputs are required.");
        if (!clear && !meaningfulFulfillmentDraft(capture)) throw new InventoryError("Choose work orders or enter batch setup before saving a draft.");
        if (new Set(capture.selectedIds).size !== capture.selectedIds.length)
          throw new InventoryError("Select each work order only once.");
        saved = savedFulfillmentDraftSchema.parse({
          id, revision: input.revision + 1, name: capture.name.trim() || (capture.mode === "crew" ? "Crew batch draft" : "Scheduled work draft"),
          mode: capture.mode, createdBy: previous?.createdBy ?? c.user.id,
          updatedBy: c.user.id, savedAt: new Date().toISOString(), capture,
        });
        if (!await canReadDraft(client, c, before, saved))
          throw Object.assign(new InventoryError("One or more selected work orders are not accessible."), { status: 403 });
        after.fulfillmentDrafts = [...(after.fulfillmentDrafts ?? []).filter(draft => draft.id !== id), saved];
      }
      after.revision++;
      await saveInventory(client, c.project.id, before, after, randomUUID(),
        remove ? "fulfillmentDraftDelete" : clear ? "fulfillmentDraftClear" : "fulfillmentDraftSave");
      await client.query("COMMIT");
      return remove ? { deleted: true } : { draft: saved };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
  app.post(`${base}/fulfillment-drafts/:id`, mutate(false));
  app.post(`${base}/fulfillment-drafts/:id/clear`, mutate(false, true));
  app.delete(`${base}/fulfillment-drafts/:id`, mutate(true));
  app.delete(`${base}/fulfillment/:id`, handler(async (req, res) => {
    const c = res.locals.inventory;
    requireFulfillment(c);
    const id = z.string().uuid().parse(req.params.id);
    const { revision } = z.object({ revision: z.number().int().positive() }).strict().parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [project] } = await client.query(
        "SELECT inventory_enabled,is_active,wizard_mode FROM public.projects WHERE id=$1 FOR SHARE", [c.project.id]);
      if (!project?.inventory_enabled || project.is_active === false || project.wizard_mode === "reading_only")
        throw new InventoryError("An active inventory-enabled changeout project is required.");
      const before = await lockInventory(client, c.project.id);
      const batch = before.fulfillmentBatches?.find(value => value.id === id);
      if (!batch) {
        await client.query("COMMIT");
        return { deleted: true };
      }
      const orders = await fulfillmentOrders(client, c.project.id, before, c.user, batch.workOrders.map(work => work.workOrderId));
      if (!batch.workOrders.every(work => orders.some(order => order.workOrderId === work.workOrderId)))
        throw Object.assign(new InventoryError("Work-order access is required to delete this batch."), { status: 403 });
      for (const warehouse of [batch.sourceId, batch.stagingId, batch.vehicleId])
        warehouseAccess(before, warehouse, c.user.id, c.admin);
      if (batch.revision !== revision) throw conflict("This batch changed. Reload its latest progress before deleting it.");
      const deletion = fulfillmentDeletionStatus(before, batch);
      if (!deletion.allowed) throw conflict(deletion.reason!);
      const after = structuredClone(before);
      after.fulfillmentBatches = (after.fulfillmentBatches ?? []).filter(value => value.id !== id);
      const operationId = randomUUID(), deletedAt = new Date().toISOString();
      after.receipts.push({
        id: operationId, action: "fulfillmentDelete", reference: batch.id, warehouseId: null,
        lines: [], actor: c.user.id, occurredAt: deletedAt,
        reason: `Deleted batch ${batch.name}; no outstanding batch custody. Inventory and reversal history retained.`,
        fulfillmentDeletion: { batch: structuredClone(batch), deletedBy: c.user.id, deletedAt },
      });
      after.revision++;
      // Retain creation receipts, operation replay identities and the audit record.
      // Batch-only demand holds disappear with the batch; independent reservations stay intact.
      await saveInventory(client, c.project.id, before, after, operationId, "fulfillmentBatchDelete");
      await client.query("COMMIT");
      return { deleted: true };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }));
}
