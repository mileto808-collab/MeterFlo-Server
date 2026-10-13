import test from "node:test";
import assert from "node:assert/strict";
import { fetchTurnstileStatus, fetchTurnstileConfig } from "../client/src/lib/login-security";

test("uncached server status supports disabled, verified and unverified browsers", async () => {
  const original = globalThis.fetch;
  try {
    for (const status of [
      { required: false, verified: true }, // disabled / emergency bypass
      { required: true, verified: true },
      { required: true, verified: false }, // new / expired browser
    ]) {
      globalThis.fetch = async (path, options) => {
        assert.equal(path, "/api/security/turnstile/status");
        assert.equal(options?.credentials, "include");
        assert.equal(options?.cache, "no-store");
        assert.ok(options?.signal);
        return Response.json(status);
      };
      assert.deepEqual(await fetchTurnstileStatus(), status);
    }
  } finally { globalThis.fetch = original; }
});

test("failed or malformed security responses fail closed", async () => {
  const original = globalThis.fetch;
  try {
    for (const response of [
      Response.json({ required: false, verified: true }, { status: 503 }),
      Response.json({ required: "false", verified: true }),
      Response.json({ required: false }),
      Response.json(null),
      Response.json([]),
      new Response("<html>proxy error</html>"),
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(fetchTurnstileStatus());
    }
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await assert.rejects(fetchTurnstileStatus(), /connection.*retry/);
  } finally { globalThis.fetch = original; }
});

test("configuration normalizes legacy challenge locations and validates required types", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ enabled: true, siteKey: " fixture-site ", challengePoint: "login" });
    assert.deepEqual(await fetchTurnstileConfig(), { enabled: true, siteKey: "fixture-site", challengePoint: "turnstile" });
    for (const config of [{ enabled: "true", siteKey: "fixture" }, { enabled: true }, {}]) {
      globalThis.fetch = async () => Response.json(config);
      await assert.rejects(fetchTurnstileConfig(), /configuration/);
    }
  } finally { globalThis.fetch = original; }
});

test("security requests time out rather than leaving login loading indefinitely", async (context) => {
  const original = globalThis.fetch;
  context.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
    const pending = fetchTurnstileStatus();
    const checked = assert.rejects(pending, /timed out.*retry/);
    context.mock.timers.tick(10_001);
    await checked;
  } finally {
    globalThis.fetch = original;
    context.mock.timers.reset();
  }
});
