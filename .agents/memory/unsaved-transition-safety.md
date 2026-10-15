---
name: Unsaved transition safety
description: Preserve local form values until a requested replacement or close succeeds.
---

Treat Discard in an unsaved-changes warning as permission to abandon the editor when the requested transition succeeds, not permission to erase values before attempting it.

**Why:** Reloads, cancellations and creation of a replacement record can fail. Clearing first loses the operator's work even though they remain in the original editor.

**How to apply:** Keep the current form through fallible transitions, replacing or clearing it only on confirmed success. Test failed replacement and cancellation after Discard, not just failed saves. A failed background refresh should not hide a still-usable editor holding local changes.
