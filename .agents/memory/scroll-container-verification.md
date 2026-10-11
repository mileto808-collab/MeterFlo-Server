---
name: Scroll-container verification
description: Prevent false-positive responsive checks when scroll containers clip oversized content.
---

Verify the width of the actual content inside a scroll container, not just the page's width, and inspect a rendered screenshot. Keep wide tables and code scrollable within their own bounded containers.

**Why:** A documentation page passed a phone page-width assertion while its scroll area's intrinsic table layout expanded the article beyond the viewport and clipped prose and columns. Hidden overflow made the outer page appear correctly sized.

**How to apply:** When verifying documentation, long tables, or nested scroll areas, check both article/content width and outer-page width. Radix ScrollArea's inner display-table wrapper can propagate intrinsic widths; constrain that layout locally rather than changing every shared scroll area.
