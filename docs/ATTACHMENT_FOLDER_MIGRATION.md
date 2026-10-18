# One-time attachment folder maintenance

Normal uploads, lists, downloads, deletes and resets now use only:

```
<configured project_files_path>/<sanitized project name>_<project ID>/
  Work Orders/<sanitized customer work-order ID, or numeric ID when absent>/
  Project Documents/
  Project FTP Files/
```

Normal file access does **not** search, merge, delete or migrate older folders.
The maintenance command resolves ownership against each project's real work-order
records. It recognizes project-root numeric/customer-ID folders, numeric folders
under `Work Orders`, and `_project_documents`.

## Before applying

- Use the instance's own checkout, `.env`, database, storage setting and service
  account. Do not run against a different instance's database or copy credentials
  into a command. Install build dependencies with the normal updater first.
- Keep the existing file/database recovery copy or filesystem snapshot according
  to the instance's backup policy. This command preserves content, but it is not
  a backup and it intentionally removes a source after verifying its destination.
- Stop **every** application/worker process sharing the database/storage root,
  including PM2 cluster workers and scheduled external writers. `--offline` is
  your explicit confirmation of exclusive maintenance; it does not stop services.
- The source and destination must be ordinary directories, not symlinks/junctions.
  Atomic exclusive publication uses hard links in the destination directory:
  use NTFS on Windows or a Linux filesystem supporting hard links. Unsupported
  filesystems fail before the source is removed.

## Windows: exact commands

In Command Prompt, under the Windows account that owns MeterFlo's PM2 process:

```bat
cd /d C:\xampp\htdocs\meterflo
npx --no-install tsx script/migrate-attachment-folders.ts --dry-run
pm2 stop meterflo
npx --no-install tsx script/migrate-attachment-folders.ts --dry-run
```

Review the summary and resolve **all** blockers. Do not delete colliding files
or guess ownership just to make the command pass. Then:

```bat
npx --no-install tsx script/migrate-attachment-folders.ts --apply --offline
npx --no-install tsx script/migrate-attachment-folders.ts --check
deploy\Update-MeterFlo.cmd
```

The updater includes a read-only attachment readiness check after maintenance and
before restarting. It never applies this migration automatically. A failed check
leaves MeterFlo stopped and prints the maintenance command. After a successful
update, verify upload/download and normal sign-in through the Apache URL.

For a source-only development run, after the check succeeds, start the normal
development workflow instead of PM2. For Linux, use the same `npx --no-install`
commands from the checkout and stop/start the configured service manager instead
of assuming PM2. Replit development instances use the workspace workflow controls.

## Blockers

Every destination filename must be unique, case-insensitively for portability.
**Even an identical duplicate blocks migration:** the utility never chooses one
copy and discards the other. Nested directories are preserved.

Ambiguous numeric IDs, sanitized-ID collisions, unmapped work-order directories,
symlinks, inaccessible paths and unsupported file
types fail explicitly. Unrelated FTP files and other projects' content are not
moved. Project-like root directories that do not match an existing project's
complete canonical name are reported as **unclaimed**. A reused numeric ID
suffix is not proof of ownership. Applying migration is blocked until those
directories are reviewed/archived, but readiness of existing canonical projects
does not depend on reassigning unrelated old directories.
Resolve uncertain ownership with the database/file evidence before retrying.

Dry run creates neither directories nor journals. Apply inventories and hashes
again, so run dry run again after stopping writers if the instance was active.

## Resume after failure

Leave MeterFlo stopped. Correct the reported permissions, disk or filesystem
problem, then:

```bat
npx --no-install tsx script/migrate-attachment-folders.ts --resume --offline
npx --no-install tsx script/migrate-attachment-folders.ts --check
deploy\Update-MeterFlo.cmd
```

The journal is `<project_files_path>/.meterflo-attachment-migration/journal.json`.
It records relative paths, SHA-256 digests and copy/verification/completion state.
Original sources remain until their copied bytes are verified. A copy interrupted
before publication is retried using its dedicated UUID-scoped temporary file.
Already-completed moves are checked rather than repeated. Completed journals
are retained; a later run archives the previous completed journal.

A normal error releases the migration lock. A killed process/power loss may leave
`.meterflo-attachment-migration/lock`. Verify that **no migration process or
application writer is running**, then remove only that empty lock directory:

```bat
rmdir "C:\xampp\htdocs\meterflo\Project Files\.meterflo-attachment-migration\lock"
```

Adjust this example to the configured storage root. On Linux use `rmdir` for the
same directory. Never use recursive deletion on the migration state directory,
never delete the journal to bypass a failure, and never reset the database.
A changed source/destination or unrecognized staging file requires review, not
automatic replacement.

After restoring an archive from before this maintenance, stop the service and
repeat inventory/check before returning it to use. A completed journal restored
at a different root/OS is historical evidence only, never a set of executable
paths for that new root. Unfinished journals cannot be resumed against a different
root.

## Verification and limits

```sh
npm run check
node --import tsx --test tests/attachment-migration.test.ts
node tests/support/project-workspace-sandbox.mjs tests/attachment-files-ui.cjs
```

The browser/API check requires a current `npm run build`; it owns a disposable
database and files directory. Unit checks cover collisions, ambiguity, interrupted
copies, journal resume, lock protection, source changes and symlink boundaries.
Linux simulations and command-order tests do not certify an actual Windows
NTFS/PM2 installation. Do not claim Windows acceptance without running it there.
