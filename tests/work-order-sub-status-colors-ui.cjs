// Uses the disposable inventory UI fixture; never changes customer records.
const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs");
const assert = require("node:assert/strict");

(async () => {
  const fixture = JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
  const root = `/api/projects/${fixture.projectId}`;
  const request = async (method, path, data, expected = 200) => {
    const response = await context.request.fetch(path, { method, data });
    assert.equal(response.status(), expected, `${method} ${path}: ${await response.text()}`);
    return response.status() === 204 ? null : response.json();
  };
  let definition, order;
  try {
    await request("POST", "/api/auth/local/login", fixture);
    await request("PATCH", root, { inventoryEnabled: false });
    const parent = (await request("GET", "/api/work-order-statuses")).find(s => s.code === "Scheduled");
    const service = (await request("GET", "/api/service-types"))[0];
    definition = await request("POST", `${root}/work-order-sub-statuses`, {
      code: "CRITICAL-COLOR", label: "Critical", parentStatusId: parent.id, color: "#e11d48",
    }, 201);
    order = await request("POST", `${root}/work-orders`, {
      customerWoId: `COLOR-${Date.now()}`, customerId: "COLOR", customerName: "Color fixture",
      address: "Fixture only", serviceType: service.code, status: "Scheduled", subStatusId: definition.id,
    }, 201);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    fs.mkdirSync("generated-artifacts", { recursive: true });
    const variants = [
      { name: "red", color: "#e11d48", background: "rgb(225, 29, 72)", foreground: "rgb(255, 255, 255)", label: "Critical" },
      { name: "yellow", color: "#fde047", background: "rgb(253, 224, 71)", foreground: "rgb(0, 0, 0)", label: "Critical" },
      { name: "neutral", color: null, background: "rgba(0, 0, 0, 0)", label: `Critical ${"extended ".repeat(9)}`.trim() },
    ];
    const checkBadge = async (badge, variant) => {
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(variant.label);
      await expect(badge).toHaveCSS("background-color", variant.background);
      if (variant.foreground) await expect(badge).toHaveCSS("color", variant.foreground);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "No page-width overflow");
    };
    for (const variant of variants) {
      await request("PATCH", `${root}/work-order-sub-statuses/${definition.id}`, { color: variant.color, label: variant.label });
      for (const [size, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
        await page.setViewportSize(viewport);
        for (const theme of [size === "phone" ? "dark" : "light"]) {
          await page.goto(`/projects/${fixture.projectId}/work-orders?edit=${order.id}`);
          const header = page.locator('[data-testid="work-order-sub-status-badge"]:visible').first();
          await expect(header).toBeVisible();
          await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), theme === "dark");
          await checkBadge(header, variant);
          const parentBadge = header.locator("..").locator(":scope > :first-child");
          await expect(parentBadge).toHaveText("Scheduled");
          if (variant.color) await expect(parentBadge).not.toHaveCSS("color", variant.background);
          await page.getByTestId("accordion-scheduling").click();
          await checkBadge(page.getByTestId(`${size === "phone" ? "mobile" : "desktop"}-readonly-sub-status`).getByTitle(variant.label, { exact: true }), variant);
          if (variant.name === "red") await page.screenshot({ path: `generated-artifacts/sub-status-colors-detail-${size}.jpg` });
          // Use the app's Back control: bare navigation can restore a remembered detail.
          await page.getByTestId("header-button-back-to-work-orders").click();
          const list = page.locator('[data-testid="work-order-list-sub-status-badge"]:visible').first();
          await expect(list).toBeVisible();
          await page.evaluate(dark => document.documentElement.classList.toggle("dark", dark), theme === "dark");
          await checkBadge(list, variant);
          await list.scrollIntoViewIfNeeded();
          if (variant.name === "red") await page.screenshot({ path: `generated-artifacts/sub-status-colors-list-${size}.jpg` });
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log("PASS: configured red/yellow colors, readable foregrounds, neutral fallback, long labels, separate parent color, desktop/phone, light/dark, list/header/read-only details.");
  } finally {
    if (order) await context.request.delete(`${root}/work-orders/${order.id}`);
    if (definition) await context.request.delete(`${root}/work-order-sub-statuses/${definition.id}`);
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
