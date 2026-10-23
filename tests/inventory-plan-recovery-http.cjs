const { request } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { randomUUID, createHash } = require("node:crypto");
const { Client } = require("pg");
const { spawn } = require("node:child_process");
const path = require("node:path");
const net = require("node:net");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const admin = await request.newContext({ baseURL }), tech = await request.newContext({ baseURL }),
    stranger = await request.newContext({ baseURL }), anonymous = await request.newContext({ baseURL });
  const root = `/api/projects/${fixture.projectId}`, commands = `${root}/inventory/commands`;
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const api = async (context, method, path, data, status) => {
    const response = await context.fetch(path, { method, data });
    if (status !== undefined) assert.equal(response.status(), status, `${method} ${path}: ${await response.text()}`);
    else assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const post = (action, data) => api(admin, "POST", commands, { action, data, operationId: randomUUID() });
  let role, user, work, secondServer, restarted;
  const recover = (command, mode = "lookup", context = tech, status = 200, workId = work.id) =>
    api(context, "POST", `${root}/work-orders/${workId}/inventory/plan-recovery`, { command, mode }, status);
  const makeCommand = revision => ({ action: "plan", operationId: randomUUID(), data: {
    workOrderId: work.id, revision, lines: [{ id: randomUUID(), itemId: "recovery-part", quantity: 2,
      kind: "addition", reason: "Recovery acceptance fixture" }],
  } });
  try {
    await api(admin, "POST", "/api/auth/local/login", fixture);
    role = await api(admin, "POST", "/api/subroles", {
      key: `recovery_${randomUUID().slice(0, 8)}`, label: "Recovery planner", baseRole: "user",
      permissions: ["workOrders.view", "inventory.plan"],
    });
    const credentials = { username: `recovery_${randomUUID().slice(0, 8)}`, password: `Aa1!${randomUUID()}` };
    user = await api(admin, "POST", "/api/users", { ...credentials, firstName: "Recovery", lastName: "Planner",
      role: "user", subroleId: role.id, projectIds: [fixture.projectId] });
    await api(tech, "POST", "/api/auth/local/login", credentials);
    const otherCredentials = { username: `other_${randomUUID().slice(0, 8)}`, password: `Aa1!${randomUUID()}` };
    await api(admin, "POST", "/api/users", { ...otherCredentials, firstName: "Other", lastName: "Planner",
      role: "user", subroleId: role.id, projectIds: [fixture.projectId] });
    await api(stranger, "POST", "/api/auth/local/login", otherCredentials);
    const services = await api(admin, "GET", "/api/service-types");
    work = await api(admin, "POST", `${root}/work-orders`, { customerWoId: "RECOVERY-HTTP",
      serviceType: services[0].code, status: "Open", assignedUserId: user.id });
    await post("item", { id: "recovery-part", sku: "RECOVERY-PART", name: "Recovery part", tracking: "regular" });
    const command = makeCommand(0);
    const initial = await api(tech, "GET", `${root}/work-orders/${work.id}/inventory`);
    assert.equal(initial.planRecovery.version, 1);
    assert.deepEqual(await api(tech, "GET", "/api/inventory/plan-recovery-capabilities"), { version: 1, modes: ["lookup", "resolve"] });
    assert.equal((await recover(command)).status, "unresolved");
    // Treat a committed response as lost; resolve independently through a new HTTP request.
    await api(tech, "POST", commands, command);
    const accepted = await recover(command);
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.acceptedRevision, 1);
    assert.equal(accepted.actorId, user.id);
    assert.equal(accepted.operationId, command.operationId);
    assert.match(accepted.fingerprint, /^[a-f0-9]{64}$/);
    const canonical = value => value && typeof value === "object"
      ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
    assert.equal(accepted.fingerprint, createHash("sha256").update(JSON.stringify(canonical({
      action: command.action, data: command.data, actor: user.id,
    }))).digest("hex"));
    assert.equal((await recover(command, "lookup", stranger)).status, "unresolved");
    assert.equal((await recover({ ...command, data: { ...command.data, revision: 99 } })).status, "unresolved");
    await recover(command, "lookup", tech, 400, work.id + 100000);
    await recover(command, "lookup", anonymous, 401);
    await api(admin, "POST", commands, { ...makeCommand(1), data: { workOrderId: work.id, revision: 1, lines: [] } });
    assert.equal((await recover(command)).acceptedRevision, 1);
    assert.deepEqual((await api(tech, "GET", `${root}/work-orders/${work.id}/inventory`)).plan.lines, []);
    await api(admin, "PUT", `/api/subroles/${role.id}/permissions`, { permissions: ["workOrders.view"] });
    await api(tech, "POST", commands, command, 403);
    assert.equal((await recover(command)).status, "accepted");
    await api(admin, "PUT", `/api/subroles/${role.id}/permissions`, { permissions: [] });
    assert.equal((await recover(command)).status, "accepted", "No current read/edit permission needed for an owned receipt");
    const { rows: [project] } = await db.query("SELECT database_name FROM public.projects WHERE id=$1", [fixture.projectId]);
    assert.match(project.database_name, /^[a-z0-9_]+$/);
    await db.query(`UPDATE "${project.database_name}".work_orders SET status='Completed',assigned_user_id=NULL WHERE id=$1`, [work.id]);
    await db.query("UPDATE public.projects SET inventory_enabled=false,is_active=false WHERE id=$1", [fixture.projectId]);
    assert.equal((await recover(command)).status, "accepted", "Disabled/inactive/terminal/unassigned work retains minimal evidence");
    const response = await tech.post(`${root}/work-orders/${work.id}/inventory/plan-recovery`, { data: { command } });
    assert.equal(response.headers()["cache-control"], "no-store");
    assert.deepEqual(Object.keys(await response.json()).sort(), ["version", "projectId", "workOrderId", "actorId", "action",
      "operationId", "fingerprint", "status", "acceptedRevision", "occurredAt"].sort());
    await db.query("DELETE FROM public.user_projects WHERE user_id=$1 AND project_id=$2", [user.id, fixture.projectId]);
    await recover(command, "lookup", tech, 403);
    await db.query("INSERT INTO public.user_projects(user_id,project_id) VALUES($1,$2)", [user.id, fixture.projectId]);
    await db.query("UPDATE public.users SET is_locked=true WHERE id=$1", [user.id]);
    const locked = await tech.post(`${root}/work-orders/${work.id}/inventory/plan-recovery`, { data: { command } });
    assert.ok([401, 403].includes(locked.status()));
    await db.query("UPDATE public.users SET is_locked=false WHERE id=$1", [user.id]);
    await db.query("UPDATE public.projects SET inventory_enabled=true,is_active=true WHERE id=$1", [fixture.projectId]);
    await db.query(`UPDATE "${project.database_name}".work_orders SET status='Open',assigned_user_id=$2 WHERE id=$1`, [work.id, user.id]);
    await api(admin, "PUT", `/api/subroles/${role.id}/permissions`, { permissions: ["workOrders.view", "inventory.plan"] });
    const delayed = makeCommand(2);
    assert.equal((await recover(delayed, "resolve")).status, "rejected");
    const denied = await tech.post(commands, { data: delayed });
    assert.equal(denied.status(), 409);
    assert.equal((await recover(delayed, "resolve")).status, "rejected");
    await api(tech, "POST", commands, { ...delayed, operationId: randomUUID() });
    let revision = 3;
    // Race genuine transactions, not a read-only absence check. Either posting
    // wins once, or fencing wins and the original cannot commit afterward.
    for (let i = 0; i < 4; i++) {
      const c = makeCommand(revision);
      const [posted, resolution] = await Promise.all([
        tech.post(commands, { data: c }), recover(c, "resolve"),
      ]);
      if (resolution.status === "accepted") { assert.equal(posted.status(), 200); revision++; }
      else {
        assert.equal(resolution.status, "rejected");
        assert.equal(posted.status(), 409);
        assert.equal((await tech.post(commands, { data: c })).status(), 409);
      }
    }
    // A failed revision check rolls back all acceptance evidence; resolve fences it.
    const rollback = makeCommand(0);
    assert.equal((await tech.post(commands, { data: rollback })).status(), 409);
    assert.equal((await recover(rollback)).status, "unresolved");
    assert.equal((await recover(rollback, "resolve")).status, "rejected");
    const { rows: evidence } = await db.query("SELECT status,accepted_revision FROM public.inventory_plan_operation_outcomes WHERE project_id=$1", [fixture.projectId]);
    assert.ok(evidence.some(row => row.status === "accepted" && row.accepted_revision === 1));
    assert.ok(evidence.some(row => row.status === "rejected"));
    assert.equal((await api(tech, "GET", `${root}/work-orders/${work.id}/inventory`)).plan.revision, revision);
    // A distinct automatic override tests the permission that can reject replay
    // even while ordinary planning remains allowed.
    await post("item", { id: "recovery-meter", sku: "RECOVERY-METER", name: "Recovery meter",
      tracking: "serialized", equipment: "system" });
    const { rows: [type] } = await db.query("SELECT id FROM public.system_types WHERE product_id='workspace-fixture'");
    await db.query("INSERT INTO public.system_type_projects(system_type_id,project_id) VALUES($1,$2)", [type.id, fixture.projectId]);
    await post("typeLink", { equipment: "system", typeId: type.id, itemId: "recovery-meter" });
    const overrideWork = await api(admin, "POST", `${root}/work-orders`, { customerWoId: "RECOVERY-OVERRIDE",
      serviceType: services[0].code, status: "Open", assignedUserId: user.id, newSystemType: "workspace-fixture" });
    await api(admin, "PUT", `/api/subroles/${role.id}/permissions`,
      { permissions: ["workOrders.view", "inventory.plan", "inventory.overridePlan"] });
    const overrideCommand = { operationId: randomUUID(), action: "plan", data: {
      workOrderId: overrideWork.id, revision: 0, lines: [{ id: randomUUID(), itemId: "recovery-meter",
        kind: "override", quantity: 0, reason: "Authorized override fixture" }],
    } };
    await api(tech, "POST", commands, overrideCommand);
    await api(admin, "POST", commands, { operationId: randomUUID(), action: "plan",
      data: { workOrderId: overrideWork.id, revision: 1, lines: [] } });
    await api(admin, "PUT", `/api/subroles/${role.id}/permissions`, { permissions: ["workOrders.view", "inventory.plan"] });
    assert.equal((await tech.post(commands, { data: overrideCommand })).status(), 403);
    assert.equal((await recover(overrideCommand, "lookup", tech, 200, overrideWork.id)).acceptedRevision, 1);
    // Existing access locks remain enforced, even on historical evidence.
    await db.query("INSERT INTO public.access_locks(id,project_id,locked) VALUES($1,$2,true)",
      [`project:${fixture.projectId}`, fixture.projectId]);
    assert.equal((await tech.post(`${root}/work-orders/${work.id}/inventory/plan-recovery`, { data: { command } })).status(), 423);
    await db.query("DELETE FROM public.access_locks WHERE id=$1", [`project:${fixture.projectId}`]);
    // Read the same durable evidence from a fresh server process and session.
    const port = await new Promise(resolve => {
      const server = net.createServer().listen(0, "127.0.0.1", () => {
        const value = server.address().port; server.close(() => resolve(value));
      });
    });
    secondServer = spawn(process.execPath, [path.resolve("dist/index.cjs")], {
      cwd: path.dirname(process.env.WORKSPACE_UI_SANDBOX_CONFIG),
      env: { ...process.env, PORT: String(port) }, stdio: "ignore",
    });
    restarted = await request.newContext({ baseURL: `http://127.0.0.1:${port}` });
    let ready = false;
    for (let i = 0; i < 80; i++) {
      try { if ((await restarted.get("/api/auth/user")).status() === 401) { ready = true; break; } } catch {}
      if (secondServer.exitCode !== null) throw new Error("Fresh recovery server exited.");
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, "Fresh server must become ready.");
    await api(restarted, "POST", "/api/auth/local/login", credentials);
    assert.equal((await recover(command, "lookup", restarted)).acceptedRevision, 1);
    assert.equal((await recover(delayed, "lookup", restarted)).status, "rejected");
    console.log("PASS HTTP plan recovery: original actor, lost response, later edits, revoked plan/override authority, terminal/disabled/inactive, membership/account/access-lock denial, durable fences, rollback, concurrent delayed posts and fresh-process recovery.");
  } finally {
    if (restarted) await restarted.dispose();
    if (secondServer && secondServer.exitCode === null) {
      secondServer.kill();
      await new Promise(resolve => {
        const timer = setTimeout(() => { secondServer.kill("SIGKILL"); }, 5000);
        secondServer.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    }
    await db.end();
    await Promise.all([admin.dispose(), tech.dispose(), stranger.dispose(), anonymous.dispose()]);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
