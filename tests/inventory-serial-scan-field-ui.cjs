// Browser component acceptance of the real shared scanner; no application data or authentication bypass.
const { build } = require("esbuild");
const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
(async () => {
  const output = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, {useState} from "react";
      import {createRoot} from "react-dom/client";
      import {SerialScanField, serialTokens} from "./client/src/components/inventory/serial-scan-field";
      function Fixture() {
        const [quantity,setQuantity]=useState("2"),[value,setValue]=useState(""),[array,setArray]=useState(false);
        return <main className="mx-auto max-w-xl space-y-4 p-4">
          <h1>Inventory serial scanner acceptance</h1>
          <label>Expected quantity<input aria-label="Expected quantity" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
          <label htmlFor="scan">Serial scans</label>
          <SerialScanField id="scan" aria-label="Serial scans" expected={quantity} value={value} blockedSerials={["TAKEN"]} requireTarget={!array}
            onChange={text=>setValue(array?serialTokens(text).join("\\n"):text)}/>
          <button onClick={()=>{setValue("");setArray(true);setQuantity("2")}}>Array-backed draft</button>
          <button onClick={()=>setValue("000007\\n000008")}>Restore saved captures</button>
          <button>Another field</button><pre data-testid="saved-value">{value}</pre>
        </main>;
      }
      createRoot(document.getElementById("root")).render(<Fixture/>);
    ` },
    bundle: true, write: false, format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' },
  });
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    const assets = await fs.readdir("dist/public/assets");
    for (const file of assets.filter(file => file.endsWith(".css"))) await page.addStyleTag({ content: await fs.readFile(`dist/public/assets/${file}`, "utf8") });
    await page.addScriptTag({ content: output.outputFiles[0].text });
    const input = page.getByRole("textbox", { name: "Serial scans", exact: true });
    const progress = page.getByTestId("serial-scan-progress");
    const value = page.getByTestId("saved-value");
    const quantity = page.getByRole("textbox", { name: "Expected quantity", exact: true });
    const paste = async text => input.evaluate((node, text) => {
      node.focus(); node.setSelectionRange(node.value.length, node.value.length);
      const clipboardData = new DataTransfer(); clipboardData.setData("text", text);
      node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
    }, text);
    await input.fill("00000");
    await expect(progress).toContainText("Scanned 0 / 2");
    await input.fill("000001"); await input.press("Enter");
    await expect(progress).toContainText("Scanned 1 / 2");
    await input.fill("000001\n000001"); await input.press("Tab");
    await expect(progress).toContainText("Scanned 1 / 2");
    await expect(page.getByRole("alert")).toContainText("000001");
    await paste("000002\n000003\n000002");
    await expect(progress).toContainText("Scanning complete");
    assert.deepEqual((await value.textContent()).trim().split("\n"), ["000001", "000002"]);
    await quantity.fill("1");
    await expect(progress).toContainText("1 extra");
    await expect(value).toHaveText("000001\n000002\n");
    await paste("000003");
    assert.deepEqual((await value.textContent()).trim().split("\n"), ["000001", "000002"]);
    await input.fill("000001\n");
    await quantity.fill("2");
    await input.fill("000001\n00000");
    await page.getByRole("button", { name: "Another field", exact: true }).click();
    await expect(input).toHaveValue("000001\n00000");
    await expect(progress).toContainText("Scanned 1 / 2");
    await input.fill("000001\n000002"); await input.press("Tab");
    await expect(progress).toContainText("0 left to scan");
    await quantity.fill("3"); await paste("TAKEN");
    await expect(page.getByRole("alert")).toContainText("TAKEN");
    await expect(progress).toContainText("Scanned 2 / 3");
    await page.getByRole("button", { name: "Array-backed draft", exact: true }).click();
    await input.fill("00000");
    await expect(input).toHaveValue("00000");
    await expect(progress).toContainText("Scanned 0 / 2");
    await input.fill("000007"); await input.press("Enter");
    await expect(progress).toContainText("Scanned 1 / 2");
    await page.getByRole("button", { name: "Restore saved captures", exact: true }).click();
    await expect(progress).toContainText("Scanning complete");
    await quantity.fill("1"); await expect(progress).toContainText("1 extra");
    await quantity.fill("2");
    await fs.mkdir("generated-artifacts/inventory-serial-scans", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory-serial-scans/shared-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "generated-artifacts/inventory-serial-scans/shared-phone.png" });
    assert.deepEqual(errors, []);
    console.log("PASS shared scanner: partial prefixes, Enter/Tab/paste, duplicates, quantity caps, reduced-quantity preservation, blocked identities, array-backed echoes and saved capture restoration.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
