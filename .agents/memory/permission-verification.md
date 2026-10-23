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

Keep privileged fixture preparation separate from the account whose access is
being tested.

**Why:** Planning work-order demand and physically fulfilling that demand have
separate authority. Expanding a warehouse test user's role just to seed planned
work would conceal that boundary.

**How to apply:** Prepare prerequisites through the existing authorized
administrator flow, then exercise warehouse and technician actions with their
original restricted roles. Revoke and restore grants through role management.

Hide Inventory tabs, buttons and workflow entry points when the user lacks the applicable permissions; do not merely leave unusable actions visible.

**Why:** The user explicitly said field technicians with View Inventory and Assign Inventory should not see warehouse-only areas or enter Start Inventory simply because they can view work orders.

**How to apply:** Preserve authorized stock lookup, work-order inventory assignment and crew pickup access. Gate management areas by the relevant operational permissions, guard saved/deep-linked screens and permission revocation, and enforce warehouse commands on the server independently.

Work-order viewing must not require warehouse-wide inventory access just to read that work order's inventory requirements and recorded usage.

**Why:** A field technician's authorized work-order detail displayed an inventory loading error because the embedded read required broader inventory permission. Granting catalog/warehouse access solely to fix that panel would broaden access unnecessarily.

**How to apply:** Verify the assignment-scoped read with only work-order permissions, including linked kit components. Keep unrelated work orders, warehouse/catalog endpoints and mutations denied; omit pricing/supplier and unrelated location information. Inventory management and its event stream retain their own permissions.
