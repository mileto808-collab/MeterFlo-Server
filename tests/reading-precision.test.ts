import "dotenv/config";
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import path from "node:path";
import { promises as fs } from "node:fs";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { initializeReadingPrecision } from "../server/readingPrecisionMigration";
import { getProjectFilesPath, getProjectDirectoryName } from "../server/fileStorage";
import { getPermissionByKey } from "../shared/permissionRegistry";
import { insertProjectSchema } from "../shared/schema";
import {
  getReadingPrecision, isValidReading, normalizeReadingInput, getReadingInputValue,
  readingPrecisionPatchSchema, validateCapturedReadings,
} from "../shared/reading-precision";

after(async () => { await pool.end(); });

test("wizard input rejects excess digits without truncating and permits editing", () => {
  for (let limit = 0; limit <= 6; limit++) {
    const atLimit = limit ? `00123.${"4".repeat(limit)}` : "00123";
    assert.equal(getReadingInputValue(atLimit,limit),atLimit);
    assert.equal(getReadingInputValue(`00123.${"4".repeat(limit+1)}`,limit),null);
    assert.equal(getReadingInputValue(atLimit.replace(".",","),limit),atLimit);
    assert.equal(getReadingInputValue("",limit),"");
    assert.equal(getReadingInputValue("0",limit),"0");
    assert.equal(getReadingInputValue("123.",limit),limit ? "123." : null);
    assert.equal(getReadingInputValue("123,",limit),limit ? "123." : null);
  }
  for (const invalid of ["-1","1e3","1.2.3","1,2,3","abc"," 123 "]) {
    assert.equal(getReadingInputValue(invalid,6),null);
  }
  let current = "12.1234";
  for (const attempt of ["12.12345","999.123456","12,12345"]) {
    current = getReadingInputValue(attempt,4) ?? current;
    assert.equal(current,"12.1234","invalid typing/paste leaves the complete previous value intact");
  }
  current = getReadingInputValue("12.123",4) ?? current;
  assert.equal(current,"12.123","backspace is accepted");
});

test("independent precision: 0–6, default 3, zero retained, exact non-truncating input", () => {
  assert.deepEqual(getReadingPrecision(), { systemReadingDecimalPlaces: 3, moduleReadingDecimalPlaces: 3 });
  assert.deepEqual(getReadingPrecision({ systemReadingDecimalPlaces: 0, moduleReadingDecimalPlaces: 6 }),
    { systemReadingDecimalPlaces: 0, moduleReadingDecimalPlaces: 6 });
  assert.equal(insertProjectSchema.parse({ name: "fixture" }).systemReadingDecimalPlaces, 3);
  assert.deepEqual(readingPrecisionPatchSchema.parse({}), {});
  for (const limit of [0, 1, 2, 3, 4, 5, 6]) {
    assert.equal(isValidReading("0", limit), true);
    assert.equal(isValidReading("00123", limit), true);
    assert.equal(isValidReading(limit ? `123.${"1".repeat(limit)}` : "123", limit), true);
    assert.equal(isValidReading(`123.${"1".repeat(limit + 1)}`, limit), false);
    assert.equal(readingPrecisionPatchSchema.safeParse({ systemReadingDecimalPlaces: limit }).success, true);
  }
  for (const value of [-1, 7, 1.5, "3", null, true]) {
    assert.equal(readingPrecisionPatchSchema.safeParse({ systemReadingDecimalPlaces: value }).success, false);
    assert.equal(readingPrecisionPatchSchema.safeParse({ moduleReadingDecimalPlaces: value }).success, false);
  }
  for (const value of ["", " ", "-1", "1e-3", ".1", "1.", "1.2.3", "abc", {}, Infinity, NaN]) {
    assert.equal(isValidReading(value, 6), false);
  }
  assert.equal(isValidReading("0.0", 0), false);
  assert.equal(normalizeReadingInput("000123,4567890"), "000123.4567890");
  const settings = { systemReadingDecimalPlaces: 0, moduleReadingDecimalPlaces: 6 };
  assert.equal(validateCapturedReadings({ newSystemReading: "1.1", newModuleRead: "1.123456" }, settings).length, 1);
  assert.equal(validateCapturedReadings({ oldSystemReading: "12.123456", notes: "unchanged baseline" }, settings,
    { oldSystemReading: "12.123456" }).length, 0);
  assert.equal(validateCapturedReadings({ oldSystemReading: "12.123457" }, settings,
    { oldSystemReading: "12.123456" }).length, 1);
  assert.equal(validateCapturedReadings({ new_module_reading: "12.1234567" }, settings).length, 1);
  const permission = getPermissionByKey("projects.readingPrecision")!;
  assert.equal(permission.defaultAccess.administrator, true);
  assert.equal(permission.defaultAccess.projectManager, false);
  assert.equal(permission.defaultAccess.fieldTechnician, false);
});

test("startup migration is repeatable and preserves configured zero/six", async () => {
  await initializeReadingPrecision(pool);
  const { rows: [project] } = await pool.query(
    "INSERT INTO public.projects(name,system_reading_decimal_places,module_reading_decimal_places) VALUES($1,0,6) RETURNING id",
    [`Precision migration fixture ${randomUUID()}`]);
  try {
    await initializeReadingPrecision(pool);
    const { rows: [row] } = await pool.query("SELECT * FROM public.projects WHERE id=$1", [project.id]);
    assert.equal(row.system_reading_decimal_places, 0);
    assert.equal(row.module_reading_decimal_places, 6);
    await assert.rejects(pool.query("UPDATE public.projects SET system_reading_decimal_places=7 WHERE id=$1", [project.id]));
  } finally {
    await pool.query("DELETE FROM public.projects WHERE id=$1", [project.id]);
  }
});

// Uses real login and the running development API, without changing shared auth
// configuration or production data. Isolated fixture users/projects are removed.
test("live project permissions and all reading write APIs", { skip: !process.env.REPLIT_DEV_DOMAIN }, async t => {
  const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const suffix = randomUUID().slice(0, 8);
  const prefix = `Precision test ${suffix}`;
  const password = `${randomBytes(24).toString("hex")}!Aa1`;
  const userIds: string[] = [];
  const sessions: string[] = [];
  const projectIds: number[] = [];
  let subroleId: number | undefined;
  const request = async (cookie: string, route: string, method = "GET", body?: unknown) => {
    const response = await fetch(base + route, {
      method, headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  };
  const makeUser = async (role: "admin" | "user") => {
    const id = randomUUID(), username = `precision-${role}-${suffix}`;
    const administrator = role === "admin" ? await storage.getAdministratorSubrole() : undefined;
    await pool.query("INSERT INTO public.users(id,username,password_hash,role,subrole_id) VALUES($1,$2,$3,$4,$5)",
      [id, username, await bcrypt.hash(password, 10), role, administrator?.id ?? null]);
    userIds.push(id);
    const response = await fetch(base + "/api/auth/local/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }),
    });
    assert.equal(response.status, 200, "fixture login");
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "login must issue a session cookie");
    sessions.push(decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1)).split(".")[0].slice(2));
    return { id, cookie };
  };
  try {
    const admin = await makeUser("admin"), operator = await makeUser("user");
    const projectResult = await request(admin.cookie, "/api/projects", "POST", { name: prefix });
    assert.equal(projectResult.status, 201);
    const project = projectResult.data;
    projectIds.push(project.id);
    assert.equal(project.systemReadingDecimalPlaces, 3);
    assert.equal(project.moduleReadingDecimalPlaces, 3);
    for (const customerApiSettings of [{}, { customerApiEnabled: false }]) {
      const custom = await request(admin.cookie, "/api/projects", "POST", {
        name: `${prefix} selected ${projectIds.length}`, customerEmail: "",
        systemReadingDecimalPlaces: 0, moduleReadingDecimalPlaces: 6, ...customerApiSettings,
      });
      assert.equal(custom.status, 201, "create persists selected precision with or without push settings");
      projectIds.push(custom.data.id);
      assert.equal(custom.data.systemReadingDecimalPlaces, 0);
      assert.equal(custom.data.moduleReadingDecimalPlaces, 6);
    }
    const root = `/api/projects/${project.id}`;

    await t.test("normal access-level management exposes and grants the new permission", async () => {
      const permissions = await request(admin.cookie, "/api/permissions");
      assert.ok(permissions.data.some((p: any) => p.key === "projects.readingPrecision"));
      const subrole = await request(admin.cookie, "/api/subroles", "POST", {
        key: `precision_fixture_${suffix}`, label: `${prefix} operator`, baseRole: "user",
        permissions: ["projects.create", "projects.edit", "workOrders.create", "workOrders.edit", "workOrders.meterChangeout"],
      });
      assert.equal(subrole.status, 201);
      subroleId = subrole.data.id;
      await pool.query("UPDATE public.users SET subrole_id=$2 WHERE id=$1", [operator.id, subroleId]);
      await storage.assignUserToProject(operator.id, project.id);
      assert.equal((await request(operator.cookie, root, "PATCH", { systemReadingDecimalPlaces: 0 })).status, 403);
      assert.equal((await request(operator.cookie, "/api/projects", "POST",
        { name: `${prefix} denied`, moduleReadingDecimalPlaces: 6 })).status, 403);
      assert.equal((await request(operator.cookie, root, "PATCH", { description: "unrelated setting" })).status, 200);
      const grant = await request(admin.cookie, `/api/subroles/${subroleId}/permissions`, "PUT", {
        permissions: ["projects.create", "projects.edit", "projects.readingPrecision",
          "workOrders.create", "workOrders.edit", "workOrders.meterChangeout"],
      });
      assert.equal(grant.status, 200);
      assert.equal((await request(operator.cookie, root, "PATCH",
        { systemReadingDecimalPlaces: 0, moduleReadingDecimalPlaces: 6 })).status, 200);
      for (const invalid of [-1, 7, 2.5, "0", null]) {
        assert.equal((await request(admin.cookie, root, "PATCH", { moduleReadingDecimalPlaces: invalid })).status, 400);
      }
      const persisted = await request(operator.cookie, root);
      assert.equal(persisted.data.systemReadingDecimalPlaces, 0);
      assert.equal(persisted.data.moduleReadingDecimalPlaces, 6);
      const assigned = await request(operator.cookie, `/api/users/${operator.id}/projects`);
      assert.equal(assigned.data.projects.find((p: any) => p.id === project.id).systemReadingDecimalPlaces, 0);
      const copy = await request(admin.cookie, `${root}/copy`, "POST", {});
      assert.equal(copy.status, 201);
      projectIds.push(copy.data.id);
      assert.equal(copy.data.systemReadingDecimalPlaces, 0);
      assert.equal(copy.data.moduleReadingDecimalPlaces, 6);
      assert.equal((await request(operator.cookie, `/api/projects/${copy.data.id}`, "PATCH",
        { systemReadingDecimalPlaces: 4 })).status, 403, "precision does not bypass assignment");
    });

    let counter = 0;
    const serviceType = (await storage.getServiceTypes())[0].code;
    const createWorkOrder = async () => {
      counter++;
      const result = await request(admin.cookie, `${root}/work-orders`, "POST", {
        customerWoId: `fixture-${counter}`, customerId: `customer-${counter}`, customerName: "Fixture",
        address: "Fixture address", serviceType, oldSystemId: `old-s-${counter}`, oldModuleId: `old-m-${counter}`,
        oldSystemReading: "00123", oldModuleRead: "00123.123456",
      });
      assert.equal(result.status, 201);
      assert.equal(result.data.oldSystemReadingText,"00123");
      assert.equal(result.data.oldModuleReadText,"00123.123456");
      return result.data;
    };
    await t.test("manual capture, historical baselines, sync including force overwrite", async () => {
      const invalidCreate = await request(admin.cookie, `${root}/work-orders`, "POST", { newSystemReading: "1.1" });
      assert.equal(invalidCreate.status, 400);
      const wo = await createWorkOrder();
      assert.equal((await request(admin.cookie, `${root}/work-orders/${wo.id}`, "PATCH",
        { newModuleRead: "1.1234567" })).status, 400);
      await pool.query(`UPDATE "${project.databaseName}".work_orders SET old_system_reading='123.123456' WHERE id=$1`, [wo.id]);
      assert.equal((await request(admin.cookie, `${root}/work-orders/${wo.id}`, "PATCH",
        { oldSystemReading: "123.123456", notes: "retain imported baseline" })).status, 200);
      for (const forceOverwrite of [false, true]) {
        const sync = await request(operator.cookie, `${root}/mobile/sync/upload`, "POST", {
          workOrders: [{ id: wo.id, clientUpdatedAt: new Date().toISOString(), forceOverwrite, newSystemReading: "1.1" }],
        });
        assert.equal(sync.status, 200);
        assert.equal(sync.data.results[0].status, "error");
        assert.equal(sync.data.results[0].code, "READING_PRECISION");
      }
      assert.equal((await pool.query(`SELECT new_system_reading FROM "${project.databaseName}".work_orders WHERE id=$1`,
        [wo.id])).rows[0].new_system_reading, null);
      for (const forceOverwrite of [false,true]) {
        const fresh = await createWorkOrder();
        const sync = await request(operator.cookie, `${root}/mobile/sync/upload`, "POST", {
          workOrders:[{id:fresh.id,clientUpdatedAt:new Date().toISOString(),forceOverwrite,
            newSystemReading:"00012",newModuleRead:"00000.123456"}],
        });
        assert.equal(sync.status,200);
        assert.notEqual(sync.data.results[0].status,"error");
        const raw = (await pool.query(`SELECT * FROM "${project.databaseName}".work_orders WHERE id=$1`,[fresh.id])).rows[0];
        assert.equal(raw.new_system_reading_text,"00012");
        assert.equal(raw.new_module_read_text,"00000.123456");
        const download = await request(operator.cookie,`${root}/mobile/sync/download`);
        assert.equal(download.status,200);
        const record = download.data.workOrders.find((record:any) => record.id===fresh.id);
        assert.equal(record.new_system_reading,"00012");
        assert.equal(record.new_module_read,"00000.123456");
      }
    });
    await t.test("both mobile trouble captures validate before saving and do not truncate fractions", async () => {
      const wo = await createWorkOrder();
      const troubleCode = (await storage.getTroubleCodes())[0].code;
      for (const route of [
        `/api/mobile/workorders/${wo.id}/trouble`,
        `/api/mobile/projects/${project.id}/work-orders/${wo.id}/trouble`,
      ]) {
        const invalid = await request(operator.cookie, route, "POST",
          { projectId: project.id, troubleCode, oldSystemReading: "12.1" });
        assert.equal(invalid.status, 400);
        assert.equal(invalid.data.code, "READING_PRECISION");
        assert.equal((await request(admin.cookie, root, "PATCH", { systemReadingDecimalPlaces: 3 })).status, 200);
        assert.equal((await request(operator.cookie, route, "POST",
          { projectId: project.id, troubleCode, oldSystemReading: "00012.123" })).status, 200);
        assert.equal((await pool.query(`SELECT old_system_reading FROM "${project.databaseName}".work_orders WHERE id=$1`,
          [wo.id])).rows[0].old_system_reading, "12.123");
        assert.equal((await request(admin.cookie, root, "PATCH", { systemReadingDecimalPlaces: 0 })).status, 200);
      }
    });
    await t.test("web wizard plus all three mobile completion routes enforce separate limits", async () => {
      const wo = await createWorkOrder();
      const invalid = { canChange: true, projectId: project.id, oldSystemReading: "123",
        oldModuleReading: "123.123456", newSystemId: "new-s", newModuleId: "new-m",
        newSystemReading: "1.1", newModuleReading: "1.123456", changeoutScope: "both",
        gpsCoordinates: "40,-74", signatureName: "Fixture" };
      for (const route of [
        `/api/mobile/workorders/${wo.id}/complete`,
        `/api/mobile/projects/${project.id}/work-orders/${wo.id}/complete`,
      ]) {
        const result = await request(operator.cookie, route, "POST", invalid);
        assert.equal(result.status, 400);
        assert.equal(result.data.code, "READING_PRECISION");
      }
      for (const route of [
        `${root}/work-orders/${wo.id}/system-changeout`,
        `${root}/mobile/work-orders/${wo.id}/complete-changeout`,
      ]) {
        const form = new FormData();
        form.set("data", JSON.stringify(invalid));
        const response = await fetch(base + route, { method: "POST", headers: { Cookie: operator.cookie }, body: form });
        assert.equal(response.status, 400);
        assert.equal((await response.json()).code, "READING_PRECISION");
      }
      const completed = await request(operator.cookie,
        `/api/mobile/projects/${project.id}/work-orders/${wo.id}/complete`, "POST",
        { ...invalid, newSystemReading: "00000", newModuleReading: "00001.123456" });
      assert.equal(completed.status, 200);
      const { rows: [saved] } = await pool.query(
        `SELECT new_system_reading,new_module_read FROM "${project.databaseName}".work_orders WHERE id=$1`, [wo.id]);
      assert.equal(saved.new_system_reading, "0");
      assert.equal(saved.new_module_read, "1.123456");
    });
  } finally {
    // Restrict cleanup to fixtures created in this test, never user projects.
    for (const id of projectIds.reverse()) {
      const project = await storage.getProject(id);
      if (project?.databaseName) await pool.query(`DROP SCHEMA IF EXISTS "${project.databaseName}" CASCADE`);
      if (project) await fs.rm(path.join(await getProjectFilesPath(), getProjectDirectoryName(project.name, id)),
        { recursive: true, force: true });
      await pool.query("DELETE FROM public.user_projects WHERE project_id=$1", [id]);
      await pool.query("DELETE FROM public.projects WHERE id=$1", [id]);
    }
    await pool.query("DELETE FROM public.sessions WHERE sid=ANY($1::text[])", [sessions]);
    for (const id of userIds) await pool.query("DELETE FROM public.users WHERE id=$1", [id]);
    if (subroleId) {
      await pool.query("DELETE FROM public.subrole_permissions WHERE subrole_id=$1", [subroleId]);
      await pool.query("DELETE FROM public.subroles WHERE id=$1", [subroleId]);
    }
  }
});
