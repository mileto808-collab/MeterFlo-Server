// Read account credentials from stdin only; never commit or print them.
import "dotenv/config";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { chromium, expect } from "@playwright/test";
import { pool } from "../server/db";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const credentials = JSON.parse(input);
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
try {
  const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const context = await browser.newContext({ baseURL, viewport: { width: 1365, height: 1000 } });
  assert.equal((await context.request.post("/api/auth/local/login", { data: credentials })).status(), 200, "Normal sign-in succeeds");
  const profile = await (await context.request.get("/api/auth/user")).json();
  assert.equal(profile.subroleKey, "field_technician");
  const permissions = await (await context.request.get(`/api/users/${profile.id}/permissions`)).json();
  assert.ok(permissions.includes("workOrders.optimizeRoute"), "Field technician role must grant route optimization through normal role management");
  const groups = await (await context.request.get("/api/auth/user/groups")).json();
  const groupNames = groups.map((group: any) => group.name);
  const projects = await (await context.request.get("/api/projects")).json();
  let checked = 0, chosen: any;
  for (const project of projects) {
    if (!project.databaseName || !/^[a-z0-9_]+$/.test(project.databaseName)) continue;
    const result = await context.request.get(`/api/projects/${project.id}/work-orders`);
    if (result.status() !== 200) continue;
    const orders = await result.json();
    const expected = await pool.query(`SELECT id,status FROM "${project.databaseName}".work_orders
      WHERE assigned_user_id=$1 OR assigned_group_id=ANY($2::text[])`, [profile.id, groupNames]);
    assert.deepEqual(orders.map((order: any) => order.id).sort((a: number,b: number) => a-b),
      expected.rows.map(order => order.id).sort((a: number,b: number) => a-b), "List includes every personal/group assignment, all statuses");
    const stats = await (await context.request.get(`/api/projects/${project.id}/work-orders/stats`)).json();
    assert.equal(stats.total, expected.rowCount, "Stats use the same scope");
    checked++;
    if (orders.some((order: any) => order.status === "Scheduled")) {
      const readiness = await (await context.request.get(`/api/projects/${project.id}/routing/settings`)).json();
      if (!chosen || readiness.ready) chosen = project;
    }
  }
  assert.ok(checked > 0); assert.ok(chosen, "Account has accessible Scheduled work to plan");
  const page = await context.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`/projects/${chosen.id}/work-orders`);
  const showTools = page.getByRole("button", { name: "Show Search & Tools", exact: true });
  if (await showTools.isVisible()) await showTools.click();
  await expect(page.getByTestId("optimize-work-order-route")).toBeVisible();
  await page.getByTestId("optimize-work-order-route").click();
  await expect(page.getByTestId("route-setup-dialog")).toBeVisible();
  await page.getByText("Warehouse / starting address", { exact: true }).click();
  const origins = await context.request.get(`/api/projects/${chosen.id}/routing/origins`);
  assert.equal(origins.status(), 200);
  const warehouses = (await origins.json()).warehouses;
  if (warehouses.length) {
    await page.getByTestId("route-origin-warehouse").selectOption(warehouses[0].id);
    await expect(page.getByText(`${warehouses[0].name} · ${warehouses[0].address}`, { exact: true }).last()).toBeVisible();
    await page.getByTestId("route-origin-warehouse").selectOption("manual");
  } else await expect(page.getByTestId("route-origin-warehouse")).toHaveCount(0);
  await expect(page.getByTestId("route-manual-origin")).toBeVisible();
  // Exercise dropdown/submission/error presentation without sending synthetic
  // destinations to any live provider or modifying account/work-order data.
  const fixedAddress = "100 Fixture Warehouse Street, Fixture City";
  await page.route("**/routing/origins", route => route.fulfill({ json: {
    warehouses: [{ id: "fixed-origin-fixture", name: "Fixed origin fixture", address: fixedAddress }],
  } }));
  await page.getByText("Device location", { exact: true }).click();
  await page.getByText("Warehouse / starting address", { exact: true }).click();
  await page.getByTestId("route-origin-warehouse").selectOption("fixed-origin-fixture");
  let submitted: any;
  await page.route("**/routing/plan", async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ status: 422, json: { message: "Test submission captured; no provider called." } });
  });
  await page.getByTestId("create-route-plan").click();
  await expect.poll(() => submitted?.origin?.address).toBe(fixedAddress);
  const currentOrders = await (await context.request.get(`/api/projects/${chosen.id}/work-orders`)).json();
  assert.ok(submitted.ids.every((id: number) => currentOrders.some((order: any) => order.id === id && order.status === "Scheduled")));
  await page.getByTestId("route-origin-warehouse").selectOption("manual");
  await page.getByTestId("route-manual-origin").fill("200 Manual Fixture Street");
  await page.getByTestId("create-route-plan").click();
  await expect.poll(() => submitted?.origin?.address).toBe("200 Manual Fixture Street");
  await page.unroute("**/routing/origins");
  await page.route("**/routing/origins", route => route.fulfill({ status: 503, json: { message: "Warehouse lookup deliberately unavailable" } }));
  await page.getByText("Device location", { exact: true }).click();
  await page.getByText("Warehouse / starting address", { exact: true }).click();
  await expect(page.getByText(/Warehouse lookup deliberately unavailable/)).toBeVisible();
  await expect(page.getByTestId("route-manual-origin")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await fs.mkdir("generated-artifacts/technician-routing", { recursive: true });
  await page.screenshot({ path: "generated-artifacts/technician-routing/actual-account.jpg" });
  assert.deepEqual(errors, []);
  console.log(`PASS: supplied field-tech account signed in normally; ${checked} project scopes/stats match personal and group assignments; planner, warehouse/manual origin payloads, lookup-error fallback and phone layout verified. Synthetic planning submissions were intercepted; no live provider call.`);
  await context.close();
} finally {
  await browser.close(); await pool.end();
}
