---
name: Customer-owned instance updates
description: Customer hosting model and the requirement to preserve customer customizations during core updates.
---

Customers will have their own MeterFlo web app instance, hosted on the customer's Replit platform or in the customer's local Windows/Linux environment. Core MeterFlo updates must preserve custom work on those instances.

**Why:** the user described this customer distribution model and asked how to deliver core changes without affecting customer customizations.

**How to apply:** evaluate updates against independently hosted, customized customer instances, not only the core hosted app. Trusted, permission-scoped reports are the initial extension contract; existing direct edits to core still require a reviewed manual reconciliation.

The user defines "custom work" as development on any standalone MeterFlo
instance, including direct file edits, another development tool, local
Windows/Linux work, and separate Replit projects in either their own or a
customer's account. This Replit project and its Git repository are the
authoritative CORE MeterFlo server source for all other MeterFlo instances.
Separate development and production Replit projects are part of the supported
hosting model.

**Why:** The user explicitly clarified that preserving only supported extension
packages is narrower than their intended customization/update requirement.

**How to apply:** Preserve the full customer source history, not just extension
directories. Distinguish developer-reviewed merges for arbitrary direct edits
from the narrower staged-extension automation. Explain and document the
core-to-customer merge, customer revision deployment, and explicit Replit
publication separately; never claim a routine pull automatically reconciles
customer business rules.

Keep direct-code merge-review approvals separate from unmodified-core staging
receipts. A merge review records an operator's attestations for an exact combined
customer revision; it is not automatic test evidence, database readiness proof
or deployment authorization.

**Why:** Arbitrary customer forks can retain intentional core changes that the
package-staging trust contract must continue to reject. Conflating the receipts
would let a customized fork bypass exact-core and schema compatibility checks.

**How to apply:** Prepare direct-code reviews in an outside checkout, retain
conflict/interruption evidence, require semantic/customer regression review,
and deploy/publish the approved customer revision through a separate explicit
handoff. Never add a fallback that fabricates a package-staging receipt.

Standalone updates prepare a new candidate outside the running installation, then retain the protected working directory and data when switching compiled code. On customer-owned Replit, updating the workspace is not publication; the operator publishes explicitly. Migration checksum approval is an operator attestation, not proof that the database was changed.

**Why:** replacing files in place could discard customer edits or strand relative storage paths; automatic database rollback could destroy newer records. A hosted published snapshot does not automatically change when its workspace changes.

**How to apply:** keep future contracts versioned and customer-owned source separate from core. Require controlled database maintenance for schema changes and never claim a customer-hosted rollout was verified solely from local checks.

Preserve exact-byte migration checksums and approval identities across platforms. Fix checkout portability rather than silently normalizing SQL during release validation. Recovery must reproduce an already declared checksum and remain explicit and core-only; customer extension source stays with its owner.

**Why:** Windows-style Git line-ending conversion reproduced a checksum failure for unchanged reviewed SQL. Accepting normalized hashes during validation would blur the boundary between the bytes reviewed/approved and those actually distributed.

**How to apply:** Pin distributed core SQL line endings and retain original bytes before a targeted repair. Genuine SQL changes, wrong manifests, and unsupported repair encodings remain failures; checksum repair never implies database migration or approval.
