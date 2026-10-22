---
name: Shared inventory draft safety
description: Shared handover captures, meaningful-input drafts, and the distinction between editing and uncertain physical posting.
---

Vehicle handover drafts are shared project work, not private browser sessions. Opening a dialog or choosing a mode alone must not create a draft. Preserve actual quantities, raw scans and unfinished barcode tokens across interruptions, without treating an unfinished token as a verified serial.

**Why:** Warehouse work may be resumed by another authorized worker, and the user does not want empty drafts from navigation alone.

**How to apply:** Recheck current stock and work eligibility on resume, and require a fresh physical confirmation for an editable draft. Local buffering is interruption protection, not authority to overwrite another worker's newer shared inputs.

An editable draft and a submitted request with an unknown outcome are different states. Sharing or resolving a draft must never permit a late request to post a second physical movement.

**Why:** Different workers or tabs can resume the same handover while an earlier response is delayed or lost. A successful stock movement must remain linked to exactly one confirmed request.

**How to apply:** Preserve the exact pending request across accounts and retries. Resolve it under the same transaction lock as stock posting; only discard its retry identity after the server proves it posted or is permanently unable to post. A resolution of an old request must not cancel a newer request.

Recovery by another authorized worker may return the existing receipt, but must retain the original posting actor rather than rewriting audit evidence or weakening replay rules for unrelated inventory commands.

An autosave acknowledges its submitted snapshot, not any newer text entered while the request was running. Unchanged saves should be no-ops rather than manufacture new edit revisions.

**Why:** Background recovery and autosave can otherwise change a draft behind the same worker during final review, or replace newer local scans with an older successful response.

**How to apply:** Merge acknowledgements into the latest local capture, recover an interrupted buffer once, and stop background recovery while preparing a physical command. Compare captured objects independently of database JSON key order.
