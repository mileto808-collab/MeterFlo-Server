---
name: Core and project trouble codes
description: Flat shared/project trouble-code choices and rename-safe business-rule references.
---

Core trouble codes must always be available. Custom trouble codes are project-specific and join core codes in the applicable work-order dropdowns and other trouble-code selection surfaces. No sub-trouble-code hierarchy is wanted.

**Why:** The user wants project-specific choices without exposing one project's custom codes to other projects.

**How to apply:** Keep shared and project scopes distinct, and use permanent IDs/keys for custom business-rule references rather than editable names. Renaming a trouble code or custom work-order status must not break a project's custom rule programming.

Customer-facing trouble-code codes and names must be editable independently of their permanent internal identity. Do not treat a descriptive, user-facing code as the permanent identity.

**Why:** The user expects descriptive codes to remain meaningful after a rename. MeterFlo has not been distributed and has no users yet; permanent legacy wire keys and parallel compatibility layers are not an established requirement.

**How to apply:** Use relational foreign keys for canonical work-order references and database cascading for any deliberately permitted referenced-key change. Migrate existing development records and update first-party consumers together rather than retaining parallel legacy fields without a demonstrated dependency. Preserve portable rule identities; never rename by deleting/recreating definitions or rewriting historical notes. Renaming a trouble-code definition must not change a work order's main workflow status.
