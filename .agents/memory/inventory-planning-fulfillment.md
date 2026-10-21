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
