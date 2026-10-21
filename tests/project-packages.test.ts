import { test } from "node:test";
import assert from "node:assert/strict";
import { safeRelative } from "../server/project-packages/files";
import { sanitize, privateField, ordered, type Table } from "../server/project-packages/catalog";

test("portable paths reject traversal, Windows device/ADS names and hidden separators", () => {
  for (const name of ["../escape", "/absolute", "a\\b", "a/../b", "C:/a", "files/a.txt:secret", "files/CON.txt", "a/NUL", "a/COM1.log", "a/end.", "a/end ", "a/\0"])
    assert.equal(safeRelative(name), false, name);
  assert.equal(safeRelative("files/documents/Project Documents/photo-001.jpg"), true);
});
test("credential redaction preserves business replay identities and environment references", () => {
  assert.deepEqual(sanitize({ credentials: { password: "secret" }, nested: [{ Authorization: "Bearer secret", itemId: "meter-1" }], operationId: "replay-1" }),
    { credentials: null, nested: [{ Authorization: "", itemId: "meter-1" }], operationId: "replay-1" });
  assert.equal(privateField("customer_api_secret_env_var"), false);
  assert.equal(privateField("password_hash"), true);
  assert.equal(privateField("operation_id"), false);
});
test("dependency ordering respects parent tables and rejects table cycles", () => {
  const table = (name: string, parent?: string): Table => ({ schema: "public", name, columns: [], primary: ["id"], unique: [],
    foreign: parent ? [{ schema: "public", table: parent, columns: ["parent"], references: ["id"], definition: "", name: "fk" }] : [] });
  assert.deepEqual(ordered([table("child", "parent"), table("parent")]).map(table => table.name), ["parent", "child"]);
  assert.throws(() => ordered([table("a", "b"), table("b", "a")]), /cyclic/);
});
