---
name: Customer-owned instance updates
description: Customer hosting model and the requirement to preserve customer customizations during core updates.
---

Customers will have their own MeterFlo web app instance, hosted on the customer's Replit platform or in the customer's local Windows/Linux environment. Core MeterFlo updates must preserve custom work on those instances.

**Why:** the user described this customer distribution model and asked how to deliver core changes without affecting customer customizations.

**How to apply:** evaluate updates against independently hosted, customized customer instances, not only the core hosted app. Trusted, permission-scoped reports are the initial extension contract; existing direct edits to core still require a reviewed manual reconciliation.

Standalone updates prepare a new candidate outside the running installation, then retain the protected working directory and data when switching compiled code. On customer-owned Replit, updating the workspace is not publication; the operator publishes explicitly. Migration checksum approval is an operator attestation, not proof that the database was changed.

**Why:** replacing files in place could discard customer edits or strand relative storage paths; automatic database rollback could destroy newer records. A hosted published snapshot does not automatically change when its workspace changes.

**How to apply:** keep future contracts versioned and customer-owned source separate from core. Require controlled database maintenance for schema changes and never claim a customer-hosted rollout was verified solely from local checks.
