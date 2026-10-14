import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import express from "express";
import session from "express-session";
import { Passport } from "passport";
import { registerLogoutRoute } from "../server/replitAuth";

test("logout finishes the real Passport session operation before returning Home", async () => {
  const app = express();
  const auth = new Passport();
  auth.serializeUser((user, done) => done(null, user));
  auth.deserializeUser((user: Express.User, done) => done(null, user));
  app.use(session({ secret: randomBytes(32).toString("hex"), resave: false, saveUninitialized: false }));
  app.use(auth.initialize());
  app.use(auth.session());
  app.post("/fixture-session", (req, res, next) => req.login({ fixture: true }, error => {
    if (error) return next(error);
    res.sendStatus(204);
  }));
  app.get("/fixture-private", (req, res) => res.sendStatus(req.isAuthenticated() ? 200 : 401));
  registerLogoutRoute(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const login = await fetch(`${base}/fixture-session`, { method: "POST" });
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await fetch(`${base}/fixture-private`, { headers: { cookie } })).status, 200);
    const logout = await fetch(`${base}/api/logout`, { headers: { cookie }, redirect: "manual" });
    assert.equal(logout.status, 302);
    assert.equal(logout.headers.get("location"), "/");
    assert.equal(logout.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(`${base}/fixture-private`, { headers: { cookie } })).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("logout errors do not falsely report a completed logout", async () => {
  const app = express();
  app.use((req, _res, next) => {
    req.logout = ((callback: (error: Error) => void) => callback(new Error("fixture store failure"))) as typeof req.logout;
    next();
  });
  registerLogoutRoute(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const response = await fetch(`${base}/api/logout`, { redirect: "manual" });
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("location"), null);
    assert.match(await response.text(), /retry/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
