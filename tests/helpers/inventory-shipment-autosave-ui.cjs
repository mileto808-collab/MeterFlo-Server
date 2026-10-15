const assert = require("node:assert/strict");

// Called by inventory-shipment-drafts-ui.cjs against its disposable fixture.
module.exports = async function autosaveAcceptance({ browser, baseURL, base, fixture, admin, order, state, post }) {
  const contexts = [];
  const login = async () => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 950 } });
    contexts.push(context);
    assert.equal((await context.request.post("/api/auth/local/login", {
      data: { username: fixture.username, password: fixture.password },
    })).status(), 200);
    return context;
  };
  const open = async context => {
    const page = await context.newPage(); page.setDefaultNavigationTimeout(60000);
    await page.goto(`/projects/${fixture.projectId}/inventory`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: "Orders", exact: true }).click();
    return page;
  };
  const guide = page => page.getByRole("dialog", { name: /^Receive purchase/ });
  const resume = async page => page.locator("div.rounded-md.border.p-3").filter({ hasText: "AUTO-PO" })
    .getByRole("button", { name: "Resume", exact: true }).click();
  const scans = async page => {
    await guide(page).getByRole("button", { name: "Scan / edit serials for Resume meter", exact: true }).click();
    const child = page.getByRole("dialog", { name: "Scan serials for Resume meter", exact: true });
    return { child, scanner: child.getByRole("textbox", { name: "Good serial scanner for Resume meter", exact: true }) };
  };
  const saved = page => page.getByTestId("shipment-checkpoint-status").getByText("Saved — latest capture confirmed on server.", { exact: true }).waitFor();
  const waitCapture = async (page, text, serialCount) => page.waitForFunction(async ({ base, text, serialCount }) => {
    const s = (await (await fetch(base)).json()).state;
    const d = s.shipmentDrafts.find(d => d.orderId === "AUTO-PO");
    return d && d.capture.scanBuffers["meter-goodSerials"] === text && d.capture.entries.meter.goodSerials.length === serialCount;
  }, { base, text, serialCount });
  const done = child => child.getByRole("button", { name: "Done", exact: true }).click();
  try {
    await order("AUTO-PO", "purchase", 5);
    let context = await login(), page = await open(context);
    const requests = [];
    let releaseFirst, capturedFirst;
    const firstCaptured = new Promise(resolve => { capturedFirst = resolve; });
    const gate = new Promise(resolve => { releaseFirst = resolve; });
    const gateSave = async route => {
      const body = route.request().postDataJSON();
      if (body.action !== "shipmentDraftSave") return route.continue();
      requests.push(body);
      if (requests.length === 1) { capturedFirst(); await gate; }
      await route.continue();
    };
    await page.route(`**${base}/commands`, gateSave);
    await page.locator("div.rounded-lg.border.p-4").filter({ hasText: "AUTO-PO" })
      .getByRole("button", { name: "Receive", exact: true }).click();
    await guide(page).locator("#meter-goodQuantity").fill("5");
    let { child, scanner } = await scans(page);
    await scanner.pressSequentially("00001", { delay: 5 }); await scanner.press("Enter");
    await scanner.pressSequentially("00002", { delay: 5 }); await scanner.press("Tab");
    await scanner.fill(" 0000 ");
    await firstCaptured;
    await page.getByTestId("shipment-checkpoint-status").getByText("Saving…", { exact: true }).waitFor();
    assert.equal(await scanner.isEnabled(), true, "scanning stays enabled during an automatic save");
    await scanner.fill("00003"); await scanner.press("Enter"); await scanner.fill("0000 unfinished ");
    await page.waitForTimeout(1000);
    assert.equal(requests.length, 1, "new edits must not start a concurrent write");
    releaseFirst();
    await waitCapture(page, "0000 unfinished ", 3); await saved(page);
    assert.equal(requests.length, 2, "newer edits coalesce into the next checkpoint");
    assert.equal(requests[1].data.revision, 1);
    assert.deepEqual(requests[1].data.capture.entries.meter.goodSerials, ["00001", "00002", "00003"]);
    assert.equal((await state()).receipts.length, 0);
    assert.equal((await state()).stock.length, 0);
    const beforeStream = requests.length, streamStarted = Date.now();
    while (Date.now() - streamStarted < 6200) {
      await scanner.fill(`STREAM-${Date.now() - streamStarted}`);
      await page.waitForTimeout(120);
    }
    assert.ok(requests.length > beforeStream, "continuous input must checkpoint without an idle gap");
    await scanner.fill("0000 unfinished ");
    await waitCapture(page, "0000 unfinished ", 3); await saved(page);
    await context.close();

    // A fresh browser context has no capture in memory or local storage.
    context = await login(); page = await open(context); await resume(page);
    ({ child, scanner } = await scans(page));
    assert.equal(await scanner.inputValue(), "0000 unfinished ");
    const baseline = (await state()).shipmentDrafts.find(d => d.orderId === "AUTO-PO");
    const failures = [];
    const offline = async route => {
      const body = route.request().postDataJSON();
      if (body.action === "shipmentDraftSave") { failures.push(body); return route.abort("internetdisconnected"); }
      return route.continue();
    };
    await page.route(`**${base}/commands`, offline);
    await page.route(`**${base}`, route => route.abort("internetdisconnected"));
    await scanner.fill("OFFLINE-0000 ");
    await page.getByTestId("shipment-checkpoint-status").getByText(/Not saved — automatic saving paused/).waitFor();
    await scanner.fill("OFFLINE-0000 newer ");
    await page.waitForTimeout(1800);
    assert.equal(failures.length, 1, "offline failure pauses rather than repeatedly saving");
    assert.equal(await scanner.inputValue(), "OFFLINE-0000 newer ");
    assert.deepEqual((await state()).shipmentDrafts.find(d => d.id === baseline.id), baseline);
    await page.unroute(`**${base}/commands`, offline);
    await page.unroute(`**${base}`);
    const retries = [];
    const observe = async route => { retries.push(route.request().postDataJSON()); await route.continue(); };
    await page.route(`**${base}/commands`, observe);
    await done(child);
    await guide(page).getByRole("button", { name: "Save draft", exact: true }).click();
    await saved(page);
    assert.deepEqual(retries[0], failures[0], "manual reconnect retries the exact unknown save first");
    assert.equal(retries.length, 2);
    await page.unroute(`**${base}/commands`, observe);

    // A committed automatic checkpoint with a lost response is read-confirmed.
    let lostCount = 0;
    const lose = async route => {
      if (route.request().postDataJSON().action !== "shipmentDraftSave") return route.continue();
      lostCount++; assert.equal((await route.fetch()).status(), 200); await route.abort("failed");
    };
    await page.route(`**${base}/commands`, lose);
    ({ child, scanner } = await scans(page)); await scanner.fill("0000009 raw ");
    await waitCapture(page, "0000009 raw ", 3); await saved(page);
    assert.equal(lostCount, 1);
    await page.unroute(`**${base}/commands`, lose); await done(child);
    await guide(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await resume(page);

    // A second real tab updates the same owner/revision; stale local capture stays.
    const second = await open(context); await resume(second);
    await guide(second).getByLabel("Movement note / exception reason", { exact: true }).fill("Other tab inspection");
    await saved(second);
    const remote = (await state()).shipmentDrafts.find(d => d.id === baseline.id);
    ({ child, scanner } = await scans(page)); await scanner.fill("LOCAL-0000 ");
    await page.getByTestId("shipment-checkpoint-status").getByText(/Not saved — automatic saving paused/).waitFor();
    assert.equal(await scanner.inputValue(), "LOCAL-0000 ");
    assert.deepEqual((await state()).shipmentDrafts.find(d => d.id === baseline.id), remote);
    await done(child);
    await guide(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await guide(page).getByRole("button", { name: "Discard", exact: true }).click();
    await post("shipmentDraftDelete", { id: remote.id, revision: remote.revision }, admin);
    await context.close();

    // Explicit discard pauses the debounce and cancels queued, unstarted saves.
    await order("AUTO-DISCARD", "purchase", 2);
    context = await login(); page = await open(context);
    await page.locator("div.rounded-lg.border.p-4").filter({ hasText: "AUTO-DISCARD" })
      .getByRole("button", { name: "Receive", exact: true }).click();
    await guide(page).locator("#meter-goodQuantity").fill("1");
    await guide(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await guide(page).getByText("Discard movement edits?", { exact: true }).waitFor();
    await page.waitForTimeout(1200);
    assert.ok(!(await state()).shipmentDrafts.some(d => d.orderId === "AUTO-DISCARD"));
    await guide(page).getByRole("button", { name: "Discard", exact: true }).click();
    await page.waitForTimeout(1000);
    assert.ok(!(await state()).shipmentDrafts.some(d => d.orderId === "AUTO-DISCARD"));
    console.log("Automatic checkpoints passed: rapid/continuous HID, serial write queue, in-flight edits, fresh-context resume, offline retention/retry, lost replies, concurrent tabs and explicit discard.");
  } finally { await Promise.all(contexts.map(context => context.close().catch(() => {}))); }
};
