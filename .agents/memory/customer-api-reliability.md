---
name: Customer API product expectations
description: The user's inbound and outbound Customer API requirements.
---

When enabled, Customer API must push all relevant captured work-order data to the customer's backend. Failed delivery must retry automatically; admins must also be able to retry manually and view logs for troubleshooting.

**Why:** The user explicitly said Customer API needs to work, and requested delivery reliability rather than a best-effort outbound call.

**How to apply:** Preserve these requirements when adding or changing completion, trouble-report, or mobile/offline workflows. Review the customer guide against actual behavior rather than describing planned capabilities as already available.

API-based work-order pulling is an additional import option alongside Excel/text uploads, not a replacement.

**Why:** The user requested pulling customer work orders as an additional option to uploading Excel/text files.

**How to apply:** Keep the existing file-upload import paths available when adding customer API imports.

Conservative import merging is intentional: protecting field work takes precedence over applying the latest customer baseline. An Open status or an absent editor name is not sufficient proof that a work order is untouched.

**Why:** Technician workflows can change baseline values before completion, and not every mutation records an editor. A permissive merge could erase work while appearing safe.

**How to apply:** Preserve provenance/version-based merge protection. Do not widen eligibility based only on status or missing actor metadata; describe the conservative behavior clearly in customer setup instructions.
