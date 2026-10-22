const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const admin = await browser.newContext({ baseURL }), tech = await browser.newContext({ baseURL });
  const inventory = `/api/projects/${fixture.projectId}/inventory`;
  const request = async (context, method, path, data) => {
    const response = await context.request.fetch(path, { method, data });
    assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const command = (action, data) => request(admin, "POST", `${inventory}/commands`,
    { action, data, operationId: crypto.randomUUID() });
  const snapshot = async () => (await request(admin, "GET", inventory)).state;
  const adminPage = async () => {
    const context = await browser.newContext({ baseURL });
    await request(context, "POST", "/api/auth/local/login", fixture);
    const page = await context.newPage();
    await page.goto(`${baseURL}/projects/${fixture.projectId}/inventory`);
    await expect(page.getByTestId("button-start-inventory-desktop")).toBeVisible();
    return page;
  };
  const scan = async (page, url) => {
    const heading = page.getByRole("heading", { name: "Fulfill / Stage Work Orders", exact: true });
    if (await heading.isVisible()) await heading.click();
    else await page.getByRole("heading", { name: "Inventory", exact: true }).click();
    await page.keyboard.type(url, { delay: 1 });
    await page.keyboard.press("Enter");
  };
  try {
    await request(admin, "POST", "/api/auth/local/login", fixture);
    const role = await request(admin, "POST", "/api/subroles", { key: `ticket_${crypto.randomUUID().slice(0, 8)}`,
      label: "Pick ticket technician", baseRole: "user", permissions: ["nav.projects", "workOrders.view", "inventory.view", "inventory.assign"] });
    const credentials = { username: `ticket-${crypto.randomUUID().slice(0, 8)}`, password: `Aa1!${crypto.randomUUID()}` };
    const installer = await request(admin, "POST", "/api/users", { ...credentials, firstName: "Ticket", lastName: "Technician",
      role: "user", subroleId: role.id, projectIds: [fixture.projectId] });
    await request(tech, "POST", "/api/auth/local/login", credentials);
    for (const id of ["scan-source", "scan-stage", "scan-vehicle"]) await command("warehouse", {
      id, name: id, code: id, type: id === "scan-vehicle" ? "vehicle" : "physical", address: "Owned fixture",
      ...(id === "scan-stage" ? { locationTypeId: "57e15eca-f991-4328-a091-000000000003" } : {}),
      ...(id === "scan-vehicle" ? { vin: "1HGCM82633A004351", plate: "TICKET", plateState: "CO", userIds: [installer.id] } : {}) });
    await command("item", { id: "scan-meter", sku: "SCAN-METER", name: "Scan ticket meter", tracking: "serialized" });
    await command("vendor", { id: "scan-vendor", name: "Scan vendor" });
    await command("order", { id: "scan-po", type: "purchase", vendorId: "scan-vendor", destinationId: "scan-source",
      lines: [{ itemId: "scan-meter", quantity: 4 }] });
    await command("release", { orderId: "scan-po" });
    await command("receive", { orderId: "scan-po", lines: [{ itemId: "scan-meter", quantity: 4, serials: ["QR-001", "QR-002", "QR-003", "QR-004"] }] });
    const services = await request(admin, "GET", "/api/service-types");
    const batches = [];
    for (const label of ["Awaiting crew pickup", "Still needs pulling"]) {
      const work = await request(admin, "POST", `/api/projects/${fixture.projectId}/work-orders`, {
        customerWoId: `TICKET-${batches.length}`, customerName: label, serviceType: services[0].code,
        status: "Scheduled", assignedUserId: installer.id, scheduledAt: new Date(Date.now() + 86400000).toISOString() });
      await command("plan", { workOrderId: work.id, revision: 0,
        lines: [{ id: crypto.randomUUID(), itemId: "scan-meter", kind: "addition", quantity: 2, reason: "Owned scan test meters" }] });
      const candidate = (await request(admin, "GET", `${inventory}/fulfillment`)).orders.find(row => row.workOrderId === work.id);
      const id = crypto.randomUUID();
      await command("fulfillmentCreate", { id, name: label, mode: "scheduled", sourceId: "scan-source", stagingId: "scan-stage",
        vehicleId: "scan-vehicle", workOrders: [{ workOrderId: work.id, assignmentVersion: candidate.assignmentVersion }] });
      batches.push(id);
    }
    const [batchA, batchB] = batches;
    await command("fulfillmentMove", { id: batchA, revision: 1, phase: "stage", physicallyConfirmed: true,
      reason: "Verified actual meters placed at staging for the crew.", lines: [{ itemId: "scan-meter", quantity: 2, serials: ["QR-001", "QR-002"] }] });
    const ticketUrl = id => `${baseURL}/projects/${fixture.projectId}/work-orders?pickup=${id}`;
    const selectionGroup = await request(admin, "POST", "/api/user-groups", {
      name: `Selection crew ${crypto.randomUUID().slice(0, 8)}`, projectIds: [fixture.projectId],
    });
    for (const scheduled of [false, true]) {
      const work = await request(admin, "POST", `/api/projects/${fixture.projectId}/work-orders`, {
        customerWoId: scheduled ? "SELECT-SCHEDULED" : "SELECT-CREW", customerName: "Selection fixture",
        serviceType: services[0].code, status: scheduled ? "Scheduled" : "Open",
        ...(scheduled ? { assignedUserId: installer.id, scheduledAt: new Date(Date.now() + 86400000).toISOString() }
          : { assignedGroupId: selectionGroup.name }),
      });
      await command("plan", { workOrderId: work.id, revision: 0,
        lines: [{ id: crypto.randomUUID(), itemId: "scan-meter", kind: "addition", quantity: 1, reason: "Selection coverage" }] });
    }
    const before = await snapshot();
    assert.equal((await request(admin, "GET", `${inventory}/fulfillment/${batchA}/ticket`)).resume.nextStep, "vehicle");
    assert.equal((await request(admin, "GET", `${inventory}/fulfillment/${batchB}/ticket`)).resume.nextStep, "stage");
    assert.equal((await tech.request.get(`${inventory}/fulfillment/${batchA}/ticket`)).status(), 403);
    assert.equal((await admin.request.get(`${inventory}/fulfillment/${crypto.randomUUID()}/ticket`)).status(), 404);
    const checkUrl = `${inventory}/fulfillment/${batchB}/check-serials`;
    const checkBody = { phase: "stage", lines: [{ itemId: "scan-meter", serials: ["QR-001", "QR-003", "UNKNOWN"] }] };
    assert.equal((await tech.request.post(checkUrl, { data: checkBody })).status(), 403);
    const checked = await request(admin, "POST", checkUrl, checkBody);
    assert.deepEqual(checked.problems.map(problem => problem.serial), ["QR-001", "UNKNOWN"]);
    assert.equal((await snapshot()).revision, before.revision, "Scan checks must not move or reserve stock");
    // Real entry: the wizard is still closed and a previously saved batch must load first.
    const coldPage = await adminPage();
    await coldPage.getByTestId("button-start-inventory-desktop").click();
    await coldPage.getByTestId("inventory-task-fulfillment").click();
    for (const [mode, label] of [["New crew batch", "SELECT-CREW"], ["Scheduled installer work", "SELECT-SCHEDULED"]]) {
      await coldPage.getByRole("button", { name: new RegExp(`^${mode}`) }).click();
      await expect(coldPage.getByText("Show unavailable work orders", { exact: true })).toHaveCount(0);
      const list = coldPage.getByTestId("fulfillment-work-orders-list");
      await expect(list).not.toHaveAttribute("open");
      const bulk = coldPage.getByRole("checkbox", { name: "Select all eligible matching orders", exact: true });
      await bulk.check();
      await expect(coldPage.getByTestId("fulfillment-selection-summary")).toContainText("Selected 1 / Eligible matching 1");
      await list.locator("summary").click();
      const order = list.locator("label").filter({ hasText: label }).getByRole("checkbox");
      await expect(order).toBeChecked();
      await order.uncheck();
      await expect(bulk).not.toBeChecked();
      if (mode === "New crew batch") {
        await list.locator("summary").click();
        await coldPage.screenshot({ path: "generated-artifacts/inventory-pick-ticket/collapsed-work-orders.png" });
      }
      await coldPage.getByTestId("fulfillment-back-to-workflows").click();
      await expect(coldPage.getByRole("heading", { name: "Choose a fulfillment workflow", exact: true })).toBeVisible();
    }
    await coldPage.getByRole("button", { name: "Close", exact: true }).click();
    const actor = await request(admin, "GET", "/api/auth/user");
    const draftKey = `meterflo:fulfillment:${encodeURIComponent(actor.id)}:${fixture.projectId}`;
    await coldPage.evaluate(({ key, batchId }) => localStorage.setItem(key,
      JSON.stringify({ mode: "resume", step: "stage", batchId, name: "Still needs pulling" })),
    { key: draftKey, batchId: batchB });
    await coldPage.setViewportSize({ width: 390, height: 844 });
    await coldPage.keyboard.type(ticketUrl(batchB), { delay: 1 });
    await coldPage.keyboard.press("Enter");
    await expect(coldPage.getByTestId("fulfillment-move-quantity-stage-scan-meter")).toBeVisible();
    const identity = coldPage.getByTestId("fulfillment-batch-identity");
    const numberB = `PICK-${before.fulfillmentBatches[1].createdAt.slice(0, 4)}-000002`;
    await expect(identity).toHaveText(`Still needs pulling - ${numberB}`);
    await expect(identity).toBeFocused();
    await expect(identity).toBeInViewport();
    const printedTicket = await admin.request.get(`${inventory}/fulfillment/${batchB}/pick-ticket`);
    assert.equal(printedTicket.status(), 200);
    assert.ok((await printedTicket.text()).includes(numberB), "Heading matches the printed pick-ticket number.");
    // A repeated scan must realign even when batch/step have not changed.
    await coldPage.getByTestId("fulfillment-step-body").evaluate(body => { body.scrollTop = body.scrollHeight; });
    await coldPage.keyboard.type(ticketUrl(batchB), { delay: 1 });
    await coldPage.keyboard.press("Enter");
    await expect(identity).toBeInViewport();
    await expect.poll(() => coldPage.getByTestId("fulfillment-step-body").evaluate(body => body.scrollTop)).toBe(0);
    await coldPage.screenshot({ path: "generated-artifacts/inventory-pick-ticket/scan-arrival-phone.png" });
    // Scan from Start Inventory's task chooser without clicking Fulfill / Stage.
    await coldPage.getByRole("button", { name: "Save & leave", exact: true }).click();
    await coldPage.getByRole("button", { name: "Start Inventory", exact: true }).filter({ visible: true }).click();
    await expect(coldPage.getByRole("heading", { name: "Choose an inventory task", exact: true })).toBeVisible();
    await coldPage.keyboard.type(ticketUrl(batchB), { delay: 1 });
    await coldPage.keyboard.press("Tab");
    await expect(identity).toBeFocused();
    await expect(identity).toBeInViewport();
    await expect(coldPage.getByTestId("fulfillment-move-quantity-stage-scan-meter")).toBeVisible();
    await expect(coldPage.getByRole("dialog")).toHaveCount(0);
    await expect(coldPage.getByTestId("inventory-fulfillment-page")).toBeVisible();
    // Ineligible and duplicate scans must never remain in the accepted list or count.
    const coldQuantity = coldPage.getByTestId("fulfillment-move-quantity-stage-scan-meter");
    const coldSerials = coldPage.getByTestId("fulfillment-custody-serials-stage-scan-meter");
    const coldProgress = coldPage.getByTestId("fulfillment-scan-progress-stage-scan-meter");
    await coldQuantity.fill("1");
    await coldSerials.fill("QR-001");
    await coldSerials.press("Enter");
    await expect(coldSerials).toHaveValue("");
    await expect(coldProgress).toContainText("Scanned 0");
    await expect(coldPage.getByText(/Rejected QR-001: Not available for this item/)).toBeVisible();
    await expect(coldPage.getByRole("button", { name: "Record physical pull", exact: true })).toBeDisabled();
    await coldSerials.scrollIntoViewIfNeeded();
    await coldPage.screenshot({ path: "generated-artifacts/inventory-pick-ticket/invalid-scan-phone.png" });
    await coldSerials.fill("QR-003");
    await coldSerials.press("Tab");
    await expect(coldProgress).toContainText("serials verified against current stock");
    await expect(coldProgress.locator('[data-testid="serial-scan-progress"]')).toHaveClass(/border-green/);
    assert.equal((await snapshot()).revision, before.revision, "Scanning alone leaves stock unchanged");
    // Failed/unverified checks must never reuse a previous green result.
    let releaseCheck;
    const checkWait = new Promise(resolve => { releaseCheck = resolve; });
    const checkPattern = "**/fulfillment/*/check-serials";
    await coldPage.route(checkPattern, async route => {
      await checkWait;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Fixture unavailable" }) });
    });
    await coldSerials.fill("QR-004");
    await coldSerials.press("Enter");
    await expect(coldProgress).toContainText("Checking serials");
    await expect(coldProgress.locator('[data-testid="serial-scan-progress"]')).not.toHaveClass(/border-green/);
    releaseCheck();
    await expect(coldProgress).toContainText("Stock verification failed");
    await expect(coldSerials).toHaveValue(/QR-004/);
    await expect(coldPage.getByRole("button", { name: "Record physical pull", exact: true })).toBeDisabled();
    await coldPage.unroute(checkPattern);
    await coldPage.getByRole("button", { name: "Retry stock verification", exact: true }).click();
    await expect(coldProgress).toContainText("serials verified against current stock");
    await coldQuantity.fill("2");
    await coldSerials.fill("");
    await coldSerials.evaluate(element => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "QR-001\nQR-003\nQR-003\nUNKNOWN\nQR-004");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    });
    await expect(coldSerials).toHaveValue("QR-003\nQR-004\n");
    await expect(coldProgress).toContainText("Scanned 2");
    await expect(coldProgress).toContainText("serials verified against current stock");
    // Authoritative checks remove newly unavailable scans even if the local snapshot was older.
    await coldSerials.fill("QR-003");
    await coldSerials.press("Enter");
    await expect(coldProgress).toContainText("Scanned 1");
    await coldPage.route(checkPattern, async route => {
      const body = route.request().postDataJSON();
      if (body.lines.some(line => line.serials.includes("QR-004"))) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          problems: [{ itemId: "scan-meter", serial: "QR-004", reason: "Reserved for other work or held by another batch." }],
          revision: before.revision,
        }) });
      } else await route.continue();
    });
    await coldSerials.fill("QR-003\nQR-004");
    await coldSerials.press("Enter");
    await expect(coldSerials).toHaveValue("QR-003\n");
    await expect(coldPage.getByText(/Rejected QR-004: Reserved for other work/)).toBeVisible();
    await expect(coldProgress).toContainText("Scanned 1");
    await coldPage.unroute(checkPattern);
    // Avoid leaving new fixture captures for the following ticket-switch scenarios.
    await coldSerials.fill("");
    await coldQuantity.fill("");
    await coldPage.close();
    const page = await adminPage();
    await scan(page, ticketUrl(batchA));
    await expect(page.getByTestId("fulfillment-move-quantity-vehicle-scan-meter")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("inventory-fulfillment-page")).toBeVisible();
    await page.getByTestId("fulfillment-move-quantity-vehicle-scan-meter").fill("1");
    const serials = page.getByTestId("fulfillment-custody-serials-vehicle-scan-meter");
    await serials.fill("QR-001");
    await serials.press("Enter");
    await expect(serials).toHaveValue(/QR-001/);
    await page.getByTestId("fulfillment-move-quantity-vehicle-scan-meter").fill("2");
    await serials.fill("");
    await serials.evaluate(element => {
      const clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", "QR-001\nQR-003\nQR-001\nQR-002");
      element.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
    });
    await expect(serials).toHaveValue("QR-001\nQR-002\n");
    await expect(page.getByText(/Rejected QR-003: Not in this batch/)).toBeVisible();
    await page.getByTestId("fulfillment-move-quantity-vehicle-scan-meter").fill("1");
    await serials.fill("QR-001");
    await serials.press("Enter");
    await expect(page.getByTestId("fulfillment-scan-progress-vehicle-scan-meter")).toContainText("serials verified against current stock");
    await scan(page, ticketUrl(batchB));
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: /Cancel|Keep/ }).first().click();
    await expect(page.getByRole("alertdialog")).toBeHidden();
    await expect(serials).toHaveValue(/QR-001/);
    await scan(page, ticketUrl(batchB));
    await page.getByRole("alertdialog").getByRole("button", { name: /Open|Replace|Continue|Start/ }).last().click();
    await expect(page.getByTestId("fulfillment-move-quantity-stage-scan-meter")).toBeVisible();
    assert.equal((await snapshot()).revision, before.revision, "Opening/scanning never posts inventory.");
    await page.close();

    const techPage = await tech.newPage();
    await techPage.goto(`${baseURL}/projects/${fixture.projectId}/work-orders?pickup=${batchA}`);
    const qrImage = techPage.getByTestId("pickup-ticket-qr").locator("img");
    await expect(qrImage).toBeVisible();
    const qrData = await qrImage.getAttribute("src");
    assert.ok(qrData?.startsWith("data:image/png;base64,"));
    await techPage.setViewportSize({ width: 390, height: 844 });
    await fs.mkdir("generated-artifacts/inventory-pick-ticket", { recursive: true });
    await techPage.screenshot({ path: "generated-artifacts/inventory-pick-ticket/tech-qr-phone.png" });
    await techPage.close();

    const cameraContext = await browser.newContext({ baseURL });
    await request(cameraContext, "POST", "/api/auth/local/login", fixture);
    // Exercise the real html5-qrcode decoder against the technician's actual QR image.
    await cameraContext.addInitScript(({ data }) => {
      const devices = navigator.mediaDevices;
      devices.getUserMedia = async () => {
        const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
        const ctx = canvas.getContext("2d"), image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = data; });
        const draw = () => { ctx.fillStyle = "white"; ctx.fillRect(0, 0, 640, 480); ctx.drawImage(image, 220, 140, 200, 200); };
        draw(); const timer = setInterval(draw, 60), stream = canvas.captureStream(15);
        stream.getTracks().forEach(track => track.addEventListener("ended", () => clearInterval(timer)));
        return stream;
      };
      devices.enumerateDevices = async () => [{ kind: "videoinput", deviceId: "fixture-camera", label: "Owned QR camera", groupId: "fixture" }];
    }, { data: qrData });
    const cameraPage = await cameraContext.newPage();
    await cameraPage.goto(`${baseURL}/projects/${fixture.projectId}/inventory`);
    await cameraPage.getByTestId("button-start-inventory-desktop").click();
    await cameraPage.getByTestId("inventory-task-fulfillment").click();
    await expect(cameraPage.getByTestId("inventory-pick-ticket-paste")).toHaveCount(0);
    await expect(cameraPage.getByTestId("fulfillment-open-corrections-chooser")).toBeVisible();
    assert.ok(await cameraPage.getByRole("heading", { name: "Choose a fulfillment workflow", exact: true }).evaluate(heading =>
      heading.parentElement.nextElementSibling?.querySelector('[data-wizard-entry]') !== null),
    "Workflow cards immediately follow the workflow heading.");
    await cameraPage.screenshot({ path: "generated-artifacts/inventory-pick-ticket/chooser-desktop.png" });
    await cameraPage.setViewportSize({ width: 390, height: 844 });
    await cameraPage.screenshot({ path: "generated-artifacts/inventory-pick-ticket/chooser-phone.png" });
    await cameraPage.setViewportSize({ width: 1280, height: 720 });
    await cameraPage.getByRole("button", { name: "Scan Pick Ticket QR Code", exact: true }).click();
    await expect(cameraPage.getByRole("dialog", { name: "Scan or open a pick ticket" })).toBeVisible();
    await cameraPage.getByTestId("inventory-pick-ticket-paste").fill("not a ticket");
    await cameraPage.getByTestId("inventory-pick-ticket-open").click();
    await expect(cameraPage.getByRole("dialog").getByRole("alert")).toBeVisible();
    await cameraPage.getByTestId("inventory-pick-ticket-paste").fill("");
    await cameraPage.getByTestId("inventory-pick-ticket-scanner-mode-trigger").click();
    await cameraPage.getByTestId("inventory-pick-ticket-scanner-mode-qrcode").click();
    // Use the existing QR camera from the ticket modal; accepting the result opens the batch.
    const accept = cameraPage.locator('[data-testid$="-accept-scan"]').last();
    await expect(accept).toBeVisible({ timeout: 25000 });
    await accept.click();
    await expect(cameraPage.getByTestId("fulfillment-move-quantity-vehicle-scan-meter")).toBeVisible({ timeout: 25000 });
    await expect(cameraPage.getByRole("dialog")).toHaveCount(0);
    assert.equal((await snapshot()).revision, before.revision);
    await cameraContext.close();

    const acting = await request(admin, "GET", "/api/auth/user");
    const pendingPage = await adminPage(), unknownId = crypto.randomUUID();
    const correctionKey = `meterflo:staging-corrections:${encodeURIComponent(acting.id)}:${fixture.projectId}`;
    await pendingPage.evaluate(({ key, operationId, id }) => localStorage.setItem(key,
      JSON.stringify({ edited: true, batchId: id, pending: { operationId, action: "fulfillmentCorrect", data: {} } })),
    { key: correctionKey, operationId: unknownId, id: batchA });
    await scan(pendingPage, ticketUrl(batchB));
    await expect(pendingPage.getByText(/saved pickup-correction command has no matching receipt/i).first()).toBeVisible();
    assert.equal(JSON.parse(await pendingPage.evaluate(key => localStorage.getItem(key), correctionKey)).pending.operationId, unknownId);
    await expect(pendingPage.getByTestId("fulfillment-move-quantity-stage-scan-meter")).toHaveCount(0);
    await pendingPage.close();

    await command("fulfillmentMove", { id: batchB, revision: 1, phase: "stage", physicallyConfirmed: true,
      reason: "One verified unit is ready before the rest of the pull.", lines: [{ itemId: "scan-meter", quantity: 1, serials: ["QR-003"] }] });
    assert.equal((await request(admin, "GET", `${inventory}/fulfillment/${batchB}/ticket`)).resume.nextStep, "vehicle");
    await request(tech, "POST", `/api/inventory/pickups/${fixture.projectId}/${batchA}/problem`, {
      operationId: crypto.randomUUID(), revision: 2, itemId: "scan-meter", category: "wrong_serial",
      description: "Verify this pickup serial with physical stock before loading." });
    assert.equal((await request(admin, "GET", `${inventory}/fulfillment/${batchA}/ticket`)).resume.resumable, false);
    const reviewPage = await adminPage();
    let reviewLookups = 0;
    reviewPage.on("request", req => { if (req.url().endsWith(`/${batchA}/ticket`)) reviewLookups++; });
    await scan(reviewPage, ticketUrl(batchA));
    await expect(reviewPage.getByText(/pickup problem was reported/i).first()).toBeVisible().catch(async error => {
      console.log("Review scan diagnostics", { reviewLookups });
      console.log(await reviewPage.locator("body").innerText());
      throw error;
    });
    await expect(reviewPage.getByTestId("fulfillment-move-quantity-vehicle-scan-meter")).toHaveCount(0);
    await reviewPage.close();
    await command("fulfillmentCorrect", { id: batchA, revision: 3, mode: "recording",
      reason: "Verified both serials and confirmed the existing staging record is correct.",
      lines: [{ itemId: "scan-meter", quantity: 2, serials: ["QR-001", "QR-002"] }],
      observedReturns: [], confirmed: true, sourceVerified: true, ready: true });
    await command("fulfillmentMove", { id: batchA, revision: 4, phase: "vehicle", physicallyConfirmed: true,
      reason: "Crew verified both meters physically loaded into the assigned vehicle.",
      lines: [{ itemId: "scan-meter", quantity: 2, serials: ["QR-001", "QR-002"] }] });
    const terminal = await request(admin, "GET", `${inventory}/fulfillment/${batchA}/ticket`);
    assert.equal(terminal.batch.status, "completed");
    assert.equal(terminal.resume.resumable, false);
    const completedPage = await adminPage(), terminalRevision = (await snapshot()).revision;
    await scan(completedPage, ticketUrl(batchA));
    await expect(completedPage.getByText(/This batch is completed/i).first()).toBeVisible();
    await expect(completedPage.getByTestId("fulfillment-move-quantity-vehicle-scan-meter")).toHaveCount(0);
    assert.equal((await snapshot()).revision, terminalRevision);
    console.log("PASS ticket lookup authorization/current state, single HID launch, capture preservation, no stock posting, technician QR and camera decoding.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
