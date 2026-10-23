const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const admin = await browser.newContext({ baseURL });
  const root = `/api/projects/${fixture.projectId}`;
  const json = async (method, path, data, client = admin) => {
    const response = await client.request.fetch(path, { method, data });
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const contexts = [];
  try {
    await json("POST", "/api/auth/local/login", fixture);
    const roles = await json("GET", "/api/subroles");
    const fieldRole = roles.find(role => role.key === "field_technician");
    assert.ok(fieldRole, "Normal Field Technician role must exist.");
    const group = await json("POST", "/api/user-groups", { name: `Draft crew ${crypto.randomUUID().slice(0, 8)}`, projectIds: [fixture.projectId] });
    const users = [];
    for (let index = 0; index < 2; index++) {
      const credentials = { username: `draft-tech-${crypto.randomUUID().slice(0, 10)}`, password: `Aa1!${crypto.randomUUID()}` };
      const user = await json("POST", "/api/users", { ...credentials, firstName: "Draft", lastName: `Tech ${index}`,
        role: "user", subroleId: fieldRole.id, projectIds: [fixture.projectId], groupIds: [group.id] });
      const context = await browser.newContext({ baseURL });
      await json("POST", "/api/auth/local/login", credentials, context);
      users.push(user); contexts.push(context);
    }
    const services = await json("GET", "/api/service-types");
    const createWork = async (suffix, assignment = { assignedGroupId: group.name }) => json("POST", `${root}/work-orders`, {
      customerWoId: `DRAFT-${suffix}`, customerName: "Owned draft fixture", serviceType: services[0].code,
      oldSystemId: `OLD-${suffix}`, oldSystemReading: "0001.00", status: "Open", ...assignment,
    });
    const work = await createWork(crypto.randomUUID().slice(0, 8));
    const watchers = [];
    for (const context of contexts) {
      const page = await context.newPage();
      await page.goto(`/projects/${fixture.projectId}/work-orders`);
      await expect(page.getByTestId(`row-work-order-${work.id}`)).toBeVisible();
      watchers.push(page);
    }
    const claims = await Promise.all(contexts.map(c => c.request.post(`${root}/work-orders/${work.id}/claim`)));
    assert.equal(claims.filter(r => r.ok()).length, 1, "Only one field technician can claim.");
    assert.equal(claims.filter(r => r.status() === 409).length, 1);
    const winner = claims.findIndex(r => r.ok()), other = 1 - winner;
    await expect(watchers[other].getByTestId(`row-work-order-${work.id}`)).toHaveCount(0, { timeout: 15000 });
    // The owned loopback server is HTTP/1.1. Each live page holds SSE sockets;
    // keeping both observers open can exhaust Chromium's per-origin pool and
    // indefinitely queue the new recovery page's otherwise successful reads.
    await Promise.all(watchers.map(page => page.close()));
    const mine = contexts[winner], loser = contexts[other], owner = users[winner], replacement = users[other];
    const claimed = await json("GET", `${root}/work-orders/${work.id}`, undefined, mine);
    assert.equal(claimed.assigned_user_id ?? claimed.assignedUserId, owner.id);
    assert.equal(claimed.assigned_group_id ?? claimed.assignedGroupId ?? null, null);
    const listed = await json("GET", `${root}/work-orders`, undefined, loser);
    assert.ok(!(Array.isArray(listed) ? listed : listed.workOrders ?? listed.data ?? []).some(row => row.id === work.id));
    const endpoint = `${root}/work-orders/${work.id}/changeout-draft`;
    const token = crypto.randomUUID();
    const version = claimed.assignmentVersion;
    const imagePage = await mine.newPage();
    const signatureData = await imagePage.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 32; canvas.height = 16;
      canvas.getContext("2d").fillRect(2, 2, 28, 12); return canvas.toDataURL("image/png");
    });
    await imagePage.close();
    const capture = { step: "notes", selectedWorkflowMode: "changeout", data: {
      canChange: true, troubleCode: "", troubleNote: "", oldSystemReading: "0001.00", oldModuleReading: "",
      newSystemId: `NEW-${work.id}`, newModuleId: "", newSystemReading: "000.0050", newModuleReading: "",
      newSystemType: "", newModuleType: "", gpsCoordinates: "", completionNotes: "Keep exact capture",
      changeoutScope: "system", signatureName: "Owned fixture",
      beforePhotos: [{ type: "before", file: { name: "captured.png", type: "image/png", lastModified: 1,
        base64: signatureData.split(",")[1], size: Buffer.from(signatureData.split(",")[1], "base64").length } }],
      afterPhotos: [], troublePhotos: [], signatureData },
      inputBuffers: { newSystemReading: "000.0050" }, startedAt: new Date().toISOString() };
    const saved = await json("PUT", endpoint, { baseRevision: 0, submissionId: token, assignmentVersion: version,
      step: "notes", capture }, mine);
    assert.equal(saved.draft.revision, 1);
    assert.deepEqual((await json("GET", endpoint, undefined, mine)).draft.capture, capture);
    assert.equal((await mine.request.put(endpoint, { data: { baseRevision: 0, submissionId: token,
      assignmentVersion: version, step: "notes", capture: { changed: true } } })).status(), 409);
    const fieldPage = await mine.newPage();
    await fieldPage.goto(`/projects/${fixture.projectId}/work-orders`);
    await fieldPage.getByTestId(`button-resume-changeout-${work.id}`).first().click();
    await fieldPage.getByTestId("button-restore-changeout-draft").click();
    await expect(fieldPage.getByTestId("input-completion-notes")).toHaveValue("Keep exact capture");
    await fieldPage.getByTestId("input-completion-notes").fill("Captured before browser interruption");
    await expect.poll(async () => (await json("GET", endpoint, undefined, mine)).draft?.capture?.data?.completionNotes,
      { timeout: 15000 }).toBe("Captured before browser interruption");
    await fieldPage.reload();
    const restore = fieldPage.getByTestId("button-restore-changeout-draft");
    const resume = fieldPage.getByTestId(`button-resume-changeout-${work.id}`).first();
    const start = fieldPage.getByTestId("header-button-start-system-changeout");
    await expect.poll(async () => await restore.isVisible() || await resume.isVisible() || await start.isVisible(), { timeout: 15000 }).toBe(true);
    if (!await restore.isVisible()) await resume.or(start).first().click();
    await fieldPage.getByTestId("button-restore-changeout-draft").click();
    await expect(fieldPage.getByTestId("input-completion-notes")).toHaveValue("Captured before browser interruption");
    const recovered = (await json("GET", endpoint, undefined, mine)).draft.capture;
    assert.equal(recovered.data.beforePhotos[0].file.base64, signatureData.split(",")[1]);
    assert.equal(recovered.data.signatureData, signatureData);
    assert.equal(recovered.data.newSystemReading, "000.0050");
    await fieldPage.close();
    await json("PATCH", `${root}/work-orders/${work.id}`, { assignedUserId: replacement.id });
    assert.equal((await json("GET", endpoint, undefined, mine)).canResume, false);
    const history = await mine.newPage();
    await history.goto(`/projects/${fixture.projectId}/work-orders`);
    await history.getByTestId(`button-resume-changeout-${work.id}`).first().click();
    await expect(history.getByRole("dialog")).toContainText("Captured before browser interruption");
    await history.close();
    await json("PATCH", `${root}/work-orders/${work.id}`, { assignedUserId: owner.id });
    const returned = await json("GET", endpoint, undefined, mine);
    assert.equal(returned.canResume, false, "Assigning back must not resurrect the old draft.");
    assert.ok(returned.assignmentVersion > version);
    assert.equal((await mine.request.put(endpoint, { data: { baseRevision: 1, submissionId: token,
      assignmentVersion: version, step: "notes", capture } })).status(), 409);
    const fresh = crypto.randomUUID();
    const latestVersion = returned.assignmentVersion;
    await json("PUT", endpoint, { baseRevision: 0, submissionId: fresh, assignmentVersion: latestVersion,
      step: "notes", capture }, mine);
    const completion = { status: "Completed", newSystemId: `NEW-${work.id}`, newSystemReading: "0", oldSystemReading: "1",
      signatureData,
      signatureName: "Owned fixture", changeoutSubmissionId: fresh, changeoutAssignmentVersion: latestVersion,
      inventoryUsage: { mode: "changeout", used: [], dispositions: [] } };
    const stale = await mine.request.patch(`${root}/work-orders/${work.id}`, { data: { ...completion,
      changeoutSubmissionId: token, changeoutAssignmentVersion: version } });
    assert.equal(stale.status(), 409, await stale.text());
    await json("PATCH", `${root}/work-orders/${work.id}`, completion, mine);
    const ended = await json("GET", endpoint, undefined, mine);
    assert.equal(ended.completed, true); assert.equal(ended.draft, null);
    assert.equal((await json("GET", `${root}/changeout-drafts`, undefined, mine)).drafts.filter(d => d.workOrderId === work.id).length, 0);
    await json("PATCH", `${root}/work-orders/${work.id}`, completion, mine);
    const jobs = await json("GET", `${root}/changeout-reconciliation`);
    assert.equal(jobs.jobs.filter(j => j.workOrderId === work.id).length, 1, "Uncertain retry must not duplicate reconciliation.");
    await expect.poll(async () => (await json("GET", `${root}/changeout-reconciliation`)).jobs.find(j => j.id === fresh)?.status,
      { timeout: 20000 }).toBe("failed");
    assert.equal((await json("GET", `${root}/work-orders/${work.id}`)).status, "Completed", "Warehouse failure cannot undo completion.");
    assert.equal((await mine.request.post(`${root}/changeout-reconciliation/${fresh}/retry`,
      { data: { reason: "Unauthorized retry must be refused" } })).status(), 403);
    await json("POST", `${root}/changeout-reconciliation/${fresh}/retry`, { reason: "Warehouse reviewed the captured usage" });
    assert.equal((await json("GET", `${root}/work-orders/${work.id}`)).status, "Completed");
    const notOwner = await loser.request.post(`${root}/work-orders/${work.id}/claim`);
    assert.equal(notOwner.status(), 409);
    const page = await admin.newPage();
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Stock discrepancies", exact: true }).click();
    await expect(page.getByTestId("changeout-reconciliation-jobs")).toBeVisible();
    await page.getByTestId("changeout-reconciliation-toggle").click();
    await expect(page.getByTestId(`changeout-job-${fresh}`)).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByTestId("changeout-reconciliation-jobs")).toBeVisible();
    assert.deepEqual(errors, []);
    console.log("PASS: competing normal-role claims, assignment ABA protection, exact server drafts, conflict preservation, completion clears all attempts, idempotent completion, durable warehouse failure, responsive review.");
  } finally { for (const c of contexts) await c.close(); await admin.close(); await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
