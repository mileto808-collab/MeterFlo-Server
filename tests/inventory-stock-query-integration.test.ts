import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import bcrypt from "bcryptjs";
import { chromium, expect } from "@playwright/test";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { createProjectSchema } from "../server/projectDb";
import { writeRelationalInventory } from "../server/inventoryRelational";
import { initializeAudit } from "../server/auditMigration";
import { emptyInventory, itemSchema, warehouseSchema } from "../shared/inventory";
import { readInventorySandbox } from "./helpers/inventory-sandbox";
import { queryStock } from "../server/inventoryStockQueries";
import { stockQuerySchema } from "../shared/inventory-stock-query";

test("owned 10,000-balance / large-serial stock query benchmark and signed-in acceptance", {
  skip: !process.env.INVENTORY_VOLUME_STANDALONE_CONFIG, timeout: 600_000,
}, async () => {
  const sandbox = await readInventorySandbox(process.env.INVENTORY_VOLUME_STANDALONE_CONFIG!, process.env.DATABASE_URL);
  assert.deepEqual((await pool.query("SELECT run_id FROM public.inventory_volume_sandbox")).rows, [{ run_id: sandbox.runId }]);
  const output = "generated-artifacts/inventory-stock-queries";
  await mkdir(output, { recursive: true });
  const metrics: Record<string, any> = { runId: sandbox.runId, environment: { platform: process.platform }, passed: false };
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await initializeAudit(pool);
    const suffix = randomUUID().slice(0, 8), password = randomUUID() + "!Aa1", username = `stock-${suffix}`;
    const adminRole = await storage.ensureAdministratorSubrole();
    await storage.createLocalUser(username, await bcrypt.hash(password, 4), "admin", "Stock", "Fixture", null, adminRole.id);
    const { rows: [project] } = await pool.query("INSERT INTO public.projects(name,inventory_enabled) VALUES($1,true) RETURNING id,name", [`Stock benchmark ${suffix}`]);
    const schema = await createProjectSchema(project.name, project.id);
    await pool.query("UPDATE public.projects SET database_name=$2 WHERE id=$1", [project.id, schema]);
    const state = emptyInventory();
    state.revision = 42;
    state.items = Array.from({ length: 100 }, (_, n) => itemSchema.parse({
      id: `i${n}`, sku: String(n).padStart(8, "0"), name: `Item ${String(n).padStart(3, "0")}`,
      tracking: n % 10 === 0 ? "serialized" : "regular", category: n % 2 ? "Supplies" : "Meters",
    }));
    state.warehouses = Array.from({ length: 100 }, (_, n) => warehouseSchema.parse({
      id: `w${n}`, code: String(n).padStart(5, "0"), name: `Warehouse ${String(n).padStart(3, "0")}`, type: "physical", address: "Disposable fixture",
    }));
    for (const warehouse of state.warehouses) for (const item of state.items) {
      const large = warehouse.id === "w0" && item.id === "i0";
      const serials = item.tracking === "serialized" ? Array.from({ length: large ? 20000 : 100 },
        (_, n) => `${warehouse.id}-${item.id}-${String(n).padStart(10, "0")}`) : [];
      if (large) serials.splice(0, 4, "000000000000000000001", "=1+1", "LITERAL%_\\", "Exact Mixed Case");
      state.stock.push({ warehouseId: warehouse.id, itemId: item.id, serials,
        quantity: serials.length || (item.id === "i1" ? 0 : 1000), revision: 1 });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2)", [project.id, JSON.stringify(emptyInventory())]);
      await writeRelationalInventory(client, project.id, state);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    await pool.query("ANALYZE public.inventory_quantities");
    await pool.query("ANALYZE public.inventory_stock_serials");
    const base = `/api/projects/${project.id}/inventory`;
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
      headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ baseURL: sandbox.baseURL, acceptDownloads: true, viewport: { width: 1440, height: 1100 } });
    assert.equal((await context.request.post("/api/auth/local/login", { data: { username, password } })).status(), 200);
    const samples: Record<string, number[]> = {};
    const request = async (path: string, expectedStatus = 200) => {
      const start = performance.now(), response = await context.request.get(base + path);
      const text = await response.text();
      assert.equal(response.status(), expectedStatus, text.slice(0, 180));
      (samples[path] ??= []).push(Math.round(performance.now() - start));
      return { body: JSON.parse(text), bytes: Buffer.byteLength(text) };
    };
    const first = await request("/stock?limit=25");
    assert.equal(first.body.total, 10000);
    assert.equal(first.body.filtered, 10000);
    assert.equal(first.body.rows.length, 25);
    assert.ok(first.bytes < 30000);
    assert.equal(first.body.rows[0].serialCount, 20000);
    assert.deepEqual(first.body.rows[0].serials, []);
    metrics.initialBytes = first.bytes;
    metrics.balances = 10000;
    metrics.serials = state.stock.reduce((sum, row) => sum + row.serials.length, 0);
    for (const [query, count] of [
      ["warehouse=w0", 100], ["category=Meters", 5000], ["tracking=serialized", 1000],
      ["availability=out-of-stock", 100], ["q=000000000000000000001", 1], ["q=no-such-balance", 0],
      ["q=" + encodeURIComponent("LITERAL%_\\"), 1], ["warehouse=other-project-location", 0],
      ["warehouse=w0&tracking=serialized&category=Meters", 10],
    ] as const) {
      const { body } = await request(`/stock?limit=5&${query}`);
      assert.equal(body.filtered, count, query);
      assert.ok(body.rows.length <= 5);
    }
    for (const path of ["/stock?limit=101", "/stock?offset=-1", "/stock?sort=anything", "/stock/serials?item=i0"])
      await request(path, 400);
    const serialFirst = await request("/stock/serials?warehouse=w0&item=i0&limit=50");
    assert.equal(serialFirst.body.total, 20000);
    assert.equal(serialFirst.body.serials.length, 50);
    assert.equal(serialFirst.body.serials[0], "000000000000000000001");
    assert.ok(serialFirst.bytes < 10000);
    metrics.initialSerialBytes = serialFirst.bytes;
    const serialMatch = await request("/stock/serials?warehouse=w0&item=i0&q=" + encodeURIComponent("LITERAL%_\\"));
    assert.deepEqual(serialMatch.body.serials, ["LITERAL%_\\"]);
    assert.equal(serialMatch.body.filtered, 1);
    // Confirm direct MVCC pages remain readable while an unrelated command holds the project lock.
    const locker = await pool.connect();
    try {
      await locker.query("BEGIN");
      await locker.query("SELECT project_id FROM public.inventory_state WHERE project_id=$1 FOR UPDATE", [project.id]);
      await request("/stock?limit=1");
    } finally { await locker.query("ROLLBACK"); locker.release(); }
    // Read-only users are granted permissions through the normal role model.
    const role = await storage.createSubrole({ key: `stock_reader_${suffix}`, label: "Stock fixture reader", baseRole: "user" });
    await storage.setSubrolePermissions(role.id, ["inventory.view", "project.inventory"]);
    const readerName = `reader-${suffix}`;
    const reader = await storage.createLocalUser(readerName, await bcrypt.hash(password, 4), "user", "Reader", "Fixture", null, role.id);
    await storage.assignUserToProject(reader.id, project.id);
    const readerContext = await browser.newContext({ baseURL: sandbox.baseURL });
    assert.equal((await readerContext.request.post("/api/auth/local/login", { data: { username: readerName, password } })).status(), 200);
    assert.equal((await readerContext.request.get(base + "/stock?limit=1")).status(), 200);
    await storage.setSubrolePermissions(role.id, []);
    for (const path of ["/stock", "/stock/context", "/stock/options", "/stock/serials?warehouse=w0&item=i0"])
      assert.equal((await readerContext.request.get(base + path)).status(), 403);
    await storage.setSubrolePermissions(role.id, ["inventory.view"]);
    const { rows: [other] } = await pool.query("INSERT INTO public.projects(name,inventory_enabled) VALUES($1,true) RETURNING id", [`Other stock fixture ${suffix}`]);
    assert.equal((await readerContext.request.get(`/api/projects/${other.id}/inventory/stock`)).status(), 403);
    await readerContext.close();
    const page = await context.newPage();
    const requests: string[] = [], errors: string[] = [];
    page.on("request", request => { if (request.url().includes(base)) requests.push(new URL(request.url()).pathname); });
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${project.id}/inventory`);
    const results = page.getByTestId("inventory-stock-results"), rows = results.locator("[data-stock-row]");
    await expect(rows.first()).toBeVisible();
    await expect(page.getByTestId("inventory-stock-pagination")).toContainText("of 10000 balances");
    assert.ok(!requests.includes(base), "Initial stock view never requests the legacy snapshot");
    assert.ok(!requests.includes(base + "/stock/options"), "Filter dependencies are lazy");
    assert.ok(!requests.includes(base + "/stock/serials"), "Serial identities are lazy");
    const desktopCapacity = Number(await results.getAttribute("data-page-size"));
    assert.ok(desktopCapacity > 1 && desktopCapacity <= 100);
    await page.getByRole("button", { name: "Next stock page" }).click();
    await expect(page.getByTestId("inventory-stock-pagination")).toContainText("Page 2");
    const search = page.getByRole("searchbox", { name: "Search inventory" });
    await search.fill("000000000000000000001");
    await expect(rows).toHaveCount(1);
    await rows.getByRole("button", { name: "View serials (20000) for 00000000 at 00000", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Stock serials", exact: true });
    await expect(dialog.getByRole("list", { name: "Stock serial list" }).locator("li")).toHaveCount(50);
    await expect(dialog).toContainText("000000000000000000001");
    await dialog.getByRole("textbox", { name: "Search serials" }).fill("LITERAL%_\\");
    await expect(dialog).toContainText("1 of 20000 serials");
    await dialog.getByLabel("Export scope", { exact: true }).selectOption("filtered");
    const serialDownload = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "CSV", exact: true }).click();
    const serialCsv = await readFile((await (await serialDownload).path())!, "utf8");
    assert.ok(serialCsv.includes("LITERAL%_\\"));
    assert.ok(!serialCsv.includes("000000000000000000001"));
    await dialog.getByLabel("Export scope", { exact: true }).selectOption("page");
    const serialPageDownload = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "CSV", exact: true }).click();
    assert.ok((await readFile((await (await serialPageDownload).path())!, "utf8")).includes("LITERAL%_\\"));
    await dialog.getByLabel("Export scope", { exact: true }).selectOption("all");
    const serialAllDownload = page.waitForEvent("download", { timeout: 120000 });
    await dialog.getByRole("button", { name: "CSV", exact: true }).click();
    const allSerialCsv = await readFile((await (await serialAllDownload).path())!, "utf8");
    assert.ok(allSerialCsv.includes("000000000000000000001"));
    assert.equal(allSerialCsv.split("\r\n").filter(Boolean).length, 20001);
    await dialog.getByLabel("Export scope", { exact: true }).selectOption("filtered");
    await dialog.getByRole("textbox", { name: "Search serials" }).fill("no-match");
    await expect(dialog.getByRole("button", { name: "CSV", exact: true })).toBeDisabled();
    await expect(dialog.getByLabel("Export scope", { exact: true })).toHaveValue("filtered");
    await page.keyboard.press("Escape");
    await search.fill("Item 099");
    await expect(page.getByTestId("inventory-stock-pagination")).toContainText("of 100 balances");
    const tools = page.getByTestId("inventory-stock-subheader");
    await tools.getByLabel("Stock export scope").selectOption("filtered");
    const stockDownload = page.waitForEvent("download");
    await tools.getByRole("button", { name: "CSV", exact: true }).click();
    const stockCsv = await readFile((await (await stockDownload).path())!, "utf8");
    assert.equal(stockCsv.split("\r\n").filter(Boolean).length, 101);
    await tools.getByLabel("Stock export scope").selectOption("page");
    const pageDownload = page.waitForEvent("download");
    await tools.getByRole("button", { name: "CSV", exact: true }).click();
    const pageCsv = await readFile((await (await pageDownload).path())!, "utf8");
    assert.equal(pageCsv.split("\r\n").filter(Boolean).length, await rows.count() + 1);
    await tools.getByLabel("Stock export scope").selectOption("all");
    const allDownload = page.waitForEvent("download", { timeout: 120000 });
    await tools.getByRole("button", { name: "CSV", exact: true }).click();
    assert.equal((await readFile((await (await allDownload).path())!, "utf8")).split("\r\n").filter(Boolean).length, 10001);
    await tools.getByLabel("Stock export scope").selectOption("page");
    const popupEvent = page.waitForEvent("popup");
    await tools.getByRole("button", { name: "PDF / Print", exact: true }).click();
    const popup = await popupEvent;
    await expect(popup.locator("h1")).toHaveText("On hand by location");
    assert.equal(await popup.locator("tbody tr").count(), await rows.count());
    await popup.close();
    await search.fill("no-match");
    await tools.getByLabel("Stock export scope").selectOption("filtered");
    await expect(tools.getByRole("button", { name: "CSV", exact: true })).toBeDisabled();
    await expect(tools.getByLabel("Stock export scope")).toHaveValue("filtered");
    await search.fill("");
    await page.screenshot({ path: `${output}/desktop.jpg` });
    // Dialog dependencies load only on demand; other tabs remain operational.
    await tools.getByRole("button", { name: "Filters", exact: true }).click();
    const filters = page.getByRole("dialog", { name: "Filter stock", exact: true });
    await expect(filters.getByLabel("Warehouse or vehicle").locator("option")).toHaveCount(101);
    await filters.getByLabel("Warehouse or vehicle").selectOption("w0");
    await expect(filters).toContainText("100 matching balances");
    await filters.getByRole("button", { name: "Show 100 balances", exact: true }).click();
    assert.ok(!requests.includes(base), "Stock filters and exports never fetch the legacy snapshot");
    await page.getByRole("tab", { name: "Items", exact: true }).click();
    await expect(page.getByTestId("inventory-items-results")).toBeVisible();
    assert.ok(requests.includes(base), "Other tabs retain their legacy contract");
    await page.getByRole("tab", { name: "Stock & search", exact: true }).click();
    await expect(rows.first()).toBeVisible();
    const beforeFocus = requests.filter(path => path === base).length;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(100);
    assert.equal(requests.filter(path => path === base).length, beforeFocus, "Returning to stock disables the aggregate observer");
    await page.close();
    const mobile = await context.browser()!.newContext({ baseURL: sandbox.baseURL, viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true, storageState: await context.storageState() });
    const phone = await mobile.newPage();
    await phone.goto(`/projects/${project.id}/inventory`);
    const mobileRows = phone.getByTestId("inventory-stock-results");
    await expect(mobileRows.locator("[data-stock-row]").first()).toBeVisible();
    await expect(phone.getByRole("searchbox", { name: "Search inventory" })).toBeHidden();
    const phoneCapacity = Number(await mobileRows.getAttribute("data-page-size"));
    assert.ok(phoneCapacity >= 1 && phoneCapacity < desktopCapacity);
    await phone.screenshot({ path: `${output}/phone.jpg` });
    await phone.setViewportSize({ width: 844, height: 390 });
    await expect(phone.getByTestId("inventory-mobile-menu")).toBeVisible();
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await phone.screenshot({ path: `${output}/landscape.jpg` });
    await mobile.close();
    assert.deepEqual(errors, []);
    // SQL-level results remain bounded even without HTTP serialization.
    const direct = await queryStock(pool, project.id, stockQuerySchema.parse({ limit: 100 }));
    assert.equal(direct.rows.length, 100);
    metrics.timingsMs = samples;
    metrics.passed = true;
    console.log(JSON.stringify({ balances: metrics.balances, serials: metrics.serials, initialBytes: metrics.initialBytes,
      initialSerialBytes: metrics.initialSerialBytes, timingsMs: samples }, null, 2));
  } finally {
    await browser?.close();
    await writeFile(`${output}/metrics.json`, JSON.stringify(metrics, null, 2));
    // The runner owns, stops and deletes the entire database, files and sessions.
    await pool.end();
  }
});
