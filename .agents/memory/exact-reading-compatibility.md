---
name: Exact reading compatibility
description: Why exact text is authoritative while numeric API fields remain compatible.
---

Preserve exact reading strings without replacing existing numeric columns or
silently changing the legacy numeric API contract. Coordinate consumption of
the authoritative text values with the separate mobile app.

**Why:** Numeric storage discards leading zeros, and JavaScript numbers can
round long readings. Existing deployed mobile clients still need the old
contract; the web/server fix must not require a simultaneous native release.

**How to apply:** For future reading changes, preserve original text through
offline sync, exports, customer delivery, and reset Notes. Treat a matching
legacy numeric echo as unchanged, even if its float view was rounded. Never
invent missing historical padding. Any removal of numeric compatibility fields
requires explicit coordination with mobile consumers.
