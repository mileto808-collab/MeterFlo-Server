// Real HTTP/auth/DB checks in an owned disposable sandbox; never locks the
// user's development site and never saves or prints fixture credentials.
if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Run through the owned workspace sandbox.");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");
const { Pool } = require("pg");

(async () => {
  const fixture = JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const admin = await browser.newContext({ baseURL });
  const member = await browser.newContext({ baseURL });
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  const p = fixture.projectId, root = `/api/projects/${p}`;
  const request = async (context, method, url, data, status = 200) => {
    const response = await context.request.fetch(url, { method, data });
    assert.equal(response.status(), status, `${method} ${url}: unexpected HTTP status`);
    return status === 204 ? null : response.json();
  };
  const api = (method, url, data, status) => request(admin, method, url, data, status);
  const viewer = (method, url, data, status) => request(member, method, url, data, status);
  const save = async (url, locked, message) => {
    const before = await api("GET", url);
    return api("PUT", url, { locked, message, expectedUpdatedAt: before.updatedAt });
  };
  const permissionRoot = `/api/subroles/${fixture.viewerRoleId}/permissions`;
  try {
    await api("POST", "/api/auth/local/login", fixture);
    const registry = await api("GET", "/api/permissions");
    for (const key of ["security.manageSiteAccessLocks", "projects.manageAccessLocks"]) {
      assert.ok(registry.some(item => item.key === key), "New permissions appear in normal role management");
    }
    const basic = ["projects.view", "projects.edit", "workOrders.view", "project.workOrders", "nav.dashboard"];
    await api("PUT", permissionRoot, { permissions: basic });
    await viewer("POST", "/api/auth/local/login", fixture.viewer);
    const other = await api("POST", "/api/projects", { name: "Access lock unaffected project" }, 201);
    await viewer("GET", `/api/projects/${other.id}/access-lock`, undefined, 403);
    await api("POST", `/api/users/${fixture.viewer.id}/projects`, { projectId: other.id }, 201);
    const service = (await api("GET", "/api/service-types"))[0].code;
    const lockedOrder = await api("POST", `${root}/work-orders`, {
      customerWoId: "LOCK-DRAFT", serviceType: service, status: "Open", assignedUserId: fixture.viewer.id,
    }, 201);
    await api("POST", `/api/projects/${other.id}/work-orders`, {
      customerWoId: "UNLOCKED-VISIT", serviceType: service, status: "Open", assignedUserId: fixture.viewer.id,
    }, 201);
    const originalOrders = await api("GET", `${root}/work-orders`);
    await viewer("GET", "/api/access-locks/site", undefined, 403);
    await viewer("PUT", `${root}/access-lock`, { locked: true, message: "Unauthorized", expectedUpdatedAt: null }, 403);
    const before = await api("GET", `${root}/access-lock`);
    assert.equal(before.locked, false);
    await api("PUT", `${root}/access-lock`, { locked: true, message: "", expectedUpdatedAt: null }, 400);

    const memberPage = await member.newPage();
    await memberPage.goto(`/projects/${p}/work-orders`);
    await expect(memberPage.getByTestId("button-toggle-mobile-tools")).toBeVisible();
    const showTools = memberPage.getByRole("button", { name: "Show Search & Tools", exact: true });
    if (await showTools.isVisible()) await showTools.click();
    const search = memberPage.getByTestId("input-search-work-orders");
    await search.fill("LOCK-DRAFT");
    await expect(memberPage.getByTestId(`row-work-order-${lockedOrder.id}`)).toBeVisible();
    await memberPage.getByTestId("button-filters-dialog").click();
    await memberPage.getByTestId("checkbox-status-open").check();

    // Real administrator project control: cancel does not mutate the project.
    const settingsPage = await admin.newPage();
    await settingsPage.goto(`/projects/${p}/edit`);
    await settingsPage.getByRole("tab", { name: "People", exact: true }).click();
    const projectCard = settingsPage.getByTestId("access-lock-project");
    await expect(projectCard).toBeVisible();
    await projectCard.getByTestId("access-lock-message").fill("Project maintenance fixture");
    await projectCard.getByTestId("access-lock-toggle").click();
    await expect(settingsPage.getByRole("alertdialog")).toBeVisible();
    assert.equal((await api("GET", `${root}/access-lock`)).locked, false);
    await settingsPage.getByTestId("access-lock-cancel").click();
    assert.equal((await api("GET", `${root}/access-lock`)).locked, false);
    await projectCard.getByTestId("access-lock-toggle").click();
    await settingsPage.getByTestId("access-lock-confirm").click();
    await expect(projectCard.getByText("Locked", { exact: true })).toBeVisible();
    await expect(settingsPage.getByTestId("access-lock-confirm")).toBeHidden();
    const projectLock = await api("GET", `${root}/access-lock`);
    assert.equal(projectLock.locked, true);
    assert.ok(projectLock.updatedAt);
    assert.equal(projectLock.updatedBy, fixture.id);
    await api("PUT", `${root}/access-lock`, { locked: false, message: "", expectedUpdatedAt: null }, 409);
    const concurrent = await Promise.all([1, 2].map(() => admin.request.put(`${root}/access-lock`, {
      data: { locked: true, message: "Project maintenance fixture", expectedUpdatedAt: projectLock.updatedAt },
    })));
    assert.deepEqual(concurrent.map(response => response.status()).sort(), [200, 409], "Concurrent edits cannot silently overwrite each other");

    for (const url of [root, `${root}/work-orders`, `${root}/work-orders/stats`,
      `${root}/work-orders/${lockedOrder.id}/files`, `${root}/inventory`]) {
      const denied = await viewer("GET", url, undefined, 423);
      assert.equal(denied.code, "ACCESS_LOCKED");
      assert.equal(denied.message, "Project maintenance fixture");
    }
    await viewer("POST", `/api/mobile/projects/${p}/work-orders/${lockedOrder.id}/complete`, {}, 423);
    const encodedId = String(p).split("").map(char => `%${char.charCodeAt(0).toString(16)}`).join("");
    await viewer("GET", `/API/PROJECTS/${encodedId}/work-orders/`, undefined, 423);
    await viewer("GET", `/api/projects/${p}e0/work-orders`, undefined, 400);
    await viewer("GET", `/api/projects/${other.id}/work-orders`);
    const visible = await viewer("GET", "/api/work-orders");
    assert.ok(visible.every(order => order.projectId !== p), "Global order lists cannot expose locked projects");
    assert.ok((await viewer("GET", "/api/projects")).every(project => project.id !== p));
    const status = await viewer("GET", `/api/access-locks/status?projectId=${p}`);
    assert.equal(status.blocked.scope, "project");
    await memberPage.bringToFront();
    await expect(memberPage.getByText("Project maintenance fixture", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(search).toBeHidden();
    await memberPage.keyboard.press("Escape");
    await expect(memberPage.getByText("Project maintenance fixture", { exact: true })).toBeVisible();
    assert.equal(await memberPage.evaluate(() => {
      const element = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return !!element?.closest('[role="alertdialog"]');
    }), true, "The lock panel supersedes a pre-existing portalled editor");

    await save(`${root}/access-lock`, false, "Project maintenance finished");
    await expect(search).toBeVisible({ timeout: 20_000 });
    await expect(memberPage.getByTestId("checkbox-status-open")).toBeChecked();
    await memberPage.getByTestId("button-dialog-close-filters").click();
    await expect(memberPage.getByRole("textbox").and(search)).toBeVisible();
    await expect(search).toHaveValue("LOCK-DRAFT"); // retained React state, not re-mounted editor
    assert.deepEqual(await api("GET", `${root}/work-orders`), originalOrders, "Lock/unlock does not alter business data");

    // Project permission grants recovery only for projects, not sitewide locks.
    await api("PUT", permissionRoot, { permissions: [...basic, "projects.manageAccessLocks"] });
    await save(`${root}/access-lock`, true, "Project maintenance fixture");
    await viewer("GET", `${root}/work-orders`);
    await viewer("GET", `${root}/access-lock`);
    await viewer("GET", "/api/access-locks/site", undefined, 403);
    await settingsPage.goto("/settings");
    await settingsPage.getByTestId("settings-tab-security").click();
    await settingsPage.getByTestId("settings-section-nav-access-locks").click();
    const siteCard = settingsPage.getByTestId("access-lock-site");
    await expect(siteCard).toBeVisible();
    await siteCard.getByTestId("access-lock-message").fill("Site maintenance fixture");
    await siteCard.getByTestId("access-lock-toggle").click();
    await settingsPage.getByTestId("access-lock-confirm").click();
    await expect(siteCard.getByText("Locked", { exact: true })).toBeVisible();
    await expect(settingsPage.getByTestId("access-lock-confirm")).toBeHidden();
    assert.equal((await api("GET", "/api/access-locks/site")).locked, true);
    await fsp.mkdir("generated-artifacts/access-locks", { recursive: true });
    await settingsPage.screenshot({ path: "generated-artifacts/access-locks/site-controls.jpg" });
    const siteStatus = await viewer("GET", `/api/access-locks/status?projectId=${p}`);
    assert.equal(siteStatus.blocked.scope, "site", "Site lock overrides project-management permission");
    await viewer("GET", `${root}/work-orders`, undefined, 423);
    await viewer("GET", `/api/projects/${other.id}/work-orders`, undefined, 423);
    await viewer("GET", `/API/PROJECTS/${other.id}/WORK-ORDERS/`, undefined, 423);
    await viewer("GET", `${root}/access-lock`, undefined, 423);
    await api("PUT", permissionRoot, { permissions: [...basic, "security.manageSiteAccessLocks"] });
    await viewer("GET", `${root}/work-orders`);
    await viewer("GET", "/api/access-locks/site");
    assert.equal((await viewer("GET", `/api/access-locks/status?projectId=${p}`)).blocked, null);
    await api("PUT", permissionRoot, { permissions: [...basic, "projects.manageAccessLocks"] });
    await viewer("GET", `${root}/work-orders`, undefined, 423);
    await viewer("GET", "/api/auth/user"); // identity remains available for lock-message UI
    const fresh = await browser.newContext({ baseURL });
    try {
      await request(fresh, "POST", "/api/auth/local/login", { username: fixture.viewer.username, password: "wrong" }, 401);
      await request(fresh, "POST", "/api/auth/local/login", fixture.viewer, 423);
      await request(fresh, "POST", "/api/auth/local/login", fixture);
    } finally { await fresh.close(); }
    await api("GET", `${root}/work-orders`); // authorized site administrator can recover
    await memberPage.bringToFront();
    await expect(memberPage.getByText("Site maintenance fixture", { exact: true })).toBeVisible({ timeout: 20_000 });
    await memberPage.setViewportSize({ width: 390, height: 844 });
    assert.ok(await memberPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await fsp.mkdir("generated-artifacts/access-locks", { recursive: true });
    await memberPage.screenshot({ path: "generated-artifacts/access-locks/locked-phone.jpg" });
    await save("/api/access-locks/site", false, "Site maintenance finished");
    await api("PUT", permissionRoot, { permissions: basic });
    await viewer("GET", `${root}/work-orders`, undefined, 423);
    await save(`${root}/access-lock`, false, "Project maintenance finished");
    await viewer("GET", `${root}/work-orders`);
    await memberPage.route("**/api/access-locks/status?projectId=*", route =>
      route.fulfill({ status: 503, json: { message: "Simulated status failure" } }));
    await memberPage.reload();
    await expect(memberPage.getByRole("heading", { name: "Access status unavailable" })).toBeVisible();
    await expect(memberPage.getByTestId("input-search-work-orders")).toBeHidden();
    await memberPage.unroute("**/api/access-locks/status?projectId=*");

    const audit = await db.query(`SELECT action,actor_id,outcome FROM meterflo_audit.events
      WHERE entity_type='access_lock' AND entity_id=ANY($1::text[])`, [[`project:${p}`, "site"]]);
    assert.ok(audit.rows.length >= 6);
    assert.ok(audit.rows.every(row => row.actor_id === fixture.id && row.outcome === "success"));
    assert.ok(audit.rows.some(row => row.action === "access.lock") && audit.rows.some(row => row.action === "access.unlock"));
    await save(`/api/projects/${other.id}/access-lock`, true, "Disposable project lock");
    const removed = await admin.request.delete(`/api/projects/${other.id}`);
    assert.ok([200, 204].includes(removed.status()));
    assert.equal((await db.query("SELECT count(*)::int AS count FROM public.access_locks WHERE project_id=$1", [other.id])).rows[0].count, 0,
      "Project deletion cascades its access lock without deleting the site control");
    console.log("PASS: access-lock permission management, confirmation/cancel, existing sessions, login, project isolation, site precedence, API/mobile/download guards, retained UI draft, audit attribution, concurrency conflict and deletion cascade.");
  } finally {
    await Promise.all([admin.close(), member.close()]);
    await browser.close();
    await db.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
