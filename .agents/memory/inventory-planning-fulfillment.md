---
name: Inventory planning and fulfillment intent
description: User requirements for manual planned work-order items, future warehouse fulfillment, and onsite serial selection.
---

Manual additions under work-order details → Inventory must remain planned until actual use; adding them must not automatically reserve or deduct stock.

**Why:** The user explicitly wants manually added items to follow the planned-demand behavior of imported type-correlated items.

**How to apply:** Keep planned additions distinct from deliberate reservations and from completed-work actual consumption.

MeterFlo receives bulk imported Open work orders assigned to groups; Scheduled work orders are individually assigned. The user eventually wants a fulfillment process under Start Inventory to help warehouses pull and stage stock for that work.

**Why:** Warehouse preparation must reflect the user's crew/group dispatch and individually scheduled installation workflows.

**How to apply:** Treat fulfillment as warehouse preparation, not proof of installation or a reason to promise the same group work separately to every group member.

The installed serial is not known at import time: the technician may grab a random system/module onsite and explicitly record its serial during changeout.

**Why:** The user described this as the normal physical workflow, not an exceptional case.

**How to apply:** Do not require installed-serial allocation during import or planning. Recording serial custody on receipt/transfer is separate from assigning an installed serial to a work order.

Manual fulfillment/staging must work without a wizard. Future wizards streamline existing manual processes and make them accessible from one interface.

**Why:** The user explicitly clarified this task's scope after the initial first-stage proposal.

**How to apply:** Deliver the manual operations and reuse their underlying commands for later guided workflows; do not defer basic fulfillment functionality until wizard implementation.

The user approved a Staging-location approach for the shared stock pool. The fulfillment wizard must cover warehouse pulling, physical staging, and transfer to a vehicle—not stop after planning or staging.

**Why:** The user explicitly requested the warehouse worker be able to handle the whole process in one guided workflow.

**How to apply:** Keep shared crew pools distinct from individually scheduled reservations. Treat Staging as physical custody, never installation, and retain onsite selection of actual installed serials.

After a staging pull is recorded, moving to the vehicle-handoff step must not require another reason or physical confirmation for that same pull.

**Why:** The user found repeated pull controls confusing and expects to continue directly when staging is complete. Vehicle handoff is still a separate physical movement that must be recorded.

**How to apply:** Distinguish navigation from stock posting. Keep partial pulls available, make the next phase clear once staging is complete, and require explicit approval before discarding unrecorded movement entries.

Vehicle handoff must offer visual acceptance of the displayed available staged serials instead of requiring every unit to be scanned again.

**Why:** The user explicitly requested this alternative after reviewing the staged serial list on a phone. This does not remove the requirement to record a physical pickup.

**How to apply:** Acceptance fills the handoff scan list and corresponding quantity, excludes previously delivered units, and preserves matching scans without duplication. It is draft preparation only; retain physical handoff confirmation and server-side custody checks before posting.

Keep the current fulfillment workflow for now, including required recording of pickups. Do not introduce unrecorded direct-from-Staging field use.

**Why:** After discussing stock-aware replenishment, optional vehicle handoff, and Returns locations, the user said, “Lets keep it the same for now. Forced recording pickups is better.”

**How to apply:** Preserve recorded staging and vehicle handoffs. Further replenishment changes, vehicle-free workflows, and a dedicated Returns type remain proposals requiring approval.
