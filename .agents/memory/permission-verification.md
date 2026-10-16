---
name: Permission verification
description: Avoiding false-positive authorization tests when introducing new permissions.
---

Verify new permission grants through the application's normal role-management flow, not only directly seeded test-role keys.

**Why:** A route can correctly enforce a permission that administrators cannot discover or grant. Directly assigning a raw key in a fixture made authorization tests pass while hiding that operator-facing gap.

**How to apply:** Cover administrator discovery and granting, an assigned user's resulting access, and default-denied roles. Keep API route tests, but do not treat successful privileged fixture setup as proof that normal role administration works.

Verify navigation access independently from record-reading and action permissions.

**Why:** A fixture account could read its assigned projects through the API but
reached a 404 in the browser because page-navigation access was not granted.
That can be mistaken for a missing-record or responsive-layout failure.

**How to apply:** Grant the minimal navigation and reading permissions through
normal role management, then separately verify create/edit/delete remain denied.
An API read alone does not establish that the account can enter the page.
