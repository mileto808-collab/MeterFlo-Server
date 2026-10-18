import path from "node:path";
import { prepareForkReview, reviewFork } from "./customer-fork-update";

const args = process.argv.slice(2), action = args.shift();
const values = new Map<string, string>(), flags = new Set<string>();
try {
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (["--confirm-tests", "--confirm-customizations", "--confirm-dependencies", "--confirm-migrations"].includes(key)) {
      if (flags.has(key)) throw new Error("Duplicate confirmation flag.");
      flags.add(key);
    } else if (["--tag", "--commit", "--target"].includes(key) && args[i + 1] && !args[i + 1].startsWith("--")) {
      if (values.has(key)) throw new Error("Duplicate argument.");
      values.set(key, args[++i]);
    } else throw new Error("Invalid arguments; see Customer Core Updates documentation.");
  }
  const target = values.get("--target");
  if (!target || !path.isAbsolute(target)) throw new Error("--target must be an absolute directory path (quote paths containing spaces).");
  if (action === "prepare" && (flags.size || values.size !== 3)) throw new Error("Prepare requires only --tag, --commit and --target.");
  if (action !== "prepare" && (values.size !== 1 || (action !== "approve" && flags.size))) throw new Error("Review actions require only --target; confirmation flags belong to approve.");
  const result = action === "prepare"
    ? await prepareForkReview({ root: process.cwd(), target, tag: values.get("--tag")!, commit: values.get("--commit")! })
    : ["status", "resume", "abort", "approve"].includes(action ?? "")
      ? await reviewFork(target, action as "status" | "resume" | "abort" | "approve", {
        tests: flags.has("--confirm-tests"), customizations: flags.has("--confirm-customizations"),
        dependencies: flags.has("--confirm-dependencies"), migrations: flags.has("--confirm-migrations"),
      }) : (() => { throw new Error("Select prepare, status, resume, abort or approve."); })();
  console.log(JSON.stringify({ state: result.state, phase: result.phase, tag: result.tag, coreCommit: result.coreCommit,
    customerStart: result.customerStart, combinedCommit: result.combinedCommit ?? null,
    conflicts: result.conflicts, reviewRequired: result.reviewRequired, approval: result.approval ?? null }, null, 2));
  console.log(result.state === "approved"
    ? "Operator review recorded for the exact combined commit. This is NOT a staging receipt, activation or publication."
    : "No live source, database, configuration or service was replaced. Work only in the review checkout; deployment remains explicit.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Review failed; retain its directory for private diagnostics.");
  process.exitCode = 1;
}
