import type { Express } from "express";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool } from "./db";
import { lockInventory, saveInventory } from "./inventoryService";
import { readRelationalInventory } from "./inventoryRelational";
import { vehicleTransferPermissions, prepareVehicleTransfer, canReadVehicleTransferCapture } from "./inventoryVehicleTransfer";
import { canonicalInventoryJson, applyInventoryCommand } from "../shared/inventory-engine";
import { InventoryError } from "../shared/inventory-errors";
import {
  meaningfulVehicleTransferDraft, vehicleDraftConflict, vehicleTransferDraftCaptureSchema,
  vehicleTransferDraftCommandSchema, type SavedVehicleTransferDraft, type VehicleTransferDraftCapture,
} from "../shared/inventory-vehicle-transfer-drafts";
import type { InventoryState } from "../shared/inventory";

const denied = () => Object.assign(new InventoryError("Vehicle handover draft access is required."), { status: 403 });
async function canRead(client: PoolClient, c: any, state: InventoryState, capture: VehicleTransferDraftCapture) {
  return canReadVehicleTransferCapture(client, c.project.id, state, capture, c.user, c.admin);
}
const commandIntent = (command: z.infer<typeof vehicleTransferDraftCommandSchema>) => {
  const { revision, draftId, draftRevision, ...intent } = command.data;
  return canonicalInventoryJson(intent);
};
function matchesCapture(capture: VehicleTransferDraftCapture, command: z.infer<typeof vehicleTransferDraftCommandSchema>) {
  const data = command.data;
  const ids = new Set(data.lines.map(line => line.itemId));
  const serials = (value: string) => value.split(/[\r\n,;\t]+/).map(value => value.trim()).filter(Boolean);
  return data.mode === capture.mode && data.sourceId === capture.sourceId && data.destinationId === capture.destinationId &&
    (data.batchId ?? "") === capture.batchId && (data.installerId ?? "") === capture.installerId &&
    data.reason === capture.reason.trim() &&
    Object.entries(capture.scans).every(([id, value]) => !value.trim() || ids.has(id)) &&
    (capture.mode !== "stock" || Object.entries(capture.quantities).every(([id, value]) =>
      !value.trim() || Number(value) === 0 || ids.has(id))) &&
    canonicalInventoryJson(data.workOrders.map(value => String(value.workOrderId)).sort()) ===
      canonicalInventoryJson([...capture.selectedOrders].sort()) &&
    data.lines.every(line => (capture.mode !== "stock" || Number(capture.quantities[line.itemId]) === line.quantity) &&
      canonicalInventoryJson(line.serials ?? []) === canonicalInventoryJson(serials(capture.scans[line.itemId] ?? "")));
}

/** Shares editable captures and fences exact pending commands through the existing aggregate transaction. */
export function registerVehicleTransferDraftRoutes(app: Express, base: string,
  handler: (fn: (req: any, res: any) => Promise<any>) => any) {
  app.get(`${base}/vehicle-transfer-drafts`, handler(async (_req, res) => {
    const c = res.locals.inventory;
    if (!c.project.inventoryEnabled || !(await vehicleTransferPermissions(c.user)).canStockTransfer) throw denied();
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const state = await readRelationalInventory(client, c.project.id, { readOnly: true });
      const drafts: SavedVehicleTransferDraft[] = [];
      for (const draft of state.vehicleTransferDrafts ?? [])
        if (["editing", "submitting"].includes(draft.status) && await canRead(client, c, state, draft.capture)) drafts.push(draft);
      await client.query("COMMIT");
      return { drafts: drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt)) };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }));
  const mutate = (action: "save" | "delete" | "prepare" | "unlock") => handler(async (req, res) => {
    const c = res.locals.inventory;
    if (!(await vehicleTransferPermissions(c.user)).canStockTransfer) throw denied();
    const id = z.string().uuid().parse(req.params.id);
    const revision = z.number().int().nonnegative().parse(req.body?.revision);
    const input = action === "save" ? z.object({ revision: z.number().int().nonnegative(), saveId: z.string().uuid(),
      capture: vehicleTransferDraftCaptureSchema }).strict().parse(req.body) : undefined;
    const submitted = action === "prepare" ? z.object({ revision: z.number().int().positive(),
      command: vehicleTransferDraftCommandSchema }).strict().parse(req.body) : undefined;
    const unlock = action === "unlock" ? z.object({ revision: z.number().int().positive(),
      operationId: z.string().uuid() }).strict().parse(req.body) : undefined;
    if (action === "delete") z.object({ revision: z.number().int().positive() }).strict().parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [project] } = await client.query(
        "SELECT inventory_enabled,is_active,wizard_mode FROM public.projects WHERE id=$1 FOR SHARE", [c.project.id]);
      if (!project?.inventory_enabled || project.is_active === false || project.wizard_mode === "reading_only")
        throw new InventoryError("An active inventory-enabled changeout project is required.");
      const before = await lockInventory(client, c.project.id);
      const prior = before.vehicleTransferDrafts?.find(value => value.id === id);
      if (prior && !await canRead(client, c, before, prior.capture)) throw denied();
      if (input && !await canRead(client, c, before, input.capture)) throw denied();
      if (input && prior?.status === "editing") {
        if (canonicalInventoryJson(prior.capture) === canonicalInventoryJson(input.capture)) {
          await client.query("COMMIT"); return { draft: prior };
        }
        if (prior.saveId === input.saveId)
          throw vehicleDraftConflict("This save identity belongs to different inputs. Retry its original request or reopen the shared draft.");
      }
      if (action === "delete" && prior?.status === "deleted") {
        await client.query("COMMIT"); return { deleted: true };
      }
      if (submitted && prior?.command?.operationId === submitted.command.operationId &&
          ["submitting", "posted"].includes(prior.status) && commandIntent(prior.command) === commandIntent(submitted.command)) {
        await client.query("COMMIT"); return { draft: prior };
      }
      if (unlock && prior?.status === "posted" && prior.command?.operationId === unlock.operationId) {
        await client.query("COMMIT"); return { draft: prior, receiptId: prior.receiptId };
      }
      if (unlock && prior && prior.command?.operationId !== unlock.operationId &&
          !before.operations[unlock.operationId] && !before.receipts.some(value => value.id === unlock.operationId)) {
        // Read under the command lock: this older request cannot pass the draft fence, even if it arrives later.
        await client.query("COMMIT");
        return { draft: prior, inactiveOperationId: unlock.operationId,
          receiptId: prior.status === "posted" ? prior.receiptId : undefined };
      }
      if ((prior?.revision ?? 0) !== revision)
        throw vehicleDraftConflict("Another user changed or resolved this handover draft. Your inputs are retained; reopen the current shared draft.");
      const after = structuredClone(before);
      const now = new Date().toISOString();
      let draft: SavedVehicleTransferDraft;
      if (input) {
        if (prior && prior.status !== "editing")
          throw vehicleDraftConflict("This handover was deleted, posted or has a pending request. It cannot be overwritten by an autosave.");
        if (!meaningfulVehicleTransferDraft(input.capture)) throw new InventoryError("Enter handover inputs before saving a draft.");
        draft = { id, revision: revision + 1, status: "editing", createdBy: prior?.createdBy ?? c.user.id,
          updatedBy: c.user.id, savedAt: now, saveId: input.saveId, capture: input.capture };
      } else {
        if (!prior) throw vehicleDraftConflict("This shared handover no longer exists.");
        draft = structuredClone(prior);
        draft.updatedBy = c.user.id; draft.savedAt = now;
        if (action === "delete") {
          if (prior.status !== "editing") throw vehicleDraftConflict("Resolve the pending handover first. Posted inventory history cannot be deleted.");
          draft.status = "deleted"; draft.revision++;
        } else if (submitted) {
          if (prior.status !== "editing") throw vehicleDraftConflict("Resolve the existing request before preparing another.");
          if (!matchesCapture(prior.capture, submitted.command))
            throw vehicleDraftConflict("Save the latest quantities, scans and selections before reviewing this handover.");
          const command = structuredClone(submitted.command);
          if (before.operations[command.operationId]) throw vehicleDraftConflict("This request identity was already used.");
          command.data.revision = before.revision;
          delete command.data.draftId; delete command.data.draftRevision;
          await prepareVehicleTransfer(client, c.project.id, before, command.data, c.user, c.admin);
          applyInventoryCommand(before, command, c.user.id, c.admin); // Validate only; never save this simulated movement.
          command.data.revision = before.revision + 1;
          command.data.draftId = id; command.data.draftRevision = prior.revision;
          draft.status = "submitting"; draft.command = command;
        } else if (unlock) {
          if (prior.status !== "submitting" || prior.command?.operationId !== unlock.operationId)
            throw vehicleDraftConflict("The saved request changed. Reload its current status.");
          const receipt = before.receipts.find(value => value.id === unlock.operationId);
          if (receipt || before.operations[unlock.operationId])
            throw vehicleDraftConflict("This handover already has posting evidence. Reopen its receipt rather than making a replacement movement.");
          draft.status = "editing"; draft.revision++; delete draft.command;
        } else throw new InventoryError("Invalid draft action.");
      }
      after.vehicleTransferDrafts = [...(after.vehicleTransferDrafts ?? []).filter(value => value.id !== id), draft];
      after.revision++;
      await saveInventory(client, c.project.id, before, after, randomUUID(), `vehicleTransferDraft${action[0].toUpperCase()}${action.slice(1)}`);
      await client.query("COMMIT");
      return action === "delete" ? { deleted: true } : { draft };
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
  app.post(`${base}/vehicle-transfer-drafts/:id`, mutate("save"));
  app.delete(`${base}/vehicle-transfer-drafts/:id`, mutate("delete"));
  app.post(`${base}/vehicle-transfer-drafts/:id/prepare`, mutate("prepare"));
  app.post(`${base}/vehicle-transfer-drafts/:id/unlock`, mutate("unlock"));
}
