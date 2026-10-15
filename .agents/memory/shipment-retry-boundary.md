---
name: Shipment retry boundary
description: Distinguish an unconfirmed posting retry from a later identical physical receipt.
---

An unknown-outcome stock posting must retain its operation identity and original capture basis for an unchanged retry. After confirmation, a later physical batch is a new operation even if every quantity matches.

**Why:** A server can commit while the response is lost. Refreshing availability can then make the client reject its own valid retry; retaining a confirmed identity indefinitely can instead suppress a legitimate later partial receipt.

**How to apply:** Confirm by a matching operation or receipt identity, not just a refreshed snapshot. Reuse the identity only for an unconfirmed unchanged attempt. Keep authoritative stock validation server-side without allowing a client refresh to block confirmation of that same attempt.
