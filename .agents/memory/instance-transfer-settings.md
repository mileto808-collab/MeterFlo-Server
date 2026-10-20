---
name: Instance-owned SFTP configuration
description: Why business restores must distinguish destination SFTP setup, access review and revocation.
---

Treat the receiving instance's SFTP listener configuration and customer transfer credentials as instance-owned setup, not disposable business data from another host.

**Why:** The user restored a Replit database onto Windows and had to recreate Windows connection settings and accounts. Replacing the receiving host's configuration with a hosted source's empty setup defeats portable business restores.

**How to apply:** Retain eligible destination configuration by default, offer explicit replacement, and require administrator review before reopening access. Project identity must include stable provenance beyond numeric IDs or editable labels. The SSH host key remains destination-local and is not part of a database restore.

Pausing access after a restore is distinct from permanently revoking credentials.

**Why:** Safety review must not force needless credential recreation or undo deliberate revocations and expiry.

**How to apply:** Keep access closed pending review; preserve existing revocation/expiry and block missing or ambiguous project associations rather than silently rebinding customer credentials.
