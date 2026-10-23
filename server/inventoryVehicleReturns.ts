import type { Express } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { storage } from "./storage";
import { inventoryState, lockInventory, saveInventory } from "./inventoryService";
import { readRelationalInventory } from "./inventoryRelational";
import { workRows } from "./inventoryVehicleTransfer";
import { inventoryWorkOrderLabels } from "./inventoryWorkOrderLabels";
import { applyInventoryCommand, canonicalInventoryJson, reserved } from "../shared/inventory-engine";
import { InventoryError } from "../shared/inventory-errors";
import { warehouseAccessible, isStagingType } from "../shared/inventory-location-types";
import { isLaborItem } from "../shared/inventory-pricing";
import { assertVehicleReturnDraft, meaningfulVehicleReturn, vehicleReturnCaptureSchema, vehicleReturnKindSchema,
  type VehicleReturnCapture, type SavedVehicleReturnDraft, type VehicleReturnKind } from "../shared/inventory-vehicle-returns";
import type { InventoryState, InventoryCommand } from "../shared/inventory";

const conflict = (text: string) => Object.assign(new InventoryError(text), { status: 409 });
const forbidden = () => Object.assign(new InventoryError("This vehicle workflow requires current project, location and action permissions."), { status: 403 });
export async function vehicleReturnAllowed(user: any, kind: VehicleReturnKind) {
  const keys = ["inventory.view", ...(kind === "count" ? ["inventory.count"] :
    kind === "equipment" ? ["inventory.receive"] : ["inventory.receive", "inventory.transfer"])];
  return !!user && !user.isLocked && (await Promise.all(keys.map(key => storage.hasPermission(user, key)))).every(Boolean);
}
export async function authorizeVehicleReturn(state: InventoryState, capture: VehicleReturnCapture, user: any, admin: boolean) {
  if (!await vehicleReturnAllowed(user, capture.kind)) throw forbidden();
  for (const id of [capture.sourceId, capture.kind === "count" ? "" : capture.destinationId].filter(Boolean)) {
    const location = state.warehouses.find(row => row.id === id);
    if (!location || !warehouseAccessible(state, location, user.id, admin)) throw forbidden();
  }
  if (capture.kind === "equipment") for (const id of capture.returnIds) {
    const record = state.returns.find(row => row.id === id);
    const location = state.warehouses.find(row => row.id === record?.warehouseId);
    if (record && location && !warehouseAccessible(state, location, user.id, admin)) throw forbidden();
  }
}
async function protectedStock(client: PoolClient, projectId: number, state: InventoryState, sourceId: string, lock = false) {
  const batches = (state.fulfillmentBatches ?? []).filter(batch => batch.status !== "cancelled");
  const ids = [...new Set(batches.flatMap(batch => batch.workOrders
    .filter(work => (work.vehicleId ?? batch.vehicleId) === sourceId).map(work => work.workOrderId)))];
  const rows = await workRows(client, projectId, ids, lock);
  const { rows: statuses } = await client.query("SELECT code,label FROM public.work_order_statuses");
  const demand = new Map<string, number>();
  for (const row of rows) {
    const status = statuses.find(value => [value.code, value.label].some(text => String(text).toLowerCase() === String(row.status).toLowerCase()));
    if (["completed", "complete", "cancelled", "canceled"].includes(String(status?.code ?? row.status).toLowerCase())) continue;
    if (state.allocations.some(value => value.workOrderId === row.id && value.status === "consumed")) continue;
    // A work order can appear in historical batches. Protect the latest current dispatch only.
    const batch = [...batches].reverse().find(batch => batch.workOrders.some(work => work.workOrderId === row.id));
    if (!batch || !batch.workOrders.some(work => work.workOrderId === row.id && (work.vehicleId ?? batch.vehicleId) === sourceId)) continue;
    for (const line of batch.lines.filter(line => line.workOrderId === row.id && line.deliveredQuantity > 0))
      demand.set(line.itemId, (demand.get(line.itemId) ?? 0) + line.deliveredQuantity);
  }
  return demand;
}
export async function prepareVehicleReturn(client: PoolClient, projectId: number, state: InventoryState,
  command: InventoryCommand, user: any, admin: boolean, dry = false) {
  const draft = assertVehicleReturnDraft(state, command, canonicalInventoryJson);
  await authorizeVehicleReturn(state, draft.capture, user, admin);
  if (!admin && !await storage.isUserAssignedToProject(user.id, projectId)) throw forbidden();
  if (draft.capture.kind === "stock") {
    const protectedItems = await protectedStock(client, projectId, state, draft.capture.sourceId, !dry);
    for (const itemId of draft.capture.itemIds) {
      const balance = state.stock.find(row => row.warehouseId === draft.capture.sourceId && row.itemId === itemId);
      const held = Math.max(protectedItems.get(itemId) ?? 0, reserved(state, draft.capture.sourceId, itemId));
      if (Number(draft.capture.quantities[itemId]) > (balance?.quantity ?? 0) - held)
        throw conflict("This stock is reserved or still needed by outstanding dispatched work. Complete, reassign or explicitly release that work before unloading; no stock moved.");
    }
  }
}
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
export function registerVehicleReturnRoutes(app: Express, base: string,
  handler: (fn: (req: any, res: any) => Promise<any>) => any) {
  const prefix = `${base}/vehicle-return-workflows`;
  app.get(prefix, handler(async (req, res) => {
    const c = res.locals.inventory, kind = vehicleReturnKindSchema.parse(req.query.kind);
    if (!c.project.inventoryEnabled || !await vehicleReturnAllowed(c.user, kind)) throw forbidden();
    const sourceId = typeof req.query.sourceId === "string" ? req.query.sourceId : "";
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const state = await readRelationalInventory(client, c.project.id, { readOnly: true });
      const accessible = state.warehouses.filter(row => row.active && warehouseAccessible(state, row, c.user.id, c.admin));
      if (sourceId && !accessible.some(row => row.id === sourceId && row.type === "vehicle")) throw forbidden();
      const protectedItems = kind === "stock" && sourceId ? await protectedStock(client, c.project.id, state, sourceId) : new Map<string, number>();
      const equipment = state.returns.filter(row => row.status === "pending" && row.disposition === "returned" &&
        (!row.warehouseId || accessible.some(location => location.id === row.warehouseId))).map(row => {
        const allocation = state.allocations.find(value => value.workOrderId === row.workOrderId);
        const usedVehicles = [...new Set((allocation?.used ?? []).map(line => line.warehouseId)
          .filter(id => state.warehouses.some(location => location.id === id && location.type === "vehicle")))];
        const dispatched = [...(state.fulfillmentBatches ?? [])].reverse().find(batch => batch.workOrders.some(work => work.workOrderId === row.workOrderId));
        const expectedVehicleId = state.warehouses.some(location => location.id === row.warehouseId && location.type === "vehicle")
          ? row.warehouseId : usedVehicles.length === 1 ? usedVehicles[0] :
            dispatched?.workOrders.find(work => work.workOrderId === row.workOrderId)?.vehicleId ?? dispatched?.vehicleId ?? null;
        return { ...row, expectedVehicleId, label: `${row.equipment} ${row.serial} · Work order ${row.workOrderId}` };
      });
      if (kind === "equipment") {
        const labels = await inventoryWorkOrderLabels(c.project.databaseName, equipment.map(row => row.workOrderId));
        for (const row of equipment) row.label = `${row.equipment} ${row.serial} · Work order ${labels[String(row.workOrderId)] ?? row.workOrderId}`;
      }
      const drafts: SavedVehicleReturnDraft[] = [];
      for (const draft of state.vehicleReturnDrafts ?? []) if (draft.capture.kind === kind &&
          ["editing", "submitting"].includes(draft.status)) {
        try { await authorizeVehicleReturn(state, draft.capture, c.user, c.admin); drafts.push(draft); } catch {}
      }
      await client.query("COMMIT");
      return { revision: state.revision, vehicles: accessible.filter(row => row.type === "vehicle"),
        destinations: accessible.filter(row => row.type === "physical" &&
          (kind !== "equipment" || !isStagingType(state.locationTypes?.find(type => type.id === row.locationTypeId)))),
        items: state.items.filter(row => row.active && !isLaborItem(row)),
        stock: state.stock.filter(row => row.warehouseId === sourceId).map(row => ({ ...row,
          serials: kind === "stock" ? row.serials.filter(serial => !state.allocations.some(allocation => allocation.status === "reserved" &&
            allocation.lines.some(line => line.warehouseId === sourceId && line.itemId === row.itemId && line.serials.includes(serial)))) : row.serials,
          available: Math.max(0, row.quantity - Math.max(reserved(state, row.warehouseId, row.itemId), protectedItems.get(row.itemId) ?? 0)) })),
        equipment: kind === "equipment" ? equipment : [], drafts: drafts.sort((a, b) => b.savedAt.localeCompare(a.savedAt)) };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }));
  app.get(`${prefix}/drafts/:id`, handler(async (req, res) => {
    const c = res.locals.inventory;
    if (!c.project.inventoryEnabled) throw forbidden();
    const id = z.string().uuid().parse(req.params.id);
    const state = await inventoryState(c.project.id);
    const draft = state.vehicleReturnDrafts?.find(row => row.id === id);
    if (!draft) throw Object.assign(new InventoryError("Saved vehicle workflow not found."), { status: 404 });
    await authorizeVehicleReturn(state, draft.capture, c.user, c.admin);
    return { draft };
  }));
  const mutate = (action: "save" | "delete" | "prepare" | "unlock") => handler(async (req, res) => {
    const c = res.locals.inventory, id = z.string().uuid().parse(req.params.id);
    const revision = z.number().int().nonnegative().parse(req.body?.revision);
    const saved = action === "save" ? z.object({ revision: z.number().int().nonnegative(), saveId: z.string().uuid(),
      capture: vehicleReturnCaptureSchema }).strict().parse(req.body) : undefined;
    const prepare = action === "prepare" ? z.object({ revision: z.number().int().positive(),
      operationId: z.string().uuid(), physicallyConfirmed: z.literal(true) }).strict().parse(req.body) : undefined;
    const unlock = action === "unlock" ? z.object({ revision: z.number().int().positive(),
      operationId: z.string().uuid() }).strict().parse(req.body) : undefined;
    if (action === "delete") z.object({ revision: z.number().int().positive() }).strict().parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [project] } = await client.query("SELECT inventory_enabled,is_active FROM public.projects WHERE id=$1 FOR SHARE", [c.project.id]);
      if (!project?.inventory_enabled || project.is_active === false) throw conflict("An active inventory-enabled project is required.");
      const before = await lockInventory(client, c.project.id), after = structuredClone(before);
      const prior = before.vehicleReturnDrafts?.find(row => row.id === id);
      if (prior) await authorizeVehicleReturn(before, prior.capture, c.user, c.admin);
      if (saved) await authorizeVehicleReturn(before, saved.capture, c.user, c.admin);
      if (!prior && !saved) throw conflict("Saved draft not found.");
      if (saved && prior?.status === "editing") {
        if (canonicalInventoryJson(prior.capture) === canonicalInventoryJson(saved.capture)) {
          await client.query("COMMIT"); return { draft: prior };
        }
        if (prior.saveId === saved.saveId) throw conflict("This save identity has different inputs.");
      }
      if (prepare && prior?.command?.operationId === prepare.operationId &&
          ["submitting", "posted"].includes(prior.status)) { await client.query("COMMIT"); return { draft: prior }; }
      if (unlock && prior?.status === "posted" && prior.command?.operationId === unlock.operationId) {
        await client.query("COMMIT"); return { draft: prior, receiptId: prior.receiptId };
      }
      if (action === "delete" && prior?.status === "deleted") { await client.query("COMMIT"); return { deleted: true }; }
      if ((prior?.revision ?? 0) !== revision) throw conflict("Another user changed this draft. Your local inputs remain available; reopen the latest shared draft.");
      const now = new Date().toISOString();
      let draft: SavedVehicleReturnDraft;
      if (saved) {
        if (prior && prior.status !== "editing") throw conflict("Resolve the pending request before editing this draft.");
        if (!meaningfulVehicleReturn(saved.capture)) throw conflict("Enter meaningful inputs before saving a draft.");
        if (prior && prior.capture.kind !== saved.capture.kind) throw conflict("Start a separate draft for a different workflow.");
        draft = { id, status: "editing", revision: revision + 1, capture: saved.capture,
          baseline: prior?.capture.sourceId === saved.capture.sourceId ? prior.baseline :
            structuredClone(before.stock.filter(row => row.warehouseId === saved.capture.sourceId)),
          createdBy: prior?.createdBy ?? c.user.id, updatedBy: c.user.id, savedAt: now, saveId: saved.saveId };
      } else {
        draft = structuredClone(prior!);
        if (action === "delete") {
          if (draft.status !== "editing") throw conflict("Resolve this request's outcome before deleting.");
          draft.status = "deleted"; draft.revision++;
        } else if (prepare) {
          if (draft.status !== "editing") throw conflict("Resolve the existing request first.");
          draft.status = "submitting"; draft.command = { operationId: prepare.operationId, action: "vehicleReturn",
            data: { draftId: id, draftRevision: draft.revision, physicallyConfirmed: true } };
          if (before.operations[prepare.operationId]) throw conflict("This posting identity is already in use.");
          after.vehicleReturnDrafts = [...(after.vehicleReturnDrafts ?? []).filter(row => row.id !== id), draft];
          await prepareVehicleReturn(client, c.project.id, after, draft.command as InventoryCommand, c.user, c.admin, true);
          applyInventoryCommand(structuredClone(after), draft.command as InventoryCommand, c.user.id, c.admin);
        } else if (unlock) {
          const abandonedPreparation = draft.status === "editing" && !draft.command;
          if (!abandonedPreparation && (draft.status !== "submitting" || draft.command?.operationId !== unlock.operationId))
            throw conflict("This pending request changed; reopen its current shared status.");
          if (before.operations[unlock.operationId] || before.receipts.some(row => row.id === unlock.operationId))
            throw conflict("Posting evidence exists. Open the receipt rather than starting another movement.");
          draft.status = "editing"; draft.revision++; delete draft.command;
        }
        draft.savedAt = now; draft.updatedBy = c.user.id;
      }
      after.vehicleReturnDrafts = [...(after.vehicleReturnDrafts ?? []).filter(row => row.id !== id), draft];
      after.revision++;
      await saveInventory(client, c.project.id, before, after, randomUUID(), `vehicleReturnDraft${action}`);
      await client.query("COMMIT");
      return action === "delete" ? { deleted: true } : { draft };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  });
  app.post(`${prefix}/drafts/:id`, mutate("save"));
  app.delete(`${prefix}/drafts/:id`, mutate("delete"));
  app.post(`${prefix}/drafts/:id/prepare`, mutate("prepare"));
  app.post(`${prefix}/drafts/:id/unlock`, mutate("unlock"));
  app.get(`${prefix}/receipts/:id/print`, handler(async (req, res) => {
    const c = res.locals.inventory, state = await inventoryState(c.project.id);
    const receipt = state.receipts.find(row => row.id === req.params.id && row.vehicleReturn);
    if (!receipt?.vehicleReturn) throw conflict("Vehicle workflow receipt not found.");
    const proof = receipt.vehicleReturn;
    await authorizeVehicleReturn(state, { kind: proof.kind, sourceId: proof.sourceId, destinationId: proof.destinationId,
      itemIds: [], returnIds: [], quantities: {}, scans: {}, reason: "" }, c.user, c.admin);
    const location = (id: string) => state.warehouses.find(row => row.id === id)?.name ?? id;
    const items = receipt.lines.map(line => `<tr><td>${esc(state.items.find(row => row.id === line.itemId)?.name ?? line.itemId)}</td><td>${line.quantity}</td><td>${esc(line.serials.join(", "))}</td></tr>`).join("");
    const equipment = (proof.equipment ?? []).map(row => `<tr><td>${esc(row.equipment)}</td><td>${esc(row.serial)}</td><td>Work order ${row.workOrderId} · Quarantine</td></tr>`).join("");
    const differences = (proof.counts ?? []).map(row => `<tr><td>${esc(state.items.find(item => item.id === row.itemId)?.name ?? row.itemId)}</td><td>Expected ${row.expected}; actual ${row.actual}</td><td>Missing: ${esc(row.missing.join(", ") || "none")}<br>Unexpected: ${esc(row.unexpected.join(", ") || "none")}</td></tr>`).join("");
    const date = new Intl.DateTimeFormat("en-US", { timeZone: c.project.timezone ?? "UTC", dateStyle: "medium", timeStyle: "short" }).format(new Date(receipt.occurredAt));
    res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(receipt.reference)}</title><style>body{font:14px system-ui;margin:32px}table{width:100%;border-collapse:collapse}td,th{padding:8px;border:1px solid #ccc;text-align:left;overflow-wrap:anywhere}h1{font-size:22px}@media print{button{display:none}}</style></head><body><button onclick="window.print()">Print receipt</button><h1>${esc(receipt.reference)}</h1><p>Receipt ${esc(receipt.id)}</p><p>${esc(date)} (${esc(c.project.timezone ?? "UTC")}) · Recorded by ${esc(receipt.actor)}</p><p>${esc(location(proof.sourceId))} → ${esc(location(proof.destinationId || proof.sourceId))}</p><p>${esc(receipt.reason)}</p>${proof.needsReview ? "<strong>Discrepancies recorded; no stock adjustment made. Resolve the open count in Cycle counts.</strong>" : ""}<table><tbody>${items}${equipment}${differences}</tbody></table></body></html>`);
  }));
}
