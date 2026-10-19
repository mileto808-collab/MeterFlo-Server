---
name: Live module refactors
description: Avoid transient broken imports and refresh failures while changing modules under the active development server.
---

When moving runtime exports, update consumers to import from the already-existing new source before removing the old exports.

**Why:** The live Vite server observes individual file writes. Removing producer exports first caused a failed browser hot reload while the consumer still imported the removed names, even though the final code type-checked and built correctly. A valid final build does not clear an overlay already open in the user's browser.

**How to apply:** Order dependent edits consumer-first, preserve component-only React refresh boundaries, and perform one final workflow restart after the batch. Check fresh authenticated navigation separately from the development overlay. Do not suppress runtime diagnostics to conceal the problem.
