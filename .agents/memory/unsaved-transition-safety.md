---
name: Unsaved transition safety
description: Preserve local form values until a requested replacement or close succeeds.
---

Treat Discard in an unsaved-changes warning as permission to abandon the editor when the requested transition succeeds, not permission to erase values before attempting it.

**Why:** Reloads, cancellations and creation of a replacement record can fail. Clearing first loses the operator's work even though they remain in the original editor.

**How to apply:** Keep the current form through fallible transitions, replacing or clearing it only on confirmed success. Test failed replacement and cancellation after Discard, not just failed saves. A failed background refresh should not hide a still-usable editor holding local changes.

A dismissed modal must not leave an inaccessible dirty editor behind.

**Why:** Inline editors can remain visible while retaining changes; hiding the same state in a modal can cause unrelated navigation or new-order actions to warn about entries the operator explicitly discarded.

**How to apply:** Treat Cancel, X and Escape as guarded transitions. Stay and failed saves retain the visible editor. A confirmed discard-and-close clears its values, retry attempt and dirty baseline together; normal successful saves keep their confirmation visible outside the closed dialog.
