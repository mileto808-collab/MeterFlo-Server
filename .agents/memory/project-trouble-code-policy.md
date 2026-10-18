---
name: Core and project trouble codes
description: Flat shared/project trouble-code choices and rename-safe business-rule references.
---

Core trouble codes must always be available. Custom trouble codes are project-specific and join core codes in the applicable work-order dropdowns and other trouble-code selection surfaces. No sub-trouble-code hierarchy is wanted.

**Why:** The user wants project-specific choices without exposing one project's custom codes to other projects.

**How to apply:** Keep shared and project scopes distinct, and use permanent IDs/keys for custom business-rule references rather than editable names. Renaming a trouble code or custom work-order status must not break a project's custom rule programming.

Trouble-code machine keys remain unique across the installation, even though custom choices are project-scoped. Labels may be renamed; unused custom definitions are retired rather than identity-reused.

**Why:** Existing work orders, imports and customer integrations already reference immutable trouble-code strings. Allowing duplicate keys across projects without an explicit compatibility migration would make those references ambiguous.

**How to apply:** Preserve those wire keys and portable rule identities during future core updates and restores. Never implement a display-name change by deleting/recreating a definition or rewriting historical notes.
