---
name: Work-order display identity
description: User requirement for customer work-order identifiers on inventory screens, exports and individual printouts.
---

Always display the customer work-order ID, unless it is empty; then use the internal work-order number.

**Why:** The user identified an internal row number presented as the work-order number in Removed Equipment and its printed report, and explicitly requested customer work-order IDs instead.

**How to apply:** Apply the same readable identity to cards, search, CSV, Excel, list PDF/print and individual entry printouts. Preserve leading zeros and descriptive text. Keep internal IDs as relational keys and inventory/audit references; do not renumber records or rewrite historical evidence. Resolve identifiers within the project and only for inventory records the caller may view.
