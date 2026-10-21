---
name: Clean inventory when copying a project
description: Project copying retains inventory setup, not physical stock or operational history.
---

When copying an inventory-enabled project, the user requires a “clean installation only retaining Locations, Items, Categories, Vendors.”

**Why:** The copied project needs reusable setup, not the source project's physical custody, work or inventory history.

**How to apply:** Keep Inventory enabled and retain the four definition catalogs, including location types needed by copied locations and component recipes needed by copied items. Do not carry balances, serials, reservations, purchase/transfer orders, counts, returns, batches, unfinished captures, work-order plans or source activity history. Give the copy independent catalog identities, remap catalog relationships and clear location user assignments. The new project's own creation/copy audit is appropriate; importing source history is not.
