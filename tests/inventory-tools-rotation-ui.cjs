// Exercise the real shared Inventory tools component against the built app CSS.
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
      const tab = new URL(location.href).searchParams.get("tab");
      createRoot(document.getElementById("root")).render(
        <section data-testid={"inventory-" + tab + "-subheader"}>
          <div><h2>Inventory records</h2></div>
          <InventoryMobileTools tab={tab}>
            <label>Search inventory<input aria-label="Search inventory" /></label>
            <button type="button">Filters</button>
          </InventoryMobileTools>
        </section>
      );
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
    const tabs = ["stock", "locations", "items", "categories", "vendors", "orders", "shipments", "counts", "returns", "activity"];
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
      page.on("pageerror", error => errors.push(error.message));
      for (const tab of tabs) {
        await page.setViewportSize(device.portrait);
        await page.goto(`http://127.0.0.1:${server.address().port}/?tab=${tab}`);
        const toggle = page.getByTestId(`inventory-mobile-tools-${tab}-toggle`);
        const tools = page.getByTestId(`inventory-mobile-tools-${tab}`);
        const input = page.getByRole("textbox", { name: "Search inventory" });
        await expect(toggle).toBeVisible();
        if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
        await input.fill("Keep my search");
        await toggle.click();
        await expect(tools).toBeHidden();
        await page.setViewportSize(device.landscape);
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
      console.log(`PASS ${device.name}: all shared Inventory toolbar contexts keep the toggle, collapse state and search through rotation`);
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
