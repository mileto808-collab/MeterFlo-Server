---
name: Customer API product expectations
description: The user's delivery requirements for customer backends.
---

When enabled, Customer API must push all relevant captured work-order data to the customer's backend. Failed delivery must retry automatically; admins must also be able to retry manually and view logs for troubleshooting.

**Why:** The user explicitly said Customer API needs to work, and requested delivery reliability rather than a best-effort outbound call.

**How to apply:** Preserve these requirements when adding or changing completion, trouble-report, or mobile/offline workflows. Review the customer guide against actual behavior rather than describing planned capabilities as already available.
