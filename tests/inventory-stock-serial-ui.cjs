// Uses only the disposable inventory fixture; never point this at a customer project.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");
const XLSX = require("xlsx");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const out = "generated-artifacts/inventory-stock-serials";
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, acceptDownloads: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const send = async (action, data) => {
      const response = await context.request.post(`${endpoint}/commands`, { data: { action, data, operationId: crypto.randomUUID() } });
      assert.equal(response.status(), 200, await response.text());
      return (await response.json()).state;
    };
    for (const id of ["serial-main", "serial-other"]) await send("warehouse", {
      id, code: id.toUpperCase(), name: id === "serial-main" ? "Main serial warehouse" : "Other warehouse",
      type: "physical", address: "Disposable acceptance fixture",
    });
    await send("vendor", { id: "serial-vendor", name: "Serial vendor" });
    await send("item", { id: "serial-meter", sku: "SER-MTR", name: "Serialized meter", tracking: "serialized" });
    await send("item", { id: "serial-seal", sku: "SER-SEAL", name: "Quantity-only seal", tracking: "regular" });
    const serials = ["00000001", "0001.2300", "AbC-009", "=1+2", "+009", "@serial", '0000<Id&"01">', ...Array.from({ length: 1510 }, (_, i) => `SER-${String(i).padStart(6, "0")}`)];
    const receive = async (destinationId, lines) => {
      const id = crypto.randomUUID();
      await send("order", { id, type: "purchase", destinationId, vendorId: "serial-vendor",
        lines: lines.map(({ itemId, quantity }) => ({ itemId, quantity })) });
      await send("release", { orderId: id });
      await send("receive", { orderId: id, lines });
    };
    await receive("serial-main", [{ itemId: "serial-meter", quantity: serials.length, serials },
      { itemId: "serial-seal", quantity: 10, serials: [] }]);
    await receive("serial-other", [{ itemId: "serial-meter", quantity: 1, serials: ["OTHER-LOCATION-ONLY"] }]);
    const before = (await (await context.request.get(endpoint)).json()).state;
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    const stock = page.getByRole("region", { name: "Stock balances", exact: true });
    await stock.waitFor();
    assert.ok(!(await stock.innerText()).includes("0001.2300"), "Stock table never expands into raw serial text");
    const stockSearch = page.getByRole("searchbox", { name: "Search inventory", exact: true });
    await stockSearch.fill("SER-MTR");
    await page.getByTestId("inventory-stock-pagination").getByText(/of 2 balances/).waitFor();
    assert.equal(before.stock.filter(row => row.serials.length > 0).length, 2, "Both serialized locations are retained across stock pages");
    await stockSearch.fill("0001.2300");
    await stock.getByRole("button", { name: `View serials (${serials.length}) for SER-MTR at SERIAL-MAIN`, exact: true }).waitFor();
    assert.equal(await stock.getByRole("button", { name: /View serials/ }).count(), 1, "Serial search scopes the balance independently of stock pagination");
    await stock.getByRole("button", { name: `View serials (${serials.length}) for SER-MTR at SERIAL-MAIN`, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Stock serials", exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByRole("textbox", { name: "Search serials", exact: true }).evaluate(el => document.activeElement === el), true, "Desktop search autofocus is preserved");
    assert.ok((await dialog.innerText()).includes("Main serial warehouse"));
    const list = dialog.getByRole("list", { name: "Stock serial list" });
    assert.equal(await list.locator("li").count(), 50, "Only one serial page is rendered");
    assert.equal(await list.locator("code").first().innerText(), serials[0]);
    await dialog.getByRole("button", { name: "Next", exact: true }).click();
    assert.equal(await list.locator("code").first().innerText(), serials[50]);
    await dialog.getByRole("textbox", { name: "Search serials", exact: true }).fill("SER-0001");
    const filtered = serials.filter(serial => serial.toLowerCase().includes("ser-0001"));
    await dialog.getByLabel("Export scope", { exact: true }).selectOption("filtered");
    async function download(label, extension) {
      const pending = page.waitForEvent("download");
      await dialog.getByRole("button", { name: label, exact: true }).click();
      const result = await pending;
      const file = `${out}/${label}-${extension}.${extension}`;
      await result.saveAs(file);
      assert.equal(await result.failure(), null);
      return file;
    }
    const readCsvSerials = async file => {
      const text = await fs.readFile(file, "utf8");
      assert.ok(text.startsWith('\uFEFF"Serial"\r\n'), "CSV has UTF-8 BOM and column heading");
      const book = XLSX.read(text.slice(1), { type: "string", raw: true });
      const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true });
      assert.deepEqual(rows[0], ["Serial"]);
      return rows.slice(1).map(row => row[0]);
    };
    const filteredCsv = await download("CSV", "csv");
    assert.deepEqual(await readCsvSerials(filteredCsv), filtered, "Filtered export covers all matches, not just visible page");
    await dialog.getByLabel("Export scope", { exact: true }).selectOption("all");
    const allXlsx = await download("Excel", "xlsx");
    const workbook = XLSX.readFile(allXlsx, { cellNF: true });
    const sheet = workbook.Sheets["Stock serials"];
    assert.deepEqual(XLSX.utils.sheet_to_json(sheet, { header: 1 }).slice(9).map(row => row[0]), serials);
    for (let i = 0; i < serials.length; i++) {
      assert.equal(sheet[`A${i + 10}`].t, "s"); assert.equal(sheet[`A${i + 10}`].f, undefined);
    }
    assert.ok(!JSON.stringify(sheet).includes("OTHER-LOCATION-ONLY"));
    assert.notEqual(sheet.B1.v, String(fixture.projectId), "Project export uses a readable project name");
    const allCsv = await download("CSV", "csv");
    assert.deepEqual(await readCsvSerials(allCsv), serials.map(value => /^[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value));
    const popupPromise = page.waitForEvent("popup");
    await dialog.getByRole("button", { name: "PDF / Print", exact: true }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState();
    assert.deepEqual(await popup.locator("td.serial").allTextContents(), serials);
    assert.equal(await popup.evaluate(() => window.opener === null), true);
    for (const format of ["Letter", "A4"]) {
      const file = `${out}/stock-serials-${format}.pdf`;
      await popup.pdf({ path: file, format, printBackground: true });
      const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", maxBuffer: 10_000_000 });
      const pages = text.split("\f").filter(part => part.trim());
      assert.ok(pages.length > 2);
      for (const part of pages) {
        assert.ok(part.includes("SER-MTR") && part.includes("Main serial warehouse"), "PDF repeats item and location headers");
        assert.ok(part.includes("Serial"), "PDF repeats column headings");
      }
      assert.ok(text.includes(serials[0]) && text.includes(serials.at(-1)));
      assert.ok(!text.includes("OTHER-LOCATION-ONLY"));
    }
    await popup.close();
    await dialog.getByRole("textbox", { name: "Search serials", exact: true }).fill("no-matches-expected");
    await dialog.getByLabel("Export scope", { exact: true }).selectOption("filtered");
    for (const name of ["Excel", "CSV", "PDF / Print"])
      assert.equal(await dialog.getByRole("button", { name, exact: true }).isDisabled(), true);
    await dialog.getByRole("textbox", { name: "Search serials", exact: true }).fill("aBc-009");
    assert.equal(await list.locator("code").first().innerText(), "AbC-009", "Search ignores case but identity text does not");
    await page.screenshot({ path: `${out}/desktop.jpg` });
    await page.setViewportSize({ width: 390, height: 844 });
    const widths = await dialog.evaluate(element => ({
      width: element.getBoundingClientRect().width, content: element.scrollWidth,
      scrollWidth: element.querySelector("ol").scrollWidth, listWidth: element.querySelector("ol").clientWidth,
    }));
    assert.ok(widths.width <= 390 && widths.content <= Math.ceil(widths.width) + 1);
    assert.ok(widths.scrollWidth <= widths.listWidth + 1);
    await page.screenshot({ path: `${out}/mobile.jpg` });
    await page.keyboard.press("Escape");
    await stockSearch.fill("OTHER-LOCATION-ONLY");
    await stock.getByRole("button", { name: "View serials (1) for SER-MTR at SERIAL-OTHER", exact: true }).click();
    assert.deepEqual(await dialog.locator("code").allTextContents(), ["OTHER-LOCATION-ONLY"], "Reopening is scoped to the new location and resets search");
    await page.keyboard.press("Escape");
    const touch = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
      viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    assert.equal((await touch.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const phone = await touch.newPage();
    await phone.goto(`/projects/${fixture.projectId}/inventory`);
    await phone.getByTestId("inventory-mobile-tools-stock-toggle").click();
    await phone.getByRole("searchbox", { name: "Search inventory", exact: true }).fill("OTHER-LOCATION-ONLY");
    await phone.getByTestId("inventory-mobile-tools-stock-toggle").click();
    const trigger = phone.getByRole("button", { name: "View serials (1) for SER-MTR at SERIAL-OTHER", exact: true });
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await phone.setViewportSize(viewport);
      if (viewport.width < 640) {
        const layout = await trigger.evaluate(button => {
          const card = button.closest("[data-stock-row]");
          const totals = card.querySelector(".inventory-stock-quantity-values");
          const location = card.querySelector(".inventory-stock-location");
          return {
            button: button.getBoundingClientRect().toJSON(),
            totals: totals.getBoundingClientRect().toJSON(),
            location: location.getBoundingClientRect().toJSON(),
            iconCount: button.querySelectorAll("svg").length,
            visibleText: button.innerText.trim(),
          };
        });
        assert.equal(layout.iconCount, 1, "Phone serial action has a recognizable icon");
        assert.equal(layout.visibleText, "", "Phone serial action is icon-only");
        assert.ok(layout.button.bottom <= layout.totals.top, "Serial icon sits above quantity totals");
        assert.ok(layout.button.left >= layout.location.left, "Serial icon is on the right of the location area");
        assert.ok(layout.button.width >= 40 && layout.button.height >= 40, "Phone action has an adequate touch target");
        await phone.screenshot({ path: `${out}/phone-serial-icon.jpg` });
      }
      await trigger.tap();
      const phoneDialog = phone.getByRole("dialog", { name: "Stock serials", exact: true });
      await phoneDialog.waitFor();
      await phone.waitForFunction(() => document.activeElement?.textContent === "Stock serials");
      assert.equal(await phoneDialog.getByRole("heading", { name: "Stock serials", exact: true }).evaluate(el => document.activeElement === el), true,
        "Touch opening focuses the title, not an editable control");
      const search = phoneDialog.getByRole("textbox", { name: "Search serials", exact: true });
      await search.tap();
      assert.equal(await search.evaluate(el => document.activeElement === el), true, "Search focuses only after user taps");
      await search.fill("OTHER");
      assert.deepEqual(await phoneDialog.locator("code").allTextContents(), ["OTHER-LOCATION-ONLY"]);
      await phoneDialog.getByRole("button", { name: "Close", exact: true }).tap();
      await phoneDialog.waitFor({ state: "hidden" });
      assert.equal(await phone.evaluate(() => document.activeElement?.id === "stock-serial-search"), false,
        "Closing the viewer does not leave search focused");
    }
    await touch.close();
    assert.deepEqual((await (await context.request.get(endpoint)).json()).state, before, "Viewing and exporting never mutate inventory");
    const viewer = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    assert.equal((await viewer.request.get(endpoint)).status(), 403, "Existing inventory permission blocks unauthorized stock access");
    await viewer.close();
    assert.deepEqual(errors, []);
    console.log("Stock serial viewer passed: 1,517 identities, scoped search/paging, all/filtered XLSX/CSV, formula safety, Letter/A4 PDF, mobile bounds, permissions and no stock mutation.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
