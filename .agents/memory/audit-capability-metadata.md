---
name: Audit capability metadata
description: Security distinction between supported audit capabilities and evidence of actual activity.
---

Supported action names are capability metadata, not evidence that an event occurred. They may be offered before the first event, including to scoped readers; historical custom values must remain scoped to authorized recorded activity.

**Why:** Building every choice from existing events hid supported actions and authorized projects before they had activity. Conversely, offering historical custom values from other projects would disclose activity those readers cannot access.

**How to apply:** Keep capability discovery separate from observed-history discovery. Empty matches must stay empty, counts must remain scoped, and metadata availability must never grant global event access or manufacture historical records.
