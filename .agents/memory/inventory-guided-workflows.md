---
name: Inventory guided workflow entry
description: Product intent for the Start Inventory entry point and permission-aware wizard selection.
---

Start Inventory is the entry to a main wizard screen where users choose an inventory task they have permission to perform. The chosen task then launches its own step wizard; accepting removed systems/modules is one intended task.

**Why:** The user described a common task-selection screen, not a button tied directly to a single receiving workflow.

**How to apply:** When implementing guided inventory workflows, preserve that shared entry and enforce the permissions appropriate to each selected task. Do not assume Start Inventory should jump straight into removed-equipment acceptance.
