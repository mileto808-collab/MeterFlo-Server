import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { windowsUpdateCommands } from "../shared/windows-update-commands";
import { WindowsUpdateInstructions } from "../client/src/components/windows-update-instructions";
import { loadCustomerRelease } from "../shared/customer-release";
import { coreUpdatePreview } from "../server/coreUpdatePreview";

test("routine, bootstrap and preflight guidance use the tracked updater without unsafe fallbacks", () => {
  assert.equal(windowsUpdateCommands.routine, String.raw`cd /d C:\xampp\htdocs\meterflo && deploy\Update-MeterFlo.cmd`);
  assert.equal(windowsUpdateCommands.bootstrap,
    String.raw`cd /d C:\xampp\htdocs\meterflo && git pull --ff-only origin main && deploy\Update-MeterFlo.cmd`);
  assert.ok(windowsUpdateCommands.preflight.endsWith("Update-MeterFlo.cmd --check"));
  for (const command of Object.values(windowsUpdateCommands))
    assert.doesNotMatch(command, /npx|reset --hard|db:push|audit fix|--update-env/);
  const guide = fs.readFileSync("deploy/WINDOWS_DEPLOYMENT.md", "utf8");
  assert.ok(guide.includes(windowsUpdateCommands.routine));
  assert.ok(guide.includes("Commands in Settings and Preview Changes"));
});

test("Windows guidance renders independently of any release preview or approved source", () => {
  const markup = renderToStaticMarkup(React.createElement(WindowsUpdateInstructions, { copy: () => {} }));
  for (const command of Object.values(windowsUpdateCommands))
    assert.ok(markup.includes(command.replaceAll("&", "&amp;")));
  assert.match(markup, /Copy update command/);
  assert.match(markup, /Copy first-time command/);
  assert.match(markup, /Copy preflight command/);
  assert.match(markup, /Expect downtime/);
  assert.match(markup, /customer-extension installations/);
});

for (const configured of [false, true]) {
  test(`${configured ? "configured but unavailable" : "unconfigured"} release checks never become a false up-to-date or staging approval`, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meterflo-guidance-"));
    try {
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "2.1.1" }));
      fs.writeFileSync(path.join(root, "meterflo.release.json"),
        JSON.stringify({ extensionApiVersion: 1, schemaVersion: 2, migrations: [] }));
      fs.writeFileSync(path.join(root, "meterflo.instance.json"), JSON.stringify({
        installedSchemaVersion: 2, extensions: [],
        ...(configured ? { coreSource: "https://github.com/example/meterflo.git",
          coreBaseline: { version: "2.1.1", commit: "a".repeat(40) } } : {}),
      }));
      const preview = await coreUpdatePreview(loadCustomerRelease(root),
        async () => { throw new Error("No Git checkout in owned fixture"); },
        undefined, async () => new Response("Unavailable", { status: 503 }));
      assert.equal(preview.configurationRequired, !configured);
      assert.equal(preview.canPrepare, false);
      assert.equal(preview.updateAvailable, false);
      assert.equal(preview.candidateVersion, null);
      assert.equal(preview.updateCommand, "");
      assert.ok(preview.blockers.length);
      assert.doesNotMatch(preview.message, /is up to date/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
