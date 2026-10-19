---
name: Project timezone display
description: User requirement for readable project-local dates and times across inventory views and printing.
---

Times displayed on project-related receipts and detail pages must inherit the project's timezone settings, not the browser, computer, or server timezone.

**Why:** The user explicitly required project-timezone inheritance while asking for readable inventory receipt and custody-history dates.

**How to apply:** Use the same project timezone for screen details, printed receipts/PDFs, custody and decision history, and local count-recovery displays. Include a timezone indicator where times are shown. Keep original stored timestamps and audit evidence unchanged; formatting is a display concern.

Verify project timezone inheritance with deliberately different project and site settings, including disabled site timezone handling.

**Why:** Matching defaults can let tests pass even when a detail-data API mistakenly uses the site timezone instead of the project's setting. Correct formatting alone does not prove correct timezone selection.

**How to apply:** Check both returned detail metadata and rendered/printed dates with conflicting timezones. A site-wide enable/disable switch must not override an explicitly configured project timezone.

Inventory date ranges use inclusive project-local days and only recorded timestamps. Removed Equipment matches custody/decision events; Cycle Counts matches recorded count activity rather than an invented creation date.

**Why:** Some inventory records have event histories or ledger evidence but no independent creation timestamp. Assigning a fabricated date would hide valid history or falsely imply when the record was created.

**How to apply:** State the date basis in the filter. Include a record when any relevant event matches. Undated records remain visible without date filters, but are excluded when a date bound is active. Filter exports using the same matching rows as the screen.
