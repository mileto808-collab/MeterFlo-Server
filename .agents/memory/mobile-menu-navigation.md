---
name: Mobile menu navigation
description: Mobile navigation behavior after selecting a destination.
---

The mobile navigation menu should close when the user selects a destination,
including another project's work orders or another menu item. Inventory screens
should retrace their views when the device Back button is pressed, rather than
skipping straight to the dashboard.

**Why:** The user reported that the menu remained open after navigating and
that Back from Inventory unexpectedly left for the dashboard.

**How to apply:** Close the mobile menu on actual selection as well as route
change, without collapsing a project group merely when expanding it. Preserve
same-page view history while keeping existing draft and unsaved-change guards.
