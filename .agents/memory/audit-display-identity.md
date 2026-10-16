---
name: Readable audit identities
description: Preserve immutable audit evidence when presenting human-readable identifiers.
---

Use readable labels without replacing stored audit identities. Capture meaningful
entity labels for new events; resolve legacy labels read-only. Prefer captured
historical names over today's renamed names. If the original subject cannot be
reliably identified, show an audit-event reference rather than guessing a count
or order number. Keep original identifiers and payloads available in collapsed
raw evidence. Never reinterpret a scanned serial as an internal identifier.

**Why:** The user wants readable audit history, but changing presentation must
not rewrite the historical evidence or claim an identity the evidence cannot
establish.

**How to apply:** Apply the same authorized project scope to label resolution,
details, search and exports. Keep raw evidence immutable; exports must use the
applied scope rather than silently broadening an empty selection.
