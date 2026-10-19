---
name: Browser runtime diagnostics
description: Distinguish native ResizeObserver delivery notices from real application exceptions and preserve development diagnostics.
---

Defer layout writes triggered by ResizeObserver until a later animation frame,
and avoid writing identical geometry. Treat exact native resize-delivery notices
without an Error object as non-fatal notices, not application crashes.

**Why:** Repeated Settings rotations produced native ErrorEvents whose message
was “ResizeObserver loop completed with undelivered notifications.” but whose
Error object was absent. The development overlay discarded the message and
substituted “unknown runtime error,” making a layout feedback loop look like
an unidentified application exception.

**How to apply:** Fix the observer feedback, retain a console notice, and verify
real exceptions still reach the overlay. Diagnostic normalization must register
before the overlay module; installing it in the application entry was too late
even with a capture listener. Preserve actual exceptions and non-Error rejection
messages without serializing arbitrary payload objects.
