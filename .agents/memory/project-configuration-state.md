---
name: Project configuration state
description: Preserve draft configuration and independently saved managers when reorganizing project settings.
---

Project configuration navigation and responsive layout changes must never save, clear, or replace local drafts. Users, holidays, service types, and project sub-statuses retain their independently saved behavior rather than joining project submission.

**Why:** The user explicitly requires layout-only reorganization to preserve the distinction between project submission and management operations, including in-progress local management input.

**How to apply:** Keep management state alive across section changes and rotation. Check that management writes do not submit or reset unrelated draft project fields, and that inactive sections still participate in whole-form validation.

Clicking a Projects result row should open the full project details/settings page, not a summary popup.

**Why:** The user repeated the request after the summary popup was implemented; that was not the intended destination.

**How to apply:** Treat “open project details” in Projects navigation as opening the full project page. Keep separate row actions from triggering row navigation.
