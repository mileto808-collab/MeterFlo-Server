import { pathToFileURL } from "node:url";
import { coreIdentity, gitText, reviewGit, commitPattern, tagPattern, type ReviewGit } from "./core-release-git";

export async function checkCoreReleaseReadiness(root: string, tag: string, git: ReviewGit = reviewGit) {
  if (!tagPattern.test(tag)) throw new Error("Use an exact --tag vMAJOR.MINOR.PATCH.");
  if ((await gitText(git, root, ["status", "--porcelain=v1", "--untracked-files=all"])).trim())
    throw new Error("Core working tree/index must be clean. Commit and test reviewed release source first.");
  const commit = (await gitText(git, root, ["rev-parse", "HEAD"])).trim();
  if (!commitPattern.test(commit)) throw new Error("Core HEAD identity is unavailable.");
  const metadata = await coreIdentity(git, root, commit, tag);
  const existing = await git(root, ["rev-parse", "--verify", `refs/tags/${tag}^{commit}`]);
  if (existing.code === 0 && existing.stdout.trim() !== commit)
    throw new Error("Existing release tag points to another commit. Released tags must not move.");
  return { readyForOperatorReview: true, tag, commit, version: metadata.version,
    schemaVersion: metadata.schemaVersion, extensionApiVersion: metadata.extensionApiVersion,
    tagExists: existing.code === 0, tests: "not-run-by-this-command",
    next: ["Verify checks/build/regression results for this exact commit.", "Create/push the immutable tag only after explicit release approval.",
      "Publish release notes/feed explicitly; a push to main is not a numbered release."] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== "--tag") throw new Error("Usage: npm run check:core-release -- --tag vMAJOR.MINOR.PATCH");
    console.log(JSON.stringify(await checkCoreReleaseReadiness(process.cwd(), args[1]), null, 2));
    console.log("Read-only readiness check: no tag, push, SQL, baseline, service restart or publication was performed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Core release readiness could not be verified.");
    process.exitCode = 1;
  }
}
