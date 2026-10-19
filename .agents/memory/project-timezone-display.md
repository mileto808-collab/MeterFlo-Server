---
name: Project timezone display
description: User requirement for readable project-local dates and times across inventory views and printing.
---

Times displayed on project-related receipts and detail pages must inherit the project's timezone settings, not the browser, computer, or server timezone.

**Why:** The user explicitly required project-timezone inheritance while asking for readable inventory receipt and custody-history dates.

**How to apply:** Use the same project timezone for screen details, printed receipts/PDFs, custody and decision history, and local count-recovery displays. Include a timezone indicator where times are shown. Keep original stored timestamps and audit evidence unchanged; formatting is a display concern.
