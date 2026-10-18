// Authenticated disposable-fixture acceptance. No live routing-provider calls.
const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs");
const assert = require("node:assert/strict");
(async()=>{
  const fixture=JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json","utf8"));
  const browser=await chromium.launch({executablePath:"/repl/tools/bin/chromium",args:["--no-sandbox"]});
  const context=await browser.newContext({baseURL:`https://${process.env.REPLIT_DEV_DOMAIN}`});
  const root=`/api/projects/${fixture.projectId}`;
  const api=async(method,url,data,status=200)=>{
    const response=await context.request.fetch(url,{method,data});
    assert.equal(response.status(),status,`${method} ${url}: ${await response.text()}`);
    return response.json();
  };
  const errors=[];
  try {
    await api("POST","/api/auth/local/login",fixture);
    await api("PATCH",root,{timezone:"America/Denver",defaultServiceMinutes:30,defaultAppointmentToleranceMinutes:60});
    const service=(await api("GET","/api/service-types"))[0].code;
    const order=await api("POST",`${root}/work-orders`,{
      customerWoId:`VISIT-UI-${Date.now()}`,customerId:"VISIT-UI",customerName:"Scheduling fixture",address:"Fixture only",
      serviceType:service,status:"Scheduled",assignedUserId:fixture.id,scheduledAt:"2026-10-20T14:00:00Z",serviceDurationMinutes:75,
      appointmentWindowStart:"2026-10-20T14:00:00Z",appointmentWindowEnd:"2026-10-20T15:00:00Z",
    },201);
    await api("PATCH",`${root}/work-orders/${order.id}`,{serviceDurationMinutes:0},400);
    await api("PATCH",`${root}/work-orders/${order.id}`,{appointmentWindowEnd:null},400);
    const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
    fs.mkdirSync("generated-artifacts/visit-scheduling",{recursive:true});
    for(const [name,viewport,duration] of [["desktop",{width:1365,height:950},"80"],["phone",{width:390,height:844},"90"]]) {
      await page.setViewportSize(viewport);
      await page.goto(`/projects/${fixture.projectId}/work-orders?edit=${order.id}`);
      await page.getByTestId("accordion-scheduling").click();
      const visibleSummary=page.locator('[data-testid="planning-inherited-values"]:visible');
      await expect(visibleSummary).toContainText("America/Denver");
      await expect(visibleSummary).toContainText("30 min · Project default");
      await expect(visibleSummary).toContainText("60 min · Project default");
      await page.getByTestId(`button-${name==="phone"?"mobile":"desktop"}-scheduling-edit`).click();
      const input=page.getByTestId("input-service-duration-minutes");
      await expect(input).toHaveValue(name==="desktop"?"75":"80");
      await expect(page.getByTestId("input-appointment-window-start")).toHaveValue("2026-10-20T08:00");
      const trouble=page.getByTestId(name==="phone"?"select-mobile-trouble":"select-trouble");
      assert.ok(await trouble.evaluate((el, id)=>!!(el.compareDocumentPosition(document.getElementById(id)) & Node.DOCUMENT_POSITION_FOLLOWING),"service-duration-minutes"),
        "Route planning overrides must follow trouble code and assignment fields");
      await input.fill(duration);
      if(name==="desktop") {
        await page.getByTestId("input-appointment-window-start").fill("2026-03-08T02:30");
        await expect(page.getByText(/does not exist because of a time-zone clock change/).first()).toBeVisible();
        await page.getByTestId("input-appointment-window-start").fill("2026-10-20T08:00");
      }
      await input.scrollIntoViewIfNeeded();
      await page.screenshot({path:`generated-artifacts/visit-scheduling/${name}.jpg`,fullPage:true});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),"No horizontal overflow");
      const saving=page.waitForResponse(response=>response.request().method()==="PATCH"&&response.url().endsWith(`${root}/work-orders/${order.id}`));
      await page.getByTestId("button-save").click();
      const saved=await saving;
      assert.equal(saved.status(),200,await saved.text());
      await expect.poll(async()=>(await api("GET",`${root}/work-orders/${order.id}`)).serviceDurationMinutes).toBe(Number(duration));
    }
    await page.reload();await page.getByTestId("accordion-scheduling").click();
    await page.getByTestId("button-mobile-scheduling-edit").click();
    await page.getByTestId("input-service-duration-minutes").fill("");
    await page.getByTestId("input-appointment-window-start").fill("");
    await page.getByTestId("input-appointment-window-end").fill("");
    await page.getByTestId("button-save").click();
    await expect.poll(async()=>(await api("GET",`${root}/work-orders/${order.id}`)).serviceDurationMinutes).toBe(null);
    const cleared=await api("GET",`${root}/work-orders/${order.id}`);
    assert.equal(cleared.appointmentWindowStart,null);assert.equal(cleared.appointmentWindowEnd,null);
    await page.reload();await page.getByTestId("accordion-scheduling").click();
    const inherited=page.locator('[data-testid="planning-inherited-values"]:visible');
    await expect(inherited).toContainText("30 min · Project default");
    await expect(inherited).toContainText("Scheduled appointment plus inherited tolerance");
    await expect(inherited).toContainText(/8:00.*AM/);
    await expect(inherited).toContainText(/9:00.*AM/);
    await page.getByTestId("button-mobile-scheduling-edit").click();
    await expect(page.getByTestId("input-service-duration-minutes")).toHaveValue("");
    await expect(page.getByTestId("input-service-duration-minutes")).toHaveAttribute("placeholder","30 min (project default)");
    await expect(page.getByTestId("input-appointment-window-start")).toHaveValue("");
    const mobile=await api("POST",`${root}/mobile/sync/upload`,{workOrders:[{
      id:order.id,forceOverwrite:true,service_duration_minutes:55,
      appointment_window_start:"2026-10-20T08:00:00-06:00",appointment_window_end:"2026-10-20T09:00:00-06:00",
    }]});
    assert.equal(mobile.results[0].status,"success");
    const download=await api("GET",`${root}/mobile/sync/download`);
    assert.equal(download.meta.visitSchedulingContractVersion,1);
    assert.equal(download.meta.timezone,"America/Denver");
    assert.equal(download.workOrders.find(w=>w.id===order.id).serviceDurationMinutes,55);
    assert.equal(download.workOrders.find(w=>w.id===order.id).appointmentWindowStart,"2026-10-20T14:00:00.000Z");
    const incomplete=await api("POST",`${root}/mobile/sync/upload`,{workOrders:[{id:order.id,forceOverwrite:true,appointmentWindowEnd:null}]});
    assert.equal(incomplete.results[0].status,"error");
    const conflicting=await api("POST",`${root}/mobile/sync/upload`,{workOrders:[{id:order.id,forceOverwrite:true,serviceDurationMinutes:30,service_duration_minutes:60}]});
    assert.equal(conflicting.results[0].status,"error");
    await page.setViewportSize({width:1365,height:950});
    await page.goto(`/projects/${fixture.projectId}/edit`);
    await page.getByTestId("project-tab-schedule").click();
    await expect(page.getByTestId("input-project-service-default")).toHaveValue("30");
    await expect(page.getByTestId("input-project-tolerance-default")).toHaveValue("60");
    await page.getByTestId("input-project-service-default").fill("35");
    await page.getByTestId("input-project-tolerance-default").fill("70");
    await page.getByTestId("button-submit").click();
    await expect.poll(async()=>(await api("GET",root)).defaultServiceMinutes).toBe(35);
    assert.equal((await api("GET",root)).defaultAppointmentToleranceMinutes,70);
    // Use normal role management to verify that read access does not grant writes.
    const role=(await api("GET","/api/subroles")).find(r=>r.id===fixture.viewerRoleId);
    await api("PUT",`/api/subroles/${role.id}`,{key:role.key,label:role.label,baseRole:role.baseRole,description:role.description,
      permissions:["workOrders.view","projects.view","project.workOrders"]});
    const viewer=await browser.newContext({baseURL:`https://${process.env.REPLIT_DEV_DOMAIN}`});
    try {
      assert.equal((await viewer.request.post("/api/auth/local/login",{data:fixture.viewer})).status(),200);
      assert.equal((await viewer.request.patch(`${root}/work-orders/${order.id}`,{data:{serviceDurationMinutes:90}})).status(),403);
      assert.equal((await viewer.request.patch(root,{data:{defaultServiceMinutes:90}})).status(),403);
      const viewerPage=await viewer.newPage();
      await viewerPage.goto(`/projects/${fixture.projectId}/work-orders?edit=${order.id}`);
      await viewerPage.getByTestId("accordion-scheduling").click();
      await expect(viewerPage.locator('[data-testid="planning-inherited-values"]:visible')).toContainText("35 min · Project default");
      await expect(viewerPage.getByTestId("input-service-duration-minutes")).toHaveCount(0);
      await expect(viewerPage.getByTestId("button-desktop-scheduling-edit")).toHaveCount(0);
      const rejected=await viewer.request.post(`${root}/mobile/sync/upload`,{data:{workOrders:[{id:order.id,forceOverwrite:true,serviceDurationMinutes:90}]}});
      assert.equal(rejected.status(),200);assert.equal((await rejected.json()).results[0].status,"error");
    } finally {await viewer.close();}
    assert.deepEqual(errors,[]);
    console.log("Visit scheduling UI passed: desktop/phone save/reopen/clear, DST rejection, project defaults, authorization and layout.");
  } finally {await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
