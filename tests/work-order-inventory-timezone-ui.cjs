const assert = require("node:assert/strict");
const { build } = require("esbuild");
const { chromium, expect } = require("@playwright/test");

// Render the real components in an isolated browser fixture: no app database,
// authentication bypass, or inventory writes are needed for display-only tests.
(async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
        import { WorkOrderPlanEditor } from "./client/src/components/inventory/work-order-plan-editor";
        import { WorkOrderStagingPanel } from "./client/src/components/inventory/work-order-staging-panel";
        const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
        queryClient.setQueryData(["/api/auth/user"], null);
        const timestamps = ["2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z"];
        const plans = timestamps.map((updatedAt, i) => ({
          workOrderId: i + 1, revision: 0, updatedAt, lines: [],
        }));
        const receipts = timestamps.map((occurredAt, i) => ({
          id: "receipt-" + i, reason: "Timezone test", occurredAt,
          warehouseId: "warehouse", lines: [], actor: "Fixture operator",
        }));
        const original = JSON.stringify({ plans, receipts });
        window.evidenceUnchanged = () => JSON.stringify({ plans, receipts }) === original;
        createRoot(document.getElementById("root")).render(
          <QueryClientProvider client={queryClient}>
            {plans.map((plan, i) => <div key={i} data-testid={"plan-" + i}>
              <WorkOrderPlanEditor projectId={1} workOrderId={plan.workOrderId}
                items={[]} plan={plan} canPlan={false} timezone="America/New_York" />
            </div>)}
            <WorkOrderStagingPanel projectId={1} workOrderId={1} items={[]}
              warehouses={[]} allocation={[]} allocationRevision={0}
              receipts={receipts} timezone="America/New_York" canStage={false} />
          </QueryClientProvider>
        );
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
  });
  const browser = await chromium.launch({
    executablePath: "/repl/tools/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    for (const timezoneId of ["Asia/Tokyo", "Pacific/Honolulu"]) {
      const context = await browser.newContext({ timezoneId });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("http://inventory.test/", route => route.fulfill({
        contentType: "text/html", body: '<!doctype html><div id="root"></div>',
      }));
      await page.goto("http://inventory.test/");
      assert.equal(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone), timezoneId);
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      for (const [i, zone] of ["EDT", "EST"].entries()) {
        const expected = `Nov 1, 2026, 1:30:00 AM ${zone}`;
        await expect(page.getByTestId(`plan-${i}`).getByText(`Updated ${expected}`, { exact: true })).toBeVisible();
        await expect(page.getByText(`${expected} · Fixture operator`, { exact: true })).toBeVisible();
      }
      assert.equal(await page.evaluate(() => window.evidenceUnchanged()), true,
        "Formatting must preserve the original UTC plan and receipt evidence");
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("PASS: plan updates and staging receipts show EDT/EST for both repeated hours, independent of browser timezone; evidence unchanged.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
