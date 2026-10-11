import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { customerPushSettings, customerPushFields, customerPushSchema } from "../shared/customer-api-settings";
import { validateCustomerPush, validateProjectCustomerPush, customerCredentialStatus } from "../server/customerApiSettings";
import { customerAuthHeaders } from "../server/customerApiPayload";
import { pool } from "../server/db";

const defaults = { ...customerPushSettings({}), customerApiEnabled: true, customerApiUrl: "https://customer.example/completions" };
const fixtureEnv = { FIXTURE_KEY: "mock-key", FIXTURE_TOKEN: "mock-token", FIXTURE_BASIC: "mock-user:mock-password" };

test("all four auth selections validate and produce the documented headers", () => {
  for (const [type, variable, expected] of [
    ["none", "", undefined],
    ["api_key", "FIXTURE_KEY", "mock-key"],
    ["bearer_token", "FIXTURE_TOKEN", "Bearer mock-token"],
    ["basic_auth", "FIXTURE_BASIC", `Basic ${Buffer.from(fixtureEnv.FIXTURE_BASIC).toString("base64")}`],
  ]) {
    const result = validateCustomerPush({ ...defaults, customerApiAuthType: type, customerApiSecretEnvVar: variable }, fixtureEnv);
    assert.ok(result.data);
    const headers = customerAuthHeaders({
      customer_api_auth_type: type, customer_api_secret_env_var: variable,
      customer_api_key_header: result.data.customerApiKeyHeader,
    }, fixtureEnv);
    assert.equal(headers[type === "api_key" ? "X-API-Key" : "Authorization"], expected);
    assert.equal(customerCredentialStatus(result.data, fixtureEnv), type === "none" ? "not_required" : "available");
  }
});

test("enabled saves reject malformed URLs, auth, header names and absent credentials", () => {
  for (const url of ["", "not-a-url", "ftp://customer.example", "https://name:password@customer.example", "https://customer.example/#fragment"]) {
    assert.ok(validateCustomerPush({ ...defaults, customerApiUrl: url }, fixtureEnv).errors?.customerApiUrl);
  }
  for (const variable of ["", "a secret value", "2BAD", "TOKEN-NAME", "TOKEN=VALUE"]) {
    assert.ok(validateCustomerPush({ ...defaults, customerApiAuthType: "bearer_token", customerApiSecretEnvVar: variable }, fixtureEnv).errors?.customerApiSecretEnvVar);
  }
  const missing = validateCustomerPush({ ...defaults, customerApiAuthType: "bearer_token", customerApiSecretEnvVar: "ABSENT_FIXTURE_VAR" }, fixtureEnv);
  assert.match(missing.errors!.customerApiSecretEnvVar![0], /not configured/);
  for (const header of ["Bad Header", "Content-Type", "IDEMPOTENCY-KEY", "X-MeterFlo-Delivery-Id", "Key\r\nInjected"]) {
    assert.ok(validateCustomerPush({ ...defaults, customerApiAuthType: "api_key", customerApiSecretEnvVar: "FIXTURE_KEY", customerApiKeyHeader: header }, fixtureEnv).errors?.customerApiKeyHeader);
  }
  assert.ok(validateCustomerPush({ ...defaults, customerApiAuthType: "oauth" }, fixtureEnv).errors?.customerApiAuthType);
  assert.equal(customerPushSchema.safeParse({ ...defaults, unrelated: true }).success, false);
});

test("existing mixed-case environment names remain usable without reconfiguration", () => {
  const result = validateCustomerPush({
    ...defaults, customerApiAuthType: "bearer_token", customerApiSecretEnvVar: "customerToken",
  }, { customerToken: "dummy-token" });
  assert.equal(result.data?.customerApiSecretEnvVar, "customerToken");
  assert.ok(validateCustomerPush({
    ...defaults, customerApiAuthType: "bearer_token", customerApiSecretEnvVar: "customerToken",
  }, {}).errors?.customerApiSecretEnvVar);
});

test("disabled drafts and unrelated project edits remain saveable without changing push", () => {
  assert.ok(validateCustomerPush({ ...defaults, customerApiEnabled: false, customerApiUrl: "", customerApiAuthType: "basic_auth", customerApiSecretEnvVar: "" }, {}).data);
  const existing = { ...defaults, customerApiAuthType: "bearer_token", customerApiSecretEnvVar: "ABSENT_FIXTURE_VAR" };
  assert.deepEqual(validateProjectCustomerPush({ name: "Unrelated change" }, existing).data, { name: "Unrelated change" });
  assert.ok(validateProjectCustomerPush({ customerApiEnabled: false }, existing).data);
  assert.ok(validateProjectCustomerPush({ customerApiEnabled: true }).errors?.customerApiUrl);
  assert.ok(validateProjectCustomerPush(null as any).errors);
});

test("documentation covers the six fields and keeps the project form from submitting them", async () => {
  const guide = await readFile("CUSTOMER_API_INTEGRATION.md", "utf8");
  const form = await readFile("client/src/pages/project-form.tsx", "utf8");
  for (const field of customerPushFields) {
    const column = field.replace(/[A-Z]/g, match => `_${match.toLowerCase()}`);
    assert.ok(guide.includes(column), `Missing ${column}`);
    assert.ok(!form.includes(`${field}:`), `Old project form still submits ${field}`);
  }
  assert.match(guide, /Push delivery field reference/);
  assert.match(guide, /missing server variable/);
  assert.match(guide, /OAuth token acquisition/);
  assert.match(guide, /Last-saved credential availability/);
});

test.after(async () => { await pool.end(); });
