// Requires support/inventory-ui-fixture.ts create; only deletes projects this test creates.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const { chromium, expect } = require("@playwright/test");
const XLSX = require("xlsx");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")(),
    viewport: { width: 1440, height: 1000 }, hasTouch: true, acceptDownloads: true });
  const prefix = `projects-ui-${crypto.randomUUID().slice(0, 8)}`, owned = [];
  const out = "generated-artifacts/projects-responsive";
  await fs.mkdir(out, { recursive: true });
  assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
  try {
    for (let index = 0; index < 24; index++) {
      const response = await context.request.post("/api/projects", { data: {
        name: `${prefix} ${String(index).padStart(2, "0")}${index % 5 === 0 ? " Long customer project ".repeat(5) : ""}`,
        description: index === 4 ? '=SUM(1,2)' : index === 5 ? '<img src=x onerror="window.projectXss=true"> & "quoted"' :
          `Project details ${index} ${"Long readable description ".repeat(index % 4)}`,
        customerEmail: `${String(index).padStart(5, "0")}@example.test`,
      } });
      assert.equal(response.status(), 201, await response.text());
      const project = await response.json();
      owned.push(project);
      if (index % 7 === 0) {
        assert.ok((await context.request.patch(`/api/projects/${project.id}`, { data: { isActive: false } })).ok());
        project.isActive = false;
      }
    }
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/projects", { waitUntil: "domcontentloaded", timeout: 60000 });
    const results = page.getByTestId("projects-results"), rows = results.locator("[data-project-row]");
    const header = page.getByTestId("projects-workspace-header"), pager = page.getByTestId("projects-pagination");
    const search = page.getByTestId("input-search-projects"), size = async () => Number(await results.getAttribute("data-page-size"));
    await search.fill(prefix);
    const measure = () => results.evaluate(element => {
      const records = [...element.querySelectorAll("[data-project-row]")];
      const bounds = element.getBoundingClientRect(), last = records.at(-1)?.getBoundingClientRect();
      return { height: bounds.height, bottom: bounds.bottom, free: last ? bounds.bottom - last.bottom : 0,
        heights: records.map(row => row.getBoundingClientRect().height),
        keys: records.map(row => row.dataset.testid),
        clipped: records.some(row => row.scrollWidth > row.clientWidth + 1),
        padding: parseFloat(getComputedStyle(element).paddingBottom) };
    });
    const fit = async (label, matches) => {
      await expect(rows.first()).toBeVisible();
      await expect.poll(async () => rows.count()).toBe(Math.min(matches, await size()));
      await page.waitForTimeout(150);
      const metrics = await measure(), pagerBounds = await pager.boundingBox();
      assert.ok(metrics.height > 60, `${label}: usable records space`);
      assert.ok(pagerBounds.y + pagerBounds.height <= page.viewportSize().height + 2, `${label}: visible pager`);
      assert.equal(metrics.clipped, false, `${label}: no clipped inner record columns`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
        `${label}: no whole-page overflow`);
      if (metrics.heights[0] + metrics.padding * 2 <= metrics.height) {
        assert.ok(metrics.free >= metrics.padding - 1, `${label}: entire last record fits`);
        if (matches > await rows.count()) assert.ok(metrics.free < metrics.heights[0] + 4 + metrics.padding,
          `${label}: spare space cannot fit another complete record`);
      }
      return { ...metrics, capacity: await size() };
    };
    await expect(pager).toContainText("20");
    const desktop = await fit("desktop", 20);
    assert.ok(desktop.capacity > 1 && desktop.capacity < 20);
    await page.getByTestId("button-projects-next").click();
    await expect.poll(async () => (await measure()).keys[0]).not.toBe(desktop.keys[0]);
    const second = await measure();
    assert.equal(second.keys.some(id => desktop.keys.includes(id)), false);
    await page.getByTestId("button-projects-previous").click();
    await expect.poll(async () => (await measure()).keys).toEqual(desktop.keys);
    await expect(page.getByTestId("button-new-project")).toHaveAttribute("href", "/projects/new");
    const visibleId = Number(desktop.keys[0].replace("row-project-", ""));
    await expect(page.getByTestId(`button-view-${visibleId}`)).toHaveAttribute("href", `/projects/${visibleId}/work-orders`);
    await expect(page.getByTestId(`button-edit-${visibleId}`)).toHaveAttribute("href", `/projects/${visibleId}/edit`);
    await page.getByTestId(`button-delete-${visibleId}`).click();
    await page.getByTestId("button-cancel-delete").click();
    await page.getByTestId(`button-delete-${visibleId}`).click();
    await page.route(`**/api/projects/${visibleId}`, route => route.request().method() === "DELETE"
      ? route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Fixture failure"}' }) : route.continue());
    await page.getByTestId("button-confirm-delete").click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByRole("alertdialog")).toContainText("Delete Project");
    assert.ok((await context.request.get(`/api/projects/${visibleId}`)).ok());
    await page.getByTestId("button-cancel-delete").click();
    await page.unroute(`**/api/projects/${visibleId}`);
    await page.getByTestId("switch-show-inactive").click();
    await expect(pager).toContainText("24");
    await page.getByTestId("select-project-sort").selectOption("name-asc");
    await expect(rows.first()).toHaveAttribute("data-testid", `row-project-${owned[0].id}`);
    for (const [format, testId] of [["csv", "csv"], ["xlsx", "xlsx"]]) {
      const downloadEvent = page.waitForEvent("download");
      await page.getByTestId(`button-export-projects-${testId}`).click();
      const download = await downloadEvent, file = `${out}/matching-projects.${format}`;
      await download.saveAs(file);
      const workbook = XLSX.read(await fs.readFile(file), { type: "buffer" });
      const exported = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: false });
      assert.equal(exported.length, 25, `${format}: all matches across pages`);
      assert.ok(exported.slice(1).every(row => row[1].startsWith(prefix)), `${format}: no unrelated projects`);
      assert.equal(exported.find(row => row[1]?.startsWith(`${prefix} 04`))[2], "'=SUM(1,2)");
      assert.equal(exported.find(row => row[1]?.startsWith(`${prefix} 01`))[3], "00001@example.test");
    }
    const popupEvent = page.waitForEvent("popup");
    await page.getByTestId("button-export-projects-pdf").click();
    const popup = await popupEvent;
    await expect(popup.locator("tbody tr")).toHaveCount(24);
    assert.equal(await popup.locator("img").count(), 0, "HTML-like descriptions remain escaped text");
    assert.equal(await popup.evaluate(() => window.projectXss), undefined);
    await popup.close();
    await page.screenshot({ path: `${out}/desktop.png` });
    await search.fill("00001@example.test");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-testid", `row-project-${owned[1].id}`);
    await search.fill(String(owned[2].id));
    await expect(page.getByTestId(`row-project-${owned[2].id}`)).toBeVisible();
    await search.fill(`${prefix}-no-match`);
    await expect(page.getByTestId("projects-empty")).toBeVisible();
    for (const format of ["csv", "xlsx", "pdf"]) await expect(page.getByTestId(`button-export-projects-${format}`)).toBeDisabled();
    await search.fill(prefix);
    for (const viewport of [{ width: 1024, height: 720 }, { width: 1280, height: 650 }]) {
      await page.setViewportSize(viewport);
      await fit(`${viewport.width} desktop`, 24);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const toggle = page.getByTestId("button-toggle-project-tools");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const phone = await fit("phone", 24);
    assert.ok(phone.capacity > 1, "phone leaves room for multiple records");
    await page.screenshot({ path: `${out}/phone.png` });
    await page.locator(`[data-testid="button-project-details-${owned[0].id}"]:visible`).click();
    await expect(page.getByTestId("project-details-dialog")).toContainText(owned[0].name);
    await page.keyboard.press("Escape");
    await toggle.click();
    await expect.poll(size).toBeLessThan(phone.capacity);
    await toggle.click();
    await expect.poll(size).toBe(phone.capacity);
    await page.setViewportSize({ width: 844, height: 390 });
    await fit("touch landscape", 24);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.screenshot({ path: `${out}/landscape.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await fit("portrait return", 24);
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Fresh coarse-pointer landscape loads must remain compact as well.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await page.route("**/api/projects", route => route.fulfill({
      status: 503, contentType: "application/json", body: '{"message":"Fixture connection failure"}',
    }));
    await page.getByTestId("button-refresh-projects").click();
    await expect(page.getByTestId("projects-error")).toBeVisible({ timeout: 15000 });
    await page.unroute("**/api/projects");
    await page.getByTestId("button-retry-projects").click();
    await expect(rows.first()).toBeVisible();
    // Exercise real read-only account permissions, not only administrator visibility.
    for (const project of owned.slice(0, 2)) assert.ok((await context.request.post(`/api/projects/${project.id}/users`,
      { data: { userId: fixture.viewer.id } })).ok());
    assert.ok((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, { data: {
      permissions: ["nav.projects", "projects.view", "workOrders.view"],
    } })).ok());
    const viewer = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")(),
      viewport: { width: 390, height: 844 }, hasTouch: true });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const viewerPage = await viewer.newPage();
    await viewerPage.goto("/projects", { waitUntil: "domcontentloaded", timeout: 60000 });
    await expect(viewerPage.getByTestId(`row-project-${fixture.projectId}`)).toBeVisible();
    await expect(viewerPage.getByTestId(`row-project-${owned[1].id}`)).toBeVisible();
    await expect(viewerPage.getByTestId(`row-project-${owned[0].id}`)).toHaveCount(0);
    await expect(viewerPage.getByTestId("button-new-project")).toHaveCount(0);
    assert.equal(await viewerPage.locator('[data-testid^="button-edit-"],[data-testid^="button-delete-"]').count(), 0);
    await viewerPage.getByTestId("button-toggle-project-tools").click();
    await expect(viewerPage.getByTestId("switch-show-inactive")).toBeDisabled();
    const viewerDownload = viewerPage.waitForEvent("download");
    await viewerPage.getByTestId("button-export-projects-csv").click();
    const viewerWorkbook = XLSX.read(await fs.readFile(await (await viewerDownload).path()), { type: "buffer" });
    const viewerRows = XLSX.utils.sheet_to_json(viewerWorkbook.Sheets[viewerWorkbook.SheetNames[0]], { header: 1 });
    assert.deepEqual(viewerRows.slice(1).map(row => Number(row[0])).sort((a, b) => a - b),
      [fixture.projectId, owned[1].id].sort((a, b) => a - b), "exports contain only authorized active projects");
    assert.equal((await viewer.request.post("/api/projects", { data: { name: `${prefix}-forbidden` } })).status(), 403);
    assert.ok((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, { data: {
      permissions: ["nav.projects", "projects.view", "workOrders.view", "projects.viewInactive"],
    } })).ok());
    await viewerPage.reload();
    await viewerPage.getByTestId("button-toggle-project-tools").click();
    await expect(viewerPage.getByTestId("switch-show-inactive")).toBeEnabled();
    await viewerPage.getByTestId("switch-show-inactive").click();
    await expect(viewerPage.getByTestId(`row-project-${owned[0].id}`)).toBeVisible();
    await viewer.close();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, desktopCapacity: desktop.capacity, phoneCapacity: phone.capacity,
      projectCount: owned.length, checks: "density, header/pager, permissions, search, sort, exports, delete failure, rotation" }));
  } finally {
    // IDs originate solely from successful creations in this run, never a broad prefix deletion.
    for (const project of owned) {
      const response = await context.request.delete(`/api/projects/${project.id}`);
      if (response.status() !== 204) throw new Error(`Owned project cleanup failed: ${project.id} (${response.status()})`);
    }
    await context.close();
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
