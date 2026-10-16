// Uses only the disposable inventory-ui-fixture and its own audit records.
require("dotenv/config");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { chromium, expect } = require("@playwright/test");
const { Pool } = require("pg");
async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const out = "generated-artifacts/audit-workspace";
  await fs.mkdir(out, { recursive: true });
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  let foreignId;
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
      viewport: { width: 1440, height: 1000 }, hasTouch: true, isMobile: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const command = async (action, data) => {
      const res = await context.request.post(`${endpoint}/commands`, { data: { operationId: randomUUID(), action, data } });
      assert.equal(res.status(), 200, await res.text()); return (await res.json()).state;
    };
    const warehouseId = randomUUID();
    await command("warehouse", { id: warehouseId, code: "AUDIT", name: "Audit warehouse", type: "physical", address: "Test only" });
    const counts = [];
    for (let n = 0; n < 35; n++) {
      const id = randomUUID(); counts.push(id);
      await command("countStart", { id, warehouseId });
    }
    const legacyId = randomUUID(), unknownId = randomUUID();
    await db.query(`INSERT INTO meterflo_audit.events(id,actor_id,actor_label,actor_kind,source,action,entity_type,
      entity_id,entity_label,project_id,operation_id,outcome,changes,metadata)
      VALUES($1::uuid,$2,$3,'user','web','inventory.countSaveDraft','inventory',$1::uuid::text,$1::uuid::text,$4,$1::uuid,'success',$5,'{}'),
      ($6::uuid,$2,$3,'user','web','inventory.unknownLegacy','inventory',$6::uuid::text,$6::uuid::text,$4,$6::uuid,'success','[]','{}')`,
      [legacyId, fixture.id, fixture.username, fixture.projectId,
        JSON.stringify([{ field: `counts/${counts[1]}`, before: null, after: { id: counts[1], warehouseId, status: "open", snapshot: [] } }]), unknownId]);
    const audit = async (extra = {}) => {
      const response = await context.request.get(`/api/audit?${new URLSearchParams({ projectId: String(fixture.projectId), ...extra })}`);
      assert.equal(response.status(), 200, await response.text()); return response.json();
    };
    const legacy = (await audit({ q: "Count #2", action: "inventory.countSaveDraft" })).events[0];
    assert.equal(legacy.id, legacyId);
    assert.equal(legacy.entityReference, "Count #2");
    assert.equal(legacy.displayChanges[0].field, "Count #2");
    assert.equal(legacy.displayChanges[0].after.id, "Count #2");
    assert.equal(legacy.displayChanges[0].after.warehouseId, "AUDIT · Audit warehouse");
    assert.ok(/^Audit #\d+$/.test(legacy.eventReference));
    const unknown = (await audit({ action: "inventory.unknownLegacy" })).events[0];
    assert.ok(/^Audit event #\d+$/.test(unknown.entityReference));
    const beforeEvidence = (await db.query("SELECT entity_id,entity_label,changes,metadata FROM meterflo_audit.events WHERE id=$1", [legacyId])).rows[0];
    const smallPage = await audit({ limit: "2" });
    assert.equal(smallPage.events.length, 2);
    const all = await context.request.get(`/api/audit/export?projectId=${fixture.projectId}`);
    assert.equal(all.status(), 200, await all.text());
    assert.equal((await all.json()).events.length, smallPage.total);
    // Verify the real endpoint refuses a partial export above its safety limit.
    await db.query(`INSERT INTO meterflo_audit.events(actor_id,actor_label,actor_kind,source,action,entity_type,
      entity_id,entity_label,project_id,operation_id,outcome)
      SELECT $1,$2,'user','service','audit.testExportLimit','fixture',n::text,'Test event #'||n,$3,gen_random_uuid()::text,'success'
      FROM generate_series(1,10001) n`, [fixture.id,fixture.username,fixture.projectId]);
    const oversized = await context.request.get(`/api/audit/export?projectId=${fixture.projectId}&action=audit.testExportLimit`);
    assert.equal(oversized.status(),413); assert.ok((await oversized.json()).message.includes("no partial export"));
    const cleanup = await db.connect();
    try {
      await cleanup.query("BEGIN"); await cleanup.query("SELECT set_config('meterflo.audit_retention','authorized',true)");
      await cleanup.query("DELETE FROM meterflo_audit.events WHERE project_id=$1 AND actor_id=$2 AND action='audit.testExportLimit'",[fixture.projectId,fixture.id]);
      await cleanup.query("COMMIT");
    } catch(error) {await cleanup.query("ROLLBACK");throw error;} finally {cleanup.release();}
    assert.deepEqual((await db.query("SELECT entity_id,entity_label,changes,metadata FROM meterflo_audit.events WHERE id=$1", [legacyId])).rows[0], beforeEvidence);
    // Grant through actual role management, not directly seeded permission keys.
    assert.equal((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, { data: {
      permissions: ["projects.view", "workOrders.view", "audit.view"],
    } })).status(), 200);
    const created = await context.request.post("/api/projects", { data: { name: `Audit foreign fixture ${fixture.projectId}` } });
    assert.equal(created.status(), 201); foreignId = (await created.json()).id;
    const viewer = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const scoped = await viewer.request.get(`/api/audit/export?projectId=${foreignId}`);
    assert.equal(scoped.status(), 200); assert.equal((await scoped.json()).total, 0);
    const foreign = await context.request.get(`/api/audit?projectId=${foreignId}`);
    const foreignEvent = (await foreign.json()).events[0];
    assert.ok(foreignEvent);
    assert.equal((await viewer.request.get(`/api/audit/${foreignEvent.id}`)).status(), 404);
    assert.equal((await viewer.request.get("/api/audit/retention")).status(), 403);
    await viewer.close();
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/audit-logs");
    const header = page.getByTestId("audit-subheader"), results = page.getByTestId("audit-results");
    const pager = page.getByTestId("audit-pagination");
    await header.getByRole("button", { name: "Filter audit events", exact: true }).click();
    const filters = page.getByRole("dialog", { name: /Filter/ });
    await filters.getByLabel("Project", { exact: true }).selectOption(String(fixture.projectId));
    await filters.getByRole("button", { name: "Apply filters", exact: true }).click();
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(1);
    await expect(pager).toContainText(`of ${smallPage.total}`);
    await pager.getByRole("button", { name: "Next", exact: true }).click();
    await expect(pager).toContainText("Page 2");
    const exportDownload = page.waitForEvent("download");
    await header.getByRole("button", { name: "Export CSV", exact: true }).click();
    const csv = await fs.readFile(await (await exportDownload).path(), "utf8");
    assert.ok(csv.includes(`Matching events: ${smallPage.total}`));
    assert.ok(csv.includes("Count #35") && csv.includes("Count #1"));
    assert.ok(!csv.includes(foreignId.toString() + " foreign"));
    const xlsx = page.waitForEvent("download");
    await header.getByRole("button", { name: "Export Excel", exact: true }).click();
    assert.ok((await xlsx).suggestedFilename().endsWith(".xlsx"));
    const popupEvent = page.waitForEvent("popup");
    await header.getByRole("button", { name: "Export PDF / Print", exact: true }).click();
    const popup = await popupEvent; await expect(popup.locator("tbody tr")).toHaveCount(smallPage.total); await popup.close();
    await header.getByRole("textbox", { name: "Search audit events", exact: true }).fill("Count #2");
    await header.getByRole("button", { name: "Apply audit search", exact: true }).click();
    await results.getByTestId("audit-record").first().waitFor();
    // The search also matches Count #20...29; narrow by event reference for a single row.
    await header.getByRole("textbox", { name: "Search audit events", exact: true }).fill(legacy.eventReference);
    await header.getByRole("button", { name: "Apply audit search", exact: true }).click();
    await expect(results.getByTestId("audit-record")).toHaveCount(1);
    await results.getByTestId("audit-record").click();
    const detail = page.getByRole("dialog", { name: "Audit event", exact: true });
    await expect(detail).toContainText("Count #2");
    assert.ok(!(await detail.innerText()).includes(legacyId));
    await detail.getByText("Internal identifiers and raw evidence", { exact: true }).click();
    await expect(detail).toContainText(legacyId);
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await header.getByRole("textbox", { name: "Search audit events", exact: true }).fill("unmatched-evidence-search");
    await header.getByRole("button", { name: "Apply audit search", exact: true }).click();
    await expect(header.getByRole("button", { name: "Export CSV", exact: true })).toBeDisabled();
    await header.getByRole("textbox", { name: "Search audit events", exact: true }).fill("");
    await header.getByRole("button", { name: "Apply audit search", exact: true }).click();
    await expect(pager).toContainText(`of ${smallPage.total}`);
    await page.screenshot({ path: `${out}/desktop.jpg` });
    for (const viewport of [{width:390,height:844},{width:844,height:390},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      const toggle = page.getByTestId("audit-mobile-tools-toggle");
      await expect(toggle).toBeVisible();
      if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
      await expect(results.getByTestId("audit-record").first()).toBeVisible();
      const collapsed = Number(await results.getAttribute("data-page-size"));
      await toggle.click();
      await expect(header.getByRole("button", { name: "Filter audit events", exact: true })).toBeVisible();
      await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeLessThanOrEqual(collapsed);
      const expanded = Number(await results.getAttribute("data-page-size"));
      await toggle.click();
      await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThanOrEqual(expanded);
      if (viewport.width === 390) await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(expanded);
      await expect.poll(async () => results.getByTestId("audit-record").count()).toBe(Number(await results.getAttribute("data-page-size")));
      const box = await results.boundingBox();
      assert.ok(box && box.height > 50 && box.x >= 0 && box.x + box.width <= viewport.width + 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      const last = await results.getByTestId("audit-record").last().boundingBox();
      assert.ok(last && last.y + last.height <= box.y + box.height + 1, "a full page of records fits without clipping");
      await page.screenshot({ path: `${out}/phone-${viewport.width}.jpg` });
    }
    assert.deepEqual(errors, []);
    console.log("Audit workspace passed: historical/current readable identities, immutable evidence, scoped API/detail/exports, real-role grants, adaptive paging, phone rotation, search, filters and complete CSV/Excel/PDF.");
  } finally {
    if (foreignId) {
      const admin = browser.contexts()[0];
      assert.equal((await admin.request.delete(`/api/projects/${foreignId}`)).status(),204);
    }
    {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT set_config('meterflo.audit_retention','authorized',true)");
        await client.query("DELETE FROM meterflo_audit.events WHERE project_id=ANY($1::int[]) OR actor_id=ANY($2::text[])",
          [[fixture.projectId,...(foreignId ? [foreignId] : [])],[fixture.id,fixture.viewer.id]]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally {client.release();}
    }
    await browser.close(); await db.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
