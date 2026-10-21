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

Reducing a move quantity must not automatically delete already captured serials to fit the new quantity.

**Why:** Scans are evidence of physical units being handled; workers must choose which entries to remove rather than having the software silently discard them.

**How to apply:** Cap new scans at the requested quantity, but preserve existing captures when that quantity is reduced. Show the excess count and require an explicit correction before posting the move.

Keep serial-scan safety and progress consistent across Inventory, not just Fulfill / Stage.

**Why:** The user explicitly requested the same expected/scanned/remaining counts, duplicate rejection, quantity caps and completion feedback wherever Inventory requires serial scans.

**How to apply:** Reuse shared scan processing and progress controls while retaining workflow-specific custody validation, Good/Damaged buckets, pallet membership and trusted serial-file import. Cycle counts use the entered actual quantity as their target, never the theoretical stock balance; an unknown actual count must not prevent recording discoveries.

Verify bulk scanning through actual browser paste events, not parser tests alone.

**Why:** A single-line input can strip pasted line separators and turn several otherwise valid serials into one concatenated identity before validation ever sees them.

**How to apply:** Preserve clipboard token boundaries through the input boundary and assert the individual identities in saved receipt evidence, including duplicates and over-target entries in the same paste.
