const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");

(async () => {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      baseURL: require("./support/workspace-ui-base.cjs")(), viewport: { width: 1440, height: 1000 },
    });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const viewer = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")() });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    assert.equal((await viewer.request.delete(`/api/projects/${fixture.projectId}`)).status(), 403);
    assert.equal((await viewer.request.get("/api/project-deletion-cleanups")).status(), 403);
    assert.equal((await viewer.request.post(`/api/project-deletion-cleanups/project_deletion_${fixture.projectId}-00000000-0000-0000-0000-000000000000/retry`)).status(), 403);
    assert.equal((await context.request.delete("/api/projects/invalid")).status(), 400);
    const disabled = process.argv.includes("--disabled");
    if (disabled) assert.equal((await context.request.patch(`/api/projects/${fixture.projectId}`, {
      data: { inventoryEnabled: false },
    })).status(), 200);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/projects");
    await page.getByTestId("projects-workspace").waitFor({ timeout: 15000 }).catch(async error => {
      await fs.mkdir("generated-artifacts/project-deletion", { recursive: true });
      await page.screenshot({ path: "generated-artifacts/project-deletion/load-error.jpg" });
      console.error("Workspace load diagnostics:", JSON.stringify({ url: page.url(), errors }));
      throw error;
    });
    await page.getByRole("searchbox").first().fill(String(fixture.projectId));
    await page.getByTestId(`button-delete-${fixture.projectId}`).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete Project" });
    await expect(dialog.getByText(/even when Inventory is disabled/)).toBeVisible();
    await dialog.getByTestId("button-cancel-delete").click();
    assert.equal((await context.request.get(`/api/projects/${fixture.projectId}`)).status(), 200, "Cancel preserves project");
    await page.getByTestId(`button-delete-${fixture.projectId}`).click();
    const deletion = page.waitForResponse(response =>
      response.request().method() === "DELETE" && response.url().endsWith(`/api/projects/${fixture.projectId}`));
    await dialog.getByTestId("button-confirm-delete").click();
    assert.equal((await deletion).status(), 204);
    await expect(dialog).not.toBeVisible();
    await expect(page.getByTestId(`button-delete-${fixture.projectId}`)).toHaveCount(0);
    assert.equal((await context.request.get(`/api/projects/${fixture.projectId}`)).status(), 404);
    const pending = await (await context.request.get("/api/project-deletion-cleanups")).json();
    assert.ok(!pending.some(job => job.projectId === fixture.projectId));

    // Exercise the exceptional cleanup banner without altering other projects.
    let recovered = false;
    const key = `project_deletion_${fixture.projectId}-00000000-0000-0000-0000-000000000000`;
    await page.route("**/api/project-deletion-cleanups", route => route.fulfill({ json: recovered ? [] : [
      { key, projectId: fixture.projectId, projectName: "Disposable file-lock UI case", restore: false },
    ] }));
    await page.route(`**/api/project-deletion-cleanups/${key}/retry`, route => {
      recovered = true; return route.fulfill({ status: 204, body: "" });
    });
    await page.reload();
    await page.setViewportSize({ width: 390, height: 844 });
    const banner = page.getByTestId("project-deletion-cleanups");
    await expect(banner).toBeVisible();
    assert.ok(await banner.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await page.getByTestId(`retry-project-cleanup-${fixture.projectId}`).click();
    await expect(banner).toHaveCount(0);
    await fs.mkdir("generated-artifacts/project-deletion", { recursive: true });
    await page.screenshot({ path: `generated-artifacts/project-deletion/${disabled ? "disabled" : "enabled"}-inventory.jpg` });
    assert.deepEqual(errors, []);
    console.log(`PASS: real administrator deletion (${disabled ? "disabled" : "enabled"} inventory), cancel, permissions, refresh, and mobile cleanup retry UI.`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
