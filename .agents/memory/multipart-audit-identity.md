---
name: Multipart audit identity
description: Preserve authenticated identity through streamed uploads before audited file writes and inventory completion.
---

Establish the authenticated audit actor again after multipart parsing, before any audited file writes or inventory completion. Missing request identity must fail closed rather than silently substituting an import account.

**Why:** Buffered and file-free tests passed, but streamed before/after photos resumed outside the request's AsyncLocalStorage scope. A final stock check then reported missing inventory permission even though the technician had that permission, because it no longer knew which user was completing the work.

**How to apply:** Cover streamed multipart file bodies, not only multipart text fields or fully buffered small requests. Test a normally configured technician with changeout and inventory-use permissions but without general work-order editing. Assert successful completion, correct stock deduction and audit attribution; also verify revoked permissions remain denied. Keep trusted non-stock import flows explicit and separate from interactive completion.
