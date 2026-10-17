---
name: Dialog background visibility
description: Avoid stale accessibility hiding when inline editors open confirmation dialogs.
---

Do not manually toggle `aria-hidden` on the retained inventory workspace while Radix dialogs also manage background accessibility. Use CSS visibility and inertness to hide the mounted list behind a same-page editor.

**Why:** Radix restores the background's prior accessibility attributes after a confirmation dialog closes. If an editor changes that same attribute during closing, Radix can restore a stale hidden value and leave the visible list inaccessible to keyboard and screen-reader queries.

**How to apply:** Keep nonmodal editors outside the hidden list subtree, preserve the list's mounted state, and verify accessible navigation after Stay, Discard, and save transitions—not just the form's appearance while open.
