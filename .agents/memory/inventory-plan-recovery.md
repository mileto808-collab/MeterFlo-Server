---
name: Inventory plan recovery boundary
description: Historical planning acceptance, negative fences, and current authorization are separate concerns.
---

Historical acceptance of an exact planned-inventory command is not permission to
read today's inventory or make another edit. Confirm only the original actor's
command, under authenticated current project access; keep account and access
locks enforced.

**Why:** An offline client can lose a successful response and then lose editing
authority or work-order visibility. Rechecking mutable edit policy before all
recovery can freeze an already accepted attempt indefinitely.

**How to apply:** Use narrow immutable evidence, not today's plan contents.
Preserve original accepted revision separately from any later plan revision.
Legacy fingerprints can prove acceptance without supplying an invented revision.

An absent receipt is unresolved, not proof that a command failed. Definitive
nonacceptance requires a durable fence serialized with original command posting.
Never let a delayed original POST commit after a negative resolution.

**Why:** An earlier request may still be running or waiting for a transaction
lock. A replacement operation identity can duplicate demand if the original
commits later.

**How to apply:** Keep uncertain journals immutable until exact accepted evidence
or a committed fence is durably reconciled. Retain operation identities and fences
without time-based pruning. Destructive database rollback is an administrative
recovery event, not an ordinary missing-row outcome; pause and reconcile offline
journals rather than treating the restored database's absence as historical proof.
