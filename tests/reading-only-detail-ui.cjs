const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs");
const assert = require("node:assert/strict");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned workspace sandbox required.");
  const fixture = JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")() });
  const root = `/api/projects/${fixture.projectId}`;
  const api = async (method, url, data) => {
    const response = await context.request.fetch(url, { method, data });
    assert.ok(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  try {
    await api("POST", "/api/auth/local/login", fixture);
    await api("PATCH", root, { inventoryEnabled: false, wizardMode: "reading_only", changeoutEquipmentType: "both" });
    const service = (await api("GET", "/api/service-types"))[0];
    const order = await api("POST", `${root}/work-orders`, {
      customerWoId: "READING-TERMINOLOGY", customerName: "Reading terminology fixture", serviceType: service.code,
      status: "Completed", assignedUserId: fixture.viewer.id,
      oldSystemId: "READ-EXISTING-SYSTEM", newSystemId: "READ-CAPTURED-SYSTEM",
      oldModuleId: "READ-EXISTING-MODULE", newModuleId: "READ-CAPTURED-MODULE",
      oldSystemReading: "10", newSystemReading: "20", oldModuleReading: "30", newModuleReading: "40",
    });
    const before = await api("GET", `${root}/work-orders/${order.id}`);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const mode of ["reading_only", "changeout"]) {
      await api("PATCH", root, { wizardMode: mode });
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/projects/${fixture.projectId}/work-orders?edit=${order.id}`);
        const section = page.getByTestId("accordion-system");
        await section.waitFor();
        if (await section.getAttribute("aria-expanded") === "false") await section.click();
        const reading = mode === "reading_only";
        await expect(page.getByRole("heading", { name: reading ? "Existing System" : "Old System", exact: true }).filter({ visible: true })).toHaveCount(1);
        await expect(page.getByRole("heading", { name: reading ? "Captured System" : "New System", exact: true }).filter({ visible: true })).toHaveCount(1);
        await expect(page.getByTestId("defective-replacement-panel")).toBeVisible();
        await expect(page.getByText("Defective equipment replacement", { exact: true })).toHaveCount(reading ? 0 : 1);
        await expect(page.getByText("Replacement history", { exact: true })).toHaveCount(reading ? 0 : 1);
        if (reading) {
          await expect(page.getByText("Read history", { exact: true })).toHaveCount(2);
          await expect(page.getByTestId("defective-replacement-panel")).not.toContainText("Removed:");
          await expect(page.getByTestId("defective-replacement-panel")).not.toContainText("Installed:");
          await expect(page.getByTestId("defective-replacement-panel")).not.toContainText("Reading-only projects cannot replace equipment.");
          await expect(page.getByTestId("button-print-replacement-history")).toBeVisible();
        }
        const receipt = await context.request.get(`${root}/work-orders/${order.id}/replacement/receipt`);
        assert.equal(receipt.status(), 200);
        const html = await receipt.text();
        assert.ok(html.includes(reading ? "<h1>Read history</h1>" : "<h1>Replacement installation history</h1>"));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        fs.mkdirSync("generated-artifacts/reading-only-detail", { recursive: true });
        await page.screenshot({ path: `generated-artifacts/reading-only-detail/${mode}-${width}.jpg` });
      }
    }
    const after = await api("GET", `${root}/work-orders/${order.id}`);
    for (const key of ["oldSystemId", "newSystemId", "oldModuleId", "newModuleId", "oldSystemReading", "newSystemReading"])
      assert.equal(after[key], before[key], `${key} must remain unchanged`);
    assert.deepEqual(errors, []);
    console.log("PASS: Visible reading-only history panel and matching print terminology; changeout parity, desktop/phone, preserved equipment data.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
