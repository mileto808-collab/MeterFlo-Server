import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("inventory collector is a component-only Fast Refresh boundary", () => {
  const path = "client/src/components/inventory/actual-use-collector.tsx";
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const exported: string[] = [];
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement)) {
      assert.ok(statement.isTypeOnly, "Runtime helpers must be imported from their shared module, not re-exported by a React component.");
    } else if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      assert.ok(ts.isFunctionDeclaration(statement) && statement.name, "Only component functions may be exported at runtime.");
      exported.push(statement.name.text);
    }
  }
  assert.deepEqual(exported, ["ActualUseCollector"]);
});

test("wizard imports its runtime helpers directly rather than through a component boundary", () => {
  const path = "client/src/components/system-changeout-wizard.tsx";
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const componentImports: string[] = [], sharedImports: string[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const names = statement.importClause?.namedBindings;
    if (!names || !ts.isNamedImports(names)) continue;
    const values = names.elements.filter(name => !name.isTypeOnly).map(name => name.name.text);
    if (statement.moduleSpecifier.text === "./inventory/actual-use-collector") componentImports.push(...values);
    if (statement.moduleSpecifier.text === "@shared/inventory-wizard-use") sharedImports.push(...values);
  }
  assert.deepEqual(componentImports, ["ActualUseCollector"]);
  for (const name of ["initialActualUse", "actualUseLinesAreValid", "refreshApprovedUse", "inventoryWizardBasis"]) {
    assert.ok(sharedImports.includes(name), `${name} should come directly from the shared helper module.`);
  }
});
