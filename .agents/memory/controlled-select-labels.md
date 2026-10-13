---
name: Controlled numeric select labels
description: Avoid blank Radix numeric-select labels after asynchronous form resets.
---

For controlled numeric selections populated asynchronously, render the effective
value explicitly in the selected-value component instead of relying only on the
dropdown item's text.

**Why:** Reopening an edited project showed blank precision selectors even though
the form and API retained the correct 0/6 values. Waiting for hydration did not
resolve it. Explicit selected-value text corrected the signed-in browser checks.

**How to apply:** Test the displayed label after selecting, saving, and reopening,
including explicit 0 and unequal limits. A passing API-persistence test or visible
form alone does not prove the selection label is correct.
