---
name: Scroll-container verification
description: Prevent false-positive responsive checks when scroll containers clip oversized content.
---

Verify the width of the actual content inside a scroll container, not just the page's width, and inspect a rendered screenshot. Keep wide tables and code scrollable within their own bounded containers.

**Why:** A documentation page passed a phone page-width assertion while its scroll area's intrinsic table layout expanded the article beyond the viewport and clipped prose and columns. Hidden overflow made the outer page appear correctly sized.

**How to apply:** When verifying documentation, long tables, or nested scroll areas, check both article/content width and outer-page width. Radix ScrollArea's inner display-table wrapper can propagate intrinsic widths; constrain that layout locally rather than changing every shared scroll area.

Keep persistent page controls outside a bounded content scroller when an ancestor's overflow prevents CSS sticky from following the actual scrolling surface.

**Why:** Inventory's sticky styling passed a static visual check but scrolled off-screen in the authenticated layout; its overflow ancestor was not the surface the visitor was scrolling.

**How to apply:** Verify that real content scrolls and controls retain their viewport position on desktop and phone. Check the scrolled screenshot for content leaking above or behind the header, not just its bounding box.

Start responsive measurements when the actual results element attaches, not
only when the selected-tab state changes.

**Why:** Radix tabs can mount their content after a parent effect runs; a
one-time null ref check can leave adaptive pagination stuck at its initial size.
Fixed viewport-height subtractions also miss hosting banners and app chrome,
which can place an otherwise bounded pager below the visible screen.

**How to apply:** Observe the attached results node and measure available space
from its actual layout. Verify the pager bottom against the viewport on phones,
and keep expanded-detail height separate from normal collapsed-row capacity.
