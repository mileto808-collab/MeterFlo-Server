# Customer-Owned MeterFlo Updates

## Authoritative MeterFlo Core source

This Replit project and its Git repository are the authoritative **MeterFlo
Core server** source. All other MeterFlo instances receive shared core updates
from this repository, including Windows/Linux installations and separate Replit
projects owned by the MeterFlo operator or a customer. Customer-specific source
history stays separate; updating core is not permission to replace it.

Administrators should follow the applicable step-by-step procedure below.
Direct-code conflicts require a qualified developer's review before deployment;
do not discard custom work to make an update pass.

## What counts as custom work

Custom work includes **any customer/instance-specific development**, not just
extensions: direct changes to core source files, new files, custom database
tables/columns, forms, workflows, integrations and reports. It counts regardless
of whether the work was done with Replit Agent, another editor, a local
Windows/Linux development tool, or by editing files directly. It also counts
regardless of whether a Replit project belongs to MeterFlo's operator or to the
customer.

The requirement is to deliver core improvements **without silently removing
that work**. No updater can guarantee that arbitrary changes to the same code
or business rules will combine correctly without review. Preserving a file is
not proof that the customized application's behavior still works.

### Two supported paths, with different limits

| Installation | How core changes are combined | How it is deployed |
|---|---|---|
| Standard, uncustomized checkout | Fast-forward its approved `origin/main` | Routine Windows updater, or the host's reviewed build/publish process |
| Customer-specific direct code changes / existing fork | Developer-reviewed Git merge into the customer's source history; resolve and test conflicts | Deploy the tested combined customer revision, not a fresh core checkout |
| Customizations entirely in supported extension packages | Numbered core candidate plus unchanged customer packages, compatibility checks and review | Staged standalone activation, or reconciliation/build and explicit Replit publication |

**Current automation boundary:** package staging handles the supported extension
contract described below. The separate **customer-fork review CLI** now prepares
an isolated Git merge for direct-code forks, reports conflicts and records
operator approval of a combined revision. It never resolves conflicting business
rules, applies SQL, deploys or publishes automatically. Committing a direct
modification does not convert it into a supported extension or make the package
stager accept it. Do not edit baseline metadata to bypass this check.

## Understand the update message in Settings

The message **"Numbered release checks need configuration"** means that the
staged-release checker lacks its approved `coreSource` and/or verified baseline.
It is not a report that a Windows `origin/main` update failed, and it is not an
instruction to overwrite local changes.

- The routine Windows command pulls that installation's `origin/main`.
- Numbered-release checks use the approved `coreSource` and release metadata in
  the private instance manifest, independently of `origin`.
- The **Legacy GitHub Releases API URL** field does not configure either the
  Windows Git remote or the approved staged-update source.
- A push to core `main` is not automatically a compatible numbered release.
  The core maintainer must publish the version/tag/metadata described below.
  Example versions in this guide are not evidence those releases exist.
- A "tracked local changes" stop means Git sees different source/index bytes.
  Tools can produce those differences too; it does not prove a person edited
  a customization. Review before deciding whether to keep or restore anything.

## Source ownership for customized installations

Use this model for Windows/Linux and for separate Replit projects/accounts:

1. **Core repository:** this MeterFlo Git repository is the upstream source of
   shared core releases. Customer changes should not be pushed into core merely
   to make that customer's update succeed.
2. **Customer repository or independently maintained customer branch:** contains
   the customer's combined application source, including direct modifications.
   Prefer a separate customer repository for clear ownership/access boundaries.
   Its `origin` normally points to that customer repository, not directly to
   core. Keep an additional remote such as `meterflo-core` for fetching core.
3. **Instance configuration and data:** each actual instance retains its own
   secrets, database, storage, uploaded files, environment settings and protected
   process configuration. A source-code merge is not a database/file restore.

Git remotes are configured separately in every checkout/Replit workspace. A
remote in this core project does not configure remotes in a customer project.
Use authenticated Git access appropriate to the repository; never embed tokens
in a documented remote URL or commit private configuration.

### First adoption for an existing customized installation

Before the first core merge, preserve the actual customized source in private
source control and identify the real common core ancestor. Review tracked,
staged, untracked and ignored files: an ignored customer package is not backed
up by committing the core repository. Commit only reviewed source files, not
credentials, uploads, database dumps or build outputs.

If the customer copy has unrelated/missing Git history, do not use a hard reset,
copy core files over it, or blindly merge with `--allow-unrelated-histories`.
Compare it against the known original core snapshot and reconstruct a reviewed
customer baseline in a separate workspace. Existing direct edits require this
one-time adoption even if they were made by an agent rather than a programmer.

### Repeatable core-to-customer merge

Perform these steps in the customer's **development checkout**, not in a
running production directory:

1. Save/review the customer's current changes in its own history and start from
   a clean working tree. Record the currently deployed customer revision.
2. Fetch the approved core repository through the separate core remote. Select
   a maintainer-approved release and verify its full commit identity. Do not
   substitute a guessed tag or change the source-ownership baseline.
3. Create an update-review branch from the customer's current source. Merge the
   selected core commit **into the customer branch**, not the reverse.
4. Resolve conflicts while retaining the intended customer behavior and core
   safety fixes. Review the entire result: Git can merge without textual
   conflicts while still introducing a business-rule or API incompatibility.
5. Review dependency and lockfile changes together. Use a controlled dependency
   update if reconciliation is required; do not discard the customer lockfile
   just to get a clean status. Review core and customer database migrations
   separately, including custom columns/tables and any irreversible changes.
6. Run type/build checks, relevant core tests and customer-specific regression
   tests against an isolated development database/storage. Review imports,
   permissions, integrations and custom workflows, not just whether it starts.
7. Commit the reconciled result to the customer repository, record both the
   core commit and resulting customer commit, and approve that exact revision
   for deployment. A clean Git status alone is not this approval.

The following illustrates the Git operations. Replace the uppercase values
with reviewed values before running; configure `meterflo-core` once, and reuse
it on later updates. Use a fresh branch name for each review:

```sh
git remote add meterflo-core APPROVED_CORE_HTTPS_URL
git fetch meterflo-core
git switch -c customer-core-update-YYYYMMDD
git merge --no-commit --no-ff VERIFIED_CORE_COMMIT
```

The merge intentionally stops for review. On conflicts, resolve and stage only
reviewed source files; do not select "take all incoming" as an update policy.
Use `git merge --abort` to abandon an in-progress merge before committing if it
cannot be safely reconciled. This is not a reset or rollback of production data.

## Guided direct-code updates: exact administrator procedure

Use this for direct customizations made with **any** editor, agent, hosting
account or development tool. Commands run under the developer/operator's normal
OS/Git permissions. The web app displays guidance, but cannot execute merges or
write arbitrary server paths through an HTTP request.

### A. One-time setup and adoption

1. Keep the customer's customized source in its own private repository/history.
   Save reviewed source changes there; do not commit secrets, data, uploads or
   protected PM2 configuration. Inspect `git status --short`, including new
   source files; Git-ignored customer packages need independent source control.
2. Choose the **customer development checkout**, not a running production
   directory. It must contain this release's review scripts. Older copies must
   first receive those tools through a reviewed adoption merge; downloading one
   script into an incompatible checkout is not an upgrade. In that development
   checkout install its reviewed locked build tools with
   `npm ci --include=dev --include=optional`; the CLI needs the local `tsx`
   dependency. Do not substitute an unpinned `npx` download.
3. Configure the private root `meterflo.instance.json` using the existing
   instance template and the field table below. If the manifest exists, edit
   the necessary fields rather than replacing the file. Set `coreSource` to
   this authoritative core repository's approved HTTPS URL. Use normal Git
   authentication, never a token embedded in that URL.
4. Obtain a **real numbered baseline tag and full commit** from the core
   maintainer. Confirm that baseline is an ancestor of the customer source and
   the selected newer core release. Record that baseline in `coreBaseline`.
   Do not use the customer HEAD or invent a tag. If historical copies have no
   verified common ancestry, stop for developer-led adoption; these tools do not
   use unrelated-history merges.
5. Have the database maintainer verify the instance's installed schema and
   precise migration approvals. The manifest is an operator declaration, not
   proof of database contents. Missing approvals can be reviewed later in the
   isolated candidate; preparation never creates approvals or runs SQL.
6. Review tracked private files and submodules before adoption. The CLI refuses
   currently tracked protected instance files and submodules instead of silently
   omitting them. A clone preserves Git history, which can include historical
   credentials: audit/rotate those separately and keep the review private.

### B. Prepare each update

1. Commit reviewed customer source and obtain the selected core release's
   **tag and full 40-character commit independently from the maintainer**.
   Settings → Updates → Web Updates → Preview Changes shows the verified
   candidate identity and, when prerequisites pass, a copyable fork command.
   A displayed command prepares review only, not a production-ready upgrade.
2. Pick a **new absolute directory outside the source installation**, not a
   parent directory. Do not pre-create it. The tool retains failed directories
   rather than deleting or overwriting them.
3. From the customer development checkout, run the applicable example below.
   Replace the example tag/commit with the real approved values. The example
   `v2.2.0` is not a claim that such a release exists.

Windows Command Prompt:

```cmd
cd /d C:\xampp\htdocs\meterflo
npm run prepare:customer-fork -- --tag v2.2.0 --commit FULL_40_CHARACTER_CORE_COMMIT --target "C:\meterflo-reviews\customer-v2.2.0"
```

Linux / Replit Shell:

```sh
cd /path/to/customer-development-checkout
npm run prepare:customer-fork -- --tag v2.2.0 --commit FULL_40_CHARACTER_CORE_COMMIT --target "/path/outside-checkout/customer-v2.2.0"
```

**Replit directory setup:** do not put the target inside an existing project-root
customer checkout or rely on disposable `/tmp` storage for retained review
evidence. Use a dedicated, nonpublished review project with a source subdirectory
and sibling review directory. For example, from that project's workspace root:

```sh
git clone CUSTOMER_REPOSITORY_URL customer-source
cd customer-source
npm ci --include=dev --include=optional
# Configure this checkout's private instance manifest using the verified metadata.
npm run prepare:customer-fork -- --tag v2.2.0 --commit FULL_40_CHARACTER_CORE_COMMIT --target "$(dirname "$PWD")/reviews/customer-v2.2.0"
```

Use the customer's authorized repository and the approved source revision, not
an unrelated core-only clone. Ignore `/customer-source/` and `/reviews/` in the
outer review project's Git so checkpoints do not accidentally publish nested
repositories or private journals; the nested customer repository retains its
own version history and remote. Bring independently versioned configured
customer packages into that source checkout before preparation. Do not copy
production credentials/data into the review project or publish it. Keep review
evidence private and retain it according to the customer's policy.

Preparation checks clean tracked/staged/untracked source, clones its exact
committed history, verifies both core tags/identities and ancestry, and performs
an uncommitted merge in `TARGET/checkout/`. The original checkout/branch/index,
Git remotes, database, ignored runtime secrets and uploads stay untouched.
Configured supported package source is copied byte-for-byte after conflicts
are resolved; ignored arbitrary directories are **not** silently assumed to be
source packages. Preserve those through separate adoption/backups.

The review checkout has **no origin remote** after cloning so it cannot
accidentally push into the original installation. Its private journal is
`TARGET/review.json`, outside the source tree. Keep both together; do not move,
forge or commit the journal. This is not a sandbox for untrusted Git
configuration/customer code and not a credential-history scrubber.

4. Read the returned `state`, `phase`, filenames and review requirements:
   - `conflicts`: resolve them in the review checkout, never in the live copy.
   - `review`: no textual conflicts remain, but semantic review/tests are still
     required. The merge is intentionally not automatically committed.
   - An error retains the target and journal. Check status before retrying; do
     not delete evidence or reset the original installation.

### C. Status, interruption, conflict resolution and abandonment

Run these from the original customer development checkout, substituting the
same absolute target. Linux/Replit uses the same commands with Unix paths:

```cmd
npm run review:customer-fork -- status --target "C:\meterflo-reviews\customer-v2.2.0"
npm run review:customer-fork -- resume --target "C:\meterflo-reviews\customer-v2.2.0"
```

`status` reports/verifies the journal and current review state; `resume`
continues supported interrupted preparation and re-examines real Git conflict
state. It does not reset a changed checkout. Resolve conflicts and stage only
reviewed source in `TARGET/checkout/`. Run `resume` after resolving conflicts
so configured package/manifest copying completes, then review and commit there:

```cmd
cd /d C:\meterflo-reviews\customer-v2.2.0\checkout
git status --short
git diff --stat
git diff --cached --stat
git add REVIEWED_SOURCE_FILE
git commit -m "Review core update with customer customizations"
```

Replace `REVIEWED_SOURCE_FILE` with each intended source path; do not blindly
stage ignored instance configuration, data or all files. Review actual diffs
privately, not just statistics. Use your normal Git identity; the preparation
tool does not supply an identity for your approval commit.

To abandon preparation:

```cmd
cd /d C:\xampp\htdocs\meterflo
npm run review:customer-fork -- abort --target "C:\meterflo-reviews\customer-v2.2.0"
```

`abort` marks the review abandoned and **retains all files and merge evidence**;
it does not run a destructive Git cleanup. An abandoned review cannot be
resumed; use a new target. An interrupted clone/checkout whose files cannot be
verified also requires retained evidence and a fresh target. If a process
crashed leaving `.review.lock`, confirm it has exited before an administrator
removes that one lock. Never remove an active process's lock.

### D. Test, reconcile and approve the exact combined revision

1. Review all combined behavior, including non-conflicting changes to customer
   forms, rules, API integrations, permissions and reports.
2. Reconcile dependency manifests and their lockfiles together, then install
   locked dependencies and run checks/build/customer tests in the review
   checkout. Start it from a clean nonproduction environment with isolated
   database/storage and test-only credentials. **Do not inherit production
   database/session/mail settings or copy the production `.env`.**
3. Use the existing build procedure (`npm ci --include=dev --include=optional`,
   `npm run check`, `npm run build` and relevant regression commands), but do not
   assume the core unit suite alone tests customer behavior. Builds/customer
   scripts are trusted executable code, not a sandbox.
4. Review core/customer schema changes separately. A schema-changing candidate
   needs controlled migration testing and an explicit production maintenance
   plan; update only its private review manifest with genuinely reviewed
   installed-schema/approval declarations. The CLI does not inspect or migrate
   a database. It refuses missing core migrations, altered exact checksums,
   incompatible supported packages and inconsistent root dependency lockfiles.
5. Commit any source reconciliation and rerun the affected checks. The original
   customer source must still be clean at the recorded starting revision.
   If new customer work was added there, prepare a fresh review so it cannot be
   lost by deploying this older snapshot.
6. From the original checkout, record explicit attestations:

```cmd
npm run review:customer-fork -- approve --target "C:\meterflo-reviews\customer-v2.2.0" --confirm-tests --confirm-customizations --confirm-dependencies --confirm-migrations
npm run review:customer-fork -- status --target "C:\meterflo-reviews\customer-v2.2.0"
```

Approval requires a clean committed review containing both original customer
and selected core history. It records `coreCommit`, `customerStart`,
`combinedCommit` and operator attestations. The flags **do not run tests or
prove a migration was applied**. Changed approved source/configuration/package
snapshots invalidate verification. This journal is not tamper-proof release
signing, a package-staging receipt or authority to activate/publish.

### E. Hand the approved customer revision to deployment

1. In the review checkout, add the intended **customer repository** remote using
   normal protected Git authentication. Push the approved revision to a new
   customer review branch, not directly into core:

```sh
git remote add customer CUSTOMER_REPOSITORY_URL
git push customer HEAD:refs/heads/core-update-review-YYYYMMDD
```

2. Review/promote that exact revision through the customer's normal approval
   process. If promotion creates a different merge/reconciliation commit,
   retest and record the new deployed identity; do not describe it as the
   already tested commit.
3. For Windows/Linux, deploy the approved combined customer revision through
   the reviewed standalone maintenance procedure below. The fork journal
   cannot be passed to `activate:customer-release`. Do not feed it to the
   unmodified-core package stager or fabricate a staging receipt.
4. For separate Replit development/production projects, fetch the customer
   repository in the production workspace, verify its clean source and the
   approved full customer revision, and retrieve that exact revision without
   forcing local changes away. Preserve production settings, secrets,
   database/storage and reviewed migrations, then explicitly republish. Follow
   the Replit procedure above; another account needs its own authorized Git
   access and publication permission.
5. Verify actual production health, login, core fixes and customer regression
   cases. Record the deployed customer commit plus selected core commit/tag for
   that particular instance. Publishing, PM2 and databases are deliberately not
   controlled by the merge-preparation CLI.

### Deploy a customized Windows/Linux installation

Deploy the approved **combined customer revision** using its reviewed deployment
procedure. The routine Windows command may deploy a clean customer
`origin/main` only if its existing guards permit that installation; it does not
fetch/merge core on the customer's behalf. Do not change `origin` from the
customer repository back to core to bypass reconciliation.

Instances already using staged activation or extension packages must use the
staged procedure below, not the routine in-place Windows updater. The existing
staged CLI accepts verified core plus supported packages, not a hand-modified
fork with a fabricated staging receipt. Direct-code forks need their own
reviewed deployment and schema-maintenance procedure.

Keep production databases/files/secrets separate from code. Stop service for
required maintenance, retain a compatible prior application build, apply only
reviewed migrations, deploy the approved revision and verify actual health,
login and custom behavior. A code rollback does not reverse database changes.

### Deploy to separate Replit projects, including other accounts

The operator/account owning a Replit project does not change the source model.
There is no automatic propagation from this core project to another project.

1. Connect the customer's development Replit workspace to its customer
   repository/branch. Configure its separate core remote and perform the
   reviewed merge above there, or pull the already reviewed customer revision
   produced by an external developer. The developer can use any editor.
2. Build/test with that development project's own database, storage and
   environment settings. A Git push transfers source history, not Replit
   secrets, database contents or uploaded files.
3. If production is **another Replit project**, retrieve the exact approved
   customer revision into that production project's workspace. Preserve that
   project's production connections, secrets and storage; do not import the
   development database or replace customer data to deploy code.
4. If development and publication use **the same Replit project**, the tested
   workspace revision is the source for publication, but development and
   production database environments still need independent migration review.
   Check the actual database/provider configuration rather than assuming
   arbitrary external connections are separated automatically.
5. Check dependency/build configuration and the files included in publication.
   Apply reviewed production schema changes through the project's migration
   process. Replit's schema-publishing flow must not be replaced with a data
   overwrite/restore merely to clear an error.
6. The authorized operator explicitly publishes/republishes the production app
   from that workspace. A core Git push, customer Git push, workspace pull or
   development preview does **not** update an already published app.
7. Verify the published health, installed version/revision, sign-in and customer
   regression cases. Record the core release and combined customer revision
   deployed to each instance, including which production project received it.

Private repositories require authorized access in each relevant account or
workspace. Do not assume another Replit account inherits the core project's Git
authentication or permission to publish the customer's app.

Official Replit references:
[Git pane](https://docs.replit.com/features/workspace-tools/git-interface),
[publishing](https://docs.replit.com/features/publishing/overview), and
[development/production databases](https://docs.replit.com/features/data-and-storage/development-and-production).

## Supported model

Customer-owned Replit and standalone Windows/Linux instances keep three owners separate:

| Owner | Examples | Update behavior |
|---|---|---|
| Core release | Standard application code, core package/lockfile, versioned extension interface | Select a numbered core tag and build a candidate |
| Customer package | Customer report screens, server report handlers, separately pinned dependencies | Copy the customer's package source unchanged into the candidate and check compatibility |
| Instance data/configuration | Database, project settings, accounts, audit history, attachments/APKs, private environment and PM2 configuration | Remain with the customer; never copy the core server's database over them |

This foundation supports **trusted, permission-scoped, read-only report screens and server handlers**. It is not an arbitrary-code upload feature, a sandbox, or a promise that every existing core modification can be automatically converted. More complex custom forms and workflow hooks need additional versioned interfaces.

The curated helper API does not sandbox arbitrary JavaScript: a trusted extension
still runs with the Node process's capabilities. Review its source/dependencies
before enabling it; the read-only contract is not permission to load untrusted code.

## Configure a customer workspace

1. Back up the instance and inspect any existing direct edits to core files.
2. Copy `deploy/meterflo.instance.example.json` to root `meterflo.instance.json`.
3. Set `coreSource` to the approved core Git repository, for example `https://github.com/your-company/MeterFlo-Core.git`. Embedded credentials, query tokens and non-HTTPS sources are rejected; use the host's normal protected Git authentication.
4. Verify `installedSchemaVersion` with the release/database maintainer. The initial foundation uses revision `1`; this declaration is an operator assertion, not an automatic database inspection.
   Record `coreBaseline` with the numbered version and full 40-character commit
   of the approved core tag underlying the customer checkout. Verify it against
   the trusted source, not the customer's branch HEAD. Preview rejects a moved
   baseline tag or unrelated history. After standalone activation the original
   checkout baseline remains unchanged; the activation receipt identifies the
   newer running release. Never change this baseline merely to conceal local edits.
5. Maintain custom packages in a separate customer repository and place its checked-out package in `customer-packages/project-report`. To try the working example in a **test workspace**, copy `examples/customer-report` there and list that directory in the instance manifest.
6. Build and test using `npm ci --include=dev --registry=https://registry.npmjs.org`, `npm run check`, `npm run build`, and `npm run test:customer-updates`.

Older instances must first adopt and verify this foundation through a reviewed
merge/release. Standalone activation requires a compiled baseline whose
release-health response can be verified; it does not assume legacy binaries
without that endpoint can provide verified recovery.

Instance manifests and `customer-packages/` are ignored by the core Git repository. Keep independent backups/source control for them: ignoring a directory is not a backup. The example is not enabled or populated in normal installations.

Do not put secrets or executable installation options in the instance manifest. Its fields are:

| Field | Example | Use |
|---|---|---|
| `coreSource` | `https://github.com/your-company/MeterFlo-Core.git` | Approved core source, independent of the customer's `origin` repository |
| `coreBaseline` | `{"version":"2.1.1","commit":"<verified full 40-character Git commit>"}` | Known source-ownership baseline; missing or moved identities block preparation |
| `extensions` | `[{"directory":"customer-packages/project-report"}]` | Relative package directories owned by the customer; paths cannot escape the instance |
| `installedSchemaVersion` | `1` | DBA-reviewed installed schema revision; unknown/incompatible readiness blocks upgrades |
| `approvedMigrations` | `[{"id":"core.example","sha256":"<actual 64-character file checksum>"}]` | Record only after reviewing/applying the precise SQL through the customer's controlled process |

## Develop an extension

The example package has its own `package.json` and npm lockfile. Its `meterfloExtension` declaration defines:

- `id`: stable lowercase identifier such as `project-report`.
- `extensionApiVersion`: `1` for this contract.
- `minCoreVersion` / `maxCoreVersionExclusive`: inclusive lower and exclusive upper numbered versions, for example `2.1.1` and `3.0.0`.
- `permission`: an existing permission available through normal MeterFlo role management, such as `projects.view`. Unknown keys are rejected; do not seed unmanageable custom permissions.
- `serverEntry`: package-owned `.mjs`, `.js`, or `.ts` entry exporting `reports`.
- `screens`: declared IDs/titles and the associated report export; for example `projects` → `reports.projects`.
- `migrations`: owned, checksum-verified SQL declarations; use `ownership: "extension:project-report"` for this example.

A handler receives `{apiVersion, actor, getProjects}`. `actor` contains identity only, not password hashes or session secrets. `getProjects()` enforces `projects.view`, respects associated projects, and returns only project ID/name/active status. Return `{title, columns, rows}` with primitive cells; rows are limited to 1,000 and text is rendered safely, not as HTML.

Visible screens appear under **Customer Extensions** and use `/extensions/<id>/<screen>`. The server catalog and `/api/customer-extensions/<id>/reports/<report>` enforce authentication and permissions on every request, including after revocation.

Customer package dependencies are installed from their own lockfiles and JavaScript handlers are bundled separately. Pure JavaScript and Node built-in dependencies are the initial supported packaging path; native addons or additional runtime assets need explicit packaging/testing, not an assumption that a compiler automatically copies them. Generated `.cache/` directories are not release source or customer data and are not packaged; store durable files under protected instance storage. No customer changes to the core dependency graph are required for the example.

## Publish a core release

Maintain core code separately. Increment the core package version (and matching lockfile metadata), declare extension interface/schema compatibility in `meterflo.release.json`, pass checks/build/tests, and create a matching immutable numbered tag, such as `v2.2.0`. The package version must match the tag.

For public GitHub sources, publish a GitHub Release at that tag so published instances without Git can receive a release notice. Their notices do not authorize an in-place update: preparation still happens in the workspace. Private/non-GitHub sources require authenticated workspace access.

### Maintainer release-readiness checklist

1. Choose the real next core version, update package/root lockfile metadata
   together, declare schema/API compatibility and immutable exact-byte
   migrations, then commit the reviewed source. Do not use version labels as
   evidence that an unreleased main branch is a numbered release.
2. Run type checks, the build, core/customer regression suites,
   `npm run test:customer-forks`, and any affected feature acceptance checks.
   Record results for that exact commit; a later source change invalidates
   earlier checks of the changed behavior.
3. Run the read-only readiness command (replace the example version):

```sh
npm run check:core-release -- --tag v2.2.0
```

It checks clean source, package/lock/tag agreement, root dependency
declarations, schema/API metadata, regular-file migration ownership and exact
checksums, and whether an existing local tag has moved relative to HEAD. It
does not run tests, contact a database, approve SQL, create a tag or push.
4. Review the reported full commit and your test results. An authorized
   maintainer explicitly creates the immutable tag only after approval, pushes
   the approved commit/tag to this core repository and publishes release notes.
   Check the remote tag/peeled commit before distributing that identity. Local
   readiness does not prove a remote release exists or authorize replacing one.
5. Supply administrators with the exact tag/commit, compatibility/migration
   requirements and rollback limitations. Do not silently move released tags
   or advise changing customer baselines to suppress a conflict.

## Preview Changes

**Settings → Web Application Updates → Preview Changes** displays installed/candidate core versions, the approved source, extension compatibility, local tracked/staged/untracked changes and blocking reasons. Git-backed previews fetch references only; they do not check out code, install packages, stop PM2, apply SQL or publish.

Dirty core files, divergent branches, direct committed core modifications, missing baseline/tag/metadata, inaccessible sources and incompatible extensions are blockers. An unavailable source is **not** “already up to date.” A published runtime without Git can check a public approved GitHub release feed but cannot prepare its own replacement.

The legacy GitHub Releases URL in Settings does not override the approved `coreSource`. There is no hard-reset fallback or instruction to discard custom work.

## Standalone staging and activation

From the protected existing application root, prepare an **outside, new** directory. Examples:

```cmd
npm run stage:customer-release -- --tag v2.2.0 --target C:\meterflo-releases\v2.2.0
```

```sh
npm run stage:customer-release -- --tag v2.2.0 --target /srv/meterflo-releases/v2.2.0
```

Staging verifies the selected core tag/commit and package compatibility, copies customer package source, installs separate locked graphs with build dependencies, type-checks/builds/tests and writes a receipt. It never copies `.env`, the customer database, or uploaded files; failed staging never invokes PM2. Keep the failed directory for private troubleshooting or choose a new target on retry. No pre-existing candidate directory is overwritten or deleted automatically.

Review the candidate in an isolated test environment, especially customer integrations and custom behavior. Confirm a current database/files/private-configuration backup. For same-schema standalone activation:

```cmd
npm run activate:customer-release -- --candidate C:\meterflo-releases\v2.2.0 --health-url http://127.0.0.1:3000/api/system/release-health --confirm-backup
```

Use the actual local port (Linux uses the same options with Linux paths). The private, policy-validated `deploy/ecosystem.config.cjs` must exist. Activation preserves its name/process settings, protected working directory and environment-loading behavior while selecting the candidate's compiled script. Customer storage paths remain rooted at the existing instance, not the new release directory.

The candidate must have an unchanged receipt/build/lockfile/core manifest. Customer package/source configuration must still match the staged snapshot. The existing compiled baseline's health is verified before changing PM2. Candidate health must match its core version and customer package content hashes; the check waits through old workers during PM2 reload. Failed activation reloads the prior application and verifies its health. If recovery also fails, the command explicitly reports that the service may be unavailable. Database/data restores are never automatic.

A successful activation is recorded in the ignored `meterflo.activation.json`; retain the prior complete application/dependencies. For a later operator-managed recovery, the secret-free prior PM2 configuration and prior release metadata are in `generated-artifacts/customer-activation/`. Review schema compatibility, reload `prior.pm2.json`, verify the prior health result, and restore the prior pointer from `prior-release.json` (or remove the pointer only when returning to the original baseline). Do not blindly roll back application code after incompatible database changes.

## Customer-owned Replit publishing

1. Retrieve the selected core tag in the **customer's workspace**, keeping customer packages/configuration separate. Use a reviewed merge for an existing fork; never force the workspace to match the core.
2. Prepare/test the composed candidate and review migrations. Then reconcile that exact core release into the workspace that will be published, retaining the customer package directories and instance manifest needed by the build.
3. Run the checks/build/tests again in that workspace. Confirm the build's `dist/customer-release.json` and compiled customer reports match the tested core/package versions.
4. Review the files actually included in the publishing build; do not assume Git-ignore behavior alone controls a deployment snapshot. Preserve production database/storage connections and protected secrets; do not ship `.env`, staging receipts or local activation records.
5. The customer/operator explicitly republishes the existing app. Changing this core app, committing Git changes or preparing a candidate does not update the customer's published snapshot.
6. Verify the published release-health response and sign in to test the actual customer screens, permissions and integrations. Do not claim workspace/Linux tests prove the customer deployment worked.

PM2 activation is **only** for standalone installations. The published app does not mutate its code or publish itself. Official publishing reference: https://docs.replit.com/features/publishing/after-you-publish

## Database ownership and migrations

Core migrations declare `ownership: "core"`; extension migrations declare their extension owner. Files must remain within the owner's directory, match SHA-256 and have unique IDs. Maintain customer tables under a clear extension namespace; never use a generic schema push or core database restore to erase unknown customer tables/columns.

No migration SQL is executed by these tools. Approval is a human attestation after DBA review/application, not evidence that the tool inspected a database. Schema-changing updates require a separate controlled maintenance procedure. Automated PM2 activation/recovery is restricted to the same schema revision, and irreversible migration declarations must not be represented as safe code-only rollbacks.

### Exact bytes and Windows line endings

Migration checksums are SHA-256 hashes of the **exact file bytes**, not normalized
SQL. Build, staging and activation retain strict validation; a CRLF file is not
silently accepted in place of a declared LF migration.

Core `migrations/**/*.sql` files are pinned to LF by `.gitattributes`. Keep
released migration contents and checksum approvals immutable. Customer packages
remain customer-owned: their maintainers should declare their own appropriate
Git attributes and publish file bytes that match their approved checksums. Core
attributes and the repair command do not normalize customer package source or
alter package content hashes.

Use `npx --no-install tsx script/migration-checksums.ts --check` from the install
root for read-only diagnostics across core and configured extension migrations.
An explicit `--repair-core <migration-id>` can repair one reported `crlf-only`
core migration only if the LF candidate matches the already declared checksum
and every other migration is valid. It retains an original-byte backup and does
not approve or execute SQL. Genuine edits, wrong manifests, unsupported encodings
and extension mismatches remain blocked. No checksums, approvals or schema
revisions are automatically recalculated.

See [Windows checksum recovery](deploy/WINDOWS_DEPLOYMENT.md#104a-migration-checksum-failures-on-windows)
for exact existing-checkout recovery commands and update precautions. Do not
repair an already prepared candidate in place: its receipt may depend on those
bytes. Repair the protected source checkout first, then prepare a fresh candidate.

## Existing forks with direct core edits

Back up and commit customer work, fetch the reviewed core release and perform a manual merge in a separate workspace. Resolve conflicts, review non-conflicting semantic changes, move suitable reports into owned packages, and test before promotion. A clean merge is not a compatibility guarantee. Missing history or unrelated forks require maintainer reconciliation, not resetting or overwriting the instance.

For example, after committing reviewed work in the customer repository:
```sh
git clone /path/to/customer-repository /path/to/new-review-workspace
cd /path/to/new-review-workspace
git fetch https://github.com/your-company/MeterFlo-Core.git refs/tags/v2.2.0:refs/meterflo/review/v2.2.0
git merge --no-commit refs/meterflo/review/v2.2.0
git status --porcelain
```
Use the approved source/tag, not the placeholders. A failed merge stays in this
review workspace. Do not copy its code to the live instance or run activation.
Resolve and review conflicts there, independently restore customer package/config
backups into the review workspace, and test. Remaining direct core modifications
continue to block the unmodified-core staging path; use a maintainer-reviewed
customer-composed release until they have been reconciled or moved into extensions.

## Verification coverage

`npm run test:customer-forks` exercises real disposable Git repositories for clean
uncommitted merges, conflicts and manual resolution, staged/unstaged/untracked
source, protected tracked files, independent histories, changed/moved identities,
lost access, interrupted checkout/fetch/merge recovery, approval attestations,
later customer work, changed approved files/configuration/packages, dependency
and schema reconciliation, maintainer readiness, and blocked/available UI
guidance. It does not connect to a customer database, run PM2 or publish.

`npm run test:customer-updates` covers real local Git tags/previews, simulated staged installs/build failures, content preservation, incompatible metadata/migrations, authenticated report permissions/project scopes, and injected PM2/health activation/recovery. Actual build checks compile the composed application and report packages.

`npm run test:migration-checksums` covers strict owner-labelled diagnostics,
read-only checks, explicit backed-up core repair, tampering and encoding
rejection, unchanged approvals/private files, extension boundaries, actual Git
autocrlf checkouts, and the real build's early-failure preservation of `dist`
and chained-restart suppression. This suite never uses a customer database or
invokes PM2.

The automated PM2 tests use a controlled runner, not a live Windows service. Native Windows, the customer's real extensions/database migration and a customer-owned Replit publish require those environments and explicit operator access. Report their results separately from local tests.

`npm run build && npm run test:customer-updates-integration` checks the composed
example screen in Chromium against real development local authentication, role
grant/revocation APIs, project assignments, a customer-owned table/column and
existing audit event identities. The example is exposed only by an isolated test
server, never enabled in the running installation. It creates disposable users,
roles and projects and removes them; their application audit events remain as
evidence of the acceptance run.

Native Windows acceptance (run in a disposable customer test instance, not live):
1. Run `npm run check`, `npm run test:customer-updates` and `npm run build`.
2. Install/configure the test instance's PM2 service using the Windows guide, and
   verify its local `/api/system/release-health` endpoint.
3. Run the staging command above, including a target path containing spaces.
   Record hashes of the test instance's private configuration, photos/APKs and
   customer package source before and after.
4. Activate with the test loopback port and confirmed test backups. Confirm the
   new core and unchanged extension hashes in health, normal login and reports.
5. Make a second test candidate unable to bind the test port; confirm failed
   activation restores the prior health response and all protected hashes.
6. Reject an incompatible extension/core version before PM2 invocation. A passing
   Linux runner test is not evidence that these Windows service/path steps passed.
