import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, release, totalmem } from "node:os";
import bcrypt from "bcryptjs";
import { chromium, expect } from "@playwright/test";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { createProjectSchema, getProjectWorkOrderStorage } from "../server/projectDb";
import { inventoryState, postInventory } from "../server/inventoryService";
import { exportInventory, restoreInventory } from "../server/inventoryBackup";
import { initializeInventory } from "../server/inventoryMigration";
import { initializeAudit } from "../server/auditMigration";
import { withAuditContext } from "../server/auditContext";
import { assertInventoryInvariants, volume, volumeState } from "./helpers/inventory-volume";
import type { InventoryCommand } from "../shared/inventory";
import { readInventorySandbox } from "./helpers/inventory-sandbox";

// Explicit opt-in: run against the development app only, never a configurable production URL.
test("isolated inventory volume, sustained contention, sync, restore and signed-in UI", {
  skip: process.env.INVENTORY_VOLUME_ACCEPTANCE !== "1", timeout: 600_000,
}, async () => {
  const sandbox = process.env.INVENTORY_VOLUME_STANDALONE_CONFIG
    ? await readInventorySandbox(process.env.INVENTORY_VOLUME_STANDALONE_CONFIG, process.env.DATABASE_URL) : null;
  if (sandbox) {
    const { rows } = await pool.query("SELECT run_id FROM public.inventory_volume_sandbox");
    assert.deepEqual(rows, [{ run_id: sandbox.runId }], "Disposable database ownership marker required");
  } else assert.ok(process.env.REPLIT_DEV_DOMAIN?.endsWith(".replit.dev"), "development preview required");
  const baseURL = sandbox?.baseURL ?? `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const samples: Record<string, number[]> = {};
  const bytes: Record<string, number> = {};
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try { return await fn(); }
    finally { (samples[name] ||= []).push(Math.round(performance.now() - start)); }
  };
  const projects: { id: number; schema: string }[] = [];
  let userId: string | undefined, browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let cookie = "", sessionId = "", passed = false;
  const output = "generated-artifacts/inventory-volume";
  await mkdir(output, { recursive: true });
  try {
    await initializeInventory(pool);
    await initializeAudit(pool);
    const suffix = randomUUID().slice(0, 8), password = `${randomUUID()}!Aa1`, username = `volume-${suffix}`;
    const administrator = await storage.ensureAdministratorSubrole();
    const user = await storage.createLocalUser(username, await bcrypt.hash(password, 4), "admin", "Volume", "Fixture", null, administrator.id);
    userId = user.id;
    const scope = () => ({ actorId: user.id, actorLabel: "Volume fixture", actorKind: "user" as const, source: "inventory-volume-test", operationId: randomUUID() });
    const makeProject = async () => {
      const { rows: [p] } = await pool.query("INSERT INTO public.projects(name,inventory_enabled) VALUES($1,true) RETURNING id,name", [`Volume fixture ${suffix} ${projects.length}`]);
      const entry = { id: p.id, schema: "" }; projects.push(entry);
      entry.schema = await createProjectSchema(p.name, p.id);
      await pool.query("UPDATE public.projects SET database_name=$2 WHERE id=$1", [p.id, entry.schema]);
      return entry;
    };
    const p = await makeProject(), target = await makeProject();
    const command = (action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) =>
      timed(`post.${action}`, () => withAuditContext(scope(), () => postInventory(p.id, { action, data, operationId }, user.id, true)));
    const request = async (route: string) => timed(route.includes("sync") ? "http.mobileSync" : "http.snapshot", async () => {
      const res = await fetch(`${baseURL}${route}`, { headers: { Cookie: cookie } });
      const text = await res.text();
      assert.equal(res.status, 200, `${route}: ${text.slice(0, 200)}`);
      bytes[route.includes("sync") ? "mobileSync" : "snapshot"] = Buffer.byteLength(text);
      return JSON.parse(text);
    });
    const state = volumeState();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2)", [p.id, JSON.stringify(state)]);
      await client.query(`INSERT INTO public.inventory_items(project_id,id,sku,data)
        SELECT $1,x->>'id',x->>'sku',x FROM jsonb_array_elements($2::jsonb) x`, [p.id, JSON.stringify(state.items)]);
      await client.query(`INSERT INTO public.inventory_quantities(project_id,warehouse_id,item_id,quantity,reserved,serials)
        SELECT $1,x->>'warehouseId',x->>'itemId',(x->>'quantity')::int,0,x->'serials'
        FROM jsonb_array_elements($2::jsonb) x`, [p.id, JSON.stringify(state.stock)]);
      await client.query(`INSERT INTO public.inventory_movements(project_id,operation_id,action,actor_id,changes)
        SELECT $1,'historical-'||n,'receive',NULL,'{"stock":[],"entities":[]}'::jsonb FROM generate_series(0,$2-1) n`, [p.id, volume.history]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; }
    finally { client.release(); }
    const work = getProjectWorkOrderStorage(p.schema), restoredWork = getProjectWorkOrderStorage(target.schema);
    // Matching isolated work orders allow inventory-only backup restoration to validate its relationships.
    const workIds: number[] = [];
    for (let n = 0; n < 16; n++) {
      const wo = await withAuditContext(scope(), () => work.createWorkOrder({ customerWoId: `volume-${n}`, assignedUserId: user.id } as any));
      workIds.push(wo.id);
      const restored = await withAuditContext(scope(), () => restoredWork.createWorkOrder({ customerWoId: `volume-${n}` } as any));
      assert.equal(restored.id, wo.id);
    }
    const login = await fetch(`${baseURL}/api/auth/local/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    sessionId = decodeURIComponent(cookie.split("=").slice(1).join("=")).split(".")[0].slice(2);
    await command("order", { id: "shipment", type: "purchase", destinationId: "w0", vendorId: "vendor", lines: [{ itemId: "i0", quantity: volume.shipment }] });
    await command("release", { orderId: "shipment" });
    const receiveId = randomUUID(), receive = { orderId: "shipment", lines: [{ itemId: "i0", quantity: volume.shipment,
      serials: Array.from({ length: volume.shipment }, (_, n) => `SHIP-${String(n).padStart(8, "0")}`) }] };
    await command("receive", receive, receiveId);
    // Lost acknowledgements and simultaneous retries do not add stock or ledger rows.
    const retries = await Promise.all(Array.from({ length: 8 }, () => command("receive", receive, receiveId)));
    assert.ok(retries.every(r => r.replay));
    await assert.rejects(command("receive", { ...receive, reason: "changed" }, receiveId), /different operation/);
    const contention = await Promise.allSettled(workIds.slice(0, 8).map(workOrderId => command("assign", {
      workOrderId, lines: [{ warehouseId: "w0", itemId: "i0", quantity: 1, serials: ["SHIP-00009999"] }],
    })));
    assert.equal(contention.filter(r => r.status === "fulfilled").length, 1);
    assert.ok(contention.filter(r => r.status === "rejected").every(r => /reserved/.test(String(r.reason))));
    // Eight workers, six rounds, distinct locations: verify project-wide locking loses no writes.
    const revisionBefore = (await inventoryState(p.id)).revision;
    await timed("parallel.wall", () => Promise.all(Array.from({ length: volume.workers }, async (_, worker) => {
      for (let round = 0; round < volume.countRounds; round++) {
        const id = `parallel-${worker}-${round}`;
        await command("countStart", { id, warehouseId: `w${worker + 1}` });
        await command("countCancel", { id, reason: "Synthetic concurrent activity" });
      }
    })));
    const afterCounts = await inventoryState(p.id);
    assert.equal(afterCounts.revision, revisionBefore + 96, "all parallel writes survive");
    assert.equal(afterCounts.counts.filter(c => c.id.startsWith("parallel-") && c.status === "cancelled").length, 48);
    await timed("parallel.transfers", () => Promise.all(Array.from({ length: volume.workers }, async (_, worker) => {
      for (let round = 0; round < volume.transferRounds; round++) {
        const id = `transfer-${worker}-${round}`, lines = [{ itemId: "i1", quantity: 1, serials: [] }];
        await command("order", { id, type: "transfer", sourceId: `w${worker + 1}`, destinationId: `w${worker + 9}`, lines });
        await command("release", { orderId: id });
        const operationId = randomUUID();
        await command("dispatch", { orderId: id, lines }, operationId);
        assert.equal((await command("dispatch", { orderId: id, lines }, operationId)).replay, true);
        await command("accept", { orderId: id, lines });
      }
    })));
    const afterTransfers = await inventoryState(p.id);
    assert.equal(afterTransfers.revision, afterCounts.revision + 128);
    assert.equal(afterTransfers.orders.filter(o => o.id.startsWith("transfer-") && o.status === "completed").length, 32);
    for (let worker = 0; worker < 8; worker++) {
      assert.equal(afterTransfers.stock.find(b => b.warehouseId === `w${worker + 1}` && b.itemId === "i1")!.quantity, 996);
      assert.equal(afterTransfers.stock.find(b => b.warehouseId === `w${worker + 9}` && b.itemId === "i1")!.quantity, 1004);
    }
    // Count succeeds while reservations exist; stale and reservation-removing counts fail atomically.
    await command("countStart", { id: "physical", warehouseId: "w1" });
    let current = await inventoryState(p.id);
    const countLines = current.stock.filter(b => b.warehouseId === "w1").map(({ itemId, quantity, serials }) => ({ itemId, quantity, serials }));
    await command("countPost", { id: "physical", reason: "Verified fixture count", lines: countLines });
    await command("assign", { workOrderId: workIds[15], lines: [{ warehouseId: "w1", itemId: "i0", quantity: 1, serials: ["w1-i0-000000"] }] });
    await command("countStart", { id: "reserved", warehouseId: "w1" });
    await assert.rejects(command("countPost", { id: "reserved", reason: "Invalid removal", lines: countLines.map(l => l.itemId === "i0" ? { ...l, quantity: 0, serials: [] } : l) }), /reserved/);
    const used = [{ warehouseId: "w2", itemId: "i0", quantity: 1, serials: ["w2-i0-000000"] }];
    await command("assign", { workOrderId: workIds[14], lines: used });
    const uploadBody = { workOrders: [{ id: workIds[14], status: "Completed",
      inventoryUsage: { operationId: randomUUID(), revision: 1, mode: "changeout", used, dispositions: [] } }] };
    for (let retry = 0; retry < 3; retry++) {
      await timed("http.mobileUpload", async () => {
        const response = await fetch(`${baseURL}/api/projects/${p.id}/mobile/sync/upload`, {
          method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(uploadBody),
        });
        assert.equal(response.status, 200);
        const text = await response.text(), result = JSON.parse(text);
        bytes.mobileUpload = Buffer.byteLength(text);
        assert.equal(result.summary.successful, 1, text);
        assert.ok(bytes.mobileUpload < 16 * 1024);
      });
    }
    assert.equal((await inventoryState(p.id)).stock.find(b => b.warehouseId === "w2" && b.itemId === "i0")!.quantity, 99, "mobile retries consume once");
    current = await inventoryState(p.id);
    assertInventoryInvariants(current);
    const { rows: movements } = await pool.query("SELECT operation_id FROM public.inventory_movements WHERE project_id=$1", [p.id]);
    assert.equal(movements.filter(m => m.operation_id === receiveId).length, 1);
    const { rows: quantities } = await pool.query("SELECT warehouse_id,item_id,quantity,reserved,serials FROM public.inventory_quantities WHERE project_id=$1", [p.id]);
    assert.equal(quantities.length, current.stock.length);
    for (const b of current.stock) {
      const q = quantities.find(q => q.warehouse_id === b.warehouseId && q.item_id === b.itemId)!;
      assert.equal(q.quantity, b.quantity); assert.deepEqual(q.serials, b.serials);
      const allocated = current.allocations.filter(a => a.status === "reserved").flatMap(a => a.lines)
        .filter(l => l.warehouseId === b.warehouseId && l.itemId === b.itemId).reduce((sum, l) => sum + l.quantity, 0);
      assert.equal(q.reserved, allocated);
    }
    const endpoint = `/api/projects/${p.id}/inventory`;
    const snapshot = await request(endpoint);
    assert.deepEqual(snapshot.state.operations, {});
    assert.ok(bytes.snapshot < 8 * 1024 * 1024, "snapshot stays under 8 MiB at supported volume");
    await timed("http.postReplay", async () => {
      const response = await fetch(`${baseURL}${endpoint}/commands`, { method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: receiveId, action: "receive", data: receive }) });
      assert.equal(response.status, 200);
      const text = await response.text(), result = JSON.parse(text);
      bytes.postResponse = Buffer.byteLength(text);
      assert.ok(bytes.postResponse < 8 * 1024 * 1024, "posting returns the bounded visible snapshot, not idempotency history");
      assert.equal(result.state.revision, current.revision);
      assert.deepEqual(result.state.operations, {});
    });
    for (const limit of [1, 5, 16]) {
      const sync = await request(`/api/projects/${p.id}/mobile/sync/download?limit=${limit}`);
      assert.equal(sync.workOrders.length, Math.min(limit, 15), "completed work is excluded from offline downloads");
      assert.ok(sync.workOrders.every((wo: any) => wo.id !== workIds[14]));
      assert.equal(sync.inventory.items.length, volume.items);
      assert.equal(sync.inventory.warehouses.length, volume.warehouses);
      assert.equal(sync.inventory.operations, undefined);
      assert.equal(sync.inventory.receipts, undefined);
      assert.ok(bytes.mobileSync < 512 * 1024, "mobile sync excludes growing stock/history");
    }
    const backupClient = await pool.connect();
    try {
      await backupClient.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      const backup = await timed("backup.export", () => exportInventory(backupClient, p.schema));
      assert.ok(backup);
      bytes.backup = Buffer.byteLength(JSON.stringify(backup));
      assert.ok(bytes.backup < 12 * 1024 * 1024);
      await timed("backup.restore", () => restoreInventory(backupClient, target.schema, backup));
      await backupClient.query("COMMIT");
      assert.deepEqual(await inventoryState(target.id), current);
      assertInventoryInvariants(await inventoryState(target.id));
      const { rows: [count] } = await pool.query("SELECT count(*)::int AS n FROM public.inventory_movements WHERE project_id=$1", [target.id]);
      assert.equal(count.n, movements.length);
      const { rows: restoredQuantities } = await pool.query("SELECT warehouse_id,item_id,quantity,reserved,serials FROM public.inventory_quantities WHERE project_id=$1", [target.id]);
      const sortBalances = (rows: any[]) => [...rows].sort((a, b) => JSON.stringify([a.warehouse_id, a.item_id]).localeCompare(JSON.stringify([b.warehouse_id, b.item_id])));
      assert.deepEqual(sortBalances(restoredQuantities), sortBalances(quantities), "restored mirrors retain quantities, reservations and every serial");
      const replay = await postInventory(target.id, { action: "receive", data: receive, operationId: receiveId }, user.id, true);
      assert.equal(replay.replay, true);
    } catch (e) { await backupClient.query("ROLLBACK"); throw e; }
    finally { backupClient.release(); }
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || (sandbox ? undefined : "/repl/tools/bin/chromium"), args: ["--no-sandbox"] });
    const context = await browser.newContext({ baseURL });
    await context.addCookies([{ name: cookie.split("=")[0], value: cookie.slice(cookie.indexOf("=") + 1), url: baseURL, secure: true, httpOnly: true }]);
    const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await timed("ui.load", async () => {
      await page.goto(`/projects/${p.id}/inventory`);
      await page.getByText("On hand by location", { exact: true }).waitFor();
      await expect(page.locator("tbody tr")).toHaveCount(100);
    });
    await page.getByRole("button", { name: "Last stock page", exact: true }).click();
    await expect(page.locator("tbody")).toContainText("Synthetic warehouse 39");
    await expect(page.getByRole("button", { name: "Next stock page", exact: true })).toBeDisabled();
    for (const [term, expected] of [["SHIP-00009999", 1], ["SKU-0001", 40], ["Synthetic warehouse 39", 30], ["no-match-fixture", 0]] as const) {
      await timed("ui.search", async () => {
        await page.getByRole("textbox", { name: "Search inventory" }).fill(term);
        await expect(page.locator("tbody tr")).toHaveCount(expected);
      });
    }
    await page.getByRole("textbox", { name: "Search inventory" }).fill("");
    await expect(page.locator("tbody tr")).toHaveCount(100);
    await expect(page.getByRole("button", { name: "Previous stock page", exact: true })).toBeDisabled();
    await page.getByRole("textbox", { name: "Search inventory" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/desktop.jpg` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("region", { name: "Stock balances", exact: true }).scrollIntoViewIfNeeded();
    const scroll = await page.locator("table").first().locator("..").evaluate(el => {
      el.scrollLeft = el.scrollWidth;
      el.scrollTop = el.scrollHeight;
      return { width: el.clientWidth, total: el.scrollWidth, left: el.scrollLeft, right: el.getBoundingClientRect().right,
        top: el.scrollTop, height: el.clientHeight, page: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    assert.ok(scroll.total > scroll.width && scroll.left > 0, "table scrolls within its own container");
    assert.ok(scroll.top > 0 && scroll.height <= 512, "large result table scrolls vertically in a bounded container");
    assert.ok(scroll.right <= scroll.viewport && scroll.page <= scroll.viewport, "nested table does not expand or clip page");
    await page.getByRole("region", { name: "Stock balances", exact: true }).evaluate(el => { el.scrollTop = 0; });
    const serialScroll = await page.getByRole("region", { name: "Serials for SKU-0000 at W-0", exact: true }).evaluate(el => {
      el.scrollTop = el.scrollHeight;
      return { top: el.scrollTop, height: el.clientHeight, last: el.textContent?.endsWith("SHIP-00009999") };
    });
    assert.ok(serialScroll.top > 0 && serialScroll.height <= 96 && serialScroll.last, "all 10,100 serials remain accessible in nested scroll");
    await page.screenshot({ path: `${output}/phone.jpg` });
    await timed("ui.activity", async () => {
      await page.getByRole("tab", { name: "Activity", exact: true }).click();
      await page.getByText("Stock movement ledger", { exact: true }).waitFor();
    });
    await expect(page.getByTestId("inventory-activity-entries").locator(":scope > div")).toHaveCount(100);
    await page.getByRole("button", { name: "Last activity page", exact: true }).click();
    await expect(page.getByTestId("inventory-activity-entries")).toContainText("historical-order-0");
    await expect(page.getByRole("button", { name: "Next activity page", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "First activity page", exact: true }).click();
    await expect(page.getByTestId("inventory-activity-entries").locator(":scope > div")).toHaveCount(100);
    await expect(page.getByRole("button", { name: "Previous activity page", exact: true })).toBeDisabled();
    await page.getByText("Stock movement ledger", { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/activity-phone.jpg` });
    assert.deepEqual(errors, []);
    // Report before enforcing budgets, so a failing run remains diagnosable.
    assert.ok(Math.max(...samples["post.receive"]) < 10_000, "serialized receipt/retry under 10s");
    assert.ok(Math.max(...samples["http.mobileSync"]) < 5000, "mobile sync under 5s");
    assert.ok(Math.max(...samples["http.mobileUpload"]) < 5000, "mobile usage upload under 5s");
    assert.ok(samples["ui.load"][0] < 10_000, "signed-in inventory loads within 10s");
    assert.ok(Math.max(...samples["ui.search"]) < 2000, "search responds within 2s");
    assert.ok(samples["ui.activity"][0] < 3000, "activity opens within 3s");
    assert.ok(Math.max(...samples["post.countStart"]) < 6000, "eight-worker queue drains each post within 6s");
    assert.ok(samples["backup.restore"][0] < 60_000, "inventory restore under 60s");
    assert.ok(samples["parallel.wall"][0] < 180_000 && samples["parallel.transfers"][0] < 180_000, "sustained workers complete within 3 minutes per phase");
    passed = true;
  } finally {
    const summary = Object.fromEntries(Object.entries(samples).map(([name, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return [name, { n: sorted.length, p50: sorted[Math.floor((sorted.length - 1) * .5)], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }];
    }));
    await writeFile(`${output}/metrics.json`, JSON.stringify({ passed, measuredAt: new Date().toISOString(), volume, node: process.version,
      runId: sandbox?.runId, environment: { platform: process.platform, arch: process.arch, mode: sandbox ? "standalone" : "replit-development",
        release: release(), cpus: cpus().length, cpuModel: cpus()[0]?.model, totalMemoryBytes: totalmem(), browser: browser?.version() ?? null },
      maxRssKiB: process.resourceUsage().maxRSS, milliseconds: summary, bytes }, null, 2));
    console.log(JSON.stringify({ milliseconds: summary, bytes }));
    await browser?.close();
    try {
      for (const p of projects.reverse()) {
        if (p.schema) await pool.query(`DROP SCHEMA IF EXISTS "${p.schema}" CASCADE`);
        for (const table of ["inventory_movements", "inventory_quantities", "inventory_items", "inventory_state"])
          await pool.query(`DELETE FROM public.${table} WHERE project_id=$1`, [p.id]);
        await pool.query("DELETE FROM public.projects WHERE id=$1", [p.id]);
      }
      if (userId) await pool.query("DELETE FROM public.users WHERE id=$1", [userId]);
      if (sessionId) await pool.query("DELETE FROM public.sessions WHERE sid=$1", [sessionId]);
      // Only synthetic test evidence is removed, never unrelated application history.
      const cleanup = await pool.connect();
      try {
        await cleanup.query("BEGIN");
        await cleanup.query("SELECT set_config('meterflo.audit_retention','authorized',true)");
        for (const table of ["events", "operations"])
          await cleanup.query(`DELETE FROM meterflo_audit.${table} WHERE project_id=ANY($1::int[]) OR actor_id=$2`, [projects.map(p => p.id), userId]);
        await cleanup.query("COMMIT");
      } catch (e) { await cleanup.query("ROLLBACK"); throw e; }
      finally { cleanup.release(); }
    } finally { await pool.end(); }
  }
});
