if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Use the owned workspace sandbox.");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");
const { Pool } = require("pg");

(async () => {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const admin = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const member = await browser.newContext({ baseURL });
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const p = fixture.projectId, base = `/api/projects/${p}`, codes = `${base}/trouble-codes`;
  const suffix = `${p}_${Date.now()}`;
  const api = async (context, method, url, data, status = 200) => {
    const response = await context.request.fetch(url, { method, data });
    assert.equal(response.status(), status, `${method} ${url}: unexpected status`);
    return status === 204 ? null : response.json();
  };
  const run = (method, url, data, status) => api(admin, method, url, data, status);
  const scoped = (method, url, data, status) => api(member, method, url, data, status);
  try {
    await run("POST", "/api/auth/local/login", fixture);
    await scoped("POST", "/api/auth/local/login", fixture.viewer);
    const other = await run("POST", "/api/projects", { name: `Trouble scope ${suffix}` }, 201);
    const core = await run("POST", "/api/trouble-codes", { code: `CORE_${suffix}`, label: "Shared access issue" }, 201);
    const custom = await run("POST", codes, { code: `SITE_${suffix}`, label: "Project access issue" }, 201);
    const foreign = await run("POST", `/api/projects/${other.id}/trouble-codes`, { code: `OTHER_${suffix}`, label: "Other project issue" }, 201);
    const available = await run("GET", codes);
    assert.ok(available.some(c => c.id === core.id) && available.some(c => c.id === custom.id));
    assert.ok(!available.some(c => c.id === foreign.id));
    assert.equal(custom.projectId, p);
    assert.match(custom.ruleKey, /^[0-9a-f-]{36}$/);
    assert.ok((await run("GET", "/api/trouble-codes")).every(c => c.projectId === null));
    await scoped("GET", `/api/projects/${other.id}/trouble-codes`, undefined, 403);
    await scoped("POST", codes, { code: `DENIED_${suffix}`, label: "Denied" }, 403);
    await run("PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, {
      permissions: ["projects.view", "projects.edit", "projects.manageTroubleCodes"],
    });
    const granted = await scoped("POST", codes, { code: `DELEGATED_${suffix}`, label: "Delegated code" }, 201);
    await scoped("PATCH", `${codes}/${granted.id}`, { label: "Delegated renamed" });
    await scoped("POST", "/api/trouble-codes", { code: `FORBIDDEN_${suffix}`, label: "No core grant" }, 403);
    const reportCodes = await scoped("GET", "/api/trouble-codes?includeProjects=true");
    assert.ok(reportCodes.some(c => c.id === custom.id) && !reportCodes.some(c => c.id === foreign.id));
    await run("PATCH", `/api/trouble-codes/${custom.id}`, { label: "Wrong endpoint" }, 404);
    await run("PATCH", `${codes}/${core.id}`, { label: "Core override" }, 404);
    for (const field of [{ projectId: other.id }, { ruleKey: foreign.ruleKey }, { id: 9999 }])
      await run("PATCH", `${codes}/${custom.id}`, field, 400);
    await assert.rejects(db.query("UPDATE public.trouble_codes SET rule_key=gen_random_uuid() WHERE id=$1", [custom.id]), error => error.code === "23514");
    await run("POST", `/api/projects/${other.id}/trouble-codes`, { code: custom.code, label: "Same code, unrelated project" }, 201);
    await run("POST", codes, { code: custom.code.toLowerCase(), label: "Duplicate" }, 409);
    await run("POST", codes, { code: core.code, label: "Core collision" }, 409);
    await run("POST", "/api/trouble-codes", { code: custom.code, label: "Core collision with a project" }, 409);
    const concurrent = await Promise.all([1, 2].map(() => admin.request.post(codes, {
      data: { code: `RACE_${suffix}`, label: "Concurrent catalog choice" },
    })));
    assert.deepEqual(concurrent.map(r => r.status()).sort(), [201, 409]);

    const service = (await run("GET", "/api/service-types"))[0].code;
    const wo = await run("POST", `${base}/work-orders`, {
      customerWoId: `TROUBLE_${suffix}`, serviceType: service, status: "Open", trouble: custom.ruleKey,
      customerId: "TROUBLE_FIXTURE", customerName: "Trouble-code fixture", address: "100 Fixture Street",
    }, 201);
    const before = await run("GET", `${base}/work-orders/${wo.id}`);
    const renamed = await run("PATCH", `${codes}/${custom.id}`, { code: `RENAMED_${suffix}`, label: "Renamed project issue" });
    assert.deepEqual([renamed.id, renamed.ruleKey], [custom.id, custom.ruleKey]);
    assert.equal(renamed.code, `RENAMED_${suffix}`);
    const after = await run("GET", `${base}/work-orders/${wo.id}`);
    assert.equal(after.trouble, custom.ruleKey);
    assert.equal(after.notes, before.notes, "Renaming never rewrites captured notes");
    assert.equal(after.status, before.status);
    assert.equal(after.subStatusId, before.subStatusId);
    assert.equal(after.updatedAt, before.updatedAt, "Catalog rename does not rewrite work-order rows");
    await run("PATCH", `${base}/work-orders/${wo.id}`, { trouble: foreign.ruleKey }, 400);
    await run("PATCH", `${base}/work-orders/${wo.id}`, { trouble: custom.code }, 400);
    assert.equal((await run("GET", `${base}/work-orders/${wo.id}`)).trouble, custom.ruleKey);
    const schema = fixture.schema || (await run("GET", `/api/projects/${p}`)).databaseName;
    assert.match(schema, /^project_[a-z0-9_]+$/);
    assert.equal((await db.query(`SELECT data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name='work_orders' AND column_name='trouble'`, [schema])).rows[0].data_type, "uuid");
    const constraint = (await db.query(`SELECT confupdtype,confdeltype FROM pg_constraint WHERE conrelid=$1::regclass AND conname='fk_trouble_code'`, [`"${schema}".work_orders`])).rows[0];
    assert.deepEqual(constraint, { confupdtype: "c", confdeltype: "r" });
    await assert.rejects(db.query(`UPDATE "${schema}".work_orders SET trouble=$1 WHERE id=$2`, [foreign.ruleKey, wo.id]), error => error.code === "23514");
    const archive = await run("GET", `${base}/database/backup`);
    assert.ok(archive.troubleCodes.some(c => c.ruleKey === custom.ruleKey));
    await run("PATCH", `/api/trouble-codes/${core.id}`, { label: "New shared label" });
    const restored = await admin.request.post(`${base}/database/restore`, {
      multipart: { clearExisting: "true", backup: { name: "project.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(archive)) } },
    });
    assert.equal(restored.status(), 200, "Project backup/restore preserves custom identities");
    assert.deepEqual((await restored.json()).errors, []);
    assert.equal((await run("GET", "/api/trouble-codes")).find(c => c.id === core.id).label, "New shared label");
    assert.equal((await run("GET", codes)).find(c => c.id === custom.id).ruleKey, custom.ruleKey);
    const restoredOrders = await run("GET", `${base}/work-orders`);
    const restoredWo = restoredOrders.find(item => item.customerWoId === wo.customerWoId);
    assert.ok(restoredWo);
    const retired = await run("DELETE", `${codes}/${custom.id}`);
    assert.equal(retired.active, false);
    await run("PATCH", `${base}/work-orders/${restoredWo.id}`, { notes: "Existing retired reference retained" });
    await run("POST", `${base}/work-orders`, {
      customerWoId: `RETIRED_${suffix}`, serviceType: service, status: "Open", trouble: custom.ruleKey,
      customerId: "RETIRED_FIXTURE", customerName: "Retired-code fixture", address: "100 Fixture Street",
    }, 400);
    await run("PATCH", `${codes}/${custom.id}`, { active: true });

    const page = await admin.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${p}/edit`);
    await page.getByRole("tab", { name: "Work Orders", exact: true }).click();
    await page.getByRole("tab", { name: "Trouble codes", exact: true }).click();
    const manager = page.getByTestId("project-trouble-code-manager");
    await expect(manager).toBeVisible();
    await expect(manager.getByText("New shared label", { exact: true })).toBeVisible();
    await page.getByTestId("button-add-project-trouble-code").click();
    await page.getByTestId("input-project-trouble-code").fill(`UI_${suffix}`);
    await page.locator("#project-trouble-label").fill("Created in project settings");
    await page.getByRole("button", { name: "Create code", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(manager.getByText("Created in project settings", { exact: true })).toBeVisible();
    const uiCode = (await run("GET", codes)).find(c => c.code === `UI_${suffix}`);
    assert.ok(uiCode);
    await manager.getByRole("button", { name: "Edit Created in project settings", exact: true }).click();
    await page.getByTestId("input-project-trouble-code").fill(`UI_RENAMED_${suffix}`);
    await page.locator("#project-trouble-label").fill("Renamed through project settings");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(manager.getByText(`UI_RENAMED_${suffix}`, { exact: true })).toBeVisible();
    await fs.mkdir("generated-artifacts/project-trouble-codes", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/project-trouble-codes/manager-desktop.jpg" });
    await page.goto(`/projects/${p}/work-orders`);
    await page.getByTestId(`row-work-order-${restoredWo.id}`).click();
    const scheduling = page.getByTestId("accordion-scheduling");
    if (await scheduling.getAttribute("aria-expanded") !== "true") await scheduling.click();
    await page.getByTestId("button-desktop-scheduling-edit").click();
    await page.getByTestId("select-trouble").click();
    await expect(page.getByRole("option", { name: /Renamed through project settings/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /New shared label/ })).toBeVisible();
    await expect(page.getByRole("option", { name: /Other project issue/ })).toHaveCount(0);
    await page.getByRole("option", { name: /Renamed through project settings/ }).click();
    await page.getByTestId("button-desktop-scheduling-done").click();
    await page.getByTestId("button-save").click();
    await expect.poll(async () => (await run("GET", `${base}/work-orders/${restoredWo.id}`)).trouble).toBe(uiCode.ruleKey);
    await run("POST", `/api/mobile/projects/${p}/work-orders/${restoredWo.id}/trouble`, { troubleCode: foreign.ruleKey }, 400);
    await run("POST", `/api/mobile/projects/${p}/work-orders/${restoredWo.id}/trouble`, { troubleCode: custom.ruleKey, notes: "Scoped mobile fixture" });
    assert.equal((await run("GET", `${base}/work-orders/${restoredWo.id}`)).trouble, custom.ruleKey);
    await run("POST", `/api/mobile/projects/${p}/work-orders/${restoredWo.id}/trouble`, { troubleCode: uiCode.ruleKey, notes: "Mobile fixture" });
    assert.equal((await run("GET", `${base}/work-orders/${restoredWo.id}`)).trouble, uiCode.ruleKey);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("mobile-trouble-code")).toContainText("Renamed through project settings");
    await page.screenshot({ path: "generated-artifacts/project-trouble-codes/detail-phone.jpg" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    const audit = await db.query("SELECT count(*)::int n FROM meterflo_audit.events WHERE entity_type='trouble_codes' AND project_id=$1", [p]);
    assert.ok(audit.rows[0].n > 0, "Project definition changes remain audited");
    await run("DELETE", `/api/projects/${other.id}`, undefined, 204);
    assert.equal((await db.query("SELECT count(*)::int n FROM public.trouble_codes WHERE project_id=$1", [other.id])).rows[0].n, 0);
    require("node:child_process").execFileSync(process.execPath,
      ["--import", "tsx", "--test", "tests/trouble-code-relational.test.ts"], { stdio: "inherit", env: process.env });
    require("node:child_process").execFileSync(process.execPath,
      ["--import", "tsx", "--test", "tests/customer-api.test.ts"], { stdio: "inherit", env: process.env });
    console.log("PASS: scoped code uniqueness and concurrent writes, delegated grants, immutable UUID and real FK, editable Code/Name without rewriting work orders, cross-project rejection, retirement/reactivation, backup roundtrip, project UI edit, detail UUID selector/save, mobile UUID inputs, phone width, audit and deletion cleanup.");
  } finally {
    await admin.close(); await member.close(); await browser.close(); await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
