---
name: Inventory order identity
description: Why readable procurement numbers and mutable supplier references must not replace order identities.
---
Keep a readable order number, a mutable supplier/customer reference and an immutable internal identity separate. Correcting a reference must continue editing the same draft, including after an unknown save outcome.

**Why:** Shipment recovery, receipts and command replay depend on the original identity. Treating a business-reference correction as a new identity can duplicate a draft or disconnect its physical shipment evidence.

**How to apply:** Any new editor or client must preserve internal identity across reference changes and retries. Human-readable labels are for presentation, never for rebinding saved shipment commands or rewriting old receipt references.

Restore must preserve locally known numbering high-water marks and known immutable numbers when old archives omit them; conflicts must fail explicitly.

**Why:** Printed order numbers and supplier communications can exist outside the database snapshot. Restoring stock does not make those already issued numbers unused.

**How to apply:** Maintain this boundary in both project and full-system restore paths. A fresh independent server cannot infer numbers issued elsewhere after its snapshot; do not promise global or gapless numbering across customer instances.
