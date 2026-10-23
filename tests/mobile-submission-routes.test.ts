import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.createSourceFile("routes.ts", readFileSync("server/routes.ts", "utf8"), ts.ScriptTarget.Latest, true);
const endpoints = new Map<string, ts.CallExpression>();
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "post" && ts.isStringLiteral(node.arguments[0]))
    endpoints.set(node.arguments[0].text, node);
  ts.forEachChild(node, visit);
}
visit(source);
const syncPath = "/api/projects/:projectId/mobile/sync/upload";

test("each mobile completion/trouble endpoint is guarded before its handler", () => {
  for (const [path, expected] of [
    ["/api/projects/:projectId/mobile/work-orders/:workOrderId/complete-changeout", "auto"],
    ["/api/mobile/projects/:projectId/work-orders/:workOrderId/complete", "complete"],
    ["/api/mobile/projects/:projectId/work-orders/:workOrderId/trouble", "trouble"],
  ]) {
    const endpoint = endpoints.get(path)!;
    assert.ok(endpoint);
    let last = endpoint.arguments.at(-1)!;
    if (ts.isBinaryExpression(last)) last = last.right;
    assert.ok(ts.isCallExpression(last));
    assert.equal(last.expression.getText(source), "mobileSubmissionRoute");
    assert.equal((last.arguments[0] as ts.StringLiteral).text, expected);
  }
});

test("actual batch handler routes new captures before legacy conflicts and reports per-item acknowledgements", async () => {
  const body = endpoints.get(syncPath)!.arguments.at(-1)!.getText(source);
  const invoked: any[] = [], legacyUpdates: any[] = [];
  const context = {
    console,
    storage: {
      getUser: async () => ({ id: "actor", role: "admin" }),
      getProject: async () => ({ id: 7, databaseName: "project_fixture" }),
    },
    getProjectWorkOrderStorage: () => ({
      getWorkOrder: async () => ({ id: 10, updatedAt: new Date("2026-10-22") }),
      updateWorkOrder: async (...args: any[]) => legacyUpdates.push(args),
    }),
    mobileCompleteHandler: "complete-handler", mobileTroubleHandler: "trouble-handler",
    mobileSubmissionBatchItem: async (handler: string, _req: any, id: number, data: any) => {
      invoked.push({ handler, id, data });
      return id === 3 ? { status: 409, payload: { code: "CHANGEOUT_ATTEMPT_CHANGED", message: "Reassigned" } } :
        { status: 200, payload: { submission: { submissionId: data.changeoutSubmissionId, fieldStatus: "accepted" } } };
    },
    visitSchedulingKeys: [], validateCapturedReadings: () => [], emitWorkOrderUpdated: () => {},
    InventoryError: class extends Error {},
  };
  const js = ts.transpileModule(`globalThis.handler = ${body}`, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const sandbox: any = vm.createContext(context);
  vm.runInContext(js, sandbox);
  let status = 200, response: any;
  await sandbox.handler({
    params: { projectId: "7" }, user: { claims: { sub: "actor" } }, body: {
      workOrders: [
        { workOrderId: 1, changeType: "complete", clientUpdatedAt: "2001-01-01",
          data: { changeoutSubmissionId: "one", changeoutAssignmentVersion: 1, notes: "original" } },
        { workOrderId: 2, changeType: "trouble", data: { changeoutSubmissionId: "two", changeoutAssignmentVersion: 2 } },
        { workOrderId: 3, changeType: "complete", data: { changeoutSubmissionId: "three", changeoutAssignmentVersion: 1 } },
        { workOrderId: 4, changeType: "unknown", data: { changeoutSubmissionId: "four" } },
        { id: 10, notes: "legacy edit" },
      ],
    },
  }, { status(value: number) { status = value; return this; }, json(value: any) { response = value; return this; } });
  assert.equal(status, 200);
  assert.equal(invoked.length, 3);
  assert.equal(invoked[0].handler, "complete-handler");
  assert.equal(invoked[0].data.notes, "original");
  assert.equal(invoked[1].handler, "trouble-handler");
  assert.deepEqual(Array.from(response.results, (result: any) => result.status), ["success", "success", "conflict", "error", "success"]);
  assert.equal(response.results[0].submission.submissionId, "one");
  assert.equal(response.results[2].code, "CHANGEOUT_ATTEMPT_CHANGED");
  assert.equal(response.results[2].httpStatus, 409);
  assert.equal(response.results[3].submissionId, "four");
  assert.equal(legacyUpdates.length, 1);
  assert.equal(response.summary.successful, 3);
  assert.equal(response.summary.conflicts, 1);
  assert.equal(response.summary.errors, 1);
});
