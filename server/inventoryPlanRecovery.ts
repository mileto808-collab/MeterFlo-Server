import type { Express } from "express";
import type { PoolClient } from "pg";
import { createHash } from "node:crypto";
import { z } from "zod";
import { inventoryCommandSchema } from "../shared/inventory";
import { canonicalInventoryJson } from "../shared/inventory-engine";
import { lockInventory, saveInventory } from "./inventoryService";
import { pool } from "./db";
import { storage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { resolvePlanOutcome } from "../shared/inventory-plan-recovery";
import { workPlanInputSchema } from "../shared/inventory-planning";

export const planRecoveryCapability = { version: 1, modes: ["lookup", "resolve"] as const };
const requestSchema = z.object({
  command: inventoryCommandSchema.refine(command => command.action === "plan", "Only plan commands are supported."),
  mode: z.enum(["lookup", "resolve"]).default("lookup"),
}).strict();

// Deliberately outside ordinary inventory middleware: historical evidence is
// independent of current edit/status/inventory-enabled checks, not authentication
// or current project membership. No cross-account administrator override.
export function registerPlanRecoveryRoutes(app: Express) {
  const base = "/api/projects/:projectId/work-orders/:workOrderId/inventory/plan-recovery";
  app.get("/api/inventory/plan-recovery-capabilities", isAuthenticated, async (req: any, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (!user || user.isLocked) return res.status(401).json({ message: "Sign in required." });
      res.json(planRecoveryCapability);
    } catch {
      res.status(503).json({ message: "Recovery capability could not be verified." });
    }
  });
  app.post(base, isAuthenticated, async (req: any, res) => {
    res.set("Cache-Control", "no-store");
    const project = z.coerce.number().int().positive().safeParse(req.params.projectId);
    const workOrder = z.coerce.number().int().positive().safeParse(req.params.workOrderId);
    const input = requestSchema.safeParse(req.body);
    if (!project.success || !workOrder.success || !input.success ||
        !workPlanInputSchema.safeParse(input.data.command.data).success ||
        input.data.command.data.workOrderId !== workOrder.data)
      return res.status(400).json({ message: "A valid exact plan command matching the requested work order is required." });
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      await client.query("BEGIN");
      // The project lock orders recovery with inventory commands and project
      // changes. The inventory root lock also orders it with delayed original POSTs.
      const { rows: [p] } = await client.query("SELECT id FROM public.projects WHERE id=$1 FOR SHARE", [project.data]);
      const user = await storage.getUser(req.user.claims.sub);
      if (!user || user.isLocked || !p || !await storage.isAdminUser(user) &&
          !await storage.isUserAssignedToProject(user.id, project.data)) {
        await client.query("ROLLBACK");
        return res.status(403).json({ message: "Recovery access is unavailable. Keep the original command and contact an authorized administrator to restore legitimate access." });
      }
      const { command, mode } = input.data;
      const state = await lockInventory(client, project.data);
      const resolution = resolvePlanOutcome(state, command, user.id, mode);
      if (resolution.state !== state)
        await saveInventory(client, project.data, state, resolution.state, command.operationId, "planRecoveryFence");
      await client.query("COMMIT");
      return res.json({
        version: 1, projectId: project.data, workOrderId: workOrder.data, actorId: user.id,
        action: "plan", operationId: command.operationId,
        fingerprint: createHash("sha256").update(canonicalInventoryJson({ action: command.action, data: command.data, actor: user.id })).digest("hex"),
        ...resolution.result,
      });
    } catch (error) {
      if (client) await client.query("ROLLBACK").catch(() => {});
      console.error("Plan operation recovery failed", error);
      return res.status(503).json({ message: "Plan recovery is unavailable; keep the original command unchanged." });
    } finally { client?.release(); }
  });
}
