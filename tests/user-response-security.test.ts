import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import express from "express";
import session from "express-session";
import { Passport } from "passport";
import bcrypt from "bcryptjs";
import { getTableColumns } from "drizzle-orm";
import * as schema from "../shared/schema";
import { isAuthenticated } from "../server/replitAuth";
import { userResponse, loginUserResponse } from "../server/userResponse";
import { requestLogging } from "../server/requestLogging";

// Synthetic values only. No application database, real accounts, or credentials.
const password = "Fixture-Password-Only-84!";
const resetPassword = "Synthetic-Reset-Password-92!";
const recoverySecret = "synthetic-recovery-secret";
const accessToken = "synthetic-access-token";
const sessionSecret = "synthetic-session-secret-for-tests-only";

// Mount the actual production route statements, without booting schedulers,
// migrations, inventory, or the application database. AST extraction avoids
// duplicating handlers or implementing a second version of their behavior.
const userRoutes = new Set([
  "POST /api/auth/local/login", "GET /api/auth/user", "GET /api/users",
  "POST /api/users", "PATCH /api/users/:id", "PATCH /api/users/:id/role",
  "POST /api/users/:id/reset-password", "PATCH /api/users/profile",
  "POST /api/users/change-password", "POST /api/users/:id/lock",
  "POST /api/users/:id/unlock", "PATCH /api/users/:id/subrole",
  "GET /api/projects/:id/users", "GET /api/user-groups/:id/members",
]);

function registerProductionUserRoutes(app: express.Express, storage: object, logs: string[]) {
  const source = readFileSync("server/routes.ts", "utf8");
  const ast = ts.createSourceFile("routes.ts", source, ts.ScriptTarget.Latest, true);
  const statements: string[] = [];
  const found = new Set<string>();
  function visit(node: ts.Node) {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      if (ts.isPropertyAccessExpression(call.expression) &&
          call.expression.expression.getText(ast) === "app" &&
          call.arguments[0] && ts.isStringLiteral(call.arguments[0])) {
        const key = `${call.expression.name.text.toUpperCase()} ${call.arguments[0].text}`;
        if (userRoutes.has(key)) {
          statements.push(node.getText(ast));
          found.add(key);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.deepEqual([...found].sort(), [...userRoutes].sort(), "all expected production routes mounted");
  const js = ts.transpileModule(statements.join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
  runInNewContext(js, {
    ...schema, app, storage, bcrypt, isAuthenticated, userResponse, loginUserResponse,
    console: { error: (...args: unknown[]) => logs.push(args.join(" ")) },
  });
}

test("safe user DTO preserves all current client fields, but rejects unknown future credentials", () => {
  const columns = Object.keys(getTableColumns(schema.users));
  const stored = Object.fromEntries(columns.map(key => [key, null]));
  Object.assign(stored, {
    id: "fixture", username: "fixture-user", role: "user", passwordHash: "synthetic-hash",
    recoverySecret, accessToken, nestedCredentials: { password, sessionSecret },
  });
  const safe = userResponse(stored as schema.User)!;
  for (const field of columns) {
    if (field === "passwordHash") continue;
    assert.equal(Object.hasOwn(safe, field), true, `client field ${field} preserved`);
  }
  for (const field of ["passwordHash", "recoverySecret", "accessToken", "nestedCredentials"]) {
    assert.equal(Object.hasOwn(safe, field), false);
  }
  assert.equal(stored.passwordHash, "synthetic-hash", "stored authentication data is not mutated");
  assert.deepEqual(loginUserResponse(stored as schema.User),
    { id: "fixture", username: "fixture-user", role: "user" });
});

test("real user handlers keep synthetic credentials out of HTTP responses and captured logs", async () => {
  const logs: string[] = [];
  const hashes: string[] = [await bcrypt.hash(password, 4)];
  const makeUser = (id: string, role = "user") => ({
    id, username: id, email: `${id}@example.invalid`, role, passwordHash: hashes[0],
    subroleId: role === "admin" ? 1 : null, isLocked: false, lockedAt: null, lockedReason: null,
    firstName: "Synthetic", lastName: "Fixture", profileImageUrl: null, lastLoginAt: null,
    address: null, city: null, state: null, zip: null, phone: null, website: null, notes: null,
    createdAt: new Date(0), updatedAt: new Date(0),
    recoverySecret, accessToken, futureCredentials: { password, sessionSecret },
  });
  const users = new Map<string, any>([
    ["admin", makeUser("admin", "admin")], ["target", makeUser("target")],
    ["viewer", makeUser("viewer")], ["manager", makeUser("manager")],
    ["outside", makeUser("outside")],
  ]);
  let failStorage = false;
  const update = (id: string, data: object) => {
    const user = users.get(id);
    if (user) Object.assign(user, data);
    return user;
  };
  const storage = {
    getUser: async (id: string) => users.get(id),
    getUserByUsername: async (name: string) => {
      if (failStorage) throw new Error(`${password} ${hashes[0]} ${recoverySecret}`);
      return [...users.values()].find(user => user.username === name);
    },
    getUserByEmail: async (email: string) => [...users.values()].find(user => user.email === email),
    getSubrole: async (id: number) => ({ id, key: id === 1 ? schema.ADMINISTRATOR_SUBROLE_KEY : "field_technician" }),
    updateLastLogin: async (id: string) => update(id, { lastLoginAt: new Date() }),
    hasPermission: async (user: any) => user.role === "admin" || user.id === "manager",
    isAdminUser: async (user: any) => user.role === "admin",
    getAllUsers: async () => [...users.values()],
    getUsersInSameProjects: async () => [users.get("manager"), users.get("target")],
    getProjectUsers: async () => [users.get("target")],
    getGroupMembers: async () => [users.get("target"), users.get("outside")],
    getUserProjects: async (id: string) => [{ id: id === "outside" ? 2 : 1 }],
    getUserGroupWithProjects: async () => ({ projectIds: [1] }),
    createLocalUser: async (username: string, hash: string, role: string, firstName: string, lastName: string, email: string) => {
      hashes.push(hash);
      const user = { ...makeUser(username, role), passwordHash: hash, firstName, lastName, email };
      users.set(username, user);
      return user;
    },
    updateUser: async (id: string, data: object) => update(id, data),
    updateUserRole: async (id: string, role: string) => update(id, { role }),
    updateUserSubrole: async (id: string, subroleId: number) => update(id, { subroleId }),
    updateUserPassword: async (id: string, hash: string) => {
      hashes.push(hash);
      return update(id, { passwordHash: hash });
    },
    lockUser: async (id: string, reason: string) => update(id, { isLocked: true, lockedReason: reason }),
    unlockUser: async (id: string) => update(id, { isLocked: false, lockedReason: null }),
    countActiveAdmins: async () => 2,
  };
  const app = express();
  app.use(express.json());
  app.use(requestLogging(line => logs.push(line)));
  const auth = new Passport();
  auth.serializeUser((user, done) => done(null, user));
  auth.deserializeUser((user: Express.User, done) => done(null, user));
  app.use(session({ secret: sessionSecret, resave: false, saveUninitialized: false }));
  app.use(auth.initialize());
  app.use(auth.session());
  registerProductionUserRoutes(app, storage, logs);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const assertSafe = (text: string) => {
    // Do not put actual values in assertion messages or test output.
    for (const value of [password, resetPassword, recoverySecret, accessToken, sessionSecret, ...hashes]) {
      assert.equal(text.includes(value), false, "synthetic sensitive value must not be exposed");
    }
    for (const field of ["passwordHash", "recoverySecret", "futureCredentials"]) {
      assert.equal(text.includes(`"${field}"`), false, "credential field must not be exposed");
    }
  };
  const request = async (method: string, path: string, cookie = "", data?: object, expected = 200) => {
    const response = await fetch(base + path, {
      method, headers: { "Content-Type": "application/json", cookie },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await response.text();
    assertSafe(text);
    assertSafe(logs.join("\n"));
    assert.equal(response.status, expected, `${method} ${path} status`);
    return { data: text ? JSON.parse(text) : null, cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  };
  const login = (username: string, secret = password, status = 200) =>
    request("POST", "/api/auth/local/login", "", { username, password: secret }, status);
  try {
    await request("GET", "/api/auth/user", "", undefined, 401);
    await login("admin", "synthetic-wrong-password", 401);
    const admin = await login("admin");
    assert.deepEqual(admin.data.user, { id: "admin", username: "admin", role: "admin" });
    assert.ok(admin.cookie);
    assert.ok(users.get("admin").lastLoginAt);
    const current = await request("GET", "/api/auth/user", admin.cookie);
    assert.equal(current.data.subroleKey, schema.ADMINISTRATOR_SUBROLE_KEY);
    assert.equal(current.data.firstName, "Synthetic");
    assert.equal((await request("GET", "/api/users", admin.cookie)).data.length, 5);
    const created = await request("POST", "/api/users", admin.cookie, {
      username: "created", password, firstName: "Created", lastName: "Fixture", role: "user",
    }, 201);
    assert.equal(created.data.username, "created");
    assert.ok(await bcrypt.compare(password, users.get("created").passwordHash));
    await login("created");
    assert.equal((await request("PATCH", "/api/users/target", admin.cookie, { firstName: "Edited" })).data.firstName, "Edited");
    assert.equal((await request("PATCH", "/api/users/target/role", admin.cookie, { role: "customer" })).data.role, "customer");
    assert.equal((await request("PATCH", "/api/users/target/subrole", admin.cookie, { subroleId: 2 })).data.subroleId, 2);
    assert.equal((await request("PATCH", "/api/users/profile", admin.cookie, { firstName: "Profile" })).data.firstName, "Profile");
    assert.equal((await request("GET", "/api/projects/1/users", admin.cookie)).data[0].id, "target");
    assert.equal((await request("GET", "/api/user-groups/1/members", admin.cookie)).data.length, 2);
    await request("POST", "/api/users/target/reset-password", admin.cookie, { newPassword: resetPassword });
    await login("target", password, 401);
    const target = await login("target", resetPassword);
    await request("POST", "/api/users/change-password", target.cookie, {
      currentPassword: resetPassword, newPassword: password, confirmPassword: password,
    });
    await login("target");
    await request("POST", "/api/users/target/lock", admin.cookie, { reason: "Synthetic lock" });
    await login("target", password, 403);
    await request("POST", "/api/users/target/unlock", admin.cookie);
    await login("target");
    const viewer = await login("viewer");
    assert.equal((await request("PATCH", "/api/users/profile", viewer.cookie, { firstName: "Self" })).data.firstName, "Self");
    await request("GET", "/api/users", viewer.cookie, undefined, 403);
    await request("PATCH", "/api/users/target", viewer.cookie, { firstName: "Blocked" }, 403);
    const manager = await login("manager");
    assert.equal((await request("GET", "/api/users", manager.cookie)).data.length, 2);
    assert.deepEqual((await request("GET", "/api/user-groups/1/members", manager.cookie)).data.map((u: any) => u.id), ["target"]);
    await request("PATCH", "/api/users/outside", manager.cookie, { firstName: "Blocked" }, 403);
    await request("PATCH", "/api/users/target/role", manager.cookie, { role: "admin" }, 403);
    users.delete("viewer");
    assert.equal((await request("GET", "/api/auth/user", viewer.cookie)).data, null);
    failStorage = true;
    await login("admin", password, 500);
    assertSafe(logs.join("\n"));
    assert.equal(logs.join("\n").includes(resetPassword), false);
    assert.ok(logs.some(line => /^POST \/api\/auth\/local\/login 200 in \d+ms$/.test(line)));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("generic request logs omit sensitive values at every nesting level without altering responses", async () => {
  const logs: string[] = [];
  const app = express();
  app.use(express.json());
  app.use(requestLogging(line => logs.push(line)));
  const payload = {
    password, passwordHash: "synthetic-nested-hash", token: accessToken,
    data: [{ sessionSecret, deeper: { recoverySecret, refresh_token: accessToken } }],
    message: `Unlabelled secret ${password}`,
  };
  app.post("/api/fixture/:token", (_req, res) => res.status(201).json(payload));
  app.get("/api/fixture", (_req, res) => res.json([payload]));
  app.get("/api/text", (_req, res) => res.send(password));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const response = await fetch(`${base}/api/fixture/${accessToken}?secret=${sessionSecret}`, {
      method: "POST", headers: { "Content-Type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ password }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), payload);
    assert.deepEqual(await (await fetch(base + "/api/fixture")).json(), [payload]);
    assert.equal(await (await fetch(base + "/api/text")).text(), password);
    await fetch(base + "/api/unknown/" + recoverySecret);
    assert.equal(logs.length, 4);
    for (const line of logs) assert.match(line, /^(GET|POST) \/api\/[\w/:[\]-]+ (200|201|404) in \d+ms$/);
    assert.match(logs[0], /^POST \/api\/fixture\/:token 201/);
    for (const value of [password, "synthetic-nested-hash", accessToken, sessionSecret, recoverySecret]) {
      assert.equal(logs.join("\n").includes(value), false, "request logs must contain metadata only");
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
