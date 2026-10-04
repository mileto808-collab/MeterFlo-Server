---
name: Work-order reset scope
description: Why reopening a Completed work order preserves customer and meter/module information.
---

Treat reopening a Completed work order as lifecycle-state cleanup, not recreation of a completely blank work order.

**Why:** The approved request specified clearing time tracking, signature, and completion-related audit information while retaining work-order identity and history. Deleting customer or meter/module data was not requested and could erase baseline information needed for another visit.

**How to apply:** Preserve customer and meter/module fields during reset unless the user explicitly requests broader clearing. Keep creation history; record the reset as the latest update instead of erasing it.