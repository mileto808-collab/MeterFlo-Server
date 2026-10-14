/**
 * Built-app input acceptance fixture. All API traffic is intercepted with synthetic
 * data; no real accounts, credentials, work orders or backend writes are used.
 */
import assert from "node:assert/strict";
import express from "express";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium, expect, type Locator } from "@playwright/test";

const app = express();
app.use(express.static(resolve("dist/public")));
app.get("*", (_req,res) => res.sendFile(resolve("dist/public/index.html")));
const server = app.listen(0,"127.0.0.1");
await new Promise<void>(resolve => server.once("listening",resolve));
const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
const browser = await chromium.launch({executablePath:process.argv[2] || undefined,args:["--no-sandbox"]});
await mkdir("generated-artifacts/reading-precision",{recursive:true});

async function checkInput(input: Locator,limit: number) {
  const valid = limit ? `00123.${"4".repeat(limit)}` : "00123";
  await input.fill(valid);
  await expect(input).toHaveValue(valid);
  await input.press("End");
  await input.pressSequentially(limit ? "9" : ".9");
  await expect(input).toHaveValue(limit ? valid : `${valid}9`);
  await input.fill(valid);
  // A paste-like single replacement must be rejected in full, not trimmed.
  await input.fill(`999.${"8".repeat(limit+1)}`);
  await expect(input).toHaveValue(valid);
  await input.fill(valid.replace(".",","));
  await expect(input).toHaveValue(valid);
  await input.press("Backspace");
  await expect(input).toHaveValue(valid.slice(0,-1));
  await input.fill("");
  await expect(input).toHaveValue("");
  await input.fill(valid);
}

try {
  for (const [mode,systemLimit,moduleLimit] of [
    ["reading_only",4,2],["reading_only",0,6],["changeout",6,0],["changeout",3,4],
  ] as const) {
    const context = await browser.newContext({viewport:{width:402,height:874}});
    const page = await context.newPage();
    const project = {id:3,name:"Precision fixture",isActive:true,wizardMode:mode,
      changeoutEquipmentType:"both",readingEquipmentType:"both",
      systemReadingDecimalPlaces:systemLimit,moduleReadingDecimalPlaces:moduleLimit,
      wizardGpsMode:"disabled",wizardShowBeforePhotosStep:false,wizardShowAfterPhotosStep:false,
      wizardShowSignatureStep:false,wizardShowNotesStep:false};
    const order = {id:1,customerWoId:"FIXTURE",customerName:"Input fixture",address:"Fixture address",
      status:"Open",serviceType:"Electric",oldSystemId:"OLD-S",oldModuleId:"OLD-M",
      oldSystemReading:null,oldModuleRead:null,attachments:null,notes:null};
    await page.route("**/api/**",async route => {
      const path = new URL(route.request().url()).pathname;
      assert.ok(route.request().method()==="GET" || path.includes("time-tracking") || path.endsWith("/claim"),
        `this fixture must never submit a work order: ${route.request().method()} ${path}`);
      let data: unknown = [];
      if (path === "/api/auth/user") data = {id:"precision-ui-fixture",role:"admin",subroleKey:"administrator",username:"fixture"};
      else if (path === "/api/projects") data = [project];
      else if (path === "/api/projects/3") data = project;
      else if (path === "/api/projects/3/work-orders") data = [order];
      else if (path.endsWith("/claim")) data = {success:true};
      else if (path.endsWith("/stats")) data = {statusCounts:{Open:1},total:1};
      else if (path === "/api/work-order-statuses") data = [{id:1,name:"Open",color:"#009966"}];
      else if (path.includes("time-tracking")) data = {};
      else if (path.includes("timezone")) data = {timezone:"UTC"};
      await route.fulfill({json:data});
    });
    await page.goto(`${base}/projects/3/work-orders?edit=1`);
    await page.getByTestId("header-button-start-system-changeout").click();
    await page.getByTestId("button-system-can-change").click();
    const prefix = mode === "reading_only" ? "new" : "old";
    await checkInput(page.getByTestId(`input-${prefix}-system-reading`),systemLimit);
    await checkInput(page.getByTestId(`input-${prefix}-module-reading`),moduleLimit);
    await expect(page.getByText(/must be a non-negative.*decimal places|must be a non-negative whole number/)).toHaveCount(0);
    await expect(page.getByTestId("button-wizard-next")).toBeEnabled();
    await page.screenshot({path:`generated-artifacts/reading-precision/${mode}-${systemLimit}-${moduleLimit}.jpg`});
    await context.close();
  }
  console.log("Verified all four wizard reading inputs: separate limits, zero/six, typing, paste rejection, comma normalization, backspace and Next without precision errors.");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
