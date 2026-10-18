---
name: Core and project trouble codes
description: Flat shared/project trouble-code choices and rename-safe business-rule references.
---

Core trouble codes must always be available. Custom trouble codes are project-specific and join core codes in the applicable work-order dropdowns and other trouble-code selection surfaces. No sub-trouble-code hierarchy is wanted.

**Why:** The user wants project-specific choices without exposing one project's custom codes to other projects.

**How to apply:** Keep shared and project scopes distinct, and use permanent IDs/keys for custom business-rule references rather than editable names. Renaming a trouble code or custom work-order status must not break a project's custom rule programming.
