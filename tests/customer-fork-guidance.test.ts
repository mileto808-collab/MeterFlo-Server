import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CustomerForkInstructions } from "../client/src/components/customer-fork-instructions";

test("fork guidance is available without configuration and never invents a command", () => {
  const html = renderToStaticMarkup(React.createElement(CustomerForkInstructions, { copy: () => {} }));
  assert.match(html, /Routine Windows update/);
  assert.match(html, /Supported extension staging/);
  assert.match(html, /Direct-code fork merge/);
  assert.match(html, /Fork review preparation is blocked/);
  assert.match(html, /operator attestations/);
  assert.match(html, /Deployment and publishing remain explicit/);
  assert.doesNotMatch(html, /copy-customer-fork-command/);
});
test("only verified available fork preparation offers a copy command and blocker details remain metadata only", () => {
  const command = 'npm run prepare:customer-fork -- --tag v1.1.0 --commit ' + "a".repeat(40) + ' --target "ABSOLUTE_NEW_REVIEW_DIRECTORY"';
  const blocked = renderToStaticMarkup(React.createElement(CustomerForkInstructions, { copy: () => {},
    forkReview: { canPrepare: false, blockers: ["Review prerequisites first"], command } }));
  assert.match(blocked, /Review prerequisites first/);
  assert.doesNotMatch(blocked, /copy-customer-fork-command/);
  const ready = renderToStaticMarkup(React.createElement(CustomerForkInstructions, { copy: () => {},
    forkReview: { canPrepare: true, blockers: [], command } }));
  assert.match(ready, /copy-customer-fork-command/);
  assert.ok(ready.includes("a".repeat(40)));
  assert.match(ready, /checkout/);
  assert.match(ready, /review.json/);
  assert.match(ready, /confirm-tests --confirm-customizations --confirm-dependencies --confirm-migrations/);
});
