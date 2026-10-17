---
name: Long-term relational design
description: User's standing design direction for this project's data and calculations.
---

Think about long-term design and scalability. Use relational database tables where they make sense, and programmatic behavior where it makes sense; do not implement everything only programmatically.

**Why:** The user explicitly emphasized this while discussing visit planning.

**How to apply:** Persist business facts with appropriate relational types, constraints and relationships; calculate transient plans in code. Prefer columns for one-to-one attributes and separate tables for entities or repeating relationships rather than adding tables solely for their own sake.
