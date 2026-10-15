---
name: Export scope safety
description: Keep an explicit filtered export scope selectable when its result is empty.
---

Allow the user to select a filtered export scope even when it has zero matches;
disable the export buttons instead of disabling the scope option.

**Why:** Disabling the empty filtered option can leave "all" selected when the
user intends to export search results, creating an avoidable over-broad export.

**How to apply:** Show each scope's count and preserve the explicit selection
as searches change. Pagination limits rendering, never the chosen export set.
