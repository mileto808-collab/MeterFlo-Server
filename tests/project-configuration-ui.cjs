// Real authenticated UI and persistence checks. Only sandbox-owned projects/accounts are used.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 20000 });
const baseURL = require("./support/workspace-ui-base.cjs")();
const out = "generated-artifacts/project-workspace";
async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const owned = [];
  const unique = crypto.randomUUID().slice(0, 8);
  await fs.mkdir(out, { recursive: true });
  assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
  const page = await context.newPage(), errors = [], writes = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", req => {
    if (new URL(req.url()).pathname.startsWith("/api/projects") && !["GET", "HEAD"].includes(req.method()))
      writes.push({ path: new URL(req.url()).pathname, method: req.method(), body: req.postDataJSON() });
  });
  const choose = async (group, leaf = group, label) => {
    const menu = page.getByTestId("project-mobile-menu");
    // Wait for matchMedia's React subscription after a resize before deciding
    // which navigation control to operate.
    const compact = await page.evaluate(() => matchMedia("(max-width: 767px), (orientation: landscape) and (pointer: coarse) and (max-height: 600px) and (max-width: 960px)").matches);
    await expect.poll(() => menu.isVisible()).toBe(compact);
    if (await menu.isVisible()) {
      await menu.click();
      const option = label ? page.getByRole("option", { name: label, exact: true })
        : page.getByTestId(`project-section-nav-${leaf}`);
      await option.click();
      await expect(page.getByRole("listbox")).toHaveCount(0);
    } else {
      await page.getByTestId(`project-tab-${group}`).click();
      if (leaf !== group) await page.getByTestId(`project-section-nav-${leaf}`).click();
    }
  };
  const select = async (id, option) => {
    await page.getByTestId(id).click();
    await page.getByRole("option", { name: option, exact: true }).click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
  };
  const fit = async label => {
    const dimensions = await page.evaluate(() => {
      const box = id => {
        const el = document.querySelector(`[data-testid="${id}"]`), r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, bottom: r.bottom, height: r.height, overflow: el.scrollWidth - el.clientWidth };
      };
      const content = document.querySelector('[data-testid="project-content"]');
      return { header: box("project-workspace-header"), content: box("project-content"),
        footer: box("project-workspace-actions"), outer: document.documentElement.scrollWidth - innerWidth,
        appHeaderBottom: document.querySelector("main").previousElementSibling?.getBoundingClientRect().bottom ?? 0,
        controls: [...content.querySelectorAll("input,textarea,button,[role=combobox]")].filter(el => el.getClientRects().length)
          .filter(el => el.scrollWidth > el.clientWidth + 2).map(el => el.dataset.testid || el.id),
        contentScroll: content.scrollHeight, height: innerHeight };
    });
    assert.ok(dimensions.header.y >= dimensions.appHeaderBottom - 1, `${label}: title stays below the app header ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.footer.bottom <= dimensions.height + 2, `${label}: footer fits ${JSON.stringify(dimensions)}`);
    assert.ok(dimensions.content.height >= 75, `${label}: content has usable height`);
    assert.ok(dimensions.content.overflow <= 2, `${label}: no clipped content width`);
    assert.ok(dimensions.outer <= 2, `${label}: no page overflow`);
    assert.deepEqual(dimensions.controls, [], `${label}: no clipped field contents`);
    const content = page.getByTestId("project-content");
    await content.evaluate(el => el.scrollTo({ top: el.scrollHeight }));
    await expect(page.getByTestId("button-submit")).toBeInViewport();
    await expect(page.getByTestId("button-cancel")).toBeInViewport();
    await expect.poll(() => content.evaluate(el => {
      el.scrollTo({ top: el.scrollHeight });
      return Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 3;
    }), { message: `${label}: final settings reachable after sidebar resizing` }).toBe(true);
    await page.screenshot({ path: `${out}/${label}.jpg` });
  };
  try {
    await page.goto("/projects/new");
    await expect(page.getByTestId("input-name")).toBeVisible();
    await expect(page.getByTestId("project-tab-people")).toHaveCount(0);
    await expect(page.getByTestId("project-tab-integrations")).toHaveCount(0);
    await page.getByTestId("input-name").fill(`Workspace ${unique}`);
    await page.getByTestId("input-description").fill("Unsaved description survives navigation and rotation.");
    await choose("work-orders", "wizard");
    await select("select-wizard-mode", "User Choice (Select at Start)");
    await choose("schedule");
    await page.getByTestId("input-project-service-default").fill("45");
    await page.getByTestId("input-project-tolerance-default").fill("0");
    await choose("details");
    await expect(page.getByTestId("input-name")).toHaveValue(`Workspace ${unique}`);
    await expect(page.getByTestId("input-description")).toHaveValue("Unsaved description survives navigation and rotation.");
    assert.equal(writes.length, 0, "navigation and configuration changes do not write");
    // Keyboard-operated primary tabs.
    await page.getByTestId("project-tab-details").focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("project-tab-work-orders")).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByTestId("project-tab-schedule")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByTestId("project-tab-details")).toBeFocused();
    // Invalid fields in an inactive section must be revealed and focused.
    await page.getByTestId("input-name").fill("");
    await choose("schedule");
    await page.getByTestId("button-submit").click();
    await expect(page.getByTestId("input-name")).toBeFocused();
    await expect(page.getByText("Name is required", { exact: true })).toBeVisible();
    await page.getByTestId("input-name").fill(`Workspace ${unique}`);
    await page.getByTestId("input-email").fill("invalid");
    await choose("work-orders", "wizard");
    await page.getByTestId("button-submit").click();
    await expect(page.getByTestId("input-email")).toBeFocused();
    await page.getByTestId("input-email").fill("workspace@example.test");
    await choose("schedule");
    await page.getByTestId("switch-operational-hours-enabled").click();
    await choose("details");
    await page.getByTestId("button-submit").click();
    await expect(page.getByTestId("input-operational-hours-start")).toBeFocused();
    await page.getByTestId("input-operational-hours-start").fill("08:00");
    await choose("details");
    await page.getByTestId("button-submit").click();
    await expect(page.getByTestId("input-operational-hours-end")).toBeFocused();
    await page.getByTestId("input-operational-hours-end").fill("17:00");
    await page.getByTestId("input-project-service-default").fill("0");
    await choose("details");
    await page.getByTestId("button-submit").click();
    await expect(page.getByTestId("input-project-service-default")).toBeFocused();
    await page.getByTestId("input-project-service-default").fill("45");
    assert.equal(writes.length, 0, "all invalid submissions blocked");
    const created = page.waitForResponse(r => new URL(r.url()).pathname === "/api/projects" && r.request().method() === "POST");
    await page.getByTestId("button-submit").click();
    const response = await created;
    assert.equal(response.status(), 201, await response.text());
    const project = await response.json(); owned.push(project.id);
    await expect(page).toHaveURL(/\/projects$/);
    assert.equal(project.defaultServiceMinutes, 45);
    assert.equal(project.defaultAppointmentToleranceMinutes, 0);
    // Preserve the existing create endpoint's semantics; verify the form submits
    // the complete draft even for settings the create endpoint doesn't yet store.
    assert.equal(writes.at(-1).body.wizardMode, "user_choice");
    await page.goto(`/projects/${project.id}/edit`);
    await expect(page.getByTestId("input-name")).toHaveValue(`Workspace ${unique}`);
    await page.getByTestId("input-name").fill(`Local ${unique}`);
    await choose("schedule");
    // Existing creation persists project basics/planning, while full settings are
    // retained by the edit endpoint. Establish hours through the real edit form.
    if (await page.getByTestId("switch-operational-hours-enabled").getAttribute("aria-checked") === "false")
      await page.getByTestId("switch-operational-hours-enabled").click();
    await page.getByTestId("input-operational-hours-start").fill("08:00");
    await page.getByTestId("input-operational-hours-end").fill("17:00");
    const savedBeforeManagement = writes.length;
    await choose("schedule");
    await page.getByTestId("input-holiday-date").fill("2027-12-25");
    await page.getByTestId("input-holiday-name").fill("Retained local holiday");
    await choose("people");
    await select("select-add-user", "Inventory Viewer");
    await choose("details");
    await choose("schedule");
    await expect(page.getByTestId("input-holiday-name")).toHaveValue("Retained local holiday");
    await choose("people");
    await expect(page.getByTestId("select-add-user")).toContainText("Inventory Viewer");
    assert.equal(writes.length, savedBeforeManagement, "manager drafts do not save on section changes");
    await page.getByTestId("button-add-user").click();
    await expect(page.getByTestId(`button-remove-user-${fixture.viewer.id}`)).toBeVisible();
    await choose("schedule");
    await page.getByTestId("button-add-holiday").click();
    await expect(page.getByText(/Retained local holiday/)).toBeVisible();
    const stored = await (await context.request.get(`/api/projects/${project.id}`)).json();
    assert.equal(stored.name, `Workspace ${unique}`, "independent management must not submit project fields");
    await choose("work-orders", "service-types");
    const service = page.locator('[data-testid^="service-type-toggle-"]').first();
    await expect(service).toBeVisible();
    const servicesSaved = page.waitForResponse(r => r.url().endsWith(`/projects/${project.id}/service-types`) && r.request().method() === "PUT");
    await service.click(); assert.equal((await servicesSaved).status(), 200);
    await choose("work-orders", "sub-statuses");
    await page.getByRole("button", { name: "Add sub-status", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Parent status", { exact: true }).click();
    await page.getByRole("option").first().click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await dialog.getByLabel("Code", { exact: true }).fill(`WS_${unique}`);
    await dialog.getByLabel("Name", { exact: true }).fill(`Workspace status ${unique}`);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(`Workspace status ${unique}`);
    await dialog.getByRole("button", { name: /Create sub-status|Save/, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(`Workspace status ${unique}`, { exact: true })).toBeVisible();
    await choose("details");
    await expect(page.getByTestId("input-name")).toHaveValue(`Local ${unique}`);
    await choose("work-orders", "wizard");
    await select("select-wizard-mode", "User Choice (Select at Start)");
    await select("select-changeout-equipment-type", "System Only");
    await select("select-reading-equipment-type", "Module Only");
    await select("select-systemReadingDecimalPlaces", "0");
    await select("select-moduleReadingDecimalPlaces", "6");
    await select("select-wizard-mode", "Changeout Only");
    await expect(page.getByTestId("select-moduleReadingDecimalPlaces")).toHaveCount(0);
    await choose("work-orders", "search");
    await page.getByTestId("switch-search-barcode").click();
    await choose("details");
    // Resize the same mounted form; don't navigate/reload away local changes.
    for (const [label, viewport] of [
      ["desktop", { width: 1440, height: 900 }], ["supplied-size", { width: 1024, height: 544 }],
      ["short-desktop", { width: 900, height: 480 }], ["narrow-desktop", { width: 780, height: 420 }],
      ["phone", { width: 390, height: 844 }], ["small-phone", { width: 360, height: 640 }],
    ]) {
      await page.setViewportSize(viewport);
      for (const group of ["details", "work-orders", "schedule", "people", "integrations"]) {
        await choose(group, group === "work-orders" ? "wizard" : group);
        await fit(`${label}-${group}`);
      }
      await choose("details");
      await expect(page.getByTestId("input-name")).toHaveValue(`Local ${unique}`);
      const sidebar = page.getByTestId("button-sidebar-toggle");
      if (viewport.width >= 768 && await sidebar.isVisible()) {
        await sidebar.click(); await fit(`${label}-sidebar-changed`); await sidebar.click();
      }
    }
    await page.setViewportSize({ width: 1024, height: 544 });
    const saved = page.waitForResponse(r => r.url().endsWith(`/api/projects/${project.id}`) && r.request().method() === "PATCH");
    await page.getByTestId("button-submit").click(); assert.equal((await saved).status(), 200);
    await page.goto(`/projects/${project.id}/edit`);
    await expect(page.getByTestId("input-name")).toHaveValue(`Local ${unique}`);
    await choose("work-orders", "wizard");
    await expect(page.getByTestId("select-systemReadingDecimalPlaces")).toContainText("0");
    await select("select-wizard-mode", "User Choice (Select at Start)");
    await expect(page.getByTestId("select-moduleReadingDecimalPlaces")).toContainText("6");
    await expect(page.getByTestId("select-reading-equipment-type")).toContainText("Module Only");
    await choose("work-orders", "search");
    await expect(page.getByTestId("switch-search-barcode")).toHaveAttribute("aria-checked", "false");
    await choose("details");
    const copied = page.waitForResponse(r => r.url().endsWith(`/projects/${project.id}/copy`) && r.request().method() === "POST");
    await page.getByTestId("button-copy-project").click();
    const copyResponse = await copied; assert.ok(copyResponse.ok());
    const copy = await copyResponse.json(); owned.push(copy.id);
    await expect(page).toHaveURL(new RegExp(`/projects/${copy.id}/edit$`));
    await page.getByTestId("button-cancel").click(); await expect(page).toHaveURL(/\/projects$/);
    assert.equal(await page.evaluate(() => document.documentElement.style.overflow), "", "leaving restores the document scroll policy");
    assert.deepEqual(errors, [], "no uncaught browser errors");
    // Touch-phone landscape follows the compact selector even above desktop width breakpoint.
    const touch = await browser.newContext({ baseURL, viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
    assert.equal((await touch.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const phone = await touch.newPage();
    await phone.goto(`/projects/${project.id}/edit`);
    await expect(phone.getByTestId("project-mobile-menu")).toBeVisible();
    await phone.getByTestId("input-name").fill("Touch landscape draft");
    await phone.setViewportSize({ width: 390, height: 844 });
    await expect(phone.getByTestId("input-name")).toHaveValue("Touch landscape draft");
    for (const viewport of [{ width: 844, height: 390 }, { width: 740, height: 320 }]) {
      await phone.setViewportSize(viewport);
      for (const section of ["details", "wizard", "search", "service-types", "sub-statuses", "schedule", "people", "integrations"]) {
        await phone.getByTestId("project-mobile-menu").click();
        await phone.getByTestId(`project-section-nav-${section}`).click();
        await expect(phone.getByRole("listbox")).toHaveCount(0);
        await expect(phone.getByTestId("button-submit")).toBeInViewport();
        await expect(phone.getByTestId("button-copy-project")).toBeInViewport();
        const scroller = phone.getByTestId("project-content");
        const metrics = await scroller.evaluate(el => ({ height: el.clientHeight, width: el.clientWidth, contentWidth: el.scrollWidth }));
        assert.ok(metrics.height >= 70 && metrics.contentWidth <= metrics.width + 2,
          `touch ${viewport.width} ${section}: usable scroll region, no clipped content ${JSON.stringify(metrics)}`);
        await scroller.evaluate(el => el.scrollTo({ top: el.scrollHeight }));
        await expect.poll(() => scroller.evaluate(el => Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 3)).toBe(true);
        await phone.screenshot({ path: `${out}/touch-${viewport.width}-${section}.jpg` });
      }
    }
    await phone.getByTestId("project-mobile-menu").click();
    await phone.getByTestId("project-section-nav-schedule").click();
    await expect(phone.getByRole("listbox")).toHaveCount(0);
    await phone.getByTestId("input-operational-hours-end").fill("");
    await phone.getByTestId("project-mobile-menu").click();
    await phone.getByTestId("project-section-nav-details").click();
    await expect(phone.getByRole("listbox")).toHaveCount(0);
    await phone.getByTestId("button-submit").click();
    await expect(phone.getByTestId("input-operational-hours-end")).toBeFocused();
    await expect(phone.getByTestId("input-operational-hours-end")).toBeInViewport({ ratio: 1 });
    await touch.close();
    // Normal role administration, not direct permission-table fixtures.
    const grants = ["projects.view", "projects.edit", "nav.projects", "project.workOrders", "workOrders.view"];
    assert.ok((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, { data: { permissions: grants } })).ok());
    const member = await browser.newContext({ baseURL });
    assert.equal((await member.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const restricted = await member.newPage();
    await restricted.goto(`/projects/${project.id}/edit`);
    await expect(restricted.getByTestId("input-name")).toBeVisible();
    await expect(restricted.getByTestId("switch-inventory-enabled")).toHaveCount(0);
    await restricted.getByTestId("project-tab-work-orders").click();
    await expect(restricted.getByTestId("select-systemReadingDecimalPlaces")).toHaveCount(0);
    await restricted.getByTestId("project-section-nav-sub-statuses").click();
    await expect(restricted.getByRole("button", { name: "Add sub-status", exact: true })).toHaveCount(0);
    const patch = restricted.waitForRequest(r => r.url().endsWith(`/api/projects/${project.id}`) && r.method() === "PATCH");
    await restricted.getByTestId("button-submit").click();
    const body = (await patch).postDataJSON();
    assert.equal(Object.hasOwn(body, "systemReadingDecimalPlaces"), false);
    assert.equal(Object.hasOwn(body, "moduleReadingDecimalPlaces"), false);
    await expect(restricted).toHaveURL(/\/projects$/);
    const protectedProject = await (await context.request.get(`/api/projects/${project.id}`)).json();
    assert.equal(protectedProject.systemReadingDecimalPlaces, 0);
    assert.equal(protectedProject.moduleReadingDecimalPlaces, 6);
    await member.close();
    console.log("Project configuration navigation, validation, management, persistence, and viewport checks passed");
  } catch (error) {
    await page.screenshot({ path: `${out}/failure.jpg` }).catch(() => {});
    await fs.writeFile(`${out}/failure.txt`, await page.locator("body").ariaSnapshot()).catch(() => {});
    throw error;
  } finally {
    for (const id of owned.reverse()) await context.request.delete(`/api/projects/${id}`);
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
