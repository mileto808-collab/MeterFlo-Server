import test from "node:test";
import assert from "node:assert/strict";
import { parsePickTicketQr } from "../shared/inventory-pick-ticket";

const id = "e8536bc2-1ba1-4f10-8f13-a43c7df002cc";
test("printed, portable and relative ticket URLs resolve only to local identities", () => {
  for (const value of [`https://old-instance.example/projects/3/work-orders?pickup=${id}`,
    `/projects/3/work-orders?pickup=${id}`, `http://standalone.local/projects/3/inventory?pickup=${id}`,
    ` /projects/3/inventory/?pickup=${id.toUpperCase()}\r\n`])
    assert.deepEqual(parsePickTicketQr(value, 3), { kind: "ticket", projectId: 3, batchId: id });
  assert.deepEqual(parsePickTicketQr(`/projects/4/work-orders?pickup=${id}`, 3), { kind: "wrong_project", projectId: 4 });
});
test("ordinary serials, arbitrary URLs and ambiguous or executable payloads are not tickets", () => {
  for (const value of ["MF260000001", id, "", "x".repeat(4097), `javascript:/projects/3/inventory?pickup=${id}`,
    `ftp://example.test/projects/3/inventory?pickup=${id}`, `//example.test/projects/3/inventory?pickup=${id}`,
    `/projects/3/work-orders?pickup=MF260000001`, `/projects/03/work-orders?pickup=${id}`,
    `/projects/3/work-orders?pickup=${id}&pickup=${id}`, `/projects/3/work-orders?pickup=${id}#fragment`,
    `https://user:password@example.test/projects/3/work-orders?pickup=${id}`,
    `/projects/999999999999999999999/work-orders?pickup=${id}`, `https://example.test/?pickup=${id}`])
    assert.deepEqual(parsePickTicketQr(value, 3), { kind: "invalid" }, value);
});
test("scanner-uppercase and mixed-case links resolve to canonical local batch identities", () => {
  for (const value of [
    `HTTPS://SCANNER.EXAMPLE/PROJECTS/3/WORK-ORDERS?PICKUP=${id.toUpperCase()}`,
    `/PrOjEcTs/3/InVeNtOrY?PiCkUp=${id.toUpperCase()}`,
    `https://scanner.example/PROJECTS/3/WORK-ORDERS/?PICKUP=${id}`,
  ]) assert.deepEqual(parsePickTicketQr(value, 3), { kind: "ticket", projectId: 3, batchId: id });
  assert.deepEqual(parsePickTicketQr(`/PROJECTS/4/WORK-ORDERS?PICKUP=${id}`, 3),
    { kind: "wrong_project", projectId: 4 });
});
test("case-insensitive pickup matching still rejects duplicate identities and unsafe URLs", () => {
  for (const value of [
    `/PROJECTS/3/WORK-ORDERS?pickup=${id}&PICKUP=${id}`,
    `/PROJECTS/3/WORK-ORDERS?PICKUP=${id}&PiCkUp=${id}`,
    `/PROJECTS/3/WORK-ORDERS?PICKUP=NOT-A-BATCH`,
    `HTTPS://USER:PASS@SCANNER.EXAMPLE/PROJECTS/3/WORK-ORDERS?PICKUP=${id}`,
    `/PROJECTS/3/WORK-ORDERS?PICKUP=${id}#fragment`,
    `JAVASCRIPT:/PROJECTS/3/WORK-ORDERS?PICKUP=${id}`,
  ]) assert.deepEqual(parsePickTicketQr(value, 3), { kind: "invalid" }, value);
});
