// Owns and removes its fixture users/project; never posts into customer inventory.
import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { chromium, expect } from "@playwright/test";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { clearRelationalInventory } from "../server/inventoryRelational";
import { initializeAudit } from "../server/auditMigration";
import { withAuditContext } from "../server/auditContext";

const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
if (!process.env.REPLIT_DEV_DOMAIN) throw new Error("Run against the development preview only.");
const out = "generated-artifacts/inventory-vendor-kits";
await mkdir(out, { recursive: true });
await initializeAudit(pool);
const suffix = randomUUID().slice(0, 8), password = randomUUID();
const administrator = await storage.ensureAdministratorSubrole();
const admin = await storage.createLocalUser(`vendor-kit-admin-${suffix}`, await bcrypt.hash(password, 4), "admin", "Vendor", "Fixture", null, administrator.id);
const { rows: [project] } = await pool.query("INSERT INTO public.projects(name,inventory_enabled) VALUES($1,true) RETURNING id", [`Vendor kit browser fixture ${suffix}`]);
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
let receiver: { id: string } | undefined, roleId: number | undefined;
try {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const login = await context.request.post("/api/auth/local/login", { data: { username: admin.username, password } });
  assert.equal(login.status(), 200, "fixture administrator can sign in");
  const permissions = await (await context.request.get("/api/permissions")).json();
  assert.ok(permissions.some((p: any) => p.key === "inventory.receive"), "receiving permission is discoverable in normal role administration");
  const roleResponse = await context.request.post("/api/subroles", { data: {
    key: `vendor-kit-receiver-${suffix}`, label: "Vendor kit fixture receiver", baseRole: "user",
    permissions: ["nav.projects", "projects.view", "inventory.view"],
  } });
  assert.equal(roleResponse.status(), 201);
  roleId = (await roleResponse.json()).id;
  const receiverPassword = randomUUID();
  const created = await storage.createLocalUser(`vendor-kit-receiver-${suffix}`, await bcrypt.hash(receiverPassword, 4), "user", "Receiver", "Fixture", null, roleId);
  receiver = created;
  await storage.assignUserToProject(receiver.id, project.id);
  const endpoint = `/api/projects/${project.id}/inventory`;
  const post = async (action: string, data: any, operationId = randomUUID()) => {
    const response = await context.request.post(`${endpoint}/commands`, { data: { action, data, operationId } });
    assert.equal(response.status(), 200, await response.text());
    return response.json();
  };
  await post("warehouse", { id: "w", code: "W", name: "Receiving warehouse", type: "physical", address: "Fixture", userIds: [receiver.id] });
  await post("vendor", { id: "v", name: "Vendor fixture" });
  await post("item", { id: "meter", sku: "M", name: "Meter", tracking: "serialized", equipment: "system" });
  await post("item", { id: "seal", sku: "S", name: "Seal", tracking: "regular" });
  await post("item", { id: "kit", sku: "K", name: "Purchased meter kit", tracking: "serialized",
    components: [{ itemId: "meter", quantity: 1 }, { itemId: "seal", quantity: 2 }] });
  await post("order", { id: "po", type: "purchase", vendorId: "v", destinationId: "w", lines: [{ itemId: "kit", quantity: 3 }] });
  await post("release", { orderId: "po" });
  const receiptId = randomUUID();
  await post("receive", { orderId: "po", lines: [{ itemId: "kit", quantity: 3, serials: ["VK1", "VK2", "VK3"] }] }, receiptId);
  const capture = { receiptId, itemId: "kit", quantity: 1, serials: ["VK1"],
    components: [{ itemId: "meter", quantity: 1, serials: ["VM1"] }, { itemId: "seal", quantity: 2, serials: [] }], reason: "Verified actual vendor contents" };
  const receiverContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  assert.equal((await receiverContext.request.post("/api/auth/local/login", { data: { username: created.username, password: receiverPassword } })).status(), 200);
  const denied = await receiverContext.request.post(`${endpoint}/commands`, { data: { action: "verifyVendorKit", data: capture, operationId: randomUUID() } });
  assert.equal(denied.status(), 403, "view-only receivers cannot verify kits");
  const roleGrant = await context.request.put(`/api/subroles/${roleId}/permissions`, { data: {
    permissions: ["nav.projects", "projects.view", "inventory.view", "inventory.receive"],
  } });
  assert.equal(roleGrant.status(), 200, "administrator grants receiving through the real role API");
  const page = await receiverContext.newPage(), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await receiverContext.addInitScript(() => {
    (window as any).vendorEvents = [];
    const Native = window.EventSource;
    window.EventSource = class extends Native {
      constructor(url: string | URL, options?: EventSourceInit) {
        super(url, options);
        if (String(url).endsWith("/inventory/events")) this.addEventListener("message", event => {
          try { (window as any).vendorEvents.push(JSON.parse(event.data)); } catch {}
        });
      }
    };
  });
  await page.goto(`/projects/${project.id}/inventory`);
  await expect(page.getByTestId("inventory-live-indicator")).toContainText(/Live/i);
  const tools = page.getByTestId("inventory-stock-subheader").getByRole("button", { name: /Search & Tools/i });
  if (await tools.isVisible()) await tools.click();
  await page.getByRole("button", { name: "Inspect vendor kit", exact: true }).click();
  const dialog = page.getByTestId("vendor-kit-dialog");
  await dialog.getByTestId("vendor-kit-source").selectOption(receiptId);
  await dialog.getByTestId("vendor-kit-item").selectOption("kit");
  await dialog.getByTestId("vendor-kit-parent-serial").selectOption("VK1");
  await dialog.getByTestId("vendor-kit-scan-meter").fill("VM1");
  await dialog.getByTestId("vendor-kit-scan-meter").press("Enter");
  await dialog.getByTestId("vendor-kit-count-seal").fill("2");
  await dialog.getByTestId("vendor-kit-reason").fill(capture.reason);
  assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, "phone dialog has no horizontally clipped controls");
  await page.screenshot({ path: `${out}/phone-capture.jpg` });
  // An external receipt event must refresh inventory without replacing captures.
  await post("warehouse", { id: "other", code: "O", name: "Other receiving location", type: "physical", address: "Fixture" });
  await expect.poll(async () => page.evaluate(() => (window as any).vendorEvents.length)).toBeGreaterThan(0);
  const sameUserUpdate = await receiverContext.request.post(`${endpoint}/commands`, { data: {
    action: "verifyVendorKit", operationId: randomUUID(), data: { ...capture, serials: ["VK3"],
      components: [{ itemId: "meter", quantity: 1, serials: ["VM3"] }, { itemId: "seal", quantity: 2, serials: [] }] },
  } });
  assert.equal(sameUserUpdate.status(), 200);
  await expect(dialog.getByTestId("vendor-kit-external-change")).toBeVisible();
  await expect(dialog.getByLabel("Meter scanned serials")).toContainText("VM1");
  await expect(dialog.getByTestId("vendor-kit-count-seal")).toHaveValue("2");
  await dialog.getByRole("button", { name: "Recheck current basis", exact: true }).click();
  await dialog.getByTestId("vendor-kit-review-button").click();
  await expect(dialog.getByTestId("vendor-kit-review")).toBeVisible();
  // The first POST really commits; only its HTTP response is lost.
  const sent: any[] = [];
  let loseResponse = true;
  await page.route(`**${endpoint}/commands`, async route => {
    const body = route.request().postDataJSON();
    if (body.action !== "verifyVendorKit") return route.continue();
    sent.push(body);
    if (loseResponse) {
      loseResponse = false;
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort("failed");
    } else await route.continue();
  });
  await dialog.getByTestId("vendor-kit-submit").click();
  await expect(dialog.getByTestId("vendor-kit-retry")).toBeVisible();
  await expect(dialog.getByTestId("vendor-kit-scan-meter")).toBeDisabled();
  await dialog.getByTestId("vendor-kit-retry").click();
  await expect(dialog).toBeHidden();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[0], sent[1], "lost response retry uses the original exact payload and UUID");
  const state = (await (await context.request.get(endpoint)).json()).state;
  assert.equal(state.receipts.filter((r: any) => r.id === sent[0].operationId).length, 1);
  assert.equal(state.receipts.filter((r: any) => r.action === "verifyVendorKit").length, 2);
  assert.equal(state.stock.length, 1, "no loose stock was fabricated by receiving inspection");
  assert.equal(state.stock[0].quantity, 3, "inspection never posts another finished kit");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Inspect vendor kit", exact: true }).click();
  await dialog.getByTestId("vendor-kit-source").selectOption(receiptId);
  await dialog.getByTestId("vendor-kit-item").selectOption("kit");
  await dialog.getByTestId("vendor-kit-parent-serial").selectOption("VK2");
  await dialog.getByTestId("vendor-kit-scan-meter").fill("VM2");
  await dialog.getByTestId("vendor-kit-scan-meter").press("Enter");
  await page.screenshot({ path: `${out}/desktop-capture.jpg` });
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "Discard vendor-kit captures?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep captures", exact: true }).click();
  await expect(dialog.getByLabel("Meter scanned serials")).toContainText("VM2");
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  await page.getByRole("button", { name: "Discard captures", exact: true }).click();
  await expect(dialog).toBeHidden();
  assert.deepEqual(errors, [], "no browser runtime errors");
  console.log("Vendor kit browser acceptance passed: role grants/denials, actual component scans, phone/desktop layout, SSE capture retention, lost-response retry, and discard safety.");
} finally {
  await browser.close();
  await withAuditContext({ actorKind: "system", actorLabel: "Vendor kit fixture cleanup", source: "test", operationId: randomUUID() }, async () => {
    await clearRelationalInventory(pool, project.id);
    await pool.query("DELETE FROM public.inventory_movements WHERE project_id=$1", [project.id]);
    await pool.query("DELETE FROM public.inventory_state WHERE project_id=$1", [project.id]);
    await pool.query("DELETE FROM public.user_projects WHERE project_id=$1", [project.id]);
    await pool.query("DELETE FROM public.projects WHERE id=$1", [project.id]);
    for (const user of [receiver, admin]) if (user) await pool.query("DELETE FROM public.users WHERE id=$1", [user.id]);
    if (roleId) await storage.deleteSubrole(roleId);
  });
  await pool.end();
}
