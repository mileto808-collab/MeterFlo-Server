const assert = require("node:assert/strict");
const { Pool } = require("pg");

module.exports = async function ({ page, api, command, root, fixture, expect, context }) {
  let state = (await api("GET", `${root}/inventory`)).state;
  const serials = new Set();
  const candidates = state.returns.filter(record => {
    if (!["pending", "quarantine"].includes(record.status) || !record.serial?.trim() ||
      record.status === "quarantine" && record.warehouseId !== "wizard-w" || serials.has(record.serial.trim())) return false;
    serials.add(record.serial.trim()); return true;
  }).slice(0, 4);
  assert.equal(candidates.length, 4, "Owned wizard flows must produce four distinct physical equipment returns");
  const rule = state.removalRules.find(rule => rule.stage === "warehouse" && rule.outcome === "customer_return");
  for (const record of candidates) {
    if (record.status === "pending") await command("returnAccept", { id: record.id, warehouseId: "wizard-w" });
    await command("returnDecide", { id: record.id, ruleId: rule.id, ruleRevision: rule.revision, reason: "Inspected and held for customer collection" });
  }
  state = (await api("GET", `${root}/inventory`)).state;
  const stockBefore = structuredClone(state.stock), beforeCount = state.customerHandoffs?.length ?? 0;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/projects/${fixture.projectId}/inventory`);
  await page.getByRole("tab", { name: "Removed Equipment", exact: true }).click();
  await page.getByRole("button", { name: "Customer handoffs", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Customer handoff & manifests" });
  await dialog.getByLabel("Handoff warehouse / location", { exact: true }).selectOption("wizard-w");
  for (const record of candidates.slice(0, 2))
    await dialog.getByRole("checkbox", { name: `Select serial ${record.serial}`, exact: true }).check();
  await dialog.getByLabel("Customer recipient / collected by", { exact: true }).fill("Visual customer depot");
  await dialog.getByLabel("Handoff / shipping reference (optional)", { exact: true }).fill("BULK-VISUAL");
  await dialog.getByLabel("Handoff notes", { exact: true }).fill("Every old serial visually matched at collection.");
  const confirm = dialog.getByRole("button", { name: "Confirm customer handoff (2)", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("checkbox", { name: /I visually verified/ }).check();
  await confirm.click();
  await expect(dialog.getByRole("button", { name: "Print this manifest", exact: true })).toBeVisible();
  const visualState = (await api("GET", `${root}/inventory`)).state;
  const visual = visualState.customerHandoffs.at(-1);
  assert.equal(visual.verification, "visual"); assert.equal(visual.lines.length, 2);
  assert.deepEqual(visual.lines.map(line => line.serial), candidates.slice(0, 2).map(record => record.serial));
  const printEvent = context.waitForEvent("page");
  await dialog.getByRole("button", { name: "Print this manifest", exact: true }).click();
  const manifest = await printEvent; await manifest.waitForLoadState();
  await expect(manifest.locator(".serials")).toContainText(candidates[0].serial);
  await expect(manifest.locator(".serials")).toContainText(candidates[1].serial);
  await manifest.emulateMedia({ media: "print" });
  assert.equal(await manifest.locator(".serials").evaluate(element => getComputedStyle(element).breakBefore), "page");
  const visualPdf = await manifest.pdf({ path: "generated-artifacts/wizard-use/customer-visual-manifest.pdf", format: "A4", preferCSSPageSize: true });
  assert.equal((visualPdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length, 2);
  await manifest.close();
  for (const record of candidates.slice(2))
    await dialog.getByRole("checkbox", { name: `Select serial ${record.serial}`, exact: true }).check();
  await dialog.getByLabel("Serial verification", { exact: true }).selectOption("scan");
  await dialog.getByLabel("Customer recipient / collected by", { exact: true }).fill("Scanned customer depot");
  await dialog.getByLabel("Handoff / shipping reference (optional)", { exact: true }).fill("BULK-SCAN");
  await dialog.getByLabel("Handoff notes", { exact: true }).fill("All serials scanned for actual dispatch.");
  await expect(confirm).toBeDisabled();
  const scanInput = dialog.getByLabel("Scan equipment serial", { exact: true });
  await scanInput.fill("NOT-IN-HANDOFF"); await scanInput.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("does not uniquely match");
  for (const record of [candidates[3], candidates[2]]) {
    await scanInput.fill(record.serial); await scanInput.press("Enter");
  }
  await scanInput.fill(candidates[2].serial); await scanInput.press("Enter");
  await expect(dialog.getByRole("alert")).toContainText("already been scanned");
  await expect(confirm).toBeEnabled();
  const posts = [];
  let loseResponse = true;
  await page.route(`**${root}/inventory/commands`, async route => {
    if (route.request().method() !== "POST" || route.request().postDataJSON().action !== "returnCustomerBatch") return route.continue();
    posts.push(route.request().postDataJSON());
    if (loseResponse) { loseResponse = false; await route.fetch(); return route.abort("connectionreset"); }
    return route.continue();
  });
  await confirm.click();
  await expect(dialog.getByRole("button", { name: "Retry this handoff", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Customer handoffs", exact: true }).click();
  await dialog.getByRole("button", { name: "Retry this handoff", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Print this manifest", exact: true })).toBeVisible();
  assert.equal(posts.length, 2); assert.deepEqual(posts[1], posts[0], "Unknown outcome retries must retain payload and identity");
  await page.unroute(`**${root}/inventory/commands`);
  const final = (await api("GET", `${root}/inventory`)).state;
  assert.equal(final.customerHandoffs.length, beforeCount + 2);
  assert.deepEqual(final.stock, stockBefore);
  const scanned = final.customerHandoffs.at(-1);
  assert.equal(scanned.verification, "scan");
  assert.deepEqual(scanned.lines.map(line => line.verifiedSerial), [candidates[3].serial, candidates[2].serial]);
  const response = await page.request.get(`${root}/inventory/print/customer-handoff/${scanned.id}`);
  assert.equal(response.status(), 200);
  const html = await response.text();
  assert.ok(html.includes("in scan order") && html.includes('class="serials"'));
  for (const line of scanned.lines) {
    const work = await api("GET", `${root}/work-orders/${line.workOrderId}`);
    if (work.customerWoId?.trim()) assert.ok(html.includes(work.customerWoId));
  }
  const scannedPage = await context.newPage();
  await scannedPage.goto(`${root}/inventory/print/customer-handoff/${scanned.id}`);
  await scannedPage.emulateMedia({ media: "print" });
  const scannedPdf = await scannedPage.pdf({ path: "generated-artifacts/wizard-use/customer-scanned-manifest.pdf", format: "A4", preferCSSPageSize: true });
  assert.equal((scannedPdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length, 2);
  await scannedPage.close();
  const viewer = await context.browser().newContext({ baseURL: require("./workspace-ui-base.cjs")() });
  try {
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const denied = await viewer.request.post(`${root}/inventory/commands`, { data: { ...posts[0], operationId: crypto.randomUUID() } });
    assert.equal(denied.status(), 403, "Ordinary inventory/work-order access must not permit customer handoffs");
  } finally { await viewer.close(); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: [counts] } = await pool.query(`SELECT
      (SELECT count(*)::int FROM public.inventory_customer_handoffs WHERE project_id=$1) AS headers,
      (SELECT count(*)::int FROM public.inventory_customer_handoff_lines WHERE project_id=$1) AS lines`, [fixture.projectId]);
    assert.equal(counts.headers, beforeCount + 2);
    assert.ok(counts.lines >= 5);
    const { rows: constraints } = await pool.query(`SELECT indexname FROM pg_indexes WHERE tablename='inventory_customer_handoff_lines'`);
    assert.ok(constraints.some(row => row.indexname === "inventory_customer_handoff_return_unique"));
  } finally { await pool.end(); }
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.locator("summary").filter({ hasText: "Completed handoffs" }).click();
  await expect(dialog.getByRole("button", { name: `Print manifest ${scanned.id}`, exact: true })).toBeVisible();
  await page.screenshot({ path: "generated-artifacts/wizard-use/customer-handoff-phone.jpg", fullPage: true });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  console.log("PASS: bulk visual and scanned customer handoffs, serial appendix PDF, rejected scans, immutable identities, lost-response retry after reopening, relational persistence and phone manifest history.");
};
