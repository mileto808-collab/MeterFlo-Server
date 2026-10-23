---
name: Inventory step navigation
description: Required validation at every wizard boundary and visual guidance without automatic input focus.
---

All Inventory step wizards must validate required inputs before advancing, not
only before final posting. Serialized quantities require the corresponding
eligible, unique serial captures before leaving capture.

**Why:** The user could advance fulfillment with quantities but no scans and
explicitly requested validation at each step across Inventory wizards.

Opening a wizard or navigating to another step starts at the top. Highlight
incomplete required fields without focusing or scrolling to them. As the user
completes fields and scrolls, update the visual guidance without moving their view.
Do not automatically open the mobile keyboard, including for scan inputs; the
user must tap an input.

**Why:** The user replaced the earlier focus-and-scroll behavior because it moved
the screen and summoned the keyboard unexpectedly.

**How to apply:** Preserve scanner delimiter/paste commits while an input is
already in use, but do not refocus an input after a scan, modal initialization,
step change or async validation. Live refreshes/autosaves are not navigation and
must not reset the current scroll position. Back/edit remains available without
requiring the incomplete current step to become valid.
