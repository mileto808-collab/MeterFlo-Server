const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const context = await browser.newContext({ baseURL });
  const admin = await browser.newContext({ baseURL });
  const root = `/api/projects/${fixture.projectId}`;
  const request = async (method, url, data) => {
    const response = await admin.request.fetch(url, { method, data });
    assert.ok(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  try {
    await request("POST", "/api/auth/local/login", fixture);
    const role = await request("POST", "/api/subroles", { key: `print_${crypto.randomUUID().slice(0, 8)}`,
      label: "Work order print viewer", baseRole: "user", permissions: ["workOrders.view", "inventory.view"] });
    const credentials = { username: `print-${crypto.randomUUID().slice(0, 8)}`, password: `Aa1!${crypto.randomUUID()}` };
    const user = await request("POST", "/api/users", { ...credentials, firstName: "Print", lastName: "Viewer",
      role: "user", subroleId: role.id, projectIds: [fixture.projectId] });
    const login = await context.request.post("/api/auth/local/login", { data: credentials });
    assert.ok(login.ok());
    const services = await request("GET", "/api/service-types");
    const work = await request("POST", `${root}/work-orders`, { customerWoId: "PRINT-BROWSER",
      customerName: "Print preview customer", serviceType: services[0].code, status: "Open", assignedUserId: user.id,
      notes: '<script>window.__unsafe=true</script> Literal work-order notes.' });
    const page = await context.newPage();
    const downloads = [], errors = [];
    context.on("page", child => child.on("download", file => downloads.push(file.suggestedFilename())));
    page.on("download", file => downloads.push(file.suggestedFilename()));
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/work-orders`);
    await page.getByRole("cell", { name: "PRINT-BROWSER", exact: true }).click();
    const printButton = page.getByRole("button", { name: "Print PDF", exact: true });
    await expect(printButton).toBeVisible();
    const opening = page.waitForEvent("popup");
    await printButton.click();
    const preview = await opening;
    const nativePrint = preview.getByRole("button", { name: "Print / Save PDF", exact: true });
    await expect(nativePrint).toBeVisible();
    await expect(preview.locator("#pdf-content")).toContainText("Print preview customer");
    await expect(preview.locator("#pdf-content")).toContainText("<script>window.__unsafe=true</script>");
    assert.equal(await preview.evaluate(() => window.__unsafe), undefined);
    assert.equal(await preview.evaluate(() => window.opener), null);
    await expect(preview).toHaveTitle("WorkOrder_PRINT-BROWSER");
    assert.deepEqual(downloads, [], "Opening the report must not download a PDF.");
    await preview.evaluate(() => { window.__printCalls = 0; window.print = () => window.__printCalls++; });
    await nativePrint.click();
    assert.equal(await preview.evaluate(() => window.__printCalls), 1);
    await fs.mkdir("generated-artifacts/work-order-print", { recursive: true });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await preview.setViewportSize(viewport);
      assert.ok(await preview.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await preview.screenshot({ path: `generated-artifacts/work-order-print/preview-${viewport.width}.png` });
    }
    await preview.emulateMedia({ media: "print" });
    await expect(nativePrint).toBeHidden();
    const pdf = "generated-artifacts/work-order-print/native-preview.pdf";
    await preview.pdf({ path: pdf, preferCSSPageSize: true });
    const pdfText = execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" });
    assert.match(pdfText, /PRINT-BROWSER/);
    assert.match(pdfText, /Print preview customer/);
    assert.doesNotMatch(pdfText, /Print \/ Save PDF/);
    await preview.close();

    const image = await page.screenshot();
    const upload = await admin.request.post(`${root}/work-orders/${work.id}/files`,
      { multipart: { file: { name: "preview-photo.png", mimeType: "image/png", buffer: image } } });
    assert.ok(upload.ok(), await upload.text());
    await page.reload();
    await page.getByRole("button", { name: "Print PDF", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const photoOpening = page.waitForEvent("popup");
    await page.getByTestId("button-generate-pdf").click();
    const photoPreview = await photoOpening;
    await expect(photoPreview.getByRole("button", { name: "Print / Save PDF" })).toBeVisible();
    await expect(photoPreview.locator("#pdf-content img").first()).toBeVisible();
    await expect.poll(() => photoPreview.locator("#pdf-content img").first().evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
    await photoPreview.close();
    assert.deepEqual(downloads, []);
    assert.deepEqual(errors, []);
    console.log("PASS authenticated browser print preview, no automatic download, native print button, safe text, printable selectable PDF, portrait layout and photo-options preview.");
  } finally { await context.close(); await admin.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
