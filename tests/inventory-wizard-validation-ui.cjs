const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const root = `/api/projects/${fixture.projectId}`, inventory = `${root}/inventory`;
  const request = async (method, path, data) => {
    const response = await context.request.fetch(path, { method, data });
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const command = (action, data) => request("POST", `${inventory}/commands`, { operationId: randomUUID(), action, data });
  try {
    await request("POST", "/api/auth/local/login", fixture);
    const user = await request("GET", "/api/auth/user");
    await command("warehouse", { id: "validation-source", code: "V-SOURCE", name: "Validation source", type: "physical", address: "Fixture source" });
    await command("warehouse", { id: "validation-stage", code: "V-STAGE", name: "Validation staging", type: "physical",
      locationTypeId: "57e15eca-f991-4328-a091-000000000003", address: "Fixture staging" });
    await command("warehouse", { id: "validation-vehicle", code: "V-VAN", name: "Validation vehicle", type: "vehicle",
      vin: "1HGCM82633A004352", plate: "VALID", plateState: "CO", userIds: [user.id] });
    await command("item", { id: "validation-meter", sku: "V-METER", name: "Validation meter", tracking: "serialized", equipment: "system" });
    await command("vendor", { id: "validation-vendor", name: "Validation vendor" });
    await command("order", { id: "validation-po", type: "purchase", vendorId: "validation-vendor", destinationId: "validation-source",
      lines: [{ itemId: "validation-meter", quantity: 3 }] });
    await command("release", { orderId: "validation-po" });
    await command("receive", { orderId: "validation-po", lines: [{ itemId: "validation-meter", quantity: 3, serials: ["VALID-A", "VALID-B", "VALID-C"] }] });
    const group = await request("POST", "/api/user-groups", { name: `Validation ${randomUUID().slice(0, 8)}`, projectIds: [fixture.projectId] });
    const services = await request("GET", "/api/service-types");
    const work = await request("POST", `${root}/work-orders`, { customerWoId: "VALIDATION-WORK", customerName: "Fixture only",
      serviceType: services[0].code, route: "Validation route", status: "Open", assignedGroupId: group.name });
    await command("plan", { workOrderId: work.id, revision: 0,
      lines: [{ id: randomUUID(), itemId: "validation-meter", kind: "addition", quantity: 2, reason: "" }] });

    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByTestId("button-start-inventory-desktop").or(page.getByTestId("button-start-inventory-mobile")).filter({ visible: true }).click().catch(async error => {
      console.error("Wizard launch diagnostics:", page.url(), errors, await page.locator("body").innerText());
      throw error;
    });
    await page.getByRole("button", { name: /Fulfill \/ Stage Work Orders/ }).click();
    const wizard = page.getByTestId("inventory-fulfillment-page");
    const body = page.getByTestId("fulfillment-step-body");
    const noKeyboardAndTop = async () => {
      await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(0);
      assert.equal(await page.evaluate(() => document.activeElement.matches("input,textarea")), false, "Navigation must not focus an input");
    };
    await noKeyboardAndTop();
    await page.getByRole("button", { name: /^New crew batch/ }).click();
    await noKeyboardAndTop();
    await expect(page.getByRole("button", { name: "Next: Batch setup", exact: true })).toBeDisabled();
    await page.getByRole("checkbox", { name: "Select all eligible matching orders", exact: true }).check();
    await page.getByRole("button", { name: "Next: Batch setup", exact: true }).click();
    await noKeyboardAndTop();
    await page.locator("#batch-name").fill("");
    await expect(page.getByRole("button", { name: "Next: Review batch", exact: true })).toBeDisabled();
    await page.locator("#batch-name").fill("Validation batch");
    for (const [id, text] of [["batch-source", "Validation source"], ["batch-staging", "Validation staging"], ["batch-vehicle", "Validation vehicle"]]) {
      await page.locator(`#${id}`).click();
      await page.getByRole("option", { name: new RegExp(text) }).click();
      await expect(page.getByRole("listbox")).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Next: Review batch", exact: true }).click();
    await noKeyboardAndTop();
    await page.getByRole("button", { name: "Create batch", exact: true }).click();
    await page.getByRole("button", { name: "Picking complete — enter quantities", exact: true }).click();
    await noKeyboardAndTop();
    const quantity = page.getByTestId("fulfillment-move-quantity-stage-validation-meter");
    const scans = page.getByTestId("fulfillment-custody-serials-stage-validation-meter");
    const next = page.getByRole("button", { name: "Next: Confirm", exact: true });
    await expect(next).toBeDisabled();
    await quantity.fill("2");
    await expect(next).toBeDisabled(); // Original reported regression.
    await scans.fill("VALID-A");
    await scans.press("Enter");
    await expect(next).toBeDisabled();
    await scans.fill("VALID-A\nVALID-A");
    await scans.press("Enter");
    await expect(next).toBeDisabled();
    await scans.fill("VALID-A\nVALID-B");
    await scans.press("Enter");
    await expect(next).toBeEnabled();
    await next.click();
    await noKeyboardAndTop();
    const review = page.getByRole("button", { name: "Next: Review movement", exact: true });
    await expect(review).toBeDisabled();
    await page.locator("#fulfillment-reason").fill("Confirmed physical movement");
    await expect(review).toBeDisabled();
    await expect(page.locator("#fulfillment-physical-confirmation")).toHaveAttribute("data-wizard-focus-target", "true");
    await page.locator("#fulfillment-physical-confirmation").check();
    await review.click();
    await noKeyboardAndTop();
    await expect(page.getByRole("button", { name: "Record physical pull", exact: true })).toBeEnabled();
    await fs.mkdir("generated-artifacts/inventory-wizard-validation", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory-wizard-validation/phone-review.jpg" });
    await page.getByRole("button", { name: "Record physical pull", exact: true }).click();
    await page.getByRole("button", { name: "Continue to vehicle pickup", exact: true }).click();
    await page.getByRole("button", { name: "Next: Capture handoff", exact: true }).click();
    await noKeyboardAndTop();
    await page.getByTestId("fulfillment-move-quantity-vehicle-validation-meter").fill("2");
    await expect(next).toBeDisabled();
    await page.getByTestId("fulfillment-accept-staged-validation-meter").click();
    await expect(next).toBeEnabled();
    await next.click();
    await noKeyboardAndTop();
    await expect(review).toBeDisabled();
    await page.locator("#fulfillment-reason").fill("Confirmed receiving vehicle handoff");
    await expect(review).toBeDisabled();
    await page.locator("#fulfillment-physical-confirmation").check();
    await review.click();
    await noKeyboardAndTop();
    await page.getByRole("button", { name: "Record vehicle handoff", exact: true }).click();
    await expect.poll(async () => {
      const final = await request("GET", `${inventory}/fulfillment`);
      return final.batches.find(value => value.name === "Validation batch").status;
    }).toBe("completed");
    assert.deepEqual(errors, []);
    console.log("Inventory wizard step gates, visual guidance and phone navigation passed.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
