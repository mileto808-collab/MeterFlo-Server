// Real two-worker revision races; only run inside the disposable owned sandbox.
const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const baseURL = require("./support/workspace-ui-base.cjs")();
  execFileSync(process.execPath, ["--import", "tsx", "tests/support/vehicle-return-ui-fixture.ts"], { stdio: "inherit" });
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const admin = await browser.newContext({ baseURL });
  const prefix = `/api/projects/${fixture.projectId}/inventory/vehicle-return-workflows`;
  const commands = `/api/projects/${fixture.projectId}/inventory/commands`;
  const errors = [];
  const request = async (ctx, method, url, data) => {
    const response = await ctx.request[method](url, data ? { data } : {});
    assert.ok(response.ok(), `${method} ${url}: ${response.status()} ${response.ok() ? "" : await response.text()}`);
    return response.json();
  };
  const detail = id => request(admin, "get", `${prefix}/drafts/${id}`).then(result => result.draft);
  const button = (page, name) => page.getByRole("button", { name, exact: true });
  const task = kind => `inventory-task-${kind === "equipment" ? "return-equipment" : kind === "count" ? "vehicle-count" : "return-stock"}`;
  const row = (page, id) => page.getByTestId(`vehicle-return-draft-${id}`);
  const reason = (page, kind) => page.locator(kind === "equipment" ? "#equipment-return-reason" : "#return-reason");
  const scans = (page, kind) => page.locator(kind === "equipment" ? "#return-scan-system" : "#serials-return-meter");
  const captureStep = async page => {
    await button(page, "Continue").click();
    await button(page, "Continue").click();
  };
  const setupStep = async page => {
    await button(page, "Back").click();
    await button(page, "Back").click();
  };
  // Exercise the actual query's refresh, not a separate APIRequestContext fetch.
  const refresh = async (page, id, revision) => {
    const response = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === prefix && response.request().method() === "GET" && response.ok();
    }, { timeout: 20_000 });
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const payload = await (await response).json();
    assert.equal(payload.drafts.find(draft => draft.id === id)?.revision, revision, "The browser query really received the newer revision");
  };
  try {
    await request(admin, "post", "/api/auth/local/login", fixture);
    // Grant through the same role-management API administrators use, not seeded keys.
    await request(admin, "put", `/api/subroles/${fixture.viewerRoleId}/permissions`, {
      permissions: ["nav.projects", "projects.view", "workOrders.view", "inventory.view",
        "inventory.receive", "inventory.count", "inventory.transfer"],
    });
    await request(admin, "post", commands, { operationId: randomUUID(), action: "warehouse",
      data: { id: "return-van", code: "RETURN-VAN", name: "Return vehicle", type: "vehicle",
        vin: "1HGCM82633A004352", plate: "RTN-1", plateState: "CO",
        userIds: [fixture.viewer.id], expectedLocationTypeRevision: 1 } });
    await request(admin, "post", commands, { operationId: randomUUID(), action: "warehouse",
      data: { id: "return-other-van", code: "OTHER-VAN", name: "Other return vehicle", type: "vehicle",
        vin: "1HGCM82633A004353", plate: "RTN-2", plateState: "CO",
        userIds: [fixture.viewer.id], expectedLocationTypeRevision: 1 } });
    const target = (await request(admin, "get", `${prefix}?kind=stock&sourceId=return-van`)).destinations[0].id;
    const capture = kind => ({
      kind, sourceId: "return-van", destinationId: kind === "count" ? "" : target,
      itemIds: kind === "equipment" ? [] : ["return-meter"],
      returnIds: kind === "equipment" ? ["return-old"] : [],
      quantities: kind === "equipment" ? {} : { "return-meter": kind === "count" ? "2" : "1" },
      scans: kind === "equipment" ? { system: "REMOVED-001\n" }
        : { "return-meter": kind === "count" ? "RETURN-A\nUNEXPECTED\n" : "RETURN-A\n" },
      reason: "Original worker verified the physical capture",
    });
    for (const kind of ["equipment", "count", "stock"]) {
      for (const resolution of ["review", "separate", "frozen"]) {
        const id = randomUUID(), otherId = randomUUID();
        const original = (await request(admin, "post", `${prefix}/drafts/${id}`,
          { revision: 0, saveId: randomUUID(), capture: capture(kind) })).draft;
        await request(admin, "post", `${prefix}/drafts/${otherId}`,
          { revision: 0, saveId: randomUUID(), capture: capture(kind) });
        // Separate cookie jars AND localStorage, with different authenticated accounts.
        const localContext = await browser.newContext({ baseURL });
        const peerContext = await browser.newContext({ baseURL });
        let releaseSave;
        try {
          await request(localContext, "post", "/api/auth/local/login", fixture);
          await request(peerContext, "post", "/api/auth/local/login", fixture.viewer);
          const local = await localContext.newPage(), peer = await peerContext.newPage();
          const physicalRequests = [];
          local.on("request", req => {
            const path = new URL(req.url()).pathname;
            if (req.method() === "POST" && (path === commands || path.endsWith("/prepare")))
              physicalRequests.push({ path, body: req.postDataJSON() });
          });
          for (const page of [local, peer]) {
            page.on("pageerror", error => errors.push(error.message));
            await page.goto(`/projects/${fixture.projectId}/inventory`);
            await page.getByTestId("button-start-inventory-desktop").click();
            await page.getByTestId(task(kind)).click();
            await row(page, id).getByRole("button", { name: "Open draft", exact: true }).click();
            await captureStep(page);
            await expect(reason(page, kind)).toHaveValue(original.capture.reason);
          }
          const localKey = `meterflo:vehicle-return:${encodeURIComponent(fixture.id)}:${fixture.projectId}:${kind}`;
          const recovery = () => local.evaluate(key => JSON.parse(localStorage.getItem(key)), localKey);
          // Hold the real local POST until the peer's browser has committed a newer revision.
          // No fabricated 409, draft, query payload, or authentication bypass.
          let pending;
          const held = new Promise(resolve => { releaseSave = resolve; });
          await local.route(`**/vehicle-return-workflows/drafts/${id}`, async route => {
            if (route.request().method() !== "POST") return route.continue();
            pending = route.request().postDataJSON();
            await held;
            await route.continue();
          });
          const localReason = `Local ${kind} ${resolution} condition must not be replaced`;
          // Stay within the scan target: the last selected unit is still being typed.
          const localScans = kind === "equipment" ? "REMOVED-00"
            : kind === "count" ? "RETURN-A\nPARTIAL-LOCAL" : "RETURN-";
          await scans(local, kind).fill(localScans);
          await reason(local, kind).fill(localReason);
          await expect.poll(() => pending, { timeout: 10_000 }).toBeTruthy();
          assert.equal(pending.revision, original.revision);
          await expect.poll(async () => (await recovery()).capture.reason).toBe(localReason);
          const localCapture = (await recovery()).capture;
          assert.equal(Object.values(localCapture.scans)[0], localScans);

          const peerReason = `Peer ${kind} ${resolution} newer shared condition`;
          const peerScans = kind === "equipment" ? "REMOVED-001\n"
            : kind === "count" ? "RETURN-A\nRETURN-B\n" : "RETURN-B\n";
          await scans(peer, kind).fill(peerScans);
          await reason(peer, kind).fill(peerReason);
          await expect.poll(async () => (await detail(id)).capture.reason).toBe(peerReason);
          let newer = await detail(id);
          assert.equal(newer.updatedBy, fixture.viewer.id);
          assert.ok(newer.revision > original.revision);
          if (resolution === "frozen") {
            await button(peer, "Review operation").click();
            await peer.getByRole("checkbox").last().check();
            await button(peer, "Prepare physical operation").click();
            await expect(button(peer, "Retry exact operation")).toBeVisible();
            newer = await detail(id);
            assert.equal(newer.status, "submitting");
            assert.ok(newer.command?.operationId);
          }
          // Refresh while local save is still outstanding: list data must not adopt peer captures.
          await refresh(local, id, newer.revision);
          await expect(scans(local, kind)).toHaveValue(localScans);
          await expect(reason(local, kind)).toHaveValue(localReason);
          assert.deepEqual(physicalRequests, [], "A conflict never prepares or posts physical stock");
          assert.deepEqual((await recovery()).capture, localCapture);
          releaseSave();
          await expect(local.getByText("Another worker has a newer draft", { exact: true })).toBeVisible();
          await local.unroute(`**/vehicle-return-workflows/drafts/${id}`);
          await expect(button(local, "Review operation")).toBeDisabled();
          await expect(scans(local, kind)).toHaveValue(localScans);
          await expect(reason(local, kind)).toHaveValue(localReason);
          await setupStep(local);
          await expect(row(local, id).getByText("Currently open", { exact: true })).toHaveAttribute("aria-current", "true");
          await expect(row(local, id).getByRole("button")).toHaveCount(0);
          await expect(row(local, otherId).getByRole("button", { name: "Open draft", exact: true })).toBeDisabled();
          const before = await recovery();
          assert.equal(before.baseRevision, original.revision, "Refresh must not rebase local captures");
          await row(local, id).getByText("Currently open", { exact: true }).click();
          assert.deepEqual(await recovery(), before, "Current-row indicator is not a conflict resolution");
          assert.deepEqual(await detail(id), newer, "Conflict and query refresh do not mutate the peer draft");
          // The source selector must not bypass conflict resolution by clearing recovery.
          // Accept any unexpected confirmation so the test exposes, rather than cancels, a destructive path.
          let confirmations = 0;
          const acceptUnexpected = async dialog => { confirmations++; await dialog.accept(); };
          local.on("dialog", acceptUnexpected);
          try {
            await local.getByRole("combobox").first().click();
            await local.getByRole("option", { name: "Other return vehicle · OTHER-VAN", exact: true }).click();
            await expect(local.getByRole("listbox")).toHaveCount(0);
            await expect(local.getByRole("combobox").first()).toContainText("Return vehicle");
            await expect(local.getByText("Resolve the exact shared draft before changing vehicles. Your local entries and any frozen operation are retained.", { exact: true })).toBeVisible();
            assert.equal(confirmations, 0, "Vehicle changes cannot offer a destructive confirmation during a conflict");
            assert.deepEqual(await recovery(), before, "A source change cannot clear or replace local recovery");
            assert.deepEqual(await detail(id), newer, "A source change preserves the peer's exact frozen operation");
            await expect(row(local, id).getByText("Currently open", { exact: true })).toBeVisible();
            await expect(local.getByText("Another worker has a newer draft", { exact: true })).toBeVisible();
          } finally {
            local.removeListener("dialog", acceptUnexpected);
          }
          if (resolution !== "frozen") {
            await button(local, "Retry sync").click();
            await expect(local.getByText("Another worker has a newer draft", { exact: true })).toBeVisible();
            assert.deepEqual((await recovery()).capture, localCapture, "Retry is not permission to overwrite a newer revision");
            // Recovery after reload must retain the conflict as well, not adopt the query's version.
            await local.reload();
            await expect(local.getByText("Another worker has a newer draft", { exact: true })).toBeVisible();
            await expect(row(local, id).getByText("Currently open", { exact: true })).toBeVisible();
            assert.deepEqual((await recovery()).capture, localCapture);
          } else {
            await expect(button(local, "Keep local as separate draft")).toHaveCount(0);
            await expect(button(local, "Keep local separately")).toHaveCount(0);
          }
          await captureStep(local);
          await expect(scans(local, kind)).toHaveValue(localScans);
          await expect(reason(local, kind)).toHaveValue(localReason);
          await fs.mkdir("generated-artifacts/vehicle-draft-conflicts", { recursive: true });
          await local.screenshot({ path: `generated-artifacts/vehicle-draft-conflicts/${kind}-${resolution}.jpg` });
          if (resolution === "separate") {
            await button(local, "Keep local as separate draft").click();
            await expect(local.getByText("Another worker has a newer draft", { exact: true })).toHaveCount(0);
            await expect.poll(async () => {
              const saved = await recovery();
              return saved.draftId !== id && !!saved.draftId && !saved.pendingSave;
            }).toBe(true);
            const separate = await detail((await recovery()).draftId);
            assert.deepEqual(separate.capture, localCapture);
            assert.equal(separate.createdBy, fixture.id);
            assert.deepEqual(await detail(id), newer, "Separate save leaves the peer draft exactly unchanged");
          } else {
            await button(local, "Review exact shared draft").click();
            await expect(local.getByText("Another worker has a newer draft", { exact: true })).toHaveCount(0);
            assert.deepEqual((await recovery()).capture, newer.capture);
            assert.equal((await recovery()).draftId, id);
            assert.equal((await recovery()).baseRevision, newer.revision);
            if (resolution === "frozen") {
              assert.deepEqual((await recovery()).command, newer.command);
              let posted;
              await local.route(`**${commands}`, async route => {
                posted = route.request().postDataJSON();
                await route.abort();
              });
              await button(local, "Retry exact operation").click();
              await expect.poll(() => posted).toEqual(newer.command);
              await expect(button(local, "Retry exact operation")).toBeEnabled();
              await local.reload();
              await expect(button(local, "Retry exact operation")).toBeVisible();
              assert.deepEqual((await recovery()).command, newer.command, "Reload retains the peer's immutable posting identity");
              assert.deepEqual(await detail(id), newer);
            } else {
              await captureStep(local);
              await expect(reason(local, kind)).toHaveValue(peerReason);
              await expect(scans(local, kind)).toHaveValue(peerScans);
              await expect(button(local, "Review operation")).toBeEnabled();
              assert.deepEqual(await detail(id), newer);
            }
          }
          console.log(`PASS: ${kind} two-worker conflict → ${resolution}`);
        } finally {
          releaseSave?.();
          await localContext.close();
          await peerContext.close();
          // Unlock using the original identity; never post stock just to clean up a test.
          for (const draft of (await request(admin, "get", `${prefix}?kind=${kind}`)).drafts) {
            let current = await detail(draft.id);
            if (current.status === "submitting") current = (await request(admin, "post", `${prefix}/drafts/${draft.id}/unlock`,
              { revision: current.revision, operationId: current.command.operationId })).draft;
            if (current.status === "editing") await request(admin, "delete", `${prefix}/drafts/${draft.id}`, { revision: current.revision });
          }
        }
      }
    }
    assert.deepEqual(errors, [], "No browser runtime exceptions");
  } finally {
    await admin.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
