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
