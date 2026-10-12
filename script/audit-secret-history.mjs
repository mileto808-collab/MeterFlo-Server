import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "./check-deployment-secrets.mjs";
import { privateEnvironmentPath, scanText } from "./secret-patterns.mjs";

/** Audit reachable objects only. Never emit source lines, excerpts or values. */
export function auditHistory(root) {
  const references = git(root, ["for-each-ref", "--format=%(objectname)"]).trim().split("\n").filter(Boolean);
  const revisions = [...new Set(references)].join("\n") + "\n";
  const objects = new Map();
  for (const line of git(root, ["rev-list", "--objects", "--stdin"], revisions).trim().split("\n")) {
    const split = line.indexOf(" ");
    const id = split < 0 ? line : line.slice(0, split);
    objects.set(id, split < 0 ? "" : line.slice(split + 1));
  }
  const metadata = git(root, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    [...objects.keys()].join("\n") + "\n").trim().split("\n");
  const groups = new Map();
  const counts = { textBlobs: 0, binaryBlobs: 0, oversizedBlobs: 0 };
  const record = (finding, object) => {
    const key = [finding.file, finding.rule, finding.key || "", finding.classification].join("\0");
    if (!groups.has(key)) groups.set(key, { file: finding.file, rule: finding.rule,
      key: finding.key, classification: finding.classification, occurrences: 0, locations: [] });
    const group = groups.get(key);
    group.occurrences++;
    if (group.locations.length < 3) group.locations.push({ object, line: finding.line });
  };
  for (const entry of metadata) {
    const [object, type, size] = entry.split(" ");
    if (type !== "blob") continue;
    const file = objects.get(object) || "(unresolved path)";
    if (Number(size) > 10 * 1024 * 1024) { counts.oversizedBlobs++; continue; }
    if (/\.(?:png|jpe?g|gif|webp|pdf|zip|gz|sqlite|db|mp[34]|woff2?|ico)$/i.test(file)) {
      counts.binaryBlobs++; continue;
    }
    const text = git(root, ["cat-file", "blob", object]);
    if (text.includes("\0")) { counts.binaryBlobs++; continue; }
    counts.textBlobs++;
    if (privateEnvironmentPath(file)) record({ file, rule: "historical-private-environment",
      classification: "review-required" }, object);
    for (const finding of scanText(file, text, { validateConfig: false, audit: true })) record(finding, object);
  }
  const findings = [...groups.values()].sort((a, b) =>
    a.classification.localeCompare(b.classification) || a.file.localeCompare(b.file));
  return {
    auditedAt: new Date().toISOString(),
    coverage: {
      references: references.length,
      reachableCommits: Number(git(root, ["rev-list", "--count", "--stdin"], revisions).trim()),
      shallow: git(root, ["rev-parse", "--is-shallow-repository"]).trim() === "true",
      ...counts,
    },
    limitations: [
      "Accessible local refs only; no remote fetch, credentials or provider verification.",
      "Patterns detect plaintext assignments, password URLs, SQL passwords and selected provider tokens/private-key headers, not every possible secret.",
      "Binary/oversized blobs, OCR, encrypted/encoded secrets, unreachable objects, reflogs, external forks and CI/PM2 artifacts are not audited.",
      "Object locations show representative paths; identical content reused under another name may not have every alias listed.",
      "Potential credential means a non-placeholder literal, not proof of provider validity or completed rotation.",
    ],
    findings,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== "--report")) throw new Error("Invalid arguments");
    const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
    const result = auditHistory(root);
    if (args.length) {
      const output = path.resolve(root, args[1]);
      if (!output.startsWith(path.join(root, "generated-artifacts") + path.sep)) throw new Error("Use ignored artifact directory");
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    }
    console.log(JSON.stringify({ coverage: result.coverage, groups: result.findings.length,
      potentialCredentialGroups: result.findings.filter(f => f.classification === "potential-credential").length,
      reportWritten: args.length > 0, rotationVerified: false }));
  } catch {
    console.error("History audit could not complete. Check Git access and report arguments; no source values were printed.");
    process.exitCode = 2;
  }
}
