---
name: Pre-distribution compatibility scope
description: MeterFlo is not distributed yet; avoid speculative permanent legacy compatibility layers.
---

The user states: "This app hasn't been distributed yet. No one is using yet." They are concerned about accumulated old, irrelevant code.

**Why:** Designing around assumed external users or integrations can add unnecessary parallel fields, aliases, fallback paths, and maintenance burden before release.

**How to apply:** Prefer a single clean model, migrations of existing development data, and coordinated updates to first-party consumers. Require an identified dependency before retaining permanent backward-compatibility machinery. Check the existing Windows development instance and mobile consumers before removing support; pre-distribution is not permission to delete data or perform unrelated broad cleanup.
