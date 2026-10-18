import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { loadCustomerRelease, packageHash, compareReleaseVersions, ownedPath } from "../shared/customer-release";
import { coreIdentity, commitPattern, tagPattern, reviewGit, gitText, protectedSourceFile, validateDependencyLock, type CoreIdentity, type ReviewGit } from "./core-release-git";

export type ForkReview = {
  format: 1; id: string; target: string; source: string; coreSource: string; customerStart: string;
  tag: string; coreCommit: string; baseline: { version: string; commit: string };
  state: "preparing" | "merging" | "conflicts" | "review" | "approved" | "aborted";
  phase: "clone" | "checkout" | "fetch" | "merge";
  core?: CoreIdentity; combinedCommit?: string; configurationHash?: string; approval?: { at: string; kind: "operator-attestation"; tests: true; customizations: true; dependencies: true; migrations: true };
  conflicts: string[]; reviewRequired: string[]; extensionHashes: { directory: string; hash: string }[];
};
const receiptName = "review.json";
function canonical(file: string) { return process.platform === "win32" ? file.toLowerCase() : file; }
function resolvedNewPath(file: string) {
  const absolute = path.resolve(file);
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  return path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, absolute));
}
function checkOutside(source: string, target: string) {
  const a = canonical(source), b = canonical(target);
  if (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep))
    throw new Error("Review directory must be new and outside the source installation, not its parent.");
}
function save(review: ForkReview) {
  const file = path.join(review.target, receiptName), temporary = `${file}.${randomUUID()}.pending`;
  fs.writeFileSync(temporary, JSON.stringify(review, null, 2), { flag: "wx", mode: 0o600 });
  fs.renameSync(temporary, file);
}
function load(target: string): ForkReview {
  const directory = fs.realpathSync(target);
  const file = path.join(directory, receiptName);
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error("Review journal must not be a symbolic link.");
  let review: ForkReview;
  try { review = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("Review journal is unreadable; retain this directory for private recovery."); }
  if (review.format !== 1 || review.target !== directory || !commitPattern.test(review.customerStart) ||
      !commitPattern.test(review.coreCommit) || !tagPattern.test(review.tag) ||
      !review.baseline || !commitPattern.test(review.baseline.commit) ||
      !["preparing", "merging", "conflicts", "review", "approved", "aborted"].includes(review.state) ||
      !["clone", "checkout", "fetch", "merge"].includes(review.phase) ||
      !Array.isArray(review.extensionHashes) || !Array.isArray(review.reviewRequired))
    throw new Error("Review identity is invalid or the directory was moved; do not fabricate a journal.");
  checkOutside(review.source, directory);
  return review;
}
async function locked<T>(target: string, action: () => Promise<T>) {
  const file = path.join(target, ".review.lock");
  let descriptor: number;
  try { descriptor = fs.openSync(file, "wx", 0o600); }
  catch { throw new Error("A review operation is locked. Confirm its process has exited before removing .review.lock; do not run operations concurrently."); }
  fs.writeFileSync(descriptor, String(process.pid)); fs.closeSync(descriptor);
  try { return await action(); } finally { fs.unlinkSync(file); }
}
async function sourceClean(git: ReviewGit, root: string) {
  const top = (await gitText(git, root, ["rev-parse", "--show-toplevel"])).trim();
  if (canonical(fs.realpathSync(top)) !== canonical(root)) throw new Error("Run from the customer Git checkout root.");
  if ((await gitText(git, root, ["status", "--porcelain=v1", "--untracked-files=all"])).trim())
    throw new Error("Customer source has staged, unstaged or untracked changes. Review and commit source privately before preparing; no files were discarded.");
  if ((await git(root, ["rev-parse", "--verify", "MERGE_HEAD"])).code === 0)
    throw new Error("Finish or abort the existing source merge before preparing a review.");
  const files = (await gitText(git, root, ["ls-files", "-z"])).split("\0").filter(Boolean);
  if (files.some(protectedSourceFile)) throw new Error("Protected instance/data files are tracked. Establish a reviewed source-only baseline before cloning; do not just delete them.");
  if (/^160000 /m.test(await gitText(git, root, ["ls-files", "--stage"])))
    throw new Error("Customer source uses submodules. Preserve and reconcile their independent source history through reviewed adoption first.");
}
async function verifyReviewCheckout(review: ForkReview, git: ReviewGit) {
  const checkout = path.join(review.target, "checkout");
  if (fs.lstatSync(checkout).isSymbolicLink() || fs.realpathSync(checkout) !== checkout)
    throw new Error("Review checkout was redirected; retain it and investigate privately.");
  const top = (await gitText(git, checkout, ["rev-parse", "--show-toplevel"])).trim();
  if (canonical(fs.realpathSync(top)) !== canonical(checkout)) throw new Error("Review checkout identity changed.");
  if ((await git(checkout, ["merge-base", "--is-ancestor", review.customerStart, "HEAD"])).code !== 0)
    throw new Error("Review no longer preserves the customer starting history.");
  return checkout;
}
async function copyPackages(review: ForkReview, checkout: string) {
  for (const extension of review.extensionHashes) {
    const source = ownedPath(review.source, extension.directory), target = path.join(checkout, extension.directory);
    if (!canonical(resolvedNewPath(target)).startsWith(canonical(checkout) + path.sep))
      throw new Error("Customer package destination escapes the review checkout; no package was copied.");
    if (packageHash(source) !== extension.hash) throw new Error("Customer package changed since preparation; keep this review and prepare a fresh one.");
    if (fs.existsSync(target)) {
      if (packageHash(target) !== extension.hash) throw new Error("Customer package overlaps candidate source or differs; reconcile manually, never overwrite it.");
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(source, target, { recursive: true, filter: file => !["node_modules", ".git", "dist", ".cache"].includes(path.basename(file)) });
      if (packageHash(target) !== extension.hash) throw new Error("Customer package snapshot changed during copying; retain this candidate.");
    }
  }
  const manifest = path.join(checkout, "meterflo.instance.json");
  if (!fs.existsSync(manifest)) {
    const current = loadCustomerRelease(review.source);
    // The loader permits release metadata only, not secrets or executable options.
    fs.writeFileSync(manifest, JSON.stringify({ coreSource: current.coreSource, coreBaseline: current.coreBaseline,
      installedSchemaVersion: current.installedSchemaVersion, approvedMigrations: current.approvedMigrations,
      extensions: current.extensions.map(x => ({ directory: x.directory })) }, null, 2), { flag: "wx", mode: 0o600 });
  }
}
async function continueReview(review: ForkReview, git: ReviewGit): Promise<ForkReview> {
  if (review.state === "aborted") throw new Error("This review was abandoned. Its files were retained; choose a new directory to prepare again.");
  const checkout = path.join(review.target, "checkout");
  if (review.phase === "clone") {
    if (!fs.existsSync(checkout)) {
      await gitText(git, review.target, ["clone", "--no-checkout", "--no-hardlinks", "--", review.source, checkout]);
    }
    // An interrupted clone is never deleted/overwritten to make retry succeed.
    await gitText(git, checkout, ["cat-file", "-e", `${review.customerStart}^{commit}`]);
    if ((await git(checkout, ["remote", "get-url", "origin"])).code === 0)
      await gitText(git, checkout, ["remote", "remove", "origin"]);
    review.phase = "checkout"; save(review);
  }
  if (review.phase === "checkout") {
    if (fs.readdirSync(checkout).some(name => name !== ".git")) {
      const head = (await gitText(git, checkout, ["rev-parse", "HEAD"])).trim();
      const branch = (await gitText(git, checkout, ["branch", "--show-current"])).trim();
      if (head !== review.customerStart || branch !== `meterflo-review-${review.id}` ||
          (await gitText(git, checkout, ["status", "--porcelain=v1", "--untracked-files=all"])).trim())
        throw new Error("Interrupted initial checkout changed. Retain it for review and choose a fresh target; no checkout was overwritten.");
    } else {
      await gitText(git, checkout, ["checkout", "-b", `meterflo-review-${review.id}`, review.customerStart]);
    }
    review.phase = "fetch"; save(review);
  }
  const root = await verifyReviewCheckout(review, git);
  if (review.phase === "fetch") {
    const current = loadCustomerRelease(review.source);
    if (current.coreSource !== review.coreSource || JSON.stringify(current.coreBaseline) !== JSON.stringify(review.baseline))
      throw new Error("Approved source/baseline configuration changed; retain this review and prepare a fresh one.");
    for (const tag of [review.tag, `v${review.baseline.version}`]) {
      await gitText(git, root, ["fetch", "--no-tags", review.coreSource, `refs/tags/${tag}:refs/meterflo/core/${tag}`]);
    }
    const resolve = async (tag: string) => (await gitText(git, root, ["rev-parse", `refs/meterflo/core/${tag}^{commit}`])).trim();
    if (await resolve(review.tag) !== review.coreCommit || await resolve(`v${review.baseline.version}`) !== review.baseline.commit)
      throw new Error("Core tag moved or does not match its verified full commit; no merge was attempted.");
    for (const descendant of [review.customerStart, review.coreCommit]) {
      if ((await git(root, ["merge-base", "--is-ancestor", review.baseline.commit, descendant])).code !== 0)
        throw new Error("Missing/unrelated core history. Reconstruct a reviewed adoption baseline; do not allow unrelated histories or reset customer code.");
    }
    await coreIdentity(git, root, review.baseline.commit, `v${review.baseline.version}`);
    review.core = await coreIdentity(git, root, review.coreCommit, review.tag);
    if (compareReleaseVersions(review.core.version, review.baseline.version) <= 0)
      throw new Error("Select a core release newer than the verified source baseline.");
    review.reviewRequired = [
      "Review customer business behavior even when Git merges cleanly.",
      "Run dependency installation, type/build and customer regression checks with isolated test data and credentials.",
      "Review dependency manifests/lockfiles and core/customer migrations; no SQL or migration approval is automatic.",
    ];
    if (review.core.schemaVersion !== current.installedSchemaVersion)
      review.reviewRequired.push("Candidate schema differs from the declared installed schema: controlled migration readiness is required.");
    if (review.core.extensionApiVersion !== current.extensionApiVersion)
      review.reviewRequired.push("Extension interface changed: verify every customer integration.");
    review.phase = "merge"; review.state = "merging"; save(review);
  }
  // Resume recognizes real Git state, including an interrupted merge/commit.
  const mergeHead = await git(root, ["rev-parse", "--verify", "MERGE_HEAD"]);
  const included = (await git(root, ["merge-base", "--is-ancestor", review.coreCommit, "HEAD"])).code === 0;
  if (!included && mergeHead.code !== 0) {
    const head = (await gitText(git, root, ["rev-parse", "HEAD"])).trim();
    if (head !== review.customerStart || (await gitText(git, root, ["status", "--porcelain=v1", "--untracked-files=all"])).trim())
      throw new Error("Review changed before merging. Inspect it manually; resume will not reset or overwrite it.");
    // Merge is intentionally uncommitted, even if there are no textual conflicts.
    const result = await git(root, ["-c", "user.name=MeterFlo Review", "-c", "user.email=review@example.invalid",
      "merge", "--no-commit", "--no-ff", review.coreCommit]);
    if (result.code !== 0 && (await git(root, ["rev-parse", "--verify", "MERGE_HEAD"])).code !== 0)
      throw new Error("Merge could not start. Inspect the retained checkout privately; no live source was changed.");
  } else if (mergeHead.code === 0 && mergeHead.stdout.trim() !== review.coreCommit) {
    throw new Error("An unrelated merge is in progress; resume will not change it.");
  }
  review.conflicts = [...new Set((await gitText(git, root, ["diff", "--name-only", "--diff-filter=U", "-z"])).split("\0").filter(Boolean))];
  review.state = review.conflicts.length ? "conflicts" : "review";
  if (!review.conflicts.length) await copyPackages(review, root);
  save(review);
  return review;
}
export async function prepareForkReview(options: { root: string; target: string; tag: string; commit: string; git?: ReviewGit }) {
  const source = fs.realpathSync(options.root), target = resolvedNewPath(options.target), git = options.git ?? reviewGit;
  if (!tagPattern.test(options.tag) || !commitPattern.test(options.commit)) throw new Error("Supply the selected numbered --tag and independently verified full --commit.");
  checkOutside(source, target);
  if (fs.existsSync(target)) throw new Error("Target already exists; use status/resume or choose a new directory. Nothing was overwritten.");
  await sourceClean(git, source);
  const current = loadCustomerRelease(source);
  if (!current.coreSource || !current.coreBaseline) throw new Error("Configure the approved HTTPS coreSource and verified coreBaseline first; do not guess a baseline.");
  const customerStart = (await gitText(git, source, ["rev-parse", "HEAD"])).trim();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.mkdirSync(target, { mode: 0o700 });
  const review: ForkReview = { format: 1, id: randomUUID(), target: fs.realpathSync(target), source, coreSource: current.coreSource, customerStart,
    tag: options.tag, coreCommit: options.commit, baseline: current.coreBaseline, state: "preparing", phase: "clone",
    conflicts: [], reviewRequired: [], extensionHashes: current.extensions.map(x => ({ directory: x.directory, hash: x.contentHash })) };
  save(review);
  return locked(review.target, async () => {
    const result = await continueReview(review, git);
    await sourceClean(git, source);
    if ((await gitText(git, source, ["rev-parse", "HEAD"])).trim() !== customerStart)
      throw new Error("Customer source advanced during preparation. This review retains its original pinned source; do not deploy without re-review.");
    return result;
  });
}
export async function reviewFork(target: string, action: "status" | "resume" | "abort" | "approve",
  confirmations?: { tests: boolean; customizations: boolean; dependencies: boolean; migrations: boolean }, git: ReviewGit = reviewGit) {
  const directory = fs.realpathSync(target);
  return locked(directory, async () => {
    let review = load(directory);
    if (action === "abort") {
      if (review.state === "approved") throw new Error("An approved review cannot be silently withdrawn; retain its revision and record a new reviewed decision.");
      review.state = "aborted"; save(review); return review;
    }
    if (action === "resume") {
      if (review.state === "approved") throw new Error("Review is approved; use status to verify it or prepare a new review.");
      return continueReview(review, git);
    }
    if (review.phase !== "merge" || review.state === "aborted") {
      if (action === "approve") throw new Error("Finish preparation and resolve conflicts before approval.");
      return review;
    }
    const checkout = await verifyReviewCheckout(review, git);
    const head = (await gitText(git, checkout, ["rev-parse", "HEAD"])).trim();
    const dirty = (await gitText(git, checkout, ["status", "--porcelain=v1", "--untracked-files=all"])).trim();
    const included = (await git(checkout, ["merge-base", "--is-ancestor", review.coreCommit, "HEAD"])).code === 0;
    if (review.state === "approved") {
      if (head !== review.combinedCommit || dirty) throw new Error("Approved checkout changed; approval no longer matches this source. Do not deploy it.");
      await checkApprovalSource(review, checkout, git);
      if (configurationHash(checkout) !== review.configurationHash) throw new Error("Approved instance review configuration changed; do not deploy under this approval.");
      return review;
    }
    review.conflicts = (await gitText(git, checkout, ["diff", "--name-only", "--diff-filter=U", "-z"])).split("\0").filter(Boolean);
    review.state = review.conflicts.length ? "conflicts" : "review";
    if (action === "approve") {
      if (!confirmations || !Object.values(confirmations).every(value => value === true) ||
          !confirmations.tests || !confirmations.customizations || !confirmations.dependencies || !confirmations.migrations)
        throw new Error("Explicit test, customization, dependency and migration confirmations are all required. They are operator attestations, not automatic checks.");
      if (!included || dirty || review.conflicts.length || (await git(checkout, ["rev-parse", "--verify", "MERGE_HEAD"])).code === 0)
        throw new Error("Resolve conflicts, review and commit the combined customer/core source first; approval never commits for you.");
      await sourceClean(git, review.source);
      if ((await gitText(git, review.source, ["rev-parse", "HEAD"])).trim() !== review.customerStart)
        throw new Error("Customer source advanced since preparation. This review excludes later custom work; prepare a fresh review rather than overwriting it.");
      await checkApprovalSource(review, checkout, git);
      review.state = "approved"; review.combinedCommit = head;
      review.configurationHash = configurationHash(checkout);
      review.approval = { at: new Date().toISOString(), kind: "operator-attestation", tests: true, customizations: true, dependencies: true, migrations: true };
    }
    save(review);
    return review;
  });
}
function configurationHash(checkout: string) {
  return createHash("sha256").update(fs.readFileSync(path.join(checkout, "meterflo.instance.json"))).digest("hex");
}
async function checkApprovalSource(review: ForkReview, checkout: string, git: ReviewGit) {
  const release = loadCustomerRelease(checkout);
  const selected = await coreIdentity(git, checkout, review.coreCommit, review.tag);
  if (release.coreSource !== review.coreSource || JSON.stringify(release.coreBaseline) !== JSON.stringify(review.baseline))
    throw new Error("Candidate approved source/baseline changed; do not invent adoption metadata.");
  if (release.blockers.length || release.schemaVersion !== release.installedSchemaVersion ||
      release.schemaVersion !== selected.schemaVersion || release.extensionApiVersion !== selected.extensionApiVersion ||
      selected.migrations.some(m => !release.migrations.some(r => r.id === m.id && r.sha256 === m.sha256 && r.file === m.file)))
    throw new Error("Candidate dependencies/extensions/migration readiness must be reconciled before approval; no approvals or SQL were generated.");
  const files = (await gitText(git, checkout, ["ls-files", "-z"])).split("\0").filter(Boolean);
  if (files.some(protectedSourceFile)) throw new Error("Review committed protected instance/data files; remove them through reviewed source ownership, not approval.");
  for (const extension of review.extensionHashes)
    if (packageHash(ownedPath(checkout, extension.directory)) !== extension.hash)
      throw new Error("Copied customer package changed. Re-review through a fresh preparation rather than approving an altered snapshot.");
  let pkg: any, lock: any;
  try { pkg = JSON.parse(fs.readFileSync(path.join(checkout, "package.json"), "utf8")); lock = JSON.parse(fs.readFileSync(path.join(checkout, "package-lock.json"), "utf8")); }
  catch { throw new Error("Candidate dependency manifests are unreadable; review them before approval."); }
  validateDependencyLock(pkg, lock);
}
