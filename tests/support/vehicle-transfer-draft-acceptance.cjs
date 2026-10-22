const assert = require("node:assert/strict");
module.exports = async function verifyDrafts({ request, operator, otherOperator, tech, inv }) {
  const url = `${inv}/vehicle-transfer-drafts`;
  const raw = (context, method, path, data) => context.request.fetch(path, { method, data });
  const empty = { mode: "stock" };
  const emptyResponse = await raw(operator, "POST", `${url}/${crypto.randomUUID()}`,
    { revision: 0, saveId: crypto.randomUUID(), capture: empty });
  assert.equal(emptyResponse.status(), 409);
  assert.match(await emptyResponse.text(), /enter handover inputs/i);
  assert.deepEqual((await request("GET", url, undefined, operator)).drafts, []);
  const id = crypto.randomUUID();
  const capture = { mode: "stock", sourceId: "vt-0", destinationId: "vt-1", batchId: "",
    selectedOrders: [], installerId: "", quantities: { "vt-part": "1" }, scans: { "vt-meter": "VT-PARTIAL" },
    reason: "Crews checked the physical fittings" };
  const firstBody = { revision: 0, saveId: crypto.randomUUID(), capture };
  const first = (await request("POST", `${url}/${id}`, firstBody, operator)).draft;
  assert.equal((await request("POST", `${url}/${id}`, { ...firstBody, saveId: crypto.randomUUID() }, operator))
    .draft.revision, first.revision, "unchanged capture does not manufacture another edit or revision");
  assert.equal((await request("POST", `${url}/${id}`, firstBody, operator)).draft.revision, first.revision);
  assert.equal((await request("GET", url, undefined, otherOperator)).drafts.find(value => value.id === id)
    .capture.scans["vt-meter"], "VT-PARTIAL");
  assert.equal((await raw(tech, "GET", url)).status(), 403);
  const updated = (await request("POST", `${url}/${id}`, { revision: first.revision, saveId: crypto.randomUUID(),
    capture: { ...capture, scans: {}, quantities: { "vt-part": "2" } } }, otherOperator)).draft;
  assert.equal((await raw(operator, "POST", `${url}/${id}`, { ...firstBody, saveId: crypto.randomUUID(),
    revision: first.revision })).status(), 409);
  await request("DELETE", `${url}/${id}`, { revision: updated.revision }, otherOperator);
  assert.equal((await raw(operator, "POST", `${url}/${id}`, firstBody)).status(), 409);
  assert.ok(!(await request("GET", url, undefined, operator)).drafts.some(value => value.id === id));
  const boundId = crypto.randomUUID();
  const cleanCapture = { ...capture, scans: {} };
  const saved = (await request("POST", `${url}/${boundId}`, { revision: 0, saveId: crypto.randomUUID(),
    capture: cleanCapture }, operator)).draft;
  const makeCommand = () => ({ operationId: crypto.randomUUID(), action: "vehicleTransfer", data: {
    mode: "stock", revision: 0, sourceId: "vt-0", destinationId: "vt-1", workOrders: [],
    lines: [{ itemId: "vt-part", quantity: 1, serials: [] }], reason: cleanCapture.reason, physicallyConfirmed: true,
  } });
  const candidate = makeCommand();
  const prepared = (await request("POST", `${url}/${boundId}/prepare`,
    { revision: saved.revision, command: candidate }, operator)).draft;
  assert.equal(prepared.status, "submitting");
  assert.equal(prepared.command.data.draftId, boundId);
  assert.deepEqual((await request("POST", `${url}/${boundId}/prepare`,
    { revision: saved.revision, command: candidate }, operator)).draft.command, prepared.command);
  assert.deepEqual((await request("GET", url, undefined, otherOperator)).drafts.find(value => value.id === boundId)
    .command, prepared.command, "another authorized worker resumes exactly the same pending request");
  assert.equal((await raw(operator, "DELETE", `${url}/${boundId}`, { revision: prepared.revision })).status(), 409);
  const unlocked = (await request("POST", `${url}/${boundId}/unlock`,
    { revision: prepared.revision, operationId: prepared.command.operationId }, otherOperator)).draft;
  assert.equal(unlocked.status, "editing");
  assert.equal((await request("POST", `${url}/${boundId}/unlock`,
    { revision: prepared.revision, operationId: prepared.command.operationId }, operator)).draft.revision, unlocked.revision,
  "two workers can safely resolve the same rejected request");
  assert.equal((await raw(operator, "POST", `${inv}/commands`, prepared.command)).status(), 409,
    "a delayed request cannot post after resolution");
  const fresh = (await request("POST", `${url}/${boundId}/prepare`,
    { revision: unlocked.revision, command: makeCommand() }, otherOperator)).draft;
  const superseded = await request("POST", `${url}/${boundId}/unlock`,
    { revision: prepared.revision, operationId: prepared.command.operationId }, operator);
  assert.equal(superseded.inactiveOperationId, prepared.command.operationId);
  assert.deepEqual(superseded.draft.command, fresh.command, "resolving the old request cannot unlock a newer command");
  await request("POST", `${inv}/commands`, fresh.command, otherOperator);
  const replay = await request("POST", `${inv}/commands`, fresh.command, operator);
  assert.equal(replay.state.receipts.filter(value => value.id === fresh.command.operationId).length, 1);
  assert.equal(replay.state.stock.find(value => value.warehouseId === "vt-0" && value.itemId === "vt-part").quantity, 4);
  assert.ok(!(await request("GET", url, undefined, operator)).drafts.some(value => value.id === boundId));
  assert.equal((await raw(operator, "POST", `${url}/${boundId}`, { revision: 0,
    saveId: crypto.randomUUID(), capture: cleanCapture })).status(), 409);
  assert.equal((await raw(operator, "DELETE", `${url}/${boundId}`, { revision: fresh.revision })).status(), 409);
  console.log("Shared vehicle handover draft API checks passed.");
};
