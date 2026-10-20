---
name: Backup output completion
description: Why successful PostgreSQL process exit cannot authorize consuming its piped output file.
---

Wait for both the database tool and its destination stream to finish before filtering, archiving, measuring or serving a native backup. A zero process exit code is not sufficient.

**Why:** An intermittent isolated restore failed with a truncated SQL identifier. The producer had exited successfully while the file writer was still pending; immediate audit-hook filtering could read and rewrite that incomplete dump. A delayed-filesystem fixture reproduced the gap.

**How to apply:** Keep deterministic slow-write and output-error acceptance alongside real disposable-database round trips. Any new dump/export consumer must await destination completion, propagate disk failures and avoid presenting incomplete output as a successful backup. Preserve pre-existing files when the destination could not be opened at all.
