---
name: Permission verification
description: Avoiding false-positive authorization tests when introducing new permissions.
---

Verify new permission grants through the application's normal role-management flow, not only directly seeded test-role keys.

**Why:** A route can correctly enforce a permission that administrators cannot discover or grant. Directly assigning a raw key in a fixture made authorization tests pass while hiding that operator-facing gap.

**How to apply:** Cover administrator discovery and granting, an assigned user's resulting access, and default-denied roles. Keep API route tests, but do not treat successful privileged fixture setup as proof that normal role administration works.
