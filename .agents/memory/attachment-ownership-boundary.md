---
name: Attachment directory ownership
description: Why historical project directories must not be assigned using a numeric suffix alone.
---

An old project's directory must not be claimed by a current project solely because
its name ends with the same numeric project ID.

**Why:** Existing development storage contained old project-named directories with
IDs also present in the current database. A database reset can reuse IDs, while a
rename can leave an old name; the directory suffix alone cannot distinguish them.
Guessing can attach another project's evidence to the wrong project.

**How to apply:** Resolve work-order ownership from the current project's full
namespace and relational records. Preserve and report unclaimed roots for explicit
review; do not rename or delete them automatically. Unclaimed unrelated roots are
not a reason to make already-canonical current attachments inaccessible. Applying
maintenance still requires resolving the unclaimed inventory.
