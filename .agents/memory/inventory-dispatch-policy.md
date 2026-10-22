---
name: Inventory-dependent dispatch direction
description: User's required distinction between ordinary group work and vehicle-batch dispatch.
---

When inventory is not enabled, group-assigned work orders go to every technician in the group and completed work drops off everyone's active list. Do not change this behavior while implementing inventory dispatch.

**Why:** The user explicitly required this behavior to remain unchanged.

**How to apply:** Keep inventory-specific dispatch restrictions conditional on project inventory use. Do not apply vehicle membership or fulfillment requirements to inventory-disabled projects.

For inventory-enabled fulfillment, the user wants technicians' work lists to reflect eligible work orders picked into staging for their vehicle batch rather than the entire bulk-assigned group pool. Vehicle location membership should support multiple technicians and technicians working out of more than one authorized vehicle.

**Why:** The user described vehicle-based dispatch as the desired operational model, rather than group assignment alone determining field work.

**How to apply:** Distinguish pickup visibility at staging from actual handoff/custody. Preserve reading-only, direct-warehouse and no-material operating paths rather than imposing a universal vehicle fulfillment gate.

Technicians who finish their own work must be able to help another crew easily. Authorized additional vehicle membership grants access to that vehicle's shared work; individually scheduled work still requires explicit reassignment. Membership does not itself move stock.

**Why:** The user explicitly clarified that finished crews must be able to get other crews' outstanding work on their devices.

**How to apply:** Reuse the vehicle that actually holds the order's materials for a helping technician's field consumption. A compatible explicit scheduled reassignment after handoff must not strand the order in an unresumable completed batch. Different-vehicle custody changes require physical inventory resolution.

Changes to unposted material planning may be reconciled automatically; changes after posting must never invent a physical stock return or transfer. Saved navigation and captured inputs remain accessible even while final posting needs correction.

**Why:** The user accepted this separation between planning, actual custody, and recoverable saved work.

**How to apply:** Do not use final posting eligibility as the sole gate for opening previously completed wizard steps. Keep historical movement evidence authoritative even when quantities have returned to zero.

When outstanding work changes vehicles after pickup, retain the original batch's vehicle and pick evidence as history. Current custody belongs to the individual work order's effective vehicle; stock-only handovers do not change that ownership.

**Why:** Crews may take only some of another crew's work. Copying fulfillment batches would count picked demand twice, while changing the original batch vehicle would rewrite history for orders that did not move.

**How to apply:** Dispatch visibility, installation stock sources and compatible scheduled reassignment must follow the work order's effective vehicle, not blindly use its original batch vehicle. Move the selected work's picked materials and reservations with assignment updates in one transaction, preserve completed work, and require explicit resolution of active field drafts or prepared installation use first.
