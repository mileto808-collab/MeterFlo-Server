const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned database sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json","utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({executablePath:"/repl/tools/bin/chromium",args:["--no-sandbox"]});
  await fs.mkdir("generated-artifacts/project-copy",{recursive:true});
  try {
    for (const mode of ["desktop","phone"]) {
      const context = await browser.newContext({baseURL,viewport:mode==="desktop"?{width:1280,height:800}:{width:390,height:844},
        hasTouch:mode==="phone",isMobile:mode==="phone"});
      assert.equal((await context.request.post("/api/auth/local/login",{data:fixture})).status(),200);
      const page = await context.newPage(), errors=[];
      page.on("pageerror",error=>errors.push(error.message));
      await page.goto(`/projects/${fixture.projectId}/edit`);
      await page.getByTestId("button-copy-project").click();
      const dialog = page.getByTestId("project-copy-dialog");
      await expect(dialog).toBeVisible();
      await expect(page.getByTestId("checkbox-copy-project-access")).toBeChecked();
      await expect(dialog).toContainText("Unsaved changes on this page are not included.");
      await expect(dialog).toContainText("type links");
      if(mode==="desktop") await page.getByTestId("checkbox-copy-project-access").click();
      await page.screenshot({animations:"disabled",path:`generated-artifacts/project-copy/${mode}-options.jpg`});
      const responsePromise = page.waitForResponse(response=>response.url().endsWith(`/api/projects/${fixture.projectId}/copy`)&&response.request().method()==="POST");
      await page.getByTestId("button-confirm-project-copy").click();
      const response = await responsePromise, copied=await response.json();
      assert.equal(response.status(),201,JSON.stringify(copied));
      assert.equal(copied.copyReport.accessCopied,mode==="phone");
      await expect(page).toHaveURL(new RegExp(`/projects/${copied.id}/edit$`));
      const summary=page.getByTestId("project-copy-summary");
      await expect(summary).toBeVisible();
      await expect(summary).toContainText(mode==="phone"?"location assignments copied.":"Access assignments left empty");
      await expect(summary).toContainText("customer API delivery are off");
      const width=await summary.evaluate(element=>({scroll:element.scrollWidth,client:element.clientWidth}));
      assert.ok(width.scroll<=width.client+1);
      await page.screenshot({animations:"disabled",path:`generated-artifacts/project-copy/${mode}-summary.jpg`});
      await summary.getByRole("button",{name:"Done",exact:true}).click();
      await expect(summary).toBeHidden();
      assert.deepEqual(errors,[]);
      await context.close();
    }
    console.log("PASS desktop/phone project copy options, selectable access, real copies, summary, navigation, no clipped dialog or runtime errors.");
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
