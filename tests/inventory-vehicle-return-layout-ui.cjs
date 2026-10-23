const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  execFileSync(process.execPath, ["--import", "tsx", "tests/support/vehicle-return-ui-fixture.ts"], { stdio: "inherit" });
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const admin = await browser.newContext({ baseURL });
  const prefix = `/api/projects/${fixture.projectId}/inventory/vehicle-return-workflows`;
  const api = async (url, data) => {
    const response = await admin.request.post(url, { data });
    assert.ok(response.ok(), `${url}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const kinds = { equipment: ["return-equipment", "Equipment return"], count: ["vehicle-count", "Vehicle count"],
    stock: ["return-stock", "Stock return"] };
  try {
    await api("/api/auth/local/login", fixture);
    for (let i = 0; i < 12; i++) await api(`/api/projects/${fixture.projectId}/inventory/commands`, {
      operationId: randomUUID(), action: "item", data: { id: `layout-part-${i}`, sku: `LAYOUT-${i}`,
        name: `Layout test part ${i}`, tracking: "regular" },
    });
    for (const kind of Object.keys(kinds)) await api(`${prefix}/drafts/${randomUUID()}`, {
      revision: 0, saveId: randomUUID(), capture: { kind, sourceId: "return-van",
        destinationId: kind === "count" ? "" : "return-staging", itemIds: kind === "equipment" ? [] : ["return-meter"],
        returnIds: kind === "equipment" ? ["return-old"] : [], quantities: kind === "equipment" ? {} : { "return-meter": "1" },
        scans: kind === "equipment" ? { system: "REMOVED-001\n" } : { "return-meter": "RETURN-A\n" },
        reason: "Layout test physical verification" },
    });
    await fs.mkdir("generated-artifacts/vehicle-return-layout", { recursive: true });
    for (const size of [
      { name: "desktop", width: 1024, height: 544, touch: false },
      { name: "phone", width: 390, height: 844, touch: true },
      { name: "landscape", width: 844, height: 390, touch: true },
    ]) {
      const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 },
        hasTouch: size.touch, isMobile: size.touch });
      await context.request.post("/api/auth/local/login", { data: fixture });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      try {
        await page.goto(`/projects/${fixture.projectId}/inventory`);
        await page.getByTestId(`button-start-inventory-${size.touch ? "mobile" : "desktop"}`).click();
        const assertLayout = async () => {
          // The Inventory workspace recalculates its available height after
          // viewport changes; assert the settled layout, not an intermediate frame.
          await expect.poll(async () => {
            const bounds = await page.getByTestId("vehicle-return-footer").boundingBox();
            return !!bounds && bounds.y + bounds.height <= page.viewportSize().height + 1;
          }).toBe(true);
          const layout = await page.getByTestId("vehicle-return-content").evaluate(body => {
            const root = body.parentElement, header = root.querySelector("header"), footer = root.querySelector("footer");
            const bounds = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
            return { body: bounds(body), header: bounds(header), footer: bounds(footer),
              outerScroll: root.scrollTop, height: innerHeight, width: innerWidth,
              contentWidth: body.scrollWidth, bodyWidth: body.clientWidth };
          });
          assert.ok(layout.body.height > 0, JSON.stringify(layout));
          assert.ok(layout.header.bottom <= layout.body.top + 1, JSON.stringify(layout));
          assert.ok(layout.body.bottom <= layout.footer.top + 1, JSON.stringify(layout));
          assert.ok(layout.footer.bottom <= layout.height + 1, JSON.stringify(layout));
          assert.ok(layout.contentWidth <= layout.bodyWidth + 1, JSON.stringify(layout));
          assert.equal(layout.outerScroll, 0);
        };
        for (const [kind, [task, label]] of Object.entries(kinds)) {
          await page.setViewportSize({ width: 1280, height: 720 });
          await page.getByTestId(`inventory-task-${task}`).click();
          const body = page.getByTestId("vehicle-return-content");
          await expect(body.getByText(`${label} — Return vehicle`, { exact: false })).toBeVisible();
          assert.equal((await body.innerText()).includes("return-van"), false, "Never display the raw source location ID as a draft label");
          await body.getByRole("button", { name: "Open draft", exact: true }).click();
          await page.setViewportSize({ width: size.width, height: size.height });
          await assertLayout();
          for (let step = 0; step < 2; step++) {
            await page.getByTestId("vehicle-return-footer").getByRole("button", { name: "Continue", exact: true }).click();
            await expect.poll(() => body.evaluate(el => el.scrollTop)).toBe(0);
            await assertLayout();
            await body.evaluate(el => { el.scrollTop = el.scrollHeight; });
            await assertLayout();
            if (step === 0 && kind !== "equipment")
              await page.screenshot({ path: `generated-artifacts/vehicle-return-layout/${size.name}-${kind}-items.jpg` });
          }
          const reason = body.locator(kind === "equipment" ? "#equipment-return-reason" : "#return-reason");
          await reason.scrollIntoViewIfNeeded();
          const reasonBounds = await reason.boundingBox(), footerBounds = await page.getByTestId("vehicle-return-footer").boundingBox();
          assert.ok(reasonBounds.y + reasonBounds.height <= footerBounds.y + 1, "The last form input must be above, not underneath, the action bar");
          assert.equal(await page.evaluate(() => document.activeElement.matches("input,textarea")), false);
          await page.screenshot({ path: `generated-artifacts/vehicle-return-layout/${size.name}-${kind}-capture.jpg` });
          await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
    console.log("PASS all three return wizards: readable draft names, separate content scrolling, visible header/footer and last fields on desktop and touch portrait/landscape.");
  } finally { await admin.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
