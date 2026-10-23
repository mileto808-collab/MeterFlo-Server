---
name: Unsaved transition safety
description: Preserve local form values until a requested replacement or close succeeds.
---

Treat Discard in an unsaved-changes warning as permission to abandon the editor when the requested transition succeeds, not permission to erase values before attempting it.

**Why:** Reloads, cancellations and creation of a replacement record can fail. Clearing first loses the operator's work even though they remain in the original editor.

**How to apply:** Keep the current form through fallible transitions, replacing or clearing it only on confirmed success. Test failed replacement and cancellation after Discard, not just failed saves. A failed background refresh should not hide a still-usable editor holding local changes.

Status recovery that can populate an editor is also a guarded transition, even when the recovery request itself is read-only. Keep new-editor transitions blocked throughout reconciliation, not just during the preceding write.

**Why:** A write may finish before its confirmation read. Allowing another editor to open in between lets the late read overwrite newer local work; a later explicit status retry has the same risk.

**How to apply:** Include reconciliation in the busy boundary, route explicit status checks through the unsaved-change guard, and preserve current values when either the command or confirmation read fails. Never silently re-post an unresolved command just to learn its outcome.

A dismissed modal must not leave an inaccessible dirty editor behind.

**Why:** Inline editors can remain visible while retaining changes; hiding the same state in a modal can cause unrelated navigation or new-order actions to warn about entries the operator explicitly discarded.

**How to apply:** Treat Cancel, X and Escape as guarded transitions. Stay and failed saves retain the visible editor. A confirmed discard-and-close clears its values, retry attempt and dirty baseline together; normal successful saves keep their confirmation visible outside the closed dialog.

Settings section switching is navigation, not permission to save or discard
instance-wide configuration. Keep drafts intact when a form is temporarily
hidden, and require its existing explicit save action.

**Why:** Reorganizing Settings must not accidentally apply security, storage,
update or integration changes that affect other users.

**How to apply:** Preserve mounted child editor state or lift drafts before
replacing a settings pane. Verify unsaved values after switching sections and
rotating a phone, and verify that navigation sends no configuration writes.

Remembering an Inventory tab is a browser preference, not a draft save.
Deliberate Inventory view and tab changes also need browser Back history,
but that navigation is separate from the remembered preference.

**Why:** The global history guard intercepts query-only URL changes too. Updating
the URL solely to remember a confirmed tab transition could prompt before
the editor's clean state committed. Later, the user needed the device Back
button to retrace Inventory screens rather than skip to the dashboard.

**How to apply:** Keep tab preferences scoped to the project and signed-in user.
Give genuine screen transitions same-page browser history, without storing
business inputs there or bypassing the existing unsaved-edit guard.
