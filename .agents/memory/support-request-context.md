---
name: Support request context
description: Authenticated support sender/project associations and draft preservation on responsive screens.
---

Support emails must identify the MeterFlo account that generated the request and the projects that account belongs to.

**Why:** The user requires the received support email to display both account and project membership information, not just an editable contact name and email.

**How to apply:** Resolve identity and memberships on the server. Keep contact/reply details separate from the authenticated account; administrative visibility alone is not membership. Label current-page project context separately.

Stateful global support dialogs must retain drafts and selected attachments when responsive navigation changes its rendering branch.

**Why:** Responsive sidebar branches remount their children at breakpoints, which can silently clear an open support form during phone/tablet rotation.

**How to apply:** Keep the dialog mount outside responsive navigation branches. Verify draft/file preservation across orientation changes and send failures, as well as clearing after successful submission or intentional cancellation.
