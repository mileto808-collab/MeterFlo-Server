---
name: Export scope safety
description: Keep an explicit filtered export scope selectable when its result is empty.
---

Where an export-scope selector is offered, allow selecting filtered scope even when it has zero matches;
disable the export buttons instead of disabling the scope option.

**Why:** Disabling the empty filtered option can leave "all" selected when the
user intends to export search results, creating an avoidable over-broad export.

**How to apply:** Show each scope's count and preserve the explicit selection
as searches change. Pagination limits rendering, never the chosen export set.

The Stock & Search header should not have a separate export-scope dropdown.
Its CSV, Excel and PDF actions export all matching records across every page;
without filters, that means all stock. Serial-viewer scope controls are separate.

**Why:** The user approved removing the extra dropdown row to keep more room for
records and keep the header consistent with other inventory tabs.

**How to apply:** Keep search and filters attached to every export chunk and
disable downloads for zero matches. Never treat a page-size limit as an export limit.

Multi-request stock exports must reject changing project revisions rather than
combine pages from different stock states, even if the matching count stays equal.

**Why:** A movement can replace identities or change sort position without changing
the row count; silently combining those pages can omit or duplicate evidence.

**How to apply:** Retain an explicit export scope throughout collection, compare
the revision for every chunk, and ask the operator to refresh/retry on drift.
