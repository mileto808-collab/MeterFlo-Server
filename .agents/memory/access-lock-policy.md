---
name: Access lock policy
description: User-access locks are operational controls, not project deletion or background-job shutdown.
---

Sitewide and per-project locks pause user access while retaining records, permissions and authorized lock-management recovery access.

**Why:** The user approved the recommendation for an admin/permission-controlled sitewide or project lockout, not destructive cleanup or a maintenance shutdown.

**How to apply:** Treat new mobile, download and indirect/global API paths as part of enforcement, not just login and UI. Preserve the distinction between request access and background jobs. Do not promise offline-device data erasure or interruption of requests already running. Verify delegated recovery through normal role-management grants, including immediate revocation. See `docs/access-locks.md` for the administrator workflow and boundaries.
