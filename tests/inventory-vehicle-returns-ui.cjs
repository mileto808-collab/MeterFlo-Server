const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  execFileSync(process.execPath, ["--import", "tsx", "tests/support/vehicle-return-ui-fixture.ts"], { stdio: "inherit" });
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL });
  const prefix = `/api/projects/${fixture.projectId}/inventory/vehicle-return-workflows`;
  const request = async (method, path, data, expected = 200, ctx = context) => {
    const response = await ctx.request[method](path, data ? { data } : {});
    const diagnostic = `${method} ${path}: ${response.status()} ${response.ok() ? "" : await response.text()}`;
    if (expected === 200) assert.ok(response.ok(), diagnostic);
    else assert.equal(response.status(), expected, diagnostic);
    return response.json();
  };
  try {
    await request("post", "/api/auth/local/login", fixture);
    const initial = await request("get", `${prefix}?kind=stock&sourceId=return-van`);
    const target = initial.destinations[0].id;
    const capture = kind => ({ kind, sourceId: "return-van", destinationId: kind === "count" ? "" : target,
      itemIds: kind === "equipment" ? [] : ["return-meter"], returnIds: kind === "equipment" ? ["return-old"] : [],
      quantities: kind === "equipment" ? {} : { "return-meter": kind === "count" ? "2" : "1" },
      scans: kind === "equipment" ? { system: "REMOVED-001\n" } : { "return-meter": kind === "count" ? "RETURN-A\nUNEXPECTED\n" : "RETURN-A\n" },
      reason: "Warehouse crew physically verified the return" });
    const save = async value => {
      const id = randomUUID();
      const { draft } = await request("post", `${prefix}/drafts/${id}`, { revision: 0, saveId: randomUUID(), capture: value });
      return draft;
    };
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByTestId("button-start-inventory-desktop").click();
    await expect(page.getByRole("heading", { name: "Choose an inventory task", exact: true })).toBeVisible();
    for (const kind of ["equipment", "count", "stock"]) {
      const card = page.getByTestId(`inventory-task-${kind === "equipment" ? "return-equipment" : kind === "count" ? "vehicle-count" : "return-stock"}`);
      await card.click();
      await expect(page.getByTestId(`vehicle-return-${kind}`)).toBeVisible();
      assert.equal((await request("get", `${prefix}?kind=${kind}`)).drafts.length, 0, "Opening a workflow alone saves no draft");
      await page.reload();
      await expect(page.getByTestId(`vehicle-return-${kind}`)).toBeVisible();
      await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
    }
    // Distinct IDs, not vehicle names or equal captures, identify the active draft.
    // Exercise the shared setup rendering and automatic recovery for every kind.
    for (const kind of ["equipment", "count", "stock"]) {
      const first = await save(capture(kind)), second = await save(capture(kind));
      const task = `inventory-task-${kind === "equipment" ? "return-equipment" : kind === "count" ? "vehicle-count" : "return-stock"}`;
      const row = draft => page.getByTestId(`vehicle-return-draft-${draft.id}`);
      const localKey = `meterflo:vehicle-return:${encodeURIComponent(fixture.id)}:${fixture.projectId}:${kind}`;
      await page.getByTestId(task).click();
      await row(first).getByRole("button", { name: "Open draft", exact: true }).click();
      await expect(row(first).getByText("Currently open", { exact: true })).toHaveAttribute("aria-current", "true");
      await expect(row(first).getByRole("button")).toHaveCount(0);
      await expect(row(second).getByRole("button", { name: "Open draft", exact: true })).toBeEnabled();
      await page.reload();
      await expect(row(first).getByText("Currently open", { exact: true })).toBeVisible();
      await expect(row(second).getByRole("button", { name: "Open draft", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      const reason = page.locator(kind === "equipment" ? "#equipment-return-reason" : "#return-reason");
      await expect(reason).toHaveValue(first.capture.reason);
      // An uncertain save must retain its exact identity and newer local inputs.
      const saveURL = `**/vehicle-return-workflows/drafts/${first.id}`;
      await page.route(saveURL, route => route.request().method() === "POST" ? route.abort() : route.continue());
      const localReason = `Local ${kind} capture must survive current-row interaction`;
      await reason.fill(localReason);
      await expect(page.getByText("Draft sync needs attention", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(row(second).getByRole("button", { name: "Open draft", exact: true })).toBeDisabled();
      const before = await page.evaluate(key => localStorage.getItem(key), localKey);
      assert.ok(JSON.parse(before).pendingSave, "The failed save retains a pending identity");
      const serverBefore = (await request("get", `${prefix}/drafts/${first.id}`)).draft;
      await row(first).getByText("Currently open", { exact: true }).click();
      assert.equal(await page.evaluate(key => localStorage.getItem(key), localKey), before, "Current indicator does not rewrite recovery");
      assert.deepEqual((await request("get", `${prefix}/drafts/${first.id}`)).draft, serverBefore, "Current indicator does not revise or prepare a draft");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(reason).toHaveValue(localReason);
      await page.unroute(saveURL);
      await page.getByRole("button", { name: "Retry sync", exact: true }).click();
      await expect(page.getByText("Draft sync needs attention", { exact: true })).toHaveCount(0);
      await expect.poll(async () => (await request("get", `${prefix}/drafts/${first.id}`)).draft.capture.reason).toBe(localReason);
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(row(second).getByRole("button", { name: "Open draft", exact: true })).toBeEnabled();
      page.once("dialog", dialog => dialog.dismiss());
      await row(second).getByRole("button", { name: "Open draft", exact: true }).click();
      await expect(row(first).getByText("Currently open", { exact: true })).toBeVisible();
      page.once("dialog", dialog => dialog.accept());
      await row(second).getByRole("button", { name: "Open draft", exact: true }).click();
      await expect(row(second).getByText("Currently open", { exact: true })).toBeVisible();
      await expect(row(first).getByRole("button", { name: "Open draft", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(reason).toHaveValue(second.capture.reason);
      await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
      await page.evaluate(key => localStorage.removeItem(key), localKey);
      for (const value of [first, second]) {
        const current = (await request("get", `${prefix}/drafts/${value.id}`)).draft;
        await request("delete", `${prefix}/drafts/${value.id}`, { revision: current.revision });
      }
    }
    const editing = await save(capture("stock"));
    await request("post", `${prefix}/drafts/${editing.id}`, { revision: 0, saveId: randomUUID(), capture: { ...editing.capture, reason: "Different stale writer" } }, 409);
    await page.getByTestId("inventory-task-return-stock").click();
    await page.getByTestId(`vehicle-return-draft-${editing.id}`).getByRole("button", { name: "Open draft", exact: true }).click();
    await expect(page.getByRole("combobox").first()).toContainText("Return vehicle");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.locator("#serials-return-meter")).toHaveValue("RETURN-A\n");
    await page.reload();
    await expect(page.getByTestId("vehicle-return-stock")).toBeVisible();
    // Browser refresh retains the active capture step as well as the draft.
    await expect(page.locator("#serials-return-meter")).toHaveValue("RETURN-A\n");
    await expect.poll(() => page.getByTestId("vehicle-return-stock").evaluate(element => element.scrollTop)).toBe(0);
    await expect.poll(() => page.getByTestId("vehicle-return-content").evaluate(element => element.scrollTop)).toBe(0);
    assert.equal(await page.evaluate(() => document.activeElement.matches("input,textarea")), false);
    await page.locator("#serials-return-meter").fill("");
    await expect(page.getByRole("button", { name: "Review operation", exact: true })).toBeDisabled();
    await page.locator("#return-reason").fill("short");
    await expect(page.getByRole("button", { name: "Review operation", exact: true })).toBeDisabled();
    await page.locator("#return-reason").fill("Warehouse crew physically verified the return");
    // Current source checks reject wrong serials and do not count them as accepted scans.
    await page.locator("#serials-return-meter").fill("");
    await page.locator("#serials-return-meter").fill("WRONG");
    await page.locator("#serials-return-meter").press("Enter");
    await expect(page.locator("#serials-return-meter")).not.toHaveValue(/WRONG/);
    await page.locator("#serials-return-meter").fill("RETURN-A");
    await page.locator("#serials-return-meter").press("Enter");
    await expect(page.locator("#serials-return-meter")).toHaveValue("RETURN-A\n");
    await fs.mkdir("generated-artifacts/vehicle-returns", { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "generated-artifacts/vehicle-returns/phone-scans.jpg" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Wizard fits a phone");
    await page.getByRole("button", { name: "Review operation", exact: true }).click();
    await page.getByRole("checkbox").last().check();
    await expect(page.getByRole("button", { name: "Prepare physical operation", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Prepare physical operation", exact: true }).click();
    await expect(page.getByRole("button", { name: "Retry exact operation", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Retry exact operation", exact: true }).click();
    await expect(page.getByRole("button", { name: "Print receipt", exact: true })).toBeVisible();
    const posted = (await request("get", `${prefix}/drafts/${editing.id}`)).draft;
    assert.equal(posted.status, "posted");
    const stateResponse = await request("post", `/api/projects/${fixture.projectId}/inventory/commands`, posted.command);
    assert.equal(stateResponse.state.stock.find(row => row.warehouseId === "return-van" && row.itemId === "return-meter").quantity, 1);
    await request("delete", `${prefix}/drafts/${editing.id}`, { revision: posted.revision }, 409);
    const equipmentContext = await request("get", `${prefix}?kind=equipment&sourceId=return-van`);
    assert.ok(equipmentContext.destinations.some(row => row.id === "return-staging"), "staging locations must be selectable for equipment receiving");
    const equipment = await save({ ...capture("equipment"), destinationId: "return-staging" });
    const prepared = (await request("post", `${prefix}/drafts/${equipment.id}/prepare`, { revision: equipment.revision,
      operationId: randomUUID(), physicallyConfirmed: true })).draft;
    const received = await request("post", `/api/projects/${fixture.projectId}/inventory/commands`, prepared.command);
    assert.equal(received.state.returns.find(row => row.id === "return-old").warehouseId, "return-staging");
    assert.equal(received.state.returns.find(row => row.id === "return-old").status, "quarantine");
    const equipmentReceipt = await context.request.get(`${prefix}/receipts/${prepared.command.operationId}/print`);
    assert.equal(equipmentReceipt.status(), 200);
    assert.match(await equipmentReceipt.text(), /REMOVED-001/);
    const count = await save({ ...capture("count"), quantities: { "return-meter": "1" }, scans: { "return-meter": "UNEXPECTED\n" } });
    const frozen = (await request("post", `${prefix}/drafts/${count.id}/prepare`, { revision: count.revision,
      operationId: randomUUID(), physicallyConfirmed: true })).draft;
    const result = await request("post", `/api/projects/${fixture.projectId}/inventory/commands`, frozen.command);
    const recorded = result.state.counts.find(row => row.id === frozen.command.operationId);
    assert.equal(recorded.status, "open");
    assert.equal(recorded.draft.rows[0].serials, "UNEXPECTED\n");
    assert.equal(result.state.stock.find(row => row.itemId === "return-meter" && row.warehouseId === "return-van").quantity, 1);
    // An unlock fences a late post, even though its former exact command is retained by a browser.
    const extra = await save({ ...capture("stock"), quantities: { "return-meter": "1" }, scans: { "return-meter": "RETURN-B\n" } });
    const frozenExtra = (await request("post", `${prefix}/drafts/${extra.id}/prepare`, { revision: extra.revision,
      operationId: randomUUID(), physicallyConfirmed: true })).draft;
    const unlocked = (await request("post", `${prefix}/drafts/${extra.id}/unlock`, { revision: frozenExtra.revision, operationId: frozenExtra.command.operationId })).draft;
    await request("post", `/api/projects/${fixture.projectId}/inventory/commands`, frozenExtra.command, 409);
    await request("delete", `${prefix}/drafts/${extra.id}`, { revision: unlocked.revision });
    const role = await request("post", "/api/subroles", { key: `return_${randomUUID().slice(0, 8)}`,
      label: "Vehicle return worker", baseRole: "user",
      permissions: ["nav.projects", "projects.view", "inventory.view", "inventory.receive", "inventory.count", "inventory.transfer"] });
    const peerCredentials = { username: `return-${randomUUID().slice(0, 8)}`, password: `Aa1!${randomUUID()}` };
    const peer = await request("post", "/api/users", { ...peerCredentials, firstName: "Return", lastName: "Worker",
      role: "user", subroleId: role.id, projectIds: [fixture.projectId] });
    await request("post", `/api/projects/${fixture.projectId}/inventory/commands`, { operationId: randomUUID(), action: "warehouse",
      data: { id: "return-van", code: "RETURN-VAN", name: "Return vehicle", type: "vehicle",
        vin: "1HGCM82633A004352", plate: "RTN-1", plateState: "CO", userIds: [peer.id], expectedLocationTypeRevision: 1 } });
    const peerContext = await browser.newContext({ baseURL });
    await request("post", "/api/auth/local/login", peerCredentials, 200, peerContext);
    const shared = await save({ ...capture("stock"), itemIds: ["return-part"], quantities: { "return-part": "2" }, scans: {} });
    assert.ok((await request("get", `${prefix}?kind=stock`, undefined, 200, peerContext)).drafts.some(row => row.id === shared.id));
    const peerSave = (await request("post", `${prefix}/drafts/${shared.id}`, { revision: shared.revision,
      saveId: randomUUID(), capture: { ...shared.capture, reason: "Second authorized worker verified this draft" } }, 200, peerContext)).draft;
    assert.equal(peerSave.updatedBy, peer.id);
    await request("post", `${prefix}/drafts/${shared.id}`, { revision: shared.revision, saveId: randomUUID(), capture: shared.capture }, 409);
    const peerReplay = await request("post", `/api/projects/${fixture.projectId}/inventory/commands`, posted.command, 200, peerContext);
    assert.equal(peerReplay.state.receipts.find(row => row.id === posted.command.operationId).actor, fixture.id, "Replays preserve the original posting actor");
    await peerContext.close();
    const viewer = await browser.newContext({ baseURL });
    await request("post", "/api/auth/local/login", fixture.viewer, 200, viewer);
    for (const kind of ["equipment", "count", "stock"]) await request("get", `${prefix}?kind=${kind}`, undefined, 403, viewer);
    await viewer.close();
    assert.deepEqual(errors, [], "No browser runtime exceptions");
    console.log("Vehicle return task pages, draft recovery, stock scans, quarantine receipts, count discrepancy evidence, replay and unlock checks passed.");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
