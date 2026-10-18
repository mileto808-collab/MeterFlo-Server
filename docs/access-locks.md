# Sitewide and project access locks

Access locks pause user access in one MeterFlo installation. They do not delete
records, change role grants or activate automatically after an update.

## Manage a sitewide lock

1. Sign in with **Manage Sitewide Access Locks** permission.
2. Open **Settings → Security → Access locks**.
3. Enter the message users should see.
4. Click **Lock access**, review the consequences, and confirm.
5. To reopen access, return to the same control and confirm **Unlock access**.

## Manage a project lock

1. Open **Edit Project → People → Project access lock**.
2. Enter a message and confirm the lock or unlock action.
3. Saving this standalone control does not submit the project form.

**Manage Project Access Locks** permits this action only within the user's
existing project access. Sitewide lock managers may also manage project locks.
Neither permission grants unrelated business permissions or project membership.

## Enforcement and recovery

- Sitewide locks override project locks.
- Sitewide lock managers bypass both scopes so they can recover access.
- Project lock managers bypass project locks, but not sitewide locks.
- Ordinary users' existing sessions are blocked on their next protected server
  request. New ordinary-user sign-ins are also rejected during a sitewide lock.
- Web, mobile, downloads and protected API operations are checked server-side.
  Global work-order/project lists omit locked projects for ordinary users.
- Ambiguous legacy mobile writes and cross-project backup/restore, maintenance
  or audit operations can be unavailable while an affected project is locked.
  Use explicitly scoped tools for unlocked projects where available.
- The web app rechecks status periodically and on focus. It hides retained
  protected content while locked or when status cannot be verified.
- Unlocking does not clear unsaved web-editor state. Reloading or logging out
  can still discard unsaved edits normally.
- Locks do not interrupt requests already in progress, stop background import
  schedules, erase downloaded data, or remotely wipe offline mobile caches.
  Offline devices cannot synchronize through the protected API while locked.
- Lock state persists in the database across restarts and is shared by server
  processes using that database. Separate customer installations are independent.

Each successful change records the authenticated actor, scope, action and
lock-state transition in Audit Logs. User-entered messages are stored in the
access control itself rather than copied into generic audit metadata.
Concurrent administrative edits require reloading and reviewing the latest state.
