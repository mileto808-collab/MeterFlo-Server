---
name: Field changeout priorities
description: User-defined field-first completion, shared work-order claiming and durable wizard captures.
---

Completing work orders through Start Changeout is the first priority for field technicians and authorized users. Inventory reconciliation should happen on the backend after the changeout is completed.

**Why:** The user clarified the operational priority: technicians physically perform the changeout, while inventory bookkeeping is reconciled afterward.

**How to apply:** Evaluate inventory integration against field-first completion, not just quantity-shortage handling. Preserve captured field evidence and make reconciliation an accountable backend process.

For most projects, utility-customer import files create MeterFlo work orders. Open work orders can be bulk-assigned to a group, with multiple technicians seeing the same pool. Scheduled work orders are individually assigned. An Open order may encounter Trouble during an attempted completion and need to be Scheduled for a later completion.

**Why:** Technicians saturate one or multiple routes/zones as directed rather than each receiving an individually scheduled order.

**How to apply:** Preserve shared group access when inventory is disabled: the user subsequently explicitly required every group technician to receive group work and completed work to disappear from everyone's active list. For inventory-enabled vehicle dispatch, use the direction in inventory-dispatch-policy.md; do not impose vehicle-batch scoping on inventory-disabled projects.

Captured work-order wizard data must survive browser refreshes and interruptions, including closing or locking a mobile screen and reopening it during a long physical changeout.

**Why:** The user said reopening a device can trigger a browser refresh, and technicians must not lose already-collected data.

**How to apply:** Provide recoverable wizard captures comparable to Inventory order drafts, without requiring re-entry after those interruptions.

Reassignment to another technician or back to a group ends the old draft's submission authority. Returning the work order to the original technician is a new assignment, not permission to submit the earlier draft.

**Why:** The user explicitly asked that reassignment and return-to-group edge cases be considered.

**How to apply:** Preserve earlier captures read-only until an explicit fresh attempt; do not silently rebase old captures onto a newer assignment.

Confirmed work-order completion clears every previous changeout draft for that order, including earlier technicians and assignment attempts. Preserve accepted evidence and reconciliation history separately.

**Why:** The user explicitly clarified that previous drafts should be released and cleared on completion.

**How to apply:** Clear server copies on confirmed completion and device copies after authoritative confirmation. Never erase captures just because a submission timed out or its result is unknown.

The mobile inventory upgrade must show relevant inventory inside the physical changeout wizard, matching the web workflow, not just in Work Order Details.

**Why:** The user explicitly reiterated this requirement and requested a screen-level mobile-agent addendum.

**How to apply:** Include actual-use entry at Physical Changeout, applicable installed-ID serial binding and a dedicated inventory/removed-equipment review. Keep inventory-disabled mobile behavior unchanged.
