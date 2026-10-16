// Run support/inventory-ui-fixture.ts create first; cleanup that fixture afterward.
// Only test-owned users are created/edited/deleted. No existing accounts are changed.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const {chromium, expect} = require("@playwright/test");
const XLSX = require("xlsx");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json","utf8"));
  const browser = await chromium.launch({executablePath:"/repl/tools/bin/chromium",args:["--no-sandbox"]});
  const context = await browser.newContext({baseURL:`https://${process.env.REPLIT_DEV_DOMAIN}`,
    viewport:{width:1440,height:1000},hasTouch:true,isMobile:true,acceptDownloads:true});
  const prefix = `users-responsive-${crypto.randomUUID().slice(0,8)}`;
  const password = `Fixture-${crypto.randomUUID()}!`;
  const out = "generated-artifacts/users-responsive";
  const ownedProjects = [];
  await fs.mkdir(out,{recursive:true});
  assert.equal((await context.request.post("/api/auth/local/login",{data:fixture})).status(),200);
  try {
    for(let index=0;index<2;index++) {
      const response=await context.request.post("/api/projects",{data:{
        name:`${prefix} project ${index} — ${"Long project name ".repeat(6)}`,
      }});
      assert.ok(response.ok(),"create owned projects for varied assignment counts");
      ownedProjects.push(await response.json());
    }
    assert.ok((await context.request.put(`/api/users/${fixture.id}/column-preferences/users`,{data:{
      visibleColumns:["user","username","email","firstName","lastName","role","subrole","projects","status"],
    }})).ok());
    const seeded = [];
    for(let index=0;index<32;index++) {
      const response = await context.request.post("/api/users",{data:{
        username:`${prefix}-${String(index).padStart(2,"0")}`,password,role:"user",
        firstName:"Responsive",lastName:`Fixture ${String(index).padStart(2,"0")}`,
        projectIds:index===31?[]:[fixture.projectId,...(index<6?ownedProjects.map(project=>project.id):[])],
      }});
      assert.equal(response.status(),201,"test-owned account creation");
      seeded.push(await response.json());
    }
    const page = await context.newPage(), errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto("/users");
    const results=page.getByTestId("users-results"), header=page.getByTestId("users-sticky-header");
    const rows=results.locator("[data-users-row]"), tools=page.getByTestId("users-search-tools-toggle");
    const size=async()=>Number(await results.getAttribute("data-page-size"));
    const fit=async(label)=>{
      await expect(rows.first()).toBeVisible();
      const viewport=page.viewportSize(), box=await results.boundingBox();
      const pager=await page.getByTestId("users-pagination").boundingBox();
      assert.ok(box&&box.height>55,`${label}: records need usable space`);
      assert.ok(pager&&pager.y+pager.height<=viewport.height+2,`${label}: pager fits screen`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${label}: no whole-page horizontal clipping`);
      await expect.poll(async()=>rows.count()).toBe(Math.min(32,await size()));
      const measurements=await results.evaluate(el=>{
        const bodyRows=[...el.querySelectorAll("[data-users-row]")];
        const heights=bodyRows.map(row=>row.getBoundingClientRect().height);
        return {available:el.clientHeight,header:el.querySelector("thead").getBoundingClientRect().height,
          tallest:Math.max(...heights),shortest:Math.min(...heights)};
      });
      assert.ok(measurements.tallest-measurements.shortest<=2,`${label}: project counts must not expand rows`);
      const capacity=Math.max(1,Math.floor((measurements.available-measurements.header)/measurements.tallest));
      await expect.poll(size).toBe(capacity);
      if(await rows.count()<32)assert.ok(
        measurements.available-measurements.header-(await rows.count())*measurements.tallest<measurements.shortest,
        `${label}: unused space must not fit another record`);
    };
    await page.getByTestId("input-search-users").fill(prefix);
    await expect.poll(async()=>rows.count()).toBeGreaterThan(1);
    await fit("desktop");
    const dialog=page.getByTestId("user-projects-dialog");
    await page.getByTestId(`button-view-projects-${seeded[0].id}`).click();
    await expect(dialog.locator('[data-testid^="user-projects-entry-"]')).toHaveCount(3);
    await expect(page.getByTestId("text-edit-user-title")).toHaveCount(0);
    await expect(dialog.getByRole("button",{name:/assign|remove/i})).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.route(`**/api/users/${seeded[1].id}/projects`,route=>route.fulfill({
      status:503,contentType:"application/json",body:JSON.stringify({message:"Synthetic transient fixture error"}),
    }),{times:1});
    await page.getByTestId(`button-view-projects-${seeded[1].id}`).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog).not.toContainText("No assigned projects");
    await page.getByTestId("user-projects-retry").click();
    await expect(dialog.locator('[data-testid^="user-projects-entry-"]')).toHaveCount(3);
    await page.keyboard.press("Escape");
    await page.getByTestId("input-search-users").fill(seeded[31].username);
    await page.getByTestId(`button-view-projects-${seeded[31].id}`).click();
    await expect(dialog).toContainText("No assigned projects");
    await page.keyboard.press("Escape");
    await page.getByTestId("input-search-users").fill(prefix);
    await fit("restored search");
    const firstPage=await rows.evaluateAll(elements=>elements.map(el=>el.dataset.testid));
    await page.getByRole("button",{name:"Next users page",exact:true}).click();
    await expect.poll(async()=>rows.first().getAttribute("data-testid")).not.toBe(firstPage[0]);
    const secondPage=await rows.evaluateAll(elements=>elements.map(el=>el.dataset.testid));
    assert.equal(secondPage.some(id=>firstPage.includes(id)),false,"pages must not repeat users");
    for(const [button,extension] of [["button-export-csv","csv"],["button-export-excel","xlsx"]]) {
      const [download]=await Promise.all([page.waitForEvent("download"),page.getByTestId(button).click()]);
      const file=`${out}/matching-users.${extension}`; await download.saveAs(file);
      const workbook=XLSX.read(await fs.readFile(file),{type:"buffer"});
      const exported=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1});
      assert.equal(exported.length-1,32,`${extension}: export every matching user, not only this page`);
    }
    const [print]=await Promise.all([page.waitForEvent("popup"),page.getByTestId("button-export-pdf").click()]);
    await expect(print.locator("tbody tr")).toHaveCount(32);
    await print.close();
    await page.getByTestId("sort-email").click();
    await expect(page.getByRole("button",{name:"Previous users page",exact:true})).toBeDisabled();
    await page.getByTestId("sort-name").click();
    await fit("sorted desktop");
    await page.screenshot({path:`${out}/desktop.jpg`});
    for(const viewport of [{width:390,height:844},{width:844,height:390},{width:390,height:844}]) {
      await page.setViewportSize(viewport);
      await expect(tools).toBeVisible();
      await expect(tools).toHaveAttribute("aria-expanded","false");
      await fit(`${viewport.width} collapsed`);
      const collapsed=await size();
      if(viewport.height>500) {
        await tools.click();
        await expect(tools).toHaveAttribute("aria-expanded","true");
        await expect.poll(size).toBeLessThan(collapsed);
        await page.getByTestId("button-toggle-filters").click();
        await fit("expanded filters");
        await page.getByTestId("button-toggle-filters").click();
        await tools.click();
        await expect.poll(size).toBe(collapsed);
      }
      const before=await header.boundingBox();
      await results.evaluate(el=>{el.scrollTop=el.scrollHeight;el.scrollLeft=el.scrollWidth;});
      const after=await header.boundingBox();
      assert.ok(before&&after&&Math.abs(before.y-after.y)<1,"header remains visible when records scroll");
      await results.evaluate(el=>{el.scrollLeft=0;el.scrollTop=0;});
      await page.getByTestId(`button-view-projects-${seeded[0].id}`).click();
      await expect(dialog.locator('[data-testid^="user-projects-entry-"]')).toHaveCount(3);
      assert.equal(await page.evaluate(()=>["INPUT","TEXTAREA"].includes(document.activeElement?.tagName)),false,"viewing assignments must not summon phone keyboard");
      await expect.poll(async()=>{
        const rect=await dialog.boundingBox();
        return rect&&rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewport.width+1&&rect.y+rect.height<=viewport.height+1
          ?"fits":JSON.stringify({viewport,rect});
      },{message:"projects modal fits the phone after opening/rotation"}).toBe("fits");
      const appTop=await page.evaluate(()=>Math.max(0,document.getElementById("root").getBoundingClientRect().top));
      const modalTitle=await dialog.getByRole("heading",{name:"Assigned projects",exact:true}).boundingBox();
      assert.ok(modalTitle&&modalTitle.y>=appTop-1,"project heading stays below hosting chrome in landscape");
      assert.equal(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,"long project names must wrap, not clip");
      await page.screenshot({path:`${out}/projects-${viewport.width}.jpg`});
      await page.keyboard.press("Escape");
      await results.evaluate(el=>{el.scrollLeft=0;});
      await page.screenshot({path:`${out}/phone-${viewport.width}.jpg`});
    }
    // Real mobile create and edit workflows must remain reachable and scrollable.
    await page.getByTestId("button-create-user").click();
    await expect(page.getByTestId("input-create-username")).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"create form fits phone");
    const uiUsername=`${prefix}-ui`;
    await page.getByTestId("input-create-username").fill(uiUsername);
    await page.getByTestId("input-create-password").fill(password);
    await page.getByTestId("input-create-firstname").fill("Responsive");
    await page.getByTestId("input-create-lastname").fill("Created in UI");
    const [createdResponse]=await Promise.all([
      page.waitForResponse(response=>response.url().endsWith("/api/users")&&response.request().method()==="POST"),
      page.getByTestId("button-submit-create").click(),
    ]);
    assert.equal(createdResponse.status(),201);
    const created=await createdResponse.json();
    await expect(results).toBeVisible();
    if(await tools.getAttribute("aria-expanded")==="false")await tools.click();
    await page.getByTestId("input-search-users").fill(uiUsername);
    await tools.click();
    await expect(rows).toHaveCount(1);
    await page.getByTestId(`button-actions-${created.id}`).click();
    await page.getByTestId(`menu-edit-${created.id}`).click();
    await expect(page.getByTestId("button-submit-edit")).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,"edit form fits phone");
    await page.getByTestId("input-edit-firstname").fill("Updated responsive");
    const [editedResponse]=await Promise.all([
      page.waitForResponse(response=>response.url().endsWith(`/api/users/${created.id}`)&&response.request().method()==="PATCH"),
      page.getByTestId("button-submit-edit").click(),
    ]);
    assert.equal(editedResponse.status(),200);
    await expect(results).toBeVisible();
    await expect(page.getByTestId(`row-user-${created.id}`)).toContainText("Updated responsive");
    await page.getByTestId(`button-actions-${created.id}`).click();
    await page.getByTestId(`menu-lock-${created.id}`).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button",{name:"Cancel",exact:true}).click();
    assert.equal((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`,{data:{
      permissions:["nav.users","users.view","projects.view"],
    }})).status(),200);
    const viewer=await browser.newContext({baseURL:`https://${process.env.REPLIT_DEV_DOMAIN}`,viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    assert.equal((await viewer.request.post("/api/auth/local/login",{data:fixture.viewer})).status(),200);
    const readOnly=await viewer.newPage(); await readOnly.goto("/users");
    await expect(readOnly.getByTestId("users-results")).toBeVisible();
    await expect(readOnly.getByTestId("button-create-user")).toHaveCount(0);
    await readOnly.getByTestId(`button-view-projects-${seeded[0].id}`).click();
    await expect(readOnly.getByTestId("user-projects-dialog").locator('[data-testid^="user-projects-entry-"]')).toHaveCount(1);
    for(const project of ownedProjects)await expect(readOnly.getByTestId(`user-projects-entry-${project.id}`)).toHaveCount(0);
    await readOnly.keyboard.press("Escape");
    await readOnly.locator('[data-testid^="button-actions-"]').first().click();
    await expect(readOnly.getByRole("menuitem")).toHaveCount(0);
    await readOnly.keyboard.press("Escape");
    await readOnly.locator("[data-users-row]").first().click();
    await expect(readOnly.getByTestId("text-edit-user-title")).toHaveCount(0);
    assert.equal((await viewer.request.delete(`/api/users/${seeded[0].id}`)).status(),403);
    assert.deepEqual(errors,[]);
    console.log("Users responsive acceptance passed: adaptive pagination, phone rotation, tools capacity, sticky header, complete CSV/Excel/PDF exports, mobile create/edit, action dialog, and view-only role.");
  } finally {
    const response=await context.request.get("/api/users");
    if(response.ok())for(const user of await response.json())if(user.username?.startsWith(prefix)){
      assert.equal((await context.request.delete(`/api/users/${user.id}`)).status(),204,"remove only owned test accounts");
    }
    for(const project of ownedProjects)assert.equal((await context.request.delete(`/api/projects/${project.id}`)).status(),204,"remove only owned test projects");
    await browser.close();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
