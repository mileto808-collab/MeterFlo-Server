---
name: Scroll-container verification
description: Prevent false-positive responsive checks when scroll containers clip oversized content.
---

Emulate touch input when verifying phone landscape, not only its viewport dimensions.

**Why:** Touch-specific compact layouts use pointer capability as well as screen size. A mouse-only browser at phone-landscape dimensions can select the desktop layout and falsely report clipped controls.

**How to apply:** Use a touch-capable browser context for phone portrait/landscape acceptance; separately verify desktop mouse layouts where relevant.

Verify the width of the actual content inside a scroll container, not just the page's width, and inspect a rendered screenshot. Keep wide tables and code scrollable within their own bounded containers.

**Why:** A documentation page passed a phone page-width assertion while its scroll area's intrinsic table layout expanded the article beyond the viewport and clipped prose and columns. Hidden overflow made the outer page appear correctly sized.

**How to apply:** When verifying documentation, long tables, or nested scroll areas, check both article/content width and outer-page width. Radix ScrollArea's inner display-table wrapper can propagate intrinsic widths; constrain that layout locally rather than changing every shared scroll area.

Keep a fixed-header scanner dialog's outer container from scrolling when the browser focuses a control in its inner pane.

**Why:** `overflow: hidden` still allows programmatic focus scrolling. After an import expanded the scanner content, the browser scrolled the outer dialog, hiding its title and moving its footer despite passing a width-only check.

**How to apply:** Bound the dialog height, scroll only the inner content, and use non-scrollable clipping on the outer container where appropriate. After scanner focus and large content changes, verify the outer scroll offset stays zero and inspect header/footer positions in desktop and phone screenshots.

Keep persistent page controls outside a bounded content scroller when an ancestor's overflow prevents CSS sticky from following the actual scrolling surface.

**Why:** Inventory's sticky styling passed a static visual check but scrolled off-screen in the authenticated layout; its overflow ancestor was not the surface the visitor was scrolling.

**How to apply:** Verify that real content scrolls and controls retain their viewport position on desktop and phone. Check the scrolled screenshot for content leaking above or behind the header, not just its bounding box. After resizing a scrolled page from tall to short, compare persistent titles against the bottom of the app header, not merely against viewport zero: an on-screen title can still be obscured by sticky app chrome.

Start responsive measurements when the actual results element attaches, not
only when the selected-tab state changes.

**Why:** Radix tabs can mount their content after a parent effect runs; a
one-time null ref check can leave adaptive pagination stuck at its initial size.
Fixed viewport-height subtractions also miss hosting banners and app chrome,
which can place an otherwise bounded pager below the visible screen.

**How to apply:** Observe the attached results node and measure available space
from its actual layout. Verify the pager bottom against the viewport on phones,
and keep expanded-detail height separate from normal collapsed-row capacity.
Also check usable results height: a pager can fit while a wrapped sticky toolbar
leaves almost no room for records. Compact redundant mobile toolbar content
instead of treating a merely nonzero scroll area as sufficient.

Invalidate cached row-height estimates when data, sorting, or visible columns
change, and re-observe replacement rows even if the record count stays the same.

**Why:** A container resize observer alone cannot detect every same-size row
replacement. Retaining an old tall-row estimate can leave avoidable empty space
after columns or records change.

**How to apply:** Include the data and presentation inputs in measurement
lifecycle dependencies, rather than tying remeasurement only to item counts or
viewport dimensions.

Verify that unused results space cannot fit another complete record when more
records remain. Do not merely copy the implementation's page-size formula into
the acceptance test.

**Why:** A conservative height estimate and an unnecessary space reservation can
both agree with a test's expected count while visibly leaving records off-page.
Repeated project badges are also an unreliable basis for compact row capacity.

**How to apply:** Include users with zero, one, and several long project
assignments in density checks. Measure actual remaining space and row bounds;
keep multi-valued project lists in their read-only viewer rather than tall rows.

Server pagination needs stable page boundaries during ordinary Next/Previous
navigation. Reflow from page one when viewport or header geometry changes,
rather than changing the limit under a later page.

**Why:** A taller record on a later page can change the measured limit and thus
the offset, making Previous return fewer or different records. Treating temporary
scrollbar widths as viewport changes can also restart measurement/loading loops.

**How to apply:** Distinguish real layout geometry changes from scrollbar
appearance. Verify idle request stability and exact first-page record identities
after navigating through mixed-height later pages, not just an initial screenshot.
