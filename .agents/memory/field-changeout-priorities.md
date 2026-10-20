---
name: Field changeout priorities
description: User-defined field-first completion, shared work-order claiming and durable wizard captures.
---

Completing work orders through Start Changeout is the first priority for field technicians and authorized users. Inventory reconciliation should happen on the backend after the changeout is completed.

**Why:** The user clarified the operational priority: technicians physically perform the changeout, while inventory bookkeeping is reconciled afterward.

**How to apply:** Evaluate inventory integration against field-first completion, not just quantity-shortage handling. Preserve captured field evidence and make reconciliation an accountable backend process.

For most projects, utility-customer import files create MeterFlo work orders. Open work orders can be bulk-assigned to a group, with multiple technicians seeing the same pool. Scheduled work orders are individually assigned. An Open order may encounter Trouble during an attempted completion and need to be Scheduled for a later completion.

**Why:** Technicians saturate one or multiple routes/zones as directed rather than each receiving an individually scheduled order.

**How to apply:** The intended first-claim behavior is to remove a claimed order from every other technician's eligible work-order list through SSE, without waiting for completion. Treat this as the user's required behavior, not proof that the current implementation already does it.

Captured work-order wizard data must survive browser refreshes and interruptions, including closing or locking a mobile screen and reopening it during a long physical changeout.

**Why:** The user said reopening a device can trigger a browser refresh, and technicians must not lose already-collected data.

**How to apply:** Provide recoverable wizard captures comparable to Inventory order drafts, without requiring re-entry after those interruptions.
