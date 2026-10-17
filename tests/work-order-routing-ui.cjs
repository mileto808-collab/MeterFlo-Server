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
    for(let i=0;i<10;i++)if(!existing.some(o=>o.customerWoId===`ROUTE-PAGING-${i}`))await request("POST",`${root}/work-orders`,{
      customerWoId:`ROUTE-PAGING-${i}`,customerId:`ROUTE-${i}`,customerName:"Route acceptance",
      address:`${100+i} Fixture Lane`,oldGps:`40.${i+2},-105`,serviceType:service,status:"Scheduled",
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
    await page.goto(`/projects/${fixture.projectId}/work-orders`);
    await page.getByTestId("optimize-work-order-route").click();
    await expect(page.getByTestId("create-route-plan")).toBeDisabled();
    await expect(page.getByRole("dialog").first()).toContainText("Route optimization is disabled");
    await page.screenshot({path:`${out}/unconfigured-desktop.jpg`});
    await page.getByRole("button",{name:"Back to work orders",exact:true}).last().click();
    let body,stale=false,deny=false;
    const readiness={configuration:{mode:"override",provider:"google",serverKeyEnv:"GOOGLE_MAPS_TEST_SERVER",browserKeyEnv:"GOOGLE_MAPS_TEST_BROWSER",maxStops:24,dailyPlans:10},
      effective:{provider:"google",source:"project",maxStops:24,dailyPlans:10},ready:true,mapReady:true,disabled:false,canManage:true,revision:"a".repeat(64),message:"Controlled fixture; not live provider access."};
    await page.route(`**${routeRoot}/settings`,route=>route.fulfill({json:readiness}));
    await page.route(`**${routeRoot}/map-config`,route=>route.fulfill({json:{provider:"google",browserKey:"public-fixture-not-a-key"}}));
    await page.route(`**${routeRoot}/validate`,route=>deny?route.fulfill({status:403,json:{message:"Fixture access revoked"}}):route.fulfill({json:{stale}}));
    await page.route(`**${routeRoot}/plan`,async route=>{
      body=route.request().postDataJSON();
      const stops=body.ids.map((id,i)=>{
        const order=orders.find(o=>o.id===id);
        return {id,label:order.customerWoId,address:order.address||"Verified fixture location",point:{lat:40+i*.002,lng:-105+i*.002},
          scheduledAt:order.scheduledAt,priority:i===0?0:null,subStatus:i===0?"Critical":null,
          serviceDurationMinutes:i===0?75:30,durationSource:i===0?"work-order":"project",
          appointmentWindowStart:null,appointmentWindowEnd:null,appointmentSource:order.scheduledAt?"scheduled":"none",waitingMinutes:i===0?5:0,
          arrivalAt:new Date(Date.now()+(i+1)*600000).toISOString(),serviceAt:new Date(Date.now()+(i+1)*600000).toISOString(),
          departureAt:new Date(Date.now()+(i+1)*600000+300000).toISOString(),lateMinutes:0,travelSeconds:300,travelMeters:1000};
      });
      await route.fulfill({json:{projectId:fixture.projectId,provider:"google",configurationRevision:readiness.revision,fingerprint:"b".repeat(64),
        createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),departureAt:body.departureAt,origin:body.origin,
        stops,excluded:[],warnings:["Controlled UI fixture. Road provider has not been live-verified."],geometry:[body.origin,...stops.map(s=>s.point)],
        totalTravelSeconds:300*stops.length,totalTravelMeters:1000*stops.length,serviceMinutes:body.serviceMinutes,toleranceMinutes:body.toleranceMinutes}});
    });
    await page.route("https://maps.googleapis.com/maps/api/js?*",route=>route.fulfill({contentType:"application/javascript",body:`
      window.__routeMap={markers:[],paths:[]};window.google={maps:{
        Map:class{fitBounds(){}},LatLng:class{constructor(lat,lng){this.lat=lat;this.lng=lng;}},
        LatLngBounds:class{extend(){}},Polyline:class{constructor(o){window.__routeMap.paths.push(o.path);}},
        Marker:class{constructor(o){window.__routeMap.markers.push(o.label);}}
      }};window.initMap();`}));
    await page.reload();
    await page.getByTestId("optimize-work-order-route").click();
    await expect(page.getByTestId("create-route-plan")).toBeEnabled();
    await page.getByTestId("create-route-plan").click();
    await expect(page.getByTestId("route-mode-list")).toBeVisible();
    assert.equal(body.ids.length,scheduled.length,"Scope includes Scheduled rows across ALL pages");
    assert.deepEqual(body.origin,{lat:40,lng:-105});
    await expect(page.getByTestId(`route-stop-${body.ids[0]}`)).toContainText("Priority 0");
    await expect.poll(()=>page.frames().filter(f=>f.url()==="about:srcdoc").length).toBe(1);
    const mapFrame=page.frames().find(f=>f.url()==="about:srcdoc");
    await expect.poll(()=>mapFrame.evaluate(()=>window.__routeMap?.markers.length)).toBe(scheduled.length);
    assert.equal(await mapFrame.evaluate(()=>window.__routeMap.paths[0].length),scheduled.length+1);
    await page.screenshot({path:`${out}/desktop.jpg`,fullPage:true});
    await page.getByTestId("route-next-stop").click();
    await page.reload();
    await expect(page.getByTestId("navigate-next-stop")).toBeVisible();
    await expect(page.getByText(`Stop 2 of ${scheduled.length}`,{exact:true})).toBeVisible();
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
    assert.ok(handoff.includes("api=1")&&!handoff.includes("waypoints"));
    // A failed external navigation may leave an error page: refresh original route.
    await page.goto(`/projects/${fixture.projectId}/work-orders`);
    await expect(page.getByTestId("navigate-next-stop")).toBeVisible();
    stale=true;
    await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("alert").filter({hasText:"needs review"})).toBeVisible();
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
    await expect(page.getByRole("dialog").first()).toContainText("10 candidates across all grid pages");
    await page.getByTestId("create-route-plan").click();
    await expect(page.getByTestId("route-mode-list")).toBeVisible();
    assert.equal(body.ids.length,10,"Filtered scope never expands to all project work orders");
    await page.getByRole("button",{name:"End route",exact:true}).click();
    await page.getByRole("button",{name:"Back to work orders",exact:true}).last().click();
    const checkbox=page.getByRole("checkbox",{name:/Select work order ROUTE-PAGING/}).first();
    const selectedId=Number((await checkbox.getAttribute("data-testid")).replace("checkbox-select-",""));
    await checkbox.check();
    await page.getByTestId("optimize-work-order-route").click();
    await page.getByRole("radio",{name:/Selected orders/}).check();
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
    assert.deepEqual(errors,[]);
    console.log("Routing desktop/phone UI: unconfigured setup, role grants, all-page/filter/selected scopes, map geometry/markers, detail return, refresh recovery, Google and iPhone-UA Apple HTTPS handoff, stale/access cleanup passed.");
    console.log(fs.existsSync(webkit.executablePath())?"WebKit executable available for additional checks.":"WebKit executable unavailable; physical iOS/Safari native handoff is not verified.");
  }finally{await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
