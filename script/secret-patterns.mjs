import ts from "typescript";

export const privateEnvironmentPath = file =>
  /(?:^|\/)\.env(?:$|\.)/i.test(file) && !/(?:^|\/)\.env\.example$/.test(file);
export const privateConfigPath = file => file === "deploy/ecosystem.config.cjs" ||
  /(?:^|\/)dump\.pm2(?:\.bak)?$/i.test(file) || /^generated-artifacts\//.test(file);
export const deploymentConfigPath = file => /^deploy\/ecosystem[^/]*\.(?:cjs|js|mjs)$/.test(file);

function classify(value, file) {
  const clean = value.trim().replace(/[`.,]$/, "");
  if (!clean || /^(?:change[_-]?me(?:[_-].*)?|your(?:[_-].*|password|session_secret)|set-in-env-not-here|generate-a-.*|<[^>]+>)$/i.test(clean))
    return "placeholder";
  if (/\$\{|\bprocess\.env\b/.test(clean)) return "dynamic-reference";
  if (/^(?:\*{3,}|\[REDACTED\])$/i.test(clean) && /\.(?:tsx?|jsx?)$/.test(file)) return "redaction-marker";
  if (/^tests?\//.test(file) && /^(?:fixture[-_]|mock-|dummy-|test-|[a-z-]+-fixture-|password$|pass$|x$)/i.test(clean)) return "synthetic-test";
  if (/\.md$/.test(file) && /^(?:password|password123|pass|Pa\$\$word#123|example[-_].*)$/.test(clean)) return "documented-example";
  return "potential-credential";
}

/** Values are examined only inside this function, never returned or logged. */
export function scanText(file, text, { validateConfig = true, audit = false } = {}) {
  const findings = [];
  const add = (position, rule, key, classification, blocking = classification === "potential-credential") => {
    findings.push({ file, line: text.slice(0, position).split("\n").length, rule, key, classification, blocking });
  };
  const secretName = key => key === "DATABASE_URL" ||
    /(?:^|_)(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)$/i.test(key) ||
    /(?:Password|Secret|Token|ApiKey)$/.test(key);
  const literal = (key, value, position) => {
    if (!secretName(key)) return;
    // URLs are classified by their password component below.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return;
    const classification = file === "shared/schema.ts" && key.includes("_") &&
      value.replace(/[^a-z0-9]/gi, "").toLowerCase() === key.replaceAll("_", "").toLowerCase()
      ? "permission-symbol" : classify(value, file);
    add(position, "credential-assignment", key.toUpperCase(), classification);
  };
  if (/\.(?:c?js|mjs|jsx|tsx?)$/.test(file)) {
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
      /tsx$/.test(file) ? ts.ScriptKind.TSX : /jsx$/.test(file) ? ts.ScriptKind.JSX : ts.ScriptKind.TS);
    function visit(node) {
      if ((ts.isPropertyAssignment(node) || ts.isVariableDeclaration(node)) &&
          (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && node.initializer &&
          (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)))
        literal(node.name.text, node.initializer.text, node.getStart(ast));
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(node.left) && ts.isStringLiteral(node.right))
        literal(node.left.name.text, node.right.text, node.getStart(ast));
      if (audit && ts.isCallExpression(node) && node.expression.getText(ast) === "bcrypt.hash" &&
          node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
        add(node.getStart(ast), "shared-bootstrap-password", "BOOTSTRAP_PASSWORD",
          /^tests?\//.test(file) ? "synthetic-test" : "shared-bootstrap-default", false);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  } else if (/\.json$/.test(file)) {
    try {
      const visit = object => {
        if (!object || typeof object !== "object") return;
        for (const [key, value] of Object.entries(object)) {
          if (typeof value === "string") literal(key, value, Math.max(0, text.indexOf(JSON.stringify(key))));
          else visit(value);
        }
      };
      visit(JSON.parse(text));
    } catch { /* Non-JSON historical content still receives URL/token checks. */ }
  } else {
    const assignments = /^[ \t]*(?:#[ \t]*)?["']?([a-z_][a-z0-9_]*)["']?[ \t]*[:=][ \t]*(.*)$/gmi;
    for (const match of text.matchAll(assignments)) {
      let value = match[2].trim().replace(/[,;]$/, "");
      if (/^["']/.test(value)) value = value.slice(1).replace(/["']$/, "");
      literal(match[1], value, match.index);
    }
  }
  for (const match of text.matchAll(/\b(?:postgres(?:ql)?|mysql|mssql|mongodb(?:\+srv)?|redis|https?):\/\/[^/\s:'"`]+:([^@\s'"`]+)@/gi)) {
    let password;
    try { password = decodeURIComponent(match[1]); } catch { password = match[1]; }
    add(match.index, "credential-in-url", "URL_PASSWORD", classify(password, file));
  }
  for (const match of text.matchAll(/\bWITH[ \t]+PASSWORD[ \t]+['"]([^'"\r\n]+)['"]/gi))
    add(match.index, "sql-password", "DATABASE_PASSWORD", classify(match[1], file));
  for (const [rule, pattern] of [
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
    ["provider-token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|sk_live_[A-Za-z0-9]{20,})\b/g],
  ]) for (const match of text.matchAll(pattern)) add(match.index, rule, "CREDENTIAL_MATERIAL", "potential-credential");

  if (validateConfig && deploymentConfigPath(file)) {
    for (const match of text.matchAll(/^[ \t]*\/\/[ \t]*([A-Z_][A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY))[ \t]*[:=]/gmi))
      add(match.index, "commented-pm2-credential", "PM2_CONFIGURATION", "policy-violation", true);
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let guarded = false;
    function visit(node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === "validateProductionConfig") guarded = true;
      if (ts.isPropertyAssignment(node)) {
        const key = ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
        let invalid = /^(?:env.*|args|node_args|interpreter_args)$/.test(key);
        if (key === "env" && ts.isObjectLiteralExpression(node.initializer)) {
          const properties = node.initializer.properties;
          invalid = properties.length !== 1 || !properties.every(p =>
            ts.isPropertyAssignment(p) && p.name.getText(ast).replace(/['"]/g, "") === "NODE_ENV" &&
            ts.isStringLiteral(p.initializer) && p.initializer.text === "production");
        }
        if (invalid) add(node.getStart(ast), "unsafe-pm2-override", "PM2_CONFIGURATION", "policy-violation", true);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    if (!guarded) add(0, "missing-pm2-guard", "PM2_CONFIGURATION", "policy-violation", true);
  }
  return findings.filter((item, index, all) => all.findIndex(other =>
    other.line === item.line && other.rule === item.rule && other.key === item.key) === index);
}
