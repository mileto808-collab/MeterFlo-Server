const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

async function main() {
  const dir = "generated-artifacts/inventory-serial-print";
  execFileSync("npx", ["tsx", "tests/support/inventory-serial-print-fixtures.ts", "--write"], { stdio: "inherit" });
  const manifest = JSON.parse(await fs.readFile(`${dir}/manifest.json`, "utf8"));
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
    args: ["--no-sandbox", "--allow-file-access-from-files"],
  });
  const results = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [], externalRequests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()); });
    for (const fixture of manifest) {
      await page.goto(`file://${path.resolve(fixture.file)}`);
      const appendix = page.locator("#serial-details");
      assert.equal(await appendix.count(), fixture.expected.length ? 1 : 0, `${fixture.name}: appendix only for actual serial evidence`);
      const actual = await page.locator("#serial-details .serial-text").allTextContents();
      assert.deepEqual(actual, fixture.expected, `${fixture.name}: every serial retained exactly in its own evidence row`);
      for (const link of await page.locator('a[href="#serial-details"]').all()) {
        assert.ok(fixture.expected.length, "No dangling appendix link");
        await link.click();
        assert.equal(await page.evaluate(() => location.hash), "#serial-details");
      }
      await page.emulateMedia({ media: "print" });
      for (const format of ["Letter", "A4"]) {
        const file = `${dir}/${fixture.name}-${format}.pdf`;
        await page.pdf({ path: file, format, printBackground: true, preferCSSPageSize: false, displayHeaderFooter: false });
        const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 10_000_000 });
        const pages = text.split("\f").filter((part, i, parts) => i < parts.length - 1 || part.trim());
        assert.ok(pages.every(text => text.trim()), `${fixture.name}/${format}: no blank pages`);
        const flattened = text.replace(/\s/g, "");
        const frequencies = new Map();
        for (const serial of fixture.expected) frequencies.set(serial, (frequencies.get(serial) || 0) + 1);
        for (const [serial, count] of frequencies) {
          assert.equal(flattened.split(serial.replace(/\s/g, "")).length - 1, count,
            `${fixture.name}/${format}: PDF preserves every serial occurrence including category duplicates`);
        }
        if (fixture.expected.length) {
          assert.ok(pages.length >= 2, "Serial appendix starts on a separate page");
          for (const serial of fixture.expected) assert.ok(!pages[0].replace(/\s/g, "").includes(serial.replace(/\s/g, "")), "No serial on summary page");
          for (const [i, text] of pages.entries()) {
            if (!i) continue;
            assert.ok(text.includes("Serial Appendix Test Project"), `Page ${i + 1} identifies project`);
            if (fixture.name !== "components") assert.ok(text.includes(fixture.orderNumber), `Page ${i + 1} identifies order`);
            assert.ok(text.includes("Receipt #1"), `Page ${i + 1} identifies receipt`);
            assert.ok(text.includes("Serial / evidence"), `Page ${i + 1} repeats column headings`);
            assert.ok(/METER|MODULE/.test(text), `Page ${i + 1} identifies product`);
          }
        } else assert.equal(pages.length, 1, "No extra page for nonserialized/unknown-only receipt");
        const bbox = execFileSync("pdftotext", ["-bbox", file, "-"], { encoding: "utf8", maxBuffer: 10_000_000 });
        for (const match of bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)) {
          const [, width, height, body] = match;
          for (const word of body.matchAll(/<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">/g)) {
            const [, xMin, yMin, xMax, yMax] = word.map(Number);
            assert.ok(xMin >= 10 && yMin >= 10 && xMax <= Number(width) - 10 && yMax <= Number(height) - 10,
              `${fixture.name}/${format}: text stays inside printable bounds`);
          }
        }
        results.push({ name: fixture.name, format, pages: pages.length, evidenceRows: fixture.expected.length });
      }
      await page.emulateMedia({ media: "screen" });
      if (fixture.name === "one" || fixture.name === "exceptions") {
        await page.locator("#serial-details").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${dir}/${fixture.name}-browser.jpg` });
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, [], "Receipts load and print offline without external resources");
    await fs.writeFile(`${dir}/results.json`, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
    console.log("Receipt summaries, exact serial evidence, separate appendix pages, repeat headers, Letter/A4 bounds and offline printing passed.");
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
