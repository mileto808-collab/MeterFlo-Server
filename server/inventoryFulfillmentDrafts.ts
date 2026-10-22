import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "./db";
import { lockInventory, saveInventory } from "./inventoryService";
import { readRelationalInventory } from "./inventoryRelational";
import { fulfillmentOrders } from "./inventoryFulfillment";
import { canonicalInventoryJson, InventoryError } from "../shared/inventory-engine";
import {
  fulfillmentDraftCaptureSchema, meaningfulFulfillmentDraft, savedFulfillmentDraftSchema,
  type SavedFulfillmentDraft,
} from "../shared/inventory-fulfillment-drafts";
import type { InventoryState } from "../shared/inventory";
import type { PoolClient } from "pg";

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
  const mutate = (remove: boolean) => handler(async (req, res) => {
    const c = res.locals.inventory;
    requireFulfillment(c);
    const id = z.string().uuid().parse(req.params.id);
    const input = (remove
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
      // A lost response must not create another draft or turn a successful save into a conflict.
      if (remove && !previous) {
        await client.query("COMMIT");
        return { deleted: true };
      }
      if (!remove && previous && previous.revision === input.revision + 1 &&
          previous.updatedBy === c.user.id && "capture" in input &&
          canonicalInventoryJson(previous.capture) === canonicalInventoryJson(input.capture)) {
        if (!await canReadDraft(client, c, before, previous))
          throw Object.assign(new InventoryError("Work-order access is required for this saved draft."), { status: 403 });
        await client.query("COMMIT");
        return { draft: previous };
      }
      if ((previous?.revision ?? 0) !== input.revision)
        throw conflict("This draft was changed, used, or cleared by another user. Reopen it from Resume saved batch; your inputs have been kept.");
      if (previous && !await canReadDraft(client, c, before, previous))
        throw Object.assign(new InventoryError("Work-order access is required for this saved draft."), { status: 403 });
      const after = structuredClone(before);
      let saved: SavedFulfillmentDraft | undefined;
      if (remove) {
        if (!previous) throw conflict("This saved draft is no longer available.");
        after.fulfillmentDrafts = (after.fulfillmentDrafts ?? []).filter(draft => draft.id !== id);
      } else {
        const capture = fulfillmentDraftCaptureSchema.parse("capture" in input ? input.capture : undefined);
        if (!meaningfulFulfillmentDraft(capture)) throw new InventoryError("Choose work orders or enter batch setup before saving a draft.");
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
      await saveInventory(client, c.project.id, before, after, randomUUID(), remove ? "fulfillmentDraftDelete" : "fulfillmentDraftSave");
      await client.query("COMMIT");
      return remove ? { deleted: true } : { draft: saved };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
  app.post(`${base}/fulfillment-drafts/:id`, mutate(false));
  app.delete(`${base}/fulfillment-drafts/:id`, mutate(true));
}
