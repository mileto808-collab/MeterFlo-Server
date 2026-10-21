---
name: Scanner commit boundary
description: Commit scanned serials on explicit scan delimiters or paste, without disrupting neighboring controls.
---

Commit serial scans on Enter, Tab, or paste, not by rewriting the scan field when it loses focus. Keep an unfinished typed token intact until committed, including when it shares a prefix with a prior serial.

**Why:** Blur-time normalization interfered with the next visual-acceptance button click in fulfillment verification. Premature duplicate detection while typing can also prevent entering distinct serials with a common prefix.

**How to apply:** Reject repeated committed serials immediately, keep the scan field ready for the next scan, and show the warning next to that field. Preserve final submission and server validation, and verify scanning alongside checkbox selection and visual acceptance rather than testing the scan box alone.

Input-processing guards must agree with whether the scan field is visibly enabled.

**Why:** A completed stock post can unlock its field before background query refresh finishes. A separate busy guard silently dropped scans during that interval despite the field accepting focus.

**How to apply:** Keep uncertain-outcome and permission locks intact, but do not silently reject input in an enabled scan field merely because background refresh is still finishing.
