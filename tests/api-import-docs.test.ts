import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apiImportConfigSchema, importFields, safeUpdateFields } from "../shared/customer-api-import";
import { firstImportUrl, mapImportRecord, nextImportPage, property, trustedImportUrl } from "../server/apiImportFetch";
import { customerAuthHeaders } from "../server/customerApiPayload";

const guide = readFileSync(new URL("../CUSTOMER_API_INTEGRATION.md", import.meta.url), "utf8");
const ui = readFileSync(new URL("../client/src/pages/project-api-import.tsx", import.meta.url), "utf8");
const blocks = (text: string) => [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map(match => JSON.parse(match[1]));
const examples = guide.split(/^#### Example [A-D]:/m).slice(1).map(part => {
  const [settings, ...responses] = blocks(part);
  return { settings: apiImportConfigSchema.parse(settings), rawSettings: settings, responses };
});
const rules = { services: ["Water"], statuses: ["Open"], systems: ["SYS-W1"], modules: ["MOD-W1"], openStatus: "Open" };

// Coverage checklist: every literal/conditional form label, option, mapping
// target, checkbox, complete configuration key, and documented mock page.
test("guide covers every form field, conditional label, and dropdown option", () => {
  const labels = [...ui.matchAll(/<FormField label="([^"]+)"/g)].map(match => match[1]);
  labels.push("Cursor response path", "Next URL response path", "Resume saved cursor");
  for (const label of labels) assert.ok(guide.includes(label), `Missing field explanation: ${label}`);
  const options = [...ui.matchAll(/<SelectItem value="([^"]+)">([^<]+)<\/SelectItem>/g)];
  for (const [, value, label] of options) {
    assert.ok(guide.includes(label), `Missing option: ${label}`);
    assert.ok(guide.includes(`"${value}"`) || guide.includes(`\`${value}\``), `Missing option value: ${value}`);
  }
  assert.ok(guide.includes("Test & preview unsaved settings"));
  assert.ok(guide.includes("Save changes"));
  assert.ok(guide.includes("Keep source"));
});

test("target reference covers all fields, exact lengths, and safe-update checkboxes", () => {
  for (const [field, max] of Object.entries(importFields)) {
    const row = guide.split("\n").find(line => line.startsWith("| ") && line.includes(`/ \`${field}\``));
    assert.ok(row, `Missing target row: ${field}`);
    const cells = row.split("|").slice(1, -1).map(value => value.trim());
    assert.match(cells[1], new RegExp(` / ${max}$`));
    assert.ok(cells[2].includes('"'), `Target needs a concrete value: ${field}`);
    assert.equal(cells[3], safeUpdateFields.includes(field as any) ? "Yes" : "No");
  }
  assert.equal(safeUpdateFields.length, 18);
  assert.equal(Object.keys(importFields).length, 22);
});

test("all JSON blocks parse and four complete settings objects validate without network/database access", () => {
  assert.ok(blocks(guide).length >= 13);
  assert.equal(examples.length, 4);
  const keys = Object.keys(apiImportConfigSchema.innerType().shape).sort();
  for (const { settings, rawSettings } of examples) {
    assert.deepEqual(Object.keys(rawSettings).sort(), keys);
    assert.equal(settings.intervalMinutes, 0);
    assert.equal(settings.isEnabled, true);
  }
  assert.deepEqual(examples.map(example => example.settings.authType), ["none", "api_key", "bearer_token", "basic_auth"]);
  assert.deepEqual(examples.map(example => example.settings.pagination), ["none", "page", "cursor", "next_url"]);
});

test("documented request sequences, termination, records paths, and exact readings match fetch helpers", () => {
  const expectedCounts = [1, 2, 2, 2];
  const expectedPages = [1, 2, 2, 2];
  for (const [index, { settings, responses }] of examples.entries()) {
    assert.equal(responses.length, expectedPages[index]);
    let current = firstImportUrl(settings, {});
    let count = 0;
    for (const [page, response] of responses.entries()) {
      const records = property(response, settings.recordsPath);
      assert.ok(Array.isArray(records));
      for (const record of records) {
        const { mapped, errors } = mapImportRecord(record, settings, rules);
        assert.deepEqual(errors, []);
        assert.match(mapped.customerWoId!, /^000204[2-8]$/);
        assert.equal(mapped.oldSystemReading, record.meter.reading);
        count++;
      }
      const next = nextImportPage(settings, response, records, current, settings.startPage + page);
      assert.equal(!!next.url, page < responses.length - 1);
      if (next.url) {
        const url = new URL(next.url);
        if (index === 1) {
          assert.equal(url.searchParams.get("page"), "2");
          assert.equal(url.searchParams.get("limit"), "2");
          assert.equal(url.searchParams.get("region"), "north");
        }
        if (index === 2) assert.equal(url.searchParams.get("cursor"), "after-0002045");
        if (index === 3) assert.equal(url.searchParams.get("offset"), "2");
        current = next.url;
      }
    }
    assert.equal(count, expectedCounts[index]);
  }
  assert.equal(new URL(firstImportUrl(examples[0].settings, {})).search, "");
});

test("examples authenticate with header-only mock values and never need a real credential", () => {
  for (const { settings } of examples) {
    const headers = customerAuthHeaders({
      customer_api_auth_type: settings.authType,
      customer_api_secret_env_var: settings.secretEnvVar,
      customer_api_key_header: settings.keyHeader,
    }, { [settings.secretEnvVar]: "demo-user:demo-password" });
    if (settings.authType === "none") assert.equal(headers.Authorization, undefined);
    if (settings.authType === "api_key") assert.equal(headers["X-Customer-Key"], "demo-user:demo-password");
    if (settings.authType === "bearer_token") assert.equal(headers.Authorization, "Bearer demo-user:demo-password");
    if (settings.authType === "basic_auth") assert.equal(headers.Authorization, `Basic ${Buffer.from("demo-user:demo-password").toString("base64")}`);
  }
});

test("watermark, saved-cursor variation, and filter override examples match request construction", () => {
  const config = examples[2].settings;
  const stamp = "2026-10-11T20:00:00.000Z";
  const url = new URL(firstImportUrl(config, { watermark: stamp }));
  assert.equal(url.searchParams.get("updated_since"), stamp);
  assert.ok(url.search.includes("20%3A00%3A00.000Z"));
  assert.equal(url.searchParams.has("cursor"), false);
  const resumed = new URL(firstImportUrl({ ...config, watermarkParam: "", resumeCursor: true }, { cursor: "after-0002045" }));
  assert.equal(resumed.searchParams.get("cursor"), "after-0002045");
  assert.equal(resumed.searchParams.has("updated_since"), false);
  const page = new URL(firstImportUrl({ ...examples[1].settings, pageSize: 100, queryParams: { limit: "50", region: "north" } }, {}));
  assert.equal(page.searchParams.get("limit"), "100");
  assert.equal(page.searchParams.get("region"), "north");
  assert.equal(trustedImportUrl("/v1/work-orders?offset=2", config), "https://api.customer.example/v1/work-orders?offset=2");
  assert.throws(() => trustedImportUrl("https://other.customer.example/orders", config));
});

test("required, null/absent, and exact-decimal instructions match record validation", () => {
  const config = { ...examples[0].settings, fieldMapping: { ...examples[0].settings.fieldMapping, "customer.phone": "phone" as const } };
  const original = examples[0].responses[0][0];
  const absent = mapImportRecord(original, config, rules);
  assert.equal(Object.hasOwn(absent.mapped, "phone"), false);
  const cleared = mapImportRecord({ ...original, customer: { ...original.customer, phone: null } }, config, rules);
  assert.equal(cleared.mapped.phone, null);
  assert.ok(mapImportRecord({ ...original, address: "" }, config, rules).errors.length);
  assert.ok(mapImportRecord({ ...original, meter: { ...original.meter, reading: "1e3" } }, config, rules).errors.length);
  assert.equal(absent.mapped.oldSystemReading, "12345678901234567890.001");
});
