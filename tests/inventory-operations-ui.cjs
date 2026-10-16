// Requires the disposable inventory-ui-fixture --operations.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");
const XLSX = require("xlsx");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const out = "generated-artifacts/inventory-operations";
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
  try {
    const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
    const context = await browser.newContext({ baseURL, acceptDownloads: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const snapshot = async () => (await (await context.request.get(endpoint)).json()).state;
    const before = await snapshot();
    assert.equal(before.returns.length, 45, "Use --operations fixture");
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1100 });
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    for (const [kind, tab, label, option, expected] of [
      ["locations", "Locations", "Location type", "vehicle", 22],
      ["exceptions", "Shipment exceptions", "Location", "ops-location-0", 1],
      ["returns", "Removed Equipment", "Status", "pending", 22],
      ["activity", "Activity", "Action", "receive", 22],
    ]) {
      await page.getByRole("tab", { name: tab, exact: true }).click();
      const header = page.getByTestId(`inventory-${kind}-subheader`);
      const results = page.getByTestId(`inventory-${kind}-results`);
      const pager = page.getByTestId(`inventory-${kind}-pagination`);
      const search = page.getByRole("searchbox", { name: `Search ${kind}`, exact: true });
      const rows = results.locator("[data-operations-row]");
      await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(1);
      const tall = Number(await results.getAttribute("data-page-size"));
      const first = await rows.first().innerText();
      await page.getByRole("button", { name: `Next ${kind} page` }).click();
      await expect.poll(() => rows.first().innerText()).not.toBe(first);
      await page.getByRole("button", { name: `Previous ${kind} page` }).click();
      await page.setViewportSize({ width: 1440, height: 720 });
      await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeLessThan(tall);
      await page.getByTestId("button-toggle-inventory-stats").click();
      await expect(page.getByTestId("inventory-stats-region")).toBeVisible();
      await page.getByTestId("button-toggle-inventory-stats").click();
      await page.screenshot({ path: `${out}/${kind}-desktop.jpg` });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(async () => (await pager.boundingBox()).y + (await pager.boundingBox()).height).toBeLessThanOrEqual(844);
      assert.ok((await results.boundingBox()).height >= 120, "Usable phone records height");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.ok(await results.evaluate(el => [...el.querySelectorAll("article")].every(row => row.scrollWidth <= row.clientWidth + 1)), "No horizontally clipped records");
      const top = (await header.boundingBox()).y;
      await results.evaluate(el => el.scrollTop = 999);
      assert.ok(Math.abs((await header.boundingBox()).y - top) < 1);
      await results.evaluate(el => el.scrollTop = 0);
      await page.screenshot({ path: `${out}/${kind}-mobile.jpg` });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await search.fill("NO-RESULT-EXISTS");
      await expect(pager).toContainText(`0 ${kind}`);
      for (const name of ["CSV", "Excel", "PDF / Print"]) await expect(header.getByRole("button", { name, exact: true })).toBeDisabled();
      await search.fill("");
      await header.getByRole("button", { name: `Filter ${kind}`, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel(label, { exact: true }).selectOption(option);
      await dialog.getByRole("button", { name: /^Show / }).click();
      await expect(pager).toContainText(`of ${expected} ${kind}`);
      await header.getByRole("button", { name: `Filter ${kind}`, exact: true }).click();
      await dialog.getByRole("button", { name: "Clear filters", exact: true }).click();
      await dialog.getByRole("button", { name: /^Show / }).click();
      await expect(pager).toContainText(`of 45 ${kind}`);
      for (const format of ["CSV", "Excel"]) {
        const downloading = page.waitForEvent("download");
        await header.getByRole("button", { name: format, exact: true }).click();
        const download = await downloading, path = `${out}/${download.suggestedFilename()}`;
        await download.saveAs(path);
        const book = XLSX.readFile(path, { raw: true });
        const exported = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
        assert.equal(exported.length, 46, "Exports all matches across pages");
        assert.ok(!JSON.stringify(exported).includes(fixture.id), "Readable actor instead of UUID");
      }
      const opened = context.waitForEvent("page");
      await header.getByRole("button", { name: "PDF / Print", exact: true }).click();
      const popup = await opened;
      await popup.waitForLoadState();
      assert.equal(await popup.locator("tbody tr").count(), 45);
      await popup.pdf({ path: `${out}/${kind}.pdf`, format: "A4", landscape: true });
      await popup.close();
      if (kind === "locations") {
        await search.fill("LOC-000");
        await rows.getByRole("button", { name: "Edit", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Location details" })).toBeVisible();
        await expect(page.getByLabel("Code", { exact: true })).toHaveValue("LOC-000");
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
      }
      if (kind === "exceptions") {
        await search.fill("HOLD-000");
        await expect(pager).toContainText("of 1 exceptions");
        await rows.getByRole("button", { name: "Resolve", exact: true }).click();
        const resolution = page.getByRole("dialog", { name: "Resolve shipment hold" });
        await resolution.getByLabel("Resolution reason", { exact: true }).fill("Unsaved inspection");
        await resolution.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(resolution.getByText("Discard inspection edits?", { exact: true })).toBeVisible();
        await resolution.getByRole("button", { name: "Stay", exact: true }).click();
        await expect(resolution.getByLabel("Resolution reason", { exact: true })).toHaveValue("Unsaved inspection");
        await resolution.getByRole("button", { name: "Cancel", exact: true }).click();
        await resolution.getByRole("button", { name: "Discard", exact: true }).click();
      }
      if (kind === "returns") {
        await search.fill("0000000");
        await expect(pager).toContainText("of 1 returns");
        await expect(rows.getByRole("button", { name: "Release to stock", exact: true })).toBeDisabled();
        await expect(rows.getByRole("textbox", { name: "Inspection result" })).toBeVisible();
      }
      if (kind === "activity") {
        await search.fill("PO-2026-000");
        await expect(pager).toContainText("of 1 activity");
        const printOpened = context.waitForEvent("page");
        await rows.getByRole("button", { name: "Print", exact: true }).click();
        const receipt = await printOpened;
        await receipt.waitForLoadState();
        await expect(receipt.getByText(/Order number \/ reference: PO-2026-000/)).toBeVisible();
        await receipt.close();
      }
    }
    assert.deepEqual(await snapshot(), before, "Browsing/filtering/exporting/dialog cancellation do not mutate data");
    // Exercise the existing removed-equipment actions through the new paged workspace.
    await page.getByRole("tab", { name: "Removed Equipment", exact: true }).click();
    const returnSearch = page.getByRole("searchbox", { name: "Search returns", exact: true });
    const returnRows = page.getByTestId("inventory-returns-results");
    await returnSearch.fill("0000001");
    const accepted = page.waitForResponse(r => r.url().endsWith(`${endpoint}/commands`) && r.request().postDataJSON()?.action === "returnAccept");
    await returnRows.getByRole("button", { name: "Accept into quarantine", exact: true }).click();
    assert.equal((await accepted).status(), 200);
    await expect.poll(async () => (await snapshot()).returns.find(r => r.id === "ops-return-1").status).toBe("quarantine");
    await returnSearch.fill("0000000");
    await returnRows.getByRole("combobox").click();
    await page.getByRole("option", { name: "000001 · Operations meter", exact: true }).click();
    await returnRows.getByRole("textbox", { name: "Inspection result" }).fill("Inspected and verified");
    const released = page.waitForResponse(r => r.url().endsWith(`${endpoint}/commands`) && r.request().postDataJSON()?.action === "returnRelease");
    await returnRows.getByRole("button", { name: "Release to stock", exact: true }).click();
    assert.equal((await released).status(), 200);
    await expect.poll(async () => (await snapshot()).returns.find(r => r.id === "ops-return-0").status).toBe("released");
    assert.ok((await snapshot()).stock.some(s => s.serials.includes("0000000")), "Release actually adds inspected serial to stock");
    // Verify all four workspaces remain viewable without granting write permissions.
    assert.equal((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, { data: {
      permissions: ["projects.view", "workOrders.view", "inventory.view"],
    } })).status(), 200);
    const viewer = await browser.newContext({ baseURL });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const view = await viewer.newPage();
    await view.goto(`/projects/${fixture.projectId}/inventory`);
    for (const tab of ["Locations", "Shipment exceptions", "Removed Equipment", "Activity"]) {
      await view.getByRole("tab", { name: tab, exact: true }).click();
      for (const name of ["Edit", "Resolve", "Accept into quarantine", "Release to stock"]) {
        assert.equal(await view.getByRole("button", { name, exact: true }).count(), 0);
      }
    }
    assert.deepEqual(errors, []);
    await viewer.close(); await context.close();
    console.log("All four operations workspaces passed desktop/phone adaptive paging, fixed controls, scoped filters/search, CSV/Excel/PDF, existing dialogs/print, unsaved protection, read-only permission gates and immutable browsing.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
