---
name: Inventory phone density
description: User priority for Inventory phone layouts and verification.
---

Inventory on phones must prioritize visible records across every tab, using a menu icon instead of a wrapping tab menu and collapsed Search & Tools like Work Orders.

Inventory Search & Tools must remain recognizable after rotation, including its text label, and preserve the user's open/closed choice like Work Orders.

**Why:** The user reported disappearing controls in landscape. An accessible name can still pass browser assertions when CSS makes the actual label text invisible.

**How to apply:** Check painted label visibility as well as button visibility and accessibility. Include large phones and tablets beyond the compact-landscape breakpoint, not only narrow phone landscape.

**Why:** The user reported that the previous responsive layout used nearly the whole phone screen for menus and controls, leaving records effectively invisible.

**How to apply:** Keep controls accessible without permanently occupying the records area. Verify initial phone loads and short usable viewport heights with actual record-area measurements and screenshots, not only the pager position.

Keep phone navigation compact in landscape too; a wide but short touch screen must not switch to desktop tabs or an expanded desktop sidebar.

**Why:** Rotation crossed the width-only desktop breakpoint, and an outer scroll offset could leave the section menu above the visible area. Portrait-only tests missed it.

**How to apply:** Test portrait → landscape → portrait on the same page, including the app sidebar and real hosting chrome. Verify menu hit targets do not overlap stats, and that hiding tools or statistics increases page capacity whenever another record fits. Do not let expanded evidence permanently inflate the normal row-height estimate.

Phone browser fixtures must use touch/coarse-pointer behavior when testing landscape, including fresh page loads with tools initially collapsed.

**Why:** A wide landscape phone deliberately retains mobile navigation; a test that selects navigation only by viewport width can wait for desktop controls that are correctly absent.

**How to apply:** Follow the actual mobile media query or visible navigation, open Search & Tools before using its actions, and measure nested dialog content as well as page width.

Opening the stock serial viewer on mobile must not focus Search serials or summon the keyboard; search starts when the user taps the field.

**Why:** The user wants to inspect serials without a keyboard covering the list.

**How to apply:** Give opening focus to a non-editable element inside the dialog, retain normal tapping and keyboard accessibility, and preserve desktop search autofocus.

Keep creation actions in the same position across Inventory tabs: first in the subheader action row, including Start count.

**Why:** The user repeatedly requested consistent button placement, specifically including Cycle counts and mobile devices.

**How to apply:** Use the existing compact action-row treatment and collapsed mobile Search & Tools, rather than giving a new tab a separate title-row action position.

Location, item, and order-draft creation belongs in the relevant tab subheader, not duplicated in Inventory's top header. These forms should use same-screen detail views with Back, like Work Orders, rather than modals.

**Why:** The user explicitly requested removal of the three top-header shortcuts and consistent work-order-style editing optimized for phones.

**How to apply:** Preserve the originating list state and existing save/conflict/unsaved-navigation safeguards. Keep Back and save actions visible while long forms scroll; leave unrelated operational dialogs unchanged.
