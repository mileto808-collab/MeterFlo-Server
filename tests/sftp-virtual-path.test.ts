import assert from "node:assert/strict";
import { test } from "node:test";
import { sftpVirtualPath } from "../server/file-transfers/virtual-path";

test("canonicalizes current-directory discovery and virtual directory navigation", () => {
  const examples: [string, string][] = [
    ["", "/"], [".", "/"], ["/", "/"], ["/.", "/"], ["/./", "/"], ["./.", "/"],
    ["///", "/"], ["//.", "/"], ["//./", "/"], ["///./incoming", "/incoming"],
    ["incoming", "/incoming"], ["./incoming/.", "/incoming"],
    ["/incoming//./", "/incoming"], ["/outgoing//", "/outgoing"],
    ["/incoming/..", "/"], ["/outgoing/../.", "/"],
    ["/incoming/../outgoing/.", "/outgoing"], ["/outgoing/../incoming/", "/incoming"],
    ["/./incoming//orders.csv", "/incoming/orders.csv"],
    ["./outgoing//./orders.xlsx", "/outgoing/orders.xlsx"],
  ];
  for (const [input, expected] of examples) {
    assert.equal(sftpVirtualPath(input), expected, input);
    assert.equal(sftpVirtualPath(expected), expected, "canonical paths are idempotent");
  }
});

test("rejects escape, operating-system paths and invalid intermediate components", () => {
  const invalid = [
    "..", "/..", "/../../etc/passwd", "/incoming/../../outgoing/orders.csv",
    "/unknown/../incoming", "/incoming/child/../orders.csv", "/incoming/a.csv/..",
    "/incoming/a.csv/.", "/incoming/a.csv/", "/incoming/a.csv/./other.csv",
    "C:/incoming/orders.csv", "C:\\incoming\\orders.csv", "\\\\server\\share",
    "//server/share", "//incoming/orders.csv", "/incoming/..\\outgoing/orders.csv",
    "/incoming/%2e%2e/orders.csv", "/incoming/a.exe", "/incoming/a.csv:stream",
    "/incoming/a\0.csv", "/incoming/a\n.csv", "/incoming/a\x7f.csv", "a".repeat(251),
  ];
  for (const input of invalid) assert.throws(() => sftpVirtualPath(input), undefined, JSON.stringify(input));
});
