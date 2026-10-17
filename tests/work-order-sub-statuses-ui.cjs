const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const f = JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;

(async () => {
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const admin = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 }, hasTouch: true });
  const member = await browser.newContext({ baseURL });
  const api = async (method, path, data, expected = 200, context = admin) => {
    const response = await context.request.fetch(path, { method, data });
    assert.equal(response.status(), expected, `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const root = `/api/projects/${f.projectId}`;
  const sharedIds = [];
  const workIds = [];
  let other;
  try {
    await api("POST", "/api/auth/local/login", f);
    await api("POST", "/api/auth/local/login", f.viewer, 200, member);
    await api("PUT", `/api/subroles/${f.viewerRoleId}/permissions`, {
      permissions: ["nav.projects", "projects.view", "project.workOrders", "workOrders.view"],
    });
    await api("PATCH", root, { inventoryEnabled: false });
    const statuses = await api("GET", "/api/work-order-statuses");
    const trouble = statuses.find(s => s.code === "Trouble");
    const completed = statuses.find(s => s.code === "Completed");
    const suffix = Date.now();
    const shared = await api("POST", "/api/work-order-sub-statuses", { parentStatusId: trouble.id, code: `HOLD-${suffix}`, label: "Shared hold" }, 201);
    sharedIds.push(shared.id);
    const completeSub = await api("POST", "/api/work-order-sub-statuses", { parentStatusId: completed.id, code: `DONE-${suffix}`, label: "Verified" }, 201);
    sharedIds.push(completeSub.id);
    await api("POST", "/api/work-order-sub-statuses", { parentStatusId: trouble.id, code: "FORBIDDEN", label: "Forbidden" }, 403, member);
    await api("POST", `${root}/work-order-sub-statuses`, { parentStatusId: trouble.id, code: "FORBIDDEN", label: "Forbidden" }, 403, member);
    await api("PUT", `/api/subroles/${f.viewerRoleId}/permissions`, {
      permissions: ["nav.projects", "projects.view", "projects.edit", "projects.manageSubStatuses", "project.workOrders", "workOrders.view", "workOrders.edit"],
    });
    const local = await api("POST", `${root}/work-order-sub-statuses`, { parentStatusId: trouble.id, code: `PERMIT-${suffix}`, label: "Awaiting permit" }, 201, member);
    await api("PATCH", `${root}/work-order-sub-statuses/${shared.id}`, { label: "Cannot change shared" }, 404, member);
    await api("PATCH", `${root}/work-order-sub-statuses/${local.id}`, { parentStatusId: completed.id }, 400, member);
    other = await api("POST", "/api/projects", { name: `Sub-status isolation ${suffix}`, inventoryEnabled: false }, 201);
    const foreign = await api("POST", `/api/projects/${other.id}/work-order-sub-statuses`, { parentStatusId: trouble.id, code: "FOREIGN", label: "Other customer" }, 201);
    assert.ok(!(await api("GET", `${root}/work-order-sub-statuses`)).some(d => d.id === foreign.id));
    const service = (await api("GET", "/api/service-types"))[0];
    const payload = { customerWoId: `SUB-${suffix}`, customerId: "SUB", customerName: "Sub-status fixture", address: "Fixture only", serviceType: service.code, status: "Trouble", subStatusId: local.id };
    let work = await api("POST", `${root}/work-orders`, payload, 201);
    workIds.push(work.id);
    assert.equal(work.subStatusId, local.id);
    await api("PATCH", `${root}/work-orders/${work.id}`, { subStatusId: foreign.id }, 400);
    await api("PATCH", `${root}/work-orders/${work.id}`, { status: "Open", subStatusId: completeSub.id }, 400);
    const open = await api("PATCH", `${root}/work-orders/${work.id}`, { status: "Open" });
    assert.equal(open.subStatusId, null);
    await api("PATCH", `${root}/work-orders/${work.id}`, { status: "Trouble", subStatusId: local.id });
    await api("PATCH", `${root}/work-orders/${work.id}`, { status: "Completed", subStatusId: completeSub.id }, 400);
    await api("PATCH", `${root}/work-order-sub-statuses/${local.id}`, { label: "Awaiting customer permit", active: false });
    await api("DELETE", `${root}/work-order-sub-statuses/${local.id}`, undefined, 409);
    await api("POST", `${root}/work-orders`, { ...payload, customerWoId: `${payload.customerWoId}-inactive` }, 400);
    const unchanged = await api("PATCH", `${root}/work-orders/${work.id}`, { notes: "Retain retired historical assignment" });
    assert.equal(unchanged.subStatusId, local.id);
    const backup = await api("GET", `${root}/database/backup`);
    assert.ok(backup.subStatuses.some(s => s.id === local.id));
    assert.equal(backup.workOrders.find(w => w.id === work.id).subStatusId,local.id);
    const restored = await admin.request.post(`${root}/database/restore`, { multipart: {
      clearExisting: "true",
      backup: { name:"fixture-backup.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(backup)) },
    } });
    assert.equal(restored.status(),200,await restored.text());
    // Non-inventory legacy restores may allocate a new work-order ID.
    work = (await api("GET",`${root}/work-orders`)).find(w=>w.customerWoId===payload.customerWoId);
    assert.ok(work);
    workIds.push(work.id);
    assert.equal(work.subStatusId,local.id);
    const filtered = await api("GET", `${root}/work-orders?subStatusId=${local.id}`);
    assert.ok(filtered.some(w => w.id === work.id));
    const sync = await api("GET", `${root}/mobile/sync/download`);
    assert.ok(sync.referenceData.workOrderSubStatuses.some(s => s.id === local.id));
    const page = await admin.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    fs.mkdirSync("generated-artifacts", { recursive: true });
    for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      await page.goto(`${root.replace("/api", "")}/work-orders?edit=${work.id}`);
      await page.getByTestId("accordion-scheduling").click();
      await page.getByTestId(name === "phone" ? "button-mobile-scheduling-edit" : "button-desktop-scheduling-edit").click();
      const select = page.getByTestId(name === "phone" ? "select-mobile-sub-status" : "select-sub-status");
      await expect(select).toContainText(name === "desktop" ? "Awaiting customer permit" : "Shared hold");
      await select.click();
      if (name === "desktop") await expect(page.getByRole("option", { name: "Awaiting customer permit (inactive)", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await select.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `generated-artifacts/sub-status-detail-${name}.jpg` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await select.click();
      await page.getByRole("option", { name: name === "desktop" ? "Shared hold" : "None", exact: true }).click();
      const saved = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(`${root}/work-orders/${work.id}`));
      await page.getByRole("button", { name: "Save Changes", exact: true }).click();
      assert.equal((await saved).status(),200);
      const current = await api("GET", `${root}/work-orders/${work.id}`);
      assert.equal(current.status,"Trouble");
      assert.equal(current.sub_status_id,name === "desktop" ? shared.id : null);
      await page.goto(`/projects/${f.projectId}/edit`);
      const manager = page.getByTestId("project-work-order-sub-statuses");
      await manager.scrollIntoViewIfNeeded();
      await expect(manager).toContainText("Awaiting customer permit");
      await expect(manager).toContainText("Shared hold");
      await manager.screenshot({ path: `generated-artifacts/sub-status-manager-${name}.jpg` });
    }
    assert.deepEqual(errors, []);
    console.log("PASS: shared/project permissions, isolation, inherited Completed rules, retirement, filters, sync metadata and responsive work-order/settings selectors.");
  } finally {
    for (const id of workIds) await admin.request.delete(`${root}/work-orders/${id}`);
    for (const id of sharedIds) await admin.request.delete(`/api/work-order-sub-statuses/${id}`);
    if (other) await admin.request.delete(`/api/projects/${other.id}`);
    await admin.close(); await member.close(); await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
