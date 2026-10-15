---
name: Shipment quarantine custody
description: Keep physical receiving evidence distinct from later inspection disposition and verified identity.
---

Partial inspection dispositions must never split or rewrite the original
physical receipt or inflate an order's received totals. Derive remaining
quarantine from original custody minus the selected disposition history.

**Why:** Received goods include damaged units. Treating a later release as
another receipt double-counts fulfillment; treating one released subset as a
whole-batch release makes unresolved equipment available for installation.

**How to apply:** Keep stock availability, order progress, serial blocking,
prints and backup validation consistent with remaining custody. Mixed resolved
holds are not all-released holds. Older whole-batch evidence remains valid.

Distinguish known physical serials, unidentified quantities, and unverified
transfer references. Releasing a subset requires exact verified identities;
returning or scrapping unknown purchase units cannot invent their identities.

**Why:** A dispatch reference links custody but does not prove that an unreadable
physical label was inspected. Substituting another quarantined or previously
disposed identity can wrongly release or duplicate equipment.

**How to apply:** Validate selected identities and unidentified counts against
still-held custody under the project-wide lock, retain terminal write-off
blocking, and preserve exact selection identities across unknown-outcome retries.

Receipt serial appendices must use the printed movement's saved evidence, not
the current contents of its parent hold or the order's accumulated serials.

**Why:** Later partial arrivals and inspections change current custody. Using
that state in a historical printout can introduce serials that were never part
of the printed movement or label an unverified reference as a confirmed reading.

**How to apply:** Use linked records only for product/display metadata; retain
separate confirmed, damaged, unverified and disposition evidence categories.
