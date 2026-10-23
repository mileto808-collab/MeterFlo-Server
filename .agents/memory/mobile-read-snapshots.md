---
name: Mobile read snapshots
description: Keep mobile sync inventory reads non-locking and test actual PostgreSQL snapshot behavior.
---

Mobile synchronization must read inventory on its existing read-only snapshot connection without write locks or first-use migrations. Do not make the transaction writable to accommodate a locking inventory reader.

**Why:** Inventory-enabled downloads failed with PostgreSQL `25006` because their inventory read attempted `SELECT FOR UPDATE` inside a read-only transaction. Disabled-project downloads did not take that path. Mocked query tests did not expose the database transaction-mode incompatibility.

**How to apply:** Keep dispatch, work orders, and inventory in the same consistent read transaction using explicitly read-only inventory access. Verify real authenticated HTTP downloads against PostgreSQL for full and timestamp-delta responses, including nonempty authorized results, disabled-project group access, permission denials, and unchanged inventory revisions. Failed reads must remain errors, not successful empty visibility snapshots.

VM-based route tests pass configuration objects across JavaScript realms; compare scalar properties or normalized plain values rather than relying on cross-realm prototype equality. Update injected dependencies when changing a reader so failure tests still exercise the reader actually used.
