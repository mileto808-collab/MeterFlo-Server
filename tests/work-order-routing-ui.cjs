// Isolated fixture only. UI provider responses/map scripts are explicitly mocked;
// these checks are not evidence of live provider access or native Maps launch.
const { chromium, webkit, expect } = require("@playwright/test");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const assert = require("node:assert/strict");

(async()=>{
  const fixture=JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json","utf8"));
  const out="generated-artifacts/work-order-routing";await fsp.mkdir(out,{recursive:true});
  const baseURL=`https://${process.env.REPLIT_DEV_DOMAIN}`;
  const browser=await chromium.launch({executablePath:"/repl/tools/bin/chromium",args:["--no-sandbox"]});
  const context=await browser.newContext({baseURL,viewport:{width:1365,height:950},geolocation:{latitude:40,longitude:-105},permissions:["geolocation"]});
  const root=`/api/projects/${fixture.projectId}`,routeRoot=`${root}/routing`;
  const request=async(method,url,data,status=200)=>{
    const response=await context.request.fetch(url,{method,data});
    assert.equal(response.status(),status,`${method} ${url} (${response.status()})`);
    return response.json();
  };
  try{
    await request("POST","/api/auth/local/login",fixture);
    const actualSettings=await request("GET",`${routeRoot}/settings`);
    assert.equal(actualSettings.ready,false);
    assert.equal(actualSettings.disabled,true);
    const definitions=await request("GET",`${root}/work-order-sub-statuses`);
    const critical=definitions.find(d=>d.label==="Critical");
    assert.ok(critical);assert.ok(Number.isInteger(critical.routingPriority));
    await request("PATCH",`${root}/work-order-sub-statuses/${critical.id}`,{routingPriority:0});
    assert.equal((await request("GET",`${root}/work-order-sub-statuses`)).find(d=>d.id===critical.id).routingPriority,0);
    const service=(await request("GET","/api/service-types"))[0].code;
    const existing=await request("GET",`${root}/work-orders`);
    for(let i=0;i<2;i++)if(!existing.some(order=>order.customerWoId===`ROUTE-FIELD-${i}`))await request("POST",`${root}/work-orders`,{
      customerWoId:`ROUTE-FIELD-${i}`,serviceType:service,status:"Scheduled",
      address:`${200+i} Field Lane`,assignedUserId:fixture.viewer.id,
    },201);
    if(!existing.some(order=>order.customerWoId==="ROUTE-FIELD-OPEN"))await request("POST",`${root}/work-orders`,{
      customerWoId:"ROUTE-FIELD-OPEN",serviceType:service,status:"Open",assignedUserId:fixture.viewer.id,
    },201);
    for(let i=0;i<10;i++)if(!existing.some(o=>o.customerWoId===`ROUTE-PAGING-${i}`))await request("POST",`${root}/work-orders`,{
      customerWoId:`ROUTE-PAGING-${i}`,customerId:`ROUTE-${i}`,customerName:"Route acceptance",
      address:`${100+i} Fixture Lane`,oldGps:`40.${i+2},-105`,serviceType:service,status:"Scheduled",assignedUserId:fixture.id,
    },201);
    const orders=await request("GET",`${root}/work-orders`),scheduled=orders.filter(o=>o.status==="Scheduled");
    assert.ok(scheduled.length>10);
    const registry=await request("GET","/api/permissions");
    assert.ok(registry.some(p=>p.key==="workOrders.optimizeRoute"),"Permission discoverable in normal role management");
    const role=(await request("GET","/api/subroles")).find(r=>r.id===fixture.viewerRoleId);
    await request("PUT",`/api/subroles/${fixture.viewerRoleId}`,{
      key:role.key,label:role.label,baseRole:role.baseRole,description:role.description,
      permissions:["workOrders.view","projects.view"],
    });
    const viewer=await browser.newContext({baseURL});
    await viewer.request.post("/api/auth/local/login",{data:fixture.viewer});
    assert.equal((await viewer.request.post(`${routeRoot}/plan`,{data:{ids:[scheduled[0].id],origin:{lat:40,lng:-105},
      departureAt:new Date().toISOString(),serviceMinutes:10,toleranceMinutes:0}})).status(),403);
    await request("PUT",`/api/subroles/${fixture.viewerRoleId}`,{
      key:role.key,label:role.label,baseRole:role.baseRole,description:role.description,
      permissions:["workOrders.view","projects.view","workOrders.optimizeRoute"],
    });
    assert.equal((await viewer.request.post(`${routeRoot}/plan`,{data:{ids:[scheduled[0].id],origin:{lat:40,lng:-105},
      departureAt:new Date().toISOString(),serviceMinutes:10,toleranceMinutes:0}})).status(),503,"Normal role grant reaches unconfigured provider, not permission denial");
    assert.equal((await viewer.request.put(`${routeRoot}/settings`,{data:actualSettings.configuration})).status(),403);
    assert.equal((await viewer.request.get("/api/routing/settings")).status(),403);
    await viewer.close();
    const page=await context.newPage();const errors=[];
    page.on("pageerror",e=>errors.push(e.message));
    const scheduledGrid = async () => {
      await expect(page.getByTestId("button-toggle-mobile-tools")).toBeVisible();
      if(!await page.getByTestId("input-search-work-orders").isVisible())
        await page.getByTestId("button-toggle-mobile-tools").click();
      await page.getByTestId("button-filters-dialog").click();
      await page.getByTestId("checkbox-status-scheduled").check();
      await page.getByTestId("button-dialog-close-filters").click();
    };
    await page.goto(`/projects/${fixture.projectId}/work-orders`);
    // Mixed grids with any Scheduled work are eligible; empty/non-Scheduled-only grids are not.
    await expect(page.getByTestId("input-search-work-orders")).toBeVisible();
    await expect(page.getByTestId("optimize-work-order-route")).toBeVisible();
    await page.getByTestId("input-search-work-orders").fill("ROUTE-FIELD-OPEN");
    await expect(page.getByTestId("optimize-work-order-route")).toHaveCount(0);
    await page.getByTestId("input-search-work-orders").fill("");
    await scheduledGrid();
    const optimize=page.getByTestId("optimize-work-order-route");
    await expect(optimize).toBeVisible();
    assert.equal(await optimize.evaluate(el=>el.previousElementSibling?.getAttribute("data-testid")),
      "button-create-work-order","Optimize route immediately follows New Work Order");
    await page.getByTestId("input-search-work-orders").fill("NO-MATCHING-ROUTE-FIXTURE");
    await expect(optimize).toHaveCount(0);
    await page.getByTestId("input-search-work-orders").fill("");
    await expect(optimize).toBeVisible();
    for(const viewport of [{width:1365,height:950},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      await optimize.scrollIntoViewIfNeeded();
      await expect(optimize).toHaveText("Optimize route");
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),
        "Toolbar fits desktop and phone screens");
      await page.screenshot({path:`${out}/toolbar-${viewport.width}.jpg`});
    }
    await page.setViewportSize({width:1365,height:950});
    await page.getByTestId("optimize-work-order-route").click();
    await expect(page.getByTestId("create-route-plan")).toBeDisabled();
    await expect(page.getByRole("dialog").first()).toContainText("Route optimization is disabled");
    await page.screenshot({path:`${out}/unconfigured-desktop.jpg`});
    await page.getByRole("button",{name:"Back to work orders",exact:true}).last().click();
    let body,plannedStops,plannedRoutes,needsAddressReview=true,wrongResponseScope=true,stale=false,deny=false;
    const readiness={configuration:{mode:"override",provider:"google",serverKeyEnv:"GOOGLE_MAPS_TEST_SERVER",browserKeyEnv:"GOOGLE_MAPS_TEST_BROWSER",maxStops:24,dailyPlans:10},
      effective:{provider:"google",source:"project",maxStops:24,dailyPlans:10},ready:true,mapReady:true,disabled:false,canManage:true,revision:"a".repeat(64),message:"Controlled fixture; not live provider access."};
    await page.route(`**${routeRoot}/settings`,route=>route.fulfill({json:readiness}));
    await page.route(`**${routeRoot}/map-config`,route=>route.fulfill({json:{provider:"google",browserKey:"public-fixture-not-a-key"}}));
    await page.route(`**${routeRoot}/validate`,route=>deny?route.fulfill({status:403,json:{message:"Fixture access revoked"}}):route.fulfill({json:{stale}}));
    await page.route(`**${routeRoot}/plan`,async route=>{
      body=route.request().postDataJSON();
      const stops=body.ids.filter(id=>orders.find(order=>order.id===id)?.assignedUserId).map((id,i)=>{
        const order=orders.find(o=>o.id===id);
        return {id,label:order.customerWoId,address:order.address||"Verified fixture location",point:{lat:40+i*.002,lng:-105+i*.002},
          scheduledAt:order.scheduledAt,priority:i===0?0:null,subStatus:i===0?"Critical":null,
          serviceDurationMinutes:i===0?75:30,durationSource:i===0?"work-order":"project",
          appointmentWindowStart:null,appointmentWindowEnd:null,appointmentSource:order.scheduledAt?"scheduled":"none",waitingMinutes:i===0?5:0,
          arrivalAt:new Date(Date.now()+(i+1)*600000).toISOString(),serviceAt:new Date(Date.now()+(i+1)*600000).toISOString(),
          departureAt:new Date(Date.now()+(i+1)*600000+300000).toISOString(),lateMinutes:0,travelSeconds:300,travelMeters:1000};
      });
      if(needsAddressReview){
        const reviews=stops.slice(0,2).map(stop=>({
          id:`stop-${stop.id}`,kind:"stop",workOrderId:stop.id,label:`Work order ${stop.label}`,
          submittedAddress:stop.address,resolvedAddress:"999 Different Road, Fixturetown, CO 80000",
          point:stop.point,reasons:["Street name or road number differs."],token:`fixture-review-${stop.id}`,
        }));
        if(!reviews.every(review=>body.addressConfirmations?.includes(review.token))){
          await route.fulfill({status:409,json:{code:"ADDRESS_REVIEW_REQUIRED",addressReviews:reviews}});
          return;
        }
        needsAddressReview=false;
      }
      const excluded=body.ids.filter(id=>!orders.find(order=>order.id===id)?.assignedUserId)
        .map(id=>({id,label:orders.find(order=>order.id===id).customerWoId,reason:"Unassigned. Assign before optimizing."}));
      const common={assignmentRoutingVersion:1,addressReviewVersion:1,projectId:fixture.projectId,provider:"google",configurationRevision:readiness.revision,fingerprint:"b".repeat(64),
        createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),departureAt:body.departureAt,origin:{lat:40,lng:-105},
        originAddress:body.origin.address,scopeIds:body.ids,warnings:["Controlled UI fixture. Road provider has not been live-verified."],
        serviceMinutes:body.serviceMinutes,toleranceMinutes:body.toleranceMinutes};
      const assignees=[...new Set(stops.map(stop=>orders.find(order=>order.id===stop.id).assignedUserId))];
      plannedRoutes=assignees.map(assigneeId=>{
        const assignedStops=stops.filter(stop=>orders.find(order=>order.id===stop.id).assignedUserId===assigneeId);
        return {...common,assigneeId,assigneeName:assigneeId===fixture.id?"Dispatch technician":"Field technician",
          stops:assignedStops,excluded:[],geometry:[common.origin,...assignedStops.map(stop=>stop.point)],
          totalTravelSeconds:300*assignedStops.length,totalTravelMeters:1000*assignedStops.length};
      });
      plannedStops=plannedRoutes[0].stops;
      const responseScope=wrongResponseScope?[...body.ids,orders.find(order=>order.status==="Open").id]:body.ids;
      await route.fulfill({json:{...plannedRoutes[0],routes:plannedRoutes,excluded,scopeIds:responseScope}});
    });
    await page.route("https://maps.googleapis.com/maps/api/js?*",route=>route.fulfill({contentType:"application/javascript",body:`
      window.__routeMap={markers:[],paths:[]};window.google={maps:{
        Map:class{fitBounds(){}},LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}},
        LatLngBounds:class{extend(){}},Polyline:class{constructor(o){window.__routeMap.paths.push(o.path);}},
        Marker:class{constructor(o){window.__routeMap.markers.push(o.label);}}
      }};window.initMap();`}));
    await page.reload();
    // Keep Open and Scheduled orders together to reproduce the real confirmation
    // path: only Scheduled IDs are submitted, even though the grid has more rows.
    await expect(page.getByTestId("button-toggle-mobile-tools")).toBeVisible();
    if(!await page.getByTestId("input-search-work-orders").isVisible())
      await page.getByTestId("button-toggle-mobile-tools").click();
    await page.getByTestId("button-filters-dialog").click();
    await page.getByTestId("checkbox-status-scheduled").uncheck();
    await page.getByTestId("button-dialog-close-filters").click();
    await page.getByTestId("optimize-work-order-route").click();
    await expect(page.getByTestId("route-setup-dialog")).toContainText(/[1-9]\d* non-Scheduled orders are excluded/);
    await expect(page.getByTestId("create-route-plan")).toBeEnabled();
    await page.getByTestId("route-manual-origin").fill("100 Warehouse Road, Fixturetown, CO 80000");
    await page.getByTestId("create-route-plan").click();
    await expect(page.getByTestId("address-match-review")).toBeVisible();
    await expect(page.getByTestId("navigate-next-stop")).toHaveCount(0);
    await expect(page.getByTestId("address-review-submit")).toBeDisabled();
    const confirmations=page.locator('[data-testid^="address-confirm-"]');
    await confirmations.first().check();
    await expect(page.getByTestId("address-review-submit")).toBeDisabled();
    await page.getByTestId("address-review-cancel").click();
    await page.getByTestId("create-route-plan").click();
    await expect(confirmations.first()).not.toBeChecked();
    await page.locator('[data-testid^="address-correct-"]').first().click();
    await expect(page.getByTestId("header-button-back-to-work-orders")).toBeVisible();
    await page.getByTestId("header-button-back-to-work-orders").click();
    await expect(page.getByTestId("create-route-plan")).toBeVisible();
    await page.getByTestId("route-manual-origin").fill("100 Warehouse Road, Fixturetown, CO 80000");
    await page.getByTestId("create-route-plan").click();
    await expect(page.getByTestId("address-match-review")).toBeVisible();
    for(const viewport of [{width:1365,height:950},{width:390,height:844}]){
      await page.setViewportSize(viewport);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),
        "Address review fits desktop and phone screens");
      await page.screenshot({path:`${out}/address-review-${viewport.width}.jpg`});
    }
    for(const checkbox of await confirmations.all())await checkbox.check();
    await expect(page.getByTestId("address-review-submit")).toBeEnabled();
    await page.getByTestId("address-review-submit").click();
    await expect(page.getByTestId("route-setup-dialog")).toContainText("different work-order scope");
    await expect(page.getByTestId("route-mode-list")).toHaveCount(0);
    wrongResponseScope=false;
    await page.getByTestId("address-review-submit").click();
    await page.setViewportSize({width:1365,height:950});
    await expect(page.getByTestId("route-mode-list")).toBeVisible();
    assert.equal(body.ids.length,scheduled.length,"Scope includes Scheduled rows across ALL pages");
    assert.ok(body.ids.every(id=>orders.find(order=>order.id===id).status==="Scheduled"),"Mixed grid submits only Scheduled orders");
    assert.deepEqual(body.origin,{address:"100 Warehouse Road, Fixturetown, CO 80000"});
    assert.equal(plannedRoutes.length,2);
    await page.getByTestId("routing-technician-select").selectOption(fixture.viewer.id);
    await expect(page.getByText("Next stop",{exact:true})).toBeVisible();
    await expect(page.getByTestId(`route-stop-${plannedStops[0].id}`)).toHaveCount(0);
    // Intercept the native print call while retaining real isolated print documents.
    await page.evaluate(()=>{
      const open=window.open.bind(window);
      window.open=(...args)=>{const popup=open(...args);if(popup)popup.print=()=>{popup.__meterfloPrinted=true;};return popup;};
    });
    for(const [button,count]of [["route-print-current",1],["route-print-all",2]]){
      const [printPage]=await Promise.all([context.waitForEvent("page"),page.getByTestId(button).click()]);
      await expect(printPage.locator("article.route-page")).toHaveCount(count);
      await expect.poll(()=>printPage.evaluate(()=>window.__meterfloPrinted)).toBe(true);
      await printPage.emulateMedia({media:"print"});
      if(count===2)assert.equal(await printPage.locator("article.route-page").nth(1).evaluate(element=>getComputedStyle(element).breakBefore),"page");
      else{
        await expect(printPage.locator("article.route-page h1")).toHaveText("Field technician");
        await expect(printPage.getByText(plannedStops[0].label,{exact:false})).toHaveCount(0);
      }
      await printPage.pdf({path:`${out}/${button}.pdf`,format:"Letter",printBackground:true});
      await printPage.close();
    }
    await page.getByTestId("routing-technician-select").selectOption(fixture.id);
    await expect(page.getByText("Next stop",{exact:true})).toBeVisible();
    await expect(page.getByTestId(`route-stop-${body.ids[0]}`)).toContainText("Priority 0");
    await expect.poll(()=>page.frames().filter(f=>f.url()==="about:srcdoc").length).toBe(1);
    const mapFrame=page.frames().find(f=>f.url()==="about:srcdoc");
    await expect.poll(()=>mapFrame.evaluate(()=>window.__routeMap?.markers.length)).toBe(plannedStops.length);
    assert.equal(await mapFrame.evaluate(()=>window.__routeMap.paths[0].length),plannedStops.length+1);
    await page.screenshot({path:`${out}/desktop.jpg`,fullPage:true});
    await page.getByTestId("route-next-stop").click();
    await page.reload();
    await expect(page.getByTestId("navigate-next-stop")).toBeVisible();
    await expect(page.getByText(`Stop 2 of ${plannedStops.length}`,{exact:true})).toBeVisible();
    await page.getByTestId(`route-stop-${body.ids[1]}`).click();
    await expect(page.getByTestId("header-button-back-to-work-orders")).toBeVisible();
    await page.getByTestId("header-button-back-to-work-orders").click();
    await expect(page.getByTestId("navigate-next-stop")).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    await page.getByTestId("route-mode-list").click();
    await page.screenshot({path:`${out}/phone-list.jpg`,fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),"Phone page has no horizontal overflow");
    // Verify HTTPS target interception without launching an app or navigating away.
    let handoff;
    await page.route("https://www.google.com/maps/dir/**",async route=>{handoff=route.request().url();await route.abort();});
    await page.getByTestId("navigate-next-stop").click().catch(()=>{});
    await expect.poll(()=>handoff).toBeTruthy();
    const googleHandoff = new URL(handoff);
    assert.equal(googleHandoff.hostname,"www.google.com");
    assert.equal(googleHandoff.pathname,"/maps/dir/");
    assert.equal(googleHandoff.searchParams.get("destination"),`${plannedStops[1].point.lat},${plannedStops[1].point.lng}`,
      "After advancing, refreshing and viewing details, navigation targets the selected second stop—not the origin or first stop");
    assert.equal(googleHandoff.searchParams.get("api"),"1");
    assert.equal(googleHandoff.searchParams.get("travelmode"),"driving");
    assert.equal(googleHandoff.searchParams.get("dir_action"),"navigate");
    assert.equal(googleHandoff.searchParams.has("origin"),false);
    assert.equal(googleHandoff.searchParams.has("waypoints"),false);
    // A failed external navigation may leave an error page: refresh original route.
    await page.goto(`/projects/${fixture.projectId}/work-orders`);
    await expect(page.getByTestId("navigate-next-stop")).toBeVisible();
    stale=true;
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("alert").filter({hasText:"needs review"})).toBeVisible();
    await expect(page.getByTestId("route-print-current")).toBeDisabled();
    await expect(page.getByTestId("route-print-all")).toBeDisabled();
    deny=true;
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect(page.getByTestId("route-planner")).toBeHidden();
    assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith("meterflo:active-route:")).length),0);
    deny=false;stale=false;
    await page.setViewportSize({width:1365,height:950});
    const search=page.getByTestId("input-search-work-orders");
    if(!await search.isVisible())await page.getByRole("button",{name:"Show Search & Tools",exact:true}).click();
    await search.fill("ROUTE-PAGING");
    await page.getByTestId("optimize-work-order-route").click();
    await expect(page.getByRole("dialog").first()).toContainText("10 Scheduled candidates across all grid pages");
    await page.getByTestId("route-manual-origin").fill("100 Warehouse Road, Fixturetown, CO 80000");
    await page.getByTestId("create-route-plan").click();
    await expect(page.getByTestId("route-mode-list")).toBeVisible();
    assert.equal(body.ids.length,10,"Filtered scope never expands to all project work orders");
    await page.getByRole("button",{name:"End this route",exact:true}).click();
    await expect(page.getByRole("button",{name:"Resume this route",exact:true})).toBeVisible();
    await page.getByTestId("route-replan").click();
    await page.getByRole("button",{name:"Back to work orders",exact:true}).last().click();
    const checkbox=page.getByRole("checkbox",{name:/Select work order ROUTE-PAGING/}).first();
    const selectedId=Number((await checkbox.getAttribute("data-testid")).replace("checkbox-select-",""));
    await checkbox.check();
    await page.getByTestId("optimize-work-order-route").click();
    await page.getByRole("radio",{name:/Selected orders/}).check();
    await page.getByTestId("route-manual-origin").fill("100 Warehouse Road, Fixturetown, CO 80000");
    await page.getByTestId("create-route-plan").click();
    await expect(page.getByTestId("route-mode-list")).toBeVisible();
    assert.deepEqual(body.ids,[selectedId],"Explicit selected scope contains only chosen Scheduled records");
    await page.addInitScript(()=>Object.defineProperty(navigator,"userAgent",{get:()=>"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"}));
    await page.setViewportSize({width:390,height:844});
    await page.reload();
    await expect(page.getByTestId("navigate-next-stop")).toHaveText(/Apple Maps/);
    await page.route("https://maps.apple.com/**",async route=>{handoff=route.request().url();await route.abort();});
    handoff=null;
    await page.getByTestId("navigate-next-stop").click().catch(()=>{});
    await expect.poll(()=>handoff).toMatch(/^https:\/\/maps\.apple\.com\/\?daddr=/);
    // Use the real built-in technician role without changing its permissions.
    const fieldRole=(await request("GET","/api/subroles")).find(role=>role.key==="field_technician");
    assert.ok(fieldRole);
    await request("PATCH",`/api/users/${fixture.viewer.id}/subrole`,{subroleId:fieldRole.id});
    const technician=await browser.newContext({baseURL,viewport:{width:390,height:844}});
    try{
      assert.equal((await technician.request.post("/api/auth/local/login",{data:fixture.viewer})).status(),200);
      const ownResponse=await technician.request.get(`${root}/work-orders`);
      assert.equal(ownResponse.status(),200);
      const own=await ownResponse.json();
      assert.equal(own.length,2);
      assert.ok(own.every(order=>order.status==="Scheduled"&&order.assignedUserId===fixture.viewer.id));
      assert.deepEqual(await (await technician.request.get(`${root}/work-orders?status=Open&assignedTo=${fixture.id}`)).json(),[]);
      const stats=await (await technician.request.get(`${root}/work-orders/stats`)).json();
      assert.equal(stats.total,2);
      const globalOwn=await (await technician.request.get("/api/work-orders")).json();
      assert.ok(globalOwn.every(order=>order.status==="Scheduled"&&order.assignedUserId===fixture.viewer.id));
      const mobileResponse=await technician.request.get(`${root}/mobile/sync/download`);
      assert.equal(mobileResponse.status(),200);
      const mobile=await mobileResponse.json();
      assert.equal(mobile.workOrders.length,2);
      assert.ok(mobile.workOrders.every(order=>order.status==="Scheduled"&&order.assigned_user_id===fixture.viewer.id));
      const technicianPage=await technician.newPage();
      await technicianPage.goto(`/projects/${fixture.projectId}/work-orders`);
      await expect(technicianPage.getByText("ROUTE-FIELD-0",{exact:true})).toBeVisible();
      await expect(technicianPage.getByText("ROUTE-FIELD-1",{exact:true})).toBeVisible();
      await expect(technicianPage.getByText("ROUTE-FIELD-OPEN",{exact:true})).toHaveCount(0);
      await technicianPage.screenshot({path:`${out}/technician-grid-phone.jpg`});
    }finally{
      await technician.close();
      await request("PATCH",`/api/users/${fixture.viewer.id}/subrole`,{subroleId:fixture.viewerRoleId});
    }
    assert.deepEqual(errors,[]);
    console.log("Routing desktop/phone UI: technician-only grid, mixed-status eligibility, separate routes, warehouse origin, individual/all printing, scopes, address review, maps, detail/recovery, handoff and stale/access cleanup passed.");
    console.log(fs.existsSync(webkit.executablePath())?"WebKit executable available for additional checks.":"WebKit executable unavailable; physical iOS/Safari native handoff is not verified.");
  }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
