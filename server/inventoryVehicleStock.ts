import type { Express } from "express";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "./db";
import { storage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { accessLockCapabilities } from "./accessLocks";
import { queryStock, queryStockSerials } from "./inventoryStockQueries";
import { serialQuerySchema, stockQuerySchema } from "../shared/inventory-stock-query";
import type { VehicleStockDirectory, VehicleStockLocation, VehicleStockResponse } from "../shared/inventory-vehicle-stock";

const deny = (message = "Vehicle inventory access required.", status = 403) => Object.assign(new Error(message), { status });
const projectFilter = z.coerce.number().int().positive().optional();
const vehicleQuery = z.object({ vehicle: z.string().min(1).max(200) });

/** Re-evaluate account, project locks, role and location access on every request. */
async function directory(client: PoolClient, userId: string, projectId?: number): Promise<VehicleStockDirectory> {
  const user = await storage.getUser(userId);
  if (!user || user.isLocked || user.role === "customer" || !await storage.hasPermission(user, "inventory.view")) throw deny();
  const admin = await storage.isAdminUser(user);
  const allVehicles = admin || await storage.hasPermission(user, "inventory.manageLocationTypes");
  const caps = await accessLockCapabilities(user);
  const { rows: locks } = await client.query("SELECT project_id FROM public.access_locks WHERE locked=true");
  if (!caps.site && locks.some(row => row.project_id === null)) throw deny("Access is temporarily locked.", 423);
  const blocked = new Set(locks.filter(row => row.project_id !== null).map(row => Number(row.project_id)));
  const { rows: membership } = admin ? { rows: [] } : await client.query(`SELECT project_id FROM public.user_projects WHERE user_id=$1
    UNION SELECT gp.project_id FROM public.user_group_members gm JOIN public.user_group_projects gp ON gp.group_id=gm.group_id
    WHERE gm.user_id=$1`, [userId]);
  const memberIds = new Set(membership.map(row => Number(row.project_id)));
  const inactive = await storage.hasPermission(user, "projects.viewInactive");
  const projects = (await storage.getProjects()).filter(project =>
    project.inventoryEnabled && (projectId === undefined || project.id === projectId) &&
    (admin || memberIds.has(project.id)) && (caps.project || !blocked.has(project.id)) &&
    (project.isActive !== false || inactive));
  if (projectId !== undefined && !projects.length) throw deny();
  if (!projects.length) return { vehicles: [], generatedAt: new Date().toISOString() };
  const { rows } = await client.query(`SELECT w.id,w.project_id,w.name,w.code
    FROM public.inventory_warehouses w
    LEFT JOIN public.inventory_location_types lt ON lt.project_id=w.project_id AND lt.id=w.location_type_id
    WHERE w.project_id=ANY($1::int[]) AND w.active AND w.type='vehicle'
      AND (w.location_type_id IS NULL OR lt.id IS NOT NULL)
      AND ($3::boolean OR lt.access_policy='shared' OR w.assigned_user_id=$2 OR
        EXISTS(SELECT 1 FROM public.inventory_warehouses_values u
          WHERE u.project_id=w.project_id AND u.parent_id=w._key AND u.field='userIds' AND u.value=$2))
    ORDER BY w.project_id,lower(w.name),w.id`, [projects.map(project => project.id), userId, allVehicles]);
  return { generatedAt: new Date().toISOString(), vehicles: rows.map(row => {
    const project = projects.find(project => project.id === row.project_id)!;
    return { id: row.id, projectId: project.id, projectName: project.name, timezone: project.timezone || "UTC",
      name: row.name, code: row.code };
  }) };
}

async function snapshot(client: PoolClient, vehicle: VehicleStockLocation, query: unknown): Promise<VehicleStockResponse> {
  const input = stockQuerySchema.parse({ ...(query as object), warehouse: vehicle.id });
  const result = await queryStock(client, vehicle.projectId, input);
  const { rows: [counts] } = await client.query(`SELECT count(*)::int AS total FROM public.inventory_quantities
    WHERE project_id=$1 AND warehouse_id=$2`, [vehicle.projectId, vehicle.id]);
  return { ...result, total: counts.total, vehicle, generatedAt: new Date().toISOString(),
    rows: result.rows.map((row: VehicleStockResponse["rows"][number]) => ({ itemId: row.itemId, warehouseId: row.warehouseId,
      item: row.item, quantity: row.quantity, reserved: row.reserved, available: row.quantity - row.reserved,
      revision: row.revision, serialCount: row.serialCount })) };
}

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

async function report(client: PoolClient, vehicles: VehicleStockLocation[], query: unknown) {
  const generatedAt = new Date();
  const sections: string[] = [];
  const input = stockQuerySchema.parse(query);
  for (const vehicle of vehicles) {
    const rows: VehicleStockResponse["rows"] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await snapshot(client, vehicle, { ...input, offset, limit: 100 });
      rows.push(...page.rows);
      if (rows.length >= page.filtered) break;
    }
    const { rows: serials } = await client.query(`SELECT item_id,serial FROM public.inventory_stock_serials
      WHERE project_id=$1 AND warehouse_id=$2 AND item_id=ANY($3::text[]) ORDER BY item_id,_position,serial`,
    [vehicle.projectId, vehicle.id, rows.map(row => row.itemId)]);
    const serialsByItem = new Map<string, string[]>();
    for (const serial of serials) {
      const values = serialsByItem.get(serial.item_id) ?? [];
      values.push(serial.serial);
      serialsByItem.set(serial.item_id, values);
    }
    const timestamp = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "long", timeZone: vehicle.timezone }).format(generatedAt);
    sections.push(`<section><h2>${escape(vehicle.name)} · ${escape(vehicle.code)}</h2><p>${escape(vehicle.projectName)} · Refreshed ${escape(timestamp)} (${escape(vehicle.timezone)})</p>
      <table><thead><tr><th>Item / SKU</th><th>Onboard</th><th>Reserved</th><th>Available</th><th>Serials</th></tr></thead><tbody>
      ${rows.map(row => `<tr><td>${escape(row.item.name)}<br>${escape(row.item.sku)}</td><td>${row.quantity} ${escape(row.item.unit)}</td>
        <td>${row.reserved}</td><td>${row.available}</td><td>${(serialsByItem.get(row.itemId) ?? []).map(escape).join("<br>")}</td></tr>`).join("") ||
        '<tr><td colspan="5">No matching inventory recorded in this vehicle.</td></tr>'}</tbody></table></section>`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vehicle Stock Report</title>
    <style>body{font:14px system-ui,sans-serif;margin:24px;color:#111}h1{font-size:24px}h2{font-size:18px}section{margin:28px 0}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ccc;padding:8px;overflow-wrap:anywhere}th{background:#eee}p{line-height:1.5}button{padding:8px 16px}@media print{button{display:none}thead{display:table-header-group}tr{break-inside:avoid}}</style></head>
    <body><button onclick="window.print()">Print report</button><h1>Vehicle Stock Report</h1>
    <p>System-expected onboard stock, not a physical count. Stock waiting in staging is excluded until vehicle handoff is recorded. Reservations are existing inventory commitments; this report does not authorize transfers.</p>
    ${input.q ? `<p>Search filter: ${escape(input.q)}</p>` : ""}${sections.join("") || "<p>No accessible vehicles.</p>"}</body></html>`;
}

export function registerInventoryVehicleStockRoutes(app: Express) {
  const handle = (work: (req: any, client: PoolClient) => Promise<any>, html = false) =>
    [isAuthenticated, async (req: any, res: any) => {
      let client: PoolClient | undefined;
      try {
        client = await pool.connect();
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const result = await work(req, client);
        await client.query("COMMIT");
        res.set("Cache-Control", "no-store");
        if (html) res.type("html").send(result); else res.json(result);
      } catch (error: any) {
        if (client) await client.query("ROLLBACK").catch(() => undefined);
        const status = error instanceof z.ZodError ? 400 : error.status ?? 500;
        if (status === 500) console.error("[VehicleStock] Read failed", { code: error.code });
        res.set("Cache-Control", "no-store").status(status).json({ message: status === 500
          ? "Vehicle inventory could not be loaded. Retry the connection." : error instanceof z.ZodError ? "Invalid vehicle stock request." : error.message });
      } finally { client?.release(); }
    }] as const;
  const select = async (req: any, client: PoolClient) => {
    const projectId = projectFilter.parse(req.params.projectId)!;
    const { vehicle } = vehicleQuery.parse(req.query);
    const allowed = await directory(client, req.user.claims.sub, projectId);
    const selected = allowed.vehicles.find(row => row.id === vehicle);
    if (!selected) throw deny("This vehicle is not available to your account.");
    return selected;
  };
  app.get("/api/inventory/vehicles", ...handle((req, client) =>
    directory(client, req.user.claims.sub, projectFilter.parse(req.query.projectId))));
  app.get("/api/inventory/vehicles/print", ...handle(async (req, client) =>
    report(client, (await directory(client, req.user.claims.sub, projectFilter.parse(req.query.projectId))).vehicles, req.query), true));
  const base = "/api/projects/:projectId/inventory/vehicle-stock";
  app.get(base, ...handle(async (req, client) => snapshot(client, await select(req, client), req.query)));
  app.get(`${base}/serials`, ...handle(async (req, client) => {
    const vehicle = await select(req, client);
    return queryStockSerials(client, vehicle.projectId, serialQuerySchema.parse({ ...req.query, warehouse: vehicle.id }));
  }));
  app.get(`${base}/print`, ...handle(async (req, client) => report(client, [await select(req, client)], req.query), true));
}
