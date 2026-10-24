---
name: Equipment-scope preservation
description: Data-retention boundary when project configuration hides equipment fields.
---

Restrict project-bound manual capture and display to the configured equipment,
but preserve existing hidden equipment values and precision limits. Keep GPS and
customer metadata available for either equipment type.

**Why:** The user requested equipment-appropriate settings and work-order surfaces,
not deletion of existing data. Imported/customer baselines and historical readings
can outlive a workflow configuration change; hiding them must not clear them.

**How to apply:** Omit hidden equipment fields from manual write payloads, rather
than replacing them with blanks/nulls. Do not interpret this display rule as
authorization for database cleanup, import scrubbing, or resetting hidden limits.

Reading-only projects must use reading-capture terminology, not language that
implies equipment was removed, installed or replaced.

**Why:** The user explicitly requested terminology that reflects reading-only work.

**How to apply:** Keep replacement-only tools out of ordinary reading-only
details and distinguish existing equipment from captured observations without
rewriting historical equipment data.
