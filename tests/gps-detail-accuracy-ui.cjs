const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs");
const assert = require("node:assert/strict");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Use the owned project-workspace sandbox.");
  const fixture = JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json","utf8"));
  const browser = await chromium.launch({executablePath:"/repl/tools/bin/chromium",args:["--no-sandbox"]});
  const context = await browser.newContext({baseURL:require("./support/workspace-ui-base.cjs")()});
  const root = `/api/projects/${fixture.projectId}`;
  const json = async (method,path,data) => {
    const response = await context.request.fetch(path,{method,data});
    assert.ok(response.ok(),`${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const errors = [];
  try {
    await json("POST","/api/auth/local/login",fixture);
    const service = (await json("GET","/api/service-types"))[0];
    const coordinates = "41.432,-81.731";
    const orders = [];
    for (const source of ["native","browser",null]) {
      const workOrder = await json("POST",`${root}/work-orders`,{
        customerWoId:`GPS-${source ?? "legacy"}-${Date.now()}`, customerName:"GPS accuracy fixture",
        serviceType:service.code, status:"Open", oldSystemId:`GPS-FIXTURE-${source ?? "legacy"}`, oldSystemReading:"1",
        newGps:coordinates, assignedUserId:fixture.viewer.id,
        ...(source ? {gpsCapture:{coordinates,source,accuracy:2.5,receiver:source==="native"?"external":"unknown",capturedAt:new Date().toISOString()}} : {}),
      });
      const saved = await json("GET",`${root}/work-orders/${workOrder.id}`);
      assert.equal(saved.gpsCapture?.accuracy ?? null,source?2.5:null);
      orders.push({id:workOrder.id,source});
    }
    const page = await context.newPage();
    page.on("pageerror",error => errors.push(error.message));
    for (const size of [{width:1280,height:900},{width:390,height:844},{width:844,height:390}]) {
      await page.setViewportSize(size);
      for (const order of orders) {
        await page.goto(`/projects/${fixture.projectId}/work-orders?edit=${order.id}`);
        const section = page.getByTestId("accordion-system");
        await page.locator('[data-testid="accordion-system"]:visible,[data-testid="desktop-new-gps-link"]:visible').first().waitFor();
        if (await section.isVisible() && await section.getAttribute("aria-expanded")==="false") await section.click();
        await expect(page.locator('[data-testid$="-new-gps-link"]:visible')).toHaveText(coordinates);
        const accuracy = page.locator('[data-testid$="-new-gps-accuracy"]:visible');
        if (order.source) await expect(accuracy).toHaveText("Accuracy: ±2.5 m");
        else await expect(accuracy).toHaveCount(0);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth+1));
        if (order.source==="native") {
          await accuracy.scrollIntoViewIfNeeded();
          fs.mkdirSync("generated-artifacts/gps-detail-accuracy",{recursive:true});
          await page.screenshot({path:`generated-artifacts/gps-detail-accuracy/${size.width}.png`});
        }
      }
    }
    assert.deepEqual(errors,[]);
    console.log("PASS GPS accuracy: native/browser captures and legacy coordinates, desktop/phone/landscape.");
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode=1;});
