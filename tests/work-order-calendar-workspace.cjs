// Real calendar/UI components in an isolated browser fixture; no application
// authentication or project data is changed.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { build } = require("esbuild");
const { chromium } = require("@playwright/test");

(async () => {
  const output = "generated-artifacts/work-order-calendar";
  await fs.mkdir(output, { recursive: true });
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), sourcefile: "calendar-fixture.tsx", loader: "tsx",
      contents: `
        import React, {useState} from "react";
        import {createRoot} from "react-dom/client";
        import {WorkOrderCalendar} from "./client/src/components/work-order-calendar";
        const times = ["2026-10-22T09:30:00Z", "2026-10-21T17:00:00Z",
          "2026-10-21T22:00:00Z", "2026-10-21T18:00:00Z", "2026-10-21T20:00:00Z"];
        const orders = times.map((scheduledAt,i)=>({id:i+1,customerWoId:i===4?"":"CUSTOMER-"+(i+1),
          address:(i+1)+" Appointment Street",customerName:"Customer "+(i+1),scheduledAt,
          status:"Open",serviceType:"Electric"}));
        orders.push({id:6,customerWoId:"NEXT-DAY",scheduledAt:"2026-10-22T10:30:00Z",status:"Open"});
        const unscheduled = {id:99,customerWoId:"TO-SCHEDULE",status:"Open",address:"99 New Street"};
        if(location.search.includes("dense")) for(let i=10;i<50;i++)
          orders.push({...orders[1],id:i,customerWoId:"DENSE-"+i});
        function Fixture(){
          const [result,setResult]=useState("");
          return <><WorkOrderCalendar workOrders={[...orders,unscheduled]}
            statuses={[{code:"Open",label:"Open",color:"blue"}]} serviceTypes={[]}
            projectId={1} projectTimezone="Pacific/Honolulu"
            initialWorkOrderForScheduling={location.search.includes("schedule")?unscheduled:null}
            onWorkOrderClick={wo=>setResult("details:"+wo.id)}
            onReschedule={async(id,date)=>setResult("scheduled:"+id+":"+date)}/>
            <output data-testid="result">{result}</output></>;
        }
        createRoot(document.getElementById("root")).render(<Fixture/>);
      `,
    },
    bundle: true, write: false, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const assets = await fs.readdir("dist/public/assets");
  const css = await fs.readFile(path.join("dist/public/assets", assets.find(name => /^index-.*\.css$/.test(name))));
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : req.url === "/style.css" ? "text/css" : "text/html");
    res.end(req.url === "/bundle.js" ? bundle.outputFiles[0].contents : req.url === "/style.css" ? css
      : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, timezoneId: "America/New_York" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-20T16:00:00Z") });
    const day = () => page.getByTestId("calendar-day-2026-10-21");
    const dialog = () => page.getByRole("dialog");
    const close = async () => { await dialog().getByRole("button", { name: "Close", exact: true }).click(); await dialog().waitFor({ state: "hidden" }); };
    const openDay = async () => { await day().click({ position: { x: 3, y: 3 } }); await dialog().waitFor(); };
    await page.goto(base);
    await day().waitFor();
    assert.equal(await day().getByTestId("calendar-wo-4").count(), 0, "overflow fixture must be hidden in month");
    await openDay();
    assert.match(await dialog().innerText(), /5 appointments · Pacific\/Honolulu/);
    assert.deepEqual(await dialog().locator('[data-testid^="calendar-wo-"]').evaluateAll(nodes => nodes.map(n => n.dataset.testid)),
      [2, 4, 5, 3, 1].map(id => `calendar-wo-${id}`));
    assert.match(await dialog().getByTestId("calendar-wo-1").innerText(), /11:30 PM/);
    assert.match(await dialog().getByTestId("calendar-wo-5").innerText(), /WO 5/);
    assert.equal(await dialog().getByTestId("calendar-wo-6").count(), 0, "project-local next day excluded");
    await page.screenshot({ path: `${output}/desktop.jpg` });
    await close();
    await day().getByRole("button", { name: /View all 5 appointments/ }).click();
    await dialog().waitFor();
    await dialog().getByTestId("calendar-wo-4").click();
    await page.getByTestId("wo-action-details-4").click();
    await dialog().waitFor({ state: "hidden" });
    await page.getByTestId("result").filter({ hasText: "details:4" }).waitFor();
    await openDay();
    await dialog().getByTestId("calendar-wo-4").click();
    await page.getByTestId("wo-action-schedule-4").click();
    await page.getByTestId("confirm-reschedule").waitFor();
    assert.match(await dialog().innerText(), /Reschedule Work Order/);
    assert.equal(await dialog().count(), 1, "day list closes before reschedule");
    await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
    await dialog().waitFor({ state: "hidden" });
    await day().getByRole("button", { name: /^Wednesday, October 21/ }).focus();
    await page.keyboard.press("Enter");
    await dialog().waitFor();
    await close();
    await day().getByRole("button", { name: /^Wednesday, October 21/ }).focus();
    await page.keyboard.press("Space");
    await dialog().waitFor();
    await close();
    await page.getByTestId("calendar-day-2026-10-20").click({ position: { x: 3, y: 3 } });
    assert.match(await dialog().innerText(), /No appointments scheduled/);
    await close();
    await page.goto(`${base}/?schedule`);
    await openDay();
    assert.match(await dialog().innerText(), /Schedule Work Order/);
    assert.equal(await dialog().getByText(/5 appointments/).count(), 0);
    await page.getByTestId("confirm-reschedule").click();
    await page.getByTestId("result").filter({ hasText: "scheduled:99:2026-10-21T19:00" }).waitFor();
    await page.goto(`${base}/?schedule`);
    await day().getByRole("button", { name: /Schedule all 5 appointments/ }).click();
    await page.getByTestId("confirm-reschedule").waitFor();
    assert.match(await dialog().innerText(), /Schedule Work Order/);
    await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
    // A large day's contents must scroll within the modal in every orientation.
    for (const [name, width, height] of [["phone",390,844],["landscape",844,390],["tablet",1024,768]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}/?dense`);
      await openDay();
      assert.match(await dialog().innerText(), /45 appointments/);
      const bounds = await dialog().boundingBox();
      assert(bounds.x >= -1 && bounds.x + bounds.width <= width + 1, `${name}: dialog width`);
      assert(bounds.y >= -1 && bounds.y + bounds.height <= height + 1, `${name}: dialog height`);
      const viewport = dialog().getByTestId("calendar-day-appointments-list");
      const scroll = await viewport.evaluate(node => {
        const before = node.scrollTop;
        node.scrollTop = node.scrollHeight;
        return { height: node.clientHeight, content: node.scrollHeight, moved: node.scrollTop > before };
      });
      assert(scroll.content > scroll.height && scroll.moved, `${name}: appointments must actually scroll`);
      await page.screenshot({ path: `${output}/${name}.jpg` });
    }
    assert.deepEqual(errors, []);
    console.log("Calendar day browsing, overflow, keyboard, timezone, details/reschedule, scheduling and responsive scrolling passed.");
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
