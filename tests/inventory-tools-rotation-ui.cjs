// Exercise the real Inventory navigation/tools and Work Orders SSE indicator
// against the built app CSS, including their actual connection-state hook.
// This test never connects to an application database or authenticated service.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium, expect } = require("@playwright/test");

(async () => {
  const dist = path.resolve(process.argv[2] || "");
  if (!process.argv[2] || !fs.existsSync(path.join(dist, "assets"))) throw Error("Pass an isolated Vite build directory");
  const css = fs.readdirSync(path.join(dist, "assets")).filter(name => name.endsWith(".css"));
  assert.ok(css.length, "Use the real built application styles");
  const compiled = await build({
    stdin: { resolveDir: process.cwd(), loader: "jsx", contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { InventoryMobileTools } from "./client/src/components/inventory-mobile-tools";
      import { InventoryMobileMenu, InventoryDesktopTabs } from "./client/src/components/inventory-navigation";
      import { WorkOrderToolsToggle } from "./client/src/components/work-order-tools-toggle";
      import { Tabs } from "./client/src/components/ui/tabs";
      import { useProjectEvents } from "./client/src/hooks/useProjectEvents";
      import { queryClient } from "./client/src/lib/queryClient";
      window.eventSources = [];
      window.workOrderUpdates = [];
      window.EventSource = class {
        constructor(url, options) { this.url = url; this.options = options; window.eventSources.push(this); }
        close() { this.closed = true; }
      };
      queryClient.setQueryData(["/api/projects/3/work-orders"], []);
      window.workOrderQueryInvalidated = () => queryClient.getQueryState(["/api/projects/3/work-orders"]).isInvalidated;
      const onWorkOrderUpdated = id => window.workOrderUpdates.push(id);
      const tab = new URL(location.href).searchParams.get("tab");
      function Harness() {
        const [value, setValue] = React.useState(tab);
        const [open, setOpen] = React.useState(false);
        const events = useProjectEvents(3, { onWorkOrderUpdated });
        return <main className="space-y-4 p-4">
        <WorkOrderToolsToggle open={open} onToggle={() => setOpen(value => !value)} status={events.status} />
        <Tabs value={value} onValueChange={setValue}>
          <header className="inventory-sticky-header relative space-y-2">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <InventoryMobileMenu value={value} onValueChange={setValue} canManageCategories={true} />
              <div className="inventory-desktop-heading hidden md:block">Inventory</div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <span data-testid="fixture-inventory-live" className="rounded border px-2">Live</span>
                <button data-testid="button-toggle-inventory-stats" className="h-9 rounded border px-2"><svg width="16" height="16" /><span>Show Stats</span></button>
              </div>
            </div>
            <InventoryDesktopTabs />
          </header>
          <output data-testid="selected-inventory-section">{value}</output>
        <section data-testid={"inventory-" + tab + "-subheader"}>
          <div><h2>Inventory records</h2></div>
          <InventoryMobileTools tab={tab}>
            <label>Search inventory<input aria-label="Search inventory" /></label>
            <button type="button">Filters</button>
          </InventoryMobileTools>
        </section>
        </Tabs></main>;
      }
      createRoot(document.getElementById("root")).render(<Harness />);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    tsconfig: path.resolve("tsconfig.json"),
  });
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${css.map(name => `<link rel="stylesheet" href="/assets/${name}">`).join("")}</head><body><div id="root"></div><script>${compiled.outputFiles[0].text}</script></body></html>`;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fixture");
    const name = path.basename(url.pathname);
    if (url.pathname.startsWith("/assets/") && css.includes(name)) {
      res.setHeader("Content-Type", "text/css");
      return res.end(fs.readFileSync(path.join(dist, "assets", name)));
    }
    res.setHeader("Content-Type", "text/html"); res.end(html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const tabs = ["stock", "locations", "items", "categories", "vendors", "orders", "exceptions", "counts", "returns", "activity"];
    const devices = [
      { name: "phone", hasTouch: true, portrait: { width: 393, height: 850 }, landscape: { width: 850, height: 393 } },
      { name: "large-phone", hasTouch: true, portrait: { width: 440, height: 980 }, landscape: { width: 980, height: 440 } },
      { name: "tablet", hasTouch: true, portrait: { width: 768, height: 1024 }, landscape: { width: 1024, height: 768 } },
      { name: "large-tablet", hasTouch: true, portrait: { width: 834, height: 1194 }, landscape: { width: 1194, height: 834 } },
      { name: "desktop", hasTouch: false, portrait: { width: 1280, height: 900 }, landscape: { width: 1440, height: 900 } },
    ];
    for (const device of devices) {
      const context = await browser.newContext({ viewport: device.portrait, hasTouch: device.hasTouch });
      const page = await context.newPage(), errors = [];
      await page.clock.install();
      page.on("pageerror", error => errors.push(error.message));
      for (const tab of tabs) {
        await page.setViewportSize(device.portrait);
        await page.goto(`http://127.0.0.1:${server.address().port}/?tab=${tab}`);
        const live = page.getByTestId("work-orders-live-indicator");
        await expect(live).toHaveAttribute("data-status", "connecting");
        await expect.poll(() => page.evaluate(() => window.eventSources.length)).toBe(1);
        if (tab === "stock") {
          assert.equal(await page.evaluate(() => window.eventSources[0].url), "/api/projects/3/events");
          assert.equal(await page.evaluate(() => window.eventSources[0].options.withCredentials), true);
          await page.evaluate(() => window.eventSources[0].onopen());
          await expect(live).toHaveAttribute("data-status", "live");
          await page.evaluate(() => window.eventSources[0].onmessage({ data: JSON.stringify({
            type: "workorder_updated", projectId: 3, workOrderId: 12,
          }) }));
          await expect.poll(() => page.evaluate(() => window.workOrderUpdates)).toEqual([12]);
          assert.equal(await page.evaluate(() => window.workOrderQueryInvalidated()), true);
          await page.evaluate(() => window.eventSources[0].onerror({ type: "error" }));
          await expect(live).toHaveAttribute("data-status", "reconnecting");
          assert.equal(await page.evaluate(() => window.eventSources[0].closed), true);
          await page.evaluate(() => window.eventSources[0].onopen());
          await expect(live).toHaveAttribute("data-status", "reconnecting");
          await page.clock.fastForward(5000);
          await expect.poll(() => page.evaluate(() => window.eventSources.length)).toBe(2);
          await page.evaluate(() => window.eventSources[1].onopen());
          await expect(live).toHaveAttribute("data-status", "live");
        }
        const sourceCount = await page.evaluate(() => window.eventSources.length);
        const workOrderToggle = page.getByTestId("button-toggle-mobile-tools");
        await workOrderToggle.click();
        await expect(workOrderToggle).toHaveAttribute("aria-expanded", "true");
        await workOrderToggle.click();
        const toggle = page.getByTestId(`inventory-mobile-tools-${tab}-toggle`);
        const tools = page.getByTestId(`inventory-mobile-tools-${tab}`);
        const input = page.getByRole("textbox", { name: "Search inventory" });
        await expect(toggle).toBeVisible();
        if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
        await input.fill("Keep my search");
        await toggle.click();
        await expect(tools).toBeHidden();
        await page.setViewportSize(device.landscape);
        const menu = page.getByTestId("inventory-mobile-menu");
        const desktopTabs = page.locator(".inventory-desktop-tabs");
        if (device.hasTouch) {
          await expect(menu).toBeVisible();
          await expect(desktopTabs).toBeHidden();
          await menu.click();
          await page.getByTestId("inventory-mobile-menu-item-activity").click();
          await expect(page.getByTestId("selected-inventory-section")).toHaveText("activity");
          await expect(menu).toHaveAccessibleName("Inventory sections, current: Activity");
          const menuBounds = await menu.boundingBox();
          const liveBounds = await page.getByTestId("fixture-inventory-live").boundingBox();
          assert.ok(menuBounds.x + menuBounds.width <= liveBounds.x, "Inventory menu must not overlap live/stats controls");
        } else {
          await expect(menu).toBeHidden();
          await expect(desktopTabs).toBeVisible();
          await page.getByRole("tab", { name: "Activity", exact: true }).click();
          await expect(page.getByTestId("selected-inventory-section")).toHaveText("activity");
        }
        const toolsBounds = await workOrderToggle.boundingBox(), badgeBounds = await live.boundingBox();
        assert.ok(badgeBounds.x >= toolsBounds.x + toolsBounds.width, "Work Orders Live stays to the right of Search & Tools");
        assert.ok(badgeBounds.x + badgeBounds.width <= device.landscape.width, "Live stays within the viewport");
        assert.ok(Math.abs(badgeBounds.y + badgeBounds.height / 2 - toolsBounds.y - toolsBounds.height / 2) < 2, "Live shares the toggle row");
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAccessibleName("Show Search & Tools");
        assert.ok(await toggle.locator(":scope > span").first().evaluate(element =>
          parseFloat(getComputedStyle(element).fontSize) > 0), "Landscape must keep the Search & Tools text visible, not just its icon");
        await expect(tools).toBeHidden();
        await toggle.click();
        await expect(tools).toBeVisible();
        await expect(input).toHaveValue("Keep my search");
        await expect(toggle).toHaveAccessibleName("Hide Search & Tools");
        await page.setViewportSize(device.portrait);
        if (device.hasTouch) {
          await expect(menu).toBeVisible();
          await expect(desktopTabs).toBeHidden();
          await expect(menu).toHaveAccessibleName("Inventory sections, current: Activity");
        }
        const portraitTools = await workOrderToggle.boundingBox(), portraitLive = await live.boundingBox();
        assert.ok(portraitLive.x >= portraitTools.x + portraitTools.width);
        assert.ok(portraitLive.x + portraitLive.width <= device.portrait.width);
        assert.equal(await page.evaluate(() => window.eventSources.length), sourceCount, "Rotation/navigation must not create duplicate SSE subscriptions");
        await expect(toggle).toBeVisible();
        await expect(tools).toBeVisible();
        await expect(input).toHaveValue("Keep my search");
        await toggle.click();
        await expect(tools).toBeHidden();
        if (tab === "stock") {
          fs.mkdirSync("generated-artifacts/inventory-tools-rotation", { recursive: true });
          await page.setViewportSize(device.landscape);
          await page.screenshot({ path: `generated-artifacts/inventory-tools-rotation/${device.name}-landscape.png` });
        }
      }
      assert.deepEqual(errors, []);
      console.log(`PASS ${device.name}: compact touch navigation, preserved tools/search, and correctly placed live/SSE connection states through rotation`);
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
